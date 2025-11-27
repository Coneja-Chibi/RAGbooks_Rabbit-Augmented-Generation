/**
 * ============================================================================
 * LANCEDB BACKEND
 * ============================================================================
 * Server-side LanceDB vector database operations.
 * Handles collections, indexing, querying using Apache Arrow/Lance format.
 *
 * Why LanceDB?
 * - Disk-based (handles millions of vectors without loading into RAM)
 * - Fast queries with smart caching
 * - Scales better than file-based vectra
 * - Zero-copy reads via Apache Arrow
 *
 * @author VectHare
 * @version 2.0.0-alpha
 * ============================================================================
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import * as lancedb from '@lancedb/lancedb';

/**
 * Sanitize collection ID for LanceDB table names
 * LanceDB only allows: alphanumeric, underscores, hyphens, periods
 * @param {string} collectionId - Raw collection ID
 * @returns {string} Sanitized table name
 */
function sanitizeTableName(collectionId) {
    // Replace invalid characters with underscores
    // Keep: a-z, A-Z, 0-9, _, -, .
    return collectionId.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

/**
 * LanceDB Backend Manager
 * Singleton that manages LanceDB connections and operations
 * Organizes collections by embedding source (like ST's standard backend)
 */
class LanceDBBackend {
    constructor() {
        this.basePath = null;
        this.databases = new Map(); // Map source -> LanceDB connection
        this.collections = new Map(); // Cache of open collections: "source:tableName" -> table
        this.tableNameMap = new Map(); // Map original collection ID -> sanitized table name
    }

    /**
     * Initialize LanceDB base path
     * @param {string} vectorsPath - Path to vectors directory
     */
    async initialize(vectorsPath) {
        this.basePath = path.join(vectorsPath, 'lancedb');

        // Ensure base directory exists
        await fs.mkdir(this.basePath, { recursive: true });

        console.log('[LanceDB] Initialized base path:', this.basePath);
    }

    /**
     * Get or create database connection for a specific source
     * Creates folder structure: vectors/lancedb/{source}/
     * @param {string} source - Embedding source (transformers, openai, palm, etc.)
     * @returns {Promise<Object>} LanceDB database connection
     */
    async getDatabase(source = 'transformers') {
        if (!this.basePath) throw new Error('LanceDB not initialized');

        // Check cache
        if (this.databases.has(source)) {
            return this.databases.get(source);
        }

        // Create source-specific path
        const sourcePath = path.join(this.basePath, source);
        await fs.mkdir(sourcePath, { recursive: true });

        // Connect to source-specific database
        const db = await lancedb.connect(sourcePath);
        this.databases.set(source, db);

        console.log(`[LanceDB] Connected to source database: ${source} at ${sourcePath}`);
        return db;
    }

    // Legacy getter for backwards compatibility
    get db() {
        // Return first database or null
        if (this.databases.size > 0) {
            return this.databases.values().next().value;
        }
        return null;
    }

    /**
     * Get or create a collection
     * @param {string} collectionId - Collection identifier
     * @param {string} source - Embedding source (transformers, openai, palm, etc.)
     * @returns {Promise<Object>} LanceDB table
     */
    async getCollection(collectionId, source = 'transformers') {
        // Sanitize the collection ID for LanceDB
        const tableName = sanitizeTableName(collectionId);
        this.tableNameMap.set(collectionId, tableName);

        // Cache key includes source
        const cacheKey = `${source}:${tableName}`;

        // Check cache
        if (this.collections.has(cacheKey)) {
            return this.collections.get(cacheKey);
        }

        // Get database for this source
        const db = await this.getDatabase(source);

        // Check if collection exists
        const tableNames = await db.tableNames();

        if (tableNames.includes(tableName)) {
            // Open existing collection
            const collection = await db.openTable(tableName);
            this.collections.set(cacheKey, collection);
            return collection;
        }

        // Collection doesn't exist yet - will be created on first insert
        return null;
    }

    /**
     * Insert vector items into collection
     * @param {string} collectionId - Collection ID
     * @param {Array} items - Items with {hash, text, vector, metadata}
     * @param {string} source - Embedding source (transformers, openai, palm, etc.)
     * @returns {Promise<void>}
     */
    async insertVectors(collectionId, items, source = 'transformers') {
        if (!this.basePath) throw new Error('LanceDB not initialized');
        if (items.length === 0) return;

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);
        this.tableNameMap.set(collectionId, tableName);

        // Cache key includes source
        const cacheKey = `${source}:${tableName}`;

        // Filter out items with invalid vectors
        const validItems = items.filter(item => {
            if (!Array.isArray(item.vector) || item.vector.length === 0) {
                console.warn(`[LanceDB] Skipping item with invalid vector (hash: ${item.hash})`);
                return false;
            }
            return true;
        });

        if (validItems.length === 0) {
            throw new Error('[LanceDB] No valid items to insert - all items had missing or empty vectors');
        }

        if (validItems.length < items.length) {
            console.warn(`[LanceDB] Filtered out ${items.length - validItems.length} items with invalid vectors`);
        }

        // Validate all vectors have the same dimension
        const expectedDimension = validItems[0].vector.length;
        const mismatchedItems = validItems.filter(item => item.vector.length !== expectedDimension);
        if (mismatchedItems.length > 0) {
            const examples = mismatchedItems.slice(0, 3).map(i => `hash ${i.hash}: ${i.vector.length}`).join(', ');
            throw new Error(`[LanceDB] Vector dimension mismatch. Expected ${expectedDimension}, but found: ${examples}${mismatchedItems.length > 3 ? '...' : ''} (${mismatchedItems.length} total mismatches)`);
        }

        // Format items for LanceDB
        const records = validItems.map(item => ({
            hash: item.hash,
            text: item.text,
            vector: item.vector,
            metadata: JSON.stringify(item.metadata || {}),
        }));

        // Check if collection exists
        let collection = await this.getCollection(collectionId, source);

        if (!collection) {
            // Get database for this source
            const db = await this.getDatabase(source);

            // Create new table with first batch of records (use sanitized name)
            collection = await db.createTable(tableName, records);
            this.collections.set(cacheKey, collection);
            console.log(`[LanceDB] Created collection: ${source}/${tableName} (${collectionId}) with ${items.length} vectors`);
        } else {
            // Add to existing table
            await collection.add(records);
            console.log(`[LanceDB] Added ${items.length} vectors to ${source}/${tableName} (${collectionId})`);
        }
    }

    /**
     * Query collection for similar vectors
     * @param {string} collectionId - Collection ID
     * @param {number[]} queryVector - Query vector
     * @param {number} topK - Number of results
     * @param {string} source - Embedding source (transformers, openai, palm, etc.)
     * @returns {Promise<Array>} Results with {hash, text, score, metadata}
     */
    async queryCollection(collectionId, queryVector, topK = 10, source = 'transformers') {
        if (!this.basePath) throw new Error('LanceDB not initialized');

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);

        // Get database for this source
        const db = await this.getDatabase(source);

        const tableNames = await db.tableNames();
        if (!tableNames.includes(tableName)) {
            return []; // Collection doesn't exist
        }

        const collection = await this.getCollection(collectionId, source);

        // Query using vector similarity (new API)
        const results = await collection
            .vectorSearch(queryVector)
            .limit(topK)
            .toArray();

        // Format results
        return results.map(result => ({
            hash: Number(result.hash),
            text: result.text,
            score: 1 / (1 + result._distance), // Convert L2 distance to similarity (0-1, higher is better)
            metadata: JSON.parse(result.metadata || '{}'),
        }));
    }

    /**
     * List all items in a collection
     * @param {string} collectionId - Collection ID
     * @param {string} source - Embedding source (transformers, openai, palm, etc.)
     * @param {object} options - Options { includeVectors }
     * @returns {Promise<Array>} Array of items with {hash, text, metadata, vector?}
     */
    async listItems(collectionId, source = 'transformers', options = {}) {
        if (!this.basePath) throw new Error('LanceDB not initialized');

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);

        // Get database for this source
        const db = await this.getDatabase(source);

        const tableNames = await db.tableNames();
        if (!tableNames.includes(tableName)) {
            return []; // Collection doesn't exist
        }

        const collection = await this.getCollection(collectionId, source);

        // Select columns based on options
        const columns = ['hash', 'text', 'metadata'];
        if (options.includeVectors) {
            columns.push('vector');
        }

        // Get all records
        const results = await collection
            .query()
            .select(columns)
            .toArray();

        return results.map(r => ({
            hash: Number(r.hash),
            text: r.text,
            metadata: JSON.parse(r.metadata || '{}'),
            vector: options.includeVectors ? r.vector : undefined,
        }));
    }

    /**
     * Get all saved hashes from a collection
     * @param {string} collectionId - Collection ID
     * @param {string} source - Embedding source (transformers, openai, palm, etc.)
     * @returns {Promise<number[]>} Array of hashes
     */
    async getSavedHashes(collectionId, source = 'transformers') {
        if (!this.basePath) throw new Error('LanceDB not initialized');

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);

        // Get database for this source
        const db = await this.getDatabase(source);

        const tableNames = await db.tableNames();
        if (!tableNames.includes(tableName)) {
            return []; // Collection doesn't exist
        }

        const collection = await this.getCollection(collectionId, source);

        // Get all records (new API uses query)
        const results = await collection
            .query()
            .select(['hash'])
            .toArray();

        return results.map(r => Number(r.hash));
    }

    /**
     * Delete specific items by hash
     * @param {string} collectionId - Collection ID
     * @param {number[]} hashes - Hashes to delete
     * @param {string} source - Embedding source (transformers, openai, palm, etc.)
     * @returns {Promise<void>}
     */
    async deleteVectors(collectionId, hashes, source = 'transformers') {
        if (!this.basePath) throw new Error('LanceDB not initialized');
        if (hashes.length === 0) return;

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);

        // Get database for this source
        const db = await this.getDatabase(source);

        const tableNames = await db.tableNames();
        if (!tableNames.includes(tableName)) {
            return; // Collection doesn't exist
        }

        const collection = await this.getCollection(collectionId, source);

        // Delete by hash
        const deleteFilter = `hash IN (${hashes.join(',')})`;

        await collection.delete(deleteFilter);

        console.log(`[LanceDB] Deleted ${hashes.length} items from ${source}/${collectionId}`);
    }

    /**
     * Purge entire collection
     * @param {string} collectionId - Collection ID
     * @param {string} source - Embedding source (transformers, openai, palm, etc.)
     * @returns {Promise<void>}
     */
    async purgeCollection(collectionId, source = 'transformers') {
        if (!this.basePath) throw new Error('LanceDB not initialized');

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);
        const cacheKey = `${source}:${tableName}`;

        // Get database for this source
        const db = await this.getDatabase(source);

        const tableNames = await db.tableNames();
        if (!tableNames.includes(tableName)) {
            return; // Collection doesn't exist
        }

        await db.dropTable(tableName);
        this.collections.delete(cacheKey);
        this.tableNameMap.delete(collectionId);

        console.log(`[LanceDB] Purged collection: ${source}/${tableName} (${collectionId})`);
    }

    /**
     * Purge all collections across all sources
     * @returns {Promise<void>}
     */
    async purgeAll() {
        if (!this.basePath) throw new Error('LanceDB not initialized');

        let totalPurged = 0;

        // Purge from all connected databases
        for (const [source, db] of this.databases) {
            const tableNames = await db.tableNames();

            for (const tableName of tableNames) {
                await db.dropTable(tableName);
                this.collections.delete(`${source}:${tableName}`);
                totalPurged++;
            }

            console.log(`[LanceDB] Purged ${tableNames.length} collections from ${source}`);
        }

        console.log(`[LanceDB] Purged all ${totalPurged} collections across all sources`);
    }

    /**
     * Health check
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        try {
            if (!this.basePath) return false;

            // Try to get the default database
            const db = await this.getDatabase('transformers');
            await db.tableNames();
            return true;
        } catch (error) {
            console.error('[LanceDB] Health check failed:', error);
            return false;
        }
    }

    /**
     * Query vectors with threshold filtering (alias for queryCollection)
     * @param {string} collectionId - Collection ID
     * @param {number[]} queryVector - Query vector
     * @param {number} topK - Number of results
     * @param {number} threshold - Minimum score threshold
     * @param {string} source - Embedding source
     * @returns {Promise<Array>} Results above threshold
     */
    async queryVectors(collectionId, queryVector, topK, threshold, source = 'transformers') {
        const results = await this.queryCollection(collectionId, queryVector, topK, source);
        // Filter by threshold
        return results.filter(r => r.score >= threshold);
    }

    /**
     * Get a single item by hash
     * @param {string} collectionId - Collection ID
     * @param {number} hash - Item hash to find
     * @param {string} source - Embedding source
     * @returns {Promise<object|null>} Item or null if not found
     */
    async getItem(collectionId, hash, source = 'transformers') {
        if (!this.basePath) throw new Error('LanceDB not initialized');

        const tableName = sanitizeTableName(collectionId);
        const db = await this.getDatabase(source);

        const tableNames = await db.tableNames();
        if (!tableNames.includes(tableName)) {
            return null;
        }

        const collection = await this.getCollection(collectionId, source);

        // Query for specific hash
        const results = await collection
            .query()
            .where(`hash = ${hash}`)
            .select(['hash', 'text', 'vector', 'metadata'])
            .toArray();

        if (results.length === 0) {
            return null;
        }

        const r = results[0];
        return {
            hash: Number(r.hash),
            text: r.text,
            vector: r.vector,
            metadata: JSON.parse(r.metadata || '{}'),
        };
    }

    /**
     * Update an item (delete and re-insert with new data)
     * @param {string} collectionId - Collection ID
     * @param {number} hash - Item hash to update
     * @param {object} updates - Updated fields {text?, hash?, vector?, ...metadata}
     * @param {string} source - Embedding source
     * @returns {Promise<void>}
     */
    async updateItem(collectionId, hash, updates, source = 'transformers') {
        // Get existing item
        const existing = await this.getItem(collectionId, hash, source);
        if (!existing) {
            throw new Error(`Item with hash ${hash} not found`);
        }

        // Delete old item
        await this.deleteVectors(collectionId, [hash], source);

        // Merge updates with existing data
        const newHash = updates.hash || hash;
        const newItem = {
            hash: newHash,
            text: updates.text || existing.text,
            vector: updates.vector || existing.vector,
            metadata: { ...existing.metadata, ...updates },
        };

        // Insert updated item
        await this.insertVectors(collectionId, [newItem], source);

        console.log(`[LanceDB] Updated item ${hash} -> ${newHash}`);
    }

    /**
     * Update item metadata only (no re-embedding needed)
     * @param {string} collectionId - Collection ID
     * @param {number} hash - Item hash to update
     * @param {object} metadata - New metadata fields to merge
     * @param {string} source - Embedding source
     * @returns {Promise<void>}
     */
    async updateItemMetadata(collectionId, hash, metadata, source = 'transformers') {
        // Get existing item (need the vector)
        const existing = await this.getItem(collectionId, hash, source);
        if (!existing) {
            throw new Error(`Item with hash ${hash} not found`);
        }

        // Delete old item
        await this.deleteVectors(collectionId, [hash], source);

        // Create updated item with same text/vector but new metadata
        const updatedItem = {
            hash: hash,
            text: existing.text,
            vector: existing.vector,
            metadata: { ...existing.metadata, ...metadata },
        };

        // Insert updated item
        await this.insertVectors(collectionId, [updatedItem], source);

        console.log(`[LanceDB] Updated metadata for item ${hash}`);
    }

    /**
     * Get collection statistics
     * @param {string} collectionId - Collection ID
     * @param {string} source - Embedding source (transformers, openai, palm, etc.)
     * @returns {Promise<Object>} Stats {count, dimension, size}
     */
    async getCollectionStats(collectionId, source = 'transformers') {
        if (!this.basePath) throw new Error('LanceDB not initialized');

        // Get database for this source
        const db = await this.getDatabase(source);
        const tableName = sanitizeTableName(collectionId);

        const tableNames = await db.tableNames();
        if (!tableNames.includes(tableName)) {
            return { count: 0, dimension: 0, size: 0 };
        }

        const collection = await this.getCollection(collectionId, source);
        const count = await collection.countRows();

        // Get dimension from schema
        const schema = collection.schema;
        const vectorField = schema.fields.find(f => f.name === 'vector');
        const dimension = vectorField ? vectorField.type.listSize : 0;

        return {
            count,
            dimension,
            size: 0, // LanceDB doesn't expose size easily
        };
    }

    /**
     * Get all sources that have collections
     * @returns {Promise<string[]>} Array of source names
     */
    async getAllSources() {
        if (!this.basePath) throw new Error('LanceDB not initialized');

        try {
            const entries = await fs.readdir(this.basePath, { withFileTypes: true });
            return entries
                .filter(e => e.isDirectory())
                .map(e => e.name);
        } catch (error) {
            return [];
        }
    }

    /**
     * Get all collections for a specific source
     * @param {string} source - Embedding source
     * @returns {Promise<string[]>} Array of collection IDs
     */
    async getCollectionsForSource(source) {
        if (!this.basePath) throw new Error('LanceDB not initialized');

        const db = await this.getDatabase(source);
        return await db.tableNames();
    }
}

// Singleton instance
const backend = new LanceDBBackend();

export default backend;
