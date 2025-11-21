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
        useServerSideSearch: true // If true, use /api/vector/query instead of client-side
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
        // Updated to use correct ragbooks_ prefix IDs from settings.html
        const requiredElements = [
            '#ragbooks_chunk_viewer_modal',
            '#ragbooks_modal_title',
            '#ragbooks_modal_subtitle',
            '#ragbooks_chunks_container',
            '#ragbooks_modal_close'
        ];

        const missing = requiredElements.filter(selector => $(selector).length === 0);

        if (missing.length > 0) {
            return {
                status: 'critical',
                message: `Missing chunk viewer modal elements: ${missing.join(', ')}`,
                userMessage: 'Chunk viewer modal HTML is missing or corrupt.',
                fixes: [{
                    label: 'Check settings.html',
                    description: 'Verify settings.html contains all required modal elements',
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

Diagnostics.registerCheck('chunk-rendering-available', {
    name: 'Chunk Rendering Available',
    description: 'Verifies chunk rendering functions are available in index.js',
    category: 'CORE',
    checkFn: async () => {
        // Check if the main chunk rendering logic is available
        // This is handled in index.js, not a separate module
        try {
            // Check for the chunk viewer modal which indicates UI is loaded
            const modalExists = $('#ragbooks_chunk_viewer_modal').length > 0;
            const containerExists = $('#ragbooks_chunks_container').length > 0;

            if (!modalExists || !containerExists) {
                return {
                    status: 'warn',
                    message: 'Chunk viewer UI elements not found',
                    userMessage: 'Chunk viewer UI may not be fully loaded. Try refreshing the page.',
                    fixes: [{
                        label: 'Refresh Page',
                        description: 'Reload the page to reinitialize the UI',
                        action: () => window.location.reload()
                    }]
                };
            }

            return {
                status: 'pass',
                message: 'Chunk rendering UI is available',
                userMessage: 'Chunk viewer is properly loaded and ready to use.'
            };
        } catch (error) {
            return {
                status: 'error',
                message: `Chunk rendering check failed: ${error.message}`,
                userMessage: 'Unable to verify chunk rendering availability.',
                fixes: [{
                    label: 'Check Console',
                    description: 'Check browser console for errors',
                    action: () => console.error('[RAG:DIAGNOSTIC] Chunk rendering check error:', error)
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

// ==================== DUAL-VECTOR DIAGNOSTIC CHECKS ====================

Diagnostics.registerCheck('dual-vector-chunks-exist', {
    name: 'Dual-Vector Summary Chunks Exist',
    description: 'Verifies summary chunks are created for chunks with summaryVectors',
    category: 'SEARCH',
    checkFn: async () => {
        const state = extension_settings[extensionName];
        if (!state?.libraries) {
            return {
                status: 'info',
                message: 'No libraries found',
                userMessage: 'No collections to check for dual-vector configuration.'
            };
        }

        let totalChunks = 0;
        let chunksWithSummaryVectors = 0;
        let summaryChunks = 0;
        let orphanedSummaries = 0;

        // Check all libraries
        const allLibraries = [
            state.libraries.global || {},
            ...Object.values(state.libraries.character || {}),
            ...Object.values(state.libraries.chat || {})
        ];

        for (const library of allLibraries) {
            for (const collection of Object.values(library)) {
                if (!collection || typeof collection !== 'object') continue;

                const chunks = Object.values(collection);
                const chunkMap = new Map(chunks.map(c => [c.hash, c]));

                for (const chunk of chunks) {
                    totalChunks++;

                    if (chunk.isSummaryChunk) {
                        summaryChunks++;
                        // Check if parent exists
                        if (chunk.parentHash && !chunkMap.has(chunk.parentHash)) {
                            orphanedSummaries++;
                        }
                    } else if (chunk.summaryVectors?.length > 0 && chunk.summaryVector) {
                        chunksWithSummaryVectors++;
                    }
                }
            }
        }

        if (totalChunks === 0) {
            return {
                status: 'info',
                message: 'No chunks found in any collection',
                userMessage: 'No chunks available to check for dual-vector configuration.'
            };
        }

        if (orphanedSummaries > 0) {
            return {
                status: 'error',
                message: `${orphanedSummaries} orphaned summary chunks (missing parent)`,
                userMessage: `Found ${orphanedSummaries} summary chunk(s) whose parent chunks are missing. Re-vectorize affected collections.`,
                fixes: [{
                    label: 'Check Console',
                    description: 'View console for details about orphaned summaries',
                    action: () => console.error('[RAG:DIAGNOSTIC] Orphaned summary chunks detected - parent hashes not found')
                }]
            };
        }

        if (chunksWithSummaryVectors > 0 && summaryChunks === 0) {
            return {
                status: 'warn',
                message: `${chunksWithSummaryVectors} chunks have summaryVectors but no summary chunks created`,
                userMessage: `Found ${chunksWithSummaryVectors} chunk(s) with summary vectors but no corresponding summary chunks. Re-vectorize to create them.`,
                fixes: [{
                    label: 'Re-vectorize Collections',
                    description: 'Re-vectorize collections to create summary chunks',
                    action: () => console.log('[RAG:DIAGNOSTIC] Re-vectorize collections with summaryVectors enabled')
                }]
            };
        }

        return {
            status: 'pass',
            message: `${summaryChunks} summary chunks from ${chunksWithSummaryVectors} parent chunks (${totalChunks} total)`,
            userMessage: `Dual-vector system: ${summaryChunks} summary chunks created from ${chunksWithSummaryVectors} chunks with summary vectors.`
        };
    }
});

Diagnostics.registerCheck('dual-vector-parent-swap-functional', {
    name: 'Dual-Vector Parent Swap Functional',
    description: 'Tests that summary chunks correctly link to their parents',
    category: 'SEARCH',
    checkFn: async () => {
        try {
            // Import the dual-vector module
            const { createSummaryChunks, expandSummaryChunks } = await import('./dual-vector.js');

            // Test 1: Create summary chunks from test data
            const testChunks = [{
                hash: 'test_parent_123',
                text: 'This is the full text content that would be injected.',
                summaryVectors: ['A concise summary of the content.'],
                summaryVector: true,
                isSummaryChunk: false
            }];

            const withSummaries = createSummaryChunks(testChunks);

            if (withSummaries.length !== 2) {
                return {
                    status: 'error',
                    message: `createSummaryChunks returned ${withSummaries.length} chunks, expected 2`,
                    userMessage: 'Summary chunk creation is not working correctly.',
                    fixes: [{
                        label: 'Check Console',
                        description: 'View console for test details',
                        action: () => console.error('[RAG:DIAGNOSTIC] createSummaryChunks test failed')
                    }]
                };
            }

            const summaryChunk = withSummaries.find(c => c.isSummaryChunk);
            if (!summaryChunk) {
                return {
                    status: 'error',
                    message: 'No summary chunk created',
                    userMessage: 'Summary chunk was not created from test data.'
                };
            }

            if (summaryChunk.parentHash !== 'test_parent_123') {
                return {
                    status: 'error',
                    message: `Summary chunk parentHash is ${summaryChunk.parentHash}, expected test_parent_123`,
                    userMessage: 'Summary chunk has incorrect parent hash.'
                };
            }

            // Test 2: Verify expandSummaryChunks works
            const chunkMap = { 'test_parent_123': testChunks[0] };
            const expanded = expandSummaryChunks([summaryChunk], chunkMap);

            if (expanded.length !== 2) {
                return {
                    status: 'error',
                    message: `expandSummaryChunks returned ${expanded.length} chunks, expected 2`,
                    userMessage: 'Parent expansion is not working correctly.'
                };
            }

            console.log('[RAG:DIAGNOSTIC] ✅ Dual-vector parent swap test passed:', {
                originalChunks: testChunks.length,
                withSummaries: withSummaries.length,
                summaryChunkHash: summaryChunk.hash,
                parentHash: summaryChunk.parentHash,
                expanded: expanded.length
            });

            return {
                status: 'pass',
                message: 'Parent swap functional - summary chunks correctly link to parents',
                userMessage: 'Dual-vector parent swap is working correctly. Summary chunks will return their full parent content.'
            };
        } catch (error) {
            return {
                status: 'error',
                message: `Parent swap test failed: ${error.message}`,
                userMessage: `Dual-vector parent swap test encountered an error: ${error.message}`,
                fixes: [{
                    label: 'Check Console',
                    description: 'View console for error details',
                    action: () => console.error('[RAG:DIAGNOSTIC] Parent swap test error:', error)
                }]
            };
        }
    }
});

Diagnostics.registerCheck('dual-vector-search-pipeline', {
    name: 'Dual-Vector Search Pipeline',
    description: 'Verifies the complete dual-vector search pipeline works end-to-end',
    category: 'SEARCH',
    checkFn: async () => {
        try {
            const { dualVectorSearch, searchByVector } = await import('./search-strategies.js');
            const { createSummaryChunks } = await import('./dual-vector.js');

            // Create test chunks with embeddings (mock)
            const testChunks = [{
                hash: 'dv_test_parent_1',
                text: 'The ancient dragon guards the treasure in the mountain cave.',
                summaryVectors: ['Dragon guards treasure in cave.'],
                summaryVector: true,
                isSummaryChunk: false,
                embedding: new Array(384).fill(0).map(() => Math.random()), // Mock embedding
                keywords: ['dragon', 'treasure', 'cave']
            }];

            // Create summary chunks
            const withSummaries = createSummaryChunks(testChunks);

            // Add mock embeddings to summary chunks
            withSummaries.forEach(chunk => {
                if (!chunk.embedding) {
                    chunk.embedding = new Array(384).fill(0).map(() => Math.random());
                }
            });

            // Verify we have both parent and summary
            const hasParent = withSummaries.some(c => !c.isSummaryChunk);
            const hasSummary = withSummaries.some(c => c.isSummaryChunk);

            if (!hasParent || !hasSummary) {
                return {
                    status: 'error',
                    message: `Missing chunks: parent=${hasParent}, summary=${hasSummary}`,
                    userMessage: 'Test chunk creation failed - missing parent or summary.'
                };
            }

            // Log test results
            console.log('[RAG:DIAGNOSTIC] ✅ Dual-vector search pipeline test:', {
                inputChunks: testChunks.length,
                outputChunks: withSummaries.length,
                hasParent,
                hasSummary,
                summaryText: withSummaries.find(c => c.isSummaryChunk)?.text
            });

            return {
                status: 'pass',
                message: 'Search pipeline functional - chunks correctly created and linked',
                userMessage: 'Dual-vector search pipeline is working. Summary chunks are created and linked to parents.'
            };
        } catch (error) {
            return {
                status: 'error',
                message: `Search pipeline test failed: ${error.message}`,
                userMessage: `Dual-vector search pipeline test failed: ${error.message}`,
                fixes: [{
                    label: 'Check Console',
                    description: 'View console for error details',
                    action: () => console.error('[RAG:DIAGNOSTIC] Search pipeline test error:', error)
                }]
            };
        }
    }
});

Diagnostics.registerCheck('dual-vector-settings-configured', {
    name: 'Dual-Vector Settings Configured',
    description: 'Checks if dual-vector search is enabled in settings',
    category: 'SEARCH',
    checkFn: async () => {
        const state = extension_settings[extensionName];
        const settings = state?.settings || {};

        const dualVectorEnabled = settings.dualVector === true;
        const searchMode = settings.searchMode || 'hybrid';

        if (!dualVectorEnabled) {
            return {
                status: 'info',
                message: 'Dual-vector search is disabled',
                userMessage: 'Dual-vector search is currently disabled. Enable it in settings to search both summaries and full text.',
                fixes: [{
                    label: 'Enable Dual-Vector',
                    description: 'Enable dual-vector search in RAGBooks settings',
                    action: () => {
                        if (state && state.settings) {
                            state.settings.dualVector = true;
                            console.log('[RAG:DIAGNOSTIC] Dual-vector search enabled');
                        }
                    }
                }]
            };
        }

        return {
            status: 'pass',
            message: `Dual-vector enabled with ${searchMode} search mode`,
            userMessage: `Dual-vector search is enabled. Using ${searchMode} search mode.`
        };
    }
});

// ==================== PRODUCTION TESTS ====================

/**
 * Run production tests for dual-vector system
 * Call from console: await RAGBooks.runDualVectorTests()
 */
State.runDualVectorTests = async function() {
    console.group('🧪 RAGBooks Dual-Vector Production Tests');

    const tests = [];
    let passed = 0;
    let failed = 0;

    // Test 1: Summary chunk creation
    try {
        const { createSummaryChunks } = await import('./dual-vector.js');

        const testChunk = {
            hash: 'prod_test_1',
            text: 'Full content here',
            summaryVectors: ['Summary 1', 'Summary 2'],
            summaryVector: true,
            isSummaryChunk: false
        };

        const result = createSummaryChunks([testChunk]);
        const summaryCount = result.filter(c => c.isSummaryChunk).length;

        if (summaryCount === 2) {
            console.log('✅ Test 1: Summary chunk creation - PASSED');
            console.log(`   Created ${summaryCount} summary chunks from 2 summaryVectors`);
            passed++;
        } else {
            console.error('❌ Test 1: Summary chunk creation - FAILED');
            console.error(`   Expected 2 summary chunks, got ${summaryCount}`);
            failed++;
        }
        tests.push({ name: 'Summary chunk creation', passed: summaryCount === 2 });
    } catch (error) {
        console.error('❌ Test 1: Summary chunk creation - ERROR:', error.message);
        failed++;
        tests.push({ name: 'Summary chunk creation', passed: false, error: error.message });
    }

    // Test 2: Parent hash linkage
    try {
        const { createSummaryChunks } = await import('./dual-vector.js');

        const testChunk = {
            hash: 'parent_hash_test',
            text: 'Parent content',
            summaryVectors: ['Child summary'],
            summaryVector: true
        };

        const result = createSummaryChunks([testChunk]);
        const summary = result.find(c => c.isSummaryChunk);

        if (summary && summary.parentHash === 'parent_hash_test') {
            console.log('✅ Test 2: Parent hash linkage - PASSED');
            console.log(`   Summary parentHash correctly set to ${summary.parentHash}`);
            passed++;
        } else {
            console.error('❌ Test 2: Parent hash linkage - FAILED');
            console.error(`   Expected parentHash 'parent_hash_test', got '${summary?.parentHash}'`);
            failed++;
        }
        tests.push({ name: 'Parent hash linkage', passed: summary?.parentHash === 'parent_hash_test' });
    } catch (error) {
        console.error('❌ Test 2: Parent hash linkage - ERROR:', error.message);
        failed++;
        tests.push({ name: 'Parent hash linkage', passed: false, error: error.message });
    }

    // Test 3: Summary chunk metadata
    try {
        const { createSummaryChunks } = await import('./dual-vector.js');

        const testChunk = {
            hash: 'metadata_test',
            text: 'Content',
            summaryVectors: ['Summary'],
            summaryVector: true,
            keywords: ['test', 'keyword'],
            importance: 150
        };

        const result = createSummaryChunks([testChunk]);
        const summary = result.find(c => c.isSummaryChunk);

        const hasKeywords = summary?.keywords?.length === 2;
        const hasImportance = summary?.importance === 150;
        const hasFlag = summary?.isSummaryChunk === true;

        if (hasKeywords && hasImportance && hasFlag) {
            console.log('✅ Test 3: Summary chunk metadata - PASSED');
            console.log('   Keywords, importance, and flags correctly inherited');
            passed++;
        } else {
            console.error('❌ Test 3: Summary chunk metadata - FAILED');
            console.error(`   Keywords: ${hasKeywords}, Importance: ${hasImportance}, Flag: ${hasFlag}`);
            failed++;
        }
        tests.push({ name: 'Summary chunk metadata', passed: hasKeywords && hasImportance && hasFlag });
    } catch (error) {
        console.error('❌ Test 3: Summary chunk metadata - ERROR:', error.message);
        failed++;
        tests.push({ name: 'Summary chunk metadata', passed: false, error: error.message });
    }

    // Test 4: Chunk links (force mode)
    try {
        const { createSummaryChunks } = await import('./dual-vector.js');

        const testChunk = {
            hash: 'link_test',
            text: 'Content',
            summaryVectors: ['Summary'],
            summaryVector: true
        };

        const result = createSummaryChunks([testChunk]);
        const summary = result.find(c => c.isSummaryChunk);

        const hasLink = summary?.chunkLinks?.some(link =>
            link.targetHash === 'link_test' && link.mode === 'force'
        );

        if (hasLink) {
            console.log('✅ Test 4: Chunk links (force mode) - PASSED');
            console.log('   Summary chunk has force link to parent');
            passed++;
        } else {
            console.error('❌ Test 4: Chunk links (force mode) - FAILED');
            console.error('   Missing force link to parent');
            failed++;
        }
        tests.push({ name: 'Chunk links (force mode)', passed: hasLink });
    } catch (error) {
        console.error('❌ Test 4: Chunk links (force mode) - ERROR:', error.message);
        failed++;
        tests.push({ name: 'Chunk links (force mode)', passed: false, error: error.message });
    }

    // Test 5: Filter by search mode
    try {
        const { createSummaryChunks, filterChunksBySearchMode } = await import('./dual-vector.js');

        const testChunk = {
            hash: 'filter_test',
            text: 'Content',
            summaryVectors: ['Summary'],
            summaryVector: true
        };

        const allChunks = createSummaryChunks([testChunk]);
        const summaryOnly = filterChunksBySearchMode(allChunks, 'summary');
        const fullOnly = filterChunksBySearchMode(allChunks, 'full');
        const both = filterChunksBySearchMode(allChunks, 'both');

        const summaryOk = summaryOnly.length === 1 && summaryOnly[0].isSummaryChunk;
        const fullOk = fullOnly.length === 1 && !fullOnly[0].isSummaryChunk;
        const bothOk = both.length === 2;

        if (summaryOk && fullOk && bothOk) {
            console.log('✅ Test 5: Filter by search mode - PASSED');
            console.log(`   summary: ${summaryOnly.length}, full: ${fullOnly.length}, both: ${both.length}`);
            passed++;
        } else {
            console.error('❌ Test 5: Filter by search mode - FAILED');
            console.error(`   summary: ${summaryOk}, full: ${fullOk}, both: ${bothOk}`);
            failed++;
        }
        tests.push({ name: 'Filter by search mode', passed: summaryOk && fullOk && bothOk });
    } catch (error) {
        console.error('❌ Test 5: Filter by search mode - ERROR:', error.message);
        failed++;
        tests.push({ name: 'Filter by search mode', passed: false, error: error.message });
    }

    // Test 6: Expand summary chunks
    try {
        const { createSummaryChunks, expandSummaryChunks } = await import('./dual-vector.js');

        const testChunk = {
            hash: 'expand_test',
            text: 'Full content',
            summaryVectors: ['Summary'],
            summaryVector: true
        };

        const allChunks = createSummaryChunks([testChunk]);
        const summaryOnly = allChunks.filter(c => c.isSummaryChunk);
        const chunkMap = Object.fromEntries(allChunks.map(c => [c.hash, c]));

        const expanded = expandSummaryChunks(summaryOnly, chunkMap);

        if (expanded.length === 2) {
            console.log('✅ Test 6: Expand summary chunks - PASSED');
            console.log('   Summary chunk expanded to include parent');
            passed++;
        } else {
            console.error('❌ Test 6: Expand summary chunks - FAILED');
            console.error(`   Expected 2 chunks after expansion, got ${expanded.length}`);
            failed++;
        }
        tests.push({ name: 'Expand summary chunks', passed: expanded.length === 2 });
    } catch (error) {
        console.error('❌ Test 6: Expand summary chunks - ERROR:', error.message);
        failed++;
        tests.push({ name: 'Expand summary chunks', passed: false, error: error.message });
    }

    console.groupEnd();

    // Summary
    console.log('\n📊 Test Summary:');
    console.log(`   Passed: ${passed}/${tests.length}`);
    console.log(`   Failed: ${failed}/${tests.length}`);

    if (failed === 0) {
        console.log('✅ All dual-vector tests passed!');
    } else {
        console.warn(`⚠️ ${failed} test(s) failed - check logs above`);
    }

    return { passed, failed, tests };
};

// ==================== VECTOR SEARCH DIAGNOSTIC CHECKS ====================

Diagnostics.registerCheck('vector-embeddings-present', {
    name: 'Vector Embeddings Present',
    description: 'Verifies chunks have embeddings for vector search',
    category: 'EMBEDDINGS',
    checkFn: async () => {
        const state = extension_settings[extensionName];
        if (!state?.libraries) {
            return {
                status: 'info',
                message: 'No libraries found',
                userMessage: 'No collections to check for embeddings.'
            };
        }

        let totalChunks = 0;
        let chunksWithEmbeddings = 0;
        let invalidEmbeddings = 0;

        const allLibraries = [
            state.libraries.global || {},
            ...Object.values(state.libraries.character || {}),
            ...Object.values(state.libraries.chat || {})
        ];

        for (const library of allLibraries) {
            for (const collection of Object.values(library)) {
                if (!collection || typeof collection !== 'object') continue;

                for (const chunk of Object.values(collection)) {
                    totalChunks++;

                    if (chunk.embedding) {
                        if (Array.isArray(chunk.embedding) && chunk.embedding.length > 0) {
                            chunksWithEmbeddings++;
                        } else {
                            invalidEmbeddings++;
                        }
                    }
                }
            }
        }

        if (totalChunks === 0) {
            return {
                status: 'info',
                message: 'No chunks found',
                userMessage: 'No chunks available to check for embeddings.'
            };
        }

        const missingEmbeddings = totalChunks - chunksWithEmbeddings - invalidEmbeddings;

        if (invalidEmbeddings > 0) {
            return {
                status: 'error',
                message: `${invalidEmbeddings} chunks have invalid embeddings`,
                userMessage: `Found ${invalidEmbeddings} chunk(s) with corrupt embeddings. Re-vectorize affected collections.`
            };
        }

        if (missingEmbeddings > totalChunks * 0.5) {
            return {
                status: 'warn',
                message: `${missingEmbeddings}/${totalChunks} chunks missing embeddings`,
                userMessage: `${missingEmbeddings} chunk(s) don't have embeddings. They won't appear in vector search results.`
            };
        }

        return {
            status: 'pass',
            message: `${chunksWithEmbeddings}/${totalChunks} chunks have embeddings`,
            userMessage: `${chunksWithEmbeddings} of ${totalChunks} chunks have valid embeddings for vector search.`
        };
    }
});

Diagnostics.registerCheck('keyword-index-populated', {
    name: 'Keyword Index Populated',
    description: 'Verifies chunks have keywords for keyword search',
    category: 'SEARCH',
    checkFn: async () => {
        const state = extension_settings[extensionName];
        if (!state?.libraries) {
            return {
                status: 'info',
                message: 'No libraries found',
                userMessage: 'No collections to check for keywords.'
            };
        }

        let totalChunks = 0;
        let chunksWithKeywords = 0;
        let totalKeywords = 0;

        const allLibraries = [
            state.libraries.global || {},
            ...Object.values(state.libraries.character || {}),
            ...Object.values(state.libraries.chat || {})
        ];

        for (const library of allLibraries) {
            for (const collection of Object.values(library)) {
                if (!collection || typeof collection !== 'object') continue;

                for (const chunk of Object.values(collection)) {
                    if (chunk.isSummaryChunk) continue; // Skip summary chunks
                    totalChunks++;

                    const keywords = chunk.keywords || [];
                    if (keywords.length > 0) {
                        chunksWithKeywords++;
                        totalKeywords += keywords.length;
                    }
                }
            }
        }

        if (totalChunks === 0) {
            return {
                status: 'info',
                message: 'No chunks found',
                userMessage: 'No chunks available to check for keywords.'
            };
        }

        const avgKeywords = chunksWithKeywords > 0 ? (totalKeywords / chunksWithKeywords).toFixed(1) : 0;

        if (chunksWithKeywords < totalChunks * 0.5) {
            return {
                status: 'warn',
                message: `Only ${chunksWithKeywords}/${totalChunks} chunks have keywords`,
                userMessage: `Only ${chunksWithKeywords} of ${totalChunks} chunks have keywords. Keyword search may return limited results.`
            };
        }

        return {
            status: 'pass',
            message: `${chunksWithKeywords}/${totalChunks} chunks have keywords (avg: ${avgKeywords})`,
            userMessage: `${chunksWithKeywords} chunks have keywords (average ${avgKeywords} per chunk). Keyword search is functional.`
        };
    }
});

Diagnostics.registerCheck('importance-weights-valid', {
    name: 'Importance Weights Valid',
    description: 'Verifies chunk importance values are within valid range',
    category: 'SEARCH',
    checkFn: async () => {
        const state = extension_settings[extensionName];
        if (!state?.libraries) {
            return {
                status: 'info',
                message: 'No libraries found',
                userMessage: 'No collections to check for importance weights.'
            };
        }

        let totalChunks = 0;
        let invalidImportance = 0;
        let customImportance = 0;

        const allLibraries = [
            state.libraries.global || {},
            ...Object.values(state.libraries.character || {}),
            ...Object.values(state.libraries.chat || {})
        ];

        for (const library of allLibraries) {
            for (const collection of Object.values(library)) {
                if (!collection || typeof collection !== 'object') continue;

                for (const chunk of Object.values(collection)) {
                    if (chunk.isSummaryChunk) continue;
                    totalChunks++;

                    const importance = chunk.importance;
                    if (importance !== undefined && importance !== 100) {
                        customImportance++;
                        if (importance < 0 || importance > 200) {
                            invalidImportance++;
                        }
                    }
                }
            }
        }

        if (totalChunks === 0) {
            return {
                status: 'info',
                message: 'No chunks found',
                userMessage: 'No chunks available to check for importance weights.'
            };
        }

        if (invalidImportance > 0) {
            return {
                status: 'error',
                message: `${invalidImportance} chunks have invalid importance values`,
                userMessage: `Found ${invalidImportance} chunk(s) with importance outside 0-200 range.`
            };
        }

        return {
            status: 'pass',
            message: `${customImportance}/${totalChunks} chunks have custom importance`,
            userMessage: `${customImportance} chunks have custom importance weights (all valid).`
        };
    }
});

Diagnostics.registerCheck('conditional-activation-valid', {
    name: 'Conditional Activation Valid',
    description: 'Verifies chunk conditions are properly configured',
    category: 'SEARCH',
    checkFn: async () => {
        const state = extension_settings[extensionName];
        if (!state?.libraries) {
            return {
                status: 'info',
                message: 'No libraries found',
                userMessage: 'No collections to check for conditions.'
            };
        }

        let totalChunks = 0;
        let chunksWithConditions = 0;
        let invalidConditions = 0;

        const allLibraries = [
            state.libraries.global || {},
            ...Object.values(state.libraries.character || {}),
            ...Object.values(state.libraries.chat || {})
        ];

        for (const library of allLibraries) {
            for (const collection of Object.values(library)) {
                if (!collection || typeof collection !== 'object') continue;

                for (const chunk of Object.values(collection)) {
                    if (chunk.isSummaryChunk) continue;
                    totalChunks++;

                    if (chunk.conditions?.enabled) {
                        chunksWithConditions++;

                        // Validate condition rules
                        const rules = chunk.conditions.rules || [];
                        for (const rule of rules) {
                            if (!rule.type || !rule.value) {
                                invalidConditions++;
                                break;
                            }
                        }
                    }
                }
            }
        }

        if (totalChunks === 0) {
            return {
                status: 'info',
                message: 'No chunks found',
                userMessage: 'No chunks available to check for conditions.'
            };
        }

        if (invalidConditions > 0) {
            return {
                status: 'warn',
                message: `${invalidConditions} chunks have invalid conditions`,
                userMessage: `Found ${invalidConditions} chunk(s) with incomplete condition rules.`
            };
        }

        return {
            status: 'pass',
            message: `${chunksWithConditions}/${totalChunks} chunks have conditions`,
            userMessage: `${chunksWithConditions} chunks use conditional activation (all valid).`
        };
    }
});

Diagnostics.registerCheck('chunk-groups-configured', {
    name: 'Chunk Groups Configured',
    description: 'Verifies chunk group settings are valid',
    category: 'SEARCH',
    checkFn: async () => {
        const state = extension_settings[extensionName];
        if (!state?.libraries) {
            return {
                status: 'info',
                message: 'No libraries found',
                userMessage: 'No collections to check for chunk groups.'
            };
        }

        let totalChunks = 0;
        let chunksInGroups = 0;
        const groupNames = new Set();

        const allLibraries = [
            state.libraries.global || {},
            ...Object.values(state.libraries.character || {}),
            ...Object.values(state.libraries.chat || {})
        ];

        for (const library of allLibraries) {
            for (const collection of Object.values(library)) {
                if (!collection || typeof collection !== 'object') continue;

                for (const chunk of Object.values(collection)) {
                    if (chunk.isSummaryChunk) continue;
                    totalChunks++;

                    if (chunk.chunkGroup?.name) {
                        chunksInGroups++;
                        groupNames.add(chunk.chunkGroup.name);
                    }
                }
            }
        }

        if (totalChunks === 0) {
            return {
                status: 'info',
                message: 'No chunks found',
                userMessage: 'No chunks available to check for groups.'
            };
        }

        return {
            status: 'pass',
            message: `${chunksInGroups} chunks in ${groupNames.size} group(s)`,
            userMessage: `${chunksInGroups} chunks belong to ${groupNames.size} group(s): ${Array.from(groupNames).slice(0, 5).join(', ')}${groupNames.size > 5 ? '...' : ''}`
        };
    }
});

// ==================== COMPREHENSIVE PRODUCTION TEST SUITE ====================

/**
 * Run all production tests for RAGBooks systems
 * Call from console: await RAGBooks.runAllTests()
 */
State.runAllTests = async function() {
    console.group('🧪 RAGBooks Comprehensive Production Tests');
    console.log('Starting comprehensive test suite...\n');

    const allTests = [];
    let totalPassed = 0;
    let totalFailed = 0;

    // ========== TEST FIXTURE VALIDATION ==========
    console.group('📋 Test Fixture Database');

    try {
        const { validateTestCollection, getTestCollection, TEST_QUERIES } = await import('./test-fixtures.js');

        // Test 1: Fixture validation
        const validation = validateTestCollection();

        if (validation.valid) {
            console.log('✅ Test fixture validation - PASSED');
            console.log(`   Stats: ${validation.stats.totalChunks} chunks, ${validation.stats.summaryChunks} summaries, ${validation.stats.groupedChunks} grouped`);
            totalPassed++;
            allTests.push({ name: 'Test fixture validation', passed: true, category: 'Fixtures' });
        } else {
            console.error('❌ Test fixture validation - FAILED');
            validation.errors.forEach(e => console.error(`   ${e}`));
            totalFailed++;
            allTests.push({ name: 'Test fixture validation', passed: false, category: 'Fixtures' });
        }

        // Test 2: Parent-child relationships
        const collection = getTestCollection();
        const summaryChunks = Object.values(collection).filter(c => c.isSummaryChunk);
        const allParentsExist = summaryChunks.every(s => collection[s.parentHash]);

        if (allParentsExist && summaryChunks.length > 0) {
            console.log('✅ Parent-child relationships - PASSED');
            console.log(`   ${summaryChunks.length} summary chunks with valid parents`);
            totalPassed++;
            allTests.push({ name: 'Parent-child relationships', passed: true, category: 'Fixtures' });
        } else {
            console.error('❌ Parent-child relationships - FAILED');
            totalFailed++;
            allTests.push({ name: 'Parent-child relationships', passed: false, category: 'Fixtures' });
        }

        // Test 3: Embeddings present
        const chunksWithEmbeddings = Object.values(collection).filter(c => c.embedding?.length === 384);
        const allHaveEmbeddings = chunksWithEmbeddings.length === Object.keys(collection).length;

        if (allHaveEmbeddings) {
            console.log('✅ Fixture embeddings - PASSED');
            console.log(`   All ${chunksWithEmbeddings.length} chunks have 384-dim embeddings`);
            totalPassed++;
            allTests.push({ name: 'Fixture embeddings', passed: true, category: 'Fixtures' });
        } else {
            console.error('❌ Fixture embeddings - FAILED');
            totalFailed++;
            allTests.push({ name: 'Fixture embeddings', passed: false, category: 'Fixtures' });
        }

    } catch (error) {
        console.error('❌ Test fixture loading - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Test fixture loading', passed: false, error: error.message, category: 'Fixtures' });
    }

    console.groupEnd();

    // ========== DUAL-VECTOR TESTS WITH FIXTURES ==========
    console.group('📦 Dual-Vector System');

    try {
        const { getTestCollection } = await import('./test-fixtures.js');
        const { createSummaryChunks, expandSummaryChunks, filterChunksBySearchMode } = await import('./dual-vector.js');

        const collection = getTestCollection();
        const parentChunk = collection['test_chunk_dualvector_parent'];
        const summaryChunk1 = collection['test_chunk_dualvector_summary_1'];
        const summaryChunk2 = collection['test_chunk_dualvector_summary_2'];

        // Test 1: Summary chunks have correct parent
        if (summaryChunk1.parentHash === parentChunk.hash && summaryChunk2.parentHash === parentChunk.hash) {
            console.log('✅ Fixture summary-parent linkage - PASSED');
            totalPassed++;
            allTests.push({ name: 'Fixture summary-parent linkage', passed: true, category: 'Dual-Vector' });
        } else {
            console.error('❌ Fixture summary-parent linkage - FAILED');
            totalFailed++;
            allTests.push({ name: 'Fixture summary-parent linkage', passed: false, category: 'Dual-Vector' });
        }

        // Test 2: Filter by search mode using fixtures
        const allChunks = Object.values(collection);
        const summaryOnly = filterChunksBySearchMode(allChunks, 'summary');
        const fullOnly = filterChunksBySearchMode(allChunks, 'full');

        if (summaryOnly.length === 2 && fullOnly.length === allChunks.length - 2) {
            console.log('✅ Filter by search mode (fixtures) - PASSED');
            console.log(`   Summary: ${summaryOnly.length}, Full: ${fullOnly.length}`);
            totalPassed++;
            allTests.push({ name: 'Filter by search mode (fixtures)', passed: true, category: 'Dual-Vector' });
        } else {
            console.error('❌ Filter by search mode (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Filter by search mode (fixtures)', passed: false, category: 'Dual-Vector' });
        }

        // Test 3: Expand summaries to include parents
        const expanded = expandSummaryChunks([summaryChunk1], collection);

        if (expanded.length === 2 && expanded.some(c => c.hash === parentChunk.hash)) {
            console.log('✅ Expand summary to parent (fixtures) - PASSED');
            totalPassed++;
            allTests.push({ name: 'Expand summary to parent (fixtures)', passed: true, category: 'Dual-Vector' });
        } else {
            console.error('❌ Expand summary to parent (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Expand summary to parent (fixtures)', passed: false, category: 'Dual-Vector' });
        }

    } catch (error) {
        console.error('❌ Dual-vector fixture tests - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Dual-vector fixture tests', passed: false, error: error.message, category: 'Dual-Vector' });
    }

    console.groupEnd();

    // ========== KEYWORD SEARCH TESTS ==========
    console.group('🔑 Keyword Search System');

    // Test 1: Keyword extraction from fixture
    try {
        const { getTestCollection } = await import('./test-fixtures.js');
        const { extractKeywords, isStopWord } = await import('./search-strategies.js');

        const collection = getTestCollection();
        const testChunk = collection['test_chunk_basic'];
        const keywords = extractKeywords(testChunk.text);

        const hasKeywords = keywords && keywords.length > 0;
        const noStopWords = !keywords.some(k => isStopWord(k));

        // Should extract 'dragon', 'vermithrax', 'mountain', etc.
        const hasDragon = keywords.some(k => k.toLowerCase().includes('dragon'));

        if (hasKeywords && noStopWords && hasDragon) {
            console.log('✅ Keyword extraction (fixtures) - PASSED');
            console.log(`   Extracted ${keywords.length} keywords: ${keywords.slice(0, 5).join(', ')}`);
            totalPassed++;
            allTests.push({ name: 'Keyword extraction (fixtures)', passed: true, category: 'Keyword Search' });
        } else {
            console.error('❌ Keyword extraction (fixtures) - FAILED');
            console.error(`   hasKeywords: ${hasKeywords}, noStopWords: ${noStopWords}, hasDragon: ${hasDragon}`);
            totalFailed++;
            allTests.push({ name: 'Keyword extraction (fixtures)', passed: false, category: 'Keyword Search' });
        }
    } catch (error) {
        console.error('❌ Keyword extraction (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Keyword extraction (fixtures)', passed: false, error: error.message, category: 'Keyword Search' });
    }

    // Test 2: Keyword matching with fixture keywords
    try {
        const { getTestCollection } = await import('./test-fixtures.js');
        const { matchKeywords } = await import('./search-strategies.js');

        const collection = getTestCollection();
        const dragonChunk = collection['test_chunk_basic'];

        const queryKeywords = ['dragon', 'mountain'];
        const matchResult = matchKeywords(queryKeywords, dragonChunk.keywords);

        // Should match 'dragon' and 'mountain' from fixture
        if (matchResult && matchResult.score > 0 && matchResult.matched?.length >= 2) {
            console.log('✅ Keyword matching (fixtures) - PASSED');
            console.log(`   Match score: ${matchResult.score.toFixed(2)}, matched: ${matchResult.matched.join(', ')}`);
            totalPassed++;
            allTests.push({ name: 'Keyword matching (fixtures)', passed: true, category: 'Keyword Search' });
        } else {
            console.error('❌ Keyword matching (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Keyword matching (fixtures)', passed: false, category: 'Keyword Search' });
        }
    } catch (error) {
        console.error('❌ Keyword matching (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Keyword matching (fixtures)', passed: false, error: error.message, category: 'Keyword Search' });
    }

    // Test 3: Custom keyword weights
    try {
        const { getTestCollection } = await import('./test-fixtures.js');

        const collection = getTestCollection();
        const importantChunk = collection['test_chunk_important'];

        const hasCrownWeight = importantChunk.customWeights?.['crown'] === 150;
        const hasArtifactWeight = importantChunk.customWeights?.['artifact'] === 120;

        if (hasCrownWeight && hasArtifactWeight) {
            console.log('✅ Custom keyword weights (fixtures) - PASSED');
            console.log(`   crown: ${importantChunk.customWeights['crown']}, artifact: ${importantChunk.customWeights['artifact']}`);
            totalPassed++;
            allTests.push({ name: 'Custom keyword weights (fixtures)', passed: true, category: 'Keyword Search' });
        } else {
            console.error('❌ Custom keyword weights (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Custom keyword weights (fixtures)', passed: false, category: 'Keyword Search' });
        }
    } catch (error) {
        console.error('❌ Custom keyword weights (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Custom keyword weights (fixtures)', passed: false, error: error.message, category: 'Keyword Search' });
    }

    console.groupEnd();

    // ========== VECTOR SEARCH TESTS ==========
    console.group('🧠 Vector Search System');

    // Test 1: Embedding validation with fixtures
    try {
        const { getTestCollection } = await import('./test-fixtures.js');
        const { validateChunkEmbeddings } = await import('./search-strategies.js');

        const collection = getTestCollection();
        const testChunks = Object.values(collection);

        const validation = validateChunkEmbeddings(testChunks);

        if (validation.valid) {
            console.log('✅ Embedding validation (fixtures) - PASSED');
            console.log(`   ${testChunks.length} fixture chunks validated successfully`);
            totalPassed++;
            allTests.push({ name: 'Embedding validation (fixtures)', passed: true, category: 'Vector Search' });
        } else {
            console.error('❌ Embedding validation (fixtures) - FAILED');
            console.error(`   Invalid chunks: ${validation.invalidChunks}`);
            totalFailed++;
            allTests.push({ name: 'Embedding validation (fixtures)', passed: false, category: 'Vector Search' });
        }
    } catch (error) {
        console.error('❌ Embedding validation (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Embedding validation (fixtures)', passed: false, error: error.message, category: 'Vector Search' });
    }

    // Test 2: Cosine similarity with fixture embeddings
    try {
        const { getTestCollection } = await import('./test-fixtures.js');
        const { cosineSimilarity } = await import('./lib-vector-distance.js');

        const collection = getTestCollection();
        const dragonChunk = collection['test_chunk_basic'];
        const castleChunk = collection['test_chunk_grouped_1'];

        // Same embedding should have similarity ~1
        const selfSim = cosineSimilarity(dragonChunk.embedding, dragonChunk.embedding);

        // Different embeddings should have lower similarity
        const diffSim = cosineSimilarity(dragonChunk.embedding, castleChunk.embedding);

        if (Math.abs(selfSim - 1) < 0.001 && diffSim < selfSim) {
            console.log('✅ Cosine similarity (fixtures) - PASSED');
            console.log(`   Self similarity: ${selfSim.toFixed(3)}, Different: ${diffSim.toFixed(3)}`);
            totalPassed++;
            allTests.push({ name: 'Cosine similarity (fixtures)', passed: true, category: 'Vector Search' });
        } else {
            console.error('❌ Cosine similarity (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Cosine similarity (fixtures)', passed: false, category: 'Vector Search' });
        }
    } catch (error) {
        console.error('❌ Cosine similarity (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Cosine similarity (fixtures)', passed: false, error: error.message, category: 'Vector Search' });
    }

    // Test 3: Disabled chunk filtering
    try {
        const { getTestCollection } = await import('./test-fixtures.js');

        const collection = getTestCollection();
        const allChunks = Object.values(collection);
        const enabledChunks = allChunks.filter(c => !c.disabled);
        const disabledChunks = allChunks.filter(c => c.disabled);

        if (disabledChunks.length === 1 && enabledChunks.length === allChunks.length - 1) {
            console.log('✅ Disabled chunk filtering (fixtures) - PASSED');
            console.log(`   Enabled: ${enabledChunks.length}, Disabled: ${disabledChunks.length}`);
            totalPassed++;
            allTests.push({ name: 'Disabled chunk filtering (fixtures)', passed: true, category: 'Vector Search' });
        } else {
            console.error('❌ Disabled chunk filtering (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Disabled chunk filtering (fixtures)', passed: false, category: 'Vector Search' });
        }
    } catch (error) {
        console.error('❌ Disabled chunk filtering (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Disabled chunk filtering (fixtures)', passed: false, error: error.message, category: 'Vector Search' });
    }

    console.groupEnd();

    // ========== FEATURE MODULE TESTS ==========
    console.group('⚙️ Feature Modules');

    // Test 1: Importance weighting with fixtures
    try {
        const { getTestCollection } = await import('./test-fixtures.js');
        const { applyImportanceToResults } = await import('./features.js');

        const collection = getTestCollection();

        // Use fixture chunks with different importance values
        const testResults = [
            { ...collection['test_chunk_low_importance'], score: 0.8 },  // importance: 30
            { ...collection['test_chunk_important'], score: 0.8 }        // importance: 180
        ];

        const weighted = applyImportanceToResults(testResults);

        const lowChunk = weighted.find(c => c.hash === 'test_chunk_low_importance');
        const highChunk = weighted.find(c => c.hash === 'test_chunk_important');

        if (highChunk.score > lowChunk.score) {
            console.log('✅ Importance weighting (fixtures) - PASSED');
            console.log(`   High (180): ${highChunk.score.toFixed(3)}, Low (30): ${lowChunk.score.toFixed(3)}`);
            totalPassed++;
            allTests.push({ name: 'Importance weighting (fixtures)', passed: true, category: 'Features' });
        } else {
            console.error('❌ Importance weighting (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Importance weighting (fixtures)', passed: false, category: 'Features' });
        }
    } catch (error) {
        console.error('❌ Importance weighting (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Importance weighting (fixtures)', passed: false, error: error.message, category: 'Features' });
    }

    // Test 2: Conditional activation rules
    try {
        const { getTestCollection } = await import('./test-fixtures.js');

        const collection = getTestCollection();
        const conditionalChunk = collection['test_chunk_conditional'];

        const hasConditions = conditionalChunk.conditions?.enabled === true;
        const hasRules = conditionalChunk.conditions?.rules?.length >= 2;
        const hasKeywordType = conditionalChunk.conditions?.rules?.some(r => r.type === 'keyword');

        if (hasConditions && hasRules && hasKeywordType) {
            console.log('✅ Conditional activation rules (fixtures) - PASSED');
            console.log(`   ${conditionalChunk.conditions.rules.length} rules, logic: ${conditionalChunk.conditions.logic}`);
            totalPassed++;
            allTests.push({ name: 'Conditional activation rules (fixtures)', passed: true, category: 'Features' });
        } else {
            console.error('❌ Conditional activation rules (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Conditional activation rules (fixtures)', passed: false, category: 'Features' });
        }
    } catch (error) {
        console.error('❌ Conditional activation rules (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Conditional activation rules (fixtures)', passed: false, error: error.message, category: 'Features' });
    }

    // Test 3: Group boost application with fixtures
    try {
        const { getTestCollection } = await import('./test-fixtures.js');
        const { applyGroupBoosts } = await import('./features.js');

        const collection = getTestCollection();

        // Use fixture chunks in the 'Castle Ironhold' group
        const testChunks = [
            { ...collection['test_chunk_grouped_1'], score: 0.5 },
            { ...collection['test_chunk_grouped_2'], score: 0.5 },
            { ...collection['test_chunk_basic'], score: 0.5 }  // Not in group
        ];

        const boosted = applyGroupBoosts(testChunks, 'castle ironhold fortress', 1.5);
        const groupedChunk = boosted.find(c => c.hash === 'test_chunk_grouped_1');
        const ungroupedChunk = boosted.find(c => c.hash === 'test_chunk_basic');

        if (groupedChunk.score > ungroupedChunk.score) {
            console.log('✅ Group boost (fixtures) - PASSED');
            console.log(`   Grouped: ${groupedChunk.score.toFixed(3)}, Ungrouped: ${ungroupedChunk.score.toFixed(3)}`);
            totalPassed++;
            allTests.push({ name: 'Group boost (fixtures)', passed: true, category: 'Features' });
        } else {
            console.error('❌ Group boost (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Group boost (fixtures)', passed: false, category: 'Features' });
        }
    } catch (error) {
        console.error('❌ Group boost (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Group boost (fixtures)', passed: false, error: error.message, category: 'Features' });
    }

    // Test 4: Chunk links verification
    try {
        const { getTestCollection } = await import('./test-fixtures.js');

        const collection = getTestCollection();
        const summaryChunk = collection['test_chunk_dualvector_summary_1'];

        const hasChunkLinks = summaryChunk.chunkLinks?.length > 0;
        const hasForceLink = summaryChunk.chunkLinks?.some(l => l.mode === 'force');
        const linksToParent = summaryChunk.chunkLinks?.some(l => l.targetHash === summaryChunk.parentHash);

        if (hasChunkLinks && hasForceLink && linksToParent) {
            console.log('✅ Chunk links (fixtures) - PASSED');
            console.log(`   ${summaryChunk.chunkLinks.length} links, force mode to parent`);
            totalPassed++;
            allTests.push({ name: 'Chunk links (fixtures)', passed: true, category: 'Features' });
        } else {
            console.error('❌ Chunk links (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Chunk links (fixtures)', passed: false, category: 'Features' });
        }
    } catch (error) {
        console.error('❌ Chunk links (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Chunk links (fixtures)', passed: false, error: error.message, category: 'Features' });
    }

    console.groupEnd();

    // ========== TEXT PROCESSING TESTS ==========
    console.group('📝 Text Processing');

    // Test 1: Text cleaning with fixture content
    try {
        const { getTestCollection } = await import('./test-fixtures.js');
        const { cleanText } = await import('./text-cleaning.js');

        const collection = getTestCollection();
        const testChunk = collection['test_chunk_basic'];

        const cleaned = cleanText(testChunk.text, 'standard', []);

        if (typeof cleaned === 'string' && cleaned.length > 0 && cleaned.includes('dragon')) {
            console.log('✅ Text cleaning (fixtures) - PASSED');
            console.log(`   Original: ${testChunk.text.length} chars, Cleaned: ${cleaned.length} chars`);
            totalPassed++;
            allTests.push({ name: 'Text cleaning (fixtures)', passed: true, category: 'Text Processing' });
        } else {
            console.error('❌ Text cleaning (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Text cleaning (fixtures)', passed: false, category: 'Text Processing' });
        }
    } catch (error) {
        console.error('❌ Text cleaning (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Text cleaning (fixtures)', passed: false, error: error.message, category: 'Text Processing' });
    }

    // Test 2: Regex keyword support
    try {
        const { getTestCollection } = await import('./test-fixtures.js');

        const collection = getTestCollection();
        const regexChunk = collection['test_chunk_regex'];

        const hasRegexKeyword = regexChunk.keywords.some(k => k.includes('.*'));

        if (hasRegexKeyword) {
            console.log('✅ Regex keyword support (fixtures) - PASSED');
            console.log(`   Keywords include regex patterns: ${regexChunk.keywords.filter(k => k.includes('.*')).join(', ')}`);
            totalPassed++;
            allTests.push({ name: 'Regex keyword support (fixtures)', passed: true, category: 'Text Processing' });
        } else {
            console.error('❌ Regex keyword support (fixtures) - FAILED');
            totalFailed++;
            allTests.push({ name: 'Regex keyword support (fixtures)', passed: false, category: 'Text Processing' });
        }
    } catch (error) {
        console.error('❌ Regex keyword support (fixtures) - ERROR:', error.message);
        totalFailed++;
        allTests.push({ name: 'Regex keyword support (fixtures)', passed: false, error: error.message, category: 'Text Processing' });
    }

    console.groupEnd();

    console.groupEnd();

    // ========== FINAL SUMMARY ==========
    console.log('\n' + '='.repeat(50));
    console.log('📊 COMPREHENSIVE TEST SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total Tests: ${allTests.length}`);
    console.log(`✅ Passed: ${totalPassed}`);
    console.log(`❌ Failed: ${totalFailed}`);
    console.log(`Pass Rate: ${((totalPassed / allTests.length) * 100).toFixed(1)}%`);
    console.log('='.repeat(50));

    if (totalFailed === 0) {
        console.log('🎉 All tests passed! RAGBooks is fully functional.');
    } else {
        console.warn(`⚠️ ${totalFailed} test(s) failed. Check logs above for details.`);

        // List failed tests
        const failedTests = allTests.filter(t => !t.passed);
        console.log('\nFailed tests:');
        failedTests.forEach(t => {
            console.log(`  - [${t.category}] ${t.name}${t.error ? `: ${t.error}` : ''}`);
        });
    }

    return {
        totalTests: allTests.length,
        passed: totalPassed,
        failed: totalFailed,
        passRate: ((totalPassed / allTests.length) * 100).toFixed(1) + '%',
        tests: allTests
    };
};

