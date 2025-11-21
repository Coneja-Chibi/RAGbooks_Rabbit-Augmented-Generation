/**
 * Rabbit Augmented Generation - State Management
 *
 * WHY: Centralized state management ensures consistent data structure and
 * prevents the orphaned data / inconsistent structure issues of old RAGBooks.
 *
 * This module provides:
 * - Canonical state structure (defined once, used everywhere)
 * - State CRUD operations (with validation)
 * - Scope management (global/character/chat)
 * - State validation (prevent corruption)
 */

import { Diagnostics } from './core-system.js';
import { extension_settings } from '../../../extensions.js';

// IMPORTANT: This must match EXTENSION_ID in index.js ('rabbit-rag')
// NOT the display name 'Rabbit Augmented Generation'
export const extensionName = 'rabbit-rag';

// WHY: Define canonical structure ONCE to prevent inconsistencies
const CANONICAL_STATE = {
    version: '2.0.0',
    settings: {
        enabled: true,
        topK: 5,
        threshold: 0.5,
        vectorWeight: 0.7,
        keywordWeight: 0.3,
        contextWindow: 10,
        injectionDepth: 4,
        injectionRole: 'system',
        injectionTemplate: 'default',
        enableImportance: true,
        enableConditions: true,
        enableGroups: true,
        enableDecay: true,
        enableDualVector: false,
        decayMode: 'exponential',
        decayHalfLife: 10,
        groupBoostMultiplier: 1.5,
        orangeMode: false, // Visual theme
        similarityAlgorithm: 'cosine', // 'cosine', 'jaccard', or 'hamming' (ST-Helpers)
        useServerSideSearch: false // If true, use /api/vector/query instead of client-side
    },
    sources: {
        // [collectionId]: { id, name, type, scope, config, chunkCount, createdAt, enabled }
    },
    libraries: {
        global: {
            // [collectionId]: { [hash]: chunk }
        },
        character: {
            // [characterId]: { [collectionId]: { [hash]: chunk } }
        },
        chat: {
            // [chatId]: { [collectionId]: { [hash]: chunk } }
        }
    },
    metadata: {
        // [collectionId]: { alwaysActive, activationKeywords, conditions, groups, ... }
    }
};

export class State {
    /**
     * Initialize state
     * WHY: Ensures state exists and has correct structure before use
     */
    static init() {
        console.log('[RAG:STATE] Initializing state...');

        if (!extension_settings) {
            console.warn('[RAG:STATE] extension_settings not yet available, deferring initialization');
            // Will be initialized on first getState() call instead
            return;
        }

        // Debug: log what's in extension_settings for this extension
        console.log('[RAG:STATE] Checking extension_settings keys:', Object.keys(extension_settings));
        console.log('[RAG:STATE] Looking for data under key:', extensionName);

        // Check for old data locations
        if (extension_settings.rag) {
            console.log('[RAG:STATE] Found old "rag" key with:', Object.keys(extension_settings.rag));
        }
        if (extension_settings['Rabbit Augmented Generation']) {
            console.log('[RAG:STATE] Found old "Rabbit Augmented Generation" key');
        }

        if (!extension_settings[extensionName]) {
            console.log('[RAG:STATE] No existing state found, checking for old data to migrate...');

            // Try to migrate from old locations
            this._migrateFromOldLocations();

            // If still nothing, create new state
            if (!extension_settings[extensionName]) {
                console.log('[RAG:STATE] Creating new state with canonical structure');
                extension_settings[extensionName] = structuredClone(CANONICAL_STATE);
            }
        } else {
            console.log('[RAG:STATE] Existing state found, migrating to canonical structure...');

            // Migrate FIRST (this will add missing fields)
            this._migrateToCanonical();

            // Then validate
            this.validateState();
        }

        console.log('[RAG:STATE] State initialized');
    }

    /**
     * Get the entire state object
     * WHY: Direct access for advanced operations
     */
    static getState() {
        // Check if extension_settings is available
        if (!extension_settings) {
            throw new Error('[RAG:STATE] extension_settings not available - cannot access state');
        }

        // Auto-initialize if not already initialized
        if (!extension_settings[extensionName]) {
            console.log('[RAG:STATE] State not initialized, auto-initializing...');
            this.init();

            // Verify initialization succeeded
            if (!extension_settings[extensionName]) {
                console.error('[RAG:STATE] Auto-initialization failed, creating emergency state');
                extension_settings[extensionName] = structuredClone(CANONICAL_STATE);
            }
        }

        const state = extension_settings[extensionName];

        // DEFENSIVE: Ensure critical keys always exist
        if (!state.version) {
            console.warn('[RAG:STATE] Version key missing, adding it now');
            state.version = CANONICAL_STATE.version;
        }
        if (!state.settings) {
            console.warn('[RAG:STATE] Settings key missing, initializing');
            state.settings = structuredClone(CANONICAL_STATE.settings);
        }
        if (!state.sources) {
            console.warn('[RAG:STATE] Sources key missing, initializing');
            state.sources = {};
        }
        if (!state.libraries) {
            console.warn('[RAG:STATE] Libraries key missing, initializing');
            state.libraries = { global: {}, character: {}, chat: {} };
        }
        if (!state.metadata) {
            console.warn('[RAG:STATE] Metadata key missing, initializing');
            state.metadata = {};
        }

        return state;
    }

    // ==================== SETTINGS ====================

    /**
     * Get all settings
     * WHY: Read entire settings object
     */
    static getSettings() {
        const state = this.getState();

        // Defensive: ensure settings exists
        if (!state.settings) {
            console.warn('[RAG:STATE] Settings object missing, initializing default settings');
            state.settings = CANONICAL_STATE.settings;
        }

        return state.settings;
    }

    /**
     * Get a specific setting
     * WHY: Type-safe access to individual settings
     */
    static getSetting(key) {
        const settings = this.getSettings();
        if (!(key in settings)) {
            console.warn(`[RAG:STATE] Unknown setting: ${key}`);
            return undefined;
        }
        return settings[key];
    }

