// =============================================================================
// TEMPORAL WEIGHTING SYSTEM
// Adjusts relevance of chunks based on age (optional, OFF by default)
// - Decay: Reduces relevance of older chunks (recency bias)
// - Nostalgia: Boosts relevance of older chunks (history bias)
// Chunks marked as "temporally blind" are immune to weighting
// =============================================================================

import { isChunkTemporallyBlind } from './collection-metadata.js';
import { DEFAULT_DECAY_HALF_LIFE, DEFAULT_DECAY_FLOOR, DEFAULT_NOSTALGIA_HALF_LIFE, DEFAULT_NOSTALGIA_MAX_BOOST } from './constants.js';

/**
 * Calculates exponential decay multiplier
 * @param {number} age - Age in messages
 * @param {number} halfLife - Half-life in messages
 * @returns {number} Decay multiplier (0-1)
 */
function calculateExponentialDecay(age, halfLife) {
    return Math.pow(0.5, age / halfLife);
}

/**
 * Calculates linear decay multiplier
 * @param {number} age - Age in messages
 * @param {number} rate - Decay rate per message
 * @returns {number} Decay multiplier (0-1)
 */
function calculateLinearDecay(age, rate) {
    return Math.max(0, 1 - (age * rate));
}

/**
 * Calculates exponential nostalgia boost multiplier
 * Older chunks get boosted, approaching maxBoost asymptotically
 * @param {number} age - Age in messages
 * @param {number} halfLife - Messages until 50% of max boost is reached
 * @param {number} maxBoost - Maximum boost multiplier (e.g., 1.5 = 50% boost)
 * @returns {number} Nostalgia multiplier (1.0 to maxBoost)
 */
function calculateExponentialNostalgia(age, halfLife, maxBoost) {
    // Inverse of decay: starts at 1.0, approaches maxBoost
    // At age=halfLife, multiplier is halfway between 1.0 and maxBoost
    const boostRange = maxBoost - 1.0;
    const progress = 1 - Math.pow(0.5, age / halfLife);
    return 1.0 + (boostRange * progress);
}

/**
 * Calculates linear nostalgia boost multiplier
 * @param {number} age - Age in messages
 * @param {number} rate - Boost rate per message
 * @param {number} maxBoost - Maximum boost multiplier
 * @returns {number} Nostalgia multiplier (1.0 to maxBoost)
 */
function calculateLinearNostalgia(age, rate, maxBoost) {
    return Math.min(maxBoost, 1.0 + (age * rate));
}

/**
 * Applies temporal decay to a chunk's score
 * @param {number} score - Original score
 * @param {number} messageAge - Age in messages
 * @param {Object} decaySettings - Decay configuration
 * @returns {number} Score with decay applied
 */
export function applyTemporalDecay(score, messageAge, decaySettings) {
    if (!decaySettings.enabled || messageAge === 0) {
        return score;
    }

    let decayMultiplier = 1.0;

    if (decaySettings.mode === 'exponential') {
        const halfLife = decaySettings.halfLife || 50;
        decayMultiplier = calculateExponentialDecay(messageAge, halfLife);
    } else if (decaySettings.mode === 'linear') {
        const rate = decaySettings.linearRate || 0.01;
        decayMultiplier = calculateLinearDecay(messageAge, rate);
    }

    // Enforce minimum relevance
    const minRelevance = decaySettings.minRelevance || 0.3;
    decayMultiplier = Math.max(decayMultiplier, minRelevance);

    return score * decayMultiplier;
}

/**
 * Applies nostalgia boost to a chunk's score (opposite of decay)
 * @param {number} score - Original score
 * @param {number} messageAge - Age in messages
 * @param {Object} nostalgiaSettings - Nostalgia configuration
 * @returns {number} Score with nostalgia boost applied
 */
export function applyNostalgiaBoost(score, messageAge, nostalgiaSettings) {
    if (!nostalgiaSettings.enabled || messageAge === 0) {
        return score;
    }

    let boostMultiplier = 1.0;
    const maxBoost = nostalgiaSettings.maxBoost || DEFAULT_NOSTALGIA_MAX_BOOST;

    if (nostalgiaSettings.mode === 'exponential') {
        const halfLife = nostalgiaSettings.halfLife || DEFAULT_NOSTALGIA_HALF_LIFE;
        boostMultiplier = calculateExponentialNostalgia(messageAge, halfLife, maxBoost);
    } else if (nostalgiaSettings.mode === 'linear') {
        const rate = nostalgiaSettings.linearRate || 0.005;
        boostMultiplier = calculateLinearNostalgia(messageAge, rate, maxBoost);
    }

    return score * boostMultiplier;
}

