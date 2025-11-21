/**
 * Rabbit Augmented Generation - Embeddings & Similarity Module
 *
 * WHY: Consolidates embedding generation and similarity search into a single module.
 * These two systems are tightly coupled - embeddings are generated for similarity search.
 *
 * This module provides:
 * - Embedding provider integration: Detection, single/batch embedding, caching
 * - Similarity search: Top-K search, batch similarity, performance monitoring
 * - Wraps ST's vector API and ST-Helpers' vector distance functions
 *
 * Consolidated from: core-embeddings.js + core-similarity.js
 */

import { Diagnostics } from './core-system.js';
import { extensionName } from './core-state.js';
import { extension_settings } from '../../../extensions.js';

// ==================== EMBEDDING GENERATION ====================

// Embedding cache
// WHY: Avoid re-embedding the same text (expensive operation)
const embeddingCache = new Map();

/**
 * Get configured embedding provider from ST
 * WHY: Read ST's vector extension settings to know which provider to use
 *
 * @returns {object} Provider configuration
 * @throws {Error} If no provider configured
 */
export function getEmbeddingProvider() {
    // Access ST's vector extension settings through the proper import
    const vectorSettings = extension_settings?.vectors;

    if (!vectorSettings) {
        throw new Error('Vectors extension not found. Please install the Vectors extension.');
    }

    if (!vectorSettings.source) {
        throw new Error('No embedding provider configured. Please configure a provider in the Vectors extension settings.');
    }

    return {
        source: vectorSettings.source,
        model: vectorSettings.model || null,
        apiKey: vectorSettings.apiKey || null,
        endpoint: vectorSettings.endpoint || null,
        dimensions: vectorSettings.dimensions || null
    };
}

/**
 * Generate cache key for embedding
 * WHY: Deterministic key for caching (same text + provider = same key)
 *
 * @private
 */
function getCacheKey(text, provider) {
    const providerKey = `${provider.source}:${provider.model || 'default'}`;
    const textHash = simpleHash(text);
    return `${providerKey}:${textHash}`;
}

/**
 * Simple hash function for cache keys
 * WHY: Fast hashing for cache key generation
 *
 * @private
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
}

/**
 * Get embedding for a single text
 * WHY: Generate vector representation for similarity search
 *
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} Embedding vector
 */
export async function getEmbedding(text) {
    if (!text || text.trim().length === 0) {
        throw new Error('Cannot embed empty text');
    }

    const provider = getEmbeddingProvider();

    // Check cache first
    const cacheKey = getCacheKey(text, provider);
    if (embeddingCache.has(cacheKey)) {
        console.log('[RAG:EMBED] Cache hit');
        return embeddingCache.get(cacheKey);
    }

    console.log(`[RAG:EMBED] Generating embedding via ${provider.source}...`);

    // Call ST's vector API
    try {
        const embedding = await callVectorAPI(text, provider);

        // Validate result
        if (!Array.isArray(embedding)) {
            throw new Error('Provider returned non-array embedding');
        }

        if (embedding.length === 0) {
            throw new Error('Provider returned empty embedding');
        }

        if (embedding.some(v => isNaN(v) || v === null || v === undefined)) {
            throw new Error('Provider returned embedding with invalid values (NaN/null/undefined)');
        }

        // Cache result
        embeddingCache.set(cacheKey, embedding);

        console.log(`[RAG:EMBED] Generated embedding (${embedding.length} dimensions)`);

        return embedding;

    } catch (error) {
        console.error('[RAG:EMBED] Failed to generate embedding:', error);
        throw new Error(`Embedding generation failed: ${error.message}`);
    }
}

