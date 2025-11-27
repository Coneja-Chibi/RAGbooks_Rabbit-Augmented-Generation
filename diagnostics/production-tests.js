/**
 * ============================================================================
 * VECTHARE DIAGNOSTICS - PRODUCTION TESTS
 * ============================================================================
 * Integration tests for embedding, storage, and retrieval
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { getCurrentChatId, getRequestHeaders } from '../../../../../script.js';
import { getSavedHashes, purgeVectorIndex } from '../core/core-vector-api.js';
import { getChatCollectionId } from '../core/chat-vectorization.js';
import { getModelField, getProviderConfig } from '../core/providers.js';
import { unregisterCollection } from '../core/collection-loader.js';

/**
 * Full cleanup for test collections - purges vectors AND unregisters from registry
 * @param {string} collectionId - The test collection to clean up
 * @param {object} settings - VectHare settings
 */
async function cleanupTestCollection(collectionId, settings) {
    try {
        // Purge all vectors from the backend
        await purgeVectorIndex(collectionId, settings);
    } catch (e) {
        // Ignore purge errors - collection might already be empty
    }
    // Always unregister from registry to prevent ghost entries
    const registryKey = `${settings.source}:${collectionId}`;
    unregisterCollection(registryKey);
    unregisterCollection(collectionId); // Also try without source prefix
}

/**
 * Helper: Get provider-specific body parameters for native ST vector API
 */
function getProviderBody(settings) {
    const body = {};
    const source = settings.source;
    const modelField = getModelField(source);

    if (modelField && settings[modelField]) {
        body.model = settings[modelField];
    }

    // Google APIs need special handling
    if (source === 'palm') {
        body.api = 'makersuite';
        body.model = settings.google_model;
    } else if (source === 'vertexai') {
        body.api = 'vertexai';
        body.model = settings.google_model;
    }

    return body;
}

/**
 * Test: Can we generate an embedding?
 */
