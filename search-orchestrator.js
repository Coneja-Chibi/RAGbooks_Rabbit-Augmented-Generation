// =============================================================================
// SEARCH ORCHESTRATOR
// Coordinates all search enhancements: importance, conditions, groups, decay
// Summary chunks handled via chunk linking (no separate dual-vector search needed)
// =============================================================================

import { applyImportanceToResults, rankChunksByImportance } from './importance-weighting.js';
import { filterChunksByConditions, buildSearchContext } from './conditional-activation.js';
import { applyGroupBoosts, enforceRequiredGroups } from './chunk-groups.js';
import { applyDecayToResults, applySceneAwareDecay } from './temporal-decay.js';
import { ragLogger, logSearchStart, logSearchStep, logSearchEnd } from './logging-utils.js';

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
        threshold = 0.80,

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

    // Start grouped logging
    logSearchStart(queryText, 'unified', {
        importance: enableImportance,
        conditions: enableConditions,
        groups: enableGroups,
        decay: enableDecay
    });

    // Step 1: Search ALL chunks together (summaries + full text)
    // Chunk linking system will automatically pull parents when summaries match
    const chunksArray = Object.values(allChunks);
    logSearchStep(1, `Searching ${chunksArray.length} chunks (includes summaries)`);

    // Step 2: Perform single vector search on all chunks
    let results = await searchFunction(queryText, chunksArray, topK, threshold);
    logSearchStep(2, `Vector search returned ${results.length} chunks`);

    // Step 3: Apply conditional activation filtering
    if (enableConditions) {
        const searchContext = buildSearchContext(chat, contextWindow, results, metadata);
        results = filterChunksByConditions(results, searchContext);
        logSearchStep(4, `Conditions filtered to ${results.length} chunks`);
    }

    // Step 4: Apply group keyword matching and boosts
    if (enableGroups) {
        results = applyGroupBoosts(results, queryText, groupBoostMultiplier);
        logSearchStep(5, 'Group boosts applied');
    }

    // Step 5: Apply importance weighting
    if (enableImportance) {
        results = applyImportanceToResults(results);
        logSearchStep(6, 'Importance weighting applied');
    }

    // Step 6: Apply temporal decay (chat only, optional)
    if (enableDecay && decaySettings.enabled) {
        if (decaySettings.sceneAware && scenes.length > 0) {
            results = applySceneAwareDecay(results, currentMessageId, scenes, decaySettings);
        } else {
            results = applyDecayToResults(results, currentMessageId, decaySettings);
        }
        logSearchStep(7, 'Temporal decay applied');
    }

    // Step 7: Re-rank based on adjusted scores
    if (enableImportance) {
        results = rankChunksByImportance(results, usePriorityTiers);
        logSearchStep(8, 'Re-ranked by importance');
    } else {
        results = results.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    // Step 8: Enforce required group members
    if (enableGroups) {
        results = enforceRequiredGroups(results, chunksArray, maxForcedGroupMembers);
        logSearchStep(9, 'Required groups enforced');
    }

    // Step 9: Limit to topK
    results = results.slice(0, topK);
    logSearchStep(10, `Limited to top ${topK} chunks`);

    // End grouped logging with chunk details
    logSearchEnd(results.length, results);

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
        threshold = 0.80
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
        threshold: settings.threshold || 0.80,
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