    /**
     * Update a setting
     * WHY: Validate and save individual setting changes
     */
    static updateSetting(key, value) {
        const settings = this.getSettings();

        if (!(key in settings)) {
            throw new Error(`Unknown setting: ${key}`);
        }

        // Type validation
        const expectedType = typeof settings[key];
        const actualType = typeof value;

        if (expectedType !== actualType) {
            throw new Error(`Setting ${key} expects ${expectedType}, got ${actualType}`);
        }

        // Range validation for numeric settings
        if (typeof value === 'number') {
            if (key === 'topK' && (value < 1 || value > 20)) {
                throw new Error('topK must be between 1 and 20');
            }
            if (key === 'threshold' && (value < 0 || value > 1)) {
                throw new Error('threshold must be between 0 and 1');
            }
            if (key === 'vectorWeight' && (value < 0 || value > 1)) {
                throw new Error('vectorWeight must be between 0 and 1');
            }
            if (key === 'keywordWeight' && (value < 0 || value > 1)) {
                throw new Error('keywordWeight must be between 0 and 1');
            }
            if (key === 'injectionDepth' && (value < 1 || value > 10)) {
                throw new Error('injectionDepth must be between 1 and 10');
            }
            if (key === 'contextWindow' && (value < 1 || value > 100)) {
                throw new Error('contextWindow must be between 1 and 100');
            }
        }

        settings[key] = value;
        this.saveSettings();

        console.log(`[RAG:STATE] Setting updated: ${key} = ${value}`);
    }

    /**
     * Save settings to extension_settings
     * WHY: Persist settings changes
     */
    static saveSettings() {
        // Check if SillyTavern's save function is available (may not be during early init)
        if (typeof window.saveSettingsDebounced === 'function') {
            window.saveSettingsDebounced();
        } else {
            console.warn('[RAG:STATE] saveSettingsDebounced not available yet, settings will save on next change');
        }
    }

    // ==================== SOURCES ====================

    /**
     * Get a source by ID
     * WHY: Retrieve collection metadata
     */
    static getSource(id) {
        return this.getState().sources[id] || null;
    }

    /**
     * Get all sources
     * WHY: List all collections
     */
    static getSources(filter = null) {
        const state = this.getState();

        // Defensive: ensure sources exists
        if (!state.sources) {
            console.warn('[RAG:STATE] Sources object missing, initializing empty sources');
            state.sources = {};
        }

        const sources = Object.values(state.sources);

        if (!filter) return sources;

        // Apply filter function
        return sources.filter(filter);
    }

    /**
     * Get sources for current scope
     * WHY: Filter sources by scope (global/character/chat)
     */
    static getScopedSources(scopeType = null, identifier = null) {
        const scope = scopeType ? { type: scopeType, identifier } : this.getCurrentScope();

        return this.getSources(source => {
            if (source.scope === 'global') return true;
            if (source.scope === 'character' && scope.type === 'character') {
                return source.scopeIdentifier === scope.identifier;
            }
            if (source.scope === 'chat' && scope.type === 'chat') {
                return source.scopeIdentifier === scope.identifier;
            }
            return false;
        });
    }

    /**
     * Get active collections (enabled collections only)
     * WHY: For auto-search on message send
     */
    static getActiveCollections() {
        return this.getAllCollections().filter(c => c.enabled !== false);
    }

    /**
     * Get collections by scope type
     * WHY: For character/chat event handlers
     * @param {string} scopeType - 'global', 'character', or 'chat'
     */
    static getCollectionsByScope(scopeType) {
        const scope = this.getCurrentScope();
        const identifier = scopeType === 'global' ? null : scope.identifier;
        return this.getScopedSources(scopeType, identifier);
    }

    /**
     * Save a source
     * WHY: Create or update collection metadata
     */
    static saveSource(id, data) {
        if (!id) {
            throw new Error('Source ID is required');
        }

        // Validate required fields
        const requiredFields = ['name', 'type', 'scope'];
        for (const field of requiredFields) {
            if (!data[field]) {
                throw new Error(`Source missing required field: ${field}`);
            }
        }

        // Valid types
        const validTypes = ['lorebook', 'character', 'chat', 'custom'];
        if (!validTypes.includes(data.type)) {
            throw new Error(`Invalid source type: ${data.type}`);
        }

        // Valid scopes
        const validScopes = ['global', 'character', 'chat'];
        if (!validScopes.includes(data.scope)) {
            throw new Error(`Invalid scope: ${data.scope}`);
        }

        this.getState().sources[id] = {
            id,
            ...data,
            updatedAt: Date.now()
        };

        this.saveSettings();
        console.log(`[RAG:STATE] Source saved: ${id}`);
    }

    /**
     * Delete a source
     * WHY: Remove collection and cleanup related data
     */
    static deleteSource(id) {
        const source = this.getSource(id);

        if (!source) {
            console.warn(`[RAG:STATE] Source not found: ${id}`);
            return;
        }

        // Delete source
        delete this.getState().sources[id];

        // Delete library
        this.deleteChunks(id, source.scope, source.scopeIdentifier);

        // Delete metadata
        delete this.getState().metadata[id];

        this.saveSettings();
        console.log(`[RAG:STATE] Source deleted: ${id}`);
    }

    // ==================== LIBRARIES (CHUNKS) ====================

    /**
     * Get library for a collection
     * WHY: Retrieve all chunks for a collection
     */
    static getLibrary(collectionId, scope, identifier = null) {
        const state = this.getState();

        // Defensive: ensure libraries exists
        if (!state.libraries) {
            console.warn('[RAG:STATE] Libraries object missing, initializing empty libraries');
            state.libraries = { global: {}, character: {}, chat: {} };
        }

        if (scope === 'global') {
            if (!state.libraries.global) state.libraries.global = {};
            return state.libraries.global[collectionId] || null;
        } else if (scope === 'character') {
            if (!state.libraries.character) state.libraries.character = {};
            return state.libraries.character[identifier]?.[collectionId] || null;
        } else if (scope === 'chat') {
            if (!state.libraries.chat) state.libraries.chat = {};
            return state.libraries.chat[identifier]?.[collectionId] || null;
        }

        return null;
    }

    /**
     * Get chunks array for a collection
     * WHY: Convert library object to array of chunks
     */
    static getChunks(collectionId, scope, identifier = null) {
        const library = this.getLibrary(collectionId, scope, identifier);

        if (!library) return [];

        return Object.values(library);
    }

