// =============================================================================
// DUAL-VECTOR SUMMARY SYSTEM
// Handles creation of summary chunks and dual-vector search
// =============================================================================

import { getStringHash } from '../../../utils.js';

/**
 * Creates summary chunks for chunks with summaryVector enabled
 * @param {Array} chunks - Original chunks
 * @returns {Array} Original chunks + summary chunks
 */
export function createSummaryChunks(chunks) {
    const summaryChunks = [];

    chunks.forEach((chunk, index) => {
        // Only create summary chunk if:
        // 1. Summary exists
        // 2. summaryVector flag is true
        // 3. Not already a summary chunk
        if (chunk.summary && chunk.summaryVector && !chunk.isSummaryChunk) {
            const summaryHash = getStringHash(`${chunk.hash}_summary`);

            const summaryChunk = {
                text: chunk.summary,
                hash: summaryHash,
                index: chunks.length + summaryChunks.length,
                metadata: {
                    ...chunk.metadata,
                    isSummaryFor: chunk.hash
                },
                // Core fields
                section: chunk.section,
                topic: chunk.topic ? `${chunk.topic} (Summary)` : 'Summary',
                comment: chunk.comment ? `${chunk.comment} (Summary)` : '',
                // Keyword system - inherit from parent
                keywords: chunk.keywords || [],
                systemKeywords: chunk.systemKeywords || [],
                customKeywords: chunk.customKeywords || [],
                customWeights: chunk.customWeights || {},
                disabledKeywords: chunk.disabledKeywords || [],
                // Summary flags
                isSummaryChunk: true,
                parentHash: chunk.hash,
                summaryVector: false, // Don't create summary of summary
                summary: '',
                // Link summary to parent (force link so parent always comes with summary)
                chunkLinks: [{ targetHash: chunk.hash, mode: 'force' }],
                // Other fields
                importance: chunk.importance || 100,
                conditions: chunk.conditions || { enabled: false, mode: 'AND', rules: [] },
                chunkGroup: chunk.chunkGroup || { name: '', groupKeywords: [], requiresGroupMember: false },
                inclusionGroup: '',
                inclusionPrioritize: false,
                disabled: false
            };

            summaryChunks.push(summaryChunk);
        }
    });

    console.log(`📚 [DualVector] Created ${summaryChunks.length} summary chunks from ${chunks.length} chunks`);
    return [...chunks, ...summaryChunks];
}

/**
 * Filters chunks based on search mode
 * @param {Array} chunks - All chunks
 * @param {string} searchMode - 'summary', 'full', or 'both'
 * @returns {Array} Filtered chunks
 */
export function filterChunksBySearchMode(chunks, searchMode) {
    if (searchMode === 'summary') {
        // Only summary chunks
        return chunks.filter(chunk => chunk.isSummaryChunk);
    } else if (searchMode === 'full') {
        // Only full text chunks (no summaries)
        return chunks.filter(chunk => !chunk.isSummaryChunk);
    } else {
        // Both - return all chunks
        return chunks;
    }
}

/**
 * Processes chat scenes to create scene chunks with optional summary chunks
 * @param {Array} messages - Chat messages
 * @param {Array} scenes - Scene metadata from chat_metadata.ragbooks_scenes
 * @param {Object} config - Chat vectorization config
 * @returns {Array} Scene chunks (and summary chunks if enabled)
 */
