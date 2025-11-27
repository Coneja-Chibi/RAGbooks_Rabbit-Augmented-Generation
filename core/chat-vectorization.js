/**
 * ============================================================================
 * VECTHARE CHAT VECTORIZATION
 * ============================================================================
 * Core logic for vectorizing chat messages and retrieving relevant context
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { getCurrentChatId, is_send_press, setExtensionPrompt, substituteParams, chat_metadata, extension_prompts } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { getStringHash as calculateHash, waitUntilCondition, onlyUnique, splitRecursive } from '../../../../utils.js';
import {
    getSavedHashes,
    insertVectorItems,
    queryCollection,
    queryActiveCollections,
    deleteVectorItems,
    purgeVectorIndex,
} from './core-vector-api.js';
import { isBackendAvailable } from '../backends/backend-manager.js';
import { applyDecayToResults, applySceneAwareDecay } from './temporal-decay.js';
import { isChunkDisabledByScene } from './scenes.js';
import { registerCollection, getCollectionRegistry } from './collection-loader.js';
import { isCollectionEnabled, filterActiveCollections } from './collection-metadata.js';
import { progressTracker } from '../ui/progress-tracker.js';
import { buildSearchContext, filterChunksByConditions } from './conditional-activation.js';
import { getChunkMetadata } from './collection-metadata.js';
import { createDebugData, setLastSearchDebug, addTrace, recordChunkFate } from '../ui/search-debug.js';
import { Queue, LRUCache } from '../utils/data-structures.js';
import { getRequestHeaders } from '../../../../../script.js';

const EXTENSION_PROMPT_TAG = '3_vecthare';

// Hash cache for performance (LRU with 10k capacity)
const hashCache = new LRUCache(10000);

// Synchronization state
let syncBlocked = false;

/**
 * VectHare Collection ID Format: vh:{type}:{uuid}
 *
 * Uses chat_metadata.integrity UUID for guaranteed uniqueness.
 * Same character with multiple chats = different UUIDs = separate vector stores.
 *
 * Examples:
 *   vh:chat:a1b2c3d4-e5f6-7890-abcd-ef1234567890
 *   vh:lorebook:world_info_12345
 *   vh:doc:character_card_67890
 */

const VH_PREFIX = 'vh';

/**
 * Builds a proper collection ID for multitenancy
 * Format: vh:{type}:{sourceId}
 * @param {string} type Collection type (chat, lorebook, doc, etc)
 * @param {string} sourceId Source identifier (UUID, lorebook uid, etc)
 * @returns {string} Properly formatted collection ID
 */
function buildCollectionId(type, sourceId) {
    return `${VH_PREFIX}:${type}:${sourceId}`;
}

/**
 * Gets the unique chat UUID from chat_metadata.integrity
 * Falls back to chatId if integrity not available (shouldn't happen)
 * @returns {string|null} Chat UUID or null if no chat
 */
export function getChatUUID() {
    const integrity = chat_metadata?.integrity;
    if (integrity) {
        return integrity;
    }
    // Fallback: use chatId (less ideal but works)
    const chatId = getCurrentChatId();
    if (chatId) {
        console.warn('VectHare: chat_metadata.integrity not found, falling back to chatId');
        return chatId;
    }
    return null;
}

/**
 * Builds chat collection ID using the chat's unique UUID
 * @param {string} [chatUUID] Optional UUID override, otherwise uses current chat
 * @returns {string|null} Collection ID or null if no chat
 */
export function getChatCollectionId(chatUUID) {
    const uuid = chatUUID || getChatUUID();
    if (!uuid) {
        return null;
    }
    return buildCollectionId('chat', uuid);
}

/**
 * Builds lorebook collection ID
 * @param {string} lorebookUid Lorebook UID
 * @returns {string} Properly formatted collection ID
 */
export function getLorebookCollectionId(lorebookUid) {
    return buildCollectionId('lorebook', lorebookUid);
}

/**
 * Builds document collection ID
 * @param {string} documentId Document identifier
 * @returns {string} Properly formatted collection ID
 */
export function getDocumentCollectionId(documentId) {
    return buildCollectionId('doc', documentId);
}

/**
 * Parses a VectHare collection ID
 * @param {string} collectionId Collection ID to parse
 * @returns {{prefix: string, type: string, sourceId: string}|null} Parsed parts or null if invalid
 */
export function parseCollectionId(collectionId) {
    if (!collectionId || typeof collectionId !== 'string') {
        return null;
    }
    const parts = collectionId.split(':');
    if (parts.length >= 3 && parts[0] === VH_PREFIX) {
        return {
            prefix: parts[0],
            type: parts[1],
            sourceId: parts.slice(2).join(':') // Handle UUIDs with colons
        };
    }
    return null;
}

/**
 * Gets the hash value for a string (with LRU caching)
 * @param {string} str Input string
 * @returns {number} Hash value
 */
function getStringHash(str) {
    const cached = hashCache.get(str);
    if (cached !== undefined) {
        return cached;
    }
    const hash = calculateHash(str);
    hashCache.set(str, hash);
    return hash;
}

/**
 * Gets message text without file attachments
 * Matches behavior of ST vectors extension for hash compatibility
 * @param {object} message Chat message object
 * @returns {string} Message text without attachment prefix
 */
function getTextWithoutAttachments(message) {
    const fileLength = message?.extra?.fileLength || 0;
    return String(message?.mes || '').substring(fileLength).trim();
}

