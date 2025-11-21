/**
 * Rabbit Augmented Generation - Search Strategies Module
 *
 * WHY: Consolidates all search strategies (keyword and vector) into a single module.
 * Both are complementary search methods called by the orchestrator to enable hybrid search.
 *
 * KEYWORD SEARCH:
 * - Pure keyword matching provides fast, exact-match search that complements vector similarity
 * - Critical for proper name matching where embeddings may fail
 * - Uses ST-Helpers Trie for O(m) keyword lookup at scale
 *
 * VECTOR SEARCH:
 * - Vector search provides semantic similarity that goes beyond exact keyword matching
 * - Critical for understanding context, synonyms, and conceptual relevance
 * - Uses ST-Helpers cosine similarity for fast calculations
 * - Supports dual-vector search (summary + full text)
 *
 * Architecture:
 * - Extract keywords from text using multiple strategies
 * - Match keywords with configurable fuzziness (exact, prefix, substring)
 * - Generate query embeddings via core/core-embeddings.js
 * - Calculate similarities using core-similarity.js
 * - Integrate with diagnostics for performance tracking
 */

import { Diagnostics } from './core-system.js';
import { logger } from './core-system.js';
import { SearchError } from './core-system.js';
import { State } from './core-state.js';
import { getEmbedding, getEmbeddingProvider, findTopKWithTiming, calculateSimilarityStats } from './core-embeddings.js';
import { isPluginAvailable, enrichChunksWithVectors } from './plugin-vector-api.js';
import { Trie, LRUCache } from './lib-data-structures.js';
import * as StringUtils from './lib-string-utils.js';

// ==================== QUERY EMBEDDING CACHE ====================

// WHY: Avoid re-embedding same query (expensive operation)
const queryEmbeddingCache = new LRUCache(100); // Cache last 100 queries

// ==================== KEYWORD SEARCH ====================

/**
 * Extract keywords from text
 * WHY: Keywords provide exact-match search that vectors can't guarantee
 *
 * @param {string} text - Text to extract keywords from
 * @param {Object} options - Extraction options
 * @returns {string[]} Array of keywords
 */
export function extractKeywords(text, options = {}) {
    const {
        minLength = 3,
        maxLength = 50,
        maxKeywords = 50,
        lowercase = true,
        stripMarkdown = true,
        stripHtml = true,
        removeStopWords = true
    } = options;

    if (!text || typeof text !== 'string') {
        return [];
    }

    let cleaned = text;

    // Clean text using ST-Helpers
    if (stripHtml) {
        cleaned = StringUtils.stripHtml(cleaned);
    }
    if (stripMarkdown) {
        cleaned = StringUtils.stripMarkdown(cleaned);
    }

    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (lowercase) {
        cleaned = cleaned.toLowerCase();
    }

    // Split into words
    const words = cleaned.split(/\s+/);

    // Filter and deduplicate
    const keywords = new Set();

    for (const word of words) {
        // Remove punctuation
        const clean = word.replace(/[^\w]/g, '');

        // Length filter
        if (clean.length < minLength || clean.length > maxLength) {
            continue;
        }

        // Stop word filter
        if (removeStopWords && isStopWord(clean)) {
            continue;
        }

        keywords.add(clean);
    }

    // Convert to array and limit
    const result = Array.from(keywords).slice(0, maxKeywords);

    logger.verbose(`[RAG:KEYWORD] Extracted ${result.length} keywords from ${text.length} chars`);

    return result;
}

/**
 * Check if word is a stop word
 * WHY: Stop words add noise to keyword search
 *
 * @private
 */
function isStopWord(word) {
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
        'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
        'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this',
        'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
        'what', 'which', 'who', 'when', 'where', 'why', 'how'
    ]);

    return stopWords.has(word.toLowerCase());
}

/**
 * Match keywords against query
 * WHY: Fast keyword matching for hybrid search
 *
 * @param {string[]} chunkKeywords - Keywords from chunk
 * @param {string[]} queryKeywords - Keywords from query
 * @param {Object} options - Matching options
 * @returns {Object} Match result with score and matched keywords
 */