export function processScenesToChunks(messages, scenes, config) {
    const chunks = [];
    let skippedOpen = 0;
    let skippedInvalid = 0;

    scenes.forEach((scene, idx) => {
        // Skip open scenes or invalid scenes
        if (scene.end === null) {
            skippedOpen++;
            console.warn(`⚠️ [DualVector] Skipping scene ${idx + 1}: Still open (no end marker)`);
            return;
        }
        if (scene.start > scene.end) {
            skippedInvalid++;
            console.warn(`⚠️ [DualVector] Skipping scene ${idx + 1}: Invalid range (start ${scene.start} > end ${scene.end})`);
            return;
        }

        // Get scene messages
        const sceneMessages = messages.slice(scene.start, scene.end + 1);
        if (sceneMessages.length === 0) return;

        // Build scene text
        const sceneText = sceneMessages.map(m => m.mes).join('\n\n');
        const sceneHash = getStringHash(`scene_${scene.start}_${scene.end}_${sceneText}`);

        // Create main scene chunk
        const sceneChunk = {
            text: sceneText,
            hash: sceneHash,
            index: chunks.length,
            metadata: {
                source: 'chat',
                sceneIndex: idx,
                sceneStart: scene.start,
                sceneEnd: scene.end,
                sceneTitle: scene.title || `Scene ${idx + 1}`,
                messageCount: sceneMessages.length
            },
            section: scene.title || `Scene ${idx + 1}`,
            topic: `Messages ${scene.start}-${scene.end}`,
            comment: '',
            keywords: scene.keywords || [],
            systemKeywords: scene.keywords || [],
            customKeywords: [],
            customWeights: {},
            disabledKeywords: [],
            summary: scene.summary || '',
            summaryVector: scene.summaryVector !== false,
            isSummaryChunk: false,
            parentHash: null,
            importance: 100,
            conditions: { enabled: false, mode: 'AND', rules: [] },
            chunkGroup: { name: '', groupKeywords: [], requiresGroupMember: false },
            chunkLinks: [],
            inclusionGroup: '',
            inclusionPrioritize: false,
            disabled: false
        };

        chunks.push(sceneChunk);
    });

    const totalScenes = scenes.length;
    const processedScenes = chunks.length;
    console.log(`📚 [DualVector] Processed ${processedScenes}/${totalScenes} scenes into chunks`);
    if (skippedOpen > 0) {
        console.log(`   ⚠️ Skipped ${skippedOpen} open scene(s) (not yet closed)`);
    }
    if (skippedInvalid > 0) {
        console.log(`   ⚠️ Skipped ${skippedInvalid} invalid scene(s) (start > end)`);
    }

    // Create summary chunks for scenes that have summaries
    const allChunks = createSummaryChunks(chunks);

    return allChunks;
}

/**
 * Merges search results from summary and full text searches using Reciprocal Rank Fusion
 * @param {Array} summaryResults - Results from summary search
 * @param {Array} fullResults - Results from full text search
 * @param {number} k - RRF constant (default 60)
 * @returns {Array} Merged and re-ranked results
 */
export function mergeSearchResults(summaryResults, fullResults, k = 60) {
    const scoreMap = new Map();

    // Process summary results (higher weight)
    summaryResults.forEach((result, rank) => {
        const hash = result.hash;
        const rrfScore = 1 / (k + rank + 1);
        scoreMap.set(hash, (scoreMap.get(hash) || 0) + rrfScore * 1.5); // 1.5x weight for summary matches
    });

    // Process full text results
    fullResults.forEach((result, rank) => {
        const hash = result.hash;
        const rrfScore = 1 / (k + rank + 1);
        scoreMap.set(hash, (scoreMap.get(hash) || 0) + rrfScore);
    });

    // Combine all unique chunks and sort by RRF score
    const allChunks = new Map();
    [...summaryResults, ...fullResults].forEach(result => {
        if (!allChunks.has(result.hash)) {
            allChunks.set(result.hash, result);
        }
    });

    const merged = Array.from(allChunks.values())
        .map(chunk => ({
            ...chunk,
            rrfScore: scoreMap.get(chunk.hash) || 0
        }))
        .sort((a, b) => b.rrfScore - a.rrfScore);

    console.log(`📚 [DualVector] Merged ${summaryResults.length} summary + ${fullResults.length} full results = ${merged.length} unique chunks`);

    return merged;
}

/**
 * Expands summary chunks to include their parent full chunks
 * @param {Array} chunks - Chunks that may include summary chunks
 * @param {Object} allChunks - Map of all available chunks by hash
 * @returns {Array} Chunks with parents expanded
 */
export function expandSummaryChunks(chunks, allChunks) {
    const expanded = [];
    const seen = new Set();

    chunks.forEach(chunk => {
        // Add the chunk itself
        if (!seen.has(chunk.hash)) {
            expanded.push(chunk);
            seen.add(chunk.hash);
        }

        // If it's a summary chunk, also add its parent
        if (chunk.isSummaryChunk && chunk.parentHash) {
            const parent = allChunks[chunk.parentHash];
            if (parent && !seen.has(parent.hash)) {
                expanded.push(parent);
                seen.add(parent.hash);
            }
        }
    });

    return expanded;
}

export default {
    createSummaryChunks,
    filterChunksBySearchMode,
    processScenesToChunks,
    mergeSearchResults,
    expandSummaryChunks
};