/**
 * Applies nostalgia boost to all chunks in search results
 * Only applies to chat chunks with message metadata
 * Skips chunks marked as temporally blind
 * @param {Array} chunks - Array of chunks with scores
 * @param {number} currentMessageId - Current message ID in chat
 * @param {Object} nostalgiaSettings - Nostalgia configuration
 * @returns {Array} Chunks with nostalgia boost applied
 */
export function applyNostalgiaToResults(chunks, currentMessageId, nostalgiaSettings) {
    if (!nostalgiaSettings.enabled) {
        return chunks;
    }

    let blindCount = 0;
    const boosted = chunks.map(chunk => {
        // Only apply to chat chunks (messageId can be 0, so check for undefined/null)
        if (chunk.metadata?.source !== 'chat' || chunk.metadata?.messageId === undefined || chunk.metadata?.messageId === null) {
            return chunk;
        }

        // Check if chunk is temporally blind (immune to weighting)
        const chunkHash = chunk.hash || chunk.metadata?.hash;
        if (chunkHash && isChunkTemporallyBlind(chunkHash)) {
            blindCount++;
            return {
                ...chunk,
                temporallyBlind: true,
                nostalgiaApplied: false,
            };
        }

        const messageAge = currentMessageId - chunk.metadata.messageId;
        const originalScore = chunk.score || 0;
        const boostedScore = applyNostalgiaBoost(originalScore, messageAge, nostalgiaSettings);

        return {
            ...chunk,
            score: boostedScore,
            originalScore,
            messageAge,
            nostalgiaApplied: true,
        };
    });

    const affectedCount = boosted.filter(c => c.nostalgiaApplied).length;
    console.log(`🕰️ [Nostalgia] Applied nostalgia boost to ${affectedCount} chat chunks (${blindCount} temporally blind, skipped)`);

    return boosted;
}

/**
 * Applies temporal decay to all chunks in search results
 * Only applies to chat chunks with message metadata
 * Skips chunks marked as temporally blind
 * @param {Array} chunks - Array of chunks with scores
 * @param {number} currentMessageId - Current message ID in chat
 * @param {Object} decaySettings - Decay configuration
 * @returns {Array} Chunks with decay applied
 */
export function applyDecayToResults(chunks, currentMessageId, decaySettings) {
    if (!decaySettings.enabled) {
        return chunks;
    }

    let blindCount = 0;
    const decayed = chunks.map(chunk => {
        // Only apply decay to chat chunks (messageId can be 0, so check for undefined/null)
        if (chunk.metadata?.source !== 'chat' || chunk.metadata?.messageId === undefined || chunk.metadata?.messageId === null) {
            return chunk;
        }

        // Check if chunk is temporally blind (immune to decay)
        const chunkHash = chunk.hash || chunk.metadata?.hash;
        if (chunkHash && isChunkTemporallyBlind(chunkHash)) {
            blindCount++;
            return {
                ...chunk,
                temporallyBlind: true,
                decayApplied: false,
            };
        }

        const messageAge = currentMessageId - chunk.metadata.messageId;
        const originalScore = chunk.score || 0;
        const decayedScore = applyTemporalDecay(originalScore, messageAge, decaySettings);

        return {
            ...chunk,
            score: decayedScore,
            originalScore,
            messageAge,
            decayApplied: true,
        };
    });

    const affectedCount = decayed.filter(c => c.decayApplied).length;
    console.log(`⏳ [Decay] Applied temporal decay to ${affectedCount} chat chunks (${blindCount} temporally blind, skipped)`);

    return decayed;
}

/**
 * Checks if a chunk is affected by scene-aware decay reset
 * @param {number} messageId - Message ID
 * @param {Array} scenes - Array of scenes
 * @returns {Object} { isInScene: boolean, sceneStart: number|null }
 */
function getSceneContext(messageId, scenes) {
    const scene = scenes.find(s =>
        messageId >= s.start && (s.end === null || messageId <= s.end),
    );

    return {
        isInScene: !!scene,
        sceneStart: scene?.start || null,
    };
}