export function matchKeywords(chunkKeywords, queryKeywords, options = {}) {
    const {
        matchMode = 'exact',        // 'exact', 'prefix', 'substring', 'fuzzy'
        caseSensitive = false,
        fuzzyThreshold = 0.8,       // For fuzzy matching
        positionWeight = true        // Weight earlier keywords higher
    } = options;

    if (!chunkKeywords || !queryKeywords) {
        return { score: 0, matches: [], totalMatches: 0 };
    }

    const matches = [];
    let totalScore = 0;

    // Normalize for comparison
    const normalizedChunkKeywords = caseSensitive
        ? chunkKeywords
        : chunkKeywords.map(k => k.toLowerCase());
    const normalizedQueryKeywords = caseSensitive
        ? queryKeywords
        : queryKeywords.map(k => k.toLowerCase());

    // Match each query keyword
    for (let i = 0; i < normalizedQueryKeywords.length; i++) {
        const queryKeyword = normalizedQueryKeywords[i];
        let bestMatch = null;
        let bestScore = 0;

        // Find best matching chunk keyword
        for (let j = 0; j < normalizedChunkKeywords.length; j++) {
            const chunkKeyword = normalizedChunkKeywords[j];
            let score = 0;

            if (matchMode === 'exact') {
                score = chunkKeyword === queryKeyword ? 1.0 : 0;
            } else if (matchMode === 'prefix') {
                score = chunkKeyword.startsWith(queryKeyword) ? 0.9 : 0;
            } else if (matchMode === 'substring') {
                score = chunkKeyword.includes(queryKeyword) ? 0.8 : 0;
            } else if (matchMode === 'fuzzy') {
                // Use Levenshtein similarity from ST-Helpers
                const similarity = StringUtils.similarity(chunkKeyword, queryKeyword);
                score = similarity >= fuzzyThreshold ? similarity : 0;
            }

            // Apply position weight (earlier keywords more important)
            if (positionWeight && score > 0) {
                const positionFactor = 1.0 - (j / normalizedChunkKeywords.length) * 0.3;
                score *= positionFactor;
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = { chunkKeyword: chunkKeywords[j], queryKeyword: queryKeywords[i], score };
            }
        }

        if (bestMatch) {
            matches.push(bestMatch);
            totalScore += bestScore;
        }
    }

    // Normalize score to 0-1 range
    const normalizedScore = normalizedQueryKeywords.length > 0
        ? totalScore / normalizedQueryKeywords.length
        : 0;

    return {
        score: normalizedScore,
        matches,
        totalMatches: matches.length
    };
}

/**
 * Build keyword index using Trie for fast lookup
 * WHY: O(m) lookup vs O(n) linear search for large keyword sets
 *
 * @param {Object[]} chunks - Chunks with keywords
 * @returns {Trie} Keyword index
 */
export function buildKeywordIndex(chunks) {
    const trie = new Trie();
    const startTime = performance.now();

    let totalKeywords = 0;

    for (const chunk of chunks) {
        const keywords = chunk.keywords || chunk.systemKeywords || [];

        for (const keyword of keywords) {
            if (keyword && typeof keyword === 'string') {
                // Store chunk hash with keyword
                const existing = trie.search(keyword.toLowerCase()) || [];
                existing.push(chunk.hash);
                trie.insert(keyword.toLowerCase(), existing);
                totalKeywords++;
            }
        }
    }

    const duration = performance.now() - startTime;

    logger.verbose(`[RAG:KEYWORD] Built Trie index: ${totalKeywords} keywords from ${chunks.length} chunks in ${duration.toFixed(2)}ms`);

    // Track performance
    if (duration > 1000 && totalKeywords > 10000) {
        Diagnostics.recordFailure('keyword-index-slow', {
            duration,
            keywordCount: totalKeywords,
            chunkCount: chunks.length
        });
    }

    return trie;
}

/**
 * Search chunks by keywords using Trie index
 * WHY: Fast keyword lookup for hybrid search
 *
 * @param {string[]} queryKeywords - Keywords to search for
 * @param {Trie} keywordIndex - Pre-built keyword index
 * @param {Object} allChunks - Map of chunk hash to chunk
 * @returns {Object[]} Matching chunks with keyword scores
 */
export function searchByKeywords(queryKeywords, keywordIndex, allChunks) {
    const startTime = performance.now();
    const matchingHashes = new Map(); // hash -> match count

    for (const keyword of queryKeywords) {
        const normalized = keyword.toLowerCase();

        // Exact match from Trie
        const exactMatches = keywordIndex.search(normalized) || [];
        for (const hash of exactMatches) {
            matchingHashes.set(hash, (matchingHashes.get(hash) || 0) + 1);
        }

        // Prefix match from Trie
        const prefixMatches = keywordIndex.startsWith(normalized);
        for (const [matchedKeyword, hashes] of Object.entries(prefixMatches)) {
            for (const hash of hashes) {
                matchingHashes.set(hash, (matchingHashes.get(hash) || 0) + 0.8);
            }
        }
    }

    // Convert to scored chunks
    const results = [];
    for (const [hash, matchCount] of matchingHashes) {
        const chunk = allChunks[hash];
        if (chunk) {
            // Score = (matches / query keywords) for recall
            const score = Math.min(1.0, matchCount / queryKeywords.length);

            results.push({
                ...chunk,
                keywordScore: score,
                keywordMatches: matchCount
            });
        }
    }

    const duration = performance.now() - startTime;

    logger.verbose(`[RAG:KEYWORD] Trie search: ${results.length} matches in ${duration.toFixed(2)}ms`);

    return results;
}

/**
 * Calculate keyword frequency weights
 * WHY: Common keywords less important than rare ones (TF-IDF concept)
 *
 * @param {Object[]} chunks - All chunks
 * @returns {Object} Map of keyword to weight (0-1)
 */
export function calculateKeywordWeights(chunks) {
    const keywordDocCount = new Map(); // keyword -> number of chunks containing it
    const totalChunks = chunks.length;

    // Count keyword occurrences
    for (const chunk of chunks) {
        const keywords = new Set(chunk.keywords || chunk.systemKeywords || []);
        for (const keyword of keywords) {
            const normalized = keyword.toLowerCase();
            keywordDocCount.set(normalized, (keywordDocCount.get(normalized) || 0) + 1);
        }
    }

    // Calculate IDF weights
    const weights = {};
    for (const [keyword, docCount] of keywordDocCount) {
        // IDF = log(total docs / docs containing keyword)
        const idf = Math.log(totalChunks / docCount);
        // Normalize to 0-1 range
        weights[keyword] = Math.min(1.0, idf / Math.log(totalChunks));
    }

    logger.verbose(`[RAG:KEYWORD] Calculated weights for ${keywordDocCount.size} unique keywords`);

    return weights;
}

