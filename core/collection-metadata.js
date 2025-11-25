/**
 * VectHare Collection Metadata Manager
 *
 * Manages collection-level metadata in extension_settings.vecthare.collections
 * This is the "settings layer" - user preferences for collections.
 *
 * Separation of concerns:
 * - collection-loader.js = Discovery & loading (talks to vector backends)
 * - collection-metadata.js = Settings & state (talks to extension_settings)
 */

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';

// ============================================================================
// COLLECTION METADATA CRUD
// ============================================================================

/**
 * Default metadata for a new collection
 */
const defaultCollectionMeta = {
    enabled: true,
    activationTrigger: null,
    scope: 'unknown',
    displayName: null,
    description: '',
    tags: [],
    color: null,
    createdAt: null,
    lastUsed: null,
    queryCount: 0,
};

/**
 * Ensures the collections object exists in extension_settings
 */
function ensureCollectionsObject() {
    if (!extension_settings.vecthare) {
        extension_settings.vecthare = {};
    }
    if (!extension_settings.vecthare.collections) {
        extension_settings.vecthare.collections = {};
    }
}

/**
 * Gets metadata for a collection
 * @param {string} collectionId Collection identifier
 * @returns {object} Collection metadata (with defaults applied)
 */
export function getCollectionMeta(collectionId) {
    ensureCollectionsObject();

    const stored = extension_settings.vecthare.collections[collectionId];
    if (!stored) {
        return { ...defaultCollectionMeta };
    }

    // Merge with defaults to ensure all fields exist
    return {
        ...defaultCollectionMeta,
        ...stored,
    };
}

/**
 * Sets metadata for a collection (merges with existing)
 * @param {string} collectionId Collection identifier
 * @param {object} data Metadata to set (partial or full)
 */
export function setCollectionMeta(collectionId, data) {
    if (!collectionId) {
        console.warn('VectHare: setCollectionMeta called with null/undefined collectionId');
        return;
    }

    ensureCollectionsObject();

    const existing = extension_settings.vecthare.collections[collectionId] || {};

    extension_settings.vecthare.collections[collectionId] = {
        ...defaultCollectionMeta,
        ...existing,
        ...data,
    };

    saveSettingsDebounced();
    console.log(`VectHare: Updated metadata for collection ${collectionId}`);
}

/**
 * Deletes metadata for a collection
 * @param {string} collectionId Collection identifier
 */
export function deleteCollectionMeta(collectionId) {
    ensureCollectionsObject();

    if (extension_settings.vecthare.collections[collectionId]) {
        delete extension_settings.vecthare.collections[collectionId];
        saveSettingsDebounced();
        console.log(`VectHare: Deleted metadata for collection ${collectionId}`);
    }
}

/**
 * Gets all collection metadata
 * @returns {object} Map of collectionId -> metadata
 */
export function getAllCollectionMeta() {
    ensureCollectionsObject();
    return extension_settings.vecthare.collections;
}

// ============================================================================
// ENABLED STATE (convenience wrappers)
// ============================================================================

/**
 * Sets whether a collection is enabled
 * @param {string} collectionId Collection identifier
 * @param {boolean} enabled Whether collection is enabled
 */
export function setCollectionEnabled(collectionId, enabled) {
    setCollectionMeta(collectionId, { enabled: enabled });
}

/**
 * Checks if a collection is enabled
 * @param {string} collectionId Collection identifier
 * @returns {boolean} Whether collection is enabled (default: true)
 */
export function isCollectionEnabled(collectionId) {
    const meta = getCollectionMeta(collectionId);
    return meta.enabled !== false;
}

// ============================================================================
// CHUNK METADATA (per-chunk settings, stored separately)
// ============================================================================

/**
 * Gets metadata for a specific chunk
 * @param {string} hash Chunk hash
 * @returns {object|null} Chunk metadata or null if not found
 */
export function getChunkMetadata(hash) {
    if (!extension_settings.vecthare) {
        return null;
    }

    const key = `vecthare_chunk_meta_${hash}`;
    return extension_settings.vecthare[key] || null;
}

/**
 * Saves metadata for a specific chunk
 * @param {string} hash Chunk hash
 * @param {object} metadata Chunk metadata
 */
