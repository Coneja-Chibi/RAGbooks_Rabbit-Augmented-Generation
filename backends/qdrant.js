/**
 * ============================================================================
 * QDRANT BACKEND (via Unified Plugin API)
 * ============================================================================
 * Uses the Similharity plugin's unified /chunks/* endpoints.
 * Backend: Qdrant (external vector database server)
 *
 * MULTITENANCY SUPPORT:
 * - Uses ONE collection ("vecthare_main") with payload filters
 * - Passes type and sourceId for data isolation
 * - Supports all VectHare features via payload metadata
 *
 * Requires either a local Qdrant instance or Qdrant Cloud account.
 *
 * @author VectHare
 * @version 3.0.0
 * ============================================================================
 */

import { getRequestHeaders } from '../../../../../script.js';
import { VectorBackend } from './backend-interface.js';
import { getModelField } from '../core/providers.js';
import { VECTOR_LIST_LIMIT } from '../core/constants.js';

const BACKEND_TYPE = 'qdrant';

/**
 * Get the model value from settings based on provider
 */
function getModelFromSettings(settings) {
    const modelField = getModelField(settings.source);
    return modelField ? settings[modelField] || '' : '';
}

export class QdrantBackend extends VectorBackend {
    async initialize(settings) {
        // Get Qdrant config from settings
        const config = {
            host: settings.qdrant_host || 'localhost',
            port: settings.qdrant_port || 6333,
            url: settings.qdrant_url || null,
            apiKey: settings.qdrant_api_key || null,
        };

        const response = await fetch('/api/plugins/similharity/backend/init/qdrant', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(config),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to initialize Qdrant: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        console.log('VectHare: Using Qdrant backend (production-grade vector search)');
    }

    async healthCheck() {
        try {
            const response = await fetch('/api/plugins/similharity/backend/health/qdrant', {
                headers: getRequestHeaders(),
            });

            if (!response.ok) return false;

            const data = await response.json();
            return data.healthy === true;
        } catch (error) {
            console.error('[Qdrant] Health check failed:', error);
            return false;
        }
    }

    /**
     * Parse collection ID to extract type and sourceId for multitenancy
     * New format: vh:{type}:{uuid}
     * Examples:
     *   "vh:chat:a1b2c3d4-e5f6-7890-abcd-ef1234567890" → {type: "chat", sourceId: "a1b2..."}
     *   "vh:lorebook:world_info_123" → {type: "lorebook", sourceId: "world_info_123"}
     *   "vh:doc:char_456" → {type: "doc", sourceId: "char_456"}
     */
    _parseCollectionId(collectionId) {
        if (!collectionId || typeof collectionId !== 'string') {
            return { type: 'unknown', sourceId: 'unknown' };
        }

        const parts = collectionId.split(':');

        // New format: vh:{type}:{sourceId}
        if (parts.length >= 3 && parts[0] === 'vh') {
            return {
                type: parts[1],
                sourceId: parts.slice(2).join(':'), // Handle UUIDs that might have colons
            };
        }

        // Legacy format: vecthare_{type}_{sourceId}
        const legacyParts = collectionId.split('_');
        if (legacyParts.length >= 3 && legacyParts[0] === 'vecthare') {
            console.warn('VectHare: Legacy collection ID format detected:', collectionId);
            return {
                type: legacyParts[1],
                sourceId: legacyParts.slice(2).join('_'),
            };
        }

        // Fallback: assume it's a chat with raw ID
        console.warn('VectHare: Unknown collection ID format:', collectionId);
        return {
            type: 'chat',
            sourceId: collectionId,
        };
    }

    async getSavedHashes(collectionId, settings) {
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch('/api/plugins/similharity/chunks/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: 'vecthare_main', // Always use main collection
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                limit: VECTOR_LIST_LIMIT,
                filters: { type, sourceId }, // Filter by tenant
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to get saved hashes for ${collectionId} (type: ${type}, sourceId: ${sourceId}): ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();
        return data.items ? data.items.map(item => item.hash) : [];
    }

    async insertVectorItems(collectionId, items, settings) {
        if (items.length === 0) return;

        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch('/api/plugins/similharity/chunks/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: 'vecthare_main', // Always use main collection
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
                    },
                })),
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                filters: { type, sourceId }, // Pass multitenancy info
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to insert ${items.length} vectors into ${collectionId} (type: ${type}, sourceId: ${sourceId}): ${response.status} ${response.statusText} - ${errorBody}`);
        }

        console.log(`VectHare Qdrant: Inserted ${items.length} vectors (type: ${type}, sourceId: ${sourceId})`);
    }

    async deleteVectorItems(collectionId, hashes, settings) {
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch('/api/plugins/similharity/chunks/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: 'vecthare_main',
                hashes: hashes,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                filters: { type, sourceId },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to delete vectors from ${collectionId} (type: ${type}, sourceId: ${sourceId}): ${response.status} ${response.statusText} - ${errorBody}`);
        }
    }

    async queryCollection(collectionId, searchText, topK, settings) {
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch('/api/plugins/similharity/chunks/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: 'vecthare_main',
                searchText: searchText,
                topK: topK,
                threshold: 0.0,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                filters: { type, sourceId },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to query collection ${collectionId} (type: ${type}, sourceId: ${sourceId}): ${response.status} ${response.statusText} - ${errorBody}`);
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

    async queryMultipleCollections(collectionIds, searchText, topK, threshold, settings) {
        const results = {};

        for (const collectionId of collectionIds) {
            try {
                const { type, sourceId } = this._parseCollectionId(collectionId);

                const response = await fetch('/api/plugins/similharity/chunks/query', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        backend: BACKEND_TYPE,
                        collectionId: 'vecthare_main',
                        searchText: searchText,
                        topK: topK,
                        threshold: threshold,
                        source: settings.source || 'transformers',
                        model: getModelFromSettings(settings),
                        filters: { type, sourceId },
                    }),
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
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch('/api/plugins/similharity/chunks/purge', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: 'vecthare_main',
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                filters: { type, sourceId }, // Purge specific tenant
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to purge collection ${collectionId} (type: ${type}, sourceId: ${sourceId}): ${response.status} ${response.statusText} - ${errorBody}`);
        }

        console.log(`VectHare Qdrant: Purged (type: ${type}, sourceId: ${sourceId})`);
    }

    async purgeFileVectorIndex(collectionId, settings) {
        return this.purgeVectorIndex(collectionId, settings);
    }

    async purgeAllVectorIndexes(settings) {
        // Purge the entire main collection
        const response = await fetch('/api/plugins/similharity/chunks/purge', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: 'vecthare_main',
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                // No filters = purge everything
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to purge all collections: ${response.status} ${response.statusText} - ${errorBody}`);
        }
    }

    // ========================================================================
    // EXTENDED API METHODS (for UI components)
    // ========================================================================

    /**
     * Get a single chunk by hash
     */
    async getChunk(collectionId, hash, settings) {
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch(`/api/plugins/similharity/chunks/${encodeURIComponent(hash)}?` + new URLSearchParams({
            backend: BACKEND_TYPE,
            collectionId: 'vecthare_main',
            source: settings.source || 'transformers',
            model: getModelFromSettings(settings),
        }), {
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            if (response.status === 404) return null;
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to get chunk ${hash} from ${collectionId}: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();
        return data.chunk;
    }

    /**
     * List chunks with pagination
     */
    async listChunks(collectionId, settings, options = {}) {
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch('/api/plugins/similharity/chunks/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: 'vecthare_main',
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                offset: options.offset || 0,
                limit: options.limit || 100,
                includeVectors: options.includeVectors || false,
                filters: { type, sourceId },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to list chunks in ${collectionId} (type: ${type}, sourceId: ${sourceId}): ${response.status} ${response.statusText} - ${errorBody}`);
        }

        return await response.json();
    }

    /**
     * Update chunk text (triggers re-embedding)
     */
    async updateChunkText(collectionId, hash, newText, settings) {
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch(`/api/plugins/similharity/chunks/${encodeURIComponent(hash)}/text`, {
            method: 'PATCH',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: 'vecthare_main',
                text: newText,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                filters: { type, sourceId },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to update chunk text in ${collectionId} (hash: ${hash}): ${response.status} ${response.statusText} - ${errorBody}`);
        }

        return await response.json();
    }

    /**
     * Update chunk metadata (no re-embedding)
     */
    async updateChunkMetadata(collectionId, hash, metadata, settings) {
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch(`/api/plugins/similharity/chunks/${encodeURIComponent(hash)}/metadata`, {
            method: 'PATCH',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: 'vecthare_main',
                metadata: metadata,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                filters: { type, sourceId },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to update chunk metadata in ${collectionId} (hash: ${hash}): ${response.status} ${response.statusText} - ${errorBody}`);
        }

        return await response.json();
    }

    /**
     * Get collection statistics
     */
    async getStats(collectionId, settings) {
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch('/api/plugins/similharity/chunks/stats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: 'vecthare_main',
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                filters: { type, sourceId },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No response body');
            throw new Error(`[Qdrant] Failed to get stats for ${collectionId} (type: ${type}, sourceId: ${sourceId}): ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();
        return data.stats;
    }
}
