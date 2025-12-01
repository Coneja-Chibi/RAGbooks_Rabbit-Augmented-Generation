/**
 * ============================================================================
 * VECTHARE SCENE MANAGEMENT
 * ============================================================================
 * Scenes are composite chunks in the vector database. When a user marks a
 * scene (start→end), we create a single chunk from the combined message text
 * and insert it into the collection with isScene:true metadata.
 *
 * Scene chunks have metadata:
 * - isScene: true
 * - sceneStart: message index where scene starts
 * - sceneEnd: message index where scene ends
 * - containedHashes: hashes of individual chunks this scene replaces
 * - title, summary, keywords: user-provided metadata
 *
 * Individual chunks within a scene get disabledByScene: sceneHash
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { getContext } from '../../../../extensions.js';
import { substituteParams, getCurrentChatId } from '../../../../../script.js';
import { getStringHash } from '../../../../utils.js';
import {
    insertVectorItems,
    deleteVectorItems,
    getSavedHashes,
} from './core-vector-api.js';
import { extension_settings } from '../../../../extensions.js';
import { getChatCollectionId } from './chat-vectorization.js';
import {
    getChunkMetadata,
    saveChunkMetadata,
    deleteChunkMetadata,
} from './collection-metadata.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Scene mode determines how scenes interact with retrieval
 * @type {Object.<string, string>}
 */
