// =============================================================================
// SEARCH ORCHESTRATOR
// Coordinates all search enhancements: dual-vector, importance, conditions, groups, decay
// =============================================================================

import { filterChunksBySearchMode, expandSummaryChunks, mergeSearchResults } from './dual-vector.js';
import { applyImportanceToResults, rankChunksByImportance } from './importance-weighting.js';
import { filterChunksByConditions, buildSearchContext } from './conditional-activation.js';
import { applyGroupBoosts, enforceRequiredGroups } from './chunk-groups.js';
import { applyDecayToResults, applySceneAwareDecay } from './temporal-decay.js';

/**
 * Enhanced search pipeline that applies all features in correct order
 * @param {Object} params - Search parameters
 * @returns {Array} Final ranked results
 */
export async function performEnhancedSearch(params) {
    const {
        // Core search
        queryText,
        allChunks,          // All available chunks (hash-indexed object)
        searchFunction,      // Function to call vector search API
        topK = 5,
        threshold = 0.15,

        // Search mode
        summarySearchMode = 'both',  // 'summary', 'full', or 'both'

        // Context
        chat = [],
        currentMessageId = 0,
        contextWindow = 10,

        // Feature settings
        enableImportance = true,
        enableConditions = true,
        enableGroups = true,
        enableDecay = false,

        // Temporal decay settings
        decaySettings = { enabled: false },

        // Scene data (for scene-aware decay)
        scenes = [],

        // Chat metadata (for advanced conditions)
        metadata = {},

        // Options
        usePriorityTiers = false,
        groupBoostMultiplier = 1.3,
        maxForcedGroupMembers = 5
    } = params;

    console.log('🔍 [SearchOrchestrator] Starting enhanced search...', {
        query: queryText.substring(0, 50) + '...',
        summarySearchMode,
        features: { importance: enableImportance, conditions: enableConditions, groups: enableGroups, decay: enableDecay }
    });

    // Step 1: Filter chunks by search mode (summary/full/both)
    const chunksArray = Object.values(allChunks);
    const searchableChunks = filterChunksBySearchMode(chunksArray, summarySearchMode);

    console.log(`🔍 [SearchOrchestrator] Step 1: Filtered to ${searchableChunks.length} chunks (mode: ${summarySearchMode})`);

    // Step 2: Perform vector search
    let results;

    if (summarySearchMode === 'both') {
        // Dual search: query both summary and full text, then merge
        const summaryChunks = searchableChunks.filter(c => c.isSummaryChunk);
        const fullChunks = searchableChunks.filter(c => !c.isSummaryChunk);

        const [summaryResults, fullResults] = await Promise.all([
            searchFunction(queryText, summaryChunks, topK, threshold),
            searchFunction(queryText, fullChunks, topK, threshold)
        ]);

        results = mergeSearchResults(summaryResults, fullResults);
    } else {
        // Single search
        results = await searchFunction(queryText, searchableChunks, topK, threshold);
    }

    console.log(`🔍 [SearchOrchestrator] Step 2: Vector search returned ${results.length} chunks`);

    // Step 3: Expand summary chunks to include parents
    if (summarySearchMode !== 'full') {
        results = expandSummaryChunks(results, allChunks);
        console.log(`🔍 [SearchOrchestrator] Step 3: Expanded to ${results.length} chunks (with parents)`);
    }

    // Step 4: Apply conditional activation filtering
    if (enableConditions) {
        const searchContext = buildSearchContext(chat, contextWindow, results, metadata);
        results = filterChunksByConditions(results, searchContext);
        console.log(`🔍 [SearchOrchestrator] Step 4: Conditions filtered to ${results.length} chunks`);
    }

    // Step 5: Apply group keyword matching and boosts
    if (enableGroups) {
        results = applyGroupBoosts(results, queryText, groupBoostMultiplier);
        console.log(`🔍 [SearchOrchestrator] Step 5: Group boosts applied`);
    }

    // Step 6: Apply importance weighting
    if (enableImportance) {
        results = applyImportanceToResults(results);
        console.log(`🔍 [SearchOrchestrator] Step 6: Importance weighting applied`);
    }

    // Step 7: Apply temporal decay (chat only, optional)
    if (enableDecay && decaySettings.enabled) {
        if (decaySettings.sceneAware && scenes.length > 0) {
            results = applySceneAwareDecay(results, currentMessageId, scenes, decaySettings);
        } else {
            results = applyDecayToResults(results, currentMessageId, decaySettings);
        }
        console.log(`🔍 [SearchOrchestrator] Step 7: Temporal decay applied`);
    }

    // Step 8: Re-rank based on adjusted scores
    if (enableImportance) {
        results = rankChunksByImportance(results, usePriorityTiers);
        console.log(`🔍 [SearchOrchestrator] Step 8: Re-ranked by importance`);
    } else {
        results = results.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    // Step 9: Enforce required group members
    if (enableGroups) {
        results = enforceRequiredGroups(results, chunksArray, maxForcedGroupMembers);
        console.log(`🔍 [SearchOrchestrator] Step 9: Required groups enforced`);
    }

    // Step 10: Limit to topK
    results = results.slice(0, topK);

    console.log(`🔍 [SearchOrchestrator] Final: ${results.length} chunks selected`);

    return results;
}

/**
 * Simpler search for when features are disabled
 * @param {Object} params - Search parameters
 * @returns {Array} Results
 */
export async function performBasicSearch(params) {
    const {
        queryText,
        allChunks,
        searchFunction,
        topK = 5,
        threshold = 0.15
    } = params;

    const chunksArray = Object.values(allChunks);
    const results = await searchFunction(queryText, chunksArray, topK, threshold);

    return results.slice(0, topK);
}

/**
 * Determines which search mode to use based on settings
 * @param {Object} settings - RAG settings
 * @returns {Function} Search function to use
 */
export function getSearchFunction(settings) {
    // Check if any enhanced features are enabled
    const hasEnhancements = settings.enableImportance ||
                           settings.enableConditions ||
                           settings.enableGroups ||
                           settings.enableDecay;

    return hasEnhancements ? performEnhancedSearch : performBasicSearch;
}

/**
 * Builds search parameters from various sources
 * @param {Object} options - Options object
 * @returns {Object} Complete search parameters
 */
export function buildSearchParams(options) {
    const {
        queryText,
        allChunks,
        searchFunction,
        settings,
        chat,
        scenes = []
    } = options;

    // Get current message ID
    const currentMessageId = chat.length - 1;

    // Build decay settings from chat metadata if available
    const decaySettings = settings.temporalDecay || { enabled: false };

    return {
        queryText,
        allChunks,
        searchFunction,
        topK: settings.topK || 5,
        threshold: settings.threshold || 0.15,
        summarySearchMode: settings.summarySearchMode || 'both',
        chat,
        currentMessageId,
        contextWindow: settings.contextWindow || 10,
        enableImportance: settings.enableImportance !== false,
        enableConditions: settings.enableConditions !== false,
        enableGroups: settings.enableGroups !== false,
        enableDecay: decaySettings.enabled === true,
        decaySettings,
        scenes,
        usePriorityTiers: settings.usePriorityTiers === true,
        groupBoostMultiplier: settings.groupBoostMultiplier || 1.3,
        maxForcedGroupMembers: settings.maxForcedGroupMembers || 5
    };
}

export default {
    performEnhancedSearch,
    performBasicSearch,
    getSearchFunction,
    buildSearchParams
};
