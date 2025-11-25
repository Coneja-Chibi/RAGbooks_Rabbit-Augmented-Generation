/**
 * ============================================================================
 * LANCEDB BACKEND (Frontend Wrapper)
 * ============================================================================
 * Calls VectHare plugin's LanceDB endpoints for vector operations.
 * Provides disk-based, scalable vector storage for large collections.
 *
 * This backend communicates with the plugin's LanceDB implementation.
 * Requires the VectHare plugin to be installed.
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
} from '../core/core-vector-api.js';

export class LanceDBBackend extends VectorBackend {
    async initialize(settings) {
        // Initialize LanceDB backend via plugin
        const response = await fetch('/api/plugins/similharity/lancedb/init', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error(`Failed to initialize LanceDB: ${response.statusText}`);
        }

        console.log('VectHare: Using LanceDB backend (disk-based, scalable)');
    }

    async healthCheck() {
        try {
            const response = await fetch('/api/plugins/similharity/lancedb/health', {
                method: 'GET',
                headers: getRequestHeaders(),
            });

            if (!response.ok) return false;

            const data = await response.json();
            return data.healthy === true;
        } catch (error) {
            console.error('[LanceDB] Health check failed:', error);
            return false;
        }
    }

    async getSavedHashes(collectionId, settings) {
        const response = await fetch('/api/plugins/similharity/lancedb/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: collectionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to get saved hashes: ${response.statusText}`);
        }

        const data = await response.json();
        return data.hashes || [];
    }

    async insertVectorItems(collectionId, items, settings) {
        throwIfSourceInvalid(settings);

        if (items.length === 0) return;

        // Get embeddings for the items
        const texts = items.map(x => x.text);
        const args = await getAdditionalArgs(texts, settings);

        let itemsWithVectors;

        if (args.embeddings && Object.keys(args.embeddings).length > 0) {
            // Client-side embeddings (webllm, koboldcpp) - already have vectors
            itemsWithVectors = items.map(item => ({
                hash: item.hash,
                text: item.text,
                vector: args.embeddings[item.text],
                metadata: item.metadata || {},
            }));
        } else {
            // Server-side embeddings (transformers, openai, etc.) - use plugin's batch embedding endpoint
            console.log('VectHare LanceDB: Getting embeddings from server-side provider...');

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

            // Plugin returns {success, embeddings: Array}
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
            }));
        }

        // Insert into LanceDB via plugin
        const response = await fetch('/api/plugins/similharity/lancedb/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: collectionId,
                items: itemsWithVectors,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to insert vectors: ${response.statusText}`);
        }

        console.log(`VectHare LanceDB: Inserted ${items.length} vectors into ${collectionId}`);
    }

    async deleteVectorItems(collectionId, hashes, settings) {
        const response = await fetch('/api/plugins/similharity/lancedb/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: collectionId,
                hashes: hashes,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to delete vectors: ${response.statusText}`);
        }
    }

    async queryCollection(collectionId, searchText, topK, settings) {
        throwIfSourceInvalid(settings);

        // Get query vector
        const args = await getAdditionalArgs([searchText], settings);

        let queryVector;
        if (args.embeddings && args.embeddings[searchText]) {
            // Client-side embeddings
            queryVector = args.embeddings[searchText];
        } else {
            // Server-side embeddings - use plugin's embedding endpoint
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

        const response = await fetch('/api/plugins/similharity/lancedb/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: collectionId,
                queryVector: queryVector,
                topK: topK,
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

        // Get query vector (same logic as queryCollection)
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

        // Query each collection separately (LanceDB doesn't have multi-query yet)
        const results = {};

        for (const collectionId of collectionIds) {
            try {
                const response = await fetch('/api/plugins/similharity/lancedb/query', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        collectionId: collectionId,
                        queryVector: queryVector,
                        topK: topK,
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
        const response = await fetch('/api/plugins/similharity/lancedb/purge', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: collectionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to purge collection: ${response.statusText}`);
        }
    }

    async purgeFileVectorIndex(collectionId, settings) {
        // File collections are just collections in LanceDB
        return this.purgeVectorIndex(collectionId, settings);
    }

    async purgeAllVectorIndexes(settings) {
        const response = await fetch('/api/plugins/similharity/lancedb/purge-all', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error(`Failed to purge all collections: ${response.statusText}`);
        }
    }
}