/**
 * Gets chunk delimiters for splitting text
 * @returns {string[]} Array of delimiters
 */
function getChunkDelimiters() {
    return ['\n\n', '\n', ' ', ''];
}

/**
 * Splits messages into chunks
 * @param {object[]} items Array of vector items
 * @param {number} chunkSize Maximum chunk size in characters
 * @returns {object[]} Chunked items
 */
function splitByChunks(items, chunkSize) {
    if (chunkSize <= 0) {
        return items;
    }

    const chunkedItems = [];
    for (const item of items) {
        const chunks = splitRecursive(item.text, chunkSize, getChunkDelimiters());
        for (let i = 0; i < chunks.length; i++) {
            // Compute unique hash from chunk text for proper identification in visualizer
            const chunkHash = getStringHash(chunks[i]);
            chunkedItems.push({
                ...item,
                hash: chunkHash,  // Unique hash for this chunk's text
                text: chunks[i],
                metadata: {
                    ...item.metadata,
                    source: 'chat',
                    messageId: item.index,
                    chunkIndex: i,
                    totalChunks: chunks.length,
                    originalMessageHash: item.hash  // Track which message this came from
                }
            });
        }
    }
    return chunkedItems;
}

/**
 * Groups messages according to chunking strategy
 *
 * HASH DESIGN NOTE: Hashes are calculated from combined text ONLY (not message indices).
 * This is INTENTIONAL semantic deduplication - identical text produces identical embeddings,
 * so storing duplicates would waste storage and query budget. Individual message IDs are
 * preserved in metadata.messageIds and metadata.messageHashes for injection lookup.
 * DO NOT add message indices to hash calculation - it would break incremental sync and
 * disable deduplication with no functional benefit.
 *
 * @param {object[]} messages Messages to group
 * @param {string} strategy Chunking strategy: 'per_message', 'conversation_turns', 'message_batch'
 * @param {number} batchSize Number of messages per batch (for message_batch strategy)
 * @returns {object[]} Grouped message items ready for chunking
 */
function groupMessagesByStrategy(messages, strategy, batchSize = 4) {
    if (!messages.length) return [];

    switch (strategy) {
        case 'conversation_turns': {
            // Group user + AI message pairs
            const grouped = [];
            for (let i = 0; i < messages.length; i += 2) {
                const pair = [messages[i]];
                if (i + 1 < messages.length) {
                    pair.push(messages[i + 1]);
                }
                // Combine texts with speaker labels
                const combinedText = pair.map(m => {
                    const role = m.is_user ? 'User' : 'Character';
                    return `[${role}]: ${m.text}`;
                }).join('\n\n');

                grouped.push({
                    text: combinedText,
                    hash: getStringHash(combinedText),
                    index: messages[i].index,
                    metadata: {
                        strategy: 'conversation_turns',
                        messageIds: pair.map(m => m.index),
                        messageHashes: pair.map(m => m.hash), // Store individual hashes for injection lookup
                        startIndex: messages[i].index,
                        endIndex: pair[pair.length - 1].index
                    }
                });
            }
            return grouped;
        }

        case 'message_batch': {
            // Group N messages together
            const grouped = [];
            for (let i = 0; i < messages.length; i += batchSize) {
                const batch = messages.slice(i, i + batchSize);
                // Combine texts with speaker labels
                const combinedText = batch.map(m => {
                    const role = m.is_user ? 'User' : 'Character';
                    return `[${role}]: ${m.text}`;
                }).join('\n\n');

                grouped.push({
                    text: combinedText,
                    hash: getStringHash(combinedText),
                    index: batch[0].index,
                    metadata: {
                        strategy: 'message_batch',
                        batchSize: batch.length,
                        messageIds: batch.map(m => m.index),
                        messageHashes: batch.map(m => m.hash), // Store individual hashes for injection lookup
                        startIndex: batch[0].index,
                        endIndex: batch[batch.length - 1].index
                    }
                });
            }
            return grouped;
        }

        case 'per_message':
        default:
            // Current behavior - each message is its own item
            return messages.map(m => ({
                text: m.text,
                hash: m.hash,
                index: m.index,
                is_user: m.is_user,
                metadata: {
                    strategy: 'per_message',
                    messageId: m.index,
                    messageHashes: [m.hash] // Consistent with grouped strategies
                }
            }));
    }
}

/**
 * Filters out chunks that have been disabled by scene vectorization
 * @param {object[]} chunks Chunks to filter
 * @returns {object[]} Chunks not disabled by scenes
 */
function filterSceneDisabledChunks(chunks) {
    const filtered = chunks.filter(chunk => {
        const isDisabled = isChunkDisabledByScene(chunk.hash);
        if (isDisabled) {
            console.debug(`VectHare: Chunk ${chunk.hash} is disabled by scene`);
        }
        return !isDisabled;
    });

    if (filtered.length !== chunks.length) {
        console.log(`VectHare: Scene filtering: ${chunks.length} → ${filtered.length} chunks (${chunks.length - filtered.length} disabled by scenes)`);
    }

    return filtered;
}

/**
 * Applies chunk-level conditions to filter results
 * @param {object[]} chunks Chunks with metadata
 * @param {object[]} chat Chat messages for context
 * @param {object} settings VectHare settings
 * @returns {Promise<object[]>} Filtered chunks
 */