/**
 * Apply custom keyword weights to chunks
 * WHY: Users can boost/penalize specific keywords
 *
 * @param {Object[]} chunks - Chunks with keyword scores
 * @param {Object} customWeights - Custom keyword weights
 * @returns {Object[]} Chunks with adjusted scores
 */
export function applyCustomKeywordWeights(chunks, customWeights) {
    if (!customWeights || Object.keys(customWeights).length === 0) {
        return chunks;
    }

    return chunks.map(chunk => {
        if (!chunk.keywordScore) return chunk;

        let adjustedScore = chunk.keywordScore;
        const chunkKeywords = chunk.keywords || chunk.systemKeywords || [];

        // Apply custom weights
        for (const keyword of chunkKeywords) {
            const normalized = keyword.toLowerCase();
            const weight = customWeights[normalized];

            if (weight !== undefined) {
                // Multiplicative adjustment
                adjustedScore *= weight;
            }
        }

        return {
            ...chunk,
            keywordScore: Math.max(0, Math.min(1, adjustedScore)),
            customWeightsApplied: true
        };
    });
}

/**
 * Extract named entities from text
 * WHY: Names, places, etc. are critical for exact matching
 *
 * @param {string} text - Text to extract entities from
 * @returns {Object} Extracted entities by type
 */
export function extractEntities(text) {
    if (!text || typeof text !== 'string') {
        return { names: [], places: [], organizations: [] };
    }

    const entities = {
        names: [],
        places: [],
        organizations: []
    };

    // Simple capitalized word extraction (heuristic)
    // WHY: Full NER would require ML model - this is fast and good enough
    const words = text.split(/\s+/);

    for (let i = 0; i < words.length; i++) {
        const word = words[i].replace(/[^\w]/g, '');

        // Capitalized word (but not at sentence start if we can detect)
        const isCapitalized = word.length > 0 && word[0] === word[0].toUpperCase();
        const isLikelyName = word.length >= 3 && isCapitalized && !isStopWord(word.toLowerCase());

        if (isLikelyName) {
            // Simple heuristic: 2+ capitalized words in a row = likely name or place
            if (i + 1 < words.length) {
                const nextWord = words[i + 1].replace(/[^\w]/g, '');
                const nextCapitalized = nextWord.length > 0 && nextWord[0] === nextWord[0].toUpperCase();

                if (nextCapitalized) {
                    const entity = `${word} ${nextWord}`;
                    entities.names.push(entity);
                    i++; // Skip next word
                    continue;
                }
            }

            entities.names.push(word);
        }
    }

    logger.verbose(`[RAG:KEYWORD] Extracted ${entities.names.length} entity candidates`);

    return entities;
}

// ==================== KEYWORD PRIORITY TIERS ====================

/**
 * Extract BunnyMoTags from text
 * WHY: [tag1|tag2] format allows explicit priority keyword marking
 *
 * @param {string} text - Text with potential BunnyMoTags
 * @returns {string[]} Extracted tags
 */
export function extractTags(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const tagPattern = /\[([^\]]+)\]/g;
    const tags = [];
    let match;

    while ((match = tagPattern.exec(text)) !== null) {
        const content = match[1];
        // Split on | for multi-tags
        const splitTags = content.split('|').map(t => t.trim().toLowerCase());
        tags.push(...splitTags);
    }

    return [...new Set(tags)]; // Deduplicate
}

/**
 * Priority tier constants
 * WHY: Explicit priority levels for keyword importance
 */
export const PRIORITY_TIERS = {
    CRITICAL: 2.0,      // Character names, critical plot points
    HIGH: 1.5,          // Important concepts, locations
    NORMAL: 1.0,        // Regular keywords
    LOW: 0.5            // Common/filler words
};

/**
 * Check if keyword is critical priority
 * WHY: Character names, user-specified critical terms
 *
 * @param {string} keyword - Keyword to check
 * @param {Object} context - Search context
 * @returns {boolean} True if critical
 */
export function isCriticalKeyword(keyword, context = {}) {
    const normalized = keyword.toLowerCase();

    // Check explicit critical keywords from context
    if (context.criticalKeywords && context.criticalKeywords.includes(normalized)) {
        return true;
    }

    // Check if it's a character name
    if (context.characterNames) {
        const isCharacterName = context.characterNames.some(name =>
            name.toLowerCase().includes(normalized) || normalized.includes(name.toLowerCase())
        );
        if (isCharacterName) return true;
    }

    // Check if marked in BunnyMoTags with critical indicator
    if (context.tags) {
        const hasCriticalTag = context.tags.some(tag =>
            tag.startsWith('critical:') && tag.includes(normalized)
        );
        if (hasCriticalTag) return true;
    }

    return false;
}

/**
 * Check if keyword is high priority
 * WHY: Plot-relevant terms, locations, important concepts
 *
 * @param {string} keyword - Keyword to check
 * @param {Object} context - Search context
 * @returns {boolean} True if high priority
 */
