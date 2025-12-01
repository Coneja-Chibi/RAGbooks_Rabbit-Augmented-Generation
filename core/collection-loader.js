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
import { characters, substituteParams, getRequestHeaders, saveSettingsDebounced } from '../../../../../script.js';
import { getSavedHashes, queryCollection } from './core-vector-api.js';
import { getStringHash } from '../../../../utils.js';
import {
    isCollectionEnabled,
    setCollectionEnabled,
    getChunkMetadata,
    saveChunkMetadata,
    deleteChunkMetadata,
    deleteCollectionMeta,
    ensureCollectionMeta,
    getCollectionMeta,
} from './collection-metadata.js';
import { purgeVectorIndex } from './core-vector-api.js';
// Import from collection-ids.js - single source of truth for collection ID operations
import {
    getChatUUID,
    buildChatCollectionId as getChatCollectionId,
    buildLegacyChatCollectionId as getLegacyChatCollectionId,
    parseCollectionId,
    buildChatSearchPatterns,
    matchesPatterns,
    parseRegistryKey,
    COLLECTION_PREFIXES,
} from './collection-ids.js';

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
        saveSettingsDebounced(); // Persist to disk!
    }
}

/**
 * Unregisters a collection from the registry
 * @param {string} collectionId Collection identifier (can be plain id or source:id format)
 */
export function unregisterCollection(collectionId) {
    const registry = getCollectionRegistry();
    const index = registry.indexOf(collectionId);
    if (index !== -1) {
        registry.splice(index, 1);
        console.log(`VectHare: Unregistered collection: ${collectionId}`);
        saveSettingsDebounced(); // Persist to disk!
    } else {
        console.log(`VectHare: Collection not found in registry: ${collectionId}`);
    }
}

/**
 * COMPLETE collection deletion - removes from ALL THREE stores:
 * 1. Vector backend (actual embeddings)
 * 2. Registry (collection tracking)
 * 3. Metadata (display names, settings, chunk info)
 *
 * This is the ONE function that should be called to fully delete a collection.
 * All other delete functions are partial and will leave ghosts.
 *
 * @param {string} collectionId - Collection ID to delete
 * @param {object} settings - VectHare settings (for backend routing)
 * @param {string} [registryKey] - Optional registry key (source:id format) if different from collectionId
 * @returns {Promise<{success: boolean, errors: string[], vectorsDeleted: boolean, registryDeleted: boolean, metadataDeleted: boolean}>}
 */
export async function deleteCollection(collectionId, settings, registryKey = null) {
    const errors = [];
    let vectorsDeleted = false;
    let registryDeleted = false;
    let metadataDeleted = false;

    console.log(`VectHare: Deleting collection ${collectionId} (registry key: ${registryKey || collectionId})`);

    // Step 1: Delete vectors from backend (most important - actual data)
    try {
        await purgeVectorIndex(collectionId, settings);
        vectorsDeleted = true;
        console.log(`VectHare: ✓ Deleted vectors for ${collectionId}`);
    } catch (error) {
        errors.push(`Vectors: ${error.message}`);
        console.warn(`VectHare: ✗ Failed to delete vectors for ${collectionId}:`, error.message);
        // Continue anyway - registry/metadata cleanup is still valuable
    }

    // Step 2: Unregister from registry (try both formats)
    try {
        const keyToUnregister = registryKey || collectionId;
        unregisterCollection(keyToUnregister);

        // Also try the other format if they differ
        if (registryKey && registryKey !== collectionId) {
            unregisterCollection(collectionId);
        }

        registryDeleted = true;
        console.log(`VectHare: ✓ Unregistered ${collectionId}`);
    } catch (error) {
        errors.push(`Registry: ${error.message}`);
        console.warn(`VectHare: ✗ Failed to unregister ${collectionId}:`, error.message);
    }

    // Step 3: Delete metadata
    try {
        deleteCollectionMeta(collectionId);
        metadataDeleted = true;
        console.log(`VectHare: ✓ Deleted metadata for ${collectionId}`);
    } catch (error) {
        errors.push(`Metadata: ${error.message}`);
        console.warn(`VectHare: ✗ Failed to delete metadata for ${collectionId}:`, error.message);
    }

    const success = vectorsDeleted && registryDeleted && metadataDeleted;

    if (success) {
        console.log(`VectHare: ✓ Fully deleted collection ${collectionId}`);
    } else {
        console.warn(`VectHare: Partial deletion of ${collectionId}:`, errors.join(', '));
    }

    return {
        success,
        errors,
        vectorsDeleted,
        registryDeleted,
        metadataDeleted,
    };
}