    /**
     * Save chunks for a collection
     * WHY: Store chunks with validation
     */
    static saveChunks(collectionId, chunks, scope, identifier = null) {
        if (!collectionId) {
            throw new Error('Collection ID is required');
        }

        if (!Array.isArray(chunks)) {
            throw new Error('Chunks must be an array');
        }

        // Validate chunks
        this.validateChunks(chunks);

        // Convert array to object (keyed by hash)
        // Also add collectionId to each chunk for plugin enrichment
        const library = {};
        for (const chunk of chunks) {
            library[chunk.hash] = {
                ...chunk,
                collectionId  // Add collectionId so chunks know which collection they belong to
            };
        }

        const state = this.getState();

        // Store in appropriate scope
        if (scope === 'global') {
            state.libraries.global[collectionId] = library;
        } else if (scope === 'character') {
            if (!identifier) {
                throw new Error('Character identifier required for character scope');
            }
            if (!state.libraries.character[identifier]) {
                state.libraries.character[identifier] = {};
            }
            state.libraries.character[identifier][collectionId] = library;
        } else if (scope === 'chat') {
            if (!identifier) {
                throw new Error('Chat identifier required for chat scope');
            }
            if (!state.libraries.chat[identifier]) {
                state.libraries.chat[identifier] = {};
            }
            state.libraries.chat[identifier][collectionId] = library;
        } else {
            throw new Error(`Invalid scope: ${scope}`);
        }

        this.saveSettings();
        console.log(`[RAG:STATE] Saved ${chunks.length} chunks to ${collectionId} (${scope})`);
    }

    /**
     * Delete chunks for a collection
     * WHY: Clean up collection data
     */
    static deleteChunks(collectionId, scope, identifier = null) {
        const state = this.getState();

        if (scope === 'global') {
            delete state.libraries.global[collectionId];
        } else if (scope === 'character' && identifier) {
            delete state.libraries.character[identifier]?.[collectionId];
        } else if (scope === 'chat' && identifier) {
            delete state.libraries.chat[identifier]?.[collectionId];
        }

        this.saveSettings();
        console.log(`[RAG:STATE] Deleted chunks for ${collectionId}`);
    }

    // ==================== UI-CHUNKS.JS COMPATIBILITY LAYER ====================
    // WHY: ui-chunks.js expects different method signatures
    // These methods bridge between ui-chunks.js expectations and our State API

    /**
     * Get all collections (for ui-chunks.js compatibility)
     * WHY: ui-chunks.js calls State.getAllCollections()
     */
    static getAllCollections() {
        const sources = this.getSources();
        const scope = this.getCurrentScope();

        // Transform sources to include chunks
        return sources.map(source => {
            const chunks = this.getChunks(source.id, source.scope, source.scopeIdentifier);
            return {
                id: source.id,
                name: source.name,
                type: source.type,
                scope: source.scope,
                chunks: chunks,
                chunkCount: chunks.length,
                enabled: source.enabled !== false,
                createdAt: source.createdAt,
                updatedAt: source.updatedAt
            };
        });
    }

    /**
     * Get single collection with chunks (for ui-chunks.js compatibility)
     * WHY: ui-chunks.js calls State.getCollection(collectionId)
     */
    static getCollection(collectionId) {
        const source = this.getSource(collectionId);
        if (!source) return null;

        const chunks = this.getChunks(collectionId, source.scope, source.scopeIdentifier);

        return {
            id: source.id,
            name: source.name,
            type: source.type,
            scope: source.scope,
            chunks: chunks,
            chunkCount: chunks.length,
            enabled: source.enabled !== false,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt
        };
    }

    /**
     * Update a single chunk (for ui-chunks.js compatibility)
     * WHY: ui-chunks.js calls State.updateChunk(collectionId, hash, updates)
     */
    static updateChunk(collectionId, chunkHash, updates) {
        const source = this.getSource(collectionId);
        if (!source) {
            throw new Error(`Collection not found: ${collectionId}`);
        }

        const library = this.getLibrary(collectionId, source.scope, source.scopeIdentifier);
        if (!library || !library[chunkHash]) {
            throw new Error(`Chunk not found: ${chunkHash} in ${collectionId}`);
        }

        // Update chunk
        library[chunkHash] = {
            ...library[chunkHash],
            ...updates,
            updatedAt: Date.now()
        };

        this.saveSettings();
        console.log(`[RAG:STATE] Updated chunk ${chunkHash} in ${collectionId}`);
    }

    /**
     * Delete a single chunk (for ui-chunks.js compatibility)
     * WHY: ui-chunks.js calls State.deleteChunk(collectionId, hash)
     */
    static deleteChunk(collectionId, chunkHash) {
        const source = this.getSource(collectionId);
        if (!source) {
            throw new Error(`Collection not found: ${collectionId}`);
        }

        const library = this.getLibrary(collectionId, source.scope, source.scopeIdentifier);
        if (!library) {
            throw new Error(`Library not found for: ${collectionId}`);
        }

        delete library[chunkHash];

        this.saveSettings();
        console.log(`[RAG:STATE] Deleted chunk ${chunkHash} from ${collectionId}`);
    }

    // ==================== METADATA ====================

    /**
     * Get metadata for a collection
     * WHY: Retrieve collection settings (activation, conditions, etc.)
     */
    static getMetadata(collectionId) {
        const state = this.getState();

        // Defensive: ensure metadata exists
        if (!state.metadata) {
            console.warn('[RAG:STATE] Metadata object missing, initializing empty metadata');
            state.metadata = {};
        }

        return state.metadata[collectionId] || {};
    }

    /**
     * Update metadata for a collection
     * WHY: Save collection settings
     */
    static updateMetadata(collectionId, data) {
        const state = this.getState();

        // Defensive: ensure metadata exists
        if (!state.metadata) {
            console.warn('[RAG:STATE] Metadata object missing, initializing empty metadata');
            state.metadata = {};
        }

        if (!state.metadata[collectionId]) {
            state.metadata[collectionId] = {};
        }

        Object.assign(state.metadata[collectionId], data);
        this.saveSettings();

        console.log(`[RAG:STATE] Metadata updated for ${collectionId}`);
    }

    // ==================== SCOPE RESOLUTION ====================

