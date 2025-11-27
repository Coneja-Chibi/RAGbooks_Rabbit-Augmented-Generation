/**
 * ============================================================================
 * MILVUS BACKEND
 * ============================================================================
 * Server-side Milvus vector database operations.
 * Uses the official nodejs sdk.
 *
 * Multitenancy Strategy:
 * - ONE collection: "vecthare_main"
 * - Scalar fields for filtering: type, sourceId, etc.
 *
 * @author VectHare
 * @version 1.0.0
 * ============================================================================
 */

import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';

/**
 * Milvus Backend Manager
 * Manages Milvus connection and operations
 */
class MilvusBackend {
    constructor() {
        this.client = null;
        this.baseParams = { metric_type: 'COSINE', index_type: 'IVF_FLAT', params: { nlist: 1024 } };
        this.isConnected = false;
        this.config = {
            address: '127.0.0.1:19530',
            token: '', // API token or user:password
            ssl: false,
        };
    }

    /**
     * Initialize Milvus connection
     * @param {object} config - Configuration { address, token, ssl }
     */
    async initialize(config = {}) {
        this.config = { ...this.config, ...config };
        
        console.log(`[Milvus] Initializing connection to ${this.config.address}...`);
        
        try {
            this.client = new MilvusClient({
                address: this.config.address,
                token: this.config.token,
                ssl: this.config.ssl
            });

            // Test connection by listing collections
            await this.client.listCollections();
            this.isConnected = true;
            console.log('[Milvus] Connection successful');
            
            // Ensure main collection exists
            await this.ensureCollection('vecthare_main');
            
        } catch (error) {
            this.isConnected = false;
            console.error('[Milvus] Connection failed:', error.message);
            throw error;
        }
    }

    /**
     * Health check
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        try {
            if (!this.client) return false;
            await this.client.listCollections();
            return true;
        } catch (error) {
            console.error('[Milvus] Health check failed:', error.message);
            return false;
        }
    }

    /**
     * Ensure collection exists with proper schema
     * @param {string} collectionName - Collection name
     * @param {number} vectorSize - Vector dimension
     */
    async ensureCollection(collectionName, vectorSize = 768) {
        if (!this.isConnected) throw new Error('Milvus not initialized');

        try {
            // Check if collection exists
            const { data: collections } = await this.client.listCollections();
            const exists = collections.find(c => c.name === collectionName);
            
            if (exists) {
                // If exists, loading it into memory is required for search
                await this.client.loadCollection({
                    collection_name: collectionName
                });
                return;
            }

            console.log(`[Milvus] Creating collection ${collectionName}...`);

            // Define schema
            // Milvus 2.x requires specific fields definition
            const fields = [
                {
                    name: 'hash',
                    description: 'Primary key (hash of text)',
                    data_type: DataType.Int64,
                    is_primary_key: true,
                },
                {
                    name: 'vector',
                    description: 'Vector embedding',
                    data_type: DataType.FloatVector,
                    dim: vectorSize,
                },
                {
                    name: 'text',
                    description: 'Original text content',
                    data_type: DataType.VarChar,
                    max_length: 65535, // Max length for VarChar
                },
                // Metadata fields for filtering
                {
                    name: 'type', 
                    data_type: DataType.VarChar, 
                    max_length: 64,
                    description: 'Content type (chat, lorebook, etc)'
                },
                {
                    name: 'sourceId', 
                    data_type: DataType.VarChar, 
                    max_length: 128,
                    description: 'Source ID (chat_id, lorebook_id)'
                },
                {
                    name: 'embeddingSource', 
                    data_type: DataType.VarChar, 
                    max_length: 64
                },
                {
                    name: 'embeddingModel', 
                    data_type: DataType.VarChar, 
                    max_length: 128
                },
                {
                    name: 'timestamp',
                    data_type: DataType.Int64
                },
                {
                    name: 'metadata',
                    description: 'Full JSON metadata',
                    data_type: DataType.JSON 
                }
            ];

            await this.client.createCollection({
                collection_name: collectionName,
                fields: fields,
            });

            // Create index on vector field
            console.log('[Milvus] Creating index...');
            await this.client.createIndex({
                collection_name: collectionName,
                field_name: 'vector',
                extra_params: this.baseParams // Use default index params
            });

            // Load collection
            await this.client.loadCollection({
                collection_name: collectionName
            });

            console.log(`[Milvus] Created and loaded collection: ${collectionName} (dim=${vectorSize})`);

        } catch (error) {
            console.error(`[Milvus] Failed to ensure collection ${collectionName}:`, error.message);
            throw error;
        }
    }

