/**
 * ============================================================================
 * VECTHARE COLLECTION LOADER
 * ============================================================================
 * Data access layer for managing vector collections and chunks
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { extension_settings } from '../../../../extensions.js';
import { getContext } from '../../../../extensions.js';
import { characters, substituteParams, getRequestHeaders } from '../../../../../script.js';
import { getSavedHashes, queryCollection } from './core-vector-api.js';
import { getStringHash } from '../../../../utils.js';
import {
    isCollectionEnabled,
    setCollectionEnabled,
    getChunkMetadata,
    saveChunkMetadata,
    deleteChunkMetadata,
    ensureCollectionMeta,
} from './collection-metadata.js';

// Plugin detection state
let pluginAvailable = null;

/**
 * Gets or initializes the collection registry
 * @returns {string[]} Array of collection IDs
 */
export function getCollectionRegistry() {
    if (!extension_settings.vecthare.vecthare_collection_registry) {
        extension_settings.vecthare.vecthare_collection_registry = [];
    }
    return extension_settings.vecthare.vecthare_collection_registry;
}

/**
 * Registers a collection in the registry (idempotent)
 * @param {string} collectionId Collection identifier
 */
export function registerCollection(collectionId) {
    if (!collectionId) {
        console.warn('VectHare: Attempted to register null/undefined collectionId, skipping');
        return;
    }
    const registry = getCollectionRegistry();
    if (!registry.includes(collectionId)) {
        registry.push(collectionId);
        console.log(`VectHare: Registered collection: ${collectionId}`);
    }
}

/**
 * Unregisters a collection from the registry
 * @param {string} collectionId Collection identifier
 */
export function unregisterCollection(collectionId) {
    const registry = getCollectionRegistry();
    const index = registry.indexOf(collectionId);
    if (index !== -1) {
        registry.splice(index, 1);
        console.log(`VectHare: Unregistered collection: ${collectionId}`);
    }
}

/**
 * Parses collection ID into structured metadata
 * @param {string} collectionId Collection identifier
 * @returns {object} Parsed collection info
 */
function parseCollectionId(collectionId) {
    // Guard against null/undefined
    if (!collectionId) {
        console.warn('VectHare: parseCollectionId received null/undefined collectionId');
        return { type: 'unknown', rawId: 'unknown', scope: 'unknown' };
    }

    // Expected formats:
    // - vecthare_chat_12345
    // - file_67890
    // - lorebook_abc
    // - Avi-2025-11-10@03h36m14s (chat without prefix)
    // - carrotkernel_char_* (legacy CarrotKernel format)
    // - ragbooks_lorebook_* (Ragbooks format)

    if (collectionId.startsWith('vecthare_chat_')) {
        return {
            type: 'chat',
            rawId: collectionId.replace('vecthare_chat_', ''),
            scope: 'chat'
        };
    }

    if (collectionId.startsWith('file_')) {
        return {
            type: 'file',
            rawId: collectionId.replace('file_', ''),
            scope: 'global'
        };
    }

    if (collectionId.startsWith('lorebook_')) {
        return {
            type: 'lorebook',
            rawId: collectionId.replace('lorebook_', ''),
            scope: 'global'
        };
    }

    if (collectionId.startsWith('ragbooks_lorebook_')) {
        return {
            type: 'lorebook',
            rawId: collectionId.replace('ragbooks_lorebook_', ''),
            scope: 'global'
        };
    }

    if (collectionId.startsWith('carrotkernel_char_')) {
        return {
            type: 'chat',
            rawId: collectionId.replace('carrotkernel_char_', ''),
            scope: 'character'
        };
    }

    // Heuristic: If it looks like a chat timestamp (contains @ or date-like patterns), assume it's a chat
    if (collectionId.includes('@') || /\d{4}-\d{2}-\d{2}/.test(collectionId)) {
        return {
            type: 'chat',
            rawId: collectionId,
            scope: 'chat'
        };
    }

    // Default: assume chat (most common case)
    return {
        type: 'chat',
        rawId: collectionId,
        scope: 'chat'
    };
}

/**
 * Gets display name for a collection
 * @param {string} collectionId Collection identifier
 * @param {object} metadata Parsed collection metadata
 * @returns {string} Human-readable name
 */
function getCollectionDisplayName(collectionId, metadata) {
    const context = getContext();

    switch (metadata.type) {
        case 'chat': {
            // Try to get chat name from ST
            const chatId = metadata.rawId;

            // Check if it's the current chat
            if (context.chatId === chatId && context.name2) {
                return `Chat: ${context.name2}`;
            }

            // Try to find in characters list
            const character = characters.find(c => c.chat === chatId);
            if (character) {
                return `Chat: ${character.name}`;
            }

            // Fallback to ID
            return `Chat #${chatId.substring(0, 8)}`;
        }

        case 'file':
            return `File: ${metadata.rawId}`;

        case 'lorebook':
            return `Lorebook: ${metadata.rawId}`;

        default:
            return collectionId;
    }
}

