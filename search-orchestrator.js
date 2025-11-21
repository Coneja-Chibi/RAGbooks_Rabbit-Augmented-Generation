/**
 * Rabbit Augmented Generation - Search Orchestrator
 *
 * WHY: Central coordinator that integrates all search strategies (keyword, vector,
 * hybrid) and applies all feature modules (importance, conditions, groups, decay).
 *
 * Architecture:
 * - Coordinate keyword + vector search
 * - Apply feature modules in correct order
 * - Handle search context building
 * - Integrate with diagnostics for full pipeline tracking
 * - Provide unified search API for all consumers
 */

import { logger, Diagnostics } from './core-system.js';
import { searchByVector, dualVectorSearch, batchVectorSearch, searchByKeywords, matchKeywords } from './search-strategies.js';
import { evaluateConditions } from './conditional-activation.js';
import { State } from './core-state.js';
import * as KeywordSearch from './search-strategies.js';
import * as VectorSearch from './search-strategies.js';

// Feature modules
import * as ImportanceWeighting from './features.js';
import * as ConditionalActivation from './features.js';
import * as ChunkGroups from './features.js';
import * as TemporalDecay from './features.js';

/**
 * Main search entry point
 * WHY: Single function that handles all search complexity
 *
 * @param {string} queryText - Search query
 * @param {Object[]} chunks - All available chunks
 * @param {Object} options - Search options
 * @param {Object} context - Search context (chat, character, etc.)
 * @returns {Promise<Object>} Search results with metadata
 */
