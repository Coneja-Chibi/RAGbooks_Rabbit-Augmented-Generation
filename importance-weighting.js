// =============================================================================
// IMPORTANCE WEIGHTING SYSTEM
// Boosts or reduces chunk relevance based on importance value
// =============================================================================

/**
 * Applies importance weighting to a chunk's similarity score
 * Combines multiplicative scaling with additive boost
 * @param {number} score - Original similarity score (0-1)
 * @param {number} importance - Importance percentage (0-200, default 100)
 * @returns {number} Adjusted score
 */
export function applyImportanceWeighting(score, importance = 100) {
    if (importance === 100) return score; // No change for neutral importance

    // Step 1: Multiplicative scaling
    // importance = 150 → 1.5x, importance = 50 → 0.5x
    const importanceMultiplier = importance / 100;
    const scaledScore = score * importanceMultiplier;

    // Step 2: Additive boost/penalty for fine-tuning
    // importance = 150 → +0.05, importance = 50 → -0.05
    const importanceBoost = (importance - 100) / 1000;
    const finalScore = scaledScore + importanceBoost;

    // Clamp to valid range [0, 1]
    return Math.max(0, Math.min(1, finalScore));
}

/**
 * Applies importance weighting to all chunks in search results
 * @param {Array} chunks - Array of chunks with scores
 * @returns {Array} Chunks with adjusted scores
 */
export function applyImportanceToResults(chunks) {
    return chunks.map(chunk => {
        const importance = chunk.importance !== undefined ? chunk.importance : 100;
        const originalScore = chunk.score || 0;
        const adjustedScore = applyImportanceWeighting(originalScore, importance);

        return {
            ...chunk,
            originalScore,
            score: adjustedScore,
            importanceApplied: importance !== 100
        };
    });
}

/**
 * Gets chunks sorted into priority tiers based on importance
 * @param {Array} chunks - Array of chunks
 * @returns {Object} Chunks grouped by tier
 */
export function groupChunksByPriorityTier(chunks) {
    const tiers = {
        critical: [], // 175-200
        high: [],     // 125-174
        normal: [],   // 75-124
        low: []       // 0-74
    };

    chunks.forEach(chunk => {
        const importance = chunk.importance !== undefined ? chunk.importance : 100;

        if (importance >= 175) {
            tiers.critical.push(chunk);
        } else if (importance >= 125) {
            tiers.high.push(chunk);
        } else if (importance >= 75) {
            tiers.normal.push(chunk);
        } else {
            tiers.low.push(chunk);
        }
    });

    return tiers;
}

/**
 * Re-ranks chunks based on importance tiers
 * Critical tier chunks always come first, then high, etc.
 * Within each tier, chunks are sorted by similarity score
 * @param {Array} chunks - Array of chunks with scores
 * @param {boolean} useTiers - Whether to use tier-based ranking
 * @returns {Array} Re-ranked chunks
 */
export function rankChunksByImportance(chunks, useTiers = false) {
    if (!useTiers) {
        // Simple mode: just sort by adjusted score
        return chunks.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    // Tier mode: group by importance tier, then sort within tiers
    const tiers = groupChunksByPriorityTier(chunks);

    const ranked = [
        ...tiers.critical.sort((a, b) => (b.score || 0) - (a.score || 0)),
        ...tiers.high.sort((a, b) => (b.score || 0) - (a.score || 0)),
        ...tiers.normal.sort((a, b) => (b.score || 0) - (a.score || 0)),
        ...tiers.low.sort((a, b) => (b.score || 0) - (a.score || 0))
    ];

    console.log(`📊 [Importance] Ranked ${ranked.length} chunks by priority tier:`, {
        critical: tiers.critical.length,
        high: tiers.high.length,
        normal: tiers.normal.length,
        low: tiers.low.length
    });

    return ranked;
}

/**
 * Filters out chunks below importance threshold
 * @param {Array} chunks - Array of chunks
 * @param {number} minImportance - Minimum importance to include (0-200)
 * @returns {Array} Filtered chunks
 */
export function filterByMinImportance(chunks, minImportance = 0) {
    if (minImportance === 0) return chunks;

    const filtered = chunks.filter(chunk => {
        const importance = chunk.importance !== undefined ? chunk.importance : 100;
        return importance >= minImportance;
    });

    console.log(`📊 [Importance] Filtered ${chunks.length} chunks to ${filtered.length} (min importance: ${minImportance})`);

    return filtered;
}

/**
 * Gets statistics about importance distribution in a chunk collection
 * @param {Array} chunks - Array of chunks
 * @returns {Object} Statistics
 */
export function getImportanceStats(chunks) {
    if (chunks.length === 0) {
        return { min: 0, max: 0, avg: 0, median: 0, distribution: {} };
    }

    const importanceValues = chunks.map(chunk => chunk.importance !== undefined ? chunk.importance : 100);
    const sorted = importanceValues.sort((a, b) => a - b);

    const distribution = importanceValues.reduce((acc, val) => {
        const bucket = Math.floor(val / 25) * 25; // Buckets: 0, 25, 50, 75, 100, 125, 150, 175, 200
        acc[bucket] = (acc[bucket] || 0) + 1;
        return acc;
    }, {});

    return {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: importanceValues.reduce((a, b) => a + b, 0) / importanceValues.length,
        median: sorted[Math.floor(sorted.length / 2)],
        distribution
    };
}

export default {
    applyImportanceWeighting,
    applyImportanceToResults,
    groupChunksByPriorityTier,
    rankChunksByImportance,
    filterByMinImportance,
    getImportanceStats
};