/**
 * Checks if VectHare server plugin is available
 * @returns {Promise<boolean>} True if plugin is available
 */
async function checkPluginAvailable() {
    if (pluginAvailable !== null) {
        return pluginAvailable;
    }

    try {
        const response = await fetch('/api/plugins/similharity/health', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            pluginAvailable = data.status === 'ok';
            console.log(`VectHare: Plugin ${pluginAvailable ? 'detected' : 'not found'} (v${data.version || 'unknown'})`);
        } else {
            pluginAvailable = false;
        }
    } catch (error) {
        pluginAvailable = false;
    }

    return pluginAvailable;
}

// Cache for plugin collection data
let pluginCollectionData = null;

/**
 * Discovers existing collections using server plugin (scans file system)
 * @param {object} settings VectHare settings
 * @returns {Promise<string[]>} Array of discovered collection IDs
 */
async function discoverViaPlugin(settings) {
    try {
        // Plugin now scans ALL sources, not just the current one
        const response = await fetch(`/api/plugins/similharity/collections`, {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            console.warn('VectHare: Plugin collections endpoint failed');
            return [];
        }

        const data = await response.json();

        if (data.success && Array.isArray(data.collections)) {
            console.log(`VectHare: Plugin found ${data.collections.length} collections across all sources`);

            // Cache the plugin data (includes chunk counts, sources, AND backends)
            pluginCollectionData = {};
            for (const collection of data.collections) {
                const collectionData = {
                    chunkCount: collection.chunkCount,
                    source: collection.source,
                    backend: collection.backend || 'standard'
                };

                // Cache by the returned ID (may be sanitized for LanceDB)
                pluginCollectionData[collection.id] = collectionData;

                // Also cache by sanitized version (for LanceDB lookups)
                const sanitized = collection.id.replace(/[^a-zA-Z0-9_.-]/g, '_');
                if (sanitized !== collection.id) {
                    pluginCollectionData[sanitized] = collectionData;
                }

                console.log(`VectHare:   - ${collection.id} (${collection.backend}, ${collection.source}, ${collection.chunkCount} chunks)`);
            }

            // Register all discovered collections (filter out null/undefined IDs)
            const collectionIds = data.collections.map(c => c.id).filter(id => id != null);
            for (const collectionId of collectionIds) {
                registerCollection(collectionId);
            }

            return collectionIds;
        }
    } catch (error) {
        console.error('VectHare: Plugin discovery failed:', error);
    }

    return [];
}

/**
 * Discovers existing collections by trying to load them (fallback method)
 * This finds collections that existed before auto-registration was added
 * @param {object} settings VectHare settings
 * @returns {Promise<string[]>} Array of discovered collection IDs
 */
async function discoverViaFallback(settings) {
    const context = getContext();
    const discovered = [];

    // Try to discover chat collections from current context
    if (context.chatId) {
        const chatCollectionId = `vecthare_chat_${context.chatId}`;
        try {
            const hashes = await getSavedHashes(chatCollectionId, settings);
            if (hashes && hashes.length > 0) {
                discovered.push(chatCollectionId);
                registerCollection(chatCollectionId);
                console.log(`VectHare: Discovered existing collection: ${chatCollectionId} (${hashes.length} chunks)`);
            }
        } catch (error) {
            // Collection doesn't exist, skip
        }
    }

    // Try to discover character-based collections from CarrotKernel
    for (const char of characters) {
        if (char.name) {
            const carrotCollectionId = `carrotkernel_char_${char.name}`;
            try {
                const hashes = await getSavedHashes(carrotCollectionId, settings);
                if (hashes && hashes.length > 0) {
                    discovered.push(carrotCollectionId);
                    registerCollection(carrotCollectionId);
                    console.log(`VectHare: Discovered existing collection: ${carrotCollectionId} (${hashes.length} chunks)`);
                }
            } catch (error) {
                // Collection doesn't exist, skip
            }
        }
    }

    return discovered;
}

/**
 * Discovers existing collections (uses plugin if available, fallback otherwise)
 * @param {object} settings VectHare settings
 * @returns {Promise<string[]>} Array of discovered collection IDs
 */
export async function discoverExistingCollections(settings) {
    const hasPlugin = await checkPluginAvailable();

    if (hasPlugin) {
        console.log('VectHare: Using plugin for collection discovery');
        return await discoverViaPlugin(settings);
    } else {
        console.log('VectHare: Plugin not available, using fallback discovery');
        return await discoverViaFallback(settings);
    }
}

/**
 * Loads all collections with metadata
 * @param {object} settings VectHare settings
 * @param {boolean} autoDiscover If true, attempts to discover unregistered collections
 * @returns {Promise<object[]>} Array of collection objects
 */
export async function loadAllCollections(settings, autoDiscover = true) {
    // Auto-discover existing collections on first load
    if (autoDiscover) {
        await discoverExistingCollections(settings);
    }

    const registry = getCollectionRegistry().filter(id => id != null);
    const collections = [];
    const hasPlugin = pluginAvailable === true;

    for (const collectionId of registry) {
        try {
            console.log(`VectHare: Loading collection: ${collectionId}`);
            const metadata = parseCollectionId(collectionId);
            console.log(`VectHare:   Type: ${metadata.type}, Scope: ${metadata.scope}`);

            let chunkCount = 0;
            let hashes = [];

            // If plugin is available, use chunk count, source, and backend from plugin cache
            // Otherwise, verify with backend
            if (hasPlugin && pluginCollectionData && pluginCollectionData[collectionId]) {
                console.log(`VectHare:   Using plugin mode - getting data from cache`);
                chunkCount = pluginCollectionData[collectionId].chunkCount || 0;
                const collectionSource = pluginCollectionData[collectionId].source;
                const collectionBackend = pluginCollectionData[collectionId].backend;
                console.log(`VectHare:   Plugin reported ${chunkCount} chunks (backend: ${collectionBackend}, source: ${collectionSource})`);
            } else {
                console.log(`VectHare:   Using fallback mode - verifying with backend`);
                hashes = await getSavedHashes(collectionId, settings);
                chunkCount = hashes?.length || 0;
                console.log(`VectHare:   Hashes retrieved: ${chunkCount}`);
            }

            // Skip empty collections (no point showing them)
            if (chunkCount === 0) {
                console.log(`VectHare:   Skipping empty collection ${collectionId}`);
                continue;
            }

            const displayName = getCollectionDisplayName(collectionId, metadata);
            console.log(`VectHare:   Display name: ${displayName}`);

            // Check if enabled using new metadata system
            const enabled = isCollectionEnabled(collectionId);

            // Ensure collection has metadata entry
            ensureCollectionMeta(collectionId, { scope: metadata.scope });

            // Get source and backend from plugin cache (if available)
            // Try both the original ID and the sanitized version (for LanceDB)
            const sanitizedId = collectionId.replace(/[^a-zA-Z0-9_.-]/g, '_');
            const cacheData = pluginCollectionData?.[collectionId] || pluginCollectionData?.[sanitizedId];

            const source = (hasPlugin && cacheData)
                ? cacheData.source
                : 'unknown';

            const backend = (hasPlugin && cacheData)
                ? cacheData.backend
                : (settings.vector_backend || 'standard'); // Fallback to current setting

            collections.push({
                id: collectionId,
                name: displayName,
                type: metadata.type,
                scope: metadata.scope,
                chunkCount: chunkCount,
                enabled: enabled,
                hashes: hashes,
                rawId: metadata.rawId,
                source: source,
                backend: backend
            });
            console.log(`VectHare:   ✓ Added to collections list`);
        } catch (error) {
            console.error(`VectHare: Failed to load collection ${collectionId}`, error);
            console.error(`VectHare:   Error details:`, error.message);
            console.error(`VectHare:   Stack:`, error.stack);
            // Continue loading other collections
        }
    }

    console.log(`VectHare: Loaded ${collections.length} collections`);
    return collections;
}

// Re-export from collection-metadata.js for backwards compatibility
export { setCollectionEnabled, isCollectionEnabled } from './collection-metadata.js';

/**
 * Loads chunks for a specific collection
 * @param {string} collectionId Collection identifier
 * @param {object} settings VectHare settings
 * @returns {Promise<object[]>} Array of chunk objects
 */
export async function loadCollectionChunks(collectionId, settings) {
    const context = getContext();
    const hashes = await getSavedHashes(collectionId, settings);

    if (hashes.length === 0) {
        return [];
    }

    const chunks = [];
    const metadata = parseCollectionId(collectionId);

    // For chat collections, we can get text from chat messages
    if (metadata.type === 'chat' && context.chatId === metadata.rawId) {
        const chat = context.chat;

        for (const hash of hashes) {
            // Find message by hash
            const message = chat.find(msg => {
                if (!msg.mes || msg.is_system) return false;
                const msgText = substituteParams(msg.mes);
                return getStringHash(msgText) === hash;
            });

            if (message) {
                chunks.push({
                    text: substituteParams(message.mes),
                    hash: hash,
                    index: chat.indexOf(message),
                    metadata: {
                        messageId: chat.indexOf(message),
                        source: 'chat'
                    }
                });
            }
        }
    } else {
        // For other collection types or inactive chats, we need to query
        // to get the text (vector backend stores it)
        // We'll implement this in Phase 2 when we add chunk editing
        console.warn(`VectHare: Cannot load chunk text for non-active collection: ${collectionId}`);

        // Return minimal data
        for (const hash of hashes) {
            chunks.push({
                text: '(Text not available - collection not active)',
                hash: hash,
                index: -1,
                metadata: {
                    source: metadata.type
                }
            });
        }
    }

    console.log(`VectHare: Loaded ${chunks.length} chunks for ${collectionId}`);
    return chunks;
}

// Re-export chunk metadata functions from collection-metadata.js for backwards compatibility
export { getChunkMetadata, saveChunkMetadata, deleteChunkMetadata } from './collection-metadata.js';