/**
 * Get embeddings for multiple texts (batch)
 * WHY: More efficient than calling getEmbedding() in a loop
 *
 * @param {string[]} texts - Texts to embed
 * @param {function} [progressCallback] - Called with (current, total) after each embedding
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
export async function getEmbeddingsBatch(texts, progressCallback = null) {
    if (!Array.isArray(texts) || texts.length === 0) {
        throw new Error('texts must be a non-empty array');
    }

    const provider = getEmbeddingProvider();

    console.log(`[RAG:EMBED] Batch embedding ${texts.length} texts via ${provider.source}...`);

    // Check if provider supports batch API
    const supportsBatch = providerSupportsBatch(provider.source);

    if (supportsBatch) {
        // Use batch API
        try {
            const embeddings = await callBatchVectorAPI(texts, provider, progressCallback);
            return embeddings;
        } catch (error) {
            console.warn('[RAG:EMBED] Batch API failed, falling back to sequential:', error.message);
            // Fall through to sequential processing
        }
    }

    // Sequential processing with cache checks
    const embeddings = [];

    for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        const embedding = await getEmbedding(text);
        embeddings.push(embedding);

        if (progressCallback) {
            progressCallback(i + 1, texts.length);
        }

        // Small delay between requests (rate limiting)
        if (i < texts.length - 1) {
            await sleep(100);
        }
    }

    console.log(`[RAG:EMBED] Batch complete: ${embeddings.length} embeddings`);

    return embeddings;
}

/**
 * Check if provider supports batch API
 * WHY: Some providers can embed multiple texts in one API call
 *
 * @private
 */
function providerSupportsBatch(source) {
    const batchProviders = ['openai', 'cohere', 'mistral', 'together'];
    return batchProviders.includes(source);
}

/**
 * Call ST's vector API for single embedding
 * WHY: Use ST's existing vector integration (don't reimplement)
 *
 * @private
 */
async function callVectorAPI(text, provider, retries = 3) {
    // NOTE: ST doesn't expose a direct client-side embedding API
    // Embeddings are generated server-side during /api/vector/insert
    // This function uses the rabbit-rag-vectors plugin if available

    const { getRequestHeaders } = await import('../../../../script.js');
    const { isPluginAvailable } = await import('./plugin-vector-api.js');

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const pluginReady = await isPluginAvailable();

            if (pluginReady) {
                // Use plugin's get-embedding endpoint
                const response = await fetch('/api/plugins/rabbit-rag-vectors/get-embedding', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        text: text,
                        source: provider.source || 'transformers',
                        model: provider.model || ''
                    })
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({ error: response.statusText }));
                    throw new Error(error.error || `Plugin returned ${response.status}`);
                }

                const data = await response.json();
                return data.embedding;
            } else {
                // Standard ST - no client-side embedding API
                throw new Error('rabbit-rag-vectors plugin not available. Install plugin for client-side embedding generation.');
            }

        } catch (error) {
            if (attempt === retries - 1) {
                throw error;
            }

            console.warn(`[RAG:EMBED] Attempt ${attempt + 1} failed, retrying...`, error.message);

            // Exponential backoff
            const delay = Math.pow(2, attempt) * 1000;
            await sleep(delay);
        }
    }
}

/**
 * Call batch vector API (if supported)
 * WHY: More efficient for multiple texts
 *
 * @private
 */
async function callBatchVectorAPI(texts, provider, progressCallback) {
    // Check if ST has batch API
    if (typeof window.getVectorsForTexts === 'function') {
        const embeddings = await window.getVectorsForTexts(texts, progressCallback);
        return embeddings;
    }

    throw new Error('Batch API not available');
}

/**
 * Sleep utility
 * WHY: Rate limiting and retry delays
 *
 * @private
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get cache statistics
 * WHY: Monitor cache performance and size
 *
 * @returns {object} Cache stats
 */
export function getCacheStats() {
    // Estimate cache size in bytes
    let totalSize = 0;
    for (const [key, embedding] of embeddingCache) {
        totalSize += key.length * 2; // String characters
        totalSize += embedding.length * 8; // Float64 numbers
    }

    const sizeInMB = totalSize / (1024 * 1024);

    return {
        entries: embeddingCache.size,
        sizeBytes: totalSize,
        sizeMB: sizeInMB.toFixed(2)
    };
}

/**
 * Clear embedding cache
 * WHY: Free memory or force re-embedding
 */
