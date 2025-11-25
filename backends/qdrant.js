/**
 * ============================================================================
 * QDRANT BACKEND (Frontend Wrapper - MULTITENANCY)
 * ============================================================================
 * Calls VectHare plugin's Qdrant endpoints for vector operations.
 * Provides production-grade vector search with advanced filtering.
 *
 * MULTITENANCY SUPPORT:
 * - Uses ONE collection ("vecthare_main") with payload filters
 * - Passes type and sourceId for data isolation
 * - Supports all legacy VectHare features via payload metadata
 *
 * This backend communicates with the plugin's Qdrant implementation.
 * Requires either a local Qdrant instance or Qdrant Cloud account.
 *
 * @author VectHare
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { getRequestHeaders } from '../../../../../script.js';
import { VectorBackend } from './backend-interface.js';
import {
    getAdditionalArgs,
    getVectorsRequestBody,
    throwIfSourceInvalid
} from '../core-vector-api.js';

export class QdrantBackend extends VectorBackend {
    async initialize(settings) {
        // Get Qdrant config from settings
        const config = {
            host: settings.qdrant_host || 'localhost',
            port: settings.qdrant_port || 6333,
            url: settings.qdrant_url || null,
            apiKey: settings.qdrant_api_key || null,
        };

        const response = await fetch('/api/plugins/similharity/qdrant/init', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(config),
        });

        if (!response.ok) {
            throw new Error(`Failed to initialize Qdrant: ${response.statusText}`);
        }

        console.log('VectHare: Using Qdrant backend (production-grade vector search)');
    }

    async healthCheck() {
        try {
            const response = await fetch('/api/plugins/similharity/qdrant/health', {
                method: 'GET',
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

    async getSavedHashes(collectionId, settings) {
        // MULTITENANCY: Extract type and sourceId from collectionId
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch('/api/plugins/similharity/qdrant/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'vecthare_main',  // Always use main collection
                filters: { type, sourceId }      // Filter by tenant
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to get saved hashes: ${response.statusText}`);
        }

        const data = await response.json();
        return data.hashes || [];
    }

    /**
     * Parse collection ID to extract type and sourceId
     * Examples:
     *   "vecthare_chat_001" → {type: "chat", sourceId: "001"}
     *   "vecthare_lorebook_main" → {type: "lorebook", sourceId: "main"}
     */
    _parseCollectionId(collectionId) {
        // Format: vecthare_{type}_{sourceId}
        const parts = collectionId.split('_');
        if (parts.length >= 3 && parts[0] === 'vecthare') {
            return {
                type: parts[1],           // chat, lorebook, character, document, wiki
                sourceId: parts.slice(2).join('_')  // Rest is sourceId
            };
        }

        // Fallback: assume it's a chat
        return {
            type: 'chat',
            sourceId: collectionId
        };
    }

    async insertVectorItems(collectionId, items, settings) {
        throwIfSourceInvalid(settings);

        if (items.length === 0) return;

        // MULTITENANCY: Extract type and sourceId from collectionId
        const { type, sourceId } = this._parseCollectionId(collectionId);

        // Get embeddings for the items
        const texts = items.map(x => x.text);
        const args = await getAdditionalArgs(texts, settings);

        let itemsWithVectors;

        if (args.embeddings && Object.keys(args.embeddings).length > 0) {
            // Client-side embeddings
            itemsWithVectors = items.map(item => ({
                hash: item.hash,
                text: item.text,
                vector: args.embeddings[item.text],
                metadata: item.metadata || {},
                // Legacy VectHare features (pass through)
                importance: item.importance,
                keywords: item.keywords,
                customWeights: item.customWeights,
                disabledKeywords: item.disabledKeywords,
                chunkGroup: item.chunkGroup,
                conditions: item.conditions,
                summary: item.summary,
                isSummaryChunk: item.isSummaryChunk,
                parentHash: item.parentHash,
            }));
        } else {
            // Server-side embeddings
            console.log('VectHare Qdrant: Getting embeddings from server-side provider...');

            const embeddingResponse = await fetch('/api/plugins/similharity/batch-embeddings', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    ...getVectorsRequestBody(args, settings),
                    texts: texts,
                    source: settings.source,
                }),
            });

            if (!embeddingResponse.ok) {
                throw new Error(`Failed to get embeddings: ${embeddingResponse.statusText}`);
            }

            const embeddingData = await embeddingResponse.json();

            if (!embeddingData.success || !Array.isArray(embeddingData.embeddings)) {
                throw new Error(`Embedding error: ${embeddingData.error || 'Invalid response'}`);
            }

            if (embeddingData.embeddings.length !== items.length) {
                throw new Error(`Expected ${items.length} embeddings, got ${embeddingData.embeddings.length}`);
            }

            itemsWithVectors = items.map((item, i) => ({
                hash: item.hash,
                text: item.text,
                vector: embeddingData.embeddings[i],
                metadata: item.metadata || {},
                // Legacy VectHare features (pass through)
                importance: item.importance,
                keywords: item.keywords,
                customWeights: item.customWeights,
                disabledKeywords: item.disabledKeywords,
                chunkGroup: item.chunkGroup,
                conditions: item.conditions,
                summary: item.summary,
                isSummaryChunk: item.isSummaryChunk,
                parentHash: item.parentHash,
            }));
        }

        // Insert into Qdrant via plugin with tenant metadata
        const response = await fetch('/api/plugins/similharity/qdrant/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'vecthare_main',  // Always use main collection
                items: itemsWithVectors,
                tenantMetadata: { type, sourceId }  // Pass multitenancy info
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to insert vectors: ${response.statusText}`);
        }

        console.log(`VectHare Qdrant: Inserted ${items.length} vectors into vecthare_main (type: ${type}, sourceId: ${sourceId})`);
    }

    async deleteVectorItems(collectionId, hashes, settings) {
        const response = await fetch('/api/plugins/similharity/qdrant/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ collectionId, hashes }),
        });

        if (!response.ok) {
            throw new Error(`Failed to delete vectors: ${response.statusText}`);
        }
    }

    async queryCollection(collectionId, searchText, topK, settings) {
        throwIfSourceInvalid(settings);

        // MULTITENANCY: Extract type and sourceId from collectionId
        const { type, sourceId } = this._parseCollectionId(collectionId);

        // Get query vector
        const args = await getAdditionalArgs([searchText], settings);

        let queryVector;
        if (args.embeddings && args.embeddings[searchText]) {
            queryVector = args.embeddings[searchText];
        } else {
            // Server-side embeddings
            const embeddingResponse = await fetch('/api/plugins/similharity/get-embedding', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    ...getVectorsRequestBody(args, settings),
                    text: searchText,
                    source: settings.source,
                }),
            });

            if (!embeddingResponse.ok) {
                throw new Error(`Failed to get query embedding: ${embeddingResponse.statusText}`);
            }

            const embeddingData = await embeddingResponse.json();
            if (!embeddingData.success || !Array.isArray(embeddingData.embedding)) {
                throw new Error(`Embedding error: ${embeddingData.error || 'Invalid response'}`);
            }

            queryVector = embeddingData.embedding;
        }

        // Query with multitenancy filters
        const response = await fetch('/api/plugins/similharity/qdrant/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'vecthare_main',  // Always use main collection
                queryVector,
                topK,
                filters: { type, sourceId }      // Filter by tenant
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to query collection: ${response.statusText}`);
        }

        const data = await response.json();

        // Format results to match expected output {hashes, metadata}
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
        throwIfSourceInvalid(settings);

        // Get query vector
        const args = await getAdditionalArgs([searchText], settings);

        let queryVector;
        if (args.embeddings && args.embeddings[searchText]) {
            queryVector = args.embeddings[searchText];
        } else {
            // Server-side embeddings
            const embeddingResponse = await fetch('/api/plugins/similharity/get-embedding', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    ...getVectorsRequestBody(args, settings),
                    text: searchText,
                    source: settings.source,
                }),
            });

            if (!embeddingResponse.ok) {
                throw new Error(`Failed to get query embedding: ${embeddingResponse.statusText}`);
            }

            const embeddingData = await embeddingResponse.json();
            if (!embeddingData.success || !Array.isArray(embeddingData.embedding)) {
                throw new Error(`Embedding error: ${embeddingData.error || 'Invalid response'}`);
            }

            queryVector = embeddingData.embedding;
        }

        // MULTITENANCY: Query each collection separately with filters
        const results = {};

        for (const collectionId of collectionIds) {
            try {
                // Extract type and sourceId for each collection
                const { type, sourceId } = this._parseCollectionId(collectionId);

                const response = await fetch('/api/plugins/similharity/qdrant/query', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        collectionId: 'vecthare_main',  // Always use main collection
                        queryVector,
                        topK,
                        filters: { type, sourceId }      // Filter by tenant
                    }),
                });

                if (response.ok) {
                    const data = await response.json();

                    // Filter by threshold
                    const filteredResults = data.results.filter(r => r.score >= threshold);

                    results[collectionId] = {
                        hashes: filteredResults.map(r => r.hash),
                        metadata: filteredResults.map(r => ({
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
        // MULTITENANCY: Extract type and sourceId from collectionId
        const { type, sourceId } = this._parseCollectionId(collectionId);

        const response = await fetch('/api/plugins/similharity/qdrant/purge', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'vecthare_main',  // Always use main collection
                filters: { type, sourceId }      // Purge specific tenant
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to purge collection: ${response.statusText}`);
        }

        console.log(`VectHare Qdrant: Purged vecthare_main (type: ${type}, sourceId: ${sourceId})`);
    }

    async purgeFileVectorIndex(collectionId, settings) {
        return this.purgeVectorIndex(collectionId, settings);
    }

    async purgeAllVectorIndexes(settings) {
        const response = await fetch('/api/plugins/similharity/qdrant/purge-all', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error(`Failed to purge all collections: ${response.statusText}`);
        }
    }
}