    /**
     * Get current scope (global/character/chat)
     * WHY: Determine which collections should be active
     */
    static getCurrentScope() {
        // Check if in a chat
        if (window.chat && window.chat.length > 0) {
            const chatId = window.chat_metadata?.file_name || 'default';

            // Check if character-specific
            const characterId = window.this_chid;
            if (characterId !== undefined && characterId !== null) {
                const characters = window.getContext().characters;
                const character = characters[characterId];

                if (character) {
                    return {
                        type: 'character',
                        identifier: character.avatar // Use avatar as unique ID
                    };
                }
            }

            return {
                type: 'chat',
                identifier: chatId
            };
        }

        // Default to global
        return {
            type: 'global',
            identifier: null
        };
    }

    /**
     * Resolve scope for a collection
     * WHY: Look up collection's scope from sources
     */
    static resolveScope(collectionId) {
        const source = this.getSource(collectionId);

        if (!source) {
            return null;
        }

        return {
            type: source.scope,
            identifier: source.scopeIdentifier || null
        };
    }

    // ==================== COLLECTION RECOVERY ====================

    /**
     * Fix collections stored in the wrong scope
     * WHY: Automatically repair collections where metadata says "chat" but data is in "global" (or vice versa)
     * @returns {Promise<Array>} List of fixed collections
     */
    static async fixScopeMismatches() {
        const sources = this.getSources();
        const fixed = [];
        const state = this.getState();

        console.log('[RAG:STATE:RECOVERY] Checking for scope mismatches...');

        for (const source of sources) {
            // Check if chunks exist in the EXPECTED location
            const library = this.getLibrary(source.id, source.scope, source.scopeIdentifier);
            
            // If library exists and has chunks, this source is fine
            if (library && Object.keys(library).length > 0) {
                continue;
            }

            // If we're here, the chunks are missing from the expected location.
            // Let's hunt for them in other scopes.
            
            let foundLibrary = null;
            let foundScope = null;
            let foundIdentifier = null;

            // Check Global
            if (state.libraries.global?.[source.id]) {
                foundLibrary = state.libraries.global[source.id];
                foundScope = 'global';
            }

            // Check Character Scopes
            if (!foundLibrary && state.libraries.character) {
                for (const [charId, lib] of Object.entries(state.libraries.character)) {
                    if (lib[source.id]) {
                        foundLibrary = lib[source.id];
                        foundScope = 'character';
                        foundIdentifier = charId;
                        break;
                    }
                }
            }

            // Check Chat Scopes
            if (!foundLibrary && state.libraries.chat) {
                for (const [chatId, lib] of Object.entries(state.libraries.chat)) {
                    if (lib[source.id]) {
                        foundLibrary = lib[source.id];
                        foundScope = 'chat';
                        foundIdentifier = chatId;
                        break;
                    }
                }
            }

            // If found somewhere else, update the source metadata to match the data
            if (foundLibrary) {
                console.log(`[RAG:STATE:RECOVERY] Found misplaced collection ${source.id} in ${foundScope} scope (expected ${source.scope})`);
                
                // Update source
                source.scope = foundScope;
                source.scopeIdentifier = foundIdentifier;
                this.saveSource(source.id, source); // Save corrected metadata
                
                fixed.push({
                    id: source.id,
                    name: source.name,
                    oldScope: source.scope,
                    newScope: foundScope
                });
            }
        }

        if (fixed.length > 0) {
            console.log(`[RAG:STATE:RECOVERY] Fixed ${fixed.length} scope mismatches`);
            // Force save
            this.saveSettings();
        }

        return fixed;
    }

    /**
     * Check for orphaned collections in old storage location
     * WHY: Detect collections that need to be recovered due to previous bugs
     * @returns {Array} List of orphaned collection metadata
     */
    static async checkForOrphanedData() {
        const orphaned = [];

        // Check old buggy storage location: extension_settings.rag.collections
        if (extension_settings.rag?.collections) {
            const oldCollections = extension_settings.rag.collections;
            console.log(`[RAG:STATE:RECOVERY] Found ${Object.keys(oldCollections).length} collections in old storage`);

            for (const [collectionId, metadata] of Object.entries(oldCollections)) {
                // Check if already exists in correct location
                if (this.getSource(collectionId)) {
                    continue; // Already migrated
                }

                orphaned.push({
                    id: collectionId,
                    name: metadata.sourceName || collectionId,
                    type: metadata.sourceType || 'unknown',
                    scope: metadata.scope || 'global',
                    metadata: metadata
                });
            }
        }

        console.log(`[RAG:STATE:RECOVERY] Found ${orphaned.length} orphaned collections`);
        return orphaned;
    }