export async function search(queryText, chunks, options = {}, context = {}) {
    const {
        // Search strategy
        searchMode = 'hybrid',          // 'keyword', 'vector', 'hybrid'
        topK = 5,
        threshold = 0.6,

        // Feature flags
        applyImportance = true,
        applyConditions = true,
        applyGroups = true,
        applyDecay = false,

        // Search-specific options
        keywordWeight = 0.3,            // Weight for keyword scores in hybrid
        vectorWeight = 0.7,             // Weight for vector scores in hybrid

        // Dual-vector
        dualVector = false,

        // Settings from state
        settings = {}
    } = options;

    const startTime = performance.now();

    // Validate inputs
    if (!queryText || queryText.trim().length === 0) {
        throw new SearchError('Query text is empty or too short', 'EMPTY_QUERY');
    }

    if (!chunks || chunks.length === 0) {
        throw new SearchError('No chunks available for search', 'NO_COLLECTIONS');
    }

    logSearchStart(queryText, searchMode, {
        topK,
        threshold,
        chunkCount: chunks.length,
        features: { importance: applyImportance, conditions: applyConditions, groups: applyGroups, decay: applyDecay }
    });

    try {
        // Step 1: Pre-filter chunks by conditions
        let searchableChunks = chunks;

        if (applyConditions && context.chat) {
            const searchContext = ConditionalActivation.buildSearchContext(
                context.chat,
                context.contextWindow || 10,
                [],
                context.metadata || {}
            );

            searchableChunks = ConditionalActivation.filterChunksByConditions(searchableChunks, searchContext);
            logger.log(`🔍 After conditions filter: ${searchableChunks.length} chunks`);
        }

        if (searchableChunks.length === 0) {
            logger.warn('⚠️ All chunks filtered out by conditions');
            logSearchEnd(0, []);
            return {
                results: [],
                timing: { duration: performance.now() - startTime },
                stats: { originalChunks: chunks.length, filteredChunks: 0 }
            };
        }

        // Step 2: Execute search based on mode
        let scoredChunks = [];

        if (searchMode === 'keyword') {
            scoredChunks = await performKeywordSearch(queryText, searchableChunks, options);
        } else if (searchMode === 'vector') {
            scoredChunks = await performVectorSearch(queryText, searchableChunks, options, dualVector);
        } else if (searchMode === 'hybrid') {
            scoredChunks = await performHybridSearch(queryText, searchableChunks, options, keywordWeight, vectorWeight, dualVector);
        } else {
            throw new SearchError(`Invalid search mode: ${searchMode}`, 'INVALID_SEARCH_MODE');
        }

        logger.log(`🔍 After ${searchMode} search: ${scoredChunks.length} chunks with scores`);

        // Step 3: Apply feature modules
        if (applyGroups) {
            scoredChunks = ChunkGroups.applyGroupBoosts(scoredChunks, queryText, settings.groupBoostMultiplier || 1.3);
            logger.log(`🔍 After group boosts: ${scoredChunks.length} chunks`);
        }

        if (applyImportance) {
            scoredChunks = ImportanceWeighting.applyImportanceToResults(scoredChunks);
            logger.log(`🔍 After importance weighting: ${scoredChunks.length} chunks`);
        }

        if (applyDecay && context.currentMessageId) {
            const decaySettings = settings.temporalDecay || { enabled: false };
            if (decaySettings.enabled) {
                if (decaySettings.sceneAware && context.scenes) {
                    scoredChunks = TemporalDecay.applySceneAwareDecay(
                        scoredChunks,
                        context.currentMessageId,
                        context.scenes,
                        decaySettings
                    );
                } else {
                    scoredChunks = TemporalDecay.applyDecayToResults(
                        scoredChunks,
                        context.currentMessageId,
                        decaySettings
                    );
                }
                logger.log(`🔍 After temporal decay: ${scoredChunks.length} chunks`);
            }
        }

        // Step 4: Sort and filter by threshold
        scoredChunks = scoredChunks
            .filter(chunk => (chunk.score || 0) >= threshold)
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, topK);

        logger.log(`🔍 After threshold ${threshold} and top-${topK}: ${scoredChunks.length} chunks`);

        // Step 5: Enforce required groups
        if (applyGroups) {
            scoredChunks = ChunkGroups.enforceRequiredGroups(scoredChunks, searchableChunks, 5);
            logger.log(`🔍 After enforcing required groups: ${scoredChunks.length} chunks`);
        }

        // Step 6: Apply importance-based ranking if enabled
        if (applyImportance && settings.importanceRanking) {
            scoredChunks = ImportanceWeighting.rankChunksByImportance(scoredChunks, settings.useTierRanking || false);
        }

        const totalDuration = performance.now() - startTime;

        // Record in diagnostics
        if (scoredChunks.length === 0) {
            Diagnostics.recordFailure('search-no-results', {
                mode: searchMode,
                threshold,
                topK,
                originalChunks: chunks.length
            });
        } else {
            Diagnostics.recordSuccess('search', {
                mode: searchMode,
                resultCount: scoredChunks.length
            });
        }

        logSearchEnd(scoredChunks.length, scoredChunks);

        return {
            results: scoredChunks,
            timing: {
                duration: totalDuration,
                mode: searchMode
            },
            stats: {
                originalChunks: chunks.length,
                searchableChunks: searchableChunks.length,
                scoredChunks: scoredChunks.length,
                finalResults: scoredChunks.length,
                averageScore: scoredChunks.length > 0
                    ? scoredChunks.reduce((sum, c) => sum + (c.score || 0), 0) / scoredChunks.length
                    : 0
            }
        };

    } catch (error) {
        logger.error('[RAG:SEARCH] Search failed:', error);
        logSearchEnd(0, []);
        throw error;
    }
}

/**
 * Perform keyword-only search
 * @private
 */
async function performKeywordSearch(queryText, chunks, options) {
    logger.log('🔤 Performing keyword search');

    // Extract query keywords
    const queryKeywords = KeywordSearch.extractKeywords(queryText, {
        minLength: 2,
        removeStopWords: true
    });

    if (queryKeywords.length === 0) {
        logger.warn('⚠️ No keywords extracted from query');
        return [];
    }

    logger.log(`Query keywords: ${queryKeywords.join(', ')}`);

    // Build keyword index
    const keywordIndex = KeywordSearch.buildKeywordIndex(chunks);

    // Search using Trie
    const results = KeywordSearch.searchByKeywords(queryKeywords, keywordIndex,
        Object.fromEntries(chunks.map(c => [c.hash, c]))
    );

    // Map keywordScore to score
    return results.map(chunk => ({
        ...chunk,
        score: chunk.keywordScore
    }));
}