/**
 * Clears the entire registry (useful for debugging/reset)
 */
export function clearCollectionRegistry() {
    extension_settings.vecthare.vecthare_collection_registry = [];
    console.log('VectHare: Cleared collection registry');
    saveSettingsDebounced(); // Persist to disk!
}

/**
 * Cleans up registry by removing null entries and duplicates
 */
export function cleanupCollectionRegistry() {
    const registry = getCollectionRegistry();
    const cleaned = [...new Set(registry.filter(id => id != null && id !== ''))];
    extension_settings.vecthare.vecthare_collection_registry = cleaned;
    const removed = registry.length - cleaned.length;
    if (removed > 0) {
        console.log(`VectHare: Cleaned registry - removed ${removed} invalid/duplicate entries`);
        saveSettingsDebounced(); // Persist to disk!
    }
    return removed;
}

/**
 * Cleans up test collections from registry (visualizer/production tests)
 * Call this to remove ghost test entries that weren't properly cleaned up
 * @returns {number} Number of test entries removed
 */
export function cleanupTestCollections() {
    const registry = getCollectionRegistry();
    const testPatterns = [
        'vecthare_visualizer_test_',
        '__vecthare_test_',
        'vecthare_test_',
    ];

    const cleaned = registry.filter(id => {
        if (!id) return false;
        // Check if this is a test collection
        for (const pattern of testPatterns) {
            if (id.includes(pattern)) {
                console.log(`VectHare: Removing test collection from registry: ${id}`);
                return false;
            }
        }
        return true;
    });

    const removed = registry.length - cleaned.length;
    if (removed > 0) {
        extension_settings.vecthare.vecthare_collection_registry = cleaned;
        console.log(`VectHare: Cleaned ${removed} test collection entries from registry`);
        saveSettingsDebounced(); // Persist to disk!
    }
    return removed;
}

// parseCollectionId is now imported from collection-ids.js

/**
 * Gets display name for a collection
 * @param {string} collectionId Collection identifier
 * @param {object} metadata Parsed collection metadata
 * @returns {string} Human-readable name
 */
