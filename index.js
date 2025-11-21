/**
 * Rabbit RAG Vectors Plugin
 *
 * Exposes vector embeddings to the client for client-side similarity calculations.
 * This allows RAGBooks to use its own ranking algorithms (Cosine, Jaccard, Hamming).
 */

import path from 'node:path';
import sanitize from 'sanitize-filename';
import vectra from 'vectra';

// Plugin info
const pluginName = 'vecthare';
const pluginVersion = '1.0.0';

/**
 * Initialize the plugin
 * @param {import('express').Router} router - Express router for plugin endpoints
 */
export async function init(router) {
    console.log(`[${pluginName}] Initializing v${pluginVersion}...`);

    // Health check endpoint
    router.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            plugin: pluginName,
            version: pluginVersion
        });
    });

    /**
     * Query with vectors - returns results WITH their embedding vectors
     * POST /api/plugins/rabbit-rag-vectors/query-with-vectors
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
     * POST /api/plugins/rabbit-rag-vectors/list-with-vectors
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
     * POST /api/plugins/rabbit-rag-vectors/get-embedding
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
            res.json({ embedding });

        } catch (error) {
            console.error(`[${pluginName}] get-embedding error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * Batch get embeddings
     * POST /api/plugins/rabbit-rag-vectors/batch-embeddings
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

            res.json({ embeddings });

        } catch (error) {
            console.error(`[${pluginName}] batch-embeddings error:`, error);
            res.status(500).json({ error: error.message });
        }
    });

    console.log(`[${pluginName}] Plugin initialized successfully`);
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
    name: 'Rabbit RAG Vectors',
    description: 'Exposes vector embeddings for client-side similarity calculations in RAGBooks',
    version: pluginVersion
};