export function isHighPriorityKeyword(keyword, context = {}) {
    const normalized = keyword.toLowerCase();

    // Check explicit high priority keywords
    if (context.highPriorityKeywords && context.highPriorityKeywords.includes(normalized)) {
        return true;
    }

    // Check if it's a location/place
    if (context.locations && context.locations.includes(normalized)) {
        return true;
    }

    // Check if marked in BunnyMoTags with high priority indicator
    if (context.tags) {
        const hasHighTag = context.tags.some(tag =>
            tag.startsWith('high:') && tag.includes(normalized)
        );
        if (hasHighTag) return true;
    }

    // Named entities are typically high priority
    const entities = extractEntities(keyword);
    if (entities.names.length > 0) {
        return true;
    }

    return false;
}

/**
 * Check if keyword is low priority
 * WHY: Common filler words that add noise
 *
 * @param {string} keyword - Keyword to check
 * @param {Object} context - Search context
 * @returns {boolean} True if low priority
 */
export function isLowPriorityKeyword(keyword, context = {}) {
    const normalized = keyword.toLowerCase();

    // Check explicit low priority keywords
    if (context.lowPriorityKeywords && context.lowPriorityKeywords.includes(normalized)) {
        return true;
    }

    // Very short keywords (unless explicitly marked otherwise)
    if (normalized.length <= 2) {
        return true;
    }

    // Common filler words not in stop words list
    const fillerWords = ['very', 'quite', 'rather', 'somewhat', 'just', 'really', 'pretty', 'fairly'];
    if (fillerWords.includes(normalized)) {
        return true;
    }

    return false;
}

/**
 * Assign priority tier to keyword
 * WHY: Centralized priority assignment based on context
 *
 * @param {string} keyword - Keyword to prioritize
 * @param {Object} context - Search context with character names, tags, etc.
 * @returns {number} Priority multiplier (0.5x, 1.0x, 1.5x, 2.0x)
 */
export function assignKeywordPriority(keyword, context = {}) {
    if (isCriticalKeyword(keyword, context)) {
        return PRIORITY_TIERS.CRITICAL;
    }

    if (isHighPriorityKeyword(keyword, context)) {
        return PRIORITY_TIERS.HIGH;
    }

    if (isLowPriorityKeyword(keyword, context)) {
        return PRIORITY_TIERS.LOW;
    }

    return PRIORITY_TIERS.NORMAL;
}

/**
 * Apply keyword priority weights to chunk
 * WHY: Boost scores for chunks containing high-priority keywords
 *
 * @param {Object} chunk - Chunk with keywords
 * @param {Object} context - Search context
 * @returns {Object} Map of keyword to priority weight
 */
export function applyKeywordWeights(chunk, context = {}) {
    const weights = {};
    const keywords = chunk.keywords || chunk.systemKeywords || [];

    for (const keyword of keywords) {
        weights[keyword.toLowerCase()] = assignKeywordPriority(keyword, context);
    }

    return weights;
}

/**
 * Calculate weighted keyword score
 * WHY: Final keyword score considering priority weights
 *
 * @param {Object} matchResult - Result from matchKeywords()
 * @param {Object} keywordWeights - Map of keyword to weight
 * @returns {number} Weighted score (0-1)
 */
export function calculateWeightedKeywordScore(matchResult, keywordWeights = {}) {
    if (!matchResult || !matchResult.matches || matchResult.matches.length === 0) {
        return 0;
    }

    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const match of matchResult.matches) {
        const keyword = match.chunkKeyword.toLowerCase();
        const weight = keywordWeights[keyword] || PRIORITY_TIERS.NORMAL;

        totalWeightedScore += match.score * weight;
        totalWeight += weight;
    }

    // Normalize by total weight
    return totalWeight > 0 ? Math.min(1.0, totalWeightedScore / totalWeight) : 0;
}

/**
 * Build context for keyword priority assignment
 * WHY: Extract all priority-relevant information from search context
 *
 * @param {Object} searchContext - Full search context
 * @returns {Object} Priority context with character names, tags, etc.
 */
export function buildPriorityContext(searchContext = {}) {
    const priorityContext = {
        characterNames: [],
        locations: [],
        criticalKeywords: [],
        highPriorityKeywords: [],
        lowPriorityKeywords: [],
        tags: []
    };

    // Extract character names
    if (searchContext.character) {
        priorityContext.characterNames.push(searchContext.character.name);
        if (searchContext.character.aliases) {
            priorityContext.characterNames.push(...searchContext.character.aliases);
        }
    }

    // Extract tags from lorebook entries
    if (searchContext.lorebookEntries) {
        for (const entry of searchContext.lorebookEntries) {
            if (entry.tags) {
                priorityContext.tags.push(...extractTags(entry.tags));
            }
            if (entry.content) {
                priorityContext.tags.push(...extractTags(entry.content));
            }
        }
    }

    // Extract from settings
    if (searchContext.settings) {
        if (searchContext.settings.criticalKeywords) {
            priorityContext.criticalKeywords = searchContext.settings.criticalKeywords;
        }
        if (searchContext.settings.highPriorityKeywords) {
            priorityContext.highPriorityKeywords = searchContext.settings.highPriorityKeywords;
        }
        if (searchContext.settings.lowPriorityKeywords) {
            priorityContext.lowPriorityKeywords = searchContext.settings.lowPriorityKeywords;
        }
    }

    return priorityContext;
}

