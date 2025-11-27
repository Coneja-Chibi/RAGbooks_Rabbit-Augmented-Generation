// =============================================================================
// TEMPORAL DECAY SYSTEM
// Reduces relevance of older chunks over time (optional, OFF by default)
// Chunks marked as "temporally blind" are immune to decay
// =============================================================================

import { isChunkTemporallyBlind } from './collection-metadata.js';

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
                decayApplied: false
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
            decayApplied: true
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
        messageId >= s.start && (s.end === null || messageId <= s.end)
    );

    return {
        isInScene: !!scene,
        sceneStart: scene?.start || null
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
                sceneAwareDecay: false
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
            sceneAwareDecay: true
        };
    });

    const affectedCount = decayed.filter(c => c.sceneAwareDecay).length;
    console.log(`⏳ [Decay] Applied scene-aware decay to ${affectedCount} chunks (${blindCount} temporally blind, skipped)`);

    return decayed;
}

/**
 * Gets default decay settings
 * @returns {Object} Default settings
 */
export function getDefaultDecaySettings() {
    return {
        enabled: false,              // OFF by default
        mode: 'exponential',         // 'exponential' or 'linear'
        halfLife: 50,               // Messages until 50% relevance
        linearRate: 0.01,           // % per message (linear mode)
        minRelevance: 0.3,          // Never decay below 30%
        sceneAware: false           // Reset decay at scene boundaries
    };
}

/**
 * Validates decay settings
 * @param {Object} settings - Decay settings to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
export function validateDecaySettings(settings) {
    const errors = [];

    if (settings.enabled) {
        if (!['exponential', 'linear'].includes(settings.mode)) {
            errors.push('Decay mode must be "exponential" or "linear"');
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

        if (settings.minRelevance < 0 || settings.minRelevance > 1) {
            errors.push('Minimum relevance must be between 0 and 1');
        }
    }

    return {
        valid: errors.length === 0,
        errors
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
        score: applyTemporalDecay(baseScore, age, decaySettings)
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
        avgAge: decayedChunks.reduce((sum, c) => sum + (c.messageAge || c.effectiveAge || 0), 0) / decayedChunks.length
    };
}

/**
 * Applies temporal decay to results for a specific collection
 * Uses per-collection decay settings (chat collections default to enabled)
 * @param {Array} chunks - Array of chunks with scores
 * @param {number} currentMessageId - Current message ID in chat
 * @param {string} collectionId - Collection identifier
 * @param {Array} scenes - Optional scenes array for scene-aware decay
 * @returns {Promise<Array>} Chunks with decay applied
 */
export async function applyDecayForCollection(chunks, currentMessageId, collectionId, scenes = null) {
    // Import dynamically to avoid circular dependency
    const { getCollectionDecaySettings } = await import('./collection-metadata.js');

    const decaySettings = getCollectionDecaySettings(collectionId);

    if (!decaySettings.enabled) {
        return chunks;
    }

    // Use scene-aware decay if enabled and scenes provided
    if (decaySettings.sceneAware && scenes && scenes.length > 0) {
        return applySceneAwareDecay(chunks, currentMessageId, scenes, decaySettings);
    }

    // Standard decay
    return applyDecayToResults(chunks, currentMessageId, decaySettings);
}

export default {
    applyTemporalDecay,
    applyDecayToResults,
    applySceneAwareDecay,
    applyDecayForCollection,
    getDefaultDecaySettings,
    validateDecaySettings,
    projectDecayCurve,
    getDecayStats
};