/**
 * Applies scene-aware temporal decay
 * Decay resets when a new scene starts
 * Skips chunks marked as temporally blind
 * @param {Array} chunks - Array of chunks
 * @param {number} currentMessageId - Current message ID
 * @param {Array} scenes - Array of scenes from chat_metadata
 * @param {Object} decaySettings - Decay configuration
 * @returns {Array} Chunks with scene-aware decay applied
 */
export function applySceneAwareDecay(chunks, currentMessageId, scenes, decaySettings) {
    if (!decaySettings.enabled) {
        return chunks;
    }

    const currentSceneContext = getSceneContext(currentMessageId, scenes);

    let blindCount = 0;
    const decayed = chunks.map(chunk => {
        if (chunk.metadata?.source !== 'chat' || chunk.metadata?.messageId === undefined || chunk.metadata?.messageId === null) {
            return chunk;
        }

        // Check if chunk is temporally blind (immune to decay)
        const chunkHash = chunk.hash || chunk.metadata?.hash;
        if (chunkHash && isChunkTemporallyBlind(chunkHash)) {
            blindCount++;
            return {
                ...chunk,
                temporallyBlind: true,
                sceneAwareDecay: false,
            };
        }

        const chunkMessageId = chunk.metadata.messageId;
        const chunkSceneContext = getSceneContext(chunkMessageId, scenes);

        let effectiveAge;

        if (currentSceneContext.isInScene && chunkSceneContext.isInScene) {
            // Both in scenes - compare scene boundaries
            if (currentSceneContext.sceneStart === chunkSceneContext.sceneStart) {
                // Same scene - age is distance within scene
                effectiveAge = currentMessageId - chunkMessageId;
            } else {
                // Different scenes - age is distance from chunk's scene start to current position
                effectiveAge = currentMessageId - chunkSceneContext.sceneStart;
            }
        } else {
            // Not using scenes, or one is outside scene - normal age calculation
            effectiveAge = currentMessageId - chunkMessageId;
        }

        const originalScore = chunk.score || 0;
        const decayedScore = applyTemporalDecay(originalScore, effectiveAge, decaySettings);

        return {
            ...chunk,
            score: decayedScore,
            originalScore,
            effectiveAge,
            sceneAwareDecay: true,
        };
    });

    const affectedCount = decayed.filter(c => c.sceneAwareDecay).length;
    console.log(`⏳ [Decay] Applied scene-aware decay to ${affectedCount} chunks (${blindCount} temporally blind, skipped)`);

    return decayed;
}

/**
 * Gets default temporal weighting settings
 * @returns {Object} Default settings
 */
export function getDefaultDecaySettings() {
    return {
        enabled: false,              // OFF by default
        type: 'decay',               // 'decay' (recency) or 'nostalgia' (history) - mutually exclusive
        mode: 'exponential',         // 'exponential' or 'linear'
        halfLife: DEFAULT_DECAY_HALF_LIFE,  // Messages until effect reaches 50%
        linearRate: 0.01,           // Rate per message (linear mode)
        minRelevance: DEFAULT_DECAY_FLOOR,  // Never decay below this (decay only)
        maxBoost: DEFAULT_NOSTALGIA_MAX_BOOST, // Maximum boost multiplier (nostalgia only)
        sceneAware: false,           // Reset at scene boundaries
    };
}

/**
 * Validates temporal weighting settings
 * @param {Object} settings - Settings to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
export function validateDecaySettings(settings) {
    const errors = [];

    if (settings.enabled) {
        // Validate type
        const validTypes = ['decay', 'nostalgia'];
        if (!validTypes.includes(settings.type || 'decay')) {
            errors.push('Type must be "decay" or "nostalgia"');
        }

        if (!['exponential', 'linear'].includes(settings.mode)) {
            errors.push('Mode must be "exponential" or "linear"');
        }

        if (settings.mode === 'exponential') {
            if (settings.halfLife <= 0) {
                errors.push('Half-life must be greater than 0');
            }
        }

        if (settings.mode === 'linear') {
            if (settings.linearRate <= 0 || settings.linearRate > 1) {
                errors.push('Linear rate must be between 0 and 1');
            }
        }

        // Decay-specific validation
        if ((settings.type || 'decay') === 'decay') {
            if (settings.minRelevance < 0 || settings.minRelevance > 1) {
                errors.push('Minimum relevance must be between 0 and 1');
            }
        }

        // Nostalgia-specific validation
        if (settings.type === 'nostalgia') {
            if (settings.maxBoost < 1.0 || settings.maxBoost > 3.0) {
                errors.push('Max boost must be between 1.0 and 3.0');
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Calculates what score a chunk would have at various ages
 * @param {number} baseScore - Original score
 * @param {Object} decaySettings - Decay configuration
 * @param {Array} ages - Array of ages to calculate
 * @returns {Array} Array of { age, score } objects
 */
