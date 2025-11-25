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

import { getCurrentChatId, is_send_press, setExtensionPrompt, substituteParams } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { getStringHash as calculateHash, waitUntilCondition, onlyUnique, splitRecursive } from '../../../utils.js';
import {
    getSavedHashes,
    insertVectorItems,
    queryCollection,
    deleteVectorItems,
    purgeVectorIndex,
} from './core-vector-api.js';
import { applyDecayToResults } from './temporal-decay.js';
import { registerCollection } from './collection-loader.js';
import { progressTracker } from './progress-tracker.js';

const EXTENSION_PROMPT_TAG = '3_vecthare';

// Hash cache for performance
const hashCache = new Map();

// Synchronization state
let syncBlocked = false;

/**
 * Gets the hash value for a string (with caching)
 * @param {string} str Input string
 * @returns {number} Hash value
 */
function getStringHash(str) {
    if (hashCache.has(str)) {
        return hashCache.get(str);
    }
    const hash = calculateHash(str);
    hashCache.set(str, hash);
    return hash;
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
            chunkedItems.push({
                ...item,
                text: chunks[i],
                metadata: {
                    ...item.metadata,
                    source: 'chat',
                    messageId: item.index,
                    chunkIndex: i,
                    totalChunks: chunks.length
                }
            });
        }
    }
    return chunkedItems;
}

/**
 * Synchronizes chat with vector index
 * @param {object} settings VectHare settings
 * @param {number} batchSize Number of items to process at once
 * @returns {Promise<number>} Number of remaining items (-1 if disabled/blocked)
 */
export async function synchronizeChat(settings, batchSize = 5) {
    console.log(`VectHare: synchronizeChat called, enabled_chats=${settings.enabled_chats}`);

    if (!settings.enabled_chats) {
        return -1;
    }

    try {
        await waitUntilCondition(() => !syncBlocked && !is_send_press, 1000);
    } catch {
        console.log('VectHare: Synchronization blocked by another process');
        return -1;
    }

    try {
        syncBlocked = true;
        const context = getContext();
        const chatId = getCurrentChatId();

        if (!chatId || !Array.isArray(context.chat)) {
            console.debug('VectHare: No chat selected');
            return -1;
        }

        // Register this collection in the database browser
        const collectionId = `vecthare_chat_${chatId}`;
        registerCollection(collectionId);

        // Build list of messages to vectorize
        const hashedMessages = context.chat
            .filter(x => !x.is_system)
            .map(x => ({
                text: String(substituteParams(x.mes)),
                hash: getStringHash(substituteParams(x.mes)),
                index: context.chat.indexOf(x)
            }));

        // Get existing hashes
        const hashesInCollection = await getSavedHashes(chatId, settings);

        // Find new and deleted items
        let newVectorItems = hashedMessages.filter(x => !hashesInCollection.includes(x.hash));
        const deletedHashes = hashesInCollection.filter(x => !hashedMessages.some(y => y.hash === x));

        // Process new items
        if (newVectorItems.length > 0) {
            const itemsToProcess = newVectorItems.slice(0, batchSize);
            const chunkedBatch = splitByChunks(itemsToProcess, settings.message_chunk_size);

            console.log(`VectHare: Found ${newVectorItems.length} new messages. Processing ${itemsToProcess.length} messages (${chunkedBatch.length} chunks)...`);

            await insertVectorItems(chatId, chunkedBatch, settings);

            console.log(`VectHare: Successfully vectorized ${chunkedBatch.length} chunks from ${itemsToProcess.length} messages`);
        }

        // Delete removed items
        if (deletedHashes.length > 0) {
            await deleteVectorItems(chatId, deletedHashes, settings);
            console.log(`VectHare: Deleted ${deletedHashes.length} old hashes`);
        }

        return newVectorItems.length - batchSize;
    } catch (error) {
        console.error('VectHare: Failed to synchronize chat', error);
        toastr.error('Check console for details', 'VectHare: Vectorization failed', { preventDuplicates: true });
        return -1;
    } finally {
        syncBlocked = false;
    }
}

