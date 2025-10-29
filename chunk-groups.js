// =============================================================================
// CHUNK GROUPS SYSTEM
// Groups chunks together with shared keywords for collective activation
// =============================================================================

/**
 * Builds an index of all chunk groups
 * @param {Array} chunks - Array of chunks
 * @returns {Object} Map of group name to group data
 */
export function buildGroupIndex(chunks) {
    const groupIndex = {};

    chunks.forEach(chunk => {
        if (chunk.chunkGroup && chunk.chunkGroup.name) {
            const groupName = chunk.chunkGroup.name;

            if (!groupIndex[groupName]) {
                groupIndex[groupName] = {
                    name: groupName,
                    chunks: [],
                    keywords: chunk.chunkGroup.groupKeywords || [],
                    required: chunk.chunkGroup.requiresGroupMember || false
                };
            }

            groupIndex[groupName].chunks.push(chunk);

            // Merge keywords (union of all keywords in group)
            const existingKeywords = new Set(groupIndex[groupName].keywords);
            (chunk.chunkGroup.groupKeywords || []).forEach(kw => existingKeywords.add(kw));
            groupIndex[groupName].keywords = Array.from(existingKeywords);

            // If ANY chunk in group is required, mark group as required
            if (chunk.chunkGroup.requiresGroupMember) {
                groupIndex[groupName].required = true;
            }
        }
    });

    console.log(`📦 [Groups] Built index with ${Object.keys(groupIndex).length} groups`);

    return groupIndex;
}

/**
 * Checks if any group keywords match the query
 * @param {Array} groupKeywords - Group keywords
 * @param {string} queryText - Query text
 * @returns {boolean} Whether group is triggered
 */
function isGroupTriggered(groupKeywords, queryText) {
    const lowerQuery = queryText.toLowerCase();
    return groupKeywords.some(kw => lowerQuery.includes(kw.toLowerCase()));
}

/**
 * Applies group keyword matching and boosts matching groups
 * @param {Array} chunks - Array of chunks
 * @param {string} queryText - Query text
 * @param {number} boostMultiplier - Boost multiplier for matching groups (default 1.3 = 30% boost)
 * @returns {Array} Chunks with group boosts applied
 */
export function applyGroupBoosts(chunks, queryText, boostMultiplier = 1.3) {
    const groupIndex = buildGroupIndex(chunks);

    // Check which groups are triggered
    const triggeredGroups = new Set();
    Object.entries(groupIndex).forEach(([groupName, group]) => {
        if (isGroupTriggered(group.keywords, queryText)) {
            triggeredGroups.add(groupName);
            console.log(`📦 [Groups] Group "${groupName}" triggered by keywords:`, group.keywords);
        }
    });

    // Apply boosts to chunks in triggered groups
    const boosted = chunks.map(chunk => {
        if (chunk.chunkGroup && chunk.chunkGroup.name && triggeredGroups.has(chunk.chunkGroup.name)) {
            return {
                ...chunk,
                score: (chunk.score || 0) * boostMultiplier,
                groupBoosted: true
            };
        }
        return chunk;
    });

    const boostedCount = boosted.filter(c => c.groupBoosted).length;
    console.log(`📦 [Groups] Applied boosts to ${boostedCount} chunks in ${triggeredGroups.size} triggered groups`);

    return boosted;
}

/**
 * Enforces required group members
 * Ensures at least one chunk from each required group is included in results
 * @param {Array} results - Current search results
 * @param {Array} allChunks - All available chunks
 * @param {number} maxToAdd - Maximum chunks to force-include
 * @returns {Array} Results with required group members added
 */
export function enforceRequiredGroups(results, allChunks, maxToAdd = 5) {
    const groupIndex = buildGroupIndex(allChunks);
    const resultsHashes = new Set(results.map(c => c.hash));
    const toAdd = [];

    Object.entries(groupIndex).forEach(([groupName, group]) => {
        if (!group.required) return;

        // Check if any chunk from this group is already in results
        const hasGroupMember = group.chunks.some(chunk => resultsHashes.has(chunk.hash));

        if (!hasGroupMember && toAdd.length < maxToAdd) {
            // Find highest-scoring chunk from this group
            const bestChunk = group.chunks
                .filter(c => !c.disabled)
                .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

            if (bestChunk) {
                toAdd.push({
                    ...bestChunk,
                    forcedByGroup: groupName
                });
                resultsHashes.add(bestChunk.hash);
                console.log(`📦 [Groups] Force-included chunk from required group "${groupName}"`);
            }
        }
    });

    if (toAdd.length > 0) {
        console.log(`📦 [Groups] Added ${toAdd.length} chunks from required groups`);
        return [...results, ...toAdd];
    }

    return results;
}