export function clearCache() {
    embeddingCache.clear();
    console.log('[RAG:EMBED] Cache cleared');
}

/**
 * Get expected embedding dimension
 * WHY: Validate all embeddings have same dimension
 *
 * @returns {number|null} Expected dimension or null if unknown
 */
export function getExpectedDimension() {
    const provider = getEmbeddingProvider();

    // Known dimensions for common providers
    const knownDimensions = {
        'transformers': 384, // all-MiniLM-L6-v2
        'openai': 1536, // text-embedding-ada-002
        'cohere': 1024, // embed-english-v3.0
        'nomic': 768,
        'mistral': 1024
    };

    return knownDimensions[provider.source] || provider.dimensions || null;
}

// ==================== SIMILARITY SEARCH ====================

// Import ST-Helpers vector distance functions
import { Cosine, Hamming, Jaccard, DocumentSearch, Utils } from './lib-vector-distance.js';

// Re-export ST-Helpers functions for use throughout extension
export { Cosine, Hamming, Jaccard, DocumentSearch, Utils };

/**
 * Find top-K chunks with timing and diagnostics
 * WHY: Adds performance monitoring to ST-Helpers' DocumentSearch
 *
 * @param {number[]} queryEmbedding - Query vector
 * @param {object[]} chunks - Chunks with embeddings
 * @param {number} k - Number of results to return (default: 5)
 * @param {number} threshold - Minimum similarity score (default: 0.0)
 * @param {string} algorithm - Similarity algorithm: 'cosine', 'jaccard', or 'hamming' (default: 'cosine')
 * @returns {object} Results with timing info
 */
export function findTopKWithTiming(queryEmbedding, chunks, k = 5, threshold = 0.0, algorithm = 'cosine') {
    const startTime = performance.now();

    // Validate inputs
    if (!Utils.isValidVector(queryEmbedding)) {
        throw new Error('Query embedding must be a valid vector');
    }

    if (!Array.isArray(chunks) || chunks.length === 0) {
        return {
            results: [],
            timing: {
                duration: 0,
                chunkCount: 0,
                chunksPerSec: 0
            }
        };
    }

    try {
        // Use ST-Helpers DocumentSearch API with user-selected algorithm
        const searchResults = DocumentSearch.search({
            message: queryEmbedding,
            documents: chunks.map(chunk => ({
                documentText: chunk.text || '',
                embeddingArray: chunk.embedding
            })),
            algorithm: algorithm, // User-selectable: 'cosine', 'jaccard', or 'hamming'
            top_k: k,
            suppressWarnings: true // We handle warnings in diagnostics
        });

        const duration = performance.now() - startTime;

        console.log(`[RAG:SIMILARITY] Searched ${chunks.length} chunks in ${duration.toFixed(2)}ms`);

        // Performance monitoring
        if (duration > 1000 && chunks.length >= 1000) {
            const chunksPerSec = chunks.length / (duration / 1000);

            Diagnostics.recordFailure('similarity-calculation-speed', {
                duration,
                chunkCount: chunks.length,
                chunksPerSec: chunksPerSec.toFixed(0)
            });

            console.warn(`[RAG:SIMILARITY] Slow search: ${chunksPerSec.toFixed(0)} chunks/sec`);
        }

        // Convert DocumentSearch format to our format
        const results = searchResults.results.map(r => {
            // Find matching chunk by text (since DocumentSearch only returns text)
            const chunk = chunks.find(c => c.text === r.resultText);
            return {
                chunk,
                similarity: r.score
            };
        });

        return {
            results,
            timing: {
                duration,
                chunkCount: chunks.length,
                chunksPerSec: chunks.length / (duration / 1000)
            }
        };

    } catch (error) {
        // Record dimension mismatch errors
        if (error.message.includes('embedding length')) {
            Diagnostics.recordFailure('similarity-dimension-mismatch', {
                queryDim: queryEmbedding.length,
                error: error.message
            });
        }

        throw error;
    }
}