/**
 * Perform vector-only search
 * @private
 */
async function performVectorSearch(queryText, chunks, options, dualVector) {
    logger.log('🧠 Performing vector search');

    // Validate embeddings
    const validation = VectorSearch.validateChunkEmbeddings(chunks);
    if (!validation.valid) {
        throw new SearchError(
            `${validation.invalidChunks} chunks have invalid embeddings`,
            'INVALID_EMBEDDINGS',
            validation
        );
    }

    let searchResult;

    if (dualVector) {
        searchResult = await VectorSearch.dualVectorSearch(queryText, chunks, {
            topK: options.topK * 2, // Get more results for merging
            threshold: options.threshold
        });
    } else {
        searchResult = await VectorSearch.searchByVector(queryText, chunks, {
            topK: options.topK * 2,
            threshold: options.threshold,
            searchMode: options.vectorSearchMode || 'full'
        });
    }

    // Map similarity to score
    return searchResult.results.map(chunk => ({
        ...chunk,
        score: chunk.similarity || chunk.rrfScore
    }));
}

/**
 * Perform hybrid search (keyword + vector)
 * @private
 */
async function performHybridSearch(queryText, chunks, options, keywordWeight, vectorWeight, dualVector) {
    logger.log('🔀 Performing hybrid search (keyword + vector)');

    // Run keyword and vector searches in parallel
    const [keywordResults, vectorResults] = await Promise.all([
        performKeywordSearch(queryText, chunks, options),
        performVectorSearch(queryText, chunks, options, dualVector)
    ]);

    logger.log(`Keyword results: ${keywordResults.length}, Vector results: ${vectorResults.length}`);

    // Merge results by hash
    const mergedMap = new Map();

    // Add keyword results
    for (const chunk of keywordResults) {
        mergedMap.set(chunk.hash, {
            ...chunk,
            keywordScore: chunk.score,
            vectorScore: 0,
            score: chunk.score * keywordWeight
        });
    }

    // Add/merge vector results
    for (const chunk of vectorResults) {
        if (mergedMap.has(chunk.hash)) {
            const existing = mergedMap.get(chunk.hash);
            existing.vectorScore = chunk.score;
            existing.score = (existing.keywordScore * keywordWeight) + (chunk.score * vectorWeight);
        } else {
            mergedMap.set(chunk.hash, {
                ...chunk,
                keywordScore: 0,
                vectorScore: chunk.score,
                score: chunk.score * vectorWeight
            });
        }
    }

    const merged = Array.from(mergedMap.values());
    logger.log(`Merged into ${merged.length} unique chunks`);

    return merged;
}

/**
 * Search with automatic mode selection
 * WHY: Automatically choose best search strategy based on query and chunks
 *
 * @param {string} queryText - Search query
 * @param {Object[]} chunks - All available chunks
 * @param {Object} options - Search options
 * @param {Object} context - Search context
 * @returns {Promise<Object>} Search results
 */
export async function autoSearch(queryText, chunks, options = {}, context = {}) {
    // Step 1: Filter by conditional activation (if enabled)
    if (options.applyConditions) {
        const initialCount = chunks.length;
        // Import context builder dynamically to avoid circular deps if needed, or pass context in
        // For now, we assume context has the necessary fields
        chunks = chunks.filter(chunk => evaluateConditions(chunk.conditions, context));
        const filteredCount = chunks.length;
        
        if (filteredCount < initialCount) {
            logger.log(`[RAG:SEARCH] Condition filter removed ${initialCount - filteredCount} chunks`);
        }
    }

    // Step 2: Determine search strategy
    // Default to hybrid if not specified
    const hasEmbeddings = chunks.some(c => c.embedding && c.embedding.length > 0);
    const hasKeywords = chunks.some(c => (c.keywords || c.systemKeywords || []).length > 0);

    let searchMode = 'vector'; // Default

    if (hasEmbeddings && hasKeywords) {
        searchMode = 'hybrid';
    } else if (hasKeywords && !hasEmbeddings) {
        searchMode = 'keyword';
    } else if (!hasEmbeddings && !hasKeywords) {
        throw new SearchError(
            'Chunks have no embeddings or keywords. Vectorize collections first.',
            'NO_SEARCH_DATA'
        );
    }

    logger.log(`🤖 Auto-selected search mode: ${searchMode}`);

    return search(queryText, chunks, { ...options, searchMode }, context);
}