    /**
     * Recover orphaned collections from old storage location
     * WHY: Migrate collections from buggy storage location to correct canonical location
     * @returns {Array} List of successfully recovered collections
     */
    static async recoverOrphanedCollections() {
        const recovered = [];
        
        // Feature: Multi-source discovery
        // We scan all common providers because the user might have switched providers
        // but the data is still in the old provider's folder.
        const knownSources = ['transformers', 'palm', 'openai', 'cohere', 'nomicai', 'llamacpp'];
        
        console.log(`[RAG:STATE:RECOVERY] Starting deep recovery scan across sources: ${knownSources.join(', ')}`);

        // 1. Get all collections from State (metadata only)
        const stateSources = this.getSources();
        const stateIds = new Set(stateSources.map(s => s.id));

        // 2. Also check old storage for IDs to recover
        if (extension_settings.rag?.collections) {
            Object.keys(extension_settings.rag.collections).forEach(id => stateIds.add(id));
        }

        // 3. If we have a specific collection ID causing trouble (from UI), add it
        // (This is implicit as we iterate over known IDs, but we also want to find UNKNOWN IDs)
        // Limitation: We can't "list all folders" via client API easily without a custom endpoint.
        // So we iterate over the IDs we *know about* (from state or old storage) and try to find them.

        for (const collectionId of stateIds) {
            let foundChunks = false;
            console.log(`[RAG:RECOVERY] 🔍 Scanning for collection: ${collectionId}`);

            for (const source of knownSources) {
                console.log(`[RAG:RECOVERY]   ➜ Checking source: ${source}...`);
                try {
                    // Try to fetch from this source
                    const response = await fetch('/api/plugins/rabbit-rag-vectors/list-with-vectors', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ collectionId, source })
                    });

                    console.log(`[RAG:RECOVERY]   ➜ Status: ${response.status} ${response.statusText}`);

                    if (response.ok) {
                        const data = await response.json();
                        console.log(`[RAG:RECOVERY]   ➜ Items found: ${data.items?.length || 0}`);
                        
                        if (data.items && data.items.length > 0) {
                            console.log(`[RAG:STATE:RECOVERY] ✅ Found ${data.items.length} chunks for ${collectionId} in source: ${source}`);
                            
                            // Found data! Restore it.
                            const chunks = data.items.map(item => ({
                                hash: item.hash,
                                text: item.text,
                                index: item.index,
                                embedding: item.vector,
                                // Restore default metadata if missing
                                systemKeywords: [],
                                customKeywords: [],
                                customWeights: {},
                                disabledKeywords: [],
                                name: '',
                                comment: '',
                                importance: 100,
                                disabled: false
                            }));

                            // Determine scope from existing metadata or guess
                            let scope = 'global';
                            let scopeIdentifier = null;
                            
                            // Check existing metadata
                            const existing = this.getSource(collectionId) || (extension_settings.rag?.collections?.[collectionId]);
                            if (existing) {
                                scope = existing.scope || 'global';
                                scopeIdentifier = existing.scopeIdentifier || null;
                            } else if (collectionId.includes('_chat_')) {
                                scope = 'chat';
                                const match = collectionId.match(/_chat_(.+)$/);
                                if (match) scopeIdentifier = match[1];
                            } else if (collectionId.includes('_charid_')) {
                                scope = 'character';
                                const match = collectionId.match(/_charid_(.+)$/);
                                if (match) scopeIdentifier = match[1];
                            }

                            // Save chunks
                            this.saveChunks(collectionId, chunks, scope, scopeIdentifier);

                            // Update/Create Source Metadata
                            const sourceData = {
                                id: collectionId,
                                name: existing?.name || existing?.sourceName || collectionId,
                                type: existing?.type || existing?.sourceType || 'custom',
                                scope: scope,
                                scopeIdentifier: scopeIdentifier,
                                vectorSource: source, // IMPORTANT: Save the correct source
                                enabled: true,
                                chunkCount: chunks.length,
                                lastRecovered: Date.now()
                            };
                            this.saveSource(collectionId, sourceData);

                            recovered.push(sourceData);
                            foundChunks = true;
                            break; // Stop checking other sources for this ID
                        }
                    } else {
                        const errText = await response.text();
                        console.warn(`[RAG:RECOVERY]   ➜ Failed check for ${source}: ${errText}`);
                    }
                } catch (e) {
                    console.error(`[RAG:RECOVERY]   ➜ Error checking ${source}:`, e);
                }
            }

            if (!foundChunks) {
                console.warn(`[RAG:STATE:RECOVERY] Could not locate chunks for ${collectionId} in any known source.`);
            }
        }

        // Clean up old storage if we recovered anything
        if (recovered.length > 0 && extension_settings.rag?.collections) {
            // Only delete if we're sure we migrated everything? 
            // Safety: Keep old storage for now, just mark as migrated
            console.log(`[RAG:STATE:RECOVERY] Recovered ${recovered.length} collections`);
        }

        return recovered;
    }

    // ==================== VALIDATION ====================

    /**
     * Validate state structure
     * WHY: Ensure state hasn't been corrupted
     */
    static validateState() {
        const state = this.getState();

        // Check required top-level keys
        const requiredKeys = ['version', 'settings', 'sources', 'libraries', 'metadata'];
        for (const key of requiredKeys) {
            if (!(key in state)) {
                throw new Error(`State missing required key: ${key}`);
            }
        }

        // Check libraries structure
        if (!state.libraries.global || !state.libraries.character || !state.libraries.chat) {
            throw new Error('Invalid libraries structure');
        }

        console.log('[RAG:STATE] State structure valid');
    }

    /**
     * Validate chunks before saving
     * WHY: Prevent corrupted chunks from being stored
     */
    static validateChunks(chunks) {
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            // Required fields
            if (!chunk.hash) {
                throw new Error(`Chunk ${i} missing hash`);
            }
            if (!chunk.text || chunk.text.trim().length === 0) {
                throw new Error(`Chunk ${i} missing or empty text`);
            }
            if (!chunk.embedding || !Array.isArray(chunk.embedding)) {
                throw new Error(`Chunk ${i} missing or invalid embedding`);
            }
            if (!Array.isArray(chunk.keywords)) {
                throw new Error(`Chunk ${i} missing keywords array`);
            }

            // Validate embedding
            if (chunk.embedding.length === 0) {
                throw new Error(`Chunk ${i} has empty embedding array`);
            }
            if (chunk.embedding.some(v => isNaN(v) || v === null || v === undefined)) {
                throw new Error(`Chunk ${i} has invalid values in embedding (NaN/null/undefined)`);
            }

            // Validate importance
            if (chunk.importance !== undefined) {
                if (typeof chunk.importance !== 'number' || chunk.importance < 0) {
                    throw new Error(`Chunk ${i} has invalid importance value`);
                }
            }
        }

        console.log(`[RAG:STATE] Validated ${chunks.length} chunks`);
    }

    /**
     * Migrate from old storage locations
     * WHY: Handle data from previous versions stored under different keys
     * @private
     */
    static _migrateFromOldLocations() {
        console.log('[RAG:STATE] Checking old storage locations for data to migrate...');

        let migratedData = null;

        // FIRST: Check current key but old structure (.collections instead of .sources)
        if (extension_settings[extensionName]?.collections) {
            console.log('[RAG:STATE] Found data under current key (rabbit-rag.collections)');
            migratedData = extension_settings[extensionName];
        }
        // Check old 'rag' key (from very early versions)
        else if (extension_settings.rag) {
            console.log('[RAG:STATE] Found data under old "rag" key');
            migratedData = extension_settings.rag;
        }

        // Check old 'Rabbit Augmented Generation' key (from before we switched to 'rabbit-rag')
        else if (extension_settings['Rabbit Augmented Generation']) {
            console.log('[RAG:STATE] Found data under old "Rabbit Augmented Generation" key');
            migratedData = extension_settings['Rabbit Augmented Generation'];
        }

        if (!migratedData) {
            console.log('[RAG:STATE] No old data found to migrate');
            return;
        }

        // Create new canonical state
        const newState = structuredClone(CANONICAL_STATE);

        // Migrate settings
        if (migratedData.settings) {
            console.log('[RAG:STATE] Migrating settings from old location');
            Object.assign(newState.settings, migratedData.settings);
        }

        // Migrate collections to sources
        if (migratedData.collections) {
            console.log('[RAG:STATE] Migrating collections to sources:', Object.keys(migratedData.collections).length);
            for (const [collectionId, collectionData] of Object.entries(migratedData.collections)) {
                newState.sources[collectionId] = {
                    id: collectionId,
                    name: collectionData.sourceName || collectionData.name || collectionId,
                    type: collectionData.sourceType || collectionData.type || 'custom',
                    scope: collectionData.scope || 'global',
                    scopeIdentifier: collectionData.scopeIdentifier || null,
                    enabled: collectionData.enabled !== false,
                    createdAt: collectionData.createdAt || Date.now(),
                    updatedAt: Date.now()
                };
            }
        }

        // Migrate sources (if already in new format)
        if (migratedData.sources) {
            console.log('[RAG:STATE] Migrating sources:', Object.keys(migratedData.sources).length);
            Object.assign(newState.sources, migratedData.sources);
        }

        // Migrate libraries (chunk data)
        if (migratedData.libraries) {
            console.log('[RAG:STATE] Migrating libraries');
            if (migratedData.libraries.global) {
                Object.assign(newState.libraries.global, migratedData.libraries.global);
            }
            if (migratedData.libraries.character) {
                Object.assign(newState.libraries.character, migratedData.libraries.character);
            }
            if (migratedData.libraries.chat) {
                Object.assign(newState.libraries.chat, migratedData.libraries.chat);
            }
        }

        // Migrate metadata
        if (migratedData.metadata) {
            console.log('[RAG:STATE] Migrating metadata');
            Object.assign(newState.metadata, migratedData.metadata);
        }

        // Save migrated state under new key
        extension_settings[extensionName] = newState;
        console.log('[RAG:STATE] Migration from old location complete');
        console.log('[RAG:STATE] Migrated sources:', Object.keys(newState.sources));

        // CRITICAL: Save migration to disk
        this.saveSettings();
        console.log('[RAG:STATE] Migration saved to settings.json');

        // Note: We don't delete the old keys yet - user might want to keep them as backup
        // They can be cleaned up manually or by the "Recover Lost Collections" feature
    }

    /**
     * Migrate state to canonical structure
     * WHY: Add missing fields from canonical state (version updates)
     * Handles migration from old structure (with .collections) to new structure (with .sources and .libraries)
     * @private
     */
    static _migrateToCanonical() {
        // Access state directly to avoid auto-init recursion
        const state = extension_settings[extensionName];

        if (!state) {
            console.error('[RAG:STATE] Cannot migrate - state does not exist');
            return;
        }

        // Ensure all top-level keys exist
        if (!state.version) state.version = CANONICAL_STATE.version;
        if (!state.settings) state.settings = structuredClone(CANONICAL_STATE.settings);
        if (!state.sources) state.sources = {};
        if (!state.libraries) state.libraries = { global: {}, character: {}, chat: {} };
        if (!state.metadata) state.metadata = {};

        // CRITICAL: Migrate top-level settings to .settings object (user's customized values)
        // This handles the case where old structure had settings at top level
        const settingKeysMigrated = [];
        for (const key in CANONICAL_STATE.settings) {
            // If setting exists at top level, copy it to .settings (prioritize user's value)
            if (key in state && key !== 'settings' && key !== 'sources' && key !== 'libraries' && key !== 'metadata' && key !== 'version' && key !== 'collections') {
                console.log(`[RAG:STATE] Migrating top-level setting to .settings: ${key} = ${state[key]}`);
                state.settings[key] = state[key];
                settingKeysMigrated.push(key);
            }
        }

        // Add missing settings from defaults
        for (const key in CANONICAL_STATE.settings) {
            if (!(key in state.settings)) {
                console.log(`[RAG:STATE] Adding missing setting: ${key}`);
                state.settings[key] = CANONICAL_STATE.settings[key];
            }
        }

        // Clean up old top-level setting keys after migration
        if (settingKeysMigrated.length > 0) {
            console.log(`[RAG:STATE] Cleaning up ${settingKeysMigrated.length} migrated top-level settings`);
            for (const key of settingKeysMigrated) {
                delete state[key];
            }
        }

        // Ensure library scopes exist
        if (!state.libraries.global) state.libraries.global = {};
        if (!state.libraries.character) state.libraries.character = {};
        if (!state.libraries.chat) state.libraries.chat = {};

        // CRITICAL: Migrate .collections to .sources if collections exist
        if (state.collections && Object.keys(state.collections).length > 0) {
            // Only migrate if sources is empty OR if collections has items not in sources
            const collectionsToMigrate = Object.keys(state.collections).filter(id => !state.sources[id]);

            if (collectionsToMigrate.length > 0) {
                console.log(`[RAG:STATE] Migrating ${collectionsToMigrate.length} collections to sources format`);

                for (const collectionId of collectionsToMigrate) {
                    const collectionData = state.collections[collectionId];
                    state.sources[collectionId] = {
                        id: collectionId,
                        name: collectionData.sourceName || collectionData.name || collectionId,
                        type: collectionData.sourceType || collectionData.type || 'custom',
                        scope: collectionData.scope || 'global',
                        scopeIdentifier: collectionData.scopeIdentifier || null,
                        enabled: collectionData.enabled !== false,
                        chunkCount: collectionData.chunkCount || 0,
                        createdAt: collectionData.createdAt || collectionData.lastUpdated || Date.now(),
                        updatedAt: collectionData.lastUpdated || Date.now()
                    };
                }

                console.log('[RAG:STATE] Migrated sources:', collectionsToMigrate);
            }

            // Clean up .collections after verifying all data is in .sources
            if (Object.keys(state.sources).length >= Object.keys(state.collections).length) {
                console.log('[RAG:STATE] Cleaning up old .collections structure after successful migration');
                delete state.collections;
            }
        }

        this.saveSettings();
        console.log('[RAG:STATE] Migration to canonical structure complete');
    }
}

