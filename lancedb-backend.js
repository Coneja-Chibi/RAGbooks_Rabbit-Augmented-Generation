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
 */
class LanceDBBackend {
    constructor() {
        this.db = null;
        this.dbPath = null;
        this.collections = new Map(); // Cache of open collections
        this.tableNameMap = new Map(); // Map original collection ID -> sanitized table name
    }

    /**
     * Initialize LanceDB connection
     * @param {string} vectorsPath - Path to vectors directory
     */
    async initialize(vectorsPath) {
        if (this.db) return; // Already initialized

        this.dbPath = path.join(vectorsPath, 'lancedb');

        // Ensure directory exists
        await fs.mkdir(this.dbPath, { recursive: true });

        // Connect to LanceDB (new API)
        this.db = await lancedb.connect(this.dbPath);

        console.log('[LanceDB] Initialized at:', this.dbPath);
    }

    /**
     * Get or create a collection
     * @param {string} collectionId - Collection identifier
     * @returns {Promise<Object>} LanceDB table
     */
    async getCollection(collectionId) {
        // Sanitize the collection ID for LanceDB
        const tableName = sanitizeTableName(collectionId);
        this.tableNameMap.set(collectionId, tableName);

        // Check cache
        if (this.collections.has(tableName)) {
            return this.collections.get(tableName);
        }

        // Check if collection exists
        const tableNames = await this.db.tableNames();

        if (tableNames.includes(tableName)) {
            // Open existing collection
            const collection = await this.db.openTable(tableName);
            this.collections.set(tableName, collection);
            return collection;
        }

        // Collection doesn't exist yet - will be created on first insert
        return null;
    }

    /**
     * Insert vector items into collection
     * @param {string} collectionId - Collection ID
     * @param {Array} items - Items with {hash, text, vector, metadata}
     * @returns {Promise<void>}
     */
    async insertVectors(collectionId, items) {
        if (!this.db) throw new Error('LanceDB not initialized');
        if (items.length === 0) return;

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);
        this.tableNameMap.set(collectionId, tableName);

        // Format items for LanceDB
        const records = items.map(item => ({
            hash: item.hash,
            text: item.text,
            vector: item.vector,
            metadata: JSON.stringify(item.metadata || {}),
        }));

        // Check if collection exists
        let collection = await this.getCollection(collectionId);

        if (!collection) {
            // Create new table with first batch of records (use sanitized name)
            collection = await this.db.createTable(tableName, records);
            this.collections.set(tableName, collection);
            console.log(`[LanceDB] Created collection: ${tableName} (${collectionId}) with ${items.length} vectors`);
        } else {
            // Add to existing table
            await collection.add(records);
            console.log(`[LanceDB] Added ${items.length} vectors to ${tableName} (${collectionId})`);
        }
    }

    /**
     * Query collection for similar vectors
     * @param {string} collectionId - Collection ID
     * @param {number[]} queryVector - Query vector
     * @param {number} topK - Number of results
     * @returns {Promise<Array>} Results with {hash, text, score, metadata}
     */
    async queryCollection(collectionId, queryVector, topK = 10) {
        if (!this.db) throw new Error('LanceDB not initialized');

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);

        const tableNames = await this.db.tableNames();
        if (!tableNames.includes(tableName)) {
            return []; // Collection doesn't exist
        }

        const collection = await this.getCollection(collectionId);

        // Query using vector similarity (new API)
        const results = await collection
            .vectorSearch(queryVector)
            .limit(topK)
            .toArray();

        // Format results
        return results.map(result => ({
            hash: Number(result.hash),
            text: result.text,
            score: result._distance, // Lower is better for L2 distance
            metadata: JSON.parse(result.metadata || '{}'),
        }));
    }

    /**
     * Get all saved hashes from a collection
     * @param {string} collectionId - Collection ID
     * @returns {Promise<number[]>} Array of hashes
     */
    async getSavedHashes(collectionId) {
        if (!this.db) throw new Error('LanceDB not initialized');

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);

        const tableNames = await this.db.tableNames();
        if (!tableNames.includes(tableName)) {
            return []; // Collection doesn't exist
        }

        const collection = await this.getCollection(collectionId);

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
     * @returns {Promise<void>}
     */
    async deleteVectors(collectionId, hashes) {
        if (!this.db) throw new Error('LanceDB not initialized');
        if (hashes.length === 0) return;

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);

        const tableNames = await this.db.tableNames();
        if (!tableNames.includes(tableName)) {
            return; // Collection doesn't exist
        }

        const collection = await this.getCollection(collectionId);

        // Delete by hash
        const deleteFilter = `hash IN (${hashes.join(',')})`;

        await collection.delete(deleteFilter);

        console.log(`[LanceDB] Deleted ${hashes.length} items from ${collectionId}`);
    }

    /**
     * Purge entire collection
     * @param {string} collectionId - Collection ID
     * @returns {Promise<void>}
     */
    async purgeCollection(collectionId) {
        if (!this.db) throw new Error('LanceDB not initialized');

        // Sanitize table name
        const tableName = sanitizeTableName(collectionId);

        const tableNames = await this.db.tableNames();
        if (!tableNames.includes(tableName)) {
            return; // Collection doesn't exist
        }

        await this.db.dropTable(tableName);
        this.collections.delete(tableName);
        this.tableNameMap.delete(collectionId);

        console.log(`[LanceDB] Purged collection: ${tableName} (${collectionId})`);
    }

    /**
     * Purge all collections
     * @returns {Promise<void>}
     */
    async purgeAll() {
        if (!this.db) throw new Error('LanceDB not initialized');

        const tableNames = await this.db.tableNames();

        for (const tableName of tableNames) {
            await this.db.dropTable(tableName);
            this.collections.delete(tableName);
        }

        console.log(`[LanceDB] Purged all ${tableNames.length} collections`);
    }

    /**
     * Health check
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        try {
            if (!this.db) return false;

            // Try to list tables
            await this.db.tableNames();
            return true;
        } catch (error) {
            console.error('[LanceDB] Health check failed:', error);
            return false;
        }
    }

    /**
     * Get collection statistics
     * @param {string} collectionId - Collection ID
     * @returns {Promise<Object>} Stats {count, dimension, size}
     */
    async getCollectionStats(collectionId) {
        if (!this.db) throw new Error('LanceDB not initialized');

        const tableNames = await this.db.tableNames();
        if (!tableNames.includes(collectionId)) {
            return { count: 0, dimension: 0, size: 0 };
        }

        const collection = await this.getCollection(collectionId);
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
}

// Singleton instance
const backend = new LanceDBBackend();

export default backend;