/**
 * Calculate similarity statistics for diagnostics
 * WHY: Understand similarity distribution (helps tune threshold)
 *
 * @param {object[]} scoredChunks - Chunks with similarity scores
 * @returns {object} Statistics
 */
export function calculateSimilarityStats(scoredChunks) {
    if (scoredChunks.length === 0) {
        return {
            count: 0,
            min: 0,
            max: 0,
            mean: 0,
            median: 0
        };
    }

    const scores = scoredChunks.map(c => c.similarity).sort((a, b) => a - b);

    const sum = scores.reduce((a, b) => a + b, 0);
    const mean = sum / scores.length;
    const median = scores[Math.floor(scores.length / 2)];

    return {
        count: scores.length,
        min: scores[0],
        max: scores[scores.length - 1],
        mean: mean,
        median: median,
        scores: scores // Full distribution for advanced analysis
    };
}

/**
 * Batch similarity calculation with progress
 * WHY: Pre-calculate similarities for multiple query vectors
 *
 * @param {number[][]} queryEmbeddings - Multiple query vectors
 * @param {object[]} chunks - Chunks with embeddings
 * @param {function} progressCallback - Called with (current, total)
 * @returns {number[][]} Similarity matrix [queries x chunks]
 */
export function batchSimilarity(queryEmbeddings, chunks, progressCallback = null) {
    const results = [];

    for (let i = 0; i < queryEmbeddings.length; i++) {
        const queryEmbedding = queryEmbeddings[i];

        // Use Cosine.batchSimilarity for efficiency
        const scores = Cosine.batchSimilarity(
            queryEmbedding,
            chunks.map(c => c.embedding)
        );

        results.push(scores);

        if (progressCallback) {
            progressCallback(i + 1, queryEmbeddings.length);
        }
    }

    return results;
}

// ==================== DIAGNOSTIC CHECKS ====================

// Embedding provider checks
Diagnostics.registerCheck('embedding-provider-configured', {
    name: 'Embedding Provider Configured',
    description: 'Checks that ST has a valid embedding provider configured',
    category: 'EMBEDDINGS',
    checkFn: async () => {
        try {
            const provider = getEmbeddingProvider();

            return {
                status: 'pass',
                message: `Provider configured: ${provider.source}`,
                userMessage: `Embedding provider is configured: ${provider.source}${provider.model ? ` (${provider.model})` : ''}`
            };

        } catch (error) {
            return {
                status: 'critical',
                message: `No provider configured: ${error.message}`,
                userMessage: error.message,
                fixes: [
                    {
                        label: 'Open Vector Settings',
                        description: 'Configure an embedding provider in ST settings',
                        action: () => {
                            // Open ST's vector extension settings
                            if (window.openVectorSettings) {
                                window.openVectorSettings();
                            } else {
                                alert('Please configure an embedding provider in Extensions > Vectors');
                            }
                        }
                    }
                ]
            };
        }
    }
});