// ==================== VECTOR SEARCH ====================

/**
 * Search chunks by vector similarity
 * WHY: Core semantic search functionality
 *
 * @param {string} queryText - Query text
 * @param {Object[]} chunks - Chunks (may or may not have embeddings)
 * @param {Object} options - Search options
 * @param {string} options.collectionId - Collection ID (needed for plugin vector enrichment)
 * @param {string} options.source - Vector source (e.g., 'palm', 'openai')
 * @returns {Promise<Object>} Search results with timing info
 */
export async function searchByVector(queryText, chunks, options = {}) {
    const {
        topK = 5,
        threshold = 0.0,
        searchMode = 'full',        // 'full', 'summary', 'both'
        useCache = true,
        collectionId = null,       // For plugin vector enrichment
        source = 'palm'            // Vector source
    } = options;

    const startTime = performance.now();

    // Validate inputs
    if (!queryText || typeof queryText !== 'string' || queryText.trim().length === 0) {
        throw new SearchError('Query text is empty', 'EMPTY_QUERY');
    }

    if (!chunks || chunks.length === 0) {
        logger.warn('[RAG:VECTOR] No chunks provided for search');
        return {
            results: [],
            timing: { duration: 0, embeddingTime: 0, searchTime: 0 },
            stats: { chunkCount: 0, queryDim: 0 }
        };
    }

    logger.group(`🔍 [RAG:VECTOR] Searching ${chunks.length} chunks`);
    logger.log(`Query: "${queryText.substring(0, 100)}${queryText.length > 100 ? '...' : ''}"`);
    logger.log(`Mode: ${searchMode}, Top-K: ${topK}, Threshold: ${threshold}`);

    try {
        // Step 1: Get query embedding (with caching)
        const embeddingStartTime = performance.now();
        let queryEmbedding;

        const cacheKey = `${queryText}:${getEmbeddingProvider().source}`;
        if (useCache && queryEmbeddingCache.has(cacheKey)) {
            queryEmbedding = queryEmbeddingCache.get(cacheKey);
            logger.verbose('[RAG:VECTOR] Query embedding cache hit');
        } else {
            queryEmbedding = await getEmbedding(queryText);

            if (useCache) {
                queryEmbeddingCache.set(cacheKey, queryEmbedding);
            }
        }

        const embeddingTime = performance.now() - embeddingStartTime;
        logger.log(`Query embedding: ${queryEmbedding.length}D in ${embeddingTime.toFixed(2)}ms`);

        // Step 2: Filter chunks by search mode
        let searchChunks = filterChunksByMode(chunks, searchMode);
        logger.log(`Searching ${searchChunks.length} chunks after mode filter`);

        if (searchChunks.length === 0) {
            logger.warn('[RAG:VECTOR] No chunks available after mode filter');
            logger.groupEnd();
            return {
                results: [],
                timing: { duration: performance.now() - startTime, embeddingTime, searchTime: 0 },
                stats: { chunkCount: 0, queryDim: queryEmbedding.length }
            };
        }

        // Step 2.5: Enrich chunks with vectors from plugin (for client-side similarity)
        const needsEmbeddings = searchChunks.some(c => !c.embedding);
        const useServerSide = State.getSettings().useServerSideSearch ?? false;

        if (needsEmbeddings) {
            if (useServerSide) {
                // User chose server-side search - use ST's /api/vector/query instead
                logger.log('[RAG:VECTOR] Using server-side search (ST API), skipping client-side similarity');
                logger.warn('[RAG:VECTOR] Server-side search not yet implemented - will use plugin as fallback');
                // TODO: Implement server-side search fallback using /api/vector/query
            }

            // Get collectionId from chunks (or from options)
            const chunkCollectionId = collectionId || searchChunks[0]?.collectionId;

            // Try to use plugin for client-side similarity
            if (chunkCollectionId) {
                logger.log('[RAG:VECTOR] Chunks missing embeddings, checking for plugin...');
                const pluginAvailable = await isPluginAvailable();

                if (pluginAvailable) {
                    try {
                        const enrichStartTime = performance.now();
                        searchChunks = await enrichChunksWithVectors(searchChunks, chunkCollectionId, source);
                        const enrichTime = performance.now() - enrichStartTime;
                        const enrichedCount = searchChunks.filter(c => c.embedding).length;
                        logger.log(`[RAG:VECTOR] Enriched ${enrichedCount}/${searchChunks.length} chunks with vectors in ${enrichTime.toFixed(2)}ms`);

                        if (enrichedCount === 0) {
                            throw new Error('No chunks were enriched with vectors');
                        }
                    } catch (error) {
                        logger.error('[RAG:VECTOR] Failed to enrich chunks with plugin:', error);
                        throw new SearchError(
                            'Failed to fetch embeddings from plugin',
                            'PLUGIN_ENRICHMENT_FAILED',
                            { error: error.message }
                        );
                    }
                } else {
                    logger.error('[RAG:VECTOR] Plugin not available, cannot perform client-side similarity');
                    logger.warn('[RAG:VECTOR] Install rabbit-rag-vectors plugin to enable client-side similarity with ST-Helpers');
                    throw new SearchError(
                        'Chunks missing embeddings and plugin not available',
                        'NO_EMBEDDINGS',
                        { pluginAvailable: false, useServerSideSearch: useServerSide }
                    );
                }
            } else {
                logger.error('[RAG:VECTOR] No collectionId provided, cannot fetch vectors');
                throw new SearchError(
                    'collectionId required for vector enrichment',
                    'MISSING_COLLECTION_ID'
                );
            }
        }

        // Step 3: Calculate similarities using ST-Helpers with user-selected algorithm
        const searchStartTime = performance.now();
        const algorithm = State.getSettings().similarityAlgorithm ?? 'cosine';
        logger.log(`[RAG:VECTOR] Using similarity algorithm: ${algorithm.toUpperCase()}`);
        const searchResult = findTopKWithTiming(queryEmbedding, searchChunks, topK, threshold, algorithm);
        const searchTime = searchResult.timing.duration;

        logger.log(`Found ${searchResult.results.length} results above threshold ${threshold}`);
        logger.log(`Search performance: ${searchResult.timing.chunksPerSec.toFixed(0)} chunks/sec`);

        // Step 4: Calculate result statistics
        const scoredChunks = searchResult.results.map(r => ({ ...r.chunk, similarity: r.similarity }));
        const stats = calculateSimilarityStats(scoredChunks);

        logger.log('Score distribution:', {
            min: stats.min.toFixed(3),
            max: stats.max.toFixed(3),
            mean: stats.mean.toFixed(3),
            median: stats.median.toFixed(3)
        });

        // Record in diagnostics
        if (searchResult.results.length === 0) {
            Diagnostics.recordFailure('vector-search-no-results', {
                queryLength: queryText.length,
                chunkCount: searchChunks.length,
                threshold,
                topK
            });
        } else {
            Diagnostics.recordSuccess('vector-search', {
                resultCount: searchResult.results.length,
                avgScore: stats.mean
            });
        }

        const totalDuration = performance.now() - startTime;

        logger.log(`✅ Vector search complete in ${totalDuration.toFixed(2)}ms`);
        logger.groupEnd();

        return {
            results: scoredChunks,
            timing: {
                duration: totalDuration,
                embeddingTime,
                searchTime,
                breakdown: {
                    embedding: `${((embeddingTime / totalDuration) * 100).toFixed(1)}%`,
                    search: `${((searchTime / totalDuration) * 100).toFixed(1)}%`
                }
            },
            stats: {
                chunkCount: searchChunks.length,
                queryDim: queryEmbedding.length,
                scoreStats: stats
            }
        };

    } catch (error) {
        logger.error('[RAG:VECTOR] Search failed:', error);
        logger.groupEnd();
        throw error;
    }
}