function getCollectionDisplayName(collectionId, metadata) {
    // Check for custom display name first
    const collectionMeta = getCollectionMeta(collectionId);
    if (collectionMeta.displayName) {
        return collectionMeta.displayName;
    }

    // Generate name based on type
    const context = getContext();

    switch (metadata.type) {
        case 'chat': {
            // Try to get chat name from ST
            const chatId = metadata.rawId;

            // Check if it's the current chat
            if (context.chatId === chatId && context.name2) {
                return `💬 Chat: ${context.name2}`;
            }

            // Try to find in characters list
            const character = characters.find(c => c.chat === chatId);
            if (character) {
                return `💬 Chat: ${character.name}`;
            }

            // Fallback to ID
            return `💬 Chat #${chatId.substring(0, 8)}`;
        }

        case 'file':
            return `📄 File: ${metadata.rawId}`;

        case 'lorebook':
            return `📚 Lorebook: ${metadata.rawId}`;

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
            // Key format: "source:collectionId" to handle same collection ID across different sources
            pluginCollectionData = {};
            const uniqueKeys = [];

            for (const collection of data.collections) {
                const collectionData = {
                    chunkCount: collection.chunkCount,
                    source: collection.source,
                    backend: collection.backend || 'standard',
                    model: collection.model || '',  // Primary model path
                    models: collection.models || []  // All available models
                };

                // Cache by "source:id" to avoid collisions when same ID exists in multiple sources
                const cacheKey = `${collection.source}:${collection.id}`;
                pluginCollectionData[cacheKey] = collectionData;
                uniqueKeys.push(cacheKey);

                // Also cache by sanitized version (for LanceDB lookups)
                const sanitized = collection.id.replace(/[^a-zA-Z0-9_.-]/g, '_');
                if (sanitized !== collection.id) {
                    pluginCollectionData[`${collection.source}:${sanitized}`] = collectionData;
                }

                console.log(`VectHare:   - ${collection.id} (${collection.backend}, ${collection.source}, ${collection.chunkCount} chunks)`);
            }

            // IMPORTANT: Replace registry with what plugin found (removes stale entries)
            // This ensures the registry matches actual disk state
            const currentRegistry = getCollectionRegistry();
            const pluginKeySet = new Set(uniqueKeys);

            // Remove entries that no longer exist on disk
            const staleEntries = currentRegistry.filter(key => !pluginKeySet.has(key));
            if (staleEntries.length > 0) {
                console.log(`VectHare: Removing ${staleEntries.length} stale registry entries not found on disk`);
                for (const staleKey of staleEntries) {
                    unregisterCollection(staleKey);
                }
            }

            // Register all discovered collections with source:id format
            for (const key of uniqueKeys) {
                registerCollection(key);
            }

            return uniqueKeys;
        }
    } catch (error) {
        console.error('VectHare: Plugin discovery failed:', error);
    }

    return [];
}

/**
 * Probes a collection ID to check if it exists
 * @param {string} collectionId - Collection ID to probe
 * @param {object} settings - VectHare settings
 * @returns {Promise<{exists: boolean, count: number}>}
 */
async function probeCollection(collectionId, settings) {
    try {
        const hashes = await getSavedHashes(collectionId, settings);
        if (hashes && hashes.length > 0) {
            return { exists: true, count: hashes.length };
        }
    } catch (error) {
        // Collection doesn't exist or error - that's fine
    }
    return { exists: false, count: 0 };
}

/**
 * Discovers existing collections by probing the registry and known patterns
 * Without the plugin, we can't scan the filesystem directly, so we:
 * 1. Check all collections already in the registry (may have been created before)
 * 2. Probe for current chat's collection
 * 3. Probe for collections based on known character names
 *
 * @param {object} settings VectHare settings
 * @returns {Promise<string[]>} Array of discovered collection IDs
 */
