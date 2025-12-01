/**
 * ============================================================================
 * CHUNK GROUPS SYSTEM
 * ============================================================================
 * Groups chunks together for collective activation or mutual exclusion.
 *
 * Modes:
 * - Inclusive: When any member matches, affect other members
 *   - Soft link: Other members get score boost
 *   - Hard link: Other members are force-included
 * - Exclusive: Only highest-scoring member passes through
 *   - Normal: No guarantee any member is included
 *   - Mandatory: At least one member MUST be included
 *
 * Groups are stored in collection metadata and expanded at search time.
 * Inclusive mode reuses the existing chunk link system.
 *
 * @author VectHare Team
 * @version 1.0.0
 * ============================================================================
 */

/**
 * @typedef {Object} ChunkGroup
 * @property {string} id - Unique group identifier (UUID)
 * @property {string} name - Display name for the group
 * @property {'inclusive'|'exclusive'} mode - Group behavior mode
 * @property {'soft'|'hard'} [linkType] - Link type for inclusive mode
 * @property {boolean} [mandatory] - For exclusive mode: must include at least one
 * @property {number} [boost] - Score boost for inclusive+soft (default 0.15)
 * @property {string[]} members - Array of chunk hashes in this group
 */

/**
 * Generates virtual links from group membership for inclusive mode.
 * These links are then processed by the existing processChunkLinks() function.
 *
 * @param {ChunkGroup[]} groups - Array of group definitions
 * @param {Set<string>} matchedHashes - Hashes of chunks that matched the search
 * @returns {Map<string, Array>} Map of hash -> virtual links to add
 */
export function expandInclusiveGroups(groups, matchedHashes) {
    const virtualLinks = new Map();

    for (const group of groups) {
        if (group.mode !== 'inclusive') continue;
        if (!group.members || group.members.length < 2) continue;

        // Check if any member matched
        const matchedMembers = group.members.filter(hash => matchedHashes.has(String(hash)));
        if (matchedMembers.length === 0) continue;

        const linkType = group.linkType || 'soft';

        // For each matched member, create links to all OTHER members
        for (const sourceHash of matchedMembers) {
            for (const targetHash of group.members) {
                if (String(targetHash) === String(sourceHash)) continue;

                // Add virtual link from source to target
                if (!virtualLinks.has(String(sourceHash))) {
                    virtualLinks.set(String(sourceHash), []);
                }

                virtualLinks.get(String(sourceHash)).push({
                    target: String(targetHash),
                    type: linkType,
                    fromGroup: group.id,
                    groupName: group.name,
                });
            }
        }

        console.log(`VectHare Groups: Inclusive group "${group.name}" triggered by ${matchedMembers.length} member(s), creating ${linkType} links to ${group.members.length - matchedMembers.length} other member(s)`);
    }

    return virtualLinks;
}

/**
 * Applies exclusive group filtering - keeps only the highest-scoring member
 * from each exclusive group.
 *
 * @param {Object[]} chunks - Array of scored chunks from search
 * @param {ChunkGroup[]} groups - Array of group definitions
 * @returns {Object} { chunks: filtered chunks, excluded: excluded chunk info }
 */
export function applyExclusiveGroups(chunks, groups) {
    const exclusiveGroups = groups.filter(g => g.mode === 'exclusive');
    if (exclusiveGroups.length === 0) {
        return { chunks, excluded: [] };
    }

    const chunkMap = new Map(chunks.map(c => [String(c.hash), c]));
    const excluded = [];
    const excludedHashes = new Set();

    for (const group of exclusiveGroups) {
        if (!group.members || group.members.length < 2) continue;

        // Find all members that are in the current results
        const presentMembers = group.members
            .map(hash => chunkMap.get(String(hash)))
            .filter(Boolean);

        if (presentMembers.length <= 1) continue;

        // Sort by score descending, keep only the best
        presentMembers.sort((a, b) => (b.score || 0) - (a.score || 0));
        const winner = presentMembers[0];
        const losers = presentMembers.slice(1);

        for (const loser of losers) {
            excludedHashes.add(String(loser.hash));
            excluded.push({
                hash: loser.hash,
                score: loser.score,
                groupId: group.id,
                groupName: group.name,
                beatBy: winner.hash,
                winnerScore: winner.score,
            });
        }

        console.log(`VectHare Groups: Exclusive group "${group.name}" - kept chunk ${String(winner.hash).substring(0, 8)}... (score: ${winner.score?.toFixed(3)}), excluded ${losers.length} lower-scoring member(s)`);
    }

    const filteredChunks = chunks.filter(c => !excludedHashes.has(String(c.hash)));

    return {
        chunks: filteredChunks,
        excluded,
    };
}