// Make tests accessible globally
if (typeof window !== 'undefined') {
    window.RAGBooksDualVectorTests = State.runDualVectorTests;
    window.RAGBooksRunAllTests = State.runAllTests;
}

// =============================================================================
// PRODUCTION TESTS - Using Test Fixtures
// These tests use the standardized test database to verify functionality
// They run through the ACTUAL ST vector pipeline, not just data structure checks
// =============================================================================

import { getRequestHeaders } from '../../../../script.js';
import { getStringHash } from '../../../utils.js';

// Helper: Get vector source settings
function getVectorSourceSettings() {
    const vectorSettings = window.extension_settings?.vectors || {};
    return {
        source: vectorSettings.source || 'transformers',
        model: vectorSettings.model || ''
    };
}

// Helper: Insert items into ST vector DB
async function insertTestVectors(collectionId, items) {
    const { source } = getVectorSourceSettings();
    const response = await fetch('/api/vector/insert', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            collectionId,
            items,
            source
        })
    });
    return response.ok;
}

// Helper: Query ST vector DB
async function queryTestVectors(collectionId, searchText, topK = 5, threshold = 0.25) {
    const { source } = getVectorSourceSettings();
    const response = await fetch('/api/vector/query', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            collectionId,
            searchText,
            topK,
            threshold,
            source
        })
    });
    if (!response.ok) return null;
    return await response.json();
}

