/**
 * ============================================================================
 * VECTHARE DIAGNOSTICS - CONFIGURATION
 * ============================================================================
 * Settings validation and configuration checks
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { getCurrentChatId, chat_metadata } from '../../../../../script.js';
import { getSavedHashes } from '../core/core-vector-api.js';
import { getChatCollectionId, getChatUUID, parseCollectionId } from '../core/chat-vectorization.js';
import { VALID_EMOTIONS, VALID_GENERATION_TYPES, validateConditionRule } from '../core/conditional-activation.js';
import { getTemporallyBlindCount, getTemporallyBlindChunks, isChunkTemporallyBlind, isCollectionEnabled } from '../core/collection-metadata.js';
import { getCollectionRegistry } from '../core/collection-loader.js';

/**
 * Check: RAG Query Status
 * Checks if there are ANY enabled collections (chat or otherwise)
 * that can be queried during generation.
 */
export function checkChatEnabled(settings) {
    const chatEnabled = settings.enabled_chats;
    const chatCollectionId = getChatCollectionId();

    // Count other enabled collections (not the current chat)
    const registry = getCollectionRegistry();
    let otherEnabledCount = 0;
    const otherEnabledNames = [];

    for (const registryKey of registry) {
        // Parse registry key to get collection ID
        let collectionId = registryKey;
        if (registryKey.includes(':')) {
            collectionId = registryKey.substring(registryKey.indexOf(':') + 1);
        }

        // Skip current chat collection (handled separately)
        if (collectionId === chatCollectionId) {
            continue;
        }

        if (isCollectionEnabled(registryKey)) {
            otherEnabledCount++;
            if (otherEnabledNames.length < 3) {
                otherEnabledNames.push(collectionId.substring(0, 20));
            }
        }
    }

    const hasAnyEnabled = chatEnabled || otherEnabledCount > 0;

    if (!hasAnyEnabled) {
        return {
            name: 'RAG Query Status',
            status: 'warning',
            message: 'No collections enabled for querying. Enable chat vectorization or enable other collections in the Database Browser.',
            fixable: true,
            fixAction: 'enable_chats'
        };
    }

    // Build status message
    const parts = [];
    if (chatEnabled) {
        parts.push('Chat: enabled');
    }
    if (otherEnabledCount > 0) {
        const names = otherEnabledNames.length < otherEnabledCount
            ? `${otherEnabledNames.join(', ')}... (+${otherEnabledCount - otherEnabledNames.length} more)`
            : otherEnabledNames.join(', ');
        parts.push(`Other collections: ${otherEnabledCount} enabled`);
    }

    return {
        name: 'RAG Query Status',
        status: 'pass',
        message: parts.join(' | ')
    };
}

/**
 * Check: Message chunk size
 */
export function checkChunkSize(settings) {
    const size = settings.message_chunk_size;

    if (size < 50) {
        return {
            name: 'Chunk Size',
            status: 'fail',
            message: `Chunk size too small (${size} chars). Minimum: 50`,
            fixable: true,
            fixAction: 'fix_chunk_size'
        };
    }

    if (size < 100) {
        return {
            name: 'Chunk Size',
            status: 'warning',
            message: `Chunk size is very small (${size} chars). Recommended: 200-800`
        };
    }

    if (size > 2000) {
        return {
            name: 'Chunk Size',
            status: 'warning',
            message: `Chunk size is very large (${size} chars). May cause context issues`
        };
    }

    return {
        name: 'Chunk Size',
        status: 'pass',
        message: `${size} characters`
    };
}

/**
 * Check: Score threshold validation
 */
export function checkScoreThreshold(settings) {
    const threshold = settings.score_threshold;

    if (threshold < 0 || threshold > 1) {
        return {
            name: 'Score Threshold',
            status: 'fail',
            message: `Invalid threshold (${threshold}). Must be 0.0-1.0`,
            fixable: true,
            fixAction: 'fix_threshold'
        };
    }

    if (threshold < 0.1) {
        return {
            name: 'Score Threshold',
            status: 'warning',
            message: `Very low threshold (${threshold}). May retrieve irrelevant results`
        };
    }

    if (threshold > 0.8) {
        return {
            name: 'Score Threshold',
            status: 'warning',
            message: `Very high threshold (${threshold}). May retrieve nothing`
        };
    }

    return {
        name: 'Score Threshold',
        status: 'pass',
        message: `${threshold}`
    };
}

/**
 * Check: Insert and query counts
 */