    /**
     * Insert vectors into collection
     * @param {string} collectionName - Collection name
     * @param {Array} items - Items to insert
     * @param {object} tenantMetadata - Metadata for tenancy
     */
    async insertVectors(collectionName, items, tenantMetadata = {}) {
        if (!this.isConnected) throw new Error('Milvus not initialized');
        if (items.length === 0) return;

        const mainCollection = 'vecthare_main';

        // Check dimension from first item
        const vectorSize = items[0].vector?.length || 0;
        if (vectorSize === 0) throw new Error('[Milvus] Invalid vector dimension 0');

        // Ensure collection exists
        await this.ensureCollection(mainCollection, vectorSize);

        // Prepare data matching schema
        const data = items.map(item => ({
            hash: item.hash,
            vector: item.vector,
            text: item.text,
            type: tenantMetadata.type || 'chat',
            sourceId: tenantMetadata.sourceId || 'unknown',
            embeddingSource: tenantMetadata.embeddingSource || 'transformers',
            embeddingModel: tenantMetadata.embeddingModel || '',
            timestamp: item.metadata?.timestamp || Date.now(),
            metadata: {
                ...(item.metadata || {}),
                text: item.text, // Redundant but safe
                hash: item.hash
            }
        }));

        try {
            await this.client.insert({
                collection_name: mainCollection,
                data: data
            });
            console.log(`[Milvus] Inserted ${items.length} items into ${mainCollection}`);
        } catch (error) {
            console.error('[Milvus] Insert failed:', error.message);
            throw error;
        }
    }

    /**
     * Delete vectors by hash
     * @param {string} collectionName 
     * @param {number[]} hashes 
     */
    async deleteVectors(collectionName, hashes) {
        if (!this.isConnected) throw new Error('Milvus not initialized');
        if (hashes.length === 0) return;

        const mainCollection = 'vecthare_main';

        try {
            const expr = `hash in [${hashes.join(',')}]`;
            await this.client.delete({
                collection_name: mainCollection,
                filter: expr
            });
            console.log(`[Milvus] Deleted items with hashes: ${hashes.length}`);
        } catch (error) {
            console.error('[Milvus] Delete failed:', error.message);
        }
    }

    /**
     * Build boolean expression for filtering
     */
    _buildFilterExpr(filters) {
        const conditions = [];
        
        if (filters.type) conditions.push(`type == "${filters.type}"`);
        if (filters.sourceId) conditions.push(`sourceId == "${filters.sourceId}"`);
        if (filters.embeddingSource) conditions.push(`embeddingSource == "${filters.embeddingSource}"`);
        if (filters.timestampAfter) conditions.push(`timestamp >= ${filters.timestampAfter}`);
        
        return conditions.length > 0 ? conditions.join(' && ') : '';
    }

    /**
     * Query/Search for similar vectors
     */
    async queryCollection(collectionName, queryVector, topK = 10, filters = {}) {
        if (!this.isConnected) throw new Error('Milvus not initialized');

        const mainCollection = 'vecthare_main';
        const filterExpr = this._buildFilterExpr(filters);

        try {
            // Need to verify collection is loaded
            await this.client.loadCollection({ collection_name: mainCollection });

            const results = await this.client.search({
                collection_name: mainCollection,
                vector: queryVector,
                filter: filterExpr || undefined,
                limit: topK,
                output_fields: ['hash', 'text', 'metadata']
            });

            return results.results.map(r => ({
                hash: Number(r.hash),
                text: r.text,
                score: r.score,
                metadata: r.metadata
            }));

        } catch (error) {
            console.error('[Milvus] Search failed:', error.message);
            return [];
        }
    }

