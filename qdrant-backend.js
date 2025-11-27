/**
 * ============================================================================
 * QDRANT BACKEND (MULTITENANCY ARCHITECTURE)
 * ============================================================================
 * Server-side Qdrant vector database operations with multitenancy support.
 * Uses ONE main collection with payload filters for different data types.
 *
 * Why Qdrant?
 * - Purpose-built for vector search (not a general DB)
 * - Advanced filtering with payloads (PERFECT for multitenancy)
 * - Horizontal scaling support
 * - HNSW and disk-backed indexes
 * - Production-grade with Rust core
 *
 * Multitenancy Strategy:
 * - ONE collection: "vecthare_main"
 * - Payload fields: type, sourceId, timestamp, etc.
 * - Filters for isolation: {type: "chat", sourceId: "chat_001"}
 *
 * @author VectHare
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Qdrant Backend Manager
 * Manages Qdrant client connection and operations
 */
class QdrantBackend {
    constructor() {
        this.client = null;
        this.config = {
            host: 'localhost',
            port: 6333,
            url: null,
            apiKey: null,
        };
    }

    /**
     * Initialize Qdrant connection
     * @param {object} config - Configuration { host, port, url, apiKey }
     */
    async initialize(config = {}) {
        if (this.client) return; // Already initialized

        // Merge config
        this.config = { ...this.config, ...config };

        // Create client
        if (this.config.url) {
            // Cloud or custom URL
            this.client = new QdrantClient({
                url: this.config.url,
                apiKey: this.config.apiKey,
            });
        } else {
            // Local instance
            this.client = new QdrantClient({
                host: this.config.host,
                port: this.config.port,
            });
        }

        console.log('[Qdrant] Initialized:', this.config.url || `${this.config.host}:${this.config.port}`);

        // Ensure indexes exist on any existing vecthare_main collection
        await this.ensurePayloadIndexes('vecthare_main');
    }

    /**
     * Health check
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        try {
            if (!this.client) return false;
            await this.client.getCollections();
            return true;
        } catch (error) {
            console.error('[Qdrant] Health check failed:', error);
            return false;
        }
    }

    /**
     * Ensure collection exists with proper schema and payload indexes
     * @param {string} collectionName - Collection name
     * @param {number} vectorSize - Vector dimension (e.g., 768)
     */
    async ensureCollection(collectionName, vectorSize = 768) {
        try {
            // Check if collection exists
            const collections = await this.client.getCollections();
            const exists = collections.collections.some(c => c.name === collectionName);

            if (!exists) {
                // Create collection
                await this.client.createCollection(collectionName, {
                    vectors: {
                        size: vectorSize,
                        distance: 'Cosine',
                    },
                });
                console.log(`[Qdrant] Created collection: ${collectionName} (dim=${vectorSize})`);

                // Create payload indexes for filterable fields
                await this.createPayloadIndexes(collectionName);
            }
        } catch (error) {
            console.error(`[Qdrant] Failed to ensure collection ${collectionName}:`, error);
            throw error;
        }
    }

    /**
     * Create payload indexes for filterable fields
     * @param {string} collectionName - Collection name
     */
    async createPayloadIndexes(collectionName) {
        // Fields that need indexes for filtering
        const indexConfigs = [
            { field: 'type', schema: 'keyword' },
            { field: 'sourceId', schema: 'keyword' },
            { field: 'embeddingSource', schema: 'keyword' },
            { field: 'hash', schema: 'integer' },
            { field: 'timestamp', schema: 'integer' },
            { field: 'importance', schema: 'integer' },
            { field: 'characterName', schema: 'keyword' },
            { field: 'chatId', schema: 'keyword' },
            { field: 'keywords', schema: 'keyword' },  // Array of keywords
        ];

        for (const { field, schema } of indexConfigs) {
            try {
                await this.client.createPayloadIndex(collectionName, {
                    field_name: field,
                    field_schema: schema,
                });
                console.log(`[Qdrant] Created index for ${field} (${schema})`);
            } catch (error) {
                // Index might already exist, that's fine
                if (!error.message?.includes('already exists')) {
                    console.warn(`[Qdrant] Failed to create index for ${field}:`, error.message);
                }
            }
        }
    }