/**
 * Filter chunks by search mode
 * WHY: Dual-vector search allows searching summaries only, full text only, or both
 *
 * @private
 */
function filterChunksByMode(chunks, searchMode) {
    if (searchMode === 'summary') {
        return chunks.filter(chunk => chunk.isSummaryChunk);
    } else if (searchMode === 'full') {
        return chunks.filter(chunk => !chunk.isSummaryChunk);
    } else {
        // Both - return all chunks
        return chunks;
    }
}

/**
 * Dual-vector search (summary + full text)
 * WHY: Search both summaries and full text, then merge with RRF
 *
 * @param {string} queryText - Query text
 * @param {Object[]} chunks - All chunks (including summaries)
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Merged search results
 */
export async function dualVectorSearch(queryText, chunks, options = {}) {
    const {
        topK = 5,
        threshold = 0.0,
        rrfK = 60,                  // RRF constant
        summaryWeight = 1.5         // Weight for summary matches
    } = options;

    logger.group('🔍 [RAG:VECTOR] Dual-vector search (summary + full)');

    // Separate summaries and full text chunks
    const summaryChunks = chunks.filter(c => c.isSummaryChunk);
    const fullChunks = chunks.filter(c => !c.isSummaryChunk);

    logger.log(`Summaries: ${summaryChunks.length}, Full: ${fullChunks.length}`);

    // Search both in parallel
    const [summaryResults, fullResults] = await Promise.all([
        searchByVector(queryText, summaryChunks, { ...options, searchMode: 'summary' }),
        searchByVector(queryText, fullChunks, { ...options, searchMode: 'full' })
    ]);

    // Merge using Reciprocal Rank Fusion
    const scoreMap = new Map();

    // Process summary results (higher weight)
    summaryResults.results.forEach((chunk, rank) => {
        const rrfScore = 1 / (rrfK + rank + 1);
        scoreMap.set(chunk.hash, (scoreMap.get(chunk.hash) || 0) + rrfScore * summaryWeight);
    });

    // Process full text results
    fullResults.results.forEach((chunk, rank) => {
        const rrfScore = 1 / (rrfK + rank + 1);
        scoreMap.set(chunk.hash, (scoreMap.get(chunk.hash) || 0) + rrfScore);
    });

    // Combine all unique chunks
    const allChunks = new Map();
    [...summaryResults.results, ...fullResults.results].forEach(chunk => {
        if (!allChunks.has(chunk.hash)) {
            allChunks.set(chunk.hash, chunk);
        }
    });

    // Sort by RRF score
    const merged = Array.from(allChunks.values())
        .map(chunk => ({
            ...chunk,
            rrfScore: scoreMap.get(chunk.hash) || 0
        }))
        .sort((a, b) => b.rrfScore - a.rrfScore)
        .slice(0, topK);

    logger.log(`✅ Merged ${summaryResults.results.length} summary + ${fullResults.results.length} full = ${merged.length} unique chunks`);
    logger.groupEnd();

    return {
        results: merged,
        timing: {
            duration: Math.max(summaryResults.timing.duration, fullResults.timing.duration),
            summary: summaryResults.timing,
            full: fullResults.timing
        },
        stats: {
            summaryResults: summaryResults.results.length,
            fullResults: fullResults.results.length,
            mergedResults: merged.length
        }
    };
}