async function applyChunkConditions(chunks, chat, settings) {
    // First filter out chunks disabled by scenes
    let filtered = filterSceneDisabledChunks(chunks);

    // Check if any chunks have conditions (from chunk metadata)
    const chunksWithConditions = filtered.map(chunk => {
        const chunkMeta = getChunkMetadata(chunk.hash);
        if (chunkMeta?.conditions?.enabled) {
            return { ...chunk, conditions: chunkMeta.conditions };
        }
        return chunk;
    });

    // If no chunks have conditions, return filtered
    const hasAnyConditions = chunksWithConditions.some(c => c.conditions?.enabled);
    if (!hasAnyConditions) {
        return filtered;
    }

    // Build search context for condition evaluation
    const context = buildSearchContext(chat, settings.query || 10, chunksWithConditions, {
        generationType: settings.generationType || 'normal',
        isGroupChat: settings.isGroupChat || false,
        currentCharacter: settings.currentCharacter || null,
        activeLorebookEntries: settings.activeLorebookEntries || [],
        activationHistory: window.VectHare_ActivationHistory || {}
    });

    // Filter chunks by their conditions
    const conditionFilteredChunks = filterChunksByConditions(chunksWithConditions, context);

    // Track activation for frequency conditions
    conditionFilteredChunks.forEach(chunk => {
        if (chunk.conditions?.enabled) {
            trackChunkActivation(chunk.hash, chat.length);
        }
    });

    console.log(`VectHare: Chunk conditions filtered ${filtered.length} → ${conditionFilteredChunks.length}`);
    return conditionFilteredChunks;
}

/**
 * Tracks chunk activation for frequency/cooldown conditions
 * @param {number} hash Chunk hash
 * @param {number} messageCount Current message count
 */
function trackChunkActivation(hash, messageCount) {
    if (!window.VectHare_ActivationHistory) {
        window.VectHare_ActivationHistory = {};
    }

    const history = window.VectHare_ActivationHistory[hash] || { count: 0, lastActivation: null };
    window.VectHare_ActivationHistory[hash] = {
        count: history.count + 1,
        lastActivation: messageCount
    };
}

/**
 * Rerank chunks using BananaBread's reranking endpoint
 * @param {string} query The search query
 * @param {Array} chunks Array of chunks with text
 * @param {object} settings VectHare settings
 * @returns {Promise<Array>} Chunks with updated scores from reranker
 */
async function rerankWithBananaBread(query, chunks, settings) {
    if (!chunks.length) return chunks;

    const apiUrl = settings.api_url_custom || 'http://localhost:8008';
    const documents = chunks.map(c => c.text);

    try {
        const response = await fetch('/api/plugins/similharity/rerank', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                apiUrl,
                query,
                documents,
                top_k: chunks.length
            }),
        });

        if (!response.ok) {
            console.warn('VectHare: Reranking failed, using original scores');
            return chunks;
        }

        const data = await response.json();
        if (!data.results || !Array.isArray(data.results)) {
            return chunks;
        }

        // Apply rerank scores - results are sorted by score desc
        // Each result has { index, score } where index refers to original position
        const rerankedChunks = data.results.map(r => {
            const chunk = { ...chunks[r.index] };
            chunk.rerankScore = r.score;
            chunk.originalScore = chunk.score;
            chunk.score = r.score; // Replace score with rerank score
            return chunk;
        });

        console.log(`VectHare: Reranked ${rerankedChunks.length} chunks with BananaBread`);
        return rerankedChunks;
    } catch (error) {
        console.warn('VectHare: Reranking error:', error.message);
        return chunks;
    }
}

/**
 * Synchronizes chat with vector index using simple FIFO queue
 *
 * How it works:
 * 1. Get all messages, get all vectorized hashes from DB
 * 2. Queue = messages not yet in DB (by hash)
 * 3. Process batch: take message, chunk it, insert chunks, remove from queue
 * 4. Repeat until queue empty
 *
 * @param {object} settings VectHare settings
 * @param {number} batchSize Number of messages to process per call
 * @returns {Promise<object>} Progress info
 */
