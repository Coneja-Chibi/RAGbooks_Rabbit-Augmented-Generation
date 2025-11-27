/**
 * ============================================================================
 * VECTHARE KEYWORD SYSTEM
 * ============================================================================
 * Keyword extraction and boosting for vector search.
 *
 * EXTRACTION LEVELS:
 *   - off: No auto-extraction, only manual/WI trigger keys
 *   - minimal: Title only (first line), max 3 keywords
 *   - balanced: Header area (first 300 chars), max 8 keywords
 *   - aggressive: Full text scan, max 15 keywords
 *
 * FREQUENCY-BASED WEIGHTING:
 *   Words that appear more often get higher weights.
 *   Formula: baseWeight + (frequency - minFreq) * 0.1
 *   Example: base 1.5x, word appears 5x (min 2) → 1.5 + (5-2)*0.1 = 1.8x
 *
 * BOOST MATH (Additive):
 *   Each keyword has a weight (e.g., 1.5x, 2.0x, 3.0x).
 *   The boost above 1.0 is added together:
 *     - "magic" (1.5x) + "divine" (2.0x) = 1 + 0.5 + 1.0 = 2.5x total boost
 *
 * @version 4.0.0
 * ============================================================================
 */

/** Extraction level configurations */
export const EXTRACTION_LEVELS = {
    off: {
        label: 'Off',
        description: 'No auto-extraction, only WI trigger keys',
        enabled: false,
    },
    minimal: {
        label: 'Minimal',
        description: 'Title/first line only, max 3 keywords',
        enabled: true,
        headerSize: 100,
        minFrequency: 1,
        maxKeywords: 3,
    },
    balanced: {
        label: 'Balanced',
        description: 'Header area focus, max 8 keywords',
        enabled: true,
        headerSize: 300,
        minFrequency: 2,
        maxKeywords: 8,
    },
    aggressive: {
        label: 'Aggressive',
        description: 'Full text scan, max 15 keywords',
        enabled: true,
        headerSize: null, // null = full text
        minFrequency: 3,
        maxKeywords: 15,
    },
};

/** Default extraction level */
export const DEFAULT_EXTRACTION_LEVEL = 'balanced';

/** Default base weight for keywords */
export const DEFAULT_BASE_WEIGHT = 1.5;

/** Weight increment per frequency count above minimum */
const FREQUENCY_WEIGHT_INCREMENT = 0.1;

/** Maximum weight cap (prevent runaway weights) */
const MAX_KEYWORD_WEIGHT = 3.0;

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
 * Common words that shouldn't be auto-extracted as keywords
 * (Section headers, formatting terms, etc.)
 */
const KEYWORD_STOP_WORDS = new Set([
    // Section headers that are too generic
    'biology', 'psychology', 'moves', 'worship', 'limitations',
    'manifestation', 'sustenance', 'perception', 'understanding',
    'responsibility', 'tolerance', 'authority',
    // Common descriptive words
    'mythic', 'signature', 'foil', 'example', 'examples', 'type', 'types',
    // Formatting/markup
    'note', 'notes', 'warning', 'important', 'section', 'chapter',
    // Very common words
    'the', 'how', 'does', 'your', 'what', 'when', 'where', 'why', 'who',
    'fix', 'new', 'old', 'year', 'years', 'day', 'days',
    // Common RP/chat terms
    'character', 'characters', 'would', 'could', 'should', 'will',
    'have', 'has', 'had', 'been', 'being', 'were', 'was', 'are',
    'this', 'that', 'these', 'those', 'with', 'from', 'into',
    'their', 'they', 'them', 'there', 'then', 'than', 'when',
    'which', 'while', 'where', 'about', 'after', 'before',
]);