/**
 * Enforces mandatory exclusive groups - ensures at least one member is included.
 * Called after exclusion filtering to add back a member if none made it through.
 *
 * @param {Object[]} chunks - Current result chunks (after exclusion)
 * @param {ChunkGroup[]} groups - Array of group definitions
 * @param {Map<string, Object>} allChunksMap - Map of all available chunks (hash -> chunk)
 * @returns {Object} { chunks: with mandatory members added, forced: info about forced chunks }
 */
export function enforceMandatoryGroups(chunks, groups, allChunksMap) {
    const mandatoryGroups = groups.filter(g => g.mode === 'exclusive' && g.mandatory);
    if (mandatoryGroups.length === 0) {
        return { chunks, forced: [] };
    }

    const resultHashes = new Set(chunks.map(c => String(c.hash)));
    const forced = [];
    const toAdd = [];

    for (const group of mandatoryGroups) {
        if (!group.members || group.members.length === 0) continue;

        // Check if any member is already in results
        const hasRepresentative = group.members.some(hash => resultHashes.has(String(hash)));
        if (hasRepresentative) continue;

        // No member present - find the best available one
        const availableMembers = group.members
            .map(hash => allChunksMap.get(String(hash)))
            .filter(Boolean)
            .filter(c => !c.disabled);

        if (availableMembers.length === 0) {
            console.warn(`VectHare Groups: Mandatory group "${group.name}" has no available members to include`);
            continue;
        }

        // If we have scores, pick highest; otherwise pick first
        availableMembers.sort((a, b) => (b.score || 0) - (a.score || 0));
        const chosen = availableMembers[0];

        toAdd.push({
            ...chosen,
            forcedByGroup: group.id,
            forcedByGroupName: group.name,
        });

        forced.push({
            hash: chosen.hash,
            groupId: group.id,
            groupName: group.name,
            reason: 'mandatory_exclusive',
        });

        resultHashes.add(String(chosen.hash));

        console.log(`VectHare Groups: Mandatory group "${group.name}" - force-included chunk ${String(chosen.hash).substring(0, 8)}...`);
    }

    return {
        chunks: [...chunks, ...toAdd],
        forced,
    };
}

/**
 * Main entry point: processes all group logic for a set of search results.
 *
 * @param {Object[]} chunks - Scored chunks from search
 * @param {ChunkGroup[]} groups - Group definitions from collection metadata
 * @param {Map<string, Object>} allChunksMap - Map of all chunks for mandatory lookup
 * @param {Object} options - Processing options
 * @param {number} [options.softBoost=0.15] - Default boost for inclusive+soft
 * @returns {Object} Processed result with debug info
 */
export function processChunkGroups(chunks, groups, allChunksMap, options = {}) {
    if (!groups || groups.length === 0) {
        return {
            chunks,
            debug: { groupsProcessed: 0 },
        };
    }

    // Note: softBoost is passed through options but applied by caller via processChunkLinks()
    const matchedHashes = new Set(chunks.map(c => String(c.hash)));

    // Step 1: Expand inclusive groups into virtual links
    const virtualLinks = expandInclusiveGroups(groups, matchedHashes);

    // Step 2: Apply exclusive group filtering
    const exclusionResult = applyExclusiveGroups(chunks, groups);
    let processedChunks = exclusionResult.chunks;

    // Step 3: Enforce mandatory exclusive groups
    const mandatoryResult = enforceMandatoryGroups(processedChunks, groups, allChunksMap);
    processedChunks = mandatoryResult.chunks;

    return {
        chunks: processedChunks,
        virtualLinks, // Caller should merge these with chunk metadata for processChunkLinks()
        debug: {
            groupsProcessed: groups.length,
            inclusiveGroups: groups.filter(g => g.mode === 'inclusive').length,
            exclusiveGroups: groups.filter(g => g.mode === 'exclusive').length,
            mandatoryGroups: groups.filter(g => g.mode === 'exclusive' && g.mandatory).length,
            excluded: exclusionResult.excluded,
            forced: mandatoryResult.forced,
            virtualLinksCreated: [...virtualLinks.values()].reduce((sum, arr) => sum + arr.length, 0),
        },
    };
}