export async function synchronizeChat(settings, batchSize = 5) {
    if (!settings.enabled_chats) {
        return { remaining: -1, messagesProcessed: 0, chunksCreated: 0 };
    }

    try {
        await waitUntilCondition(() => !syncBlocked && !is_send_press, 1000);
    } catch {
        return { remaining: -1, messagesProcessed: 0, chunksCreated: 0 };
    }

    try {
        syncBlocked = true;
        const context = getContext();

        if (!getCurrentChatId() || !Array.isArray(context.chat)) {
            return { remaining: -1, messagesProcessed: 0, chunksCreated: 0 };
        }

        // Build proper collection ID using chat UUID
        const collectionId = getChatCollectionId();
        if (!collectionId) {
            console.error('VectHare: Could not get collection ID for chat');
            return { remaining: -1, messagesProcessed: 0, chunksCreated: 0 };
        }

        // Register collection
        registerCollection(collectionId);

        // Step 1: What's already vectorized? (source of truth = DB)
        const existingHashes = new Set(await getSavedHashes(collectionId, settings));

        // Step 2: Build list of messages NOT in DB
        const strategy = settings.chunking_strategy || 'per_message';
        const strategyBatchSize = settings.batch_size || 4;

        // Collect all non-system messages with their data
        const allMessages = [];
        for (const msg of context.chat) {
            if (msg.is_system) continue;
            const text = String(substituteParams(msg.mes));
            allMessages.push({
                text,
                hash: getStringHash(substituteParams(getTextWithoutAttachments(msg))),
                index: context.chat.indexOf(msg),
                is_user: msg.is_user
            });
        }

        // Group messages according to strategy
        const groupedItems = groupMessagesByStrategy(allMessages, strategy, strategyBatchSize);

        // Filter out already vectorized items (by their grouped hash)
        const queue = new Queue();
        for (const item of groupedItems) {
            if (!existingHashes.has(item.hash)) {
                queue.enqueue(item);
            }
        }

        if (queue.isEmpty()) {
            return { remaining: 0, messagesProcessed: 0, chunksCreated: 0 };
        }

        // Step 3: Process batch
        let itemsProcessed = 0;
        let chunksCreated = 0;
        let itemsFailed = 0;

        while (!queue.isEmpty() && itemsProcessed < batchSize) {
            const item = queue.dequeue();

            try {
                // Chunk this item (which may be 1 message, a turn pair, or a batch)
                const chunks = splitByChunks([item], settings.message_chunk_size);

                // Insert chunks (insertVectorItems handles duplicates at DB level)
                if (chunks.length > 0) {
                    await insertVectorItems(collectionId, chunks, settings);
                    chunksCreated += chunks.length;
                }
            } catch (itemError) {
                // Log error but continue processing other items
                console.warn(`VectHare: Failed to process item (hash: ${item.hash}, index: ${item.index}):`, itemError.message);
                itemsFailed++;
                // Don't rethrow - continue with next item
            }

            itemsProcessed++;
            const label = strategy === 'per_message' ? 'Message' : 'Group';
            progressTracker.updateCurrentItem(`${label} ${itemsProcessed}/${batchSize}${itemsFailed > 0 ? ` (${itemsFailed} failed)` : ''}`);
        }

        progressTracker.updateCurrentItem(null);

        if (itemsFailed > 0) {
            console.warn(`VectHare: Sync completed with ${itemsFailed} failed items out of ${itemsProcessed}`);
        }

        return {
            remaining: queue.size,
            messagesProcessed: itemsProcessed,
            chunksCreated,
            itemsFailed
        };
    } catch (error) {
        console.error('VectHare: Sync failed', error);
        throw error;
    } finally {
        syncBlocked = false;
    }
}

/**
 * Searches for and injects relevant past messages from ALL enabled collections
 * This includes chat collections (if enabled_chats is true) AND any other
 * enabled collections like lorebooks, documents, character files, etc.
 *
 * @param {object[]} chat Current chat messages
 * @param {object} settings VectHare settings
 * @param {string} type Generation type
 */