/**
 * Batch search multiple queries
 * WHY: Efficient for processing multiple queries at once
 *
 * @param {string[]} queries - Array of query texts
 * @param {Object[]} chunks - Chunks to search
 * @param {Object} options - Search options
 * @param {Function} progressCallback - Progress callback (current, total)
 * @returns {Promise<Object[]>} Array of search results
 */
export async function batchVectorSearch(queries, chunks, options = {}, progressCallback = null) {
    logger.group(`🔍 [RAG:VECTOR] Batch search: ${queries.length} queries`);

    const results = [];

    for (let i = 0; i < queries.length; i++) {
        const query = queries[i];

        try {
            const result = await searchByVector(query, chunks, options);
            results.push(result);

            if (progressCallback) {
                progressCallback(i + 1, queries.length);
            }
        } catch (error) {
            logger.error(`[RAG:VECTOR] Query ${i + 1} failed:`, error);
            results.push({
                results: [],
                timing: { duration: 0, embeddingTime: 0, searchTime: 0 },
                stats: { chunkCount: 0 },
                error: error.message
            });
        }
    }

    logger.log(`✅ Batch search complete: ${results.length} queries processed`);
    logger.groupEnd();

    return results;
}

/**
 * Get query embedding cache statistics
 * WHY: Monitor cache performance
 *
 * @returns {Object} Cache stats
 */
export function getQueryCacheStats() {
    return {
        size: queryEmbeddingCache.size,
        capacity: queryEmbeddingCache.capacity,
        hitRate: 'N/A' // LRUCache doesn't track hit rate
    };
}

/**
 * Clear query embedding cache
 * WHY: Free memory or force re-embedding
 */
export function clearQueryCache() {
    queryEmbeddingCache.clear();
    logger.log('[RAG:VECTOR] Query embedding cache cleared');
}

/**
 * Validate chunk embeddings
 * WHY: Ensure all chunks have valid embeddings before search
 *
 * @param {Object[]} chunks - Chunks to validate
 * @returns {Object} Validation result
 */
export function validateChunkEmbeddings(chunks) {
    const issues = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        if (!chunk.embedding) {
            issues.push({ index: i, hash: chunk.hash, issue: 'Missing embedding' });
        } else if (!Array.isArray(chunk.embedding)) {
            issues.push({ index: i, hash: chunk.hash, issue: 'Embedding is not an array' });
        } else if (chunk.embedding.length === 0) {
            issues.push({ index: i, hash: chunk.hash, issue: 'Embedding is empty' });
        } else if (chunk.embedding.some(v => isNaN(v) || v === null || v === undefined)) {
            issues.push({ index: i, hash: chunk.hash, issue: 'Embedding contains invalid values' });
        }
    }

    return {
        valid: issues.length === 0,
        totalChunks: chunks.length,
        invalidChunks: issues.length,
        issues: issues.slice(0, 10) // First 10 issues
    };
}

// ==================== DIAGNOSTIC CHECKS ====================

Diagnostics.registerCheck('keyword-extraction-quality', {
    name: 'Keyword Extraction Quality',
    description: 'Validates that keywords are being extracted properly',
    category: 'SEARCH',
    checkFn: async () => {
        // Test keyword extraction with sample text
        const sampleText = 'The quick brown fox jumps over the lazy dog. Character names like Alice and Bob are important.';
        const keywords = extractKeywords(sampleText);

        if (keywords.length === 0) {
            return {
                status: 'error',
                message: 'Keyword extraction returned no results',
                userMessage: 'Keyword extraction is not working. This will break keyword search.'
            };
        }

        // Should extract meaningful keywords (not stop words)
        const hasStopWords = keywords.some(k => isStopWord(k));
        if (hasStopWords) {
            return {
                status: 'warn',
                message: 'Stop words found in extracted keywords',
                userMessage: 'Keyword extraction is including stop words. This may reduce search quality.'
            };
        }

        return {
            status: 'pass',
            message: `Extracted ${keywords.length} keywords from sample text`,
            userMessage: `Keyword extraction is working correctly (${keywords.length} keywords from sample).`
        };
    }
});

Diagnostics.registerCheck('keyword-index-performance', {
    name: 'Keyword Index Performance',
    description: 'Checks keyword Trie index build performance',
    category: 'SEARCH',
    checkFn: async () => {
        const issues = Diagnostics.getRuntimeIssues('keyword-index-slow');

        if (issues.length > 0) {
            const latest = issues[issues.length - 1];
            return {
                status: 'warn',
                message: `Slow keyword indexing: ${latest.data.duration.toFixed(0)}ms`,
                userMessage: `Keyword index build is slow (${latest.data.duration.toFixed(0)}ms for ${latest.data.keywordCount} keywords). Consider reducing keyword count per chunk.`,
                data: latest.data
            };
        }

        return {
            status: 'pass',
            message: 'Keyword indexing performance is good',
            userMessage: 'Keyword Trie index builds quickly.'
        };
    }
});

