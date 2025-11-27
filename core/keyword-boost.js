/**
 * ============================================================================
 * VECTHARE KEYWORD SYSTEM
 * ============================================================================
 * Simple keyword extraction and boosting for vector search.
 *
 * For lorebooks: uses the entry's trigger keys
 * For other content: extracts capitalized words (names, places)
 *
 * @version 3.1.0
 * ============================================================================
 */

/**
 * Extract keywords from a lorebook entry
 * @param {object} entry - Lorebook entry with key array
 * @returns {string[]} Array of keywords
 */
export function extractLorebookKeywords(entry) {
    if (!entry) return [];

    const keywords = [];

    // Primary keys (trigger words)
    if (Array.isArray(entry.key)) {
        entry.key.forEach(k => {
            if (k && typeof k === 'string' && k.trim()) {
                keywords.push(k.trim().toLowerCase());
            }
        });
    }

    // Secondary keys
    if (Array.isArray(entry.keysecondary)) {
        entry.keysecondary.forEach(k => {
            if (k && typeof k === 'string' && k.trim()) {
                keywords.push(k.trim().toLowerCase());
            }
        });
    }

    return [...new Set(keywords)]; // Dedupe
}

/**
 * Extract keywords from plain text (names, places, etc.)
 * @param {string} text - Text to extract from
 * @returns {string[]} Array of keywords
 */
export function extractTextKeywords(text) {
    if (!text || typeof text !== 'string') return [];

    const keywords = [];

    // Find capitalized words (likely names/places) - at least 3 chars
    const capitalizedWords = text.match(/\b[A-Z][a-z]{2,}\b/g);
    if (capitalizedWords) {
        capitalizedWords.forEach(w => keywords.push(w.toLowerCase()));
    }

    // Dedupe and limit
    return [...new Set(keywords)].slice(0, 15);
}

/**
 * Check if query contains a keyword
 * @param {string} query - Search query
 * @param {string} keyword - Keyword to check
 * @returns {boolean}
 */
function queryHasKeyword(query, keyword) {
    if (!query || !keyword) return false;
    return query.toLowerCase().includes(keyword.toLowerCase());
}

/**
 * Apply keyword boost to search results
 * If query contains a chunk's keyword, boost its score
 *
 * @param {Array} results - Search results [{text, score, keywords, ...}]
 * @param {string} query - The search query
 * @param {number} boostFactor - Multiplier for matched keywords (default 1.5)
 * @returns {Array} Results with boosted scores, sorted by score desc
 */
export function applyKeywordBoost(results, query, boostFactor = 1.5) {
    if (!results || !Array.isArray(results) || !query) return results;

    const boosted = results.map(result => {
        const keywords = result.keywords || result.metadata?.keywords || [];
        let boost = 1.0;
        const matchedKeywords = [];

        for (const kw of keywords) {
            if (queryHasKeyword(query, kw)) {
                boost *= boostFactor;
                matchedKeywords.push(kw);
            }
        }

        return {
            ...result,
            score: result.score * boost,
            originalScore: result.score,
            keywordBoost: boost,
            matchedKeywords,
            keywordBoosted: boost > 1.0,
        };
    });

    // Sort by boosted score
    boosted.sort((a, b) => b.score - a.score);

    return boosted;
}

/**
 * Calculate overfetch amount for keyword boosting
 * We fetch more results than requested so boosted items can surface
 * @param {number} topK - Requested number of results
 * @returns {number} Amount to actually fetch
 */
export function getOverfetchAmount(topK) {
    // Fetch 2x the requested amount (min 10, max 100)
    return Math.min(100, Math.max(10, topK * 2));
}

/**
 * Apply keyword boosts and trim to requested topK
 * This is the main entry point for the query pipeline
 * @param {Array} results - Search results
 * @param {string} query - Search query
 * @param {number} topK - Number of results to return
 * @param {number} boostFactor - Boost multiplier (default 1.5)
 * @returns {Array} Boosted and trimmed results
 */
export function applyKeywordBoosts(results, query, topK, boostFactor = 1.5) {
    const boosted = applyKeywordBoost(results, query, boostFactor);
    return boosted.slice(0, topK);
}