// Register diagnostic checks
// WHY: Validate state health

Diagnostics.registerCheck('state-extension-key-correct', {
    name: 'Extension Key Correct',
    description: 'Verifies state is stored under correct extension key',
    category: 'CORE',
    checkFn: async () => {
        // Check that extension_settings has the correct key
        if (!extension_settings[extensionName]) {
            return {
                status: 'critical',
                message: `Extension settings not found under key: ${extensionName}`,
                userMessage: `Extension state is missing. The extension may not have initialized correctly.`,
                fixes: [
                    {
                        label: 'Reinitialize State',
                        description: 'Create new state structure',
                        action: () => {
                            State.init();
                        }
                    }
                ]
            };
        }

        return {
            status: 'pass',
            message: `State correctly stored under: ${extensionName}`,
            userMessage: 'Extension state is properly initialized.'
        };
    }
});

Diagnostics.registerCheck('state-structure-valid', {
    name: 'State Structure Valid',
    description: 'Validates extension_settings structure exists and is correct',
    category: 'CORE',
    checkFn: async () => {
        try {
            State.validateState();

            return {
                status: 'pass',
                message: 'State structure is valid',
                userMessage: 'Extension settings are correctly structured.'
            };
        } catch (error) {
            return {
                status: 'critical',
                message: `State validation failed: ${error.message}`,
                userMessage: `Settings are corrupted: ${error.message}. Try resetting the extension.`,
                fixes: [
                    {
                        label: 'Reset to Defaults',
                        description: 'This will delete all collections and reset settings',
                        action: () => {
                            extension_settings[extensionName] = structuredClone(CANONICAL_STATE);
                            State.saveSettings();
                        }
                    }
                ]
            };
        }
    }
});