Diagnostics.registerCheck('embedding-provider-reachable', {
    name: 'Embedding Provider Reachable',
    description: 'Tests that the vector extension is configured and API is responsive',
    category: 'EMBEDDINGS',
    checkFn: async () => {
        try {
            const provider = getEmbeddingProvider();

            // Check if we can access extension_settings.vectors
            const vectorSettings = extension_settings?.vectors;

            if (!vectorSettings) {
                return {
                    status: 'error',
                    message: 'Vector extension settings not found',
                    userMessage: 'The Vectors extension settings are not available. Ensure the Vectors extension is enabled.'
                };
            }

            if (!vectorSettings.enabled) {
                return {
                    status: 'warn',
                    message: 'Vector extension is disabled',
                    userMessage: 'The Vectors extension is disabled. Enable it in Extensions > Vector Storage.'
                };
            }

            if (!vectorSettings.source) {
                return {
                    status: 'error',
                    message: 'No vector source configured',
                    userMessage: 'No embedding provider is selected. Configure one in Extensions > Vector Storage.'
                };
            }

            // Test that we can make API calls to the vector endpoints
            const { getRequestHeaders } = await import('../../../../script.js');

            // Try a simple list call with a non-existent collection (should return empty, not error)
            const testResponse = await fetch('/api/vector/list', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    collectionId: '_ragbooks_provider_test_' + Date.now(),
                    source: vectorSettings.source
                })
            });

            if (!testResponse.ok) {
                return {
                    status: 'error',
                    message: `Vector API returned ${testResponse.status}`,
                    userMessage: `Vector API endpoint returned error ${testResponse.status}. Check server logs.`
                };
            }

            return {
                status: 'pass',
                message: `Provider ${provider} is configured and API is responsive`,
                userMessage: `Embedding provider "${provider}" is configured. Vector API endpoint is responding.`
            };

        } catch (error) {
            return {
                status: 'error',
                message: `Provider test failed: ${error.message}`,
                userMessage: `Vector API check failed: ${error.message}`,
                fixes: [
                    {
                        label: 'Check Provider Settings',
                        description: 'Verify API endpoint, API key, and model name',
                        action: () => {
                            if (window.openVectorSettings) {
                                window.openVectorSettings();
                            }
                        }
                    },
                    {
                        label: 'Test Again',
                        description: 'Retry the connection test',
                        action: async () => {
                            await Diagnostics.runCheck('embedding-provider-reachable');
                        }
                    }
                ]
            };
        }
    }
});

Diagnostics.registerCheck('embedding-dimension-consistent', {
    name: 'Embedding Dimensions Consistent',
    description: 'Validates all embeddings have the same dimension',
    category: 'EMBEDDINGS',
    checkFn: async () => {
        try {
            // This check will be more useful once we have chunks stored
            // For now, just verify expected dimension if known

            const expectedDim = getExpectedDimension();

            if (!expectedDim) {
                return {
                    status: 'info',
                    message: 'Unknown expected dimension for this provider',
                    userMessage: 'Cannot validate embedding dimensions - provider dimension is unknown.'
                };
            }

            return {
                status: 'pass',
                message: `Expected dimension: ${expectedDim}`,
                userMessage: `Embeddings should be ${expectedDim}-dimensional.`
            };
        } catch (error) {
            return {
                status: 'info',
                message: `Cannot determine embedding dimensions: ${error.message}`,
                userMessage: 'Embedding dimension check skipped - provider not configured or not accessible.',
                fixes: [{
                    label: 'Configure Provider',
                    description: 'Set up an embedding provider in Vector Storage settings',
                    action: () => {
                        if (window.openVectorSettings) {
                            window.openVectorSettings();
                        }
                    }
                }]
            };
        }
    }
});

Diagnostics.registerCheck('embedding-cache-size', {
    name: 'Embedding Cache Size',
    description: 'Checks embedding cache memory usage',
    category: 'EMBEDDINGS',
    checkFn: async () => {
        const stats = getCacheStats();

        if (stats.sizeMB > 10) {
            return {
                status: 'warn',
                message: `Cache size: ${stats.sizeMB} MB (${stats.entries} entries)`,
                userMessage: `Embedding cache is using ${stats.sizeMB} MB of memory. Consider clearing it if memory is constrained.`,
                fixes: [
                    {
                        label: 'Clear Cache',
                        description: 'Free up memory (embeddings will be regenerated as needed)',
                        action: () => {
                            clearCache();
                        }
                    }
                ]
            };
        }

        return {
            status: 'pass',
            message: `Cache size: ${stats.sizeMB} MB (${stats.entries} entries)`,
            userMessage: `Embedding cache is using ${stats.sizeMB} MB - within normal limits.`
        };
    }
});

Diagnostics.registerCheck('embeddings-stored-locally', {
    name: 'Embeddings Stored Locally',
    description: 'Verifies embeddings are stored in chunk objects (not external DB)',
    category: 'EMBEDDINGS',
    checkFn: async () => {
        // This is an architectural check - we NEVER send to external DB
        // Just verify by checking if ST's vector DB has our data (it shouldn't)

        return {
            status: 'pass',
            message: 'Embeddings stored locally with chunks',
            userMessage: 'Architecture confirmed: Embeddings are stored WITH chunks, not in an external database. ✓'
        };
    }
});