/**
 * Merges virtual links from groups into chunk metadata map.
 * Call this before processChunkLinks() to include group-generated links.
 *
 * @param {Map<string, Object>} chunkMetadataMap - Existing metadata map (hash -> metadata)
 * @param {Map<string, Array>} virtualLinks - Virtual links from expandInclusiveGroups()
 * @returns {Map<string, Object>} Merged metadata map
 */
export function mergeVirtualLinks(chunkMetadataMap, virtualLinks) {
    const merged = new Map(chunkMetadataMap);

    for (const [hash, links] of virtualLinks) {
        const existing = merged.get(hash) || {};
        const existingLinks = existing.links || [];

        merged.set(hash, {
            ...existing,
            links: [...existingLinks, ...links],
        });
    }

    return merged;
}

/**
 * Validates a group definition.
 *
 * @param {ChunkGroup} group - Group to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateGroup(group) {
    const errors = [];

    if (!group.id) {
        errors.push('Group must have an ID');
    }

    if (!group.name || group.name.trim() === '') {
        errors.push('Group must have a name');
    }

    if (!['inclusive', 'exclusive'].includes(group.mode)) {
        errors.push('Group mode must be "inclusive" or "exclusive"');
    }

    if (group.mode === 'inclusive') {
        if (!['soft', 'hard'].includes(group.linkType)) {
            errors.push('Inclusive groups must specify linkType as "soft" or "hard"');
        }
        if (group.linkType === 'soft' && group.boost !== undefined) {
            if (typeof group.boost !== 'number' || group.boost < 0 || group.boost > 1) {
                errors.push('Boost must be a number between 0 and 1');
            }
        }
    }

    if (!Array.isArray(group.members)) {
        errors.push('Group must have a members array');
    } else if (group.members.length < 2) {
        errors.push('Group must have at least 2 members');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Creates a new empty group with defaults.
 *
 * @param {string} name - Group name
 * @param {'inclusive'|'exclusive'} mode - Group mode
 * @returns {ChunkGroup} New group object
 */
export function createGroup(name, mode = 'inclusive') {
    return {
        id: crypto.randomUUID(),
        name: name || 'New Group',
        mode,
        linkType: mode === 'inclusive' ? 'soft' : undefined,
        mandatory: mode === 'exclusive' ? false : undefined,
        boost: mode === 'inclusive' ? 0.15 : undefined,
        members: [],
    };
}

/**
 * Gets statistics about groups in a collection.
 *
 * @param {ChunkGroup[]} groups - Array of groups
 * @returns {Object} Statistics
 */
export function getGroupStats(groups) {
    if (!groups || groups.length === 0) {
        return {
            totalGroups: 0,
            inclusiveGroups: 0,
            exclusiveGroups: 0,
            mandatoryGroups: 0,
            totalMembers: 0,
            avgGroupSize: 0,
        };
    }

    const stats = {
        totalGroups: groups.length,
        inclusiveGroups: groups.filter(g => g.mode === 'inclusive').length,
        exclusiveGroups: groups.filter(g => g.mode === 'exclusive').length,
        mandatoryGroups: groups.filter(g => g.mode === 'exclusive' && g.mandatory).length,
        softLinkGroups: groups.filter(g => g.mode === 'inclusive' && g.linkType === 'soft').length,
        hardLinkGroups: groups.filter(g => g.mode === 'inclusive' && g.linkType === 'hard').length,
        totalMembers: groups.reduce((sum, g) => sum + (g.members?.length || 0), 0),
        avgGroupSize: 0,
    };

    stats.avgGroupSize = stats.totalGroups > 0
        ? (stats.totalMembers / stats.totalGroups).toFixed(1)
        : 0;

    return stats;
}

export default {
    expandInclusiveGroups,
    applyExclusiveGroups,
    enforceMandatoryGroups,
    processChunkGroups,
    mergeVirtualLinks,
    validateGroup,
    createGroup,
    getGroupStats,
};