export function saveChunkMetadata(hash, metadata) {
    if (!extension_settings.vecthare) {
        extension_settings.vecthare = {};
    }

    const key = `vecthare_chunk_meta_${hash}`;
    extension_settings.vecthare[key] = {
        ...metadata,
        updatedAt: Date.now(),
    };

    saveSettingsDebounced();
}

/**
 * Deletes metadata for a specific chunk
 * @param {string} hash Chunk hash
 */
export function deleteChunkMetadata(hash) {
    if (!extension_settings.vecthare) {
        return;
    }

    const key = `vecthare_chunk_meta_${hash}`;
    if (extension_settings.vecthare[key]) {
        delete extension_settings.vecthare[key];
        saveSettingsDebounced();
    }
}

// ============================================================================
// MIGRATION & CLEANUP
// ============================================================================

/**
 * Migrates old scattered enabled keys to new collections structure
 * Old format: vecthare_collection_enabled_{collectionId} = true/false
 * New format: collections[collectionId].enabled = true/false
 */
export function migrateOldEnabledKeys() {
    if (!extension_settings.vecthare) {
        return { migrated: 0 };
    }

    ensureCollectionsObject();

    let migrated = 0;
    const keysToDelete = [];

    for (const key in extension_settings.vecthare) {
        if (key.startsWith('vecthare_collection_enabled_')) {
            const collectionId = key.replace('vecthare_collection_enabled_', '');
            const enabled = extension_settings.vecthare[key];

            // Only migrate if we don't already have metadata for this collection
            if (!extension_settings.vecthare.collections[collectionId]) {
                extension_settings.vecthare.collections[collectionId] = {
                    ...defaultCollectionMeta,
                    enabled: enabled !== false,
                };
                console.log(`VectHare: Migrated enabled key for ${collectionId}`);
            }

            keysToDelete.push(key);
            migrated++;
        }
    }

    // Delete old keys
    for (const key of keysToDelete) {
        delete extension_settings.vecthare[key];
    }

    if (migrated > 0) {
        saveSettingsDebounced();
        console.log(`VectHare: Migrated ${migrated} old enabled keys to new collections structure`);
    }

    return { migrated };
}

/**
 * Cleans up orphaned metadata entries (collections that no longer exist)
 * @param {string[]} actualCollectionIds Array of collection IDs that actually exist
 * @returns {object} Cleanup stats
 */
export function cleanupOrphanedMeta(actualCollectionIds) {
    ensureCollectionsObject();

    const actualSet = new Set(actualCollectionIds);
    const orphaned = [];

    for (const collectionId in extension_settings.vecthare.collections) {
        if (!actualSet.has(collectionId)) {
            orphaned.push(collectionId);
        }
    }

    for (const collectionId of orphaned) {
        delete extension_settings.vecthare.collections[collectionId];
        console.log(`VectHare: Removed orphaned metadata for ${collectionId}`);
    }

    if (orphaned.length > 0) {
        saveSettingsDebounced();
        console.log(`VectHare: Cleaned up ${orphaned.length} orphaned metadata entries`);
    }

    return { removed: orphaned.length, orphanedIds: orphaned };
}

/**
 * Ensures a collection has metadata (creates with defaults if missing)
 * Called when a collection is discovered/created
 * @param {string} collectionId Collection identifier
 * @param {object} initialData Optional initial data to set
 */
export function ensureCollectionMeta(collectionId, initialData = {}) {
    if (!collectionId) {
        return;
    }

    ensureCollectionsObject();

    if (!extension_settings.vecthare.collections[collectionId]) {
        extension_settings.vecthare.collections[collectionId] = {
            ...defaultCollectionMeta,
            createdAt: Date.now(),
            ...initialData,
        };
        saveSettingsDebounced();
        console.log(`VectHare: Created metadata for new collection ${collectionId}`);
    }
}

/**
 * Updates lastUsed timestamp and increments queryCount
 * Called when a collection is queried
 * @param {string} collectionId Collection identifier
 */
export function recordCollectionUsage(collectionId) {
    if (!collectionId) {
        return;
    }

    ensureCollectionsObject();

    const existing = extension_settings.vecthare.collections[collectionId];
    if (existing) {
        existing.lastUsed = Date.now();
        existing.queryCount = (existing.queryCount || 0) + 1;
        saveSettingsDebounced();
    }
}