export async function rearrangeChat(chat, settings, type) {
    try {
        if (type === 'quiet') {
            console.debug('VectHare: Skipping quiet prompt');
            return;
        }

        // Clear extension prompt
        setExtensionPrompt(EXTENSION_PROMPT_TAG, '', settings.position, settings.depth, false);

        if (!getCurrentChatId() || !Array.isArray(chat)) {
            console.debug('VectHare: No chat selected');
            return;
        }

        if (chat.length < settings.protect) {
            console.debug(`VectHare: Not enough messages (${chat.length} < ${settings.protect})`);
            return;
        }

        // =====================================================================
        // MULTI-COLLECTION QUERY: Query ALL enabled collections, not just chat
        // =====================================================================
        // 1. Get the chat collection ID (if chat vectorization is enabled)
        // 2. Get all other registered collections that are enabled
        // 3. Filter by activation conditions (triggers, etc.)
        // 4. Query all active collections and merge results
        // =====================================================================

        const chatCollectionId = getChatCollectionId();
        const collectionsToQuery = [];

        // Include chat collection if enabled_chats is true AND we have a valid collection ID
        if (settings.enabled_chats && chatCollectionId) {
            collectionsToQuery.push(chatCollectionId);
        }

        // Get all other registered collections that are enabled
        const registry = getCollectionRegistry();
        for (const registryKey of registry) {
            // Parse registry key (format: "source:collectionId" or just "collectionId")
            let collectionId = registryKey;
            if (registryKey.includes(':')) {
                const colonIndex = registryKey.indexOf(':');
                collectionId = registryKey.substring(colonIndex + 1);
            }

            // Skip if this is the current chat collection (already handled above)
            if (collectionId === chatCollectionId) {
                continue;
            }

            // Check if collection is enabled
            if (isCollectionEnabled(registryKey)) {
                collectionsToQuery.push(collectionId);
            }
        }

        // If no collections to query, exit early
        if (collectionsToQuery.length === 0) {
            console.debug('VectHare: No enabled collections to query');
            return;
        }

        console.log(`VectHare: Will query ${collectionsToQuery.length} collections:`, collectionsToQuery);

        // Build query from recent messages
        const recentMessages = chat
            .filter(x => !x.is_system)
            .reverse()
            .slice(0, settings.query)
            .map(x => substituteParams(x.mes));

        const queryText = recentMessages.join('\n').trim();

        if (queryText.length === 0) {
            console.debug('VectHare: No text to query');
            return;
        }

        // Build search context for activation condition filtering
        const searchContext = buildSearchContext(chat, settings.query || 10, [], {
            generationType: type || 'normal',
            isGroupChat: getContext().groupId != null,
            currentCharacter: getContext().name2 || null,
            activeLorebookEntries: []
        });

        // Filter collections by activation conditions (triggers, alwaysActive, etc.)
        const activeCollections = await filterActiveCollections(collectionsToQuery, searchContext);

        if (activeCollections.length === 0) {
            console.debug('VectHare: No collections passed activation conditions');
            return;
        }

        console.log(`VectHare: ${activeCollections.length} collections passed activation filters:`, activeCollections);

        // Initialize debug data for tracking pipeline stages
        const debugData = createDebugData();
        debugData.query = queryText;
        debugData.collectionId = activeCollections.join(', '); // Show all queried collections
        debugData.collectionsQueried = activeCollections;
        debugData.settings = {
            threshold: settings.score_threshold,
            topK: settings.insert,
            temporal_decay: settings.temporal_decay,
            protect: settings.protect,
            chatLength: chat.length
        };

        // TRACE: Pipeline start
        addTrace(debugData, 'init', 'Pipeline started', {
            collectionsQueried: activeCollections,
            queryLength: queryText.length,
            threshold: settings.score_threshold,
            topK: settings.insert,
            protect: settings.protect
        });

        // Query all active collections and merge results
        let chunksForVisualizer = [];

        for (const collectionId of activeCollections) {
            try {
                const queryResults = await queryCollection(collectionId, queryText, settings.insert, settings);

                // TRACE: Vector query results for this collection with score breakdown
                addTrace(debugData, 'vector_search', `Query completed for ${collectionId}`, {
                    hashesReturned: queryResults.hashes.length,
                    hashes: queryResults.hashes.slice(0, 5),
                    scoreBreakdown: queryResults.metadata.slice(0, 5).map(m => ({
                        finalScore: m.score?.toFixed(3),
                        originalScore: m.originalScore?.toFixed(3),
                        keywordBoost: m.keywordBoost?.toFixed(2) || '1.00',
                        matchedKeywords: m.matchedKeywords || [],
                        keywordBoosted: m.keywordBoosted || false
                    }))
                });

                console.log(`VectHare: Retrieved ${queryResults.hashes.length} chunks from ${collectionId}`);

                // Build chunks with text for visualizer
                // Text is stored in metadata from the vector DB, use that first
                // Fall back to looking up from chat if not present (legacy data)
                const collectionChunks = queryResults.metadata.map((meta, idx) => {
                    const hash = queryResults.hashes[idx];

                    // Prefer text from metadata (stored in vector DB)
                    let text = meta.text;
                    let textSource = 'metadata';

                    // Fallback: try to find in chat messages if not in metadata
                    if (!text) {
                        const chatMessage = chat.find(msg =>
                            msg.mes && getStringHash(substituteParams(getTextWithoutAttachments(msg))) === hash
                        );
                        text = chatMessage ? substituteParams(chatMessage.mes) : '(text not found)';
                        textSource = chatMessage ? 'chat_lookup' : 'not_found';
                    }

                    // TRACE: Record initial chunk state with full score breakdown
                    recordChunkFate(debugData, hash, 'vector_search', 'passed', null, {
                        finalScore: meta.score || 1.0,
                        originalScore: meta.originalScore,
                        keywordBoost: meta.keywordBoost,
                        matchedKeywords: meta.matchedKeywords,
                        textSource,
                        textLength: text?.length || 0,
                        collectionId
                    });

                    return {
                        hash: hash,
                        metadata: meta,
                        score: meta.score || 1.0,
                        originalScore: meta.originalScore,
                        keywordBoost: meta.keywordBoost,
                        matchedKeywords: meta.matchedKeywords,
                        matchedKeywordsWithWeights: meta.matchedKeywordsWithWeights,
                        keywordBoosted: meta.keywordBoosted,
                        similarity: meta.score || 1.0,
                        text: text,
                        index: meta.messageId || meta.index || 0,
                        collectionId: collectionId,
                        decayApplied: false
                    };
                });

                chunksForVisualizer.push(...collectionChunks);
            } catch (error) {
                console.warn(`VectHare: Failed to query collection ${collectionId}:`, error.message);
                addTrace(debugData, 'vector_search', `Query failed for ${collectionId}`, {
                    error: error.message
                });
            }
        }

        // Sort merged results by score (descending) and limit to topK
        chunksForVisualizer.sort((a, b) => b.score - a.score);
        chunksForVisualizer = chunksForVisualizer.slice(0, settings.insert);

        console.log(`VectHare: Retrieved ${chunksForVisualizer.length} total chunks from ${activeCollections.length} collections`);

        // Store initial stage (raw vector search results)
        debugData.stages.initial = [...chunksForVisualizer];
        debugData.stats.retrievedFromVector = chunksForVisualizer.length;

        // Initialize queryResults for use in later stages
        let queryResults = {
            hashes: chunksForVisualizer.map(c => c.hash),
            metadata: chunksForVisualizer.map(c => c.metadata)
        };

        // Apply BananaBread reranking if enabled
        if (settings.source === 'bananabread' && settings.bananabread_rerank && chunksForVisualizer.length > 0) {
            addTrace(debugData, 'rerank', 'Starting BananaBread reranking', {
                chunks: chunksForVisualizer.length,
                query: queryText.substring(0, 100)
            });

            chunksForVisualizer = await rerankWithBananaBread(queryText, chunksForVisualizer, settings);

            // Update debug data
            debugData.stages.afterRerank = [...chunksForVisualizer];
            addTrace(debugData, 'rerank', 'Reranking complete', {
                rerankedCount: chunksForVisualizer.length
            });
        }

        // TRACE: Apply threshold filter
        const threshold = settings.score_threshold || 0;
        const beforeThreshold = chunksForVisualizer.length;
        chunksForVisualizer = chunksForVisualizer.filter(chunk => {
            const passes = chunk.score >= threshold;
            if (!passes) {
                recordChunkFate(debugData, chunk.hash, 'threshold', 'dropped',
                    `Score ${chunk.score.toFixed(3)} < threshold ${threshold}`,
                    { score: chunk.score, threshold }
                );
            } else {
                recordChunkFate(debugData, chunk.hash, 'threshold', 'passed', null,
                    { score: chunk.score, threshold }
                );
            }
            return passes;
        });

        debugData.stages.afterThreshold = [...chunksForVisualizer];
        addTrace(debugData, 'threshold', 'Threshold filter applied', {
            threshold,
            before: beforeThreshold,
            after: chunksForVisualizer.length,
            dropped: beforeThreshold - chunksForVisualizer.length
        });

        // Apply temporal decay if enabled
        const beforeDecay = chunksForVisualizer.length;
        if (settings.temporal_decay && settings.temporal_decay.enabled) {
            addTrace(debugData, 'decay', 'Starting temporal decay', {
                enabled: true,
                sceneAware: settings.temporal_decay.sceneAware,
                halfLife: settings.temporal_decay.halfLife || settings.temporal_decay.half_life,
                strength: settings.temporal_decay.strength || settings.temporal_decay.rate
            });

            const currentMessageId = chat.length - 1;
            const chunksWithScores = chunksForVisualizer.map(chunk => ({
                hash: chunk.hash,
                metadata: chunk.metadata,
                score: chunk.score
            }));

            let decayedChunks;
            let decayType = 'standard';

            // Use scene-aware decay if enabled and scenes exist
            if (settings.temporal_decay.sceneAware) {
                // Extract scene info from chunks that have isScene:true
                const sceneChunks = chunksForVisualizer.filter(c => c.metadata?.isScene === true);
                const scenes = sceneChunks.map(c => ({
                    start: c.metadata.sceneStart,
                    end: c.metadata.sceneEnd,
                    hash: c.hash,
                }));

                if (scenes.length > 0) {
                    decayedChunks = applySceneAwareDecay(chunksWithScores, currentMessageId, scenes, settings.temporal_decay);
                    decayType = 'scene_aware';
                    console.log('VectHare: Applied scene-aware temporal decay to search results');
                } else {
                    decayedChunks = applyDecayToResults(chunksWithScores, currentMessageId, settings.temporal_decay);
                    decayType = 'standard_no_scenes';
                    console.log('VectHare: Applied temporal decay to search results (no scenes marked)');
                }
            } else {
                decayedChunks = applyDecayToResults(chunksWithScores, currentMessageId, settings.temporal_decay);
                console.log('VectHare: Applied temporal decay to search results');
            }

            decayedChunks.sort((a, b) => b.score - a.score);

            // TRACE: Record decay effects per chunk
            chunksForVisualizer = chunksForVisualizer.map(chunk => {
                const decayedChunk = decayedChunks.find(dc => dc.hash === chunk.hash);
                if (decayedChunk && (decayedChunk.decayApplied || decayedChunk.sceneAwareDecay)) {
                    const decayMultiplier = decayedChunk.score / (decayedChunk.originalScore || 1);
                    const newScore = decayedChunk.score;
                    const stillAboveThreshold = newScore >= threshold;

                    // TRACE: Record decay effect on this chunk
                    if (stillAboveThreshold) {
                        recordChunkFate(debugData, chunk.hash, 'decay', 'passed', null, {
                            originalScore: decayedChunk.originalScore,
                            decayedScore: newScore,
                            decayMultiplier,
                            messageAge: decayedChunk.messageAge || decayedChunk.effectiveAge,
                            decayType
                        });
                    } else {
                        recordChunkFate(debugData, chunk.hash, 'decay', 'dropped',
                            `Decayed score ${newScore.toFixed(3)} < threshold ${threshold}`,
                            {
                                originalScore: decayedChunk.originalScore,
                                decayedScore: newScore,
                                decayMultiplier,
                                messageAge: decayedChunk.messageAge || decayedChunk.effectiveAge,
                                decayType
                            }
                        );
                    }

                    return {
                        ...chunk,
                        score: newScore,
                        originalScore: decayedChunk.originalScore,
                        messageAge: decayedChunk.messageAge || decayedChunk.effectiveAge,
                        decayApplied: true,
                        sceneAwareDecay: decayedChunk.sceneAwareDecay || false,
                        decayMultiplier
                    };
                }
                // No decay applied to this chunk
                recordChunkFate(debugData, chunk.hash, 'decay', 'passed', 'No decay applied', {
                    score: chunk.score
                });
                return chunk;
            });

            // Re-filter by threshold after decay
            chunksForVisualizer = chunksForVisualizer.filter(c => c.score >= threshold);

            queryResults = {
                hashes: chunksForVisualizer.map(c => c.hash),
                metadata: chunksForVisualizer.map(c => c.metadata)
            };

            addTrace(debugData, 'decay', 'Temporal decay completed', {
                decayType,
                before: beforeDecay,
                after: chunksForVisualizer.length,
                dropped: beforeDecay - chunksForVisualizer.length
            });
        } else {
            addTrace(debugData, 'decay', 'Temporal decay skipped (disabled)', {
                enabled: false
            });
            // Mark all chunks as passing decay stage
            chunksForVisualizer.forEach(chunk => {
                recordChunkFate(debugData, chunk.hash, 'decay', 'passed', 'Decay disabled', {
                    score: chunk.score
                });
            });
        }

        // Store after decay stage
        debugData.stages.afterDecay = [...chunksForVisualizer];
        debugData.stats.afterDecay = chunksForVisualizer.length;

        // Apply chunk-level conditions if any chunks have them
        const beforeConditions = chunksForVisualizer.length;
        const chunksBeforeConditions = [...chunksForVisualizer]; // Keep copy for tracing

        addTrace(debugData, 'conditions', 'Starting condition filtering', {
            chunksToFilter: beforeConditions,
            hasConditions: chunksForVisualizer.some(c => c.metadata?.conditions)
        });

        chunksForVisualizer = await applyChunkConditions(chunksForVisualizer, chat, settings);

        // TRACE: Record which chunks were dropped by conditions
        const afterConditionsHashes = new Set(chunksForVisualizer.map(c => c.hash));
        chunksBeforeConditions.forEach(chunk => {
            if (afterConditionsHashes.has(chunk.hash)) {
                recordChunkFate(debugData, chunk.hash, 'conditions', 'passed', null, {
                    score: chunk.score,
                    hadConditions: !!chunk.metadata?.conditions
                });
            } else {
                recordChunkFate(debugData, chunk.hash, 'conditions', 'dropped',
                    chunk.metadata?.conditions
                        ? `Failed condition: ${JSON.stringify(chunk.metadata.conditions)}`
                        : 'Filtered by condition system',
                    {
                        score: chunk.score,
                        conditions: chunk.metadata?.conditions
                    }
                );
            }
        });

        // Store after conditions stage
        debugData.stages.afterConditions = [...chunksForVisualizer];
        debugData.stats.afterConditions = chunksForVisualizer.length;

        addTrace(debugData, 'conditions', 'Condition filtering completed', {
            before: beforeConditions,
            after: chunksForVisualizer.length,
            dropped: beforeConditions - chunksForVisualizer.length
        });

        // Update queryResults to match filtered chunks
        queryResults = {
            hashes: chunksForVisualizer.map(c => c.hash),
            metadata: chunksForVisualizer.map(c => c.metadata)
        };

        // Store results for legacy visualizer (keep for compatibility)
        window.VectHare_LastSearch = {
            chunks: chunksForVisualizer,
            query: queryText,
            timestamp: Date.now(),
            settings: {
                threshold: settings.score_threshold,
                topK: settings.insert,
                temporal_decay: settings.temporal_decay
            }
        };
        console.log(`VectHare: Stored ${chunksForVisualizer.length} chunks for visualizer`);

        // TRACE: Start injection phase
        addTrace(debugData, 'injection', 'Starting deduplication and injection', {
            chunksToInject: chunksForVisualizer.length,
            chatLength: chat.length
        });

        // Build set of hashes currently in chat context (to skip duplicates)
        const currentChatHashes = new Set();
        chat.forEach((msg) => {
            if (msg.mes) {
                const hash = getStringHash(substituteParams(getTextWithoutAttachments(msg)));
                currentChatHashes.add(hash);
            }
        });

        // Filter chunks: SKIP if already in current chat context, INJECT if not
        // This is the core RAG logic: inject OLD things that are NOT already in context
        const chunksToInject = [];
        const skippedDuplicates = [];

        for (const chunk of chunksForVisualizer) {
            // Check if this chunk's hash is already in current chat context
            if (currentChatHashes.has(chunk.hash)) {
                // Already in context - skip to avoid duplication
                skippedDuplicates.push(chunk);
                recordChunkFate(debugData, chunk.hash, 'injection', 'skipped',
                    'Already in current chat context - no injection needed',
                    { score: chunk.score }
                );
            } else {
                // NOT in context - this is what RAG is for, inject it!
                chunksToInject.push(chunk);
                recordChunkFate(debugData, chunk.hash, 'injection', 'passed',
                    'Not in current context - will inject',
                    { score: chunk.score, collectionId: chunk.collectionId }
                );
            }
        }

        addTrace(debugData, 'injection', 'Deduplication complete', {
            totalChunks: chunksForVisualizer.length,
            toInject: chunksToInject.length,
            skippedDuplicates: skippedDuplicates.length
        });

        if (chunksToInject.length === 0) {
            console.debug('VectHare: All retrieved chunks already in context, nothing to inject');
            debugData.stages.injected = [];
            debugData.stats.actuallyInjected = 0;
            debugData.stats.skippedDuplicates = skippedDuplicates.length;

            addTrace(debugData, 'injection', 'PIPELINE COMPLETE - NO INJECTION NEEDED', {
                reason: 'All chunks already in current context',
                skippedCount: skippedDuplicates.length
            });

            setLastSearchDebug(debugData);
            return;
        }

        // Format chunks for injection using chunk.text (already populated from metadata or lookup)
        const injectionText = chunksToInject
            .map(chunk => chunk.text || '(text not available)')
            .join('\n\n');

        const insertedText = settings.template.replace('{{text}}', injectionText);
        setExtensionPrompt(EXTENSION_PROMPT_TAG, insertedText, settings.position, settings.depth, false);

        // VERIFICATION: Check that extension_prompts actually has our content
        const verifiedPrompt = extension_prompts[EXTENSION_PROMPT_TAG];
        const injectionVerified = verifiedPrompt && verifiedPrompt.value === insertedText;

        if (!injectionVerified) {
            console.warn('VectHare: ⚠️ Injection verification failed!', {
                expected: insertedText.substring(0, 100) + '...',
                actual: verifiedPrompt?.value?.substring(0, 100) + '...',
                promptExists: !!verifiedPrompt
            });
        }

        // Store injected chunks for debug/visualizer
        chunksToInject.forEach(chunk => {
            recordChunkFate(debugData, chunk.hash, 'final', 'injected', null, {
                score: chunk.score,
                collectionId: chunk.collectionId
            });
        });

        debugData.stages.injected = chunksToInject;
        debugData.stats.actuallyInjected = chunksToInject.length;
        debugData.stats.skippedDuplicates = skippedDuplicates.length;

        // Store actual injected text and verification status for debug UI
        debugData.injection = {
            verified: injectionVerified,
            text: insertedText,
            position: settings.position,
            depth: settings.depth,
            promptTag: EXTENSION_PROMPT_TAG,
            charCount: insertedText.length
        };

        // TRACE: Pipeline complete with successful injection
        addTrace(debugData, 'final', 'PIPELINE COMPLETE - SUCCESS', {
            injectedCount: chunksToInject.length,
            skippedDuplicates: skippedDuplicates.length,
            injectedHashes: chunksToInject.map(c => c.hash),
            totalTokens: insertedText.length, // Rough estimate
            position: settings.position,
            depth: settings.depth,
            verified: injectionVerified
        });

        // Save debug data for the Search Debug modal
        setLastSearchDebug(debugData);

        console.log(`VectHare: ✅ Injected ${chunksToInject.length} chunks (${skippedDuplicates.length} skipped - already in context)`);

    } catch (error) {
        toastr.error('Generation interceptor aborted. Check console for details.', 'VectHare');
        console.error('VectHare: Failed to rearrange chat', error);
    }
}