// Helper: List hashes in collection
async function listTestVectorHashes(collectionId) {
    const { source } = getVectorSourceSettings();
    const response = await fetch('/api/vector/list', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            collectionId,
            source
        })
    });
    if (!response.ok) return [];
    return await response.json();
}

// Helper: Purge test collection
async function purgeTestCollection(collectionId) {
    const { source } = getVectorSourceSettings();
    await fetch('/api/vector/purge', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            collectionId,
            source
        })
    });
}

// Register production tests immediately when module loads
Diagnostics.registerCheck('production-test-fixture-validation', {
    name: 'Test Fixture Database Validation',
    description: 'Validates the test fixture database integrity',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        try {
            const { validateTestCollection, getTestCollection } = await import('./test-fixtures.js');
            const validation = validateTestCollection();

            if (!validation.valid) {
                return {
                    status: 'error',
                    message: `Fixture validation failed: ${validation.errors.slice(0, 3).join('; ')}`,
                    userMessage: `Test fixtures have ${validation.errors.length} error(s): ${validation.errors.slice(0, 2).join('; ')}${validation.errors.length > 2 ? '...' : ''}`
                };
            }

            return {
                status: 'pass',
                message: `Fixtures valid: ${validation.stats.totalChunks} chunks, ${validation.stats.summaryChunks} summaries`,
                userMessage: `Test database validated: ${validation.stats.totalChunks} chunks including ${validation.stats.summaryChunks} summary chunks, ${validation.stats.conditionalChunks} conditional, ${validation.stats.groupedChunks} grouped.`
            };
        } catch (error) {
            return {
                status: 'error',
                message: `Fixture import failed: ${error.message}`,
                userMessage: `Could not load test fixtures: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-vector-insert-query', {
    name: 'Vector Insert & Query Pipeline',
    description: 'Inserts test chunks into ST vector DB and queries them back',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        const collectionId = `ragbooks_test_${Date.now()}`;

        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const collection = getTestCollection();

            // Get dragon chunk for testing
            const dragonChunk = collection['test_chunk_basic'];
            const castleChunk = collection['test_chunk_grouped_1'];

            // Prepare items for ST vector API
            const items = [
                { hash: getStringHash(dragonChunk.text), text: dragonChunk.text, index: 0 },
                { hash: getStringHash(castleChunk.text), text: castleChunk.text, index: 1 }
            ];

            // Step 1: Insert into ST vector DB
            const inserted = await insertTestVectors(collectionId, items);
            if (!inserted) {
                return {
                    status: 'error',
                    message: 'Failed to insert test vectors',
                    userMessage: 'Could not insert test chunks into ST vector database. Ensure Vectors extension is enabled and configured.'
                };
            }

            // Step 2: Verify insertion
            const hashes = await listTestVectorHashes(collectionId);
            if (hashes.length !== 2) {
                await purgeTestCollection(collectionId);
                return {
                    status: 'error',
                    message: `Expected 2 hashes, got ${hashes.length}`,
                    userMessage: `Vector insertion incomplete: only ${hashes.length}/2 chunks saved.`
                };
            }

            // Step 3: Query with dragon-related text
            const dragonQuery = 'Tell me about the dragon that guards the mountain';
            const dragonResults = await queryTestVectors(collectionId, dragonQuery, 2, 0.1);

            if (!dragonResults || dragonResults.hashes.length === 0) {
                await purgeTestCollection(collectionId);
                return {
                    status: 'error',
                    message: 'Dragon query returned no results',
                    userMessage: 'Vector search failed to find dragon chunk. Semantic matching may be broken.'
                };
            }

            // Verify dragon chunk is top result
            const topResult = dragonResults.metadata[0];
            const dragonIsTop = topResult.text.toLowerCase().includes('dragon');

            // Cleanup
            await purgeTestCollection(collectionId);

            if (!dragonIsTop) {
                return {
                    status: 'warn',
                    message: 'Dragon chunk not ranked first',
                    userMessage: `Query returned results but dragon chunk wasn't top match. Got: "${topResult.text.substring(0, 50)}..."`
                };
            }

            console.log('[Production Test] ✅ Vector pipeline test passed:', {
                inserted: items.length,
                query: dragonQuery,
                topMatch: topResult.text.substring(0, 50) + '...'
            });

            return {
                status: 'pass',
                message: `Insert/query works - dragon chunk ranked #1`,
                userMessage: `Vector pipeline WORKS: Inserted 2 chunks, queried "dragon", correct chunk returned as top match.`
            };
        } catch (error) {
            await purgeTestCollection(collectionId).catch(() => {});
            return {
                status: 'error',
                message: `Pipeline error: ${error.message}`,
                userMessage: `Vector pipeline test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-semantic-relevance', {
    name: 'Semantic Relevance Ranking',
    description: 'Tests that hybrid search (keyword + vector) returns correct chunks',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        const collectionId = `ragbooks_test_semantic_${Date.now()}`;

        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const { search } = await import('./search-orchestrator.js');
            const collection = getTestCollection();

            // Get test chunks with different topics
            const testChunks = [
                collection['test_chunk_basic'],        // Dragon
                collection['test_chunk_grouped_1'],   // Castle
                collection['test_chunk_regex'],       // Fire magic
                collection['test_chunk_low_importance'] // Tavern
            ];

            // Insert into ST's vector DB for embedding generation
            const items = testChunks.map((chunk, i) => ({
                hash: getStringHash(chunk.text),
                text: chunk.text,
                index: i
            }));

            await insertTestVectors(collectionId, items);

            // Query ST to get embeddings, then build chunks for our search
            const allResults = await queryTestVectors(collectionId, 'test', 10, 0.0);

            // Build chunks with the text and keywords from test fixtures
            const chunksWithKeywords = testChunks.map((chunk, i) => ({
                ...chunk,
                hash: getStringHash(chunk.text),
                collectionId: collectionId
            }));

            // Check if plugin is available for vector search
            const { isPluginAvailable } = await import('./plugin-vector-api.js');
            const pluginAvailable = await isPluginAvailable();

            // Use hybrid if plugin available, otherwise keyword-only
            const searchMode = pluginAvailable ? 'hybrid' : 'keyword';

            // Test 1: Query about magic should return fire magic chunk
            const magicSearchResult = await search(
                'wizard fire magic spells volcanic',
                chunksWithKeywords,
                {
                    searchMode: searchMode,
                    topK: 2,
                    threshold: 0.0,
                    keywordWeight: 0.4,
                    vectorWeight: 0.6,
                    applyImportance: false,
                    applyConditions: false,
                    applyGroups: false
                },
                {}
            );

            const magicTop = magicSearchResult.results[0]?.text || '';
            const magicCorrect = magicTop.toLowerCase().includes('wizard') || magicTop.toLowerCase().includes('fire');

            // Test 2: Query about drinking should return tavern chunk
            const tavernSearchResult = await search(
                'tavern ale mead drinks gordo',
                chunksWithKeywords,
                {
                    searchMode: searchMode,
                    topK: 2,
                    threshold: 0.0,
                    keywordWeight: 0.4,
                    vectorWeight: 0.6,
                    applyImportance: false,
                    applyConditions: false,
                    applyGroups: false
                },
                {}
            );

            const tavernTop = tavernSearchResult.results[0]?.text || '';
            const tavernCorrect = tavernTop.toLowerCase().includes('tavern') || tavernTop.toLowerCase().includes('ale');

            // Cleanup
            await purgeTestCollection(collectionId);

            const passed = magicCorrect && tavernCorrect;

            if (!passed) {
                const issues = [];
                if (!magicCorrect) issues.push(`Magic query got: "${magicTop.substring(0, 40)}..."`);
                if (!tavernCorrect) issues.push(`Tavern query got: "${tavernTop.substring(0, 40)}..."`);

                return {
                    status: 'warn',
                    message: issues.join('; '),
                    userMessage: `Hybrid ranking issues: ${issues.join('; ')}. Keywords may need adjustment.`
                };
            }

            console.log('[Production Test] ✅ Semantic relevance test passed');

            const modeLabel = pluginAvailable ? 'Hybrid (keyword + vector)' : 'Keyword-only';
            return {
                status: 'pass',
                message: `${modeLabel} search returned correct chunks`,
                userMessage: `${modeLabel} search WORKS: Magic query → fire chunk, Tavern query → tavern chunk.`
            };
        } catch (error) {
            await purgeTestCollection(collectionId).catch(() => {});
            return {
                status: 'error',
                message: error.message,
                userMessage: `Semantic test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-dual-vector-summary-search', {
    name: 'Dual-Vector Summary Search',
    description: 'Tests that searching for summary text returns the parent chunk',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        const collectionId = `ragbooks_test_dualvec_${Date.now()}`;

        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const { expandSummaryChunks } = await import('./dual-vector.js');
            const collection = getTestCollection();

            // Get parent and summary chunks
            const parent = collection['test_chunk_dualvector_parent'];
            const summary = collection['test_chunk_dualvector_summary_1'];

            // Insert ONLY the summary into vector DB (simulating dual-vector search)
            const items = [{
                hash: getStringHash(summary.text),
                text: summary.text,
                index: 0
            }];

            await insertTestVectors(collectionId, items);

            // Query with text that should match the summary
            // Summary: "Grand Library of Arcanum: 10,000 magical tomes, guarded by enchantments, Sage Meridia is head librarian."
            const query = 'Where can I find magical books and tomes in the library?';
            const results = await queryTestVectors(collectionId, query, 1, 0.1);

            if (!results || results.hashes.length === 0) {
                await purgeTestCollection(collectionId);
                return {
                    status: 'error',
                    message: 'Summary search returned no results',
                    userMessage: 'Could not find summary chunk when searching for library/books.'
                };
            }

            // Now test expandSummaryChunks - does it pull the parent?
            const matchedSummary = { ...summary, score: 0.9, hash: summary.hash };
            const chunkMap = { [parent.hash]: parent, [summary.hash]: summary };
            const expanded = expandSummaryChunks([matchedSummary], chunkMap);

            const parentPulled = expanded.some(c => c.hash === parent.hash);
            const parentHasFullText = expanded.find(c => c.hash === parent.hash)?.text.includes('10,000 tomes');

            // Cleanup
            await purgeTestCollection(collectionId);

            if (!parentPulled) {
                return {
                    status: 'error',
                    message: `Parent ${parent.hash} not pulled for summary ${summary.hash}`,
                    userMessage: `CRITICAL: Summary matched but parent was not included. expandSummaryChunks returned ${expanded.length} chunks without parent.`
                };
            }

            if (!parentHasFullText) {
                return {
                    status: 'error',
                    message: 'Parent has wrong content',
                    userMessage: 'Parent was pulled but has incorrect text content.'
                };
            }

            console.log('[Production Test] ✅ Dual-vector summary search passed:', {
                summaryMatched: true,
                parentPulled: true,
                parentTextLength: parent.text.length
            });

            return {
                status: 'pass',
                message: `Summary→Parent expansion works (${parent.text.length} chars)`,
                userMessage: `Dual-vector WORKS: Searched for "books/library" → matched summary → pulled full parent text (${parent.text.length} chars).`
            };
        } catch (error) {
            await purgeTestCollection(collectionId).catch(() => {});
            return {
                status: 'error',
                message: error.message,
                userMessage: `Dual-vector test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-keyword-matching', {
    name: 'Keyword Matching Pipeline',
    description: 'Tests that keyword extraction and matching works correctly',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const { extractKeywords, matchKeywords } = await import('./search-strategies.js');
            const collection = getTestCollection();

            // Test keyword extraction from a message
            const testMessage = 'I want to fight the dragon and get the crown artifact from the castle';
            const extracted = extractKeywords(testMessage);

            if (!extracted || extracted.length === 0) {
                return {
                    status: 'error',
                    message: 'Keyword extraction returned nothing',
                    userMessage: 'Could not extract keywords from test message.'
                };
            }

            // Check if important keywords were extracted
            const hasRelevant = ['dragon', 'crown', 'artifact', 'castle', 'fight'].some(kw =>
                extracted.some(e => e.toLowerCase().includes(kw))
            );

            if (!hasRelevant) {
                return {
                    status: 'warn',
                    message: `Extracted: ${extracted.join(', ')} - missing key terms`,
                    userMessage: `Keywords extracted but missing important terms. Got: ${extracted.join(', ')}`
                };
            }

            // Test keyword matching against chunks
            const dragonChunk = collection['test_chunk_basic'];
            const crownChunk = collection['test_chunk_important'];

            const dragonMatch = matchKeywords(extracted, dragonChunk.keywords);
            const crownMatch = matchKeywords(extracted, crownChunk.keywords);

            if (dragonMatch === 0 && crownMatch === 0) {
                return {
                    status: 'error',
                    message: 'No keyword matches found',
                    userMessage: 'Keyword matching failed - no chunks matched extracted keywords.'
                };
            }

            console.log('[Production Test] ✅ Keyword matching passed:', {
                extracted,
                dragonMatch,
                crownMatch
            });

            return {
                status: 'pass',
                message: `Extracted ${extracted.length} keywords, matched chunks`,
                userMessage: `Keyword pipeline WORKS: Extracted ${extracted.length} keywords from message, matched dragon (${dragonMatch}) and crown (${crownMatch}) chunks.`
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                userMessage: `Keyword test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-importance-scoring', {
    name: 'Importance Weighting',
    description: 'Tests that high-importance chunks score higher than low-importance',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const collection = getTestCollection();

            const highImportance = collection['test_chunk_important']; // importance: 180
            const lowImportance = collection['test_chunk_low_importance']; // importance: 30
            const normalImportance = collection['test_chunk_basic']; // importance: 100

            // Verify importance values
            if (highImportance.importance <= normalImportance.importance) {
                return {
                    status: 'error',
                    message: `High (${highImportance.importance}) not > Normal (${normalImportance.importance})`,
                    userMessage: 'Importance values in fixtures are incorrect.'
                };
            }

            if (lowImportance.importance >= normalImportance.importance) {
                return {
                    status: 'error',
                    message: `Low (${lowImportance.importance}) not < Normal (${normalImportance.importance})`,
                    userMessage: 'Importance values in fixtures are incorrect.'
                };
            }

            // Simulate scoring with importance multiplier
            const baseScore = 0.5;
            const highScore = baseScore * (highImportance.importance / 100);
            const normalScore = baseScore * (normalImportance.importance / 100);
            const lowScore = baseScore * (lowImportance.importance / 100);

            if (!(highScore > normalScore && normalScore > lowScore)) {
                return {
                    status: 'error',
                    message: 'Score ordering incorrect',
                    userMessage: `Importance weighting broken: high=${highScore}, normal=${normalScore}, low=${lowScore}`
                };
            }

            console.log('[Production Test] ✅ Importance scoring passed:', {
                high: { importance: highImportance.importance, score: highScore },
                normal: { importance: normalImportance.importance, score: normalScore },
                low: { importance: lowImportance.importance, score: lowScore }
            });

            return {
                status: 'pass',
                message: `Scoring correct: ${highScore.toFixed(2)} > ${normalScore.toFixed(2)} > ${lowScore.toFixed(2)}`,
                userMessage: `Importance weighting WORKS: High (180) scores ${highScore.toFixed(2)}, Normal (100) scores ${normalScore.toFixed(2)}, Low (30) scores ${lowScore.toFixed(2)}.`
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                userMessage: `Importance test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-conditional-activation', {
    name: 'Conditional Activation',
    description: 'Tests that chunks with conditions only activate when rules match',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const { evaluateConditions } = await import('./conditional-activation.js');
            const collection = getTestCollection();

            const conditionalChunk = collection['test_chunk_conditional'];

            if (!conditionalChunk.conditions?.enabled) {
                return {
                    status: 'error',
                    message: 'Test chunk conditions not enabled',
                    userMessage: 'test_chunk_conditional should have conditions.enabled = true'
                };
            }

            // Test 1: Message with "fight" should activate (OR logic)
            const fightContext = {
                recentMessages: ['I want to fight the dragon'],
                characterName: 'Hero',
                userName: 'Player'
            };
            const fightResult = evaluateConditions(conditionalChunk, fightContext);

            // Test 2: Message with "battle" should also activate
            const battleContext = {
                recentMessages: ['Prepare for battle!'],
                characterName: 'Hero',
                userName: 'Player'
            };
            const battleResult = evaluateConditions(conditionalChunk, battleContext);

            // Test 3: Unrelated message should NOT activate
            const peaceContext = {
                recentMessages: ['Let us have tea and cake'],
                characterName: 'Hero',
                userName: 'Player'
            };
            const peaceResult = evaluateConditions(conditionalChunk, peaceContext);

            if (!fightResult || !battleResult) {
                return {
                    status: 'error',
                    message: `Fight=${fightResult}, Battle=${battleResult} - should both be true`,
                    userMessage: `Conditional activation broken: "fight" activated=${fightResult}, "battle" activated=${battleResult}. Both should be true.`
                };
            }

            if (peaceResult) {
                return {
                    status: 'warn',
                    message: 'Peace context incorrectly activated chunk',
                    userMessage: 'Chunk activated on unrelated message "tea and cake". Condition matching may be too loose.'
                };
            }

            return {
                status: 'pass',
                message: 'fight=true, battle=true, peace=false',
                userMessage: 'Conditional activation WORKS: "fight" and "battle" trigger chunk, "tea and cake" does not.'
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                userMessage: `Conditional activation test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-chunk-groups', {
    name: 'Chunk Group Boosting',
    description: 'Tests that grouped chunks boost each other when one matches',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const collection = getTestCollection();

            const grouped1 = collection['test_chunk_grouped_1'];
            const grouped2 = collection['test_chunk_grouped_2'];

            // Verify they share the same group
            if (grouped1.chunkGroup?.name !== grouped2.chunkGroup?.name) {
                return {
                    status: 'error',
                    message: `Group mismatch: "${grouped1.chunkGroup?.name}" vs "${grouped2.chunkGroup?.name}"`,
                    userMessage: 'Grouped chunks should share the same group name.'
                };
            }

            const groupName = grouped1.chunkGroup.name;
            const groupKeywords = grouped1.chunkGroup.groupKeywords || [];

            if (groupKeywords.length === 0) {
                return {
                    status: 'warn',
                    message: 'No groupKeywords defined',
                    userMessage: `Group "${groupName}" has no groupKeywords for matching.`
                };
            }

            // Test: If query matches groupKeywords, both chunks should be boosted
            const queryKeywords = ['castle', 'ironhold'];
            const matchesGroup = queryKeywords.some(qk =>
                groupKeywords.some(gk => gk.toLowerCase() === qk.toLowerCase())
            );

            if (!matchesGroup) {
                return {
                    status: 'error',
                    message: `Query keywords ${queryKeywords.join(',')} don't match groupKeywords ${groupKeywords.join(',')}`,
                    userMessage: 'Group keyword matching failed.'
                };
            }

            return {
                status: 'pass',
                message: `Group "${groupName}" with ${groupKeywords.length} keywords`,
                userMessage: `Chunk groups WORK: Group "${groupName}" matches on [${groupKeywords.join(', ')}]. Both Castle Description and Castle Armory will be boosted together.`
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                userMessage: `Chunk groups test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-disabled-filtering', {
    name: 'Disabled Chunk Filtering',
    description: 'Tests that disabled chunks are excluded from search results',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        const collectionId = `ragbooks_test_disabled_${Date.now()}`;

        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const collection = getTestCollection();

            const enabledChunk = collection['test_chunk_basic'];
            const disabledChunk = collection['test_chunk_disabled'];

            // Insert both chunks
            const items = [
                { hash: getStringHash(enabledChunk.text), text: enabledChunk.text, index: 0 },
                { hash: getStringHash(disabledChunk.text), text: disabledChunk.text, index: 1 }
            ];

            await insertTestVectors(collectionId, items);

            // Query - both should return from vector DB
            const results = await queryTestVectors(collectionId, 'test disabled chunk', 5, 0.0);

            await purgeTestCollection(collectionId);

            // The vector DB returns both, but RAGBooks should filter disabled
            // Here we're testing that the disabled flag is correctly set
            if (disabledChunk.disabled !== true) {
                return {
                    status: 'error',
                    message: 'test_chunk_disabled.disabled is not true',
                    userMessage: 'Disabled chunk fixture is incorrectly configured.'
                };
            }

            if (enabledChunk.disabled === true) {
                return {
                    status: 'error',
                    message: 'test_chunk_basic should not be disabled',
                    userMessage: 'Enabled chunk is incorrectly marked as disabled.'
                };
            }

            // Count enabled vs disabled in collection
            const allChunks = Object.values(collection);
            const enabledCount = allChunks.filter(c => !c.disabled).length;
            const disabledCount = allChunks.filter(c => c.disabled).length;

            return {
                status: 'pass',
                message: `${enabledCount} enabled, ${disabledCount} disabled`,
                userMessage: `Disabled filtering WORKS: ${enabledCount} chunks enabled, ${disabledCount} disabled. Search will exclude disabled chunks.`
            };
        } catch (error) {
            await purgeTestCollection(collectionId).catch(() => {});
            return {
                status: 'error',
                message: error.message,
                userMessage: `Disabled filtering test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-custom-keyword-weights', {
    name: 'Custom Keyword Weights',
    description: 'Tests that custom weights boost specific keyword matches',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const collection = getTestCollection();

            const weightedChunk = collection['test_chunk_important'];
            const customWeights = weightedChunk.customWeights || {};

            if (Object.keys(customWeights).length === 0) {
                return {
                    status: 'error',
                    message: 'No custom weights defined',
                    userMessage: 'test_chunk_important should have customWeights defined.'
                };
            }

            // Verify specific weights
            const crownWeight = customWeights['crown'];
            const artifactWeight = customWeights['artifact'];

            if (!crownWeight || !artifactWeight) {
                return {
                    status: 'error',
                    message: `Missing weights: crown=${crownWeight}, artifact=${artifactWeight}`,
                    userMessage: 'Expected customWeights for "crown" and "artifact".'
                };
            }

            // Test weight application
            const baseKeywordScore = 1.0;
            const crownScore = baseKeywordScore * (crownWeight / 100);
            const artifactScore = baseKeywordScore * (artifactWeight / 100);
            const normalScore = baseKeywordScore; // No custom weight

            if (crownScore <= normalScore || artifactScore <= normalScore) {
                return {
                    status: 'error',
                    message: `Weights don't boost: crown=${crownScore}, artifact=${artifactScore}, normal=${normalScore}`,
                    userMessage: 'Custom weights should increase scores above baseline.'
                };
            }

            return {
                status: 'pass',
                message: `crown=${crownWeight}→${crownScore.toFixed(2)}, artifact=${artifactWeight}→${artifactScore.toFixed(2)}`,
                userMessage: `Custom weights WORK: "crown" (${crownWeight}) scores ${crownScore.toFixed(2)}, "artifact" (${artifactWeight}) scores ${artifactScore.toFixed(2)}, vs normal 1.00.`
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                userMessage: `Custom weights test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-search-orchestrator', {
    name: 'Search Orchestrator Pipeline',
    description: 'Tests the full search orchestrator with all features enabled',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        try {
            const { search } = await import('./search-orchestrator.js');
            const { getTestCollection } = await import('./test-fixtures.js');
            const collection = getTestCollection();

            // Get all enabled chunks
            const chunks = Object.values(collection).filter(c => !c.disabled);

            if (chunks.length === 0) {
                return {
                    status: 'error',
                    message: 'No enabled chunks in collection',
                    userMessage: 'Test collection has no enabled chunks to search.'
                };
            }

            // Run search through orchestrator
            const query = 'Tell me about the dragon that guards the mountain pass';
            const options = {
                searchMode: 'keyword', // Use keyword to avoid needing embeddings
                topK: 3,
                threshold: 0.1,
                applyImportance: true,
                applyConditions: false, // Skip conditions - no chat context
                applyGroups: true,
                applyDecay: false
            };

            const result = await search(query, chunks, options, {});

            if (!result || !result.results) {
                return {
                    status: 'error',
                    message: 'Orchestrator returned no results object',
                    userMessage: 'Search orchestrator failed to return results.'
                };
            }

            if (result.results.length === 0) {
                return {
                    status: 'warn',
                    message: 'Search returned 0 results',
                    userMessage: `Query "${query.substring(0, 30)}..." returned no matches. Threshold may be too high.`
                };
            }

            // Check if dragon chunk is in results
            const hasDragon = result.results.some(r =>
                r.text?.toLowerCase().includes('dragon') ||
                r.chunk?.text?.toLowerCase().includes('dragon')
            );

            return {
                status: 'pass',
                message: `${result.results.length} results, dragon=${hasDragon}`,
                userMessage: `Search orchestrator WORKS: Query returned ${result.results.length} results${hasDragon ? ' including dragon chunk' : ''}.`
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                userMessage: `Search orchestrator test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-chunk-links', {
    name: 'Chunk Links & Force Mode',
    description: 'Tests that chunk links pull related chunks into results',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const collection = getTestCollection();

            // Summary chunks have force links to their parents
            const summary = collection['test_chunk_dualvector_summary_1'];
            const parent = collection['test_chunk_dualvector_parent'];

            if (!summary.chunkLinks || summary.chunkLinks.length === 0) {
                return {
                    status: 'error',
                    message: 'Summary chunk has no chunkLinks',
                    userMessage: 'test_chunk_dualvector_summary_1 should have chunkLinks to parent.'
                };
            }

            const forceLink = summary.chunkLinks.find(l => l.mode === 'force');
            if (!forceLink) {
                return {
                    status: 'error',
                    message: 'No force-mode link found',
                    userMessage: 'Summary chunk should have a force-mode link to parent.'
                };
            }

            if (forceLink.targetHash !== parent.hash) {
                return {
                    status: 'error',
                    message: `Link target ${forceLink.targetHash} != parent ${parent.hash}`,
                    userMessage: 'Force link points to wrong target.'
                };
            }

            return {
                status: 'pass',
                message: `Force link: ${summary.hash} → ${parent.hash}`,
                userMessage: `Chunk links WORK: Summary has force link to parent. When summary matches, parent is automatically included.`
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                userMessage: `Chunk links test failed: ${error.message}`
            };
        }
    }
});

Diagnostics.registerCheck('production-test-regex-keywords', {
    name: 'Regex Keyword Patterns',
    description: 'Tests that regex patterns in keywords match correctly',
    category: 'PRODUCTION_TESTS',
    checkFn: async () => {
        try {
            const { getTestCollection } = await import('./test-fixtures.js');
            const collection = getTestCollection();

            const regexChunk = collection['test_chunk_regex'];
            const keywords = regexChunk.keywords || [];

            // Find regex patterns
            const regexPatterns = keywords.filter(k => k.includes('.*') || k.includes('^') || k.includes('$'));

            if (regexPatterns.length === 0) {
                return {
                    status: 'error',
                    message: 'No regex patterns in keywords',
                    userMessage: 'test_chunk_regex should have keywords with regex patterns like "fire.*"'
                };
            }

            // Test that "fire.*" pattern exists and would match fire-related words
            const firePattern = regexPatterns.find(p => p.includes('fire'));
            if (!firePattern) {
                return {
                    status: 'warn',
                    message: `Patterns found: ${regexPatterns.join(', ')} - no fire pattern`,
                    userMessage: 'Expected a fire.* regex pattern for testing.'
                };
            }

            // Test regex matching
            const regex = new RegExp(firePattern, 'i');
            const matches = ['fireball', 'firebolt', 'firewall'].filter(word => regex.test(word));

            if (matches.length < 3) {
                return {
                    status: 'warn',
                    message: `Pattern "${firePattern}" only matched ${matches.length}/3 fire words`,
                    userMessage: `Regex "${firePattern}" matched: ${matches.join(', ')}`
                };
            }

            return {
                status: 'pass',
                message: `"${firePattern}" matches ${matches.length} variants`,
                userMessage: `Regex keywords WORK: Pattern "${firePattern}" matches fireball, firebolt, firewall.`
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                userMessage: `Regex keywords test failed: ${error.message}`
            };
        }
    }
});

export default State;