export function projectDecayCurve(baseScore, decaySettings, ages = [0, 10, 20, 50, 100, 200]) {
    return ages.map(age => ({
        age,
        score: applyTemporalDecay(baseScore, age, decaySettings),
    }));
}

/**
 * Gets statistics about temporal decay impact
 * @param {Array} chunks - Chunks with decay applied
 * @returns {Object} Statistics
 */
export function getDecayStats(chunks) {
    const decayedChunks = chunks.filter(c => c.decayApplied || c.sceneAwareDecay);

    if (decayedChunks.length === 0) {
        return { affected: 0, avgReduction: 0, maxReduction: 0 };
    }

    const reductions = decayedChunks.map(c => {
        const original = c.originalScore || c.score;
        const current = c.score;
        return ((original - current) / original) * 100;
    });

    return {
        affected: decayedChunks.length,
        avgReduction: reductions.reduce((a, b) => a + b, 0) / reductions.length,
        maxReduction: Math.max(...reductions),
        avgAge: decayedChunks.reduce((sum, c) => sum + (c.messageAge || c.effectiveAge || 0), 0) / decayedChunks.length,
    };
}

/**
 * Gets statistics about nostalgia boost impact
 * @param {Array} chunks - Chunks with nostalgia applied
 * @returns {Object} Statistics
 */
export function getNostalgiaStats(chunks) {
    const boostedChunks = chunks.filter(c => c.nostalgiaApplied);

    if (boostedChunks.length === 0) {
        return { affected: 0, avgBoost: 0, maxBoost: 0 };
    }

    const boosts = boostedChunks.map(c => {
        const original = c.originalScore || c.score;
        const current = c.score;
        return ((current - original) / original) * 100;
    });

    return {
        affected: boostedChunks.length,
        avgBoost: boosts.reduce((a, b) => a + b, 0) / boosts.length,
        maxBoost: Math.max(...boosts),
        avgAge: boostedChunks.reduce((sum, c) => sum + (c.messageAge || 0), 0) / boostedChunks.length,
    };
}

/**
 * Applies temporal weighting (decay OR nostalgia) to results for a specific collection
 * Uses per-collection settings - decay and nostalgia are mutually exclusive
 * @param {Array} chunks - Array of chunks with scores
 * @param {number} currentMessageId - Current message ID in chat
 * @param {string} collectionId - Collection identifier
 * @param {Array} scenes - Optional scenes array for scene-aware effects
 * @returns {Promise<Array>} Chunks with weighting applied
 */
export async function applyDecayForCollection(chunks, currentMessageId, collectionId, scenes = null) {
    // Import dynamically to avoid circular dependency
    const { getCollectionDecaySettings } = await import('./collection-metadata.js');

    const settings = getCollectionDecaySettings(collectionId);

    if (!settings.enabled) {
        return chunks;
    }

    // Check type - nostalgia or decay (default to decay for backwards compatibility)
    const weightingType = settings.type || 'decay';

    if (weightingType === 'nostalgia') {
        // Apply nostalgia boost (older = higher score)
        return applyNostalgiaToResults(chunks, currentMessageId, settings);
    }

    // Apply decay (older = lower score)
    // Use scene-aware decay if enabled and scenes provided
    if (settings.sceneAware && scenes && scenes.length > 0) {
        return applySceneAwareDecay(chunks, currentMessageId, scenes, settings);
    }

    return applyDecayToResults(chunks, currentMessageId, settings);
}

export default {
    applyTemporalDecay,
    applyNostalgiaBoost,
    applyDecayToResults,
    applyNostalgiaToResults,
    applySceneAwareDecay,
    applyDecayForCollection,
    getDefaultDecaySettings,
    validateDecaySettings,
    projectDecayCurve,
    getDecayStats,
    getNostalgiaStats,
};