export function checkInsertQueryCounts(settings) {
    const insert = settings.insert;
    const query = settings.query;

    if (insert < 1 || query < 1) {
        return {
            name: 'Insert/Query Counts',
            status: 'fail',
            message: `Invalid counts (insert: ${insert}, query: ${query}). Must be >= 1`,
            fixable: true,
            fixAction: 'fix_counts'
        };
    }

    if (insert > 20 || query > 20) {
        return {
            name: 'Insert/Query Counts',
            status: 'warning',
            message: `High counts (insert: ${insert}, query: ${query}). May use too much context`
        };
    }

    return {
        name: 'Insert/Query Counts',
        status: 'pass',
        message: `Insert: ${insert}, Query: ${query}`
    };
}

/**
 * Check: Current chat has vectors
 */
export async function checkChatVectors(settings) {
    if (!getCurrentChatId()) {
        return {
            name: 'Chat Vectors',
            status: 'warning',
            message: 'No chat selected'
        };
    }

    try {
        const collectionId = getChatCollectionId();
        if (!collectionId) {
            return {
                name: 'Chat Vectors',
                status: 'warning',
                message: 'Could not get collection ID'
            };
        }
        const hashes = await getSavedHashes(collectionId, settings);
        if (hashes.length === 0) {
            return {
                name: 'Chat Vectors',
                status: 'warning',
                message: 'Current chat has no vectorized chunks',
                fixable: true,
                fixAction: 'vectorize_all'
            };
        }
        return {
            name: 'Chat Vectors',
            status: 'pass',
            message: `${hashes.length} vectorized chunks`
        };
    } catch (error) {
        return {
            name: 'Chat Vectors',
            status: 'fail',
            message: `Failed to check vectors: ${error.message}`
        };
    }
}

/**
 * Check: Temporal decay system status
 * Note: Temporal decay is now per-collection (chat collections enabled by default)
 */
export function checkTemporalDecaySettings(settings) {
    // Check for temporally blind chunks
    const blindCount = getTemporallyBlindCount();

    return {
        name: 'Temporal Decay',
        status: 'pass',
        message: `Per-collection decay active. ${blindCount} chunk(s) temporally blind.`
    };
}

/**
 * Check: Temporally blind chunks integrity
 */
export async function checkTemporallyBlindChunks(settings) {
    if (!getCurrentChatId()) {
        return {
            name: 'Temporally Blind Chunks',
            status: 'pass',
            message: 'No chat selected - cannot verify',
            category: 'configuration'
        };
    }

    try {
        const blindChunks = getTemporallyBlindChunks();
        const blindCount = blindChunks.length;

        if (blindCount === 0) {
            return {
                name: 'Temporally Blind Chunks',
                status: 'pass',
                message: 'No chunks marked as temporally blind',
                category: 'configuration'
            };
        }

        // Check if any blind chunks exist in current chat's vectors
        const collectionId = getChatCollectionId();
        if (!collectionId) {
            return {
                name: 'Temporally Blind Chunks',
                status: 'warning',
                message: 'Could not get collection ID',
                category: 'configuration'
            };
        }
        const hashes = await getSavedHashes(collectionId, settings);
        const blindInChat = blindChunks.filter(hash => hashes.includes(parseInt(hash)));

        return {
            name: 'Temporally Blind Chunks',
            status: 'pass',
            message: `${blindCount} total blind chunk(s), ${blindInChat.length} in current chat`,
            category: 'configuration'
        };
    } catch (error) {
        return {
            name: 'Temporally Blind Chunks',
            status: 'warning',
            message: `Could not verify: ${error.message}`,
            category: 'configuration'
        };
    }
}

/**
 * Check: Chunk visualizer API readiness
 * Verifies the visualizer can perform edit/delete operations
 */
export function checkVisualizerApiReadiness(settings) {
    const checks = [];

    // Check if settings are valid for API operations
    if (!settings) {
        return {
            name: 'Visualizer API',
            status: 'fail',
            message: 'No settings available for visualizer operations',
            category: 'configuration'
        };
    }

    // Check for required source configuration
    if (!settings.source) {
        return {
            name: 'Visualizer API',
            status: 'fail',
            message: 'No embedding source configured - cannot create/edit vectors',
            category: 'configuration'
        };
    }

    // Check backend configuration
    if (!settings.db) {
        return {
            name: 'Visualizer API',
            status: 'warning',
            message: 'No backend database specified (using default)',
            category: 'configuration'
        };
    }

    return {
        name: 'Visualizer API',
        status: 'pass',
        message: `Ready for vector operations (source: ${settings.source}, db: ${settings.db || 'standard'})`,
        category: 'configuration'
    };
}

/**
 * Check: Collection ID format and UUID availability
 * Verifies that chat_metadata.integrity is available for unique collection IDs
 */