async function discoverViaFallback(settings) {
    const context = getContext();
    const discovered = [];
    const probed = new Set();

    console.log('VectHare: Running fallback discovery (no plugin)...');

    // 1. Validate existing registry entries - remove stale ones
    const registry = getCollectionRegistry();
    const validRegistryEntries = [];

    for (const registryKey of [...registry]) {
        if (probed.has(registryKey)) continue;
        probed.add(registryKey);

        // Parse the registry key to get the actual collection ID
        const parsed = parseRegistryKey(registryKey);
        const collectionId = parsed.collectionId;

        const result = await probeCollection(collectionId, settings);
        if (result.exists) {
            validRegistryEntries.push(registryKey);
            if (!discovered.includes(registryKey)) {
                discovered.push(registryKey);
            }
            console.log(`VectHare: Verified registry entry: ${collectionId} (${result.count} chunks)`);
        } else {
            // Remove stale entry
            unregisterCollection(registryKey);
            console.log(`VectHare: Removed stale registry entry: ${registryKey}`);
        }
    }

    // 2. Probe for current chat's collection (both formats)
    if (context.chatId) {
        // New format: vecthare_chat_{charName}_{uuid}
        const newFormatId = getChatCollectionId();
        if (newFormatId && !probed.has(newFormatId)) {
            probed.add(newFormatId);
            const result = await probeCollection(newFormatId, settings);
            if (result.exists) {
                registerCollection(newFormatId);
                discovered.push(newFormatId);
                console.log(`VectHare: Discovered current chat collection: ${newFormatId} (${result.count} chunks)`);
            }
        }

        // Legacy format: vecthare_chat_{chatId}
        const legacyFormatId = getLegacyChatCollectionId(context.chatId);
        if (legacyFormatId && !probed.has(legacyFormatId)) {
            probed.add(legacyFormatId);
            const result = await probeCollection(legacyFormatId, settings);
            if (result.exists) {
                registerCollection(legacyFormatId);
                discovered.push(legacyFormatId);
                console.log(`VectHare: Discovered legacy chat collection: ${legacyFormatId} (${result.count} chunks)`);
            }
        }
    }

    // 3. Probe for character-based collections
    for (const char of characters) {
        if (!char.name) continue;

        const sanitizedName = char.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 30);

        // VectHare character collection format
        const charCollectionId = `${COLLECTION_PREFIXES.VECTHARE_CHARACTER}${sanitizedName}`;
        if (!probed.has(charCollectionId)) {
            probed.add(charCollectionId);
            const result = await probeCollection(charCollectionId, settings);
            if (result.exists) {
                registerCollection(charCollectionId);
                discovered.push(charCollectionId);
                console.log(`VectHare: Discovered character collection: ${charCollectionId} (${result.count} chunks)`);
            }
        }
    }

    // 4. Probe for common content type patterns that might exist
    const contentPatterns = [
        // Lorebook patterns
        `${COLLECTION_PREFIXES.VECTHARE_LOREBOOK}`,
        // Document patterns
        `${COLLECTION_PREFIXES.VECTHARE_DOCUMENT}`,
        // File patterns (legacy)
        `${COLLECTION_PREFIXES.FILE}`,
    ];

    // Note: Without filesystem access, we can't discover collections with unknown IDs
    // The registry is our primary source of truth for non-current-chat collections

    console.log(`VectHare: Fallback discovery complete. Found ${discovered.length} collections.`);
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
 * SINGLE SOURCE OF TRUTH: Check if a specific chat has vectors
 * This runs discovery if needed and checks all possible locations
 * @param {object} settings VectHare settings
 * @param {string} [overrideChatId] Optional chat ID override
 * @param {string} [overrideUUID] Optional UUID override
 * @returns {Promise<{hasVectors: boolean, collectionId: string|null, chunkCount: number}>}
 */
