/**
 * Similharity Server Plugin
 *
 * Provides server-side enhancements for Similharity extension:
 * - List ALL collections from file system
 * - Get collection info and statistics
 * - LanceDB and Qdrant backend support
 * - Vectra full metadata storage
 * - Expose vector embeddings for client-side similarity calculations
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import sanitize from 'sanitize-filename';
import vectra from 'vectra';
import lancedbBackend from './lancedb-backend.js';
import qdrantBackend from './qdrant-backend.js';

// Plugin info
const pluginName = 'similharity';
const pluginVersion = '2.0.0';

/**
 * Initialize the plugin
 * @param {import('express').Router} router - Express router for plugin endpoints
 */
export async function init(router) {
    console.log(`[${pluginName}] Initializing v${pluginVersion}...`);

    // Initialize LanceDB backend
    // (will be initialized on first use via middleware)

    // ========================================================================
    // COLLECTION MANAGEMENT ENDPOINTS
    // ========================================================================

    /**
     * POST /api/plugins/similharity/open-folder
     * Opens collection folder in file explorer
     */
    router.post('/open-folder', async (req, res) => {
        try {
            const { collectionId, backend } = req.body;

            // Validate input
            if (!collectionId || !backend) {
                return res.status(400).json({
                    success: false,
                    error: 'collectionId and backend are required'
                });
            }

            const vectorsPath = req.user.directories.vectors;
            let folderPath;

            // Determine folder path based on backend
            if (backend === 'lancedb') {
                // LanceDB: vectors/lancedb/{collectionId}.lance
                folderPath = path.join(vectorsPath, 'lancedb', `${collectionId}.lance`);
            } else if (backend === 'qdrant') {
                // Qdrant: Remote, no local folder
                return res.status(400).json({
                    success: false,
                    error: 'Qdrant collections are stored remotely and have no local folder'
                });
            } else {
                // Standard (Vectra): vectors/{source}/{collectionId}
                // Parse collection ID to get source
                const parts = collectionId.split('/');
                if (parts.length >= 2) {
                    // Format: source/collectionId
                    folderPath = path.join(vectorsPath, parts[0], parts[1]);
                } else {
                    // Fallback: try transformers
                    folderPath = path.join(vectorsPath, 'transformers', collectionId);
                }
            }

            // Check if folder exists
            try {
                await fs.access(folderPath);
            } catch (error) {
                return res.status(404).json({
                    success: false,
                    error: `Folder not found: ${folderPath}`
                });
            }

            // Open folder using platform-specific command
            const platform = process.platform;

            let command;
            if (platform === 'win32') {
                command = `explorer "${folderPath}"`;
            } else if (platform === 'darwin') {
                command = `open "${folderPath}"`;
            } else {
                command = `xdg-open "${folderPath}"`;
            }

            exec(command, (error) => {
                if (error) {
                    console.error(`[${pluginName}] Failed to open folder:`, error);
                }
            });

            res.json({ success: true, path: folderPath });
        } catch (error) {
            console.error(`[${pluginName}] Error opening folder:`, error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * GET /api/plugins/similharity/collections
     * Lists ALL collections from ALL sources with chunk counts
     */
    router.get('/collections', async (req, res) => {
        try {
            const vectorsPath = req.user.directories.vectors;

            // Scan all sources (transformers, palm, openai, etc.)
            const allCollections = await scanAllSourcesForCollections(vectorsPath);

            res.json({
                success: true,
                count: allCollections.length,
                collections: allCollections
            });
        } catch (error) {
            console.error(`[${pluginName}] Error listing collections:`, error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /api/plugins/similharity/collection/:id
     * Gets detailed info about a specific collection
     */
    router.get('/collection/:id', async (req, res) => {
        try {
            const collectionId = req.params.id;
            const source = req.query.source || 'transformers';
            const vectorsPath = req.user.directories.vectors;

            const info = await getCollectionInfo(vectorsPath, collectionId, source);

            res.json({
                success: true,
                info: info
            });
        } catch (error) {
            console.error(`[${pluginName}] Error getting collection info:`, error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /api/plugins/similharity/sources
     * Lists all available embedding sources
     */
    router.get('/sources', async (req, res) => {
        try {
            const vectorsPath = req.user.directories.vectors;

            const entries = await fs.readdir(vectorsPath, { withFileTypes: true });
            const sources = entries
                .filter(e => e.isDirectory())
                .map(e => e.name);

            res.json({
                success: true,
                count: sources.length,
                sources: sources
            });
        } catch (error) {
            console.error(`[${pluginName}] Error listing sources:`, error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // ========================================================================
    // HEALTH CHECK
    // ========================================================================

    /**
     * GET /api/plugins/similharity/health
     * Health check endpoint - returns plugin status and capabilities
     */
    router.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            plugin: pluginName,
            version: pluginVersion,
            features: ['vectra-full-metadata', 'lancedb', 'qdrant', 'collection-browser', 'folder-explorer']
        });
    });

    // ========================================================================
    // LANCEDB BACKEND ENDPOINTS
    // ========================================================================

    /**
     * POST /api/plugins/similharity/lancedb/init
     * Initialize LanceDB backend
     */
    router.post('/lancedb/init', async (req, res) => {
        try {
            const vectorsPath = req.user.directories.vectors;
            await lancedbBackend.initialize(vectorsPath);

            res.json({ success: true, message: 'LanceDB initialized' });
        } catch (error) {
            console.error(`[${pluginName}] LanceDB init error:`, error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * GET /api/plugins/similharity/lancedb/health
     * Check LanceDB health
     */
    router.get('/lancedb/health', async (req, res) => {
        try {
            const healthy = await lancedbBackend.healthCheck();
            res.json({ success: true, healthy });
        } catch (error) {
            res.json({ success: false, healthy: false, error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/lancedb/insert
     * Insert vectors into collection
     */
    router.post('/lancedb/insert', async (req, res) => {
        try {
            const { collectionId, items } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            if (!items || !Array.isArray(items)) {
                return res.status(400).json({ error: 'items must be an array' });
            }

            // Initialize if needed
            if (!lancedbBackend.db) {
                await lancedbBackend.initialize(req.user.directories.vectors);
            }

            await lancedbBackend.insertVectors(collectionId, items);

            res.json({ success: true, inserted: items.length });
        } catch (error) {
            console.error(`[${pluginName}] LanceDB insert error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/lancedb/query
     * Query collection for similar vectors
     */
    router.post('/lancedb/query', async (req, res) => {
        try {
            const { collectionId, queryVector, topK = 10 } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            if (!queryVector || !Array.isArray(queryVector)) {
                return res.status(400).json({ error: 'queryVector must be an array' });
            }

            // Initialize if needed
            if (!lancedbBackend.db) {
                await lancedbBackend.initialize(req.user.directories.vectors);
            }

            const results = await lancedbBackend.queryCollection(collectionId, queryVector, topK);

            res.json({ success: true, results });
        } catch (error) {
            console.error(`[${pluginName}] LanceDB query error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/lancedb/list
     * Get all saved hashes from collection
     */
    router.post('/lancedb/list', async (req, res) => {
        try {
            const { collectionId } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            // Initialize if needed
            if (!lancedbBackend.db) {
                await lancedbBackend.initialize(req.user.directories.vectors);
            }

            const hashes = await lancedbBackend.getSavedHashes(collectionId);

            res.json({ success: true, hashes });
        } catch (error) {
            console.error(`[${pluginName}] LanceDB list error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/lancedb/delete
     * Delete specific items by hash
     */
    router.post('/lancedb/delete', async (req, res) => {
        try {
            const { collectionId, hashes } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            if (!hashes || !Array.isArray(hashes)) {
                return res.status(400).json({ error: 'hashes must be an array' });
            }

            // Initialize if needed
            if (!lancedbBackend.db) {
                await lancedbBackend.initialize(req.user.directories.vectors);
            }

            await lancedbBackend.deleteVectors(collectionId, hashes);

            res.json({ success: true, deleted: hashes.length });
        } catch (error) {
            console.error(`[${pluginName}] LanceDB delete error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/lancedb/purge
     * Purge entire collection
     */
    router.post('/lancedb/purge', async (req, res) => {
        try {
            const { collectionId } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            // Initialize if needed
            if (!lancedbBackend.db) {
                await lancedbBackend.initialize(req.user.directories.vectors);
            }

            await lancedbBackend.purgeCollection(collectionId);

            res.json({ success: true, message: `Collection ${collectionId} purged` });
        } catch (error) {
            console.error(`[${pluginName}] LanceDB purge error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/lancedb/purge-all
     * Purge all collections
     */
    router.post('/lancedb/purge-all', async (req, res) => {
        try {
            // Initialize if needed
            if (!lancedbBackend.db) {
                await lancedbBackend.initialize(req.user.directories.vectors);
            }

            await lancedbBackend.purgeAll();

            res.json({ success: true, message: 'All collections purged' });
        } catch (error) {
            console.error(`[${pluginName}] LanceDB purge-all error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/plugins/similharity/lancedb/stats/:collectionId
     * Get collection statistics
     */
    router.get('/lancedb/stats/:collectionId', async (req, res) => {
        try {
            const { collectionId } = req.params;

            // Initialize if needed
            if (!lancedbBackend.db) {
                await lancedbBackend.initialize(req.user.directories.vectors);
            }

            const stats = await lancedbBackend.getCollectionStats(collectionId);

            res.json({ success: true, stats });
        } catch (error) {
            console.error(`[${pluginName}] LanceDB stats error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========================================================================
    // QDRANT BACKEND ENDPOINTS
    // ========================================================================

    /**
     * POST /api/plugins/similharity/qdrant/init
     * Initialize Qdrant connection
     */
    router.post('/qdrant/init', async (req, res) => {
        try {
            const { host, port, url, apiKey } = req.body;

            await qdrantBackend.initialize({ host, port, url, apiKey });

            res.json({ success: true, message: 'Qdrant initialized' });
        } catch (error) {
            console.error(`[${pluginName}] Qdrant init error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/plugins/similharity/qdrant/health
     * Health check for Qdrant
     */
    router.get('/qdrant/health', async (req, res) => {
        try {
            const healthy = await qdrantBackend.healthCheck();
            res.json({ healthy });
        } catch (error) {
            console.error(`[${pluginName}] Qdrant health check error:`, error);
            res.json({ healthy: false });
        }
    });

    /**
     * POST /api/plugins/similharity/qdrant/insert
     * Insert vectors into collection (MULTITENANCY)
     * Body: {collectionId, items, tenantMetadata: {type, sourceId}}
     */
    router.post('/qdrant/insert', async (req, res) => {
        try {
            const { collectionId, items, tenantMetadata = {} } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            if (!items || !Array.isArray(items)) {
                return res.status(400).json({ error: 'items must be an array' });
            }

            // Pass tenantMetadata for multitenancy
            await qdrantBackend.insertVectors(collectionId, items, tenantMetadata);

            res.json({ success: true, inserted: items.length });
        } catch (error) {
            console.error(`[${pluginName}] Qdrant insert error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/qdrant/query
     * Query collection for similar vectors (MULTITENANCY)
     * Body: {collectionId, queryVector, topK, filters: {type, sourceId, minImportance, etc.}}
     */
    router.post('/qdrant/query', async (req, res) => {
        try {
            const { collectionId, queryVector, topK = 10, filters = {} } = req.body;

            if (!collectionId || !queryVector) {
                return res.status(400).json({ error: 'collectionId and queryVector are required' });
            }

            // Pass filters for multitenancy
            const results = await qdrantBackend.queryCollection(collectionId, queryVector, topK, filters);

            res.json({ success: true, results });
        } catch (error) {
            console.error(`[${pluginName}] Qdrant query error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/qdrant/list
     * List all hashes in a collection (MULTITENANCY)
     * Body: {collectionId, filters: {type, sourceId}}
     */
    router.post('/qdrant/list', async (req, res) => {
        try {
            const { collectionId, filters = {} } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            // Pass filters for multitenancy
            const hashes = await qdrantBackend.getSavedHashes(collectionId, filters);

            res.json({ success: true, hashes });
        } catch (error) {
            console.error(`[${pluginName}] Qdrant list error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/qdrant/delete
     * Delete vectors from collection (MULTITENANCY)
     * Body: {collectionId, hashes}
     */
    router.post('/qdrant/delete', async (req, res) => {
        try {
            const { collectionId, hashes } = req.body;

            if (!collectionId || !hashes) {
                return res.status(400).json({ error: 'collectionId and hashes are required' });
            }

            await qdrantBackend.deleteVectors(collectionId, hashes);

            res.json({ success: true, deleted: hashes.length });
        } catch (error) {
            console.error(`[${pluginName}] Qdrant delete error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/qdrant/purge
     * Purge collection for specific source (MULTITENANCY)
     * Body: {collectionId, filters: {type, sourceId}}
     */
    router.post('/qdrant/purge', async (req, res) => {
        try {
            const { collectionId, filters = {} } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            // Pass filters to purge specific source
            await qdrantBackend.purgeCollection(collectionId, filters);

            res.json({ success: true, message: `Collection ${collectionId} purged` });
        } catch (error) {
            console.error(`[${pluginName}] Qdrant purge error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/plugins/similharity/qdrant/purge-all
     * Purge all collections
     */
    router.post('/qdrant/purge-all', async (req, res) => {
        try {
            await qdrantBackend.purgeAll();

            res.json({ success: true, message: 'All collections purged' });
        } catch (error) {
            console.error(`[${pluginName}] Qdrant purge-all error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========================================================================
    // VECTRA ENDPOINTS (Standard backend with full metadata support)
    // ========================================================================

    /**
     * Insert with full metadata - enhanced version of ST's /api/vector/insert
     * Stores ALL metadata fields, not just hash/text/index
     * POST /api/plugins/similharity/vectra/insert
     */
    router.post('/vectra/insert', async (req, res) => {
        try {
            const { collectionId, source, items, model = '' } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            if (!source) {
                return res.status(400).json({ error: 'source is required' });
            }

            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'items array is required' });
            }

            // Get the vectra index
            const store = await getIndex(req.user.directories, collectionId, source, model);

            // Generate embeddings
            const texts = items.map(x => x.text);
            const vectors = await getBatchVector(source, texts, model, req.user.directories, req);

            // Insert with FULL metadata
            await store.beginUpdate();

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const vector = vectors[i];

                await store.upsertItem({
                    vector: vector,
                    metadata: {
                        // Core fields (ST compatibility)
                        hash: item.hash,
                        text: item.text,
                        index: item.index,

                        // Similharity rich metadata
                        name: item.name,
                        disabled: item.disabled,
                        importance: item.importance,
                        keywords: item.keywords,
                        customWeight: item.customWeight,

                        // Conditional activation
                        conditions: item.conditions,

                        // Dual-vector
                        summaryVectors: item.summaryVectors,
                        isSummaryChunk: item.isSummaryChunk,
                        parentHash: item.parentHash,

                        // Chunk groups
                        chunkGroup: item.chunkGroup,
                        groupBoost: item.groupBoost,

                        // Additional metadata (timestamps, chat-specific, etc.)
                        ...item.metadata,
                    }
                });
            }

            await store.endUpdate();

            res.json({ success: true, inserted: items.length });

        } catch (error) {
            console.error(`[${pluginName}] vectra/insert error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * List with full metadata - enhanced version that returns ALL metadata
     * POST /api/plugins/similharity/vectra/list
     */
    router.post('/vectra/list', async (req, res) => {
        try {
            const { collectionId, source, model = '' } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            if (!source) {
                return res.status(400).json({ error: 'source is required' });
            }

            const store = await getIndex(req.user.directories, collectionId, source, model);
            const items = await store.listItems();

            // Return ALL metadata (not just hash/text/index)
            const result = items.map(item => ({
                hash: item.metadata.hash,
                text: item.metadata.text,
                index: item.metadata.index,
                vector: item.vector,
                // All Similharity metadata
                metadata: item.metadata
            }));

            res.json(result);

        } catch (error) {
            console.error(`[${pluginName}] vectra/list error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * Query with full metadata - returns search results with ALL metadata
     * POST /api/plugins/similharity/vectra/query
     */
    router.post('/vectra/query', async (req, res) => {
        try {
            const { collectionId, source, searchText, topK = 10, threshold = 0.0, model = '' } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            if (!source) {
                return res.status(400).json({ error: 'source is required' });
            }

            if (!searchText) {
                return res.status(400).json({ error: 'searchText is required' });
            }

            // Get embedding for search text
            const queryVector = await getEmbeddingForSource(source, searchText, model, req.user.directories, req);

            // Get the vectra index
            const store = await getIndex(req.user.directories, collectionId, source, model);
            const items = await store.listItems();

            if (!items || items.length === 0) {
                return res.json([]);
            }

            // Calculate similarities and return with FULL metadata
            const results = items
                .map(item => {
                    const similarity = cosineSimilarity(queryVector, item.vector);
                    return {
                        hash: item.metadata.hash,
                        text: item.metadata.text,
                        index: item.metadata.index,
                        score: similarity,
                        // All Similharity metadata
                        metadata: item.metadata
                    };
                })
                .filter(item => item.score >= threshold)
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);

            res.json(results);

        } catch (error) {
            console.error(`[${pluginName}] vectra/query error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * Query with vectors - returns results WITH their embedding vectors
     * POST /api/plugins/similharity/query-with-vectors
     */
    router.post('/query-with-vectors', async (req, res) => {
        try {
            const { collectionId, source, queryVector, topK = 10, threshold = 0.0, model = '' } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            if (!source) {
                return res.status(400).json({ error: 'source is required' });
            }

            if (!queryVector || !Array.isArray(queryVector)) {
                return res.status(400).json({ error: 'queryVector must be an array' });
            }

            // Get the vectra index
            const store = await getIndex(req.user.directories, collectionId, source, model);

            // Get all items with their vectors
            const items = await store.listItems();

            if (!items || items.length === 0) {
                return res.json([]);
            }

            // Calculate similarities and return with vectors
            const results = items
                .map(item => {
                    const similarity = cosineSimilarity(queryVector, item.vector);
                    return {
                        hash: item.metadata.hash,
                        text: item.metadata.text,
                        index: item.metadata.index,
                        vector: item.vector,
                        score: similarity
                    };
                })
                .filter(item => item.score >= threshold)
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);

            res.json(results);

        } catch (error) {
            console.error(`[${pluginName}] query-with-vectors error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * List with vectors - returns all items in collection WITH vectors
     * POST /api/plugins/similharity/list-with-vectors
     */
    router.post('/list-with-vectors', async (req, res) => {
        try {
            const { collectionId, source, model = '' } = req.body;

            if (!collectionId) {
                return res.status(400).json({ error: 'collectionId is required' });
            }

            if (!source) {
                return res.status(400).json({ error: 'source is required' });
            }

            const store = await getIndex(req.user.directories, collectionId, source, model);
            const items = await store.listItems();

            // Map to simpler format with vectors
            const result = items.map(item => ({
                hash: item.metadata.hash,
                text: item.metadata.text,
                index: item.metadata.index,
                vector: item.vector
            }));

            res.json(result);

        } catch (error) {
            console.error(`[${pluginName}] list-with-vectors error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * Get embedding for text - generates embedding using configured provider
     * POST /api/plugins/similharity/get-embedding
     */
    router.post('/get-embedding', async (req, res) => {
        try {
            const { text, source, model = '' } = req.body;

            if (!text) {
                return res.status(400).json({ error: 'text is required' });
            }

            if (!source) {
                return res.status(400).json({ error: 'source is required' });
            }

            const embedding = await getEmbeddingForSource(source, text, model, req.user.directories, req);
            res.json({ success: true, embedding });

        } catch (error) {
            console.error(`[${pluginName}] get-embedding error:`, error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Batch get embeddings
     * POST /api/plugins/similharity/batch-embeddings
     */
    router.post('/batch-embeddings', async (req, res) => {
        try {
            const { texts, source, model = '' } = req.body;

            if (!texts || !Array.isArray(texts)) {
                return res.status(400).json({ error: 'texts must be an array' });
            }

            if (!source) {
                return res.status(400).json({ error: 'source is required' });
            }

            const embeddings = [];
            for (const text of texts) {
                const embedding = await getEmbeddingForSource(source, text, model, req.user.directories, req);
                embeddings.push(embedding);
            }

            res.json({ success: true, embeddings });

        } catch (error) {
            console.error(`[${pluginName}] batch-embeddings error:`, error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    console.log(`[${pluginName}] Plugin initialized successfully`);
}

/**
 * Recursively scans a directory tree to find all index.json files (vectra indexes)
 * This creates a folder mirror of the actual file system structure
 * @param {string} dir Directory to scan
 * @param {string} relativePath Relative path from vectors root (for tracking structure)
 * @returns {Promise<object[]>} Array of {indexPath, collectionId, source, modelPath, relativePath}
 */
async function findAllIndexes(dir, relativePath = '') {
    const results = [];

    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const newRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

            if (entry.isDirectory()) {
                // Recursively scan subdirectories
                const subResults = await findAllIndexes(fullPath, newRelativePath);
                results.push(...subResults);
            } else if (entry.name === 'index.json') {
                // Found an index! Extract metadata from path structure
                // Path structure: vectors/{source}/{collectionId}/{model}/index.json
                const pathParts = newRelativePath.split(path.sep);

                if (pathParts.length >= 3) {
                    const source = pathParts[0]; // e.g., 'transformers', 'palm', 'openai'
                    const collectionId = pathParts[1]; // e.g., 'vecthare_chat_12345'
                    const modelPath = pathParts.slice(2, -1).join(path.sep); // Everything between collection and index.json

                    results.push({
                        indexPath: fullPath,
                        collectionId: collectionId,
                        source: source,
                        modelPath: modelPath,
                        relativePath: newRelativePath
                    });
                }
            }
        }
    } catch (error) {
        // Skip directories we can't read
        console.error(`[${pluginName}] Error scanning ${dir}:`, error.message);
    }

    return results;
}

/**
 * Gets chunk count from a vectra index.json file
 * @param {string} indexPath Full path to index.json
 * @returns {Promise<number>} Number of chunks
 */
async function getChunkCountFromIndex(indexPath) {
    try {
        const modelDir = path.dirname(indexPath);
        const store = new vectra.LocalIndex(modelDir);

        if (!await store.isIndexCreated()) {
            return 0;
        }

        const items = await store.listItems();
        return items.length;
    } catch (error) {
        console.error(`[${pluginName}] Error reading index at ${indexPath}:`, error.message);
        return 0;
    }
}

/**
 * Scans ALL sources and returns all collections with their metadata
 * Uses recursive folder mirroring to find ALL index.json files
 * @param {string} vectorsPath Path to vectors directory
 * @returns {Promise<object[]>} Array of collection objects with source, id, and chunkCount
 */
async function scanAllSourcesForCollections(vectorsPath) {
    const allCollections = [];

    try {
        console.log(`[${pluginName}] 🔍 Scanning all vector backends in: ${vectorsPath}`);

        // ===== SCAN STANDARD (VECTRA) BACKEND =====
        const vectraIndexes = await findAllIndexes(vectorsPath);
        console.log(`[${pluginName}] Found ${vectraIndexes.length} Standard (Vectra) indexes`);

        // Group vectra indexes by collection
        const vectraCollectionMap = new Map();

        for (const index of vectraIndexes) {
            const key = `${index.source}:${index.collectionId}`;

            if (!vectraCollectionMap.has(key)) {
                vectraCollectionMap.set(key, {
                    id: index.collectionId,
                    source: index.source,
                    backend: 'standard',
                    indexes: [],
                    totalChunks: 0
                });
            }

            const chunkCount = await getChunkCountFromIndex(index.indexPath);
            vectraCollectionMap.get(key).indexes.push({
                modelPath: index.modelPath,
                indexPath: index.indexPath,
                chunkCount: chunkCount
            });
            vectraCollectionMap.get(key).totalChunks += chunkCount;

            console.log(`[${pluginName}]   📦 Standard: ${index.source}/${index.collectionId}/${index.modelPath} → ${chunkCount} chunks`);
        }

        // Add Standard collections to result
        for (const [key, collection] of vectraCollectionMap) {
            allCollections.push({
                id: collection.id,
                source: collection.source,
                backend: 'standard',
                chunkCount: collection.totalChunks,
                modelCount: collection.indexes.length
            });
            console.log(`[${pluginName}]   ✅ Standard: ${collection.source}/${collection.id} → ${collection.totalChunks} chunks`);
        }

        // ===== SCAN LANCEDB BACKEND =====
        const lancedbPath = path.join(vectorsPath, 'lancedb');
        try {
            await fs.access(lancedbPath);
            const lancedbDirs = await fs.readdir(lancedbPath);
            console.log(`[${pluginName}] Found ${lancedbDirs.length} LanceDB collections`);

            // Initialize LanceDB to query collections
            if (!lancedbBackend.db) {
                await lancedbBackend.initialize(vectorsPath);
            }

            for (const dir of lancedbDirs) {
                if (dir.endsWith('.lance')) {
                    // LanceDB stores tables with sanitized names (directory name without .lance)
                    const tableName = dir.replace('.lance', '');

                    try {
                        // Get chunk count from LanceDB using the actual table name
                        const table = await lancedbBackend.db.openTable(tableName);
                        const count = await table.countRows();

                        // Use the table name as the collection ID for now
                        // (The frontend will need to handle this sanitized format)
                        allCollections.push({
                            id: tableName,  // Use actual table name
                            source: 'lancedb',
                            backend: 'lancedb',
                            chunkCount: count,
                            modelCount: 1
                        });

                        console.log(`[${pluginName}]   ✅ LanceDB: ${tableName} → ${count} chunks`);
                    } catch (error) {
                        console.error(`[${pluginName}]   ❌ LanceDB collection ${tableName} error:`, error.message);
                    }
                }
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`[${pluginName}] LanceDB scan error:`, error);
            }
        }

        // ===== SCAN QDRANT BACKEND =====
        // Note: Qdrant collections are stored remotely, so we can't scan the filesystem
        // Instead, we query the Qdrant API if it's initialized
        try {
            if (qdrantBackend.client) {
                const collections = await qdrantBackend.client.getCollections();
                console.log(`[${pluginName}] Found ${collections.collections.length} Qdrant collections`);

                for (const collection of collections.collections) {
                    // Skip non-Similharity collections
                    if (!collection.name.startsWith('similharity_')) {
                        continue;
                    }

                    try {
                        const info = await qdrantBackend.client.getCollection(collection.name);
                        const count = info.points_count || 0;

                        allCollections.push({
                            id: collection.name,
                            source: 'qdrant',
                            backend: 'qdrant',
                            chunkCount: count,
                            modelCount: 1
                        });

                        console.log(`[${pluginName}]   ✅ Qdrant: ${collection.name} → ${count} chunks`);
                    } catch (error) {
                        console.error(`[${pluginName}]   ❌ Qdrant collection ${collection.name} error:`, error.message);
                    }
                }
            }
        } catch (error) {
            console.log(`[${pluginName}] Qdrant not initialized or unavailable`);
        }

        console.log(`[${pluginName}] 📊 Total collections found: ${allCollections.length}`);
    } catch (error) {
        console.error(`[${pluginName}] Error scanning all sources:`, error);
    }

    return allCollections;
}

/**
 * Scans the vectors directory and returns all collection IDs for a specific source
 * @param {string} vectorsPath Path to vectors directory
 * @param {string} source Embedding source (e.g., 'transformers')
 * @returns {Promise<string[]>} Array of collection IDs
 */
async function scanAllCollections(vectorsPath, source = 'transformers') {
    const collections = [];

    try {
        // Path: vectors/{source}/{collectionId}/{model}/
        const sourcePath = path.join(vectorsPath, source);

        console.log(`[${pluginName}] Scanning for collections...`);
        console.log(`[${pluginName}]   Vectors path: ${vectorsPath}`);
        console.log(`[${pluginName}]   Source: ${source}`);
        console.log(`[${pluginName}]   Full path: ${sourcePath}`);

        // Check if source directory exists
        try {
            await fs.access(sourcePath);
            console.log(`[${pluginName}]   ✓ Source directory exists`);
        } catch {
            console.log(`[${pluginName}]   ✗ Source directory NOT found: ${sourcePath}`);
            return collections;
        }

        // List all collection directories
        const entries = await fs.readdir(sourcePath, { withFileTypes: true });
        console.log(`[${pluginName}]   Found ${entries.length} entries in source directory`);

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const collectionId = entry.name;
                console.log(`[${pluginName}]     Checking: ${collectionId}`);

                // Check if this collection has any model subdirectories
                const collectionPath = path.join(sourcePath, collectionId);
                const modelDirs = await fs.readdir(collectionPath, { withFileTypes: true });

                const hasModelDirs = modelDirs.some(d => d.isDirectory());
                console.log(`[${pluginName}]       Has model dirs: ${hasModelDirs} (${modelDirs.filter(d => d.isDirectory()).map(d => d.name).join(', ') || 'none'})`);

                // If it has at least one model directory, it's a valid collection
                if (hasModelDirs) {
                    collections.push(collectionId);
                    console.log(`[${pluginName}]       ✓ Added to collections list`);
                } else {
                    console.log(`[${pluginName}]       ✗ Skipped (no model directories)`);
                }
            } else {
                console.log(`[${pluginName}]     Skipping file: ${entry.name}`);
            }
        }

        console.log(`[${pluginName}] Scan complete: Found ${collections.length} valid collections for source '${source}'`);
        if (collections.length > 0) {
            console.log(`[${pluginName}] Collections: ${collections.join(', ')}`);
        }
    } catch (error) {
        console.error(`[${pluginName}] Error scanning collections:`, error);
        console.error(`[${pluginName}]   Error stack:`, error.stack);
    }

    return collections;
}

/**
 * Gets detailed info about a collection (chunk count, size, etc.)
 * @param {string} vectorsPath Path to vectors directory
 * @param {string} collectionId Collection ID
 * @param {string} source Embedding source
 * @returns {Promise<object>} Collection info
 */
async function getCollectionInfo(vectorsPath, collectionId, source = 'transformers') {
    const info = {
        id: collectionId,
        source: source,
        exists: false,
        models: [],
        totalChunks: 0,
        totalSize: 0
    };

    try {
        const collectionPath = path.join(vectorsPath, source, collectionId);

        // Check if collection exists
        try {
            await fs.access(collectionPath);
            info.exists = true;
        } catch {
            return info;
        }

        // List model directories
        const modelDirs = await fs.readdir(collectionPath, { withFileTypes: true });

        for (const modelDir of modelDirs) {
            if (modelDir.isDirectory()) {
                const modelPath = path.join(collectionPath, modelDir.name);

                // Check for index files (vectra creates index.json)
                const indexPath = path.join(modelPath, 'index.json');

                try {
                    const stats = await fs.stat(indexPath);
                    info.models.push({
                        name: modelDir.name,
                        size: stats.size
                    });
                    info.totalSize += stats.size;
                } catch {
                    // Index doesn't exist or can't be read
                }
            }
        }
    } catch (error) {
        console.error(`[${pluginName}] Error getting collection info for ${collectionId}:`, error);
    }

    return info;
}

/**
 * Gets chunk count for a collection by reading vectra index
 * @param {object} directories - User directories
 * @param {string} collectionId - Collection ID
 * @param {string} source - Vector source
 * @returns {Promise<number>} Number of chunks
 */
async function getCollectionChunkCount(directories, collectionId, source) {
    try {
        const collectionPath = path.join(directories.vectors, sanitize(source), sanitize(collectionId));

        // Find the first model directory
        const modelDirs = await fs.readdir(collectionPath, { withFileTypes: true });
        const modelDir = modelDirs.find(d => d.isDirectory());

        if (!modelDir) {
            console.log(`[${pluginName}] No model directory found for ${collectionId}`);
            return 0;
        }

        const model = modelDir.name;
        const store = await getIndex(directories, collectionId, source, model);

        // List all items in the index
        const items = await store.listItems();
        return items.length;
    } catch (error) {
        console.error(`[${pluginName}] Error getting chunk count for ${collectionId}:`, error);
        return 0;
    }
}

/**
 * Gets the vectra index for a collection
 * @param {object} directories - User directories
 * @param {string} collectionId - Collection ID
 * @param {string} source - Vector source
 * @param {string} model - Model name
 * @returns {Promise<vectra.LocalIndex>}
 */
async function getIndex(directories, collectionId, source, model) {
    const pathToFile = path.join(directories.vectors, sanitize(source), sanitize(collectionId), sanitize(model));
    const store = new vectra.LocalIndex(pathToFile);

    if (!await store.isIndexCreated()) {
        await store.createIndex();
    }

    return store;
}

/**
 * Get embedding for a given source
 * @param {string} source - Vector source name
 * @param {string} text - Text to embed
 * @param {string} model - Model name
 * @param {object} directories - User directories
 * @param {import('express').Request} req - Express request object
 * @returns {Promise<number[]>} Embedding vector
 */
async function getEmbeddingForSource(source, text, model, directories, req) {
    switch (source) {
        case 'transformers': {
            const { getTransformersVector } = await import('../../src/vectors/embedding.js');
            return await getTransformersVector(text);
        }
        case 'openai':
        case 'togetherai':
        case 'mistral': {
            const { getOpenAIVector } = await import('../../src/vectors/openai-vectors.js');
            return await getOpenAIVector(text, source, directories, model);
        }
        case 'nomicai': {
            const { getNomicAIVector } = await import('../../src/vectors/nomicai-vectors.js');
            return await getNomicAIVector(text, source, directories);
        }
        case 'cohere': {
            const { getCohereVector } = await import('../../src/vectors/cohere-vectors.js');
            return await getCohereVector(text, true, directories, model);
        }
        case 'ollama': {
            const { getOllamaVector } = await import('../../src/vectors/ollama-vectors.js');
            return await getOllamaVector(text, req.body.apiUrl, model, req.body.keep, directories);
        }
        case 'llamacpp': {
            const { getLlamaCppVector } = await import('../../src/vectors/llamacpp-vectors.js');
            return await getLlamaCppVector(text, req.body.apiUrl, directories);
        }
        case 'vllm': {
            const { getVllmVector } = await import('../../src/vectors/vllm-vectors.js');
            return await getVllmVector(text, req.body.apiUrl, model, directories);
        }
        case 'palm':
        case 'vertexai': {
            const googleVectors = await import('../../src/vectors/google-vectors.js');
            if (source === 'palm') {
                return await googleVectors.getMakerSuiteVector(text, model, req);
            } else {
                return await googleVectors.getVertexVector(text, model, req);
            }
        }
        case 'extras': {
            const { getExtrasVector } = await import('../../src/vectors/extras-vectors.js');
            return await getExtrasVector(text, req.body.extrasUrl, req.body.extrasKey);
        }
        default:
            throw new Error(`Unknown vector source: ${source}`);
    }
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Cosine similarity (-1 to 1)
 */
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
}

/**
 * Plugin exit handler
 */
export async function exit() {
    console.log(`[${pluginName}] Plugin shutting down...`);
}

export const info = {
    id: pluginName,
    name: 'Similharity',
    description: 'Vector database backend extensions for Similharity - LanceDB, Qdrant, and enhanced Vectra support with full metadata storage',
    version: pluginVersion
};
