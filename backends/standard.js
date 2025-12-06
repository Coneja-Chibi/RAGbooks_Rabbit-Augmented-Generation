/**
 * ============================================================================
 * STANDARD BACKEND (Vectra - ST Native + Plugin)
 * ============================================================================
 * Uses ST's native /api/vector/* endpoints as the primary method.
 * Falls back to Similharity plugin endpoints if available for extended features.
 *
 * This is the default backend - no setup required.
 *
 * @author VectHare
 * @version 3.1.0
 * ============================================================================
 */

import { getRequestHeaders } from '../../../../../script.js';
import { VectorBackend } from './backend-interface.js';
import { getModelField } from '../core/providers.js';
import { VECTOR_LIST_LIMIT } from '../core/constants.js';
import { extension_settings } from '../../../../extensions.js';
import { textgen_types, textgenerationwebui_settings } from '../../../../textgen-settings.js';
import { oai_settings } from '../../../../openai.js';
import { secret_state } from '../../../../secrets.js';

/**
 * Get the model value from settings based on provider
 */
function getModelFromSettings(settings) {
    const modelField = getModelField(settings.source);
    return modelField ? settings[modelField] || '' : '';
}

/**
 * Build provider-specific parameters for API requests.
 * @param {object} settings - VectHare settings
 * @param {boolean} isQuery - Whether this is a query operation
 * @returns {object} Provider-specific parameters
 */
function getProviderSpecificParams(settings, isQuery = false) {
    const params = {};
    const source = settings.source;

    switch (source) {
        case 'extras':
            params.extrasUrl = extension_settings.apiUrl;
            params.extrasKey = extension_settings.apiKey;
            break;

        case 'cohere':
            params.input_type = isQuery ? 'search_query' : 'search_document';
            break;

        case 'ollama':
            params.apiUrl = settings.use_alt_endpoint
                ? settings.alt_endpoint_url
                : textgenerationwebui_settings.server_urls[textgen_types.OLLAMA];
            params.keep = !!settings.ollama_keep;
            break;

        case 'llamacpp':
            params.apiUrl = settings.use_alt_endpoint
                ? settings.alt_endpoint_url
                : textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP];
            break;

        case 'vllm':
            params.apiUrl = settings.use_alt_endpoint
                ? settings.alt_endpoint_url
                : textgenerationwebui_settings.server_urls[textgen_types.VLLM];
            break;

        case 'bananabread':
            params.apiUrl = settings.use_alt_endpoint
                ? settings.alt_endpoint_url
                : 'http://localhost:8008';
            if (secret_state['bananabread_api_key']) {
                const secrets = secret_state['bananabread_api_key'];
                const activeSecret = Array.isArray(secrets) ? (secrets.find(s => s.active) || secrets[0]) : null;
                if (activeSecret) {
                    params.apiKey = activeSecret.value;
                }
            }
            break;

        case 'palm':
            params.api = 'makersuite';
            break;

        case 'vertexai':
            params.api = 'vertexai';
            params.vertexai_auth_mode = oai_settings.vertexai_auth_mode;
            params.vertexai_region = oai_settings.vertexai_region;
            params.vertexai_express_project_id = oai_settings.vertexai_express_project_id;
            break;

        default:
            break;
    }

    return params;
}

export class StandardBackend extends VectorBackend {
    constructor() {
        super();
        this.pluginAvailable = false;
    }