export async function doesChatHaveVectors(settings, overrideChatId, overrideUUID) {
    // Always run discovery first to ensure registry is current
    await discoverExistingCollections(settings);

    const registry = getCollectionRegistry();

    // Get current chat identifiers
    const uuid = overrideUUID || getChatUUID();
    const chatId = overrideChatId || (getContext().chatId);

    // Use unified pattern builder from collection-ids.js
    const searchPatterns = buildChatSearchPatterns(chatId, uuid);

    console.log(`VectHare: Searching for chat vectors. UUID: ${uuid}, Patterns:`, searchPatterns);

    // Collect ALL matching collections, then pick the best one
    // This handles ghost collections (empty) vs real collections (has chunks)
    const matchingCollections = [];

    for (const registryKey of registry) {
        // Use unified registry key parser from collection-ids.js
        const parsed = parseRegistryKey(registryKey);
        const collectionId = parsed.collectionId;

        // Use unified pattern matching from collection-ids.js
        const matches = matchesPatterns(registryKey, searchPatterns) ||
                       matchesPatterns(collectionId, searchPatterns);

        if (matches) {
            // Get chunk count from plugin cache if available
            let chunkCount = 0;
            if (pluginCollectionData && pluginCollectionData[registryKey]) {
                chunkCount = pluginCollectionData[registryKey].chunkCount || 0;
            }

            matchingCollections.push({
                collectionId,
                registryKey,
                chunkCount
            });
            console.log(`VectHare: Found matching collection ${collectionId} (${chunkCount} chunks)`);
        }
    }

    // If we found matches, return ALL of them sorted by chunk count (best first)
    if (matchingCollections.length > 0) {
        // Sort by chunk count descending
        matchingCollections.sort((a, b) => b.chunkCount - a.chunkCount);

        // Add source info from plugin cache
        for (const match of matchingCollections) {
            if (pluginCollectionData && pluginCollectionData[match.registryKey]) {
                match.source = pluginCollectionData[match.registryKey].source;
                match.backend = pluginCollectionData[match.registryKey].backend;
            }
        }

        const best = matchingCollections[0];
        console.log(`VectHare: Found ${matchingCollections.length} matching collection(s), best is ${best.collectionId} with ${best.chunkCount} chunks`);

        return {
            hasVectors: true,
            collectionId: best.collectionId,
            registryKey: best.registryKey,
            chunkCount: best.chunkCount,
            allMatches: matchingCollections  // Return ALL matches for user selection
        };
    }

    // Not found in registry - try direct query as last resort
    const newFormatId = getChatCollectionId(uuid);
    const legacyFormatId = getLegacyChatCollectionId(chatId);

    for (const id of [newFormatId, legacyFormatId].filter(Boolean)) {
        try {
            const hashes = await getSavedHashes(id, settings);
            if (hashes && hashes.length > 0) {
                // Found vectors! Register it now
                registerCollection(id);
                console.log(`VectHare: Found ${hashes.length} vectors via direct query, registered ${id}`);
                return {
                    hasVectors: true,
                    collectionId: id,
                    registryKey: id,
                    chunkCount: hashes.length
                };
            }
        } catch (e) {
            // Query failed, continue to next format
        }
    }

    console.log('VectHare: No vectors found for current chat');
    return { hasVectors: false, collectionId: null, registryKey: null, chunkCount: 0 };
}

/**
 * Loads all collections with metadata
 * @param {object} settings VectHare settings
 * @param {boolean} autoDiscover If true, attempts to discover unregistered collections
 * @returns {Promise<object[]>} Array of collection objects
 */
