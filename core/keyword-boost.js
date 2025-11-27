/**
 * ============================================================================
 * VECTHARE KEYWORD SYSTEM
 * ============================================================================
 * Keyword extraction and boosting for vector search.
 *
 * For lorebooks: uses the entry's trigger keys
 * For other content: extracts capitalized words (names, places)
 *
 * BOOST MATH (Additive):
 * Each keyword has a weight (e.g., 1.5x, 2.0x, 3.0x).
 * The boost above 1.0 is added together:
 *   - "magic" (1.5x) + "divine" (2.0x) = 1 + 0.5 + 1.0 = 2.5x total boost
 *   - This prevents exponential explosion while respecting individual weights
 *
 * @version 3.2.0
 * ============================================================================
 */

/** Default weight for keywords without explicit weight */
const DEFAULT_KEYWORD_WEIGHT = 1.5;

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
 * Normalize a keyword to { text, weight } format
 * Handles both string and object formats
 * @param {string|object} kw - Keyword (string or { text, weight })
 * @returns {{ text: string, weight: number }}
 */
function normalizeKeyword(kw) {
    if (typeof kw === 'string') {
        return { text: kw.toLowerCase(), weight: DEFAULT_KEYWORD_WEIGHT };
    }
    if (kw && typeof kw === 'object' && kw.text) {
        return {
            text: kw.text.toLowerCase(),
            weight: typeof kw.weight === 'number' ? kw.weight : DEFAULT_KEYWORD_WEIGHT
        };
    }
    return null;
}

/**
 * Check if query contains a keyword
 * @param {string} query - Search query (lowercased)
 * @param {string} keyword - Keyword to check (lowercased)
 * @returns {boolean}
 */
function queryHasKeyword(query, keyword) {
    if (!query || !keyword) return false;
    return query.includes(keyword);
}

/**
 * Apply keyword boost to search results
 * Uses ADDITIVE math: boost = 1 + sum(weight - 1) for each matched keyword
 *
 * Examples:
 *   - Match "magic" (1.5x): boost = 1 + 0.5 = 1.5x
 *   - Match "magic" (1.5x) + "divine" (2.0x): boost = 1 + 0.5 + 1.0 = 2.5x
 *   - Match 7 keywords at 1.5x each: boost = 1 + (0.5 × 7) = 4.5x
 *
 * @param {Array} results - Search results [{text, score, keywords, ...}]
 * @param {string} query - The search query
 * @returns {Array} Results with boosted scores, sorted by score desc
 */
export function applyKeywordBoost(results, query) {
    if (!results || !Array.isArray(results) || !query) return results;

    const queryLower = query.toLowerCase();

    const boosted = results.map(result => {
        const rawKeywords = result.keywords || result.metadata?.keywords || [];
        const matchedKeywords = [];
        let boostSum = 0;

        for (const kw of rawKeywords) {
            const normalized = normalizeKeyword(kw);
            if (!normalized) continue;

            if (queryHasKeyword(queryLower, normalized.text)) {
                matchedKeywords.push(normalized);
                // Additive: add the boost portion (weight - 1.0)
                boostSum += (normalized.weight - 1.0);
            }
        }

        // Final boost: 1.0 + sum of all matched boosts
        const boost = 1.0 + boostSum;

        return {
            ...result,
            score: result.score * boost,
            originalScore: result.score,
            keywordBoost: boost,
            matchedKeywords: matchedKeywords.map(k => k.text),
            matchedKeywordsWithWeights: matchedKeywords,
            keywordBoosted: matchedKeywords.length > 0,
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
 * @returns {Array} Boosted and trimmed results
 */
export function applyKeywordBoosts(results, query, topK) {
    const boosted = applyKeywordBoost(results, query);
    return boosted.slice(0, topK);
}