    /**
     * Ensure payload indexes exist on an existing collection
     * Call this to fix missing indexes on collections created before indexes were added
     * @param {string} collectionName - Collection name
     */
    async ensurePayloadIndexes(collectionName = 'vecthare_main') {
        try {
            const collections = await this.client.getCollections();
            const exists = collections.collections.some(c => c.name === collectionName);
            if (exists) {
                await this.createPayloadIndexes(collectionName);
                console.log(`[Qdrant] Ensured payload indexes for ${collectionName}`);
            }
        } catch (error) {
            console.error(`[Qdrant] Failed to ensure indexes for ${collectionName}:`, error);
        }
    }

    /**
     * Insert vector items into collection (MULTITENANCY)
     * @param {string} collectionName - Collection name (always "vecthare_main")
     * @param {Array} items - Items with {hash, text, vector, metadata}
     * @param {object} tenantMetadata - Tenant info {type, sourceId, embeddingSource}
     * @returns {Promise<void>}
     */
    async insertVectors(collectionName, items, tenantMetadata = {}) {
        if (!this.client) throw new Error('Qdrant not initialized');
        if (items.length === 0) return;

        // MULTITENANCY: Always use vecthare_main collection
        const mainCollection = 'vecthare_main';

        // Ensure collection exists (use first vector's size)
        const vectorSize = items[0].vector.length;
        await this.ensureCollection(mainCollection, vectorSize);

        // Format points for Qdrant with multitenancy payload
        const points = items.map(item => ({
            id: item.hash, // Use hash as ID (must be number or UUID string)
            vector: item.vector,
            payload: {
                // ===== CORE FIELDS =====
                text: item.text,
                hash: item.hash,

                // ===== MULTITENANCY FIELDS =====
                type: tenantMetadata.type || 'chat',  // chat, lorebook, character, document, wiki
                sourceId: tenantMetadata.sourceId || 'unknown',  // Unique ID per source
                embeddingSource: tenantMetadata.embeddingSource || 'transformers',  // Embedding provider (transformers, openai, palm, etc.)

                // ===== TIMESTAMPS (for temporal decay) =====
                timestamp: item.metadata?.timestamp || Date.now(),
                messageIndex: item.metadata?.messageIndex,

                // ===== LEGACY VECTHARE FEATURES =====
                // Importance weighting (0-200, default 100)
                importance: item.importance !== undefined ? item.importance : 100,

                // Keywords system
                keywords: item.keywords || [],
                customWeights: item.customWeights || {},
                disabledKeywords: item.disabledKeywords || [],

                // Chunk groups
                chunkGroup: item.chunkGroup || null,

                // Conditional activation
                conditions: item.conditions || null,

                // Dual-vector system
                summary: item.summary || null,
                isSummaryChunk: item.isSummaryChunk || false,
                parentHash: item.parentHash || null,

                // ===== CHAT-SPECIFIC =====
                speaker: item.metadata?.speaker,
                sceneTitle: item.metadata?.sceneTitle,
                sceneIndex: item.metadata?.sceneIndex,
                sceneStart: item.metadata?.sceneStart,
                sceneEnd: item.metadata?.sceneEnd,

                // ===== LOREBOOK-SPECIFIC =====
                entryName: item.metadata?.entryName,
                lorebookId: item.metadata?.lorebookId,

                // ===== CHARACTER-SPECIFIC =====
                characterName: item.metadata?.characterName,
                fieldName: item.metadata?.fieldName,

                // ===== DOCUMENT-SPECIFIC =====
                documentName: item.metadata?.documentName,
                url: item.metadata?.url,
                scrapeDate: item.metadata?.scrapeDate,

                // ===== ADDITIONAL METADATA =====
                ...item.metadata,
            },
        }));

        // Upsert points
        await this.client.upsert(mainCollection, {
            points: points,
        });

        console.log(`[Qdrant] Inserted ${items.length} vectors into ${mainCollection} (type: ${tenantMetadata.type}, sourceId: ${tenantMetadata.sourceId})`);
    }