    /**
     * List items (Query by scalar)
     */
    async listItems(collectionName, filters = {}, options = {}) {
        if (!this.isConnected) throw new Error('Milvus not initialized');

        const mainCollection = 'vecthare_main';
        const filterExpr = this._buildFilterExpr(filters) || 'hash > 0'; // Always need an expression for query

        try {
            await this.client.loadCollection({ collection_name: mainCollection });

            const output_fields = ['hash', 'text', 'metadata'];
            if (options.includeVectors) output_fields.push('vector');

            // Milvus query doesn't support easy pagination like "scroll" in Qdrant
            // But we can use limit/offset
            const limit = options.limit || 100;
            const offset = options.offset || 0;

            const results = await this.client.query({
                collection_name: mainCollection,
                filter: filterExpr,
                output_fields: output_fields,
                limit: limit,
                offset: offset
            });

            return results.data.map(r => ({
                hash: Number(r.hash),
                text: r.text,
                metadata: r.metadata,
                vector: options.includeVectors ? r.vector : undefined
            }));

        } catch (error) {
            console.error('[Milvus] List items failed:', error.message);
            return [];
        }
    }

    /**
     * Get single item
     */
    async getItem(collectionName, hash, filters = {}) {
        if (!this.isConnected) throw new Error('Milvus not initialized');
        const mainCollection = 'vecthare_main';

        try {
            const results = await this.client.query({
                collection_name: mainCollection,
                filter: `hash == ${hash}`,
                output_fields: ['hash', 'text', 'vector', 'metadata'],
                limit: 1
            });

            if (results.data.length === 0) return null;
            const r = results.data[0];
            
            return {
                hash: Number(r.hash),
                text: r.text,
                vector: r.vector,
                metadata: r.metadata
            };

        } catch (error) {
            console.error('[Milvus] Get item failed:', error.message);
            return null;
        }
    }

    /**
     * Update item (delete & insert)
     */
    async updateItem(collectionName, hash, updates, filters = {}) {
        const existing = await this.getItem(collectionName, hash, filters);
        if (!existing) throw new Error(`Item ${hash} not found`);

        await this.deleteVectors(collectionName, [hash]);

        const newHash = updates.hash || hash;
        const newItem = {
            hash: newHash,
            text: updates.text || existing.text,
            vector: updates.vector || existing.vector,
            metadata: { ...existing.metadata, ...updates }
        };

        await this.insertVectors(collectionName, [newItem], filters);
    }

    /**
     * Purge collection (drop & recreate or delete by filter)
     * If filters present, delete by filter. If no filters, drop collection.
     */
    async purgeCollection(collectionName, filters = {}) {
        if (!this.isConnected) throw new Error('Milvus not initialized');
        const mainCollection = 'vecthare_main';

        const hasFilters = Object.keys(filters).length > 0;

        try {
            if (hasFilters) {
                const expr = this._buildFilterExpr(filters);
                if (expr) {
                    await this.client.delete({
                        collection_name: mainCollection,
                        filter: expr
                    });
                    console.log(`[Milvus] Purged items with filter: ${expr}`);
                }
            } else {
                await this.client.dropCollection({ collection_name: mainCollection });
                console.log(`[Milvus] Dropped collection ${mainCollection}`);
                // Re-create is handled by next insert/init
            }
        } catch (error) {
            console.error('[Milvus] Purge failed:', error.message);
        }
    }

    /**
     * Get stats
     */
    async getCollectionStats(collectionName, filters = {}) {
        if (!this.isConnected) throw new Error('Milvus not initialized');
        const mainCollection = 'vecthare_main';

        try {
            const stats = await this.client.getCollectionStatistics({
                collection_name: mainCollection
            });

            const rowCount = stats.data.row_count;

            // Approximate token count if we can't query all efficiently
            // For now return basic stats
            return {
                chunkCount: Number(rowCount),
                backend: 'milvus'
            };

        } catch (error) {
            return { chunkCount: 0, backend: 'milvus', error: error.message };
        }
    }
}

const milvusBackend = new MilvusBackend();
export default milvusBackend;