/**
 * Gets chunks grouped by their group membership
 * @param {Array} chunks - Array of chunks
 * @returns {Object} Map of group name to chunks
 */
export function getChunksByGroup(chunks) {
    const grouped = {};

    chunks.forEach(chunk => {
        const groupName = chunk.chunkGroup?.name || '_ungrouped';

        if (!grouped[groupName]) {
            grouped[groupName] = [];
        }

        grouped[groupName].push(chunk);
    });

    return grouped;
}

/**
 * Gets statistics about chunk groups
 * @param {Array} chunks - Array of chunks
 * @returns {Object} Statistics
 */
export function getGroupStats(chunks) {
    const groupIndex = buildGroupIndex(chunks);

    const stats = {
        totalGroups: Object.keys(groupIndex).length,
        totalGroupedChunks: 0,
        ungroupedChunks: 0,
        requiredGroups: 0,
        groupSizes: {},
        averageGroupSize: 0
    };

    Object.entries(groupIndex).forEach(([groupName, group]) => {
        stats.totalGroupedChunks += group.chunks.length;
        stats.groupSizes[groupName] = group.chunks.length;
        if (group.required) stats.requiredGroups++;
    });

    stats.ungroupedChunks = chunks.length - stats.totalGroupedChunks;

    if (stats.totalGroups > 0) {
        stats.averageGroupSize = stats.totalGroupedChunks / stats.totalGroups;
    }

    return stats;
}

/**
 * Validates a chunk group configuration
 * @param {Object} chunkGroup - Chunk group object
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
export function validateChunkGroup(chunkGroup) {
    const errors = [];

    if (!chunkGroup) {
        return { valid: true, errors: [] };
    }

    if (chunkGroup.name && chunkGroup.name.trim() !== '') {
        // Group name exists, validate keywords
        if (!chunkGroup.groupKeywords || chunkGroup.groupKeywords.length === 0) {
            errors.push('Group keywords are required when group name is set');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Suggests group names based on chunk content similarity
 * @param {Array} chunks - Array of chunks
 * @param {number} similarityThreshold - Minimum similarity to suggest grouping (0-1)
 * @returns {Array} Suggested groups { chunks: [], suggestedName: '', keywords: [] }
 */
export function suggestGroups(chunks, similarityThreshold = 0.7) {
    // This is a placeholder for more advanced grouping logic
    // Could use keyword overlap, topic similarity, etc.

    const suggestions = [];
    const grouped = new Set();

    chunks.forEach((chunk, idx) => {
        if (grouped.has(chunk.hash)) return;

        // Find chunks with overlapping keywords
        const similar = chunks.filter((other, otherIdx) => {
            if (otherIdx <= idx || grouped.has(other.hash)) return false;

            const chunkKeywords = new Set(chunk.keywords || []);
            const otherKeywords = new Set(other.keywords || []);
            const overlap = [...chunkKeywords].filter(k => otherKeywords.has(k));

            const similarity = overlap.length / Math.max(chunkKeywords.size, otherKeywords.size);
            return similarity >= similarityThreshold;
        });

        if (similar.length > 0) {
            const group = [chunk, ...similar];
            const allKeywords = [...new Set(group.flatMap(c => c.keywords || []))];

            suggestions.push({
                chunks: group,
                suggestedName: `Group ${suggestions.length + 1}`,
                keywords: allKeywords.slice(0, 5) // Top 5 keywords
            });

            group.forEach(c => grouped.add(c.hash));
        }
    });

    console.log(`📦 [Groups] Suggested ${suggestions.length} potential groups`);

    return suggestions;
}

export default {
    buildGroupIndex,
    applyGroupBoosts,
    enforceRequiredGroups,
    getChunksByGroup,
    getGroupStats,
    validateChunkGroup,
    suggestGroups
};