Diagnostics.registerCheck('state-no-orphaned-sources', {
    name: 'No Orphaned Sources',
    description: 'Checks for sources without corresponding libraries',
    category: 'CORE',
    checkFn: async () => {
        const sources = State.getSources();
        const orphaned = [];

        for (const source of sources) {
            const library = State.getLibrary(source.id, source.scope, source.scopeIdentifier);
            if (!library || Object.keys(library).length === 0) {
                orphaned.push(source.id);
            }
        }

        if (orphaned.length > 0) {
            return {
                status: 'warn',
                message: `${orphaned.length} sources have no chunks`,
                userMessage: `${orphaned.length} collection(s) have no chunks. They may have failed to vectorize or were deleted.`,
                fixes: [
                    {
                        label: 'Delete Empty Sources',
                        description: 'Remove sources that have no chunks',
                        action: () => {
                            for (const id of orphaned) {
                                State.deleteSource(id);
                            }
                        }
                    }
                ]
            };
        }

        return {
            status: 'pass',
            message: 'No orphaned sources found',
            userMessage: 'All collections have chunks.'
        };
    }
});

Diagnostics.registerCheck('state-scope-consistency', {
    name: 'Scope Consistency',
    description: 'Verifies scope metadata matches actual storage',
    category: 'CORE',
    checkFn: async () => {
        const sources = State.getSources();
        const inconsistencies = [];

        for (const source of sources) {
            const library = State.getLibrary(source.id, source.scope, source.scopeIdentifier);

            // Check if library exists where it should
            if (!library) {
                inconsistencies.push(`${source.id}: No library found for declared scope`);
            }
        }

        if (inconsistencies.length > 0) {
            return {
                status: 'error',
                message: `${inconsistencies.length} scope inconsistencies found`,
                userMessage: `${inconsistencies.length} collection(s) have scope mismatches between metadata and storage.`,
                data: inconsistencies
            };
        }

        return {
            status: 'pass',
            message: 'All scopes are consistent',
            userMessage: 'Collection scopes are correctly configured.'
        };
    }
});

// ==================== CHUNK VIEWER INTEGRATION DIAGNOSTICS ====================

Diagnostics.registerCheck('chunk-viewer-api-methods', {
    name: 'Chunk Viewer API Methods',
    description: 'Verifies State API compatibility methods for ui-chunks.js exist',
    category: 'CORE',
    checkFn: async () => {
        const requiredMethods = ['getAllCollections', 'getCollection', 'updateChunk', 'deleteChunk'];
        const missing = requiredMethods.filter(method => typeof State[method] !== 'function');

        if (missing.length > 0) {
            return {
                status: 'critical',
                message: `Missing State API methods: ${missing.join(', ')}`,
                userMessage: 'Chunk viewer integration is broken. Missing required State API methods.',
                fixes: [{
                    label: 'Reinstall Extension',
                    action: () => console.error('[RAG:DIAGNOSTIC] State API methods missing - reinstall required')
                }]
            };
        }

        return {
            status: 'pass',
            message: 'All State API compatibility methods exist',
            userMessage: 'Chunk viewer State API is properly configured.'
        };
    }
});

Diagnostics.registerCheck('chunk-viewer-modal-elements', {
    name: 'Chunk Viewer Modal Elements',
    description: 'Verifies chunk viewer modal HTML elements exist',
    category: 'UI',
    checkFn: async () => {
        const requiredElements = [
            '#rag_chunk_viewer_modal',
            '#rag_chunk_modal_title',
            '#rag_chunk_modal_subtitle',
            '#rag_chunks_container',
            '#rag_chunk_modal_close',
            '#rag_chunk_modal_close_footer'
        ];

        const missing = requiredElements.filter(selector => $(selector).length === 0);

        if (missing.length > 0) {
            return {
                status: 'critical',
                message: `Missing chunk viewer modal elements: ${missing.join(', ')}`,
                userMessage: 'Chunk viewer modal HTML is missing or corrupt.',
                fixes: [{
                    label: 'Check settings.html',
                    action: () => console.error('[RAG:DIAGNOSTIC] Modal elements missing - check settings.html')
                }]
            };
        }

        return {
            status: 'pass',
            message: 'All chunk viewer modal elements exist',
            userMessage: 'Chunk viewer modal is properly loaded.'
        };
    }
});