export async function loadAllCollections(settings, autoDiscover = true) {
    // Clean up registry first (remove nulls and duplicates)
    cleanupCollectionRegistry();

    // Auto-discover existing collections on first load
    if (autoDiscover) {
        await discoverExistingCollections(settings);
    }

    const registry = getCollectionRegistry();
    const collections = [];
    const hasPlugin = pluginAvailable === true;

    for (const registryKey of registry) {
        try {
            // Use unified registry key parser from collection-ids.js
            const parsedKey = parseRegistryKey(registryKey);
            const collectionId = parsedKey.collectionId;
            const registrySource = parsedKey.source;

            console.log(`VectHare: Loading collection: ${collectionId} (source: ${registrySource || 'unknown'})`);

            // First check stored metadata for user-defined contentType (authoritative source)
            const storedMeta = getCollectionMeta(registryKey) || getCollectionMeta(collectionId);
            const parsedMeta = parseCollectionId(collectionId);

            // Use stored contentType if available, otherwise fall back to parsed
            const metadata = {
                type: storedMeta.contentType || parsedMeta.type,
                scope: storedMeta.scope || parsedMeta.scope,
                rawId: parsedMeta.rawId,
            };
            console.log(`VectHare:   Type: ${metadata.type}, Scope: ${metadata.scope}${storedMeta.contentType ? ' (from stored meta)' : ' (parsed from ID)'}`);

            let chunkCount = 0;
            let hashes = [];
            let source = registrySource || 'unknown';
            let backend = 'standard';
            let model = '';
            let models = [];

            // If plugin is available, use chunk count, source, and backend from plugin cache
            // Cache key is "source:collectionId"
            const cacheKey = registryKey;
            if (hasPlugin && pluginCollectionData && pluginCollectionData[cacheKey]) {
                console.log(`VectHare:   Using plugin mode - getting data from cache`);
                const cacheData = pluginCollectionData[cacheKey];
                source = cacheData.source;
                backend = cacheData.backend;
                models = cacheData.models || [];

                // Check if user has a preferred model saved
                const collectionMeta = getCollectionMeta(registryKey);
                const preferredModel = collectionMeta?.preferredModel;

                if (preferredModel !== undefined && models.some(m => m.path === preferredModel)) {
                    // User has a valid preferred model
                    model = preferredModel;
                    const modelInfo = models.find(m => m.path === preferredModel);
                    chunkCount = modelInfo?.chunkCount || 0;
                    console.log(`VectHare:   Using user's preferred model: ${model}`);
                } else {
                    // Use plugin's default (most chunks)
                    model = cacheData.model || '';
                    chunkCount = cacheData.chunkCount || 0;
                }

                console.log(`VectHare:   Plugin reported ${chunkCount} chunks (backend: ${backend}, source: ${source}, models: ${models.length})`);
            } else {
                // Fallback mode: we don't know which backend the collection was created with
                // Try 'standard' first (most common), only try configured backend if standard fails
                console.log(`VectHare:   Using fallback mode - trying standard backend first`);
                const standardSettings = { ...settings, vector_backend: 'standard' };
                try {
                    hashes = await getSavedHashes(collectionId, standardSettings);
                    chunkCount = hashes?.length || 0;
                    console.log(`VectHare:   Found ${chunkCount} hashes via standard backend`);
                } catch (standardError) {
                    // Standard failed, try the configured backend if different
                    if (settings.vector_backend && settings.vector_backend !== 'standard') {
                        console.log(`VectHare:   Standard backend failed, trying ${settings.vector_backend}`);
                        try {
                            hashes = await getSavedHashes(collectionId, settings);
                            chunkCount = hashes?.length || 0;
                            console.log(`VectHare:   Found ${chunkCount} hashes via ${settings.vector_backend}`);
                        } catch (altError) {
                            console.warn(`VectHare:   Both backends failed for ${collectionId}`);
                            chunkCount = 0;
                        }
                    } else {
                        console.warn(`VectHare:   Standard backend failed for ${collectionId}`);
                        chunkCount = 0;
                    }
                }
            }

            // Skip empty collections (no point showing them)
            if (chunkCount === 0) {
                console.log(`VectHare:   Skipping empty collection ${collectionId}`);
                continue;
            }

            const displayName = getCollectionDisplayName(collectionId, metadata);
            console.log(`VectHare:   Display name: ${displayName}`);

            // Use registryKey (source:id) for internal tracking to keep collections unique
            const enabled = isCollectionEnabled(registryKey);
            ensureCollectionMeta(registryKey, { scope: metadata.scope });

            collections.push({
                id: collectionId,           // Original collection ID (for API calls)
                registryKey: registryKey,   // Full key with source (for internal tracking)
                name: displayName,
                type: metadata.type,
                scope: metadata.scope,
                chunkCount: chunkCount,
                enabled: enabled,
                hashes: hashes,
                rawId: metadata.rawId,
                source: source,
                backend: backend,
                model: model,               // Primary model path for vectra lookups
                models: models              // All available models [{name, path, chunkCount}]
            });
            console.log(`VectHare:   ✓ Added to collections list`);
        } catch (error) {
            console.error(`VectHare: Failed to load collection ${registryKey}`, error);
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
        // For other collection types or inactive chats, text is stored in the vector backend
        // and retrieved via the chunks visualizer's query functionality
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