/**
 * Batch search multiple queries
 * WHY: Efficient for processing multiple queries
 *
 * @param {string[]} queries - Array of queries
 * @param {Object[]} chunks - Chunks to search
 * @param {Object} options - Search options
 * @param {Object} context - Search context
 * @param {Function} progressCallback - Progress callback
 * @returns {Promise<Object[]>} Array of search results
 */
export async function batchSearch(queries, chunks, options = {}, context = {}, progressCallback = null) {
    logger.group(`🔍 [RAG:BATCH] Searching ${queries.length} queries`);

    const results = [];

    for (let i = 0; i < queries.length; i++) {
        const query = queries[i];

        try {
            const result = await search(query, chunks, options, context);
            results.push(result);

            if (progressCallback) {
                progressCallback(i + 1, queries.length);
            }
        } catch (error) {
            logger.error(`[RAG:BATCH] Query ${i + 1} failed:`, error);
            results.push({
                results: [],
                timing: { duration: 0 },
                stats: {},
                error: error.message
            });
        }
    }

    logger.log(`✅ Batch search complete: ${results.length} queries processed`);
    logger.groupEnd();

    return results;
}

// ==================== DIAGNOSTIC CHECKS ====================

Diagnostics.registerCheck('search-orchestrator-health', {
    name: 'Search Orchestrator Health',
    description: 'Validates search pipeline is operational',
    category: 'SEARCH',
    checkFn: async () => {
        // Check if searches are completing successfully
        const failures = Diagnostics.getRuntimeIssues('search-no-results');
        const successes = Diagnostics.getRuntimeIssues('search');

        if (failures.length > 0 && successes.length === 0) {
            return {
                status: 'error',
                message: 'All searches returning no results',
                userMessage: 'Search pipeline is not finding any results. Check threshold, embeddings, and collections.'
            };
        }

        if (failures.length > successes.length) {
            return {
                status: 'warn',
                message: `${failures.length} failed searches vs ${successes.length} successful`,
                userMessage: `More searches are failing than succeeding. Consider adjusting threshold or checking chunk quality.`
            };
        }

        return {
            status: 'pass',
            message: `Search pipeline operational (${successes.length} successful searches)`,
            userMessage: 'Search orchestrator is finding results successfully.'
        };
    }
});

Diagnostics.registerCheck('search-feature-modules', {
    name: 'Search Feature Modules',
    description: 'Validates that feature modules are integrated',
    category: 'SEARCH',
    checkFn: async () => {
        // Check that feature modules are loaded
        const modules = {
            ImportanceWeighting,
            ConditionalActivation,
            ChunkGroups,
            TemporalDecay
        };

        const missing = [];
        for (const [name, module] of Object.entries(modules)) {
            if (!module || typeof module !== 'object') {
                missing.push(name);
            }
        }

        if (missing.length > 0) {
            return {
                status: 'error',
                message: `Feature modules not loaded: ${missing.join(', ')}`,
                userMessage: `Feature modules failed to load: ${missing.join(', ')}. Advanced search features will not work.`
            };
        }

        return {
            status: 'pass',
            message: 'All feature modules loaded',
            userMessage: 'Feature modules (importance, conditions, groups, decay) are integrated and ready.'
        };
    }
});

export default {
    search,
    autoSearch,
    batchSearch
};