Diagnostics.registerCheck('ui-chunks-module-loadable', {
    name: 'UI Chunks Module Loadable',
    description: 'Verifies ui-chunks.js module can be imported',
    category: 'CORE',
    checkFn: async () => {
        try {
            // Check if renderChunks function is available
            const uiChunksModule = await import('./ui-chunks.js');

            if (typeof uiChunksModule.renderChunks !== 'function') {
                return {
                    status: 'critical',
                    message: 'ui-chunks.js does not export renderChunks function',
                    userMessage: 'Chunk viewer module is corrupt or missing.',
                    fixes: [{
                        label: 'Reinstall Extension',
                        action: () => console.error('[RAG:DIAGNOSTIC] ui-chunks.js missing renderChunks export')
                    }]
                };
            }

            return {
                status: 'pass',
                message: 'ui-chunks.js module loads successfully',
                userMessage: 'Chunk viewer module is properly loaded.'
            };
        } catch (error) {
            return {
                status: 'critical',
                message: `Failed to load ui-chunks.js: ${error.message}`,
                userMessage: 'Chunk viewer module failed to load.',
                fixes: [{
                    label: 'Check Console',
                    action: () => console.error('[RAG:DIAGNOSTIC] ui-chunks.js import error:', error)
                }]
            };
        }
    }
});

Diagnostics.registerCheck('collection-recovery-available', {
    name: 'Collection Recovery Available',
    description: 'Checks if orphaned collections exist that can be recovered',
    category: 'DATA',
    checkFn: async () => {
        const oldCollections = extension_settings.rag?.collections;

        if (!oldCollections || Object.keys(oldCollections).length === 0) {
            return {
                status: 'pass',
                message: 'No orphaned collections found',
                userMessage: 'All collections are in the correct storage location.'
            };
        }

        const orphanedCount = Object.keys(oldCollections).length;
        const correctLocation = State.getState().sources || {};
        const alreadyMigrated = Object.keys(oldCollections).filter(id => correctLocation[id]).length;

        if (alreadyMigrated === orphanedCount) {
            return {
                status: 'pass',
                message: `${orphanedCount} collections already migrated`,
                userMessage: 'Old collections detected but already migrated to correct location.'
            };
        }

        return {
            status: 'warn',
            message: `${orphanedCount - alreadyMigrated} orphaned collections can be recovered`,
            userMessage: `Found ${orphanedCount - alreadyMigrated} collection(s) in old storage location.`,
            fixes: [{
                label: 'Recover Collections',
                action: () => {
                    console.log('[RAG:DIAGNOSTIC] Use "Recover Lost Collections" button in settings');
                    // Trigger recovery UI hint
                    $('#rag_recover_collections').addClass('highlight-pulse');
                    setTimeout(() => $('#rag_recover_collections').removeClass('highlight-pulse'), 3000);
                }
            }]
        };
    }
});

Diagnostics.registerCheck('state-initialized', {
    name: 'State Initialized',
    description: 'Verifies State.init() was called and state structure exists',
    category: 'CORE',
    checkFn: async () => {
        const state = extension_settings[extensionName];

        if (!state) {
            return {
                status: 'critical',
                message: 'State not initialized - State.init() was not called',
                userMessage: 'Extension state is not initialized. Extension may not work properly.',
                fixes: [{
                    label: 'Initialize State',
                    action: () => {
                        State.init();
                        console.log('[RAG:DIAGNOSTIC] State initialized');
                    }
                }]
            };
        }

        // Check for canonical structure
        const requiredKeys = ['version', 'settings', 'sources', 'libraries', 'metadata'];
        const missingKeys = requiredKeys.filter(key => !state[key]);

        if (missingKeys.length > 0) {
            return {
                status: 'warn',
                message: `State missing keys: ${missingKeys.join(', ')}`,
                userMessage: 'State structure incomplete. Some features may not work.',
                fixes: [{
                    label: 'Migrate State',
                    action: () => {
                        State._migrateToCanonical();
                        console.log('[RAG:DIAGNOSTIC] State migrated to canonical structure');
                    }
                }]
            };
        }

        return {
            status: 'pass',
            message: 'State properly initialized with canonical structure',
            userMessage: 'Extension state is properly initialized.'
        };
    }
});

Diagnostics.registerCheck('recovery-methods-functional', {
    name: 'Recovery Methods Functional',
    description: 'Verifies collection recovery methods exist and are callable',
    category: 'CORE',
    checkFn: async () => {
        const requiredMethods = ['checkForOrphanedData', 'recoverOrphanedCollections'];
        const missing = requiredMethods.filter(method => typeof State[method] !== 'function');

        if (missing.length > 0) {
            return {
                status: 'critical',
                message: `Missing recovery methods: ${missing.join(', ')}`,
                userMessage: 'Collection recovery is not available. Extension code may be corrupt.',
                fixes: [{
                    label: 'Reinstall Extension',
                    action: () => console.error('[RAG:DIAGNOSTIC] Recovery methods missing - reinstall required')
                }]
            };
        }

        // Test if methods are callable
        try {
            const orphaned = await State.checkForOrphanedData();

            if (orphaned.length > 0) {
                return {
                    status: 'warn',
                    message: `Recovery methods functional. Found ${orphaned.length} orphaned collections.`,
                    userMessage: `Recovery system is working. Found ${orphaned.length} orphaned collection(s) that can be recovered.`,
                    fixes: [{
                        label: 'Recover Collections',
                        action: async () => {
                            const recovered = await State.recoverOrphanedCollections();
                            console.log(`[RAG:DIAGNOSTIC] Recovered ${recovered.length} collections`);
                        }
                    }]
                };
            }

            return {
                status: 'pass',
                message: 'Recovery methods functional. No orphaned collections found.',
                userMessage: 'Collection recovery system is working properly.'
            };
        } catch (error) {
            return {
                status: 'critical',
                message: `Recovery methods error: ${error.message}`,
                userMessage: 'Collection recovery encountered an error.',
                fixes: [{
                    label: 'Check Console',
                    action: () => console.error('[RAG:DIAGNOSTIC] Recovery error:', error)
                }]
            };
        }
    }
});

export default State;