    /**
     * Query collection for similar vectors (MULTITENANCY)
     * @param {string} collectionName - Collection name (always "vecthare_main")
     * @param {number[]} queryVector - Query vector
     * @param {number} topK - Number of results
     * @param {object} filters - Payload filters {type, sourceId, minImportance, timestampAfter, etc.}
     * @returns {Promise<Array>} Results with {hash, text, score, metadata}
     */
    async queryCollection(collectionName, queryVector, topK = 10, filters = {}) {
        if (!this.client) throw new Error('Qdrant not initialized');

        // MULTITENANCY: Always use vecthare_main collection
        const mainCollection = 'vecthare_main';

        try {
            // Check if collection exists
            const collections = await this.client.getCollections();
            const exists = collections.collections.some(c => c.name === mainCollection);
            if (!exists) {
                return []; // Collection doesn't exist
            }

            // Build filter conditions
            const must = [];

            // Type filter (chat, lorebook, character, document, wiki)
            if (filters.type) {
                must.push({
                    key: 'type',
                    match: { value: filters.type }
                });
            }

            // Source ID filter (chatId, characterId, etc.)
            if (filters.sourceId) {
                must.push({
                    key: 'sourceId',
                    match: { value: filters.sourceId }
                });
            }

            // Importance filter (min threshold)
            if (filters.minImportance !== undefined) {
                must.push({
                    key: 'importance',
                    range: { gte: filters.minImportance }
                });
            }

            // Timestamp filter (for temporal decay)
            if (filters.timestampAfter !== undefined) {
                must.push({
                    key: 'timestamp',
                    range: { gte: filters.timestampAfter }
                });
            }

            // Character filter (for character scoping)
            if (filters.characterName) {
                must.push({
                    key: 'characterName',
                    match: { value: filters.characterName }
                });
            }

            // Chat ID filter (for chat scoping)
            if (filters.chatId) {
                must.push({
                    key: 'chatId',
                    match: { value: filters.chatId }
                });
            }

            // Chunk group filter
            if (filters.chunkGroup) {
                must.push({
                    key: 'chunkGroup.name',
                    match: { value: filters.chunkGroup }
                });
            }

            // Embedding source filter (transformers, openai, palm, etc.)
            if (filters.embeddingSource) {
                must.push({
                    key: 'embeddingSource',
                    match: { value: filters.embeddingSource }
                });
            }

            // Build search payload
            const searchPayload = {
                vector: queryVector,
                limit: topK,
                with_payload: true,
            };

            // Add filters if any
            if (must.length > 0) {
                searchPayload.filter = { must };
            }

            // Search
            const results = await this.client.search(mainCollection, searchPayload);

            // Format results
            return results.map(result => ({
                hash: result.payload.hash,
                text: result.payload.text,
                score: result.score, // Higher is better for cosine similarity
                metadata: result.payload,  // Include ALL payload for feature processing
            }));
        } catch (error) {
            console.error(`[Qdrant] Query failed for ${mainCollection}:`, error);
            return [];
        }
    }

    /**
     * List all items in a collection (MULTITENANCY)
     * @param {string} collectionName - Collection name (always "vecthare_main")
     * @param {object} filters - Payload filters {type, sourceId}
     * @param {object} options - Options { includeVectors }
     * @returns {Promise<Array>} Array of items with {hash, text, metadata, vector?}
     */
    async listItems(collectionName, filters = {}, options = {}) {
        if (!this.client) throw new Error('Qdrant not initialized');

        // MULTITENANCY: Always use vecthare_main collection
        const mainCollection = 'vecthare_main';

        try {
            // Check if collection exists
            const collections = await this.client.getCollections();
            const exists = collections.collections.some(c => c.name === mainCollection);
            if (!exists) {
                return [];
            }

            // Build filter conditions
            const must = [];
            if (filters.type) {
                must.push({
                    key: 'type',
                    match: { value: filters.type }
                });
            }
            if (filters.sourceId) {
                must.push({
                    key: 'sourceId',
                    match: { value: filters.sourceId }
                });
            }

            // Scroll through all points
            const items = [];
            let offset = null;

            do {
                const scrollPayload = {
                    limit: 100,
                    offset: offset,
                    with_payload: true,
                    with_vector: options.includeVectors || false,
                };

                // Add filters if any
                if (must.length > 0) {
                    scrollPayload.filter = { must };
                }

                const response = await this.client.scroll(mainCollection, scrollPayload);

                items.push(...response.points.map(p => ({
                    hash: p.payload.hash,
                    text: p.payload.text,
                    metadata: p.payload,
                    vector: options.includeVectors ? p.vector : undefined,
                })));
                offset = response.next_page_offset;
            } while (offset !== null && offset !== undefined);

            return items;
        } catch (error) {
            console.error(`[Qdrant] Failed to list items from ${mainCollection}:`, error);
            return [];
        }
    }