/**
 * Vectorizes entire chat
 * @param {object} settings VectHare settings
 * @param {number} batchSize Batch size
 */
export async function vectorizeAll(settings, batchSize) {
    try {
        if (!settings.enabled_chats) {
            return;
        }

        const chatId = getCurrentChatId();
        if (!chatId) {
            toastr.info('No chat selected', 'Vectorization aborted');
            return;
        }

        // Pre-flight check: verify backend is available before starting
        const backendName = settings.vector_backend || 'standard';
        const backendAvailable = await isBackendAvailable(backendName, settings);
        if (!backendAvailable) {
            toastr.error(
                `Backend "${backendName}" is not available. Check your settings or start the backend service.`,
                'Vectorization aborted'
            );
            console.error(`VectHare: Backend ${backendName} failed health check before vectorization`);
            return;
        }

        // Calculate total messages to vectorize
        const context = getContext();
        const totalMessages = context.chat ? context.chat.filter(x => !x.is_system).length : 0;

        // Show progress panel
        progressTracker.show('Vectorizing Chat', totalMessages, 'Messages');

        let finished = false;
        let iteration = 0;
        let processedCount = 0;
        let totalChunks = 0;

        while (!finished) {
            if (is_send_press) {
                toastr.info('Message generation is in progress.', 'Vectorization aborted');
                progressTracker.complete(false, 'Aborted - message generation in progress');
                throw new Error('Message generation in progress');
            }

            const result = await synchronizeChat(settings, batchSize);

            // Handle disabled/blocked state
            if (result.remaining === -1) {
                console.log('VectHare: Vectorization blocked or disabled');
                progressTracker.complete(false, 'Blocked or disabled');
                return;
            }

            finished = result.remaining <= 0;
            iteration++;

            // Update progress with actual counts
            processedCount += result.messagesProcessed;
            totalChunks += result.chunksCreated;

            progressTracker.updateProgress(
                processedCount,
                result.remaining > 0 ? `Processing... ${result.remaining} messages remaining` : 'Finalizing...'
            );
            progressTracker.updateChunks(totalChunks);

            console.log(`VectHare: Vectorization iteration ${iteration}, ${result.remaining > 0 ? result.remaining + ' remaining' : 'complete'} (${result.chunksCreated} chunks this batch)`);

            if (chatId !== getCurrentChatId()) {
                progressTracker.complete(false, 'Chat changed during vectorization');
                throw new Error('Chat changed');
            }
        }

        progressTracker.complete(true, `Vectorized ${processedCount} messages (${totalChunks} chunks)`);
        toastr.success('Chat vectorized successfully', 'VectHare');
        console.log(`VectHare: ✅ Vectorization complete after ${iteration} iterations`);
    } catch (error) {
        console.error('VectHare: Failed to vectorize all', error);
        progressTracker.addError(error.message);
        progressTracker.complete(false, 'Vectorization failed');
        toastr.error('Vectorization failed. Check console.', 'VectHare');
    }
}

/**
 * Purges vector index for current chat
 * @param {object} settings VectHare settings
 */
export async function purgeChatIndex(settings) {
    if (!getCurrentChatId()) {
        toastr.info('No chat selected', 'Purge aborted');
        return;
    }

    const collectionId = getChatCollectionId();
    if (!collectionId) {
        toastr.error('Could not get collection ID', 'Purge aborted');
        return;
    }

    if (await purgeVectorIndex(collectionId, settings)) {
        toastr.success('Vector index purged', 'VectHare');
        console.log('VectHare: Index purged successfully');
    } else {
        toastr.error('Failed to purge vector index', 'VectHare');
    }
}