/**
 * Searches for and injects relevant past messages
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

        if (!settings.enabled_chats) {
            return;
        }

        const chatId = getCurrentChatId();

        if (!chatId || !Array.isArray(chat)) {
            console.debug('VectHare: No chat selected');
            return;
        }

        if (chat.length < settings.protect) {
            console.debug(`VectHare: Not enough messages (${chat.length} < ${settings.protect})`);
            return;
        }

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

        // Query vector collection
        let queryResults = await queryCollection(chatId, queryText, settings.insert, settings);
        console.log(`VectHare: Retrieved ${queryResults.hashes.length} relevant chunks`);

        // Build chunks with text for visualizer
        let chunksForVisualizer = queryResults.metadata.map((meta, idx) => {
            // Find the chat message by hash to get the text
            const hash = queryResults.hashes[idx];
            const chatMessage = chat.find(msg =>
                msg.mes && getStringHash(substituteParams(msg.mes)) === hash
            );

            return {
                hash: hash,
                metadata: meta,
                score: meta.score || 1.0,
                similarity: meta.score || 1.0,
                text: chatMessage ? substituteParams(chatMessage.mes) : '(text not found)',
                index: meta.messageId || 0,
                collectionId: chatId,
                decayApplied: false
            };
        });

        // Apply temporal decay if enabled
        if (settings.temporal_decay && settings.temporal_decay.enabled) {
            const currentMessageId = chat.length - 1;
            const chunksWithScores = queryResults.metadata.map((meta, idx) => ({
                hash: queryResults.hashes[idx],
                metadata: meta,
                score: meta.score || 1.0
            }));

            const decayedChunks = applyDecayToResults(chunksWithScores, currentMessageId, settings.temporal_decay);
            decayedChunks.sort((a, b) => b.score - a.score);

            // Update visualizer chunks with decay info
            chunksForVisualizer = chunksForVisualizer.map(chunk => {
                const decayedChunk = decayedChunks.find(dc => dc.hash === chunk.hash);
                if (decayedChunk && decayedChunk.decayApplied) {
                    return {
                        ...chunk,
                        score: decayedChunk.score,
                        originalScore: decayedChunk.originalScore,
                        messageAge: decayedChunk.messageAge,
                        decayApplied: true,
                        decayMultiplier: decayedChunk.score / (decayedChunk.originalScore || 1)
                    };
                }
                return chunk;
            });

            queryResults = {
                hashes: decayedChunks.map(c => c.hash),
                metadata: decayedChunks.map(c => c.metadata)
            };

            console.log('VectHare: Applied temporal decay to search results');
        }

        // Store results for visualizer
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

        const queryHashes = queryResults.hashes.filter(onlyUnique);
        const queriedMessages = [];
        const insertedHashes = new Set();
        const retainMessages = chat.slice(-settings.protect);

        // Find original messages by hash
        for (const message of chat) {
            if (retainMessages.includes(message) || !message.mes) {
                continue;
            }
            const hash = getStringHash(substituteParams(message.mes));
            if (queryHashes.includes(hash) && !insertedHashes.has(hash)) {
                queriedMessages.push(message);
                insertedHashes.add(hash);
            }
        }

        // Sort by relevance
        queriedMessages.sort((a, b) =>
            queryHashes.indexOf(getStringHash(substituteParams(b.mes))) -
            queryHashes.indexOf(getStringHash(substituteParams(a.mes)))
        );

        // Remove queried messages from original array
        for (const message of queriedMessages) {
            const idx = chat.indexOf(message);
            if (idx !== -1) {
                chat.splice(idx, 1);
            }
        }

        if (queriedMessages.length === 0) {
            console.debug('VectHare: No relevant messages found');
            return;
        }

        // Format and inject
        const queriedText = queriedMessages
            .map(x => `${x.name}: ${x.mes}`.trim())
            .join('\n\n');

        const insertedText = settings.template.replace('{{text}}', queriedText);
        setExtensionPrompt(EXTENSION_PROMPT_TAG, insertedText, settings.position, settings.depth, false);

        console.log(`VectHare: ✅ Injected ${queriedMessages.length} relevant past messages`);

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

        // Calculate total messages to vectorize
        const context = getContext();
        const totalMessages = context.chat ? context.chat.filter(x => !x.is_system).length : 0;

        // Show progress panel
        progressTracker.show('Vectorizing Chat', totalMessages);

        let finished = false;
        let iteration = 0;
        let processedCount = 0;

        while (!finished) {
            if (is_send_press) {
                toastr.info('Message generation is in progress.', 'Vectorization aborted');
                progressTracker.complete(false, 'Aborted - message generation in progress');
                throw new Error('Message generation in progress');
            }

            const remaining = await synchronizeChat(settings, batchSize);
            finished = remaining <= 0;
            iteration++;

            // Update progress (estimate processed based on batch size)
            processedCount = Math.min(totalMessages, processedCount + batchSize);
            progressTracker.updateProgress(
                processedCount,
                remaining > 0 ? `Processing... ${remaining} items remaining` : 'Finalizing...'
            );
            progressTracker.updateBatch(iteration, Math.ceil(totalMessages / batchSize));

            console.log(`VectHare: Vectorization iteration ${iteration}, ${remaining > 0 ? remaining + ' remaining' : 'complete'}`);

            if (chatId !== getCurrentChatId()) {
                progressTracker.complete(false, 'Chat changed during vectorization');
                throw new Error('Chat changed');
            }
        }

        progressTracker.complete(true, `Vectorized ${totalMessages} messages successfully`);
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
    const chatId = getCurrentChatId();
    if (!chatId) {
        toastr.info('No chat selected', 'Purge aborted');
        return;
    }

    if (await purgeVectorIndex(chatId, settings)) {
        toastr.success('Vector index purged', 'VectHare');
        console.log('VectHare: Index purged successfully');
    } else {
        toastr.error('Failed to purge vector index', 'VectHare');
    }
}