export const SCENE_MODES = {
    NONE: 'none',                   // Scenes are visual only, no special treatment
    SCENES_ONLY: 'scenes_only',     // Only scene chunks, individual chunks disabled
    SCENES_REPLACE: 'scenes_replace', // Same as above, clearer intent
    SCENES_BOOST: 'scenes_boost',   // Both exist, scenes get relevance boost
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Gets the collection ID for the current chat
 * Uses the new vh:chat:uuid format, with legacy fallback
 * @returns {string|null}
 */
export function getCurrentCollectionId() {
    // Try new format first
    const newFormatId = getChatCollectionId();
    if (newFormatId) {
        return newFormatId;
    }
    // Fallback to legacy format
    const chatId = getCurrentChatId();
    if (!chatId) return null;
    return `vecthare_chat_${chatId}`;
}

/**
 * Builds combined text from messages in a range
 * @param {object[]} messages - Chat messages array
 * @param {number} start - Start index
 * @param {number} end - End index
 * @returns {string}
 */
function buildSceneText(messages, start, end) {
    const sceneMessages = messages.slice(start, end + 1);
    return sceneMessages
        .filter(msg => msg.mes && !msg.is_system)
        .map(msg => `${msg.name || 'Unknown'}: ${substituteParams(msg.mes)}`)
        .join('\n\n');
}

/**
 * Computes hash for scene from combined text
 * @param {object[]} messages - Chat messages array
 * @param {number} start - Start index
 * @param {number} end - End index
 * @returns {number}
 */
export function computeSceneHash(messages, start, end) {
    const text = buildSceneText(messages, start, end);
    return getStringHash(text);
}

/**
 * Gets hashes of individual chunks within a scene range
 * @param {object[]} messages - Chat messages array
 * @param {number} start - Start index
 * @param {number} end - End index
 * @returns {number[]}
 */
export function getContainedChunkHashes(messages, start, end) {
    const hashes = [];
    const sceneMessages = messages.slice(start, end + 1);

    for (const msg of sceneMessages) {
        if (msg.mes && !msg.is_system) {
            const hash = getStringHash(substituteParams(msg.mes));
            hashes.push(hash);
        }
    }

    return hashes;
}

// ============================================================================
// SCENE CHUNK OPERATIONS
// ============================================================================

/**
 * Creates and inserts a scene chunk into the vector database
 * @param {number} start - Start message index
 * @param {number} end - End message index
 * @param {object} sceneData - Scene metadata (title, summary, keywords)
 * @param {object} settings - VectHare settings
 * @returns {Promise<{success: boolean, hash?: number, error?: string}>}
 */
export async function createSceneChunk(start, end, sceneData, settings) {
    const collectionId = getCurrentCollectionId();
    if (!collectionId) {
        return { success: false, error: 'No chat selected' };
    }

    const context = getContext();
    const messages = context?.chat;
    if (!messages || !Array.isArray(messages)) {
        return { success: false, error: 'No chat messages available' };
    }

    if (start < 0 || end < start || end >= messages.length) {
        return { success: false, error: 'Invalid scene boundaries' };
    }

    // Build scene text and compute hash
    const sceneText = buildSceneText(messages, start, end);
    if (!sceneText.trim()) {
        return { success: false, error: 'Scene contains no text' };
    }

    const sceneHash = getStringHash(sceneText);
    const containedHashes = getContainedChunkHashes(messages, start, end);

    // Build chunk for insertion
    const sceneChunk = {
        hash: sceneHash,
        text: sceneText,
        metadata: {
            isScene: true,
            sceneStart: start,
            sceneEnd: end,
            containedHashes: containedHashes,
            title: sceneData.title || `Scene ${start}-${end}`,
            summary: sceneData.summary || '',
            keywords: sceneData.keywords || [],
            messageCount: end - start + 1,
            createdAt: Date.now(),
        },
    };

    try {
        // Insert scene chunk into vector DB
        await insertVectorItems(collectionId, [sceneChunk], settings);

        // Disable contained chunks
        for (const hash of containedHashes) {
            const existing = getChunkMetadata(hash) || {};
            saveChunkMetadata(hash, {
                ...existing,
                disabledByScene: sceneHash,
                disabledAt: Date.now(),
            });
        }

        console.log(`VectHare Scenes: Created scene chunk ${sceneHash} (${start}-${end}), disabled ${containedHashes.length} chunks`);
        return { success: true, hash: sceneHash };

    } catch (error) {
        console.error('VectHare Scenes: Failed to create scene chunk', error);
        return { success: false, error: error.message || 'Failed to insert scene' };
    }
}

/**
 * Deletes a scene chunk and re-enables contained chunks
 * @param {number} sceneHash - Hash of the scene chunk to delete
 * @param {number[]} containedHashes - Hashes of chunks to re-enable
 * @param {object} settings - VectHare settings
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteSceneChunk(sceneHash, containedHashes, settings) {
    const collectionId = getCurrentCollectionId();
    if (!collectionId) {
        return { success: false, error: 'No chat selected' };
    }

    try {
        // Delete scene chunk from vector DB
        await deleteVectorItems(collectionId, [sceneHash], settings);

        // Re-enable contained chunks
        for (const hash of containedHashes) {
            const existing = getChunkMetadata(hash);
            if (existing && existing.disabledByScene === sceneHash) {
                const { disabledByScene, disabledAt, ...rest } = existing;
                if (Object.keys(rest).length > 0) {
                    saveChunkMetadata(hash, rest);
                } else {
                    deleteChunkMetadata(hash);
                }
            }
        }

        console.log(`VectHare Scenes: Deleted scene chunk ${sceneHash}, re-enabled ${containedHashes.length} chunks`);
        return { success: true };

    } catch (error) {
        console.error('VectHare Scenes: Failed to delete scene chunk', error);
        return { success: false, error: error.message || 'Failed to delete scene' };
    }
}

/**
 * Updates a scene chunk's metadata (title, summary, keywords)
 * Does NOT change boundaries - for that, delete and recreate
 * @param {number} sceneHash - Hash of the scene chunk
 * @param {object} updates - Fields to update
 * @param {object} settings - VectHare settings
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateSceneChunkMetadata(sceneHash, updates, settings) {
    // Scene metadata is stored in chunk metadata, not vector DB
    const existing = getChunkMetadata(sceneHash) || {};

    const updatedMeta = {
        ...existing,
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.summary !== undefined && { summary: updates.summary }),
        ...(updates.keywords !== undefined && { keywords: updates.keywords }),
        updatedAt: Date.now(),
    };

    saveChunkMetadata(sceneHash, updatedMeta);
    console.log(`VectHare Scenes: Updated metadata for scene ${sceneHash}`);
    return { success: true };
}

// ============================================================================
// SCENE QUERIES
// ============================================================================

/**
 * Checks if a chunk is disabled by a scene
 * @param {number} hash - Chunk hash
 * @returns {boolean}
 */
export function isChunkDisabledByScene(hash) {
    const meta = getChunkMetadata(hash);
    return meta?.disabledByScene != null;
}

/**
 * Gets the scene hash that disabled a chunk
 * @param {number} hash - Chunk hash
 * @returns {number|null}
 */
export function getDisablingSceneHash(hash) {
    const meta = getChunkMetadata(hash);
    return meta?.disabledByScene || null;
}

/**
 * Filters scene chunks from a list of chunks
 * @param {object[]} chunks - Array of chunks with metadata
 * @returns {object[]} Only chunks where metadata.isScene === true
 */
export function filterSceneChunks(chunks) {
    return chunks.filter(chunk => chunk.metadata?.isScene === true);
}

/**
 * Filters out scene chunks (returns only regular chunks)
 * @param {object[]} chunks - Array of chunks with metadata
 * @returns {object[]} Only chunks where metadata.isScene !== true
 */
export function filterNonSceneChunks(chunks) {
    return chunks.filter(chunk => chunk.metadata?.isScene !== true);
}

/**
 * Filters out chunks disabled by scenes
 * @param {object[]} chunks - Array of chunks
 * @returns {object[]} Chunks not disabled by scenes
 */
export function filterDisabledChunks(chunks) {
    return chunks.filter(chunk => !isChunkDisabledByScene(chunk.hash));
}

// ============================================================================
// SCENE BOUNDARY HELPERS (for UI markers)
// ============================================================================

/**
 * Finds scene chunk that contains a specific message
 * @param {object[]} sceneChunks - Array of scene chunks
 * @param {number} messageId - Message index
 * @returns {object|null}
 */
export function findSceneAtMessage(sceneChunks, messageId) {
    return sceneChunks.find(chunk =>
        chunk.metadata?.isScene &&
        messageId >= chunk.metadata.sceneStart &&
        messageId <= chunk.metadata.sceneEnd,
    ) || null;
}

/**
 * Checks if a message is a scene boundary
 * @param {object[]} sceneChunks - Array of scene chunks
 * @param {number} messageId - Message index
 * @returns {{isStart: boolean, isEnd: boolean, scene: object|null}}
 */
export function getMessageSceneStatus(sceneChunks, messageId) {
    for (const chunk of sceneChunks) {
        if (!chunk.metadata?.isScene) continue;

        if (chunk.metadata.sceneStart === messageId) {
            return { isStart: true, isEnd: false, scene: chunk };
        }
        if (chunk.metadata.sceneEnd === messageId) {
            return { isStart: false, isEnd: true, scene: chunk };
        }
    }

    const containingScene = findSceneAtMessage(sceneChunks, messageId);
    return {
        isStart: false,
        isEnd: false,
        scene: containingScene,
    };
}

/**
 * Gets open scene (one that has started but not ended in the current session)
 * Note: This is for UI state tracking, not stored in DB
 * @returns {object|null} Pending scene info or null
 */
let pendingSceneStart = null;

export function getPendingScene() {
    return pendingSceneStart;
}

export function setPendingSceneStart(messageId) {
    pendingSceneStart = messageId !== null ? { start: messageId } : null;
}

export function clearPendingScene() {
    pendingSceneStart = null;
}

// ============================================================================
// SCENE LIST MANAGEMENT
// ============================================================================

/**
 * Gets VectHare settings
 * @returns {object}
 */
function getSettings() {
    return extension_settings?.vecthare || {};
}

/**
 * Gets all scenes from the current chat's collection
 * Scenes are chunks with isScene: true metadata
 * @returns {Promise<object[]>} Array of scene objects
 */
export async function getScenes() {
    const collectionId = getCurrentCollectionId();
    if (!collectionId) {
        return [];
    }

    const settings = getSettings();

    try {
        const result = await getSavedHashes(collectionId, settings, true);

        if (!result.metadata) {
            return [];
        }

        // Filter for scene chunks and transform to scene objects
        const scenes = result.metadata
            .filter(item => item.isScene === true)
            .map(item => ({
                hash: item.hash,
                start: item.sceneStart,
                end: item.sceneEnd,
                title: item.title || '',
                summary: item.summary || '',
                keywords: item.keywords || [],
                containedHashes: item.containedHashes || [],
                messageCount: item.messageCount || (item.sceneEnd - item.sceneStart + 1),
                createdAt: item.createdAt,
            }))
            .sort((a, b) => a.start - b.start);

        return scenes;
    } catch (error) {
        console.error('VectHare Scenes: Failed to get scenes', error);
        return [];
    }
}

/**
 * Gets statistics about scenes in the current collection
 * @returns {Promise<{total: number, open: number, closed: number}>}
 */
export async function getSceneStats() {
    const scenes = await getScenes();

    const open = scenes.filter(s => s.end === null).length;
    const closed = scenes.filter(s => s.end !== null).length;

    return {
        total: scenes.length,
        open,
        closed,
    };
}

/**
 * Gets only closed scenes (where end !== null)
 * @returns {Promise<object[]>}
 */
export async function getClosedScenes() {
    const scenes = await getScenes();
    return scenes.filter(s => s.end !== null);
}

/**
 * Gets only open scenes (where end === null)
 * @returns {Promise<object[]>}
 */
export async function getOpenScenes() {
    const scenes = await getScenes();
    return scenes.filter(s => s.end === null);
}

/**
 * Updates a scene's metadata (title, summary, keywords)
 * @param {number} sceneHash - Hash of the scene chunk
 * @param {object} updates - Fields to update
 * @returns {Promise<boolean>} Success
 */
export async function updateScene(sceneHash, updates) {
    const settings = getSettings();

    try {
        await updateSceneChunkMetadata(sceneHash, updates, settings);
        console.log(`VectHare Scenes: Updated scene ${sceneHash}`);
        return true;
    } catch (error) {
        console.error('VectHare Scenes: Failed to update scene', error);
        return false;
    }
}

/**
 * Deletes a scene and re-enables its contained chunks
 * @param {number} sceneHash - Hash of the scene to delete
 * @returns {Promise<boolean>} Success
 */
export async function deleteScene(sceneHash) {
    const collectionId = getCurrentCollectionId();
    if (!collectionId) {
        return false;
    }

    const settings = getSettings();

    // Get the scene's contained hashes before deleting
    const scenes = await getScenes();
    const scene = scenes.find(s => s.hash === sceneHash);

    if (!scene) {
        console.warn(`VectHare Scenes: Scene ${sceneHash} not found`);
        return false;
    }

    try {
        await deleteSceneChunk(sceneHash, scene.containedHashes, settings);
        console.log(`VectHare Scenes: Deleted scene ${sceneHash}`);
        return true;
    } catch (error) {
        console.error('VectHare Scenes: Failed to delete scene', error);
        return false;
    }
}

/**
 * Deletes all scenes in the current collection
 * @returns {Promise<{success: boolean, deleted: number}>}
 */
export async function clearAllScenes() {
    const scenes = await getScenes();

    if (scenes.length === 0) {
        return { success: true, deleted: 0 };
    }

    const settings = getSettings();
    let deleted = 0;

    for (const scene of scenes) {
        try {
            await deleteSceneChunk(scene.hash, scene.containedHashes, settings);
            deleted++;
        } catch (error) {
            console.error(`VectHare Scenes: Failed to delete scene ${scene.hash}`, error);
        }
    }

    console.log(`VectHare Scenes: Cleared ${deleted}/${scenes.length} scenes`);
    return {
        success: deleted === scenes.length,
        deleted,
    };
}