    async initialize(settings) {
        // Check if plugin is available
        try {
            const response = await fetch('/api/plugins/similharity/health');
            this.pluginAvailable = response.ok;

            if (this.pluginAvailable) {
                await fetch('/api/plugins/similharity/backend/init/vectra', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                });
                console.log('VectHare: Standard backend initialized (plugin available)');
            } else {
                console.log('VectHare: Standard backend initialized (native ST API only)');
            }
        } catch (e) {
            console.log('VectHare: Standard backend initialized (native ST API only)');
            this.pluginAvailable = false;
        }
    }

    async healthCheck() {
        // Native ST API is always available if ST is running
        try {
            // Quick test: try to list a non-existent collection (should return empty array or error)
            const response = await fetch('/api/vector/list', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    collectionId: '__vecthare_health_check__',
                    source: 'transformers'
                }),
            });
            // 200 = works (empty collection), 500 = syntax error (no collection), both are "working"
            return response.status === 200 || response.status === 500;
        } catch (error) {
            console.error('[Standard] Health check failed:', error);
            return false;
        }
    }

    /**
     * Get saved hashes for a collection
     * Uses native ST API
     */
    async getSavedHashes(collectionId, settings) {
        const providerParams = getProviderSpecificParams(settings, false);
        const model = getModelFromSettings(settings);

        const response = await fetch('/api/vector/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: collectionId,
                source: settings.source || 'transformers',
                model: model,
                ...providerParams,
            }),
        });

        if (!response.ok) {
            // Collection doesn't exist or error
            if (response.status === 500) {
                // Likely collection doesn't exist
                return [];
            }
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to get saved hashes: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();
        // Native API returns array of hashes directly
        return Array.isArray(data) ? data : [];
    }

    /**
     * Insert vector items into a collection
     * Uses native ST API
     */
    async insertVectorItems(collectionId, items, settings) {
        if (items.length === 0) return;

        const providerParams = getProviderSpecificParams(settings, false);
        const model = getModelFromSettings(settings);

        // Log chunk statistics for debugging OOM issues
        const textLengths = items.map(item => {
            let text = item.text || '';
            if (item.keywords && item.keywords.length > 0) {
                const keywordTexts = item.keywords.map(kw => kw.text || kw).join(' ');
                text += ` [KEYWORDS: ${keywordTexts}]`;
            }
            return text.length;
        });
        const maxLen = Math.max(...textLengths);
        const avgLen = Math.round(textLengths.reduce((a, b) => a + b, 0) / textLengths.length);
        const longestChunkIndex = textLengths.indexOf(maxLen);

        // Count how many chunks have keywords
        const chunksWithKeywords = items.filter(item => item.keywords && item.keywords.length > 0).length;

        console.log(`VectHare: Embedding ${items.length} chunks (avg: ${avgLen} chars, max: ${maxLen} chars at index ${longestChunkIndex}) - ${chunksWithKeywords} chunks have keywords`);


        // Warn if chunks are unusually large (potential OOM risk)
        if (maxLen > 2000) {
            console.warn(`VectHare: Large chunk detected (${maxLen} chars). If you see OOM errors, try reducing chunk size.`);
            console.warn(`VectHare: Problematic chunk preview: "${(items[longestChunkIndex]?.text || '').substring(0, 100)}..."`);
        }

        try {
            const response = await fetch('/api/vector/insert', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    collectionId: collectionId,
                    items: items.map(item => {
                        // Include keywords in the text for embedding/indexing
                        let textWithKeywords = item.text || '';
                        if (item.keywords && item.keywords.length > 0) {
                            const keywordTexts = item.keywords.map(kw => kw.text || kw).join(' ');
                            textWithKeywords += ` [KEYWORDS: ${keywordTexts}]`;
                        }

                        return {
                            hash: item.hash,
                            text: textWithKeywords,
                            index: item.index ?? 0,
                        };
                    }),
                    source: settings.source || 'transformers',
                    model: model,
                    // Pass embeddings if pre-computed (for webllm, koboldcpp, bananabread)
                    embeddings: items[0]?.vector ? Object.fromEntries(items.map(i => {
                        let textWithKeywords = i.text || '';
                        if (i.keywords && i.keywords.length > 0) {
                            const keywordTexts = i.keywords.map(kw => kw.text || kw).join(' ');
                            textWithKeywords += ` [KEYWORDS: ${keywordTexts}]`;
                        }
                        return [textWithKeywords, i.vector];
                    })) : undefined,
                    ...providerParams,
                }),
            });

            if (!response.ok) {
                const errorBody = await response.text().catch(() => 'No response body');
                throw new Error(`Failed to insert vectors: ${response.status} - ${errorBody}`);
            }

            console.log(`VectHare Standard: Inserted ${items.length} vectors into ${collectionId}`);
        } catch (error) {
            // Enhanced error logging for OOM debugging
            const isOOM = error.message?.includes('OrtRun') || error.message?.includes('error code = 6');
            if (isOOM) {
                console.error(`VectHare: ONNX OOM Error while embedding. Diagnostics:`);
                console.error(`  - Provider: ${settings.source}`);
                console.error(`  - Model: ${model || '(default)'}`);
                console.error(`  - Batch size: ${items.length} chunks`);
                console.error(`  - Largest chunk: ${maxLen} chars (index ${longestChunkIndex})`);
                console.error(`  - Average chunk: ${avgLen} chars`);
                console.error(`  - Tip: Try reducing chunk size in settings, or use a smaller embedding model`);
            }
            throw error;
        }
    }

    /**
     * Delete vector items from a collection
     * Uses native ST API
     */
    async deleteVectorItems(collectionId, hashes, settings) {
        const response = await fetch('/api/vector/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: collectionId,
                hashes: hashes,
                source: settings.source || 'transformers',
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to delete vectors: ${response.status} ${response.statusText} - ${errorBody}`);
        }
    }

    /**
     * Query a collection for similar vectors
     * Uses native ST API
     */
    async queryCollection(collectionId, searchText, topK, settings, queryVector = null) {
        const providerParams = getProviderSpecificParams(settings, true);
        const model = getModelFromSettings(settings);

        const requestBody = {
            collectionId: collectionId,
            searchText: searchText,
            topK: topK,
            threshold: settings.score_threshold || 0.0,
            source: settings.source || 'transformers',
            model: model,
            ...providerParams,
        };

        // If we have a pre-computed query vector (for webllm, koboldcpp, bananabread)
        if (queryVector) {
            requestBody.embeddings = { [searchText]: queryVector };
        }

        const response = await fetch('/api/vector/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to query collection: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();

        // Native API returns { hashes: [], metadata: [] }
        return {
            hashes: data.hashes || [],
            metadata: (data.metadata || []).map((m, idx) => ({
                hash: data.hashes?.[idx],
                text: m.text,
                score: m.score || 0,
                ...m,
            })),
        };
    }

    /**
     * Query multiple collections
     * Uses native ST API
     */
    async queryMultipleCollections(collectionIds, searchText, topK, threshold, settings, queryVector = null) {
        const providerParams = getProviderSpecificParams(settings, true);
        const model = getModelFromSettings(settings);

        const requestBody = {
            collectionIds: collectionIds,
            searchText: searchText,
            topK: topK,
            threshold: threshold,
            source: settings.source || 'transformers',
            model: model,
            ...providerParams,
        };

        if (queryVector) {
            requestBody.embeddings = { [searchText]: queryVector };
        }

        const response = await fetch('/api/vector/query-multi', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            // Fallback: query each collection individually
            console.warn('VectHare: query-multi failed, falling back to individual queries');
            const results = {};
            const errors = [];
            for (const collectionId of collectionIds) {
                try {
                    results[collectionId] = await this.queryCollection(collectionId, searchText, topK, settings, queryVector);
                } catch (e) {
                    console.error(`VectHare: Query failed for collection ${collectionId}:`, e.message);
                    errors.push(`${collectionId}: ${e.message}`);
                    results[collectionId] = { hashes: [], metadata: [], error: e.message };
                }
            }
            if (errors.length > 0) {
                console.error(`VectHare: ${errors.length} collection(s) failed to query:`, errors);
            }
            return results;
        }

        return await response.json();
    }

    /**
     * Purge (delete) a collection
     * Uses native ST API
     */
    async purgeVectorIndex(collectionId, settings) {
        const response = await fetch('/api/vector/purge', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: collectionId,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to purge collection: ${response.status} ${response.statusText} - ${errorBody}`);
        }
    }

    async purgeFileVectorIndex(collectionId, settings) {
        return this.purgeVectorIndex(collectionId, settings);
    }

    /**
     * Purge all vector indexes
     * Uses native ST API
     */
    async purgeAllVectorIndexes(settings) {
        const response = await fetch('/api/vector/purge-all', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to purge all: ${response.status} ${response.statusText} - ${errorBody}`);
        }
    }

    // ========================================================================
    // EXTENDED API METHODS (plugin-only, graceful fallback)
    // ========================================================================

    /**
     * List chunks with pagination (plugin-only feature)
     * Falls back to basic hash list if plugin unavailable
     */
    async listChunks(collectionId, settings, options = {}) {
        if (this.pluginAvailable) {
            try {
                const response = await fetch('/api/plugins/similharity/chunks/list', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        backend: 'vectra',
                        collectionId: collectionId,
                        source: settings.source || 'transformers',
                        model: getModelFromSettings(settings),
                        offset: options.offset || 0,
                        limit: options.limit || 100,
                        includeVectors: options.includeVectors || false,
                    }),
                });

                if (response.ok) {
                    return await response.json();
                }
            } catch (e) {
                console.warn('VectHare: Plugin listChunks failed, using native fallback');
            }
        }

        // Fallback: use native list (hashes only)
        const hashes = await this.getSavedHashes(collectionId, settings);
        return {
            items: hashes.map(hash => ({ hash, text: '', metadata: {} })),
            total: hashes.length,
        };
    }

    /**
     * Get a single chunk by hash (plugin-only feature)
     * Returns null if plugin unavailable
     */
    async getChunk(collectionId, hash, settings) {
        if (!this.pluginAvailable) return null;

        try {
            const response = await fetch(`/api/plugins/similharity/chunks/${encodeURIComponent(hash)}?` + new URLSearchParams({
                backend: 'vectra',
                collectionId: collectionId,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
            }), {
                headers: getRequestHeaders(),
            });

            if (response.ok) {
                const data = await response.json();
                return data.chunk;
            }
        } catch (e) {
            console.warn('VectHare: Plugin getChunk failed');
        }

        return null;
    }

    /**
     * Update chunk text (plugin-only feature)
     */
    async updateChunkText(collectionId, hash, newText, settings) {
        if (!this.pluginAvailable) {
            throw new Error('Chunk text editing requires the Similharity plugin');
        }

        const response = await fetch(`/api/plugins/similharity/chunks/${encodeURIComponent(hash)}/text`, {
            method: 'PATCH',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: 'vectra',
                collectionId: collectionId,
                text: newText,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to update chunk text: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        return await response.json();
    }

    /**
     * Update chunk metadata (plugin-only feature)
     */
    async updateChunkMetadata(collectionId, hash, metadata, settings) {
        if (!this.pluginAvailable) {
            throw new Error('Chunk metadata editing requires the Similharity plugin');
        }

        const response = await fetch(`/api/plugins/similharity/chunks/${encodeURIComponent(hash)}/metadata`, {
            method: 'PATCH',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: 'vectra',
                collectionId: collectionId,
                metadata: metadata,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to update chunk metadata: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        return await response.json();
    }

    /**
     * Get collection statistics (plugin-only feature)
     * Falls back to basic count if plugin unavailable
     */
    async getStats(collectionId, settings) {
        if (this.pluginAvailable) {
            try {
                const response = await fetch('/api/plugins/similharity/chunks/stats', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        backend: 'vectra',
                        collectionId: collectionId,
                        source: settings.source || 'transformers',
                        model: getModelFromSettings(settings),
                    }),
                });

                if (response.ok) {
                    const data = await response.json();
                    return data.stats;
                }
            } catch (e) {
                console.warn('VectHare: Plugin getStats failed, using native fallback');
            }
        }

        // Fallback: just return count from hash list
        const hashes = await this.getSavedHashes(collectionId, settings);
        return {
            count: hashes.length,
            source: 'native',
        };
    }

    /**
     * Discover all collections on disk
     * Plugin provides this; native API requires probing
     */
    async discoverCollections(settings) {
        if (this.pluginAvailable) {
            try {
                const response = await fetch('/api/plugins/similharity/collections', {
                    headers: getRequestHeaders(),
                });

                if (response.ok) {
                    const data = await response.json();
                    return (data.collections || []).map(c => ({
                        id: c.id,
                        source: c.source,
                        chunkCount: c.chunkCount || 0,
                        backend: c.backend || 'vectra',
                    }));
                }
            } catch (e) {
                console.warn('VectHare: Plugin discoverCollections failed');
            }
        }

        // No native way to list collections - return empty
        // Discovery will be handled by collection-loader probing known patterns
        return null;
    }
}