    /**
     * Get all saved hashes from a collection (MULTITENANCY)
     * @param {string} collectionName - Collection name (always "vecthare_main")
     * @param {object} filters - Payload filters {type, sourceId}
     * @returns {Promise<number[]>} Array of hashes
     */
    async getSavedHashes(collectionName, filters = {}) {
        if (!this.client) throw new Error('Qdrant not initialized');

        // MULTITENANCY: Always use vecthare_main collection
        const mainCollection = 'vecthare_main';

        try {
            // Check if collection exists
            const collections = await this.client.getCollections();
            const exists = collections.collections.some(c => c.name === mainCollection);
            if (!exists) {
                return [];
            }

            // Build filter conditions
            const must = [];
            if (filters.type) {
                must.push({
                    key: 'type',
                    match: { value: filters.type }
                });
            }
            if (filters.sourceId) {
                must.push({
                    key: 'sourceId',
                    match: { value: filters.sourceId }
                });
            }

            // Scroll through all points to get hashes
            const hashes = [];
            let offset = null;

            do {
                const scrollPayload = {
                    limit: 100,
                    offset: offset,
                    with_payload: ['hash'],
                    with_vector: false,
                };

                // Add filters if any
                if (must.length > 0) {
                    scrollPayload.filter = { must };
                }

                const response = await this.client.scroll(mainCollection, scrollPayload);

                hashes.push(...response.points.map(p => p.payload.hash));
                offset = response.next_page_offset;
            } while (offset !== null && offset !== undefined);

            return hashes;
        } catch (error) {
            console.error(`[Qdrant] Failed to get hashes from ${mainCollection}:`, error);
            return [];
        }
    }

    /**
     * Delete specific items by hash (MULTITENANCY)
     * @param {string} collectionName - Collection name (always "vecthare_main")
     * @param {number[]} hashes - Hashes to delete
     * @returns {Promise<void>}
     */
    async deleteVectors(collectionName, hashes) {
        if (!this.client) throw new Error('Qdrant not initialized');
        if (hashes.length === 0) return;

        // MULTITENANCY: Always use vecthare_main collection
        const mainCollection = 'vecthare_main';

        try {
            // Delete points by ID (hash)
            await this.client.delete(mainCollection, {
                points: hashes,
            });

            console.log(`[Qdrant] Deleted ${hashes.length} items from ${mainCollection}`);
        } catch (error) {
            console.error(`[Qdrant] Delete failed for ${mainCollection}:`, error);
        }
    }

    /**
     * Purge collection for a specific source (MULTITENANCY)
     * Deletes all points matching type and sourceId filters
     * @param {string} collectionName - Collection name (always "vecthare_main")
     * @param {object} filters - Payload filters {type, sourceId}
     * @returns {Promise<void>}
     */
    async purgeCollection(collectionName, filters = {}) {
        if (!this.client) throw new Error('Qdrant not initialized');

        // MULTITENANCY: Always use vecthare_main collection
        const mainCollection = 'vecthare_main';

        try {
            // Check if collection exists
            const collections = await this.client.getCollections();
            const exists = collections.collections.some(c => c.name === mainCollection);
            if (!exists) {
                return; // Nothing to purge
            }

            // Build filter conditions
            const must = [];
            if (filters.type) {
                must.push({
                    key: 'type',
                    match: { value: filters.type }
                });
            }
            if (filters.sourceId) {
                must.push({
                    key: 'sourceId',
                    match: { value: filters.sourceId }
                });
            }

            if (must.length === 0) {
                // No filters = delete entire collection (dangerous!)
                console.warn('[Qdrant] No filters provided to purgeCollection - use purgeAll() instead');
                return;
            }

            // Delete points by filter
            await this.client.delete(mainCollection, {
                filter: { must }
            });

            console.log(`[Qdrant] Purged ${mainCollection} (type: ${filters.type}, sourceId: ${filters.sourceId})`);
        } catch (error) {
            if (error.status === 404) {
                // Collection doesn't exist, that's fine
                return;
            }
            console.error(`[Qdrant] Purge failed for ${mainCollection}:`, error);
            throw error;
        }
    }

    /**
     * Purge entire vecthare_main collection (MULTITENANCY)
     * WARNING: Deletes ALL data from ALL sources
     * @returns {Promise<void>}
     */
    async purgeAll() {
        if (!this.client) throw new Error('Qdrant not initialized');

        // MULTITENANCY: Delete the entire vecthare_main collection
        const mainCollection = 'vecthare_main';

        try {
            await this.client.deleteCollection(mainCollection);
            console.log(`[Qdrant] Purged entire collection: ${mainCollection}`);
        } catch (error) {
            if (error.status === 404) {
                // Collection doesn't exist, that's fine
                return;
            }
            console.error(`[Qdrant] Purge all failed:`, error);
            throw error;
        }
    }
}

// Export singleton instance
const qdrantBackend = new QdrantBackend();
export default qdrantBackend;
