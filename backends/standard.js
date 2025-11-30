/**
 * ============================================================================
 * STANDARD BACKEND (Vectra via Unified Plugin API)
 * ============================================================================
 * Uses the Similharity plugin's unified /chunks/* endpoints.
 * Backend: Vectra (file-based JSON storage)
 *
 * This is the default backend - no setup required.
 *
 * @author VectHare
 * @version 3.0.0
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

const BACKEND_TYPE = 'vectra';

/**
 * Get the model value from settings based on provider
 */
function getModelFromSettings(settings) {
    const modelField = getModelField(settings.source);
    return modelField ? settings[modelField] || '' : '';
}

/**
 * Build provider-specific parameters for the plugin API.
 * This ensures all provider-specific fields (URLs, API keys, input_type, etc.)
 * are passed through to the server-side embedding handlers.
 *
 * @param {object} settings - VectHare settings
 * @param {boolean} isQuery - Whether this is a query operation (affects Cohere input_type)
 * @returns {object} Provider-specific parameters to merge into request body
 */
function getProviderSpecificParams(settings, isQuery = false) {
    const params = {};
    const source = settings.source;

    switch (source) {
        case 'extras':
            // Extras requires URL and key from extension_settings
            params.extrasUrl = extension_settings.apiUrl;
            params.extrasKey = extension_settings.apiKey;
            break;

        case 'cohere':
            // Cohere requires input_type to distinguish queries from documents
            // This is CRITICAL for proper embedding quality
            params.input_type = isQuery ? 'search_query' : 'search_document';
            break;

        case 'ollama':
            // Ollama needs apiUrl and keep_alive setting
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
            // Pass API key if available
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
            // No additional params needed
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
                // Initialize the vectra backend
                await fetch('/api/plugins/similharity/backend/init/vectra', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                });
                console.log('VectHare: Using Standard backend (Vectra via plugin)');
            } else {
                console.warn('VectHare: Similharity plugin not available');
            }
        } catch (e) {
            console.warn('VectHare: Plugin health check failed:', e.message);
            this.pluginAvailable = false;
        }
    }

    async healthCheck() {
        try {
            const response = await fetch('/api/plugins/similharity/backend/health/vectra', {
                headers: getRequestHeaders(),
            });

            if (!response.ok) return false;

            const data = await response.json();
            return data.healthy === true;
        } catch (error) {
            console.error('[Standard] Health check failed:', error);
            return false;
        }
    }

    async getSavedHashes(collectionId, settings) {
        // Get provider-specific params (not a query, just listing)
        const providerParams = getProviderSpecificParams(settings, false);

        const response = await fetch('/api/plugins/similharity/chunks/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: collectionId,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                limit: VECTOR_LIST_LIMIT, // Get all for hash comparison
                // Merge provider-specific params
                ...providerParams,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to get saved hashes for ${collectionId}: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();
        return data.items ? data.items.map(item => item.hash) : [];
    }

    async insertVectorItems(collectionId, items, settings) {
        if (items.length === 0) return;

        // Get provider-specific params (isQuery=false for inserts - these are documents)
        const providerParams = getProviderSpecificParams(settings, false);

        const response = await fetch('/api/plugins/similharity/chunks/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: collectionId,
                items: items.map(item => ({
                    hash: item.hash,
                    text: item.text,
                    index: item.index,
                    vector: item.vector,
                    metadata: {
                        ...item.metadata,
                        // Pass through VectHare-specific fields
                        importance: item.importance,
                        keywords: item.keywords,
                        customWeights: item.customWeights,
                        disabledKeywords: item.disabledKeywords,
                        chunkGroup: item.chunkGroup,
                        conditions: item.conditions,
                        summary: item.summary,
                        isSummaryChunk: item.isSummaryChunk,
                        parentHash: item.parentHash,
                    }
                })),
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                // Merge provider-specific params (extras URL/key, cohere input_type, etc.)
                ...providerParams,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to insert vectors into ${collectionId}: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        console.log(`VectHare Standard: Inserted ${items.length} vectors into ${collectionId}`);
    }

    async deleteVectorItems(collectionId, hashes, settings) {
        const response = await fetch('/api/plugins/similharity/chunks/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: collectionId,
                hashes: hashes,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to delete vectors from ${collectionId}: ${response.status} ${response.statusText} - ${errorBody}`);
        }
    }

    async queryCollection(collectionId, searchText, topK, settings, queryVector = null) {
        // Get provider-specific params (isQuery=true for queries)
        const providerParams = getProviderSpecificParams(settings, true);

        // Build request body - use queryVector if provided, otherwise searchText
        const requestBody = {
            backend: BACKEND_TYPE,
            collectionId: collectionId,
            topK: topK,
            threshold: settings.score_threshold || 0.0, // Use user's threshold setting
            source: settings.source || 'transformers',
            model: getModelFromSettings(settings),
            // Merge provider-specific params (cohere input_type='search_query', etc.)
            ...providerParams,
        };

        if (queryVector) {
            requestBody.queryVector = queryVector;
        } else {
            requestBody.searchText = searchText;
        }

        const response = await fetch('/api/plugins/similharity/chunks/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to query collection ${collectionId}: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();

        // Format results to match expected output
        const hashes = data.results.map(r => r.hash);
        const metadata = data.results.map(r => ({
            hash: r.hash,
            text: r.text,
            score: r.score,
            ...r.metadata,
        }));

        return { hashes, metadata };
    }

    async queryMultipleCollections(collectionIds, searchText, topK, threshold, settings, queryVector = null) {
        // Get provider-specific params (isQuery=true for queries)
        const providerParams = getProviderSpecificParams(settings, true);

        // Query each collection separately (unified API handles one at a time)
        const results = {};

        for (const collectionId of collectionIds) {
            try {
                // Build request body - use queryVector if provided
                const requestBody = {
                    backend: BACKEND_TYPE,
                    collectionId: collectionId,
                    topK: topK,
                    threshold: threshold,
                    source: settings.source || 'transformers',
                    model: getModelFromSettings(settings),
                    // Merge provider-specific params (cohere input_type='search_query', etc.)
                    ...providerParams,
                };

                if (queryVector) {
                    requestBody.queryVector = queryVector;
                } else {
                    requestBody.searchText = searchText;
                }

                const response = await fetch('/api/plugins/similharity/chunks/query', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify(requestBody),
                });

                if (response.ok) {
                    const data = await response.json();
                    const resultArray = data.results || data.chunks || [];

                    results[collectionId] = {
                        hashes: resultArray.map(r => r.hash),
                        metadata: resultArray.map(r => ({
                            hash: r.hash,
                            text: r.text,
                            score: r.score,
                            ...r.metadata,
                        })),
                    };
                } else {
                    console.error(`VectHare: Query failed for ${collectionId}: ${response.status} ${response.statusText}`);
                    results[collectionId] = { hashes: [], metadata: [] };
                }
            } catch (error) {
                console.error(`Failed to query collection ${collectionId}:`, error);
                results[collectionId] = { hashes: [], metadata: [] };
            }
        }

        return results;
    }

    async purgeVectorIndex(collectionId, settings) {
        const response = await fetch('/api/plugins/similharity/chunks/purge', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: collectionId,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`Failed to purge collection ${collectionId}: ${response.status} ${response.statusText} - ${errorBody}`);
        }
    }

    async purgeFileVectorIndex(collectionId, settings) {
        return this.purgeVectorIndex(collectionId, settings);
    }

    async purgeAllVectorIndexes(settings) {
        // Get all collections and purge ALL of them - no filtering
        const response = await fetch('/api/plugins/similharity/collections', {
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error(`Failed to get collections: ${response.statusText}`);
        }

        const data = await response.json();

        // Purge ALL collections - don't filter by backend or source
        for (const collection of data.collections || []) {
            try {
                await this.purgeVectorIndex(collection.id, {
                    ...settings,
                    source: collection.source,
                });
            } catch (e) {
                console.error(`Failed to purge ${collection.id}:`, e);
            }
        }
    }

    // ========================================================================
    // EXTENDED API METHODS (for UI components)
    // ========================================================================

    /**
     * Get a single chunk by hash
     */
    async getChunk(collectionId, hash, settings) {
        const response = await fetch(`/api/plugins/similharity/chunks/${encodeURIComponent(hash)}?` + new URLSearchParams({
            backend: BACKEND_TYPE,
            collectionId: collectionId,
            source: settings.source || 'transformers',
            model: getModelFromSettings(settings),
        }), {
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`Failed to get chunk: ${response.statusText}`);
        }

        const data = await response.json();
        return data.chunk;
    }

    /**
     * List chunks with pagination
     */
    async listChunks(collectionId, settings, options = {}) {
        const response = await fetch('/api/plugins/similharity/chunks/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: collectionId,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                offset: options.offset || 0,
                limit: options.limit || 100,
                includeVectors: options.includeVectors || false,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to list chunks: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Update chunk text (triggers re-embedding)
     */
    async updateChunkText(collectionId, hash, newText, settings) {
        const response = await fetch(`/api/plugins/similharity/chunks/${encodeURIComponent(hash)}/text`, {
            method: 'PATCH',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: collectionId,
                text: newText,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to update chunk text: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Update chunk metadata (no re-embedding)
     */
    async updateChunkMetadata(collectionId, hash, metadata, settings) {
        const response = await fetch(`/api/plugins/similharity/chunks/${encodeURIComponent(hash)}/metadata`, {
            method: 'PATCH',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: collectionId,
                metadata: metadata,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to update chunk metadata: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Get collection statistics
     */
    async getStats(collectionId, settings) {
        const response = await fetch('/api/plugins/similharity/chunks/stats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: collectionId,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to get stats: ${response.statusText}`);
        }

        const data = await response.json();
        return data.stats;
    }
}