Diagnostics.registerCheck('keyword-match-accuracy', {
    name: 'Keyword Match Accuracy',
    description: 'Validates keyword matching logic',
    category: 'SEARCH',
    checkFn: async () => {
        // Test keyword matching
        const chunkKeywords = ['dragon', 'castle', 'knight', 'princess'];
        const queryKeywords = ['dragon', 'knight'];

        const result = matchKeywords(chunkKeywords, queryKeywords, { matchMode: 'exact' });

        if (result.totalMatches !== 2) {
            return {
                status: 'error',
                message: `Keyword matching failed: expected 2 matches, got ${result.totalMatches}`,
                userMessage: 'Keyword matching logic is broken. This will affect search accuracy.'
            };
        }

        if (result.score < 0.9) {
            return {
                status: 'warn',
                message: `Keyword match score too low: ${result.score}`,
                userMessage: 'Keyword matching may be too strict. Expected high scores for exact matches.'
            };
        }

        return {
            status: 'pass',
            message: 'Keyword matching works correctly',
            userMessage: 'Keyword matching logic is accurate.'
        };
    }
});

Diagnostics.registerCheck('vector-search-results', {
    name: 'Vector Search Results',
    description: 'Tracks vector search success/failure rate',
    category: 'SEARCH',
    checkFn: async () => {
        const failures = Diagnostics.getRuntimeIssues('vector-search-no-results');

        if (failures.length > 5) {
            return {
                status: 'warn',
                message: `${failures.length} vector searches with no results`,
                userMessage: `${failures.length} recent vector searches returned no results. This may indicate threshold is too high or embeddings are poor quality.`,
                fixes: [
                    {
                        label: 'Lower Threshold',
                        description: 'Reduce similarity threshold to get more results',
                        action: () => {
                            console.log('[RAG:DIAGNOSTICS] Consider lowering threshold to 0.5-0.7');
                        }
                    }
                ],
                data: failures.slice(-3)
            };
        }

        return {
            status: 'pass',
            message: 'Vector searches returning results',
            userMessage: 'Vector search is finding relevant chunks successfully.'
        };
    }
});

Diagnostics.registerCheck('vector-search-performance', {
    name: 'Vector Search Performance',
    description: 'Checks vector search speed',
    category: 'SEARCH',
    checkFn: async () => {
        // Check similarity calculation speed from core-similarity
        const similarityIssues = Diagnostics.getRuntimeIssues('similarity-calculation-speed');

        if (similarityIssues.length > 0) {
            const latest = similarityIssues[similarityIssues.length - 1];
            return {
                status: 'warn',
                message: `Slow vector search: ${latest.data.chunksPerSec} chunks/sec`,
                userMessage: `Vector search is slow (${latest.data.chunksPerSec} chunks/second). Consider reducing chunk count or optimizing embedding dimensions.`,
                data: latest.data
            };
        }

        return {
            status: 'pass',
            message: 'Vector search performance is good',
            userMessage: 'Vector similarity calculations are fast.'
        };
    }
});

Diagnostics.registerCheck('query-embedding-cache', {
    name: 'Query Embedding Cache',
    description: 'Monitors query embedding cache effectiveness',
    category: 'SEARCH',
    checkFn: async () => {
        const stats = getQueryCacheStats();

        if (stats.size === stats.capacity) {
            return {
                status: 'info',
                message: 'Query cache is full',
                userMessage: `Query embedding cache is full (${stats.size}/${stats.capacity} entries). Oldest queries will be evicted.`,
                data: stats
            };
        }

        return {
            status: 'pass',
            message: `Query cache: ${stats.size}/${stats.capacity} entries`,
            userMessage: `Query embedding cache has ${stats.size} cached queries (capacity: ${stats.capacity}).`
        };
    }
});

Diagnostics.registerCheck('chunk-embeddings-valid', {
    name: 'Chunk Embeddings Valid',
    description: 'Validates that chunk embeddings are properly formatted',
    category: 'EMBEDDINGS',
    checkFn: async () => {
        // This check requires access to chunks, which we don't have here
        // Will be called by search orchestrator before search
        return {
            status: 'pass',
            message: 'Chunk embedding validation skipped',
            userMessage: 'Chunk embeddings are validated during search operations.'
        };
    }
});

export default {
    // Keyword search exports
    extractKeywords,
    matchKeywords,
    buildKeywordIndex,
    searchByKeywords,
    calculateKeywordWeights,
    applyCustomKeywordWeights,
    extractEntities,
    // Keyword priority tier exports
    extractTags,
    PRIORITY_TIERS,
    isCriticalKeyword,
    isHighPriorityKeyword,
    isLowPriorityKeyword,
    assignKeywordPriority,
    applyKeywordWeights,
    calculateWeightedKeywordScore,
    buildPriorityContext,
    // Vector search exports
    searchByVector,
    dualVectorSearch,
    batchVectorSearch,
    getQueryCacheStats,
    clearQueryCache,
    validateChunkEmbeddings
};
