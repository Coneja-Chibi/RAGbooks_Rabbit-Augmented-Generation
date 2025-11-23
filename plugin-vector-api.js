/**
 * Plugin Vector API - Wrapper for vecthare server plugin
 *
 * WHY: Detect if plugin is available and use it to get vectors with embeddings.
 * Falls back to standard ST API if plugin not installed.
 *
 * PROVIDES:
 * - queryWithVectors() - Query collection, returns results with .vector property
 * - listWithVectors() - List all items with .vector property
 * - isPluginAvailable() - Check if plugin is enabled
 */

import { logger } from './core-system.js';
import { getRequestHeaders } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

function getModelForSource(source) {
    const s = extension_settings?.vectors;
    if (!s) return '';
    
    switch (source) {
        case 'openai': return s.openai_model;
        case 'cohere': return s.cohere_model;
        case 'ollama': return s.ollama_model;
        case 'vllm': return s.vllm_model;
        case 'togetherai': return s.togetherai_model;
        case 'electronhub': return s.electronhub_model;
        case 'openrouter': return s.openrouter_model;
        case 'palm': 
        case 'vertexai': return s.google_model;
        case 'webllm': return s.webllm_model;
        default: return '';
    }
}

// Cache plugin availability check
let pluginAvailable = null;
let pluginCheckPromise = null;

/**
 * Check if vecthare plugin is available
 * Caches result to avoid repeated checks
 * @returns {Promise<boolean>}
 */
export async function isPluginAvailable() {
    if (pluginAvailable !== null) {
        return pluginAvailable;
    }

    if (pluginCheckPromise) {
        return pluginCheckPromise;
    }

    pluginCheckPromise = (async () => {
        try {
            // Try to hit the health endpoint
            const response = await fetch('/api/plugins/vecthare/health', {
                method: 'GET',
                headers: getRequestHeaders()
            });

            // If we get 200, plugin is loaded and healthy
            if (response.ok) {
                const data = await response.json();
                pluginAvailable = true;
                logger.log(`✅ [RAG:PLUGIN] vecthare plugin v${data.version} detected`);
                return true;
            } else if (response.status === 404) {
                pluginAvailable = false;
                logger.warn('⚠️ [RAG:PLUGIN] VectHare server plugin NOT detected (404)');
                logger.warn('ℹ️  Troubleshooting Step 1: Ensure "enableServerPlugins: true" is set in your config.yaml');
                logger.warn('ℹ️  Troubleshooting Step 2: Ensure the "vecthare" folder exists in your /plugins directory');
                logger.warn('⚠️ [RAG:PLUGIN] Falling back to keyword-only search (if supported) or failing.');
                return false;
            } else {
                // Unexpected status - assume not available
                pluginAvailable = false;
                logger.warn(`⚠️ [RAG:PLUGIN] Unexpected status ${response.status}`);
                return false;
            }
        } catch (error) {
            pluginAvailable = false;
            logger.error('[RAG:PLUGIN] Failed to check plugin availability:', error);
            return false;
        }
    })();

    return pluginCheckPromise;
}

/**
 * Query collection with vectors included in results
 * Requires vecthare plugin to be installed
 *
 * @param {string} collectionId - Collection ID
 * @param {number[]} queryVector - Pre-computed query embedding
 * @param {number} topK - Number of results
 * @param {number} threshold - Similarity threshold
 * @param {string} source - Vector source (palm, openai, etc.)
 * @returns {Promise<Array>} Results with .vector property
 */
export async function queryWithVectors(collectionId, queryVector, topK = 10, threshold = 0.0, source = 'palm') {
    const available = await isPluginAvailable();

    if (!available) {
        throw new Error('vecthare plugin is not installed. Cannot get vectors from server.');
    }

    try {
        const response = await fetch('/api/plugins/vecthare/query-with-vectors', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId,
                source,
                queryVector,
                topK,
                threshold,
                model: getModelForSource(source)
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `Plugin query failed: ${response.status}`);
        }

        const data = await response.json();
        logger.log(`[RAG:PLUGIN] Query returned ${data.count || data.length} results with vectors`);

        return Array.isArray(data) ? data : data.results;

    } catch (error) {
        logger.error('[RAG:PLUGIN] Query failed:', error);
        throw error;
    }
}

/**
 * List all items in collection with vectors included
 * Requires vecthare plugin to be installed
 *
 * @param {string} collectionId - Collection ID
 * @param {string} source - Vector source (palm, openai, etc.)
 * @returns {Promise<Array>} Items with .vector property
 */
export async function listWithVectors(collectionId, source = 'palm') {
    const available = await isPluginAvailable();

    if (!available) {
        throw new Error('vecthare plugin is not installed. Cannot get vectors from server.');
    }

    try {
        const response = await fetch('/api/plugins/vecthare/list-with-vectors', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId,
                source,
                model: getModelForSource(source)
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `Plugin list failed: ${response.status}`);
        }

        const data = await response.json();
        logger.log(`[RAG:PLUGIN] Listed ${data.length} items with vectors`);

        return data;

    } catch (error) {
        logger.error('[RAG:PLUGIN] List failed:', error);
        throw error;
    }
}

/**
 * Get a single item by hash with its vector
 * Requires vecthare plugin to be installed
 *
 * @param {string} collectionId - Collection ID
 * @param {number} hash - Item hash
 * @param {string} source - Vector source
 * @returns {Promise<Object>} Item with .vector property
 */
export async function getItemWithVector(collectionId, hash, source = 'palm') {
    const available = await isPluginAvailable();

    if (!available) {
        throw new Error('vecthare plugin is not installed. Cannot get vectors from server.');
    }

    try {
        const response = await fetch('/api/plugins/vecthare/get-item', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId,
                source,
                hash,
                model: getModelForSource(source)
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `Plugin get item failed: ${response.status}`);
        }

        return await response.json();

    } catch (error) {
        logger.error('[RAG:PLUGIN] Get item failed:', error);
        throw error;
    }
}

/**
 * Fetch vectors for chunks after they've been loaded from State
 * This allows using ST-Helpers with chunks that don't have embeddings
 *
 * @param {Array} chunks - Chunks from State (without .embedding)
 * @param {string} collectionId - Collection ID
 * @param {string} source - Vector source
 * @returns {Promise<Array>} Chunks with .embedding property added
 */
export async function enrichChunksWithVectors(chunks, collectionId, source = 'palm') {
    const available = await isPluginAvailable();

    if (!available) {
        logger.warn('[RAG:PLUGIN] Cannot enrich chunks - plugin not available');
        return chunks; // Return unchanged
    }

    try {
        // Get all items with vectors from plugin
        const items = await listWithVectors(collectionId, source);

        // Create hash → vector map
        const vectorMap = new Map();
        for (const item of items) {
            vectorMap.set(item.hash, item.vector);
        }

        // Add .embedding property to chunks
        const enriched = chunks.map(chunk => {
            const vector = vectorMap.get(chunk.hash);
            if (vector) {
                return { ...chunk, embedding: vector };
            } else {
                logger.warn(`[RAG:PLUGIN] No vector found for chunk ${chunk.hash}`);
                return chunk;
            }
        });

        const enrichedCount = enriched.filter(c => c.embedding).length;
        logger.log(`[RAG:PLUGIN] Enriched ${enrichedCount}/${chunks.length} chunks with vectors`);

        return enriched;

    } catch (error) {
        logger.error('[RAG:PLUGIN] Failed to enrich chunks:', error);
        return chunks; // Return unchanged on error
    }
}