export function checkCollectionIdFormat() {
    if (!getCurrentChatId()) {
        return {
            name: 'Collection ID Format',
            status: 'pass',
            message: 'No chat selected - cannot verify UUID',
            category: 'configuration'
        };
    }

    // Check if chat_metadata.integrity is available
    const integrity = chat_metadata?.integrity;
    const uuid = getChatUUID();
    const collectionId = getChatCollectionId();

    if (!integrity) {
        // Using fallback
        return {
            name: 'Collection ID Format',
            status: 'warning',
            message: `Using chatId fallback (integrity UUID not available). Collection: ${collectionId || 'null'}`,
            category: 'configuration'
        };
    }

    // Verify collection ID format
    const parsed = parseCollectionId(collectionId);
    if (!parsed) {
        return {
            name: 'Collection ID Format',
            status: 'fail',
            message: `Invalid collection ID format: ${collectionId}`,
            category: 'configuration'
        };
    }

    if (parsed.prefix !== 'vh') {
        return {
            name: 'Collection ID Format',
            status: 'fail',
            message: `Collection ID missing 'vh' prefix: ${collectionId}`,
            category: 'configuration'
        };
    }

    // UUID format check (should be like a1b2c3d4-e5f6-7890-abcd-ef1234567890)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isValidUUID = uuidRegex.test(parsed.sourceId);

    return {
        name: 'Collection ID Format',
        status: 'pass',
        message: `${parsed.type}:${parsed.sourceId.substring(0, 8)}... (${isValidUUID ? 'UUID' : 'fallback ID'})`,
        category: 'configuration'
    };
}

/**
 * Check: Conditional activation module is available
 */
export function checkConditionalActivationModule() {
    try {
        if (!VALID_EMOTIONS || VALID_EMOTIONS.length === 0) {
            return {
                name: 'Conditional Activation',
                status: 'fail',
                message: 'VALID_EMOTIONS not loaded correctly',
                category: 'configuration'
            };
        }

        if (!VALID_GENERATION_TYPES || VALID_GENERATION_TYPES.length === 0) {
            return {
                name: 'Conditional Activation',
                status: 'fail',
                message: 'VALID_GENERATION_TYPES not loaded correctly',
                category: 'configuration'
            };
        }

        if (typeof validateConditionRule !== 'function') {
            return {
                name: 'Conditional Activation',
                status: 'fail',
                message: 'Validation functions not available',
                category: 'configuration'
            };
        }

        return {
            name: 'Conditional Activation',
            status: 'pass',
            message: `Module loaded (${VALID_EMOTIONS.length} emotions, ${VALID_GENERATION_TYPES.length} gen types)`,
            category: 'configuration'
        };
    } catch (error) {
        return {
            name: 'Conditional Activation',
            status: 'fail',
            message: `Module error: ${error.message}`,
            category: 'configuration'
        };
    }
}

/**
 * Check: Hash collision rate in current chat
 * This is INFORMATIONAL - collisions are intentional semantic deduplication.
 * High collision rate (>10%) may indicate repetitive conversations or chunking misconfiguration.
 */
export async function checkHashCollisionRate(settings) {
    if (!getCurrentChatId()) {
        return {
            name: 'Hash Collision Rate',
            status: 'pass',
            message: 'No chat selected',
            category: 'configuration'
        };
    }

    try {
        const collectionId = getChatCollectionId();
        if (!collectionId) {
            return {
                name: 'Hash Collision Rate',
                status: 'pass',
                message: 'Could not get collection ID',
                category: 'configuration'
            };
        }

        const hashes = await getSavedHashes(collectionId, settings);
        if (hashes.length === 0) {
            return {
                name: 'Hash Collision Rate',
                status: 'pass',
                message: 'No chunks to analyze',
                category: 'configuration'
            };
        }

        // Count unique hashes
        const uniqueHashes = new Set(hashes);
        const totalChunks = hashes.length;
        const uniqueCount = uniqueHashes.size;
        const duplicates = totalChunks - uniqueCount;
        const collisionRate = duplicates / totalChunks;

        // Collision is EXPECTED behavior (semantic deduplication)
        // Only warn if rate is very high (suggests repetitive content or misconfiguration)
        if (collisionRate > 0.15) {
            return {
                name: 'Hash Collision Rate',
                status: 'warning',
                message: `High deduplication: ${(collisionRate * 100).toFixed(1)}% (${duplicates}/${totalChunks} chunks). Chat may have very repetitive content.`,
                category: 'configuration'
            };
        }

        if (duplicates > 0) {
            return {
                name: 'Hash Collision Rate',
                status: 'pass',
                message: `${uniqueCount} unique chunks, ${duplicates} deduplicated (${(collisionRate * 100).toFixed(1)}% - normal)`,
                category: 'configuration'
            };
        }

        return {
            name: 'Hash Collision Rate',
            status: 'pass',
            message: `${uniqueCount} chunks, all unique hashes`,
            category: 'configuration'
        };
    } catch (error) {
        return {
            name: 'Hash Collision Rate',
            status: 'warning',
            message: `Could not analyze: ${error.message}`,
            category: 'configuration'
        };
    }
}