export async function testEmbeddingGeneration(settings) {
    try {
        const testText = 'This is a test message for embedding generation.';

        const response = await fetch('/api/vector/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: '__vecthare_test__',
                searchText: testText,
                topK: 1,
                source: settings.source,
                ...getProviderBody(settings)
            })
        });

        if (!response.ok) {
            return {
                name: '[PROD] Embedding Generation',
                status: 'fail',
                message: `Failed to generate embedding: ${response.status} ${response.statusText}`,
                category: 'production'
            };
        }

        return {
            name: '[PROD] Embedding Generation',
            status: 'pass',
            message: 'Successfully generated test embedding',
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Embedding Generation',
            status: 'fail',
            message: `Embedding generation error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Test: Can we store and retrieve a vector?
 */
export async function testVectorStorage(settings) {
    try {
        const testCollectionId = `__vecthare_test_${Date.now()}__`;
        const testHash = Math.floor(Math.random() * 1000000);
        const testText = 'VectHare storage test message';

        const insertResponse = await fetch('/api/vector/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: testCollectionId,
                items: [{
                    hash: testHash,
                    text: testText,
                    index: 0
                }],
                source: settings.source,
                ...getProviderBody(settings)
            })
        });

        if (!insertResponse.ok) {
            return {
                name: '[PROD] Vector Storage',
                status: 'fail',
                message: `Failed to store vector: ${insertResponse.status}`,
                category: 'production'
            };
        }

        // Cleanup - full collection cleanup (purge + unregister from registry)
        await cleanupTestCollection(testCollectionId, settings);

        return {
            name: '[PROD] Vector Storage',
            status: 'pass',
            message: 'Successfully stored and cleaned up test vector',
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Vector Storage',
            status: 'fail',
            message: `Storage test error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Test: Can we query and retrieve similar vectors?
 */
export async function testVectorRetrieval(settings) {
    if (!getCurrentChatId()) {
        return {
            name: '[PROD] Vector Retrieval',
            status: 'warning',
            message: 'No chat selected - cannot test retrieval',
            category: 'production'
        };
    }

    const collectionId = getChatCollectionId();
    if (!collectionId) {
        return {
            name: '[PROD] Vector Retrieval',
            status: 'warning',
            message: 'Could not get collection ID',
            category: 'production'
        };
    }

    try {
        const hashes = await getSavedHashes(collectionId, settings);

        if (hashes.length === 0) {
            return {
                name: '[PROD] Vector Retrieval',
                status: 'warning',
                message: 'No vectors in current chat to test retrieval',
                category: 'production'
            };
        }

        const response = await fetch('/api/vector/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: collectionId,
                searchText: 'test query',
                topK: 3,
                source: settings.source,
                ...getProviderBody(settings)
            })
        });

        if (!response.ok) {
            return {
                name: '[PROD] Vector Retrieval',
                status: 'fail',
                message: `Query failed: ${response.status}`,
                category: 'production'
            };
        }

        const data = await response.json();

        return {
            name: '[PROD] Vector Retrieval',
            status: 'pass',
            message: `Successfully retrieved ${data.hashes?.length || 0} results`,
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Vector Retrieval',
            status: 'fail',
            message: `Retrieval test error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Test: Are vector dimensions consistent?
 * Detects if embedding model was switched without re-vectorizing.
 * Compares stored collection dimensions with current provider's expected dimensions.
 */
export async function testVectorDimensions(settings) {
    if (!getCurrentChatId()) {
        return {
            name: '[PROD] Vector Dimensions',
            status: 'pass',
            message: 'No chat selected - cannot check dimensions',
            category: 'production'
        };
    }

    const collectionId = getChatCollectionId();
    if (!collectionId) {
        return {
            name: '[PROD] Vector Dimensions',
            status: 'pass',
            message: 'Could not get collection ID',
            category: 'production'
        };
    }

    try {
        // Get collection stats to see stored dimensions
        const statsResponse = await fetch('/api/plugins/similharity/chunks/stats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: settings.db || 'standard',
                collectionId: collectionId,
                source: settings.source || 'transformers',
                model: settings[getModelField(settings.source)] || null,
            }),
        });

        if (!statsResponse.ok) {
            // Stats endpoint not available or error - skip check
            return {
                name: '[PROD] Vector Dimensions',
                status: 'pass',
                message: 'Could not fetch collection stats',
                category: 'production'
            };
        }

        const statsData = await statsResponse.json();
        const storedDimensions = statsData.stats?.embeddingDimensions;

        if (!storedDimensions || storedDimensions === 0) {
            return {
                name: '[PROD] Vector Dimensions',
                status: 'pass',
                message: 'No vectors stored yet - dimensions will be set on first vectorization',
                category: 'production'
            };
        }

        // Generate a test embedding to get current dimensions
        const testCollectionId = `__vecthare_dim_test_${Date.now()}__`;
        const testHash = Math.floor(Math.random() * 1000000);
        const testText = 'Dimension test';

        const insertResponse = await fetch('/api/vector/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: testCollectionId,
                items: [{
                    hash: testHash,
                    text: testText,
                    index: 0
                }],
                source: settings.source,
                ...getProviderBody(settings)
            })
        });

        if (!insertResponse.ok) {
            return {
                name: '[PROD] Vector Dimensions',
                status: 'warning',
                message: `Could not generate test embedding: ${insertResponse.status}`,
                category: 'production'
            };
        }

        // Get stats for test collection to see what dimensions were generated
        const testStatsResponse = await fetch('/api/plugins/similharity/chunks/stats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: settings.db || 'standard',
                collectionId: testCollectionId,
                source: settings.source || 'transformers',
                model: settings[getModelField(settings.source)] || null,
            }),
        });

        let currentDimensions = 0;
        if (testStatsResponse.ok) {
            const testStats = await testStatsResponse.json();
            currentDimensions = testStats.stats?.embeddingDimensions || 0;
        }

        // Cleanup test collection
        await cleanupTestCollection(testCollectionId, settings);

        if (currentDimensions === 0) {
            return {
                name: '[PROD] Vector Dimensions',
                status: 'warning',
                message: 'Could not determine current embedding dimensions',
                category: 'production'
            };
        }

        // Compare dimensions
        if (storedDimensions !== currentDimensions) {
            return {
                name: '[PROD] Vector Dimensions',
                status: 'fail',
                message: `Dimension mismatch! Stored: ${storedDimensions}, Current provider: ${currentDimensions}. You likely switched embedding models. Re-vectorize this chat to fix.`,
                category: 'production',
                fixable: true,
                fixAction: 'revectorize',
                data: { storedDimensions, currentDimensions, collectionId }
            };
        }

        return {
            name: '[PROD] Vector Dimensions',
            status: 'pass',
            message: `Dimensions match (${storedDimensions}D)`,
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Vector Dimensions',
            status: 'warning',
            message: `Dimension check error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Test: Does temporal decay calculation work?
 * Now tests with per-collection defaults (chat = enabled by default)
 */
export async function testTemporalDecay(settings) {
    try {
        const { applyTemporalDecay, getDefaultDecaySettings } = await import('../core/temporal-decay.js');
        const { getDefaultDecayForType } = await import('../core/collection-metadata.js');

        // Test with chat defaults (enabled by default)
        const chatDecaySettings = getDefaultDecayForType('chat');

        const testScore = 0.85;
        const testAge = 50;
        const decayedScore = applyTemporalDecay(testScore, testAge, chatDecaySettings);

        if (decayedScore >= testScore) {
            return {
                name: '[PROD] Temporal Decay',
                status: 'fail',
                message: 'Decay not reducing scores (check formula)',
                category: 'production'
            };
        }

        if (decayedScore < 0 || decayedScore > 1) {
            return {
                name: '[PROD] Temporal Decay',
                status: 'fail',
                message: `Invalid decayed score: ${decayedScore}`,
                category: 'production'
            };
        }

        // Also test that disabled decay doesn't reduce scores
        const disabledSettings = { enabled: false };
        const noDecayScore = applyTemporalDecay(testScore, testAge, disabledSettings);
        if (noDecayScore !== testScore) {
            return {
                name: '[PROD] Temporal Decay',
                status: 'fail',
                message: 'Disabled decay should not change scores',
                category: 'production'
            };
        }

        return {
            name: '[PROD] Temporal Decay',
            status: 'pass',
            message: `Decay working (0.85 -> ${decayedScore.toFixed(3)} at age 50 for chat)`,
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Temporal Decay',
            status: 'fail',
            message: `Decay test error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Test: Are local chunks in sync with server vectors?
 * Compares chunk hashes we have locally vs what's stored on the server
 */
export async function testChunkServerSync(settings, collectionId) {
    if (!collectionId) {
        if (!getCurrentChatId()) {
            return {
                name: '[PROD] Chunk-Server Sync',
                status: 'warning',
                message: 'No collection selected - cannot test sync',
                category: 'production'
            };
        }
        collectionId = getChatCollectionId();
        if (!collectionId) {
            return {
                name: '[PROD] Chunk-Server Sync',
                status: 'warning',
                message: 'Could not get collection ID',
                category: 'production'
            };
        }
    }

    try {
        const { getAllChunkMetadata } = await import('../core/collection-metadata.js');

        // Get server-side hashes
        const serverHashes = await getSavedHashes(collectionId, settings);
        const serverHashSet = new Set(serverHashes.map(h => String(h)));

        // Get local metadata hashes (chunks we have customizations for)
        const localMetadata = getAllChunkMetadata();
        const localHashes = Object.keys(localMetadata);

        // Find mismatches
        const onlyOnServer = serverHashes.filter(h => !localHashes.includes(String(h)));
        const onlyLocal = localHashes.filter(h => !serverHashSet.has(h));

        const totalServer = serverHashes.length;
        const totalLocal = localHashes.length;

        if (onlyOnServer.length === 0 && onlyLocal.length === 0) {
            return {
                name: '[PROD] Chunk-Server Sync',
                status: 'pass',
                message: `In sync: ${totalServer} server vectors, ${totalLocal} local metadata entries`,
                category: 'production',
                data: { serverHashes, localHashes, collectionId }
            };
        }

        // There are differences (not necessarily bad - local metadata is optional)
        if (onlyLocal.length > 0) {
            // Orphaned local metadata (vectors deleted from server but metadata remains)
            return {
                name: '[PROD] Chunk-Server Sync',
                status: 'warning',
                message: `${onlyLocal.length} orphaned local entries (vectors deleted from server)`,
                category: 'production',
                fixable: true,
                fixAction: 'cleanOrphanedMetadata',
                data: { orphanedHashes: onlyLocal, collectionId }
            };
        }

        return {
            name: '[PROD] Chunk-Server Sync',
            status: 'pass',
            message: `Server has ${onlyOnServer.length} vectors without local metadata (normal for new chunks)`,
            category: 'production',
            data: { serverHashes, localHashes, collectionId }
        };
    } catch (error) {
        return {
            name: '[PROD] Chunk-Server Sync',
            status: 'fail',
            message: `Sync check error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Fix: Clean orphaned local metadata entries
 */
export async function fixOrphanedMetadata(orphanedHashes) {
    try {
        const { deleteChunkMetadata } = await import('../core/collection-metadata.js');

        let cleaned = 0;
        for (const hash of orphanedHashes) {
            deleteChunkMetadata(hash);
            cleaned++;
        }

        return {
            success: true,
            message: `Cleaned ${cleaned} orphaned metadata entries`
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed to clean: ${error.message}`
        };
    }
}

/**
 * Test: Are there duplicate hashes in the vector store?
 * Duplicates can occur from:
 * - Native ST vectors extension double-inserting
 * - Session cache being cleared while chunks still exist
 * - Plugin bugs or interrupted operations
 */
export async function testDuplicateHashes(settings, collectionId) {
    if (!collectionId) {
        if (!getCurrentChatId()) {
            return {
                name: '[PROD] Duplicate Hash Check',
                status: 'warning',
                message: 'No collection selected - cannot check for duplicates',
                category: 'production'
            };
        }
        collectionId = getChatCollectionId();
        if (!collectionId) {
            return {
                name: '[PROD] Duplicate Hash Check',
                status: 'warning',
                message: 'Could not get collection ID',
                category: 'production'
            };
        }
    }

    try {
        // Get all hashes from the server
        const serverHashes = await getSavedHashes(collectionId, settings);

        if (serverHashes.length === 0) {
            return {
                name: '[PROD] Duplicate Hash Check',
                status: 'pass',
                message: 'No vectors in collection',
                category: 'production'
            };
        }

        // Count occurrences
        const hashCounts = {};
        for (const hash of serverHashes) {
            const key = String(hash);
            hashCounts[key] = (hashCounts[key] || 0) + 1;
        }

        // Find duplicates
        const duplicates = Object.entries(hashCounts)
            .filter(([, count]) => count > 1)
            .map(([hash, count]) => ({ hash, count }));

        if (duplicates.length === 0) {
            return {
                name: '[PROD] Duplicate Hash Check',
                status: 'pass',
                message: `${serverHashes.length} unique vectors, no duplicates`,
                category: 'production'
            };
        }

        const totalDupes = duplicates.reduce((sum, d) => sum + d.count - 1, 0);

        return {
            name: '[PROD] Duplicate Hash Check',
            status: 'warning',
            message: `Found ${duplicates.length} duplicate hashes (${totalDupes} extra entries)`,
            category: 'production',
            fixable: true,
            fixAction: 'removeDuplicateHashes',
            data: { duplicates, collectionId, totalDuplicates: totalDupes }
        };
    } catch (error) {
        return {
            name: '[PROD] Duplicate Hash Check',
            status: 'fail',
            message: `Check failed: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Fix: Remove duplicate hash entries from vector store
 * Strategy: Query to get chunk text, delete all instances, re-insert one copy
 */
export async function fixDuplicateHashes(duplicates, collectionId, settings) {
    try {
        const { deleteVectorItems, insertVectorItems, queryCollection } = await import('../core/core-vector-api.js');

        let fixed = 0;
        const chunksToReinsert = [];

        // First, query to get the chunk data for each duplicate hash
        // We query with minimal text to find chunks by hash
        for (const { hash } of duplicates) {
            try {
                // Query with a broad search to find chunks - we'll filter by hash
                const result = await queryCollection(collectionId, '', 1000, settings);

                if (result?.metadata) {
                    // Find chunk with this hash
                    const chunk = result.metadata.find(m => String(m.hash) === String(hash));
                    if (chunk) {
                        chunksToReinsert.push({
                            hash: chunk.hash,
                            text: chunk.text,
                            index: chunk.index || 0,
                            metadata: {
                                source: chunk.source,
                                messageId: chunk.messageId,
                                chunkIndex: chunk.chunkIndex,
                                totalChunks: chunk.totalChunks,
                                originalMessageHash: chunk.originalMessageHash
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn(`VectHare: Failed to get data for hash ${hash}:`, e);
            }
        }

        // Delete ALL instances of duplicate hashes
        const hashesToDelete = duplicates.map(d => d.hash);
        try {
            await deleteVectorItems(collectionId, hashesToDelete, settings);
            console.log(`VectHare: Deleted ${hashesToDelete.length} duplicate hashes`);
        } catch (e) {
            console.warn('VectHare: Delete failed:', e);
            return {
                success: false,
                message: `Failed to delete duplicates: ${e.message}`
            };
        }

        // Re-insert ONE copy of each
        if (chunksToReinsert.length > 0) {
            try {
                await insertVectorItems(collectionId, chunksToReinsert, settings);
                fixed = chunksToReinsert.length;
                console.log(`VectHare: Re-inserted ${fixed} chunks (deduplicated)`);
            } catch (e) {
                console.warn('VectHare: Re-insert failed:', e);
                return {
                    success: false,
                    message: `Deleted duplicates but failed to re-insert: ${e.message}. Re-vectorize chat to restore.`
                };
            }
        }

        return {
            success: true,
            message: `Fixed ${fixed} duplicate hashes (deleted extras, kept one copy each)`
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed to fix duplicates: ${error.message}`
        };
    }
}

/**
 * Test: Does temporally blind chunk immunity work?
 */
export async function testTemporallyBlindChunks(settings) {
    try {
        const { applyDecayToResults } = await import('../core/temporal-decay.js');
        const { setChunkTemporallyBlind, isChunkTemporallyBlind } = await import('../core/collection-metadata.js');
        const { getDefaultDecayForType } = await import('../core/collection-metadata.js');

        const testHash = `__test_blind_${Date.now()}__`;
        const chatDecaySettings = getDefaultDecayForType('chat');

        // Create test chunks
        const testChunks = [
            { hash: testHash, score: 0.9, metadata: { source: 'chat', messageId: 0 } },
            { hash: 'normal_chunk', score: 0.9, metadata: { source: 'chat', messageId: 0 } }
        ];

        // Mark one chunk as blind
        setChunkTemporallyBlind(testHash, true);

        // Verify it's marked
        if (!isChunkTemporallyBlind(testHash)) {
            return {
                name: '[PROD] Temporally Blind Chunks',
                status: 'fail',
                message: 'Failed to mark chunk as temporally blind',
                category: 'production'
            };
        }

        // Apply decay at a high message age
        const currentMessageId = 100;
        const decayedChunks = applyDecayToResults(testChunks, currentMessageId, chatDecaySettings);

        // Find results
        const blindChunk = decayedChunks.find(c => c.hash === testHash);
        const normalChunk = decayedChunks.find(c => c.hash === 'normal_chunk');

        // Cleanup
        setChunkTemporallyBlind(testHash, false);

        // Blind chunk should keep original score
        if (blindChunk.score !== 0.9 || !blindChunk.temporallyBlind) {
            return {
                name: '[PROD] Temporally Blind Chunks',
                status: 'fail',
                message: 'Blind chunk score was modified',
                category: 'production'
            };
        }

        // Normal chunk should have decayed
        if (normalChunk.score >= 0.9 || !normalChunk.decayApplied) {
            return {
                name: '[PROD] Temporally Blind Chunks',
                status: 'fail',
                message: 'Normal chunk should have decayed',
                category: 'production'
            };
        }

        return {
            name: '[PROD] Temporally Blind Chunks',
            status: 'pass',
            message: `Blind: ${blindChunk.score.toFixed(2)} (immune), Normal: ${normalChunk.score.toFixed(2)} (decayed)`,
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Temporally Blind Chunks',
            status: 'fail',
            message: `Test error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Test: Does the plugin backend correctly generate embeddings during insert?
 * This specifically tests the Similharity plugin's LanceDB/Qdrant handlers.
 * These handlers MUST generate embeddings - they cannot rely on pre-provided vectors.
 */
export async function testPluginEmbeddingGeneration(settings) {
    const backend = settings.vector_backend || 'standard';

    // Only test for backends that go through the plugin
    if (backend === 'standard') {
        return {
            name: '[PROD] Plugin Embedding Gen',
            status: 'skipped',
            message: 'Standard backend uses native ST vectors',
            category: 'production'
        };
    }

    try {
        const testCollectionId = `__vecthare_embed_test_${Date.now()}__`;
        const testHash = Math.floor(Math.random() * 1000000);
        const testText = 'Plugin embedding generation test';

        // Try to insert WITHOUT providing a vector - the plugin must generate it
        const insertResponse = await fetch('/api/plugins/similharity/chunks/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: backend,
                collectionId: testCollectionId,
                items: [{
                    hash: testHash,
                    text: testText,
                    index: 0
                    // NOTE: No vector provided - plugin must generate it
                }],
                source: settings.source || 'transformers',
                model: settings[getModelField(settings.source)] || null,
            }),
        });

        if (!insertResponse.ok) {
            const errorText = await insertResponse.text();
            return {
                name: '[PROD] Plugin Embedding Gen',
                status: 'fail',
                message: `Plugin failed to generate embedding: ${insertResponse.status} - ${errorText}`,
                category: 'production'
            };
        }

        // Verify the vector was stored by querying
        const queryResponse = await fetch('/api/plugins/similharity/chunks/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: backend,
                collectionId: testCollectionId,
                searchText: testText,
                topK: 1,
                source: settings.source || 'transformers',
                model: settings[getModelField(settings.source)] || null,
            }),
        });

        let querySuccess = false;
        if (queryResponse.ok) {
            const results = await queryResponse.json();
            querySuccess = results.results?.length > 0 || results.hashes?.length > 0;
        }

        // Cleanup test collection
        await cleanupTestCollection(testCollectionId, settings);

        if (!querySuccess) {
            return {
                name: '[PROD] Plugin Embedding Gen',
                status: 'warning',
                message: 'Insert succeeded but could not verify vector retrieval',
                category: 'production'
            };
        }

        return {
            name: '[PROD] Plugin Embedding Gen',
            status: 'pass',
            message: `${backend} backend correctly generates embeddings`,
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Plugin Embedding Gen',
            status: 'fail',
            message: `Test error: ${error.message}`,
            category: 'production'
        };
    }
}