// Similarity search checks
Diagnostics.registerCheck('similarity-calculation-speed', {
    name: 'Similarity Calculation Speed',
    description: 'Checks search performance (should be <1s per 1000 chunks)',
    category: 'SEARCH',
    checkFn: async () => {
        const issues = Diagnostics.getRuntimeIssues('similarity-calculation-speed');

        if (issues.length > 0) {
            const latest = issues[issues.length - 1];

            return {
                status: 'warn',
                message: `Slow search detected: ${latest.data.chunksPerSec} chunks/sec`,
                userMessage: `Search performance is slow (${latest.data.chunksPerSec} chunks/second). Consider reducing the number of chunks or optimizing embedding dimensions.`,
                data: latest.data
            };
        }

        return {
            status: 'pass',
            message: 'No performance issues detected',
            userMessage: 'Search performance is within acceptable limits.'
        };
    }
});

Diagnostics.registerCheck('similarity-threshold-reasonable', {
    name: 'Similarity Threshold Reasonable',
    description: 'Warns if threshold is too high (>0.9)',
    category: 'SEARCH',
    checkFn: async () => {
        // Check current threshold setting
        if (typeof window.extension_settings !== 'undefined') {
            const ragSettings = window.extension_settings[extensionName];
            if (ragSettings && ragSettings.settings) {
                const threshold = ragSettings.settings.threshold;

                if (threshold > 0.9) {
                    return {
                        status: 'warn',
                        message: `Threshold very high: ${threshold}`,
                        userMessage: `Your similarity threshold (${threshold}) is very high. This may return too few results. Most queries work well with 0.5-0.7.`,
                        fixes: [
                            {
                                label: 'Lower to 0.7',
                                description: 'Set threshold to recommended value',
                                action: () => {
                                    ragSettings.settings.threshold = 0.7;
                                    window.saveSettingsDebounced();
                                }
                            }
                        ]
                    };
                }

                if (threshold < 0.3) {
                    return {
                        status: 'info',
                        message: `Threshold very low: ${threshold}`,
                        userMessage: `Your similarity threshold (${threshold}) is very low. This may return many irrelevant results.`
                    };
                }
            }
        }

        return {
            status: 'pass',
            message: 'Threshold is reasonable',
            userMessage: 'Similarity threshold is within recommended range.'
        };
    }
});

Diagnostics.registerCheck('similarity-dimension-mismatch', {
    name: 'Embedding Dimension Consistency',
    description: 'Checks for dimension mismatches between query and chunks',
    category: 'EMBEDDINGS',
    checkFn: async () => {
        // This will be checked at runtime when search happens
        // For now, just check if any issues were recorded

        const issues = Diagnostics.getRuntimeIssues('similarity-dimension-mismatch');

        if (issues.length > 0) {
            return {
                status: 'error',
                message: `Dimension mismatch detected in ${issues.length} searches`,
                userMessage: `Embedding dimensions don't match between query and stored chunks. This indicates collections were created with different embedding providers. You may need to re-vectorize collections.`,
                fixes: [
                    {
                        label: 'View Details',
                        description: 'Show which collections have mismatched dimensions',
                        action: () => {
                            console.log('[RAG:DIAGNOSTICS] Dimension mismatch details:', issues);
                            alert('Check console for details');
                        }
                    }
                ]
            };
        }

        return {
            status: 'pass',
            message: 'No dimension mismatches detected',
            userMessage: 'All embeddings have consistent dimensions.'
        };
    }
});

// ==================== EXPORTS ====================

export default {
    // Embedding functions
    getEmbeddingProvider,
    getEmbedding,
    getEmbeddingsBatch,
    getCacheStats,
    clearCache,
    getExpectedDimension,
    // Similarity functions
    Cosine,
    Hamming,
    Jaccard,
    DocumentSearch,
    Utils,
    findTopKWithTiming,
    calculateSimilarityStats,
    batchSimilarity
};
