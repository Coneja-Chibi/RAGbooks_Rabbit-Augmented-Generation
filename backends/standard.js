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

const BACKEND_TYPE = 'vectra';

/**
 * Get the model value from settings based on provider
 */
function getModelFromSettings(settings) {
    const modelField = getModelField(settings.source);
    return modelField ? settings[modelField] || '' : '';
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
        const response = await fetch('/api/plugins/similharity/chunks/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: collectionId,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
                limit: 10000, // Get all for hash comparison
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

    async queryCollection(collectionId, searchText, topK, settings) {
        const response = await fetch('/api/plugins/similharity/chunks/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: BACKEND_TYPE,
                collectionId: collectionId,
                searchText: searchText,
                topK: topK,
                threshold: 0.0,
                source: settings.source || 'transformers',
                model: getModelFromSettings(settings),
            }),
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

    async queryMultipleCollections(collectionIds, searchText, topK, threshold, settings) {
        // Query each collection separately (unified API handles one at a time)
        const results = {};

        for (const collectionId of collectionIds) {
            try {
                const response = await fetch('/api/plugins/similharity/chunks/query', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        backend: BACKEND_TYPE,
                        collectionId: collectionId,
                        searchText: searchText,
                        topK: topK,
                        threshold: threshold,
                        source: settings.source || 'transformers',
                        model: getModelFromSettings(settings),
                    }),
                });

                if (response.ok) {
                    const data = await response.json();

                    results[collectionId] = {
                        hashes: data.results.map(r => r.hash),
                        metadata: data.results.map(r => ({
                            hash: r.hash,
                            text: r.text,
                            score: r.score,
                            ...r.metadata,
                        })),
                    };
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