/**
 * Extract keywords from plain text with configurable extraction level
 *
 * Returns keywords with frequency-based weights.
 * Higher frequency = higher weight (capped at MAX_KEYWORD_WEIGHT)
 *
 * @param {string} text - Text to extract from
 * @param {object} options - Extraction options
 * @param {string} options.level - Extraction level: 'off', 'minimal', 'balanced', 'aggressive'
 * @param {number} options.baseWeight - Base weight for keywords (default 1.5)
 * @returns {Array<{text: string, weight: number}>} Array of weighted keywords
 */
export function extractTextKeywords(text, options = {}) {
    if (!text || typeof text !== 'string') return [];

    const level = options.level || DEFAULT_EXTRACTION_LEVEL;
    const baseWeight = options.baseWeight || DEFAULT_BASE_WEIGHT;
    const config = EXTRACTION_LEVELS[level];

    // If extraction is disabled, return empty
    if (!config || !config.enabled) {
        return [];
    }

    // Step 1: Clean text - remove example citations and italics
    let cleanedText = text.replace(/\([^)]+\)/g, ' '); // Remove (parenthetical citations)
    cleanedText = cleanedText.replace(/\*[^*]+\*/g, ' '); // Remove *italicized examples*

    // Step 2: Determine scan area based on level
    const scanArea = config.headerSize
        ? cleanedText.substring(0, config.headerSize)
        : cleanedText;

    // Step 3: Extract and count words
    const topicWords = scanArea.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const wordCounts = new Map();

    for (const word of topicWords) {
        if (KEYWORD_STOP_WORDS.has(word)) continue;
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    // Step 4: Filter by minimum frequency and build weighted keywords
    const weightedKeywords = [];

    for (const [word, count] of wordCounts) {
        if (count >= config.minFrequency) {
            // Calculate weight based on frequency
            // More occurrences = higher weight
            const frequencyBonus = (count - config.minFrequency) * FREQUENCY_WEIGHT_INCREMENT;
            const weight = Math.min(MAX_KEYWORD_WEIGHT, baseWeight + frequencyBonus);

            weightedKeywords.push({ text: word, weight, frequency: count });
        }
    }

    // Step 5: Extract compound terms (e.g., "divine/time", "time_god")
    const compoundMatches = scanArea.match(/\b\w+[/_]\w+\b/gi) || [];
    for (const compound of compoundMatches) {
        const normalized = compound.toLowerCase().replace(/[/_]/g, '_');
        if (normalized.length >= 4) {
            // Compound terms get a slight weight bonus
            weightedKeywords.push({
                text: normalized,
                weight: Math.min(MAX_KEYWORD_WEIGHT, baseWeight + 0.2),
                frequency: 1,
            });
        }
    }

    // Step 6: Sort by weight (highest first), dedupe, and limit
    const seen = new Set();
    const result = [];

    weightedKeywords.sort((a, b) => b.weight - a.weight);

    for (const kw of weightedKeywords) {
        if (!seen.has(kw.text)) {
            seen.add(kw.text);
            result.push(kw);
            if (result.length >= config.maxKeywords) break;
        }
    }

    return result;
}

/**
 * Simple string array version for backwards compatibility
 * @param {string} text - Text to extract from
 * @param {object} options - Extraction options
 * @returns {string[]} Array of keyword strings
 */
export function extractTextKeywordsSimple(text, options = {}) {
    return extractTextKeywords(text, options).map(kw => kw.text);
}

/**
 * Normalize a keyword to { text, weight } format
 * Handles both string and object formats
 * @param {string|object} kw - Keyword (string or { text, weight })
 * @param {number} defaultWeight - Default weight for string keywords
 * @returns {{ text: string, weight: number }}
 */
function normalizeKeyword(kw, defaultWeight = DEFAULT_BASE_WEIGHT) {
    if (typeof kw === 'string') {
        return { text: kw.toLowerCase(), weight: defaultWeight };
    }
    if (kw && typeof kw === 'object' && kw.text) {
        return {
            text: kw.text.toLowerCase(),
            weight: typeof kw.weight === 'number' ? kw.weight : defaultWeight
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
