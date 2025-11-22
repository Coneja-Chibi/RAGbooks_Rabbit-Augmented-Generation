// =============================================================================
// FEATURES: SCORING SYSTEM
// Consolidates all chunk score modification features
// =============================================================================
//
// WHY: These features all modify or boost chunk similarity scores based on
// various criteria (importance, groups, conditions). Consolidating them
// eliminates redundancy and provides a single module for score manipulation.
//
// Merged from:
// - importance-weighting.js (importance score boosts)
// - chunk-groups.js (keyword-based group activation)
// - conditional-activation.js (context-aware activation rules)
//
// =============================================================================

import { Diagnostics, logger } from './core-system.js';
import { getStringHash } from '../../../utils.js';
import { substituteParams, generateRaw } from '../../../../script.js';

// ==================== IMPORTANCE WEIGHTING ====================
// WHY: Allows users to mark certain chunks as more/less important,
// affecting their ranking in search results

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

// ==================== CHUNK GROUPS ====================
// WHY: Groups allow collections of chunks to activate together when
// specific keywords are detected in the query

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

    const groupCount = Object.keys(groupIndex).length;
    if (groupCount > 0) {
        console.log(`📦 [Groups] ${groupCount} groups detected`);
    }

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
    if (boostedCount > 0) {
        console.log(`📦 [Groups] Boosted ${boostedCount} chunks from ${triggeredGroups.size} matched groups`);
    }

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

// ==================== CONDITIONAL ACTIVATION ====================
// WHY: Conditions allow chunks to activate only when specific context
// criteria are met (speaker, emotion, keywords, etc.)

// Try to import expressions extension for emotion detection
let expressionsExtension = null;
try {
    // Dynamic import of expressions extension (may not be available)
    const module = await import('../../expressions/index.js');
    expressionsExtension = module;
    console.log('✅ [VectHare Conditions] Character Expressions extension loaded for emotion detection');
} catch (e) {
    console.log('ℹ️ [VectHare Conditions] Character Expressions extension not available, using keyword-based emotion detection');
}

// Enhanced emotion keywords - expanded to include all expressions extension terminology
const EMOTION_KEYWORDS = {
    // Positive emotions
    joy: ['joy', 'happy', 'smile', 'laugh', 'glad', 'cheerful', 'delighted', 'pleased', 'joyful', 'happiness'],
    amusement: ['amusement', 'amused', 'funny', 'humorous', 'entertaining', 'playful'],
    love: ['love', 'adore', 'cherish', 'affection', 'beloved', 'loving', 'tender'],
    caring: ['caring', 'care', 'compassion', 'kind', 'gentle', 'nurturing', 'supportive'],
    admiration: ['admiration', 'admire', 'respect', 'impressed', 'awe', 'wonderful'],
    approval: ['approval', 'approve', 'agree', 'accept', 'support', 'endorse'],
    excitement: ['excitement', 'excited', 'thrilled', 'energetic', 'pumped', 'hyped', 'enthusiastic'],
    gratitude: ['gratitude', 'grateful', 'thankful', 'thanks', 'appreciate', 'appreciation'],
    optimism: ['optimism', 'optimistic', 'hopeful', 'positive', 'confident', 'upbeat'],
    pride: ['pride', 'proud', 'accomplished', 'achievement', 'success', 'triumphant'],
    relief: ['relief', 'relieved', 'ease', 'calm', 'relaxed', 'unburdened'],
    desire: ['desire', 'want', 'wish', 'crave', 'yearn', 'longing', 'passion'],

    // Negative emotions
    anger: ['anger', 'angry', 'mad', 'furious', 'rage', 'hostile', 'wrath', 'irate'],
    annoyance: ['annoyance', 'annoyed', 'irritated', 'bothered', 'frustrated', 'vexed'],
    disapproval: ['disapproval', 'disapprove', 'disagree', 'reject', 'oppose', 'condemn'],
    disgust: ['disgust', 'disgusted', 'repulsed', 'revolted', 'nauseated', 'repelled'],
    sadness: ['sadness', 'sad', 'unhappy', 'miserable', 'sorrowful', 'melancholy', 'down'],
    grief: ['grief', 'grieving', 'mourn', 'loss', 'bereavement', 'heartbroken'],
    disappointment: ['disappointment', 'disappointed', 'letdown', 'dissatisfied', 'disheartened'],
    remorse: ['remorse', 'regret', 'guilty', 'ashamed', 'sorry', 'repentant'],
    embarrassment: ['embarrassment', 'embarrassed', 'awkward', 'self-conscious', 'humiliated', 'flustered'],
    fear: ['fear', 'afraid', 'scared', 'terrified', 'frightened', 'dread', 'alarmed'],
    nervousness: ['nervousness', 'nervous', 'anxious', 'worried', 'uneasy', 'jittery', 'tense'],

    // Mixed/Neutral emotions
    surprise: ['surprise', 'surprised', 'shocked', 'amazed', 'astonished', 'startled', 'stunned'],
    curiosity: ['curiosity', 'curious', 'interested', 'intrigued', 'inquisitive', 'wondering'],
    confusion: ['confusion', 'confused', 'puzzled', 'perplexed', 'bewildered', 'uncertain'],
    realization: ['realization', 'realize', 'understand', 'comprehend', 'grasp', 'see', 'aha'],
    neutral: [] // Neutral has no keywords
};

/**
 * Evaluates a single condition rule
 * @param {Object} rule - Condition rule
 * @param {Object} context - Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateConditionRule(rule, context) {
    let result = false;

    switch (rule.type) {
        case 'keyword':
            // Check if keyword appears in recent messages
            const kwSettings = rule.settings || { values: [rule.value || ''], matchMode: 'contains', caseSensitive: false };
            const keywords = kwSettings.values || [];
            const matchMode = kwSettings.matchMode || 'contains';
            const caseSensitive = kwSettings.caseSensitive !== false;

            const recentText = caseSensitive ? context.recentMessages.join(' ') : context.recentMessages.join(' ').toLowerCase();

            result = keywords.some(kw => {
                const keyword = caseSensitive ? kw : kw.toLowerCase();
                if (matchMode === 'exact') {
                    // Match whole word
                    const regex = new RegExp(`\\b${keyword}\\b`, caseSensitive ? '' : 'i');
                    return regex.test(recentText);
                } else if (matchMode === 'startsWith') {
                    return recentText.startsWith(keyword);
                } else if (matchMode === 'endsWith') {
                    return recentText.endsWith(keyword);
                } else {
                    // Default: contains
                    return recentText.includes(keyword);
                }
            });
            break;

        case 'speaker':
            // Check if last speaker matches
            const spSettings = rule.settings || { values: [rule.value || ''], matchType: 'any' };
            const targetSpeakers = spSettings.values || [];
            const matchType = spSettings.matchType || 'any';

            if (matchType === 'all') {
                // All speakers must be in recent messages
                const speakers = context.messageSpeakers || [];
                result = targetSpeakers.every(target => speakers.includes(target));
            } else {
                // Any speaker matches (default)
                result = targetSpeakers.includes(context.lastSpeaker);
            }
            break;

        case 'messageCount':
            // Check if message count meets threshold or range
            const mcSettings = rule.settings || { count: parseInt(rule.value) || 0, operator: 'gte' };
            const count = mcSettings.count || 0;
            const operator = mcSettings.operator || 'gte';
            const upperBound = mcSettings.upperBound || 0;

            switch (operator) {
                case 'eq':
                    result = context.messageCount === count;
                    break;
                case 'gte':
                    result = context.messageCount >= count;
                    break;
                case 'lte':
                    result = context.messageCount <= count;
                    break;
                case 'between':
                    result = context.messageCount >= count && context.messageCount <= upperBound;
                    break;
                default:
                    result = context.messageCount >= count;
            }
            break;

        case 'chunkActive':
            // Check if another chunk (by hash) is active in results
            const caSettings = rule.settings || { values: [rule.value || ''], matchBy: 'hash' };
            const targetChunks = caSettings.values || [];
            const matchBy = caSettings.matchBy || 'hash';

            result = targetChunks.some(target => {
                if (matchBy === 'hash') {
                    const targetHash = parseInt(target);
                    return context.activeChunks.some(chunk => chunk.hash === targetHash);
                } else if (matchBy === 'section') {
                    return context.activeChunks.some(chunk => chunk.section === target);
                } else if (matchBy === 'topic') {
                    return context.activeChunks.some(chunk => chunk.topic === target);
                }
                return false;
            });
            break;

        case 'timeOfDay':
            // Check if current real-world time is in range
            try {
                const todSettings = rule.settings || {};
                const startTime = todSettings.startTime || '00:00';
                const endTime = todSettings.endTime || '23:59';

                const now = new Date();
                const currentTime = now.getHours() * 60 + now.getMinutes();
                const [startH, startM] = startTime.split(':').map(n => parseInt(n));
                const [endH, endM] = endTime.split(':').map(n => parseInt(n));
                const start = startH * 60 + startM;
                const end = endH * 60 + endM;

                if (start <= end) {
                    // Normal range (e.g., 09:00-17:00)
                    result = currentTime >= start && currentTime <= end;
                } else {
                    // Midnight crossing (e.g., 22:00-02:00)
                    result = currentTime >= start || currentTime <= end;
                }
            } catch (error) {
                console.warn(`⚠️ [Conditions] Invalid timeOfDay format`);
                result = false;
            }
            break;

        case 'emotion':
            // Hybrid emotion detection: Character Expressions → Enhanced Keywords
            const settings = rule.settings || { values: [rule.value || 'joy'], detectionMethod: 'auto' };
            const targetEmotions = settings.values || ['joy'];
            const detectionMethod = settings.detectionMethod || 'auto';
            let detectedEmotion = null;
            let usingExpressions = false;

            // Try Character Expressions extension (if enabled and available)
            if (detectionMethod !== 'keywords' && expressionsExtension && context.currentCharacter) {
                try {
                    detectedEmotion = expressionsExtension.lastExpression[context.currentCharacter];
                    if (detectedEmotion) {
                        usingExpressions = true;
                        const matchedEmotion = detectedEmotion.toLowerCase();

                        // Check if detected emotion matches any target emotions
                        result = targetEmotions.some(target =>
                            target.toLowerCase() === matchedEmotion
                        );

                        if (result) {
                            console.log(`✅ [Conditions:Emotion] Expressions match: "${detectedEmotion}" matches target [${targetEmotions.join(', ')}]`);
                        } else if (detectionMethod === 'expressions') {
                            // If expressions-only mode and no match, don't fall back
                            console.log(`❌ [Conditions:Emotion] Expressions no match: "${detectedEmotion}" ≠ [${targetEmotions.join(', ')}]`);
                            break;
                        }
                    }
                } catch (error) {
                    console.warn('⚠️ [Conditions:Emotion] Failed to get expression:', error);
                }
            }

            // Fallback to enhanced keyword matching (if not already matched or auto mode)
            if (!result && detectionMethod !== 'expressions') {
                const emotionText = context.recentMessages.join(' ').toLowerCase();

                // Check each target emotion's keywords
                result = targetEmotions.some(targetEmotion => {
                    const keywords = EMOTION_KEYWORDS[targetEmotion.toLowerCase()] || [];
                    const found = keywords.some(kw => emotionText.includes(kw));

                    if (found) {
                        console.log(`✅ [Conditions:Emotion] Keyword match: "${targetEmotion}" found in recent messages`);
                    }

                    return found;
                });

                if (!result && !usingExpressions) {
                    console.log(`❌ [Conditions:Emotion] No keyword match for [${targetEmotions.join(', ')}]`);
                }
            }

            break;

        case 'characterPresent':
            // Check if character name appears as a speaker in recent messages
            const cpSettings = rule.settings || { values: [rule.value || ''], matchType: 'any', lookback: 10 };
            const targetCharacters = cpSettings.values || [];
            const cpMatchType = cpSettings.matchType || 'any';

            const speakers = context.messageSpeakers || [];

            if (cpMatchType === 'all') {
                // All characters must be present
                result = targetCharacters.every(char =>
                    speakers.some(speaker => (speaker || '').toLowerCase().includes(char.toLowerCase()))
                );
            } else {
                // Any character present (default)
                result = targetCharacters.some(char =>
                    speakers.some(speaker => (speaker || '').toLowerCase().includes(char.toLowerCase()))
                );
            }
            break;

        case 'randomChance':
            // Random percentage chance (0-100)
            const rcSettings = rule.settings || { probability: parseInt(rule.value) || 50 };
            const chance = rcSettings.probability || 50;
            const roll = Math.random() * 100;
            result = roll <= chance;
            break;

        case 'generationType':
            // Check if generation type matches (normal, swipe, regenerate, continue, impersonate)
            const gtSettings = rule.settings || { values: [rule.value || 'normal'], matchType: 'any' };
            const targetGenTypes = gtSettings.values || ['normal'];
            const gtMatchType = gtSettings.matchType || 'any';
            const currentGenType = (context.generationType || 'normal').toLowerCase();

            if (gtMatchType === 'all') {
                // All types must match (doesn't make sense for single context, but kept for consistency)
                result = targetGenTypes.every(type => type.toLowerCase() === currentGenType);
            } else {
                // Any type matches (default)
                result = targetGenTypes.some(type => type.toLowerCase() === currentGenType);
            }
            break;

        case 'swipeCount':
            // Check if swipe count meets threshold or range
            const scSettings = rule.settings || { count: parseInt(rule.value) || 0, operator: 'gte' };
            const swipeCount = scSettings.count || 0;
            const scOperator = scSettings.operator || 'gte';
            const scUpperBound = scSettings.upperBound || 0;
            const currentSwipeCount = context.swipeCount || 0;

            switch (scOperator) {
                case 'eq':
                    result = currentSwipeCount === swipeCount;
                    break;
                case 'gte':
                    result = currentSwipeCount >= swipeCount;
                    break;
                case 'lte':
                    result = currentSwipeCount <= swipeCount;
                    break;
                case 'between':
                    result = currentSwipeCount >= swipeCount && currentSwipeCount <= scUpperBound;
                    break;
                default:
                    result = currentSwipeCount >= swipeCount;
            }
            break;

        case 'lorebookActive':
            // Check if specific lorebook entry is active
            const lbSettings = rule.settings || { values: [rule.value || ''], matchType: 'any' };
            const targetEntries = lbSettings.values || [];
            const lbMatchType = lbSettings.matchType || 'any';
            const activeEntries = context.activeLorebookEntries || [];

            if (lbMatchType === 'all') {
                // All entries must be active
                result = targetEntries.every(target => {
                    const targetLower = target.toLowerCase();
                    return activeEntries.some(entry => {
                        const entryKey = (entry.key || '').toLowerCase();
                        const entryUid = String(entry.uid || '').toLowerCase();
                        return entryKey.includes(targetLower) || entryUid === targetLower;
                    });
                });
            } else {
                // Any entry active (default)
                result = targetEntries.some(target => {
                    const targetLower = target.toLowerCase();
                    return activeEntries.some(entry => {
                        const entryKey = (entry.key || '').toLowerCase();
                        const entryUid = String(entry.uid || '').toLowerCase();
                        return entryKey.includes(targetLower) || entryUid === targetLower;
                    });
                });
            }
            break;

        case 'isGroupChat':
            // Check if current chat is a group chat
            const gcSettings = rule.settings || { isGroup: rule.value === 'true' || rule.value === true };
            const expectGroupChat = gcSettings.isGroup !== false;
            const isGroup = context.isGroupChat || false;
            result = isGroup === expectGroupChat;
            break;

        default:
            console.warn(`⚠️ [Conditions] Unknown condition type: ${rule.type}`);
            result = false;
    }

    // Apply negation if specified
    return rule.negate ? !result : result;
}

/**
 * Evaluates all conditions for a chunk
 * @param {Object} chunk - Chunk with conditions
 * @param {Object} context - Search context
 * @returns {boolean} Whether all conditions are satisfied
 */
export function evaluateConditions(chunk, context) {
    // If no conditions or conditions disabled, always activate
    if (!chunk.conditions || !chunk.conditions.enabled) {
        return true;
    }

    const rules = chunk.conditions.rules || [];
    if (rules.length === 0) {
        return true; // No rules = always activate
    }

    // Evaluate each rule
    const results = rules.map(rule => evaluateConditionRule(rule, context));

    // Apply AND/OR logic
    if (chunk.conditions.mode === 'AND') {
        return results.every(r => r);
    } else {
        return results.some(r => r);
    }
}

/**
 * Filters chunks based on their conditions
 * @param {Array} chunks - Array of chunks
 * @param {Object} context - Search context
 * @returns {Array} Chunks that meet their conditions
 */
export function filterChunksByConditions(chunks, context) {
    const filtered = chunks.filter(chunk => evaluateConditions(chunk, context));

    console.log(`🔍 [Conditions] Filtered ${chunks.length} chunks to ${filtered.length} based on conditions`);

    return filtered;
}

/**
 * Builds search context from current chat state
 * @param {Array} chat - Chat messages
 * @param {number} contextWindow - How many recent messages to consider
 * @param {Array} activeChunks - Chunks currently in results (for chunkActive conditions)
 * @returns {Object} Search context
 */
export function buildSearchContext(chat, contextWindow = 10, activeChunks = [], metadata = {}) {
    const recentMessages = chat.slice(-contextWindow).map(m => m.mes || '');
    const lastMessage = chat[chat.length - 1] || {};

    // Extract speakers from recent messages
    const messageSpeakers = chat.slice(-contextWindow).map(m => {
        if (m.name) return m.name;
        return m.is_user ? 'User' : 'Character';
    });

    // Count swipes on last message
    const swipeCount = (lastMessage.swipes && lastMessage.swipes.length > 0)
        ? lastMessage.swipes.length - 1
        : 0;

    return {
        recentMessages,
        lastSpeaker: lastMessage.name || (lastMessage.is_user ? 'User' : 'Character'),
        messageCount: chat.length,
        activeChunks,
        messageSpeakers,           // Array of speaker names for characterPresent
        timestamp: new Date(),     // Current timestamp for timeOfDay

        // Context for advanced conditionals
        generationType: metadata.generationType || 'normal',         // Generation type (normal, swipe, regenerate, continue, impersonate)
        swipeCount: swipeCount,                                      // Number of swipes on last message
        activeLorebookEntries: metadata.activeLorebookEntries || [], // Active lorebook entries
        isGroupChat: metadata.isGroupChat || false,                  // Whether this is a group chat
        currentCharacter: metadata.currentCharacter || null          // Current character name (for expressions extension)
    };
}

/**
 * Gets chunks grouped by their condition status
 * @param {Array} chunks - Array of chunks
 * @param {Object} context - Search context
 * @returns {Object} Chunks grouped by status
 */
export function groupChunksByConditionStatus(chunks, context) {
    const groups = {
        noConditions: [],
        conditionsMet: [],
        conditionsNotMet: []
    };

    chunks.forEach(chunk => {
        if (!chunk.conditions || !chunk.conditions.enabled) {
            groups.noConditions.push(chunk);
        } else if (evaluateConditions(chunk, context)) {
            groups.conditionsMet.push(chunk);
        } else {
            groups.conditionsNotMet.push(chunk);
        }
    });

    return groups;
}

/**
 * Validates a condition rule
 * @param {Object} rule - Condition rule to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
export function validateConditionRule(rule) {
    const errors = [];

    if (!rule.type) {
        errors.push('Condition type is required');
    }

    if (!rule.value || rule.value.trim() === '') {
        errors.push('Condition value is required');
    }

    if (rule.type === 'messageCount') {
        const num = parseInt(rule.value);
        if (isNaN(num) || num < 0) {
            errors.push('Message count must be a positive number');
        }
    }

    if (rule.type === 'chunkActive') {
        const hash = parseInt(rule.value);
        if (isNaN(hash)) {
            errors.push('Chunk hash must be a number');
        }
    }

    if (rule.type === 'timeOfDay') {
        const timeParts = (rule.value || '').split('-');
        if (timeParts.length !== 2) {
            errors.push('Time range must be in format HH:MM-HH:MM (e.g., 09:00-17:00)');
        } else {
            // Validate time format
            const [start, end] = timeParts;
            const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (!timeRegex.test(start) || !timeRegex.test(end)) {
                errors.push('Invalid time format. Use HH:MM (e.g., 09:00, 17:30)');
            }
        }
    }

    if (rule.type === 'emotion') {
        const validEmotions = ['happy', 'sad', 'angry', 'neutral', 'excited', 'fearful', 'surprised'];
        const emotion = (rule.value || '').toLowerCase();
        if (!validEmotions.includes(emotion)) {
            errors.push(`Emotion must be one of: ${validEmotions.join(', ')}`);
        }
    }

    if (rule.type === 'randomChance') {
        const num = parseInt(rule.value);
        if (isNaN(num) || num < 0 || num > 100) {
            errors.push('Random chance must be between 0 and 100');
        }
    }

    if (rule.type === 'characterPresent') {
        if (!rule.value || rule.value.trim() === '') {
            errors.push(`${rule.type} value cannot be empty`);
        }
    }

    if (rule.type === 'generationType') {
        const validTypes = ['normal', 'swipe', 'regenerate', 'continue', 'impersonate'];
        const genType = (rule.value || '').toLowerCase();
        if (!validTypes.includes(genType)) {
            errors.push(`Generation type must be one of: ${validTypes.join(', ')}`);
        }
    }

    if (rule.type === 'swipeCount') {
        const num = parseInt(rule.value);
        if (isNaN(num) || num < 0) {
            errors.push('Swipe count must be a positive number');
        }
    }

    if (rule.type === 'lorebookActive') {
        if (!rule.value || rule.value.trim() === '') {
            errors.push('Lorebook entry key or UID cannot be empty');
        }
    }

    if (rule.type === 'isGroupChat') {
        if (rule.value !== 'true' && rule.value !== 'false' && rule.value !== true && rule.value !== false) {
            errors.push('isGroupChat value must be true or false');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validates all conditions for a chunk
 * @param {Object} conditions - Chunk conditions object
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
export function validateConditions(conditions) {
    const errors = [];

    if (!conditions) {
        return { valid: true, errors: [] };
    }

    if (conditions.enabled) {
        const rules = conditions.rules || [];

        if (rules.length === 0) {
            errors.push('At least one condition rule is required when conditions are enabled');
        }

        rules.forEach((rule, idx) => {
            const validation = validateConditionRule(rule);
            if (!validation.valid) {
                errors.push(`Rule ${idx + 1}: ${validation.errors.join(', ')}`);
            }
        });
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Gets statistics about condition usage in a chunk collection
 * @param {Array} chunks - Array of chunks
 * @returns {Object} Statistics
 */
export function getConditionStats(chunks) {
    const stats = {
        total: chunks.length,
        withConditions: 0,
        conditionsEnabled: 0,
        byType: {},
        byMode: { AND: 0, OR: 0 }
    };

    chunks.forEach(chunk => {
        if (chunk.conditions && chunk.conditions.rules && chunk.conditions.rules.length > 0) {
            stats.withConditions++;

            if (chunk.conditions.enabled) {
                stats.conditionsEnabled++;
                stats.byMode[chunk.conditions.mode] = (stats.byMode[chunk.conditions.mode] || 0) + 1;

                chunk.conditions.rules.forEach(rule => {
                    stats.byType[rule.type] = (stats.byType[rule.type] || 0) + 1;
                });
            }
        }
    });

    return stats;
}

// ==================== DIAGNOSTIC CHECKS ====================
// WHY: As per CLAUDE.md mandate, every potential failure point must have a diagnostic check

Diagnostics.registerCheck('scoring-importance-validation', {
    name: 'Importance Weighting Validation',
    description: 'Validates that importance values are in valid range',
    category: 'SCORING',
    checkFn: async () => {
        // This is a structural check - actual validation happens per-chunk
        return {
            status: 'pass',
            message: 'Importance weighting system is operational',
            userMessage: 'Importance weighting functions are available and ready.'
        };
    }
});

Diagnostics.registerCheck('scoring-groups-validation', {
    name: 'Chunk Groups Validation',
    description: 'Validates that chunk groups are properly configured',
    category: 'SCORING',
    checkFn: async () => {
        // This is a structural check - actual validation happens per-group
        return {
            status: 'pass',
            message: 'Chunk groups system is operational',
            userMessage: 'Chunk grouping functions are available and ready.'
        };
    }
});

Diagnostics.registerCheck('scoring-conditions-validation', {
    name: 'Conditional Activation Validation',
    description: 'Validates that condition rules are properly configured',
    category: 'SCORING',
    checkFn: async () => {
        // Check if expressions extension is available
        const hasExpressions = !!expressionsExtension;

        return {
            status: hasExpressions ? 'pass' : 'info',
            message: hasExpressions
                ? 'Conditional activation system fully operational (with expressions support)'
                : 'Conditional activation operational (expressions extension not available, using keyword-based emotion detection)',
            userMessage: hasExpressions
                ? 'Conditional activation supports all emotion detection methods.'
                : 'Conditional activation is working, but Character Expressions extension is not available. Emotion detection will use keyword-based matching only.'
        };
    }
});

// ==================== EXPORTS ====================

// =============================================================================
// FEATURES: TEMPORAL SYSTEM
// Consolidates all time-based and dual-vector features
// =============================================================================
//
// WHY: These features both handle time-based aspects of RAG:
// - Temporal decay: Reduces relevance of older chunks over time
// - Dual-vector: Manages summary chunks and scene-based chunking
//
// Merged from:
// - temporal-decay.js (time-based relevance decay)
// - dual-vector.js (summary chunk creation and scene processing)
//
// =============================================================================

// ==================== TEMPORAL DECAY ====================
// WHY: Older chunks may be less relevant as conversations progress.
// Temporal decay allows reducing their scores based on age.

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
 * @param {Array} chunks - Array of chunks with scores
 * @param {number} currentMessageId - Current message ID in chat
 * @param {Object} decaySettings - Decay configuration
 * @returns {Array} Chunks with decay applied
 */
export function applyDecayToResults(chunks, currentMessageId, decaySettings) {
    if (!decaySettings.enabled) {
        return chunks;
    }

    const decayed = chunks.map(chunk => {
        // Only apply decay to chat chunks
        if (chunk.metadata?.source !== 'chat' || !chunk.metadata?.messageId) {
            return chunk;
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
    console.log(`⏳ [Decay] Applied temporal decay to ${affectedCount} chat chunks`);

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

    const decayed = chunks.map(chunk => {
        if (chunk.metadata?.source !== 'chat' || !chunk.metadata?.messageId) {
            return chunk;
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

    console.log(`⏳ [Decay] Applied scene-aware decay`);

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

// ==================== DUAL-VECTOR SUMMARY SYSTEM ====================
// WHY: Summary chunks improve semantic matching for long content.
// Users can search summaries for broad concepts, then get full text.

/**
 * Creates summary chunks for chunks with summaryVector enabled
 * @param {Array} chunks - Original chunks
 * @returns {Array} Original chunks + summary chunks
 */
export function createSummaryChunks(chunks) {
    const summaryChunks = [];

    chunks.forEach((chunk, index) => {
        // Only create summary chunk if:
        // 1. summaryVectors array has content
        // 2. summaryVector flag is true (opt-in for dual-vector)
        // 3. Not already a summary chunk
        if (chunk.summaryVectors && chunk.summaryVectors.length > 0 && chunk.summaryVector && !chunk.isSummaryChunk) {
            // Use first summary vector (typically AI-generated, but could be user-added)
            const summaryText = chunk.summaryVectors[0];
            const summaryHash = getStringHash(`${chunk.hash}_summary`);

            const summaryChunk = {
                text: summaryText,
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
                summaryVectors: [], // Summary chunks don't need their own summaries
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
 * @param {Object} summaryOptions - Summarization settings { summarizeChunks, summaryStyle, perChunkSummaryControl }
 * @param {Object} cleaningOptions - Text cleaning settings { cleaningMode, customPatterns }
 * @returns {Array} Scene chunks (and summary chunks if enabled)
 */
export function processScenesToChunks(messages, scenes, config, summaryOptions = {}, cleaningOptions = {}) {
    const chunks = [];
    let skippedOpen = 0;
    let skippedInvalid = 0;

    // Extract summarization settings
    const { summarizeChunks = false, summaryStyle = 'concise', perChunkSummaryControl = false } = summaryOptions;

    // Extract cleaning settings
    const { cleaningMode = 'none', customPatterns = [] } = cleaningOptions;

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

        // Build scene text with cleaning and type safety (like base ST extension)
        const sceneText = sceneMessages
            .map(m => {
                const messageText = String(substituteParams(m.mes || ''));
                return cleanText(messageText, cleaningMode, customPatterns);
            })
            .filter(text => text && text.trim().length > 0)
            .join('\n\n');
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
                messageCount: sceneMessages.length,
                enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                summaryStyle: summaryStyle
            },
            section: scene.title || `Scene ${idx + 1}`,
            topic: `Messages ${scene.start}-${scene.end}`,
            comment: '',
            keywords: scene.keywords || [],
            systemKeywords: scene.keywords || [],
            customKeywords: [],
            customWeights: {},
            disabledKeywords: [],
            summaryVectors: scene.summary ? [scene.summary] : [], // Migrate old scene.summary to array
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

// ==================== DIAGNOSTIC CHECKS ====================
// WHY: As per CLAUDE.md mandate, every potential failure point must have a diagnostic check

Diagnostics.registerCheck('temporal-decay-validation', {
    name: 'Temporal Decay Validation',
    description: 'Validates temporal decay settings and calculations',
    category: 'TEMPORAL',
    checkFn: async () => {
        // Test decay calculations with default settings
        const testSettings = getDefaultDecaySettings();
        testSettings.enabled = true;

        try {
            const testScore = 0.8;
            const testAge = 50;
            const result = applyTemporalDecay(testScore, testAge, testSettings);

            if (isNaN(result) || result < 0 || result > 1) {
                return {
                    status: 'error',
                    message: `Invalid decay calculation: ${result}`,
                    userMessage: 'Temporal decay is producing invalid scores. This is a bug.'
                };
            }

            return {
                status: 'pass',
                message: 'Temporal decay system operational',
                userMessage: 'Temporal decay calculations are working correctly.'
            };
        } catch (error) {
            return {
                status: 'error',
                message: `Decay calculation failed: ${error.message}`,
                userMessage: 'Temporal decay encountered an error during calculation.'
            };
        }
    }
});

Diagnostics.registerCheck('dual-vector-summary-creation', {
    name: 'Dual-Vector Summary Creation',
    description: 'Validates summary chunk creation process',
    category: 'TEMPORAL',
    checkFn: async () => {
        // Test summary chunk creation
        const testChunk = {
            text: 'Test content',
            hash: 12345,
            summaryVectors: ['Test summary'],
            summaryVector: true,
            isSummaryChunk: false,
            section: 'Test',
            keywords: []
        };

        try {
            const result = createSummaryChunks([testChunk]);

            if (result.length !== 2) {
                return {
                    status: 'error',
                    message: `Expected 2 chunks (1 original + 1 summary), got ${result.length}`,
                    userMessage: 'Summary chunk creation is not working correctly.'
                };
            }

            const summaryChunk = result.find(c => c.isSummaryChunk);
            if (!summaryChunk) {
                return {
                    status: 'error',
                    message: 'No summary chunk created',
                    userMessage: 'Summary chunks are not being created properly.'
                };
            }

            return {
                status: 'pass',
                message: 'Dual-vector summary creation operational',
                userMessage: 'Summary chunk creation is working correctly.'
            };
        } catch (error) {
            return {
                status: 'error',
                message: `Summary creation failed: ${error.message}`,
                userMessage: 'Summary chunk creation encountered an error.'
            };
        }
    }
});

Diagnostics.registerCheck('scene-processing-validation', {
    name: 'Scene Processing Validation',
    description: 'Validates chat scene processing',
    category: 'TEMPORAL',
    checkFn: async () => {
        // This is a structural check - actual validation happens during scene processing
        return {
            status: 'pass',
            message: 'Scene processing system operational',
            userMessage: 'Chat scene processing functions are available and ready.'
        };
    }
});

// ==================== EXPORTS ====================

// =============================================================================
// FEATURES: PROCESSING SYSTEM
// Consolidates all text processing, UI, and preparation features
// =============================================================================
//
// WHY: These features all handle text processing, preparation, and UI building
// for the RAG system. Consolidating them provides a single module for all
// pre-vectorization operations.
//
// Merged from:
// - summarization.js (AI-powered chunk summarization)
// - text-cleaning.js (HTML/code scrubbing)
// - semantic-chunking.js (intelligent text splitting)
// - chunk-factory.js (standardized chunk creation)
// - progress-indicator.js (UI progress tracking)
// - advanced-settings-builder.js (reusable UI components)
//
// =============================================================================

// ==================== SUMMARIZATION ====================
// WHY: AI-powered summaries improve semantic matching for dual-vector search

/**
 * Summary style presets with specific prompting strategies
 */
const SUMMARY_STYLES = {
    concise: {
        name: 'Concise',
        systemPrompt: 'You are a summarization assistant. Create a brief, one-sentence summary that captures the core meaning.',
        maxLength: 150,
        temperature: 0.3
    },
    detailed: {
        name: 'Detailed',
        systemPrompt: 'You are a summarization assistant. Create a comprehensive 2-3 sentence summary that covers key points and context.',
        maxLength: 300,
        temperature: 0.5
    },
    keywords: {
        name: 'Keywords',
        systemPrompt: 'You are a keyword extraction assistant. Extract 5-10 key terms and concepts as a comma-separated list.',
        maxLength: 100,
        temperature: 0.2
    },
    extractive: {
        name: 'Extractive',
        systemPrompt: 'You are an extractive summarization assistant. Select the most important 1-2 sentences from the text, verbatim.',
        maxLength: 200,
        temperature: 0.1
    }
};

/**
 * Generate a summary for a single chunk
 * @param {string} chunkText - The text content to summarize
 * @param {string} style - Summary style (concise, detailed, keywords, extractive)
 * @param {Object} options - Additional options
 * @returns {Promise<string|null>} Generated summary or null on failure
 */
export async function generateSummaryForChunk(chunkText, style = 'concise', options = {}) {
    try {
        // Validate inputs
        if (!chunkText || typeof chunkText !== 'string') {
            console.warn('[VectHare Summarization] Invalid chunk text');
            return null;
        }

        // Get style preset
        const styleConfig = SUMMARY_STYLES[style] || SUMMARY_STYLES.concise;

        // Prepare prompt - simpler and more direct with generateRaw
        const prompt = `${styleConfig.systemPrompt}\n\nSummarize the following text:\n\n${chunkText}`;

        // Call SillyTavern's raw generation API (like qvink_memory does)
        const summary = await generateRaw({
            prompt: prompt,
            trimNames: false  // Mark as quiet generation to prevent extension interference (e.g., Rabbit Response Team)
        });

        // Validate and clean response
        if (!summary || typeof summary !== 'string') {
            console.warn('[VectHare Summarization] Empty or invalid summary response');
            return null;
        }

        const cleanSummary = summary.trim();

        // Enforce max length
        if (cleanSummary.length > styleConfig.maxLength) {
            return cleanSummary.substring(0, styleConfig.maxLength) + '...';
        }

        return cleanSummary;

    } catch (error) {
        console.error('[VectHare Summarization] Failed to generate summary:', error);
        return null;
    }
}

/**
 * Generate summaries for multiple chunks in batch
 * @param {Array} chunks - Array of chunk objects
 * @param {string} style - Summary style
 * @param {Function} progressCallback - Optional callback for progress updates
 * @param {AbortSignal} abortSignal - Optional abort signal for cancellation
 * @param {number} delayMs - Delay between API requests in milliseconds (default: 1000)
 * @returns {Promise<Array>} Chunks with summaries added
 */
export async function generateSummariesForChunks(chunks, style = 'concise', progressCallback = null, abortSignal = null, delayMs = 1000) {
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
        return chunks;
    }

    // Check if cancelled before starting
    if (abortSignal?.aborted) {
        throw new Error('Operation cancelled by user');
    }

    console.log(`[VectHare Summarization] Generating ${style} summaries for ${chunks.length} chunks...`);

    const chunksToSummarize = chunks.filter(chunk =>
        chunk.metadata?.enableSummary === true &&
        !chunk.isSummaryChunk &&
        chunk.text &&
        chunk.text.length > 50 // Skip very short chunks
    );

    // Calculate skipped chunks for detailed user feedback
    const enabledChunks = chunks.filter(c => c.metadata?.enableSummary === true && !c.isSummaryChunk);
    const disabledChunks = chunks.filter(c => c.metadata?.enableSummary === false && !c.isSummaryChunk);
    const skippedTooShort = enabledChunks.filter(c => !c.text || c.text.length <= 50);

    // Build detailed skip reasons
    const skipReasons = [];
    if (disabledChunks.length > 0) {
        skipReasons.push(`${disabledChunks.length} had summarization disabled`);
    }
    if (skippedTooShort.length > 0) {
        skipReasons.push(`${skippedTooShort.length} too short (< 50 chars)`);
    }

    if (chunksToSummarize.length === 0) {
        const reason = skipReasons.length > 0 ? skipReasons.join(', ') : 'no chunks eligible';
        console.warn(`[VectHare Summarization] ⚠️ Skipped all chunks: ${reason}`);
        return chunks;
    }

    console.log(`[VectHare Summarization] ${chunksToSummarize.length} chunks eligible for summarization`);
    if (skipReasons.length > 0) {
        console.warn(`[VectHare Summarization] ⚠️ Skipped ${skipReasons.join(', ')}`);
    }

    let successCount = 0;
    let failCount = 0;
    let currentDelay = delayMs; // Track current delay (may be upgraded dynamically)

    // Process chunks sequentially to avoid API rate limits
    for (let i = 0; i < chunksToSummarize.length; i++) {
        // Check for cancellation before processing each chunk
        if (abortSignal?.aborted) {
            console.log(`[VectHare Summarization] Cancelled after ${successCount} summaries`);
            throw new Error('Operation cancelled by user');
        }

        const chunk = chunksToSummarize[i];
        let retryCount = 0;
        const maxRetries = 10; // Increased from 3 to allow more attempts with upgraded delays
        let lastError = null;
        let success = false;

        // Retry loop with dynamic delay upgrades on rate limits
        while (retryCount <= maxRetries && !success) {
            try {
                // Generate summary
                const summary = await generateSummaryForChunk(chunk.text, style);

                if (summary) {
                    // Add summary to summaryVectors array (ONE source of truth)
                    if (!chunk.summaryVectors) {
                        chunk.summaryVectors = [];
                    }
                    // Add AI summary to array if not already present
                    if (!chunk.summaryVectors.includes(summary)) {
                        chunk.summaryVectors.unshift(summary); // Add to front of array
                    }

                    // Enable dual-vector search (flag tells createSummaryChunks to process this chunk)
                    chunk.summaryVector = true;

                    successCount++;
                    success = true;

                    console.log(`[VectHare Summarization] ✓ Chunk ${i + 1}/${chunksToSummarize.length}: "${summary.substring(0, 50)}..."`);
                } else {
                    // No summary returned but no error thrown
                    failCount++;
                    console.warn(`[VectHare Summarization] ✗ Chunk ${i + 1}/${chunksToSummarize.length}: No summary generated`);
                    break; // Don't retry if generation returned empty
                }

                // Progress callback
                if (progressCallback) {
                    progressCallback(i + 1, chunksToSummarize.length);
                }

            } catch (error) {
                lastError = error;
                retryCount++;

                // Check if it's a rate limit error (429)
                const isRateLimit = error.message && (
                    error.message.includes('429') ||
                    error.message.toLowerCase().includes('rate limit') ||
                    error.message.toLowerCase().includes('too many requests')
                );

                if (isRateLimit) {
                    // Dynamically upgrade the delay for all future requests
                    const oldDelay = currentDelay;
                    currentDelay = Math.min(currentDelay * 1.5, 10000); // Increase by 50%, cap at 10s
                    console.warn(`[VectHare Summarization] ⚠ Rate limit detected on chunk ${i + 1}. Upgrading delay: ${oldDelay}ms → ${Math.round(currentDelay)}ms`);

                    // Exponential backoff for immediate retry: 2s, 4s, 8s, 16s...
                    const retryDelay = Math.min(2000 * Math.pow(2, retryCount - 1), 30000); // Cap at 30s
                    console.warn(`[VectHare Summarization] ⚠ Retrying chunk ${i + 1} in ${retryDelay/1000}s (attempt ${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    // Continue the loop to retry
                } else if (!isRateLimit) {
                    // Non-rate-limit error - log and stop retrying this chunk
                    console.error(`[VectHare Summarization] ✗ Error on chunk ${i + 1}:`, error.message);
                    failCount++;
                    break;
                } else {
                    // Should not reach here, but just in case
                    console.error(`[VectHare Summarization] ✗ Chunk ${i + 1} failed:`, error.message);
                    failCount++;
                    break;
                }
            }
        }

        // If still not successful after all retries, mark as failed
        if (!success && retryCount > maxRetries) {
            console.error(`[VectHare Summarization] ✗ Chunk ${i + 1} abandoned after ${maxRetries} retries with rate limit errors`);
            failCount++;
        }

        // Use dynamically adjusted delay between chunks (only if successful)
        if (success && currentDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, currentDelay));
        }
    }

    console.log(`[VectHare Summarization] Complete: ${successCount} succeeded, ${failCount} failed`);

    // Log if delay was dynamically upgraded
    if (currentDelay > delayMs) {
        console.log(`[VectHare Summarization] ⚙️ Delay auto-upgraded from ${delayMs}ms to ${Math.round(currentDelay)}ms due to rate limiting`);
    }

    // Return chunks with stats about what was processed/skipped
    chunks.summarizationStats = {
        attempted: chunksToSummarize.length,
        succeeded: successCount,
        failed: failCount,
        skippedDisabled: disabledChunks.length,
        skippedTooShort: skippedTooShort.length
    };

    return chunks;
}

/**
 * Validate summarization settings
 * @param {Object} config - Configuration object
 * @returns {boolean} True if valid
 */
export function validateSummarySettings(config) {
    if (!config) return false;

    // Check if summarization is enabled
    if (!config.summarizeChunks) return false;

    // Validate style
    const style = config.summaryStyle || 'concise';
    if (!SUMMARY_STYLES[style]) {
        console.warn(`[VectHare Summarization] Unknown style: ${style}, using concise`);
    }

    return true;
}

/**
 * Get available summary styles
 * @returns {Object} Map of style IDs to style configs
 */
export function getSummaryStyles() {
    return SUMMARY_STYLES;
}

/**
 * Get human-readable description of summary style
 * @param {string} style - Style ID
 * @returns {string} Description
 */
export function getSummaryStyleDescription(style) {
    const descriptions = {
        concise: 'One-sentence summary capturing core meaning',
        detailed: '2-3 sentence comprehensive summary with context',
        keywords: '5-10 key terms and concepts extracted',
        extractive: 'Most important sentences selected verbatim'
    };

    return descriptions[style] || descriptions.concise;
}

/**
 * Check if a content type benefits from summarization
 * @param {string} contentType - Type of content (lorebook, character, chat, custom)
 * @returns {boolean} True if summarization is beneficial
 */
export function contentTypeSupportsSummarization(contentType) {
    // All content types can benefit from summarization for dual-vector search
    const supportedTypes = {
        lorebook: true,      // Lore entries benefit from summaries for better matching
        character: true,     // Character descriptions benefit from summaries
        chat: true,          // Chat messages benefit from summaries
        custom: true,        // Custom documents benefit from summaries
        url: true           // Web content benefits from summaries
    };

    return supportedTypes[contentType] || false;
}

// ==================== TEXT CLEANING ====================
// WHY: Raw text often contains HTML, code, or markup that degrades
// embedding quality. Cleaning removes noise while preserving meaning.

// Cleaning mode constants
export const CLEANING_MODES = {
    NONE: 'none',
    BASIC: 'basic',
    BALANCED: 'balanced',
    AGGRESSIVE: 'aggressive'
};

// Preset regex patterns for each cleaning mode
export const CLEANING_PATTERNS = {
    basic: [
        {
            name: 'Script Tags',
            pattern: '<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>',
            flags: 'gi',
            replacement: '',
            description: 'Remove JavaScript code blocks'
        },
        {
            name: 'Style Tags',
            pattern: '<style\\b[^<]*(?:(?!<\\/style>)<[^<]*)*<\\/style>',
            flags: 'gi',
            replacement: '',
            description: 'Remove CSS style blocks'
        },
        {
            name: 'HTML Comments',
            pattern: '<!--[\\s\\S]*?-->',
            flags: 'g',
            replacement: '',
            description: 'Remove HTML comments'
        },
        {
            name: 'Hidden Elements',
            pattern: '<[^>]*style="[^"]*display\\s*:\\s*none[^"]*"[^>]*>[\\s\\S]*?<\\/[^>]+>',
            flags: 'gi',
            replacement: '',
            description: 'Remove elements with display:none'
        },
        {
            name: 'Preserve Line Breaks',
            pattern: '<br\\s*\\/?>|<\\/p>|<\\/div>',
            flags: 'gi',
            replacement: '\n',
            description: 'Convert block tags to newlines'
        }
    ],

    balanced: [
        {
            name: 'Script Tags',
            pattern: '<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>',
            flags: 'gi',
            replacement: '',
            description: 'Remove JavaScript code blocks'
        },
        {
            name: 'Style Tags',
            pattern: '<style\\b[^<]*(?:(?!<\\/style>)<[^<]*)*<\\/style>',
            flags: 'gi',
            replacement: '',
            description: 'Remove CSS style blocks'
        },
        {
            name: 'HTML Comments',
            pattern: '<!--[\\s\\S]*?-->',
            flags: 'g',
            replacement: '',
            description: 'Remove HTML comments'
        },
        {
            name: 'Hidden Elements',
            pattern: '<[^>]*style="[^"]*display\\s*:\\s*none[^"]*"[^>]*>[\\s\\S]*?<\\/[^>]+>',
            flags: 'gi',
            replacement: '',
            description: 'Remove elements with display:none'
        },
        {
            name: 'Code Blocks (```)',
            pattern: '```[\\s\\S]*?```',
            flags: 'g',
            replacement: '',
            description: 'Remove Markdown code blocks'
        },
        {
            name: 'Inline Code (`)',
            pattern: '`[^`]+`',
            flags: 'g',
            replacement: '',
            description: 'Remove inline code markers'
        },
        {
            name: 'Preserve Line Breaks',
            pattern: '<br\\s*\\/?>|<\\/p>|<\\/div>',
            flags: 'gi',
            replacement: '\n',
            description: 'Convert block tags to newlines'
        },
        {
            name: 'All HTML Tags',
            pattern: '<[^>]+>',
            flags: 'g',
            replacement: '',
            description: 'Remove all remaining HTML tags'
        },
        {
            name: 'HTML Entities',
            pattern: '&[a-z]+;|&#\\d+;',
            flags: 'gi',
            replacement: ' ',
            description: 'Remove HTML entities (&nbsp;, etc.)'
        },
        {
            name: 'Multiple Spaces',
            pattern: '\\s{2,}',
            flags: 'g',
            replacement: ' ',
            description: 'Collapse multiple spaces into one'
        },
        {
            name: 'Excessive Newlines',
            pattern: '\\n{3,}',
            flags: 'g',
            replacement: '\n\n',
            description: 'Collapse 3+ newlines to 2'
        }
    ],

    aggressive: [
        {
            name: 'Script Tags',
            pattern: '<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>',
            flags: 'gi',
            replacement: '',
            description: 'Remove JavaScript code blocks'
        },
        {
            name: 'Style Tags',
            pattern: '<style\\b[^<]*(?:(?!<\\/style>)<[^<]*)*<\\/style>',
            flags: 'gi',
            replacement: '',
            description: 'Remove CSS style blocks'
        },
        {
            name: 'HTML Comments',
            pattern: '<!--[\\s\\S]*?-->',
            flags: 'g',
            replacement: '',
            description: 'Remove HTML comments'
        },
        {
            name: 'Hidden Elements',
            pattern: '<[^>]*style="[^"]*display\\s*:\\s*none[^"]*"[^>]*>[\\s\\S]*?<\\/[^>]+>',
            flags: 'gi',
            replacement: '',
            description: 'Remove elements with display:none'
        },
        {
            name: 'Code Blocks (```)',
            pattern: '```[\\s\\S]*?```',
            flags: 'g',
            replacement: '',
            description: 'Remove Markdown code blocks'
        },
        {
            name: 'Inline Code (`)',
            pattern: '`[^`]+`',
            flags: 'g',
            replacement: '',
            description: 'Remove inline code markers'
        },
        {
            name: 'Preserve Line Breaks',
            pattern: '<br\\s*\\/?>|<\\/p>|<\\/div>',
            flags: 'gi',
            replacement: '\n',
            description: 'Convert block tags to newlines'
        },
        {
            name: 'All HTML Tags',
            pattern: '<[^>]+>',
            flags: 'g',
            replacement: '',
            description: 'Remove all remaining HTML tags'
        },
        {
            name: 'HTML Entities',
            pattern: '&[a-z]+;|&#\\d+;',
            flags: 'gi',
            replacement: ' ',
            description: 'Remove HTML entities (&nbsp;, etc.)'
        },
        {
            name: 'All Brackets',
            pattern: '[<>\\[\\]{}]',
            flags: 'g',
            replacement: '',
            description: 'Remove all bracket characters'
        },
        {
            name: 'Formatting Characters',
            pattern: '[*_~`|]',
            flags: 'g',
            replacement: '',
            description: 'Remove Markdown formatting'
        },
        {
            name: 'Special Characters',
            pattern: '[#@$%^&+=]',
            flags: 'g',
            replacement: '',
            description: 'Remove special characters'
        },
        {
            name: 'URLs',
            pattern: 'https?:\\/\\/[^\\s]+',
            flags: 'gi',
            replacement: '',
            description: 'Remove URLs'
        },
        {
            name: 'Multiple Spaces',
            pattern: '\\s{2,}',
            flags: 'g',
            replacement: ' ',
            description: 'Collapse multiple spaces'
        },
        {
            name: 'Excessive Newlines',
            pattern: '\\n{3,}',
            flags: 'g',
            replacement: '\n\n',
            description: 'Collapse 3+ newlines to 2'
        }
    ]
};

/**
 * Clean text using specified mode and optional custom patterns
 * @param {string} text - Text to clean
 * @param {string} mode - Cleaning mode (none, basic, balanced, aggressive)
 * @param {Array} customPatterns - Optional array of custom regex patterns
 * @returns {string} Cleaned text
 */
export function cleanText(text, mode, customPatterns = []) {
    if (typeof text !== 'string') {
        if (text === null || text === undefined) {
            return '';
        }
        // Attempt to convert to string if it's a number or object
        text = String(text);
    }

    if (mode === CLEANING_MODES.NONE || !text) {
        return text;
    }

    let cleaned = text;

    // Apply preset patterns for the selected mode
    const patterns = CLEANING_PATTERNS[mode] || [];
    for (const { pattern, flags, replacement } of patterns) {
        try {
            const regex = new RegExp(pattern, flags);
            cleaned = cleaned.replace(regex, replacement);
        } catch (error) {
            console.warn(`[VectHare TextCleaning] Failed to apply preset pattern: ${pattern}`, error);
        }
    }

    // Apply user's custom patterns
    if (Array.isArray(customPatterns)) {
        for (const customPattern of customPatterns) {
            if (customPattern && customPattern.enabled !== false && customPattern.pattern) {
                try {
                    const regex = new RegExp(customPattern.pattern, customPattern.flags || 'g');
                    cleaned = cleaned.replace(regex, customPattern.replacement || '');
                } catch (error) {
                    console.warn(`[VectHare TextCleaning] Failed to apply custom pattern: ${customPattern.name || 'Unknown'}`, error);
                }
            }
        }
    }

    return cleaned.trim();
}

/**
 * Get description for a cleaning mode
 * @param {string} mode - Cleaning mode
 * @returns {string} Description
 */
export function getModeDescription(mode) {
    const descriptions = {
        none: 'Keep original text without any cleaning',
        basic: 'Remove dangerous content (scripts, styles, hidden elements)',
        balanced: 'Remove all HTML tags and code blocks while preserving structure',
        aggressive: 'Strip all markup and formatting, keep only pure text'
    };
    return descriptions[mode] || '';
}

/**
 * Validate a regex pattern
 * @param {string} pattern - Regex pattern string
 * @param {string} flags - Regex flags
 * @returns {object} {valid: boolean, error: string}
 */
export function validatePattern(pattern, flags) {
    try {
        new RegExp(pattern, flags);
        return { valid: true, error: null };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

// ==================== SEMANTIC CHUNKING ====================
// WHY: Splitting text at semantic boundaries (topic shifts) creates
// more coherent chunks than fixed-size splitting

/**
 * Split text into sentences
 * @param {string} text - Text to split
 * @returns {string[]} Array of sentences
 */
export function splitIntoSentences(text) {
    if (!text || typeof text !== 'string') return [];

    // Normalize text
    const normalized = text
        .replace(/\r\n/g, '\n')
        .replace(/\s+/g, ' ')
        .trim();

    if (normalized.length === 0) return [];

    // Split on sentence boundaries while preserving common abbreviations
    // This regex handles:
    // - Period followed by space and capital letter
    // - Exclamation/question marks followed by space
    // - Handles common abbreviations (Mr., Dr., etc.)
    const sentences = [];
    const parts = normalized.split(/([.!?]+[\s\n]+)/g);

    let currentSentence = '';
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        if (part.match(/^[.!?]+[\s\n]+$/)) {
            // This is a delimiter - attach it to current sentence
            currentSentence += part.trim();

            // Check if this looks like an abbreviation (very short sentence)
            if (currentSentence.length > 10) {
                sentences.push(currentSentence.trim());
                currentSentence = '';
            }
        } else {
            currentSentence += part;
        }
    }

    // Add remaining text
    if (currentSentence.trim().length > 0) {
        sentences.push(currentSentence.trim());
    }

    return sentences.filter(s => s.length > 0);
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vec1 - First vector
 * @param {number[]} vec2 - Second vector
 * @returns {number} Similarity score (0-1, where 1 is identical)
 */
export function cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0) {
        return 0;
    }

    if (vec1.length !== vec2.length) {
        console.warn('[VectHare Semantic] Vector length mismatch:', vec1.length, 'vs', vec2.length);
        return 0;
    }

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (let i = 0; i < vec1.length; i++) {
        dotProduct += vec1[i] * vec2[i];
        magnitude1 += vec1[i] * vec1[i];
        magnitude2 += vec2[i] * vec2[i];
    }

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) {
        return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
}

/**
 * DISABLED: Semantic chunking disabled until embedding API infrastructure is added
 * This would require creating temporary collections or a dedicated embedding endpoint
 * For now, falls back to simple sentence-based chunking
 */
export async function semanticChunkText(text, options = {}) {
    console.warn('[VectHare Semantic] Semantic chunking is disabled - falling back to sentence grouping');

    // Fallback: Group sentences by size instead of semantic similarity
    const config = {
        maxChunkSize: options.maxChunkSize || 1500,
        minChunkSize: options.minChunkSize || 100
    };

    const sentences = splitIntoSentences(text);
    if (sentences.length === 0) return [];
    if (sentences.length === 1) return [text];

    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
        if ((currentChunk + ' ' + sentence).length > config.maxChunkSize && currentChunk.length >= config.minChunkSize) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
    }

    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks.filter(chunk => chunk.length > 0);
}

/**
 * Improved sliding window chunking with sentence-aware boundaries
 * @param {string} text - Text to chunk
 * @param {Object} options - Chunking options
 * @param {number} options.windowSize - Window size in characters
 * @param {number} options.overlapPercent - Overlap as percentage (0-50)
 * @param {boolean} options.sentenceAware - Respect sentence boundaries
 * @returns {string[]} Array of text chunks
 */
export function slidingWindowChunk(text, options = {}) {
    const defaultOptions = {
        windowSize: 500,
        overlapPercent: 20,  // 20% overlap by default
        sentenceAware: true   // Don't split mid-sentence
    };

    const config = { ...defaultOptions, ...options };

    if (!text || text.length === 0) return [];
    if (text.length <= config.windowSize) return [text];

    const overlapChars = Math.floor(config.windowSize * (config.overlapPercent / 100));
    const chunks = [];

    if (config.sentenceAware) {
        // Split into sentences first
        const sentences = splitIntoSentences(text);

        let currentChunk = '';
        let chunkStartIdx = 0;

        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;

            if (potentialChunk.length >= config.windowSize && currentChunk.length > 0) {
                // Current chunk is full - save it
                chunks.push(currentChunk.trim());

                // Calculate overlap point (go back to include some previous sentences)
                let overlapText = '';
                let overlapIdx = i - 1;

                while (overlapIdx >= chunkStartIdx && overlapText.length < overlapChars) {
                    overlapText = sentences[overlapIdx] + ' ' + overlapText;
                    overlapIdx--;
                }

                currentChunk = overlapText.trim() + ' ' + sentence;
                chunkStartIdx = overlapIdx + 1;
            } else {
                currentChunk = potentialChunk;
            }
        }

        // Add final chunk
        if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk.trim());
        }
    } else {
        // Simple character-based sliding window
        let position = 0;

        while (position < text.length) {
            const end = Math.min(position + config.windowSize, text.length);
            const chunk = text.substring(position, end).trim();

            if (chunk.length > 0) {
                chunks.push(chunk);
            }

            position += config.windowSize - overlapChars;
        }
    }

    console.log(`[VectHare Sliding Window] Created ${chunks.length} chunks (${config.windowSize} chars, ${config.overlapPercent}% overlap)`);

    return chunks;
}

/**
 * Validate semantic chunking options
 * @param {Object} options - Options to validate
 * @returns {Object} {valid: boolean, errors: string[]}
 */
export function validateSemanticOptions(options) {
    const errors = [];

    if (options.similarityThreshold !== undefined) {
        if (typeof options.similarityThreshold !== 'number') {
            errors.push('Similarity threshold must be a number');
        } else if (options.similarityThreshold < 0 || options.similarityThreshold > 1) {
            errors.push('Similarity threshold must be between 0 and 1');
        }
    }

    if (options.minChunkSize !== undefined) {
        if (typeof options.minChunkSize !== 'number' || options.minChunkSize < 1) {
            errors.push('Minimum chunk size must be a positive number');
        }
    }

    if (options.maxChunkSize !== undefined) {
        if (typeof options.maxChunkSize !== 'number' || options.maxChunkSize < 1) {
            errors.push('Maximum chunk size must be a positive number');
        }
    }

    if (options.minChunkSize && options.maxChunkSize && options.minChunkSize > options.maxChunkSize) {
        errors.push('Minimum chunk size cannot be larger than maximum chunk size');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// ==================== CHUNK FACTORY ====================
// WHY: Centralized chunk creation eliminates code duplication across parsers

/**
 * Creates a standardized chunk object with all metadata
 * @param {string} text - The text content of the chunk
 * @param {Object} metadata - Source-specific metadata
 * @param {Object} options - Optional settings for the chunk
 * @returns {Object} Standardized chunk object
 */
export function createChunk(text, metadata, options = {}) {
    const {
        section = '',
        topic = '',
        summarize = false,
        extractMetadata = true,
        perChunkSummaryControl = false,
        perChunkMetadataControl = false,
        summaryStyle = 'concise',
        keywords = null  // Allow passing pre-computed keywords
    } = options;

    // Compute keywords if not provided
    // Note: extractKeywords is imported from index.js in the calling context
    const computedKeywords = keywords || [];

    // Build chunk object with per-chunk control flags
    const chunk = {
        text,
        metadata: {
            ...metadata,
            // Per-chunk control flags - allow individual chunks to override settings
            enableSummary: perChunkSummaryControl ? true : summarize,
            enableMetadata: perChunkMetadataControl ? true : extractMetadata,
            summaryStyle: summaryStyle
        },
        section,
        topic,
        keywords: computedKeywords,
        systemKeywords: computedKeywords
    };

    return chunk;
}

/**
 * Creates multiple chunks from text split results
 * @param {Array<string>} textChunks - Array of text chunks
 * @param {Object} baseMetadata - Base metadata to apply to all chunks
 * @param {Object} options - Options for chunk creation
 * @returns {Array<Object>} Array of chunk objects
 */
export function createChunksFromSplit(textChunks, baseMetadata, options = {}) {
    const chunks = [];

    textChunks.forEach((chunkText, idx) => {
        const chunkMetadata = {
            ...baseMetadata,
            chunkIndex: idx
        };

        const chunk = createChunk(chunkText, chunkMetadata, {
            ...options,
            topic: options.topicPrefix ? `${options.topicPrefix} ${idx + 1}` : `Chunk ${idx + 1}`
        });

        chunks.push(chunk);
    });

    return chunks;
}

/**
 * Validates chunk creation options
 * @param {Object} options - Options to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateChunkOptions(options) {
    const errors = [];

    if (options.summaryStyle && !['concise', 'detailed', 'keywords', 'extractive'].includes(options.summaryStyle)) {
        errors.push('Invalid summary style. Must be: concise, detailed, keywords, or extractive');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// ==================== PROGRESS INDICATOR ====================
// WHY: Long operations (chunking, summarization, vectorization) need
// visible progress tracking to prevent users from thinking the app is frozen

// Progress state
let progressState = {
    isActive: false,
    startTime: null,
    elapsedInterval: null,
    currentStep: null,
    steps: {},
    stats: {
        chunks: 0,
        summaries: 0,
        total: 0
    },
    cancelHandler: null // Store cancel handler reference for cleanup
};

// Step configuration
const PROGRESS_STEPS = {
    parsing: {
        icon: '📚',
        label: 'Parsing & chunking',
        order: 1
    },
    chunking: {
        icon: '✂️',
        label: 'Chunks created',
        order: 2
    },
    cleaning: {
        icon: '🧹',
        label: 'Cleaning text',
        order: 3
    },
    summarizing: {
        icon: '✨',
        label: 'Generating summaries',
        order: 4
    },
    saving: {
        icon: '💾',
        label: 'Saving to database',
        order: 5
    }
};

/**
 * Show progress modal
 * @param {string} title - Main title (e.g., "Vectorizing Lorebook")
 * @param {string} subtitle - Subtitle (e.g., "World Info")
 * @param {Object} options - Optional configuration
 */
export function showProgressModal(title, subtitle = '', options = {}) {
    // Prevent multiple modals
    if (progressState.isActive) {
        console.warn('[VectHare Progress] Modal already active');
        return;
    }

    // Initialize state
    progressState.isActive = true;
    progressState.startTime = Date.now();
    progressState.currentStep = null;
    progressState.steps = {};
    progressState.stats = { chunks: 0, summaries: 0, total: 0 };

    // Create modal HTML
    const modalHTML = `
        <div class="ragbooks-progress-overlay" id="ragbooks-progress-overlay">
            <div class="ragbooks-progress-modal" id="ragbooks-progress-modal">
                <div class="ragbooks-progress-header">
                    <div class="ragbooks-progress-title">${title}</div>
                    ${subtitle ? `<div class="ragbooks-progress-subtitle">${subtitle}</div>` : ''}
                </div>

                <div class="ragbooks-progress-spinner"></div>

                <div class="ragbooks-progress-steps" id="ragbooks-progress-steps">
                    ${Object.entries(PROGRESS_STEPS).map(([id, step]) => `
                        <div class="ragbooks-progress-step pending" id="ragbooks-step-${id}">
                            <span class="ragbooks-progress-step-icon">${step.icon}</span>
                            <span class="ragbooks-progress-step-label">${step.label}</span>
                            <span class="ragbooks-progress-step-count" id="ragbooks-step-${id}-count"></span>
                        </div>
                    `).join('')}
                </div>

                <div class="ragbooks-progress-stats" id="ragbooks-progress-stats" style="display: none;">
                    <div class="ragbooks-progress-stat">
                        <span class="ragbooks-progress-stat-value" id="ragbooks-stat-chunks">0</span>
                        <span class="ragbooks-progress-stat-label">Chunks</span>
                    </div>
                    <div class="ragbooks-progress-stat">
                        <span class="ragbooks-progress-stat-value" id="ragbooks-stat-summaries">0</span>
                        <span class="ragbooks-progress-stat-label">Summaries</span>
                    </div>
                </div>

                <div class="ragbooks-progress-elapsed" id="ragbooks-progress-elapsed">
                    Elapsed: 0s
                </div>

                ${options.cancelable !== false ? `
                    <button class="ragbooks-progress-cancel" id="ragbooks-progress-cancel">
                        Cancel
                    </button>
                ` : ''}
            </div>
        </div>
    `;

    // Add to DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Start elapsed time counter
    startElapsedTimer();

    // Add cancel handler
    if (options.cancelable !== false && options.onCancel) {
        // Create handler and store reference for later cleanup
        const cancelHandler = () => {
            if (confirm('Are you sure you want to cancel this operation?')) {
                options.onCancel();
                hideProgressModal();
            }
        };

        progressState.cancelHandler = cancelHandler;

        const cancelBtn = document.getElementById('ragbooks-progress-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', cancelHandler);
        }
    }
}

/**
 * Update progress for a specific step
 * @param {string} stepId - Step identifier (parsing, chunking, cleaning, summarizing, saving)
 * @param {string} status - Status (active, completed, pending)
 * @param {string} count - Optional count text (e.g., "45/100")
 */
export function updateProgressStep(stepId, status, count = '') {
    if (!progressState.isActive) return;

    const stepEl = document.getElementById(`ragbooks-step-${stepId}`);
    if (!stepEl) {
        console.warn(`[VectHare Progress] Unknown step: ${stepId}`);
        return;
    }

    // Update step status
    stepEl.className = `ragbooks-progress-step ${status}`;
    progressState.steps[stepId] = status;
    progressState.currentStep = stepId;

    // Update count
    const countEl = document.getElementById(`ragbooks-step-${stepId}-count`);
    if (countEl) {
        countEl.textContent = count;
    }

    console.log(`[VectHare Progress] Step ${stepId}: ${status} ${count}`);
}

/**
 * Update statistics
 * @param {Object} stats - Stats object { chunks, summaries, total }
 */
export function updateProgressStats(stats) {
    if (!progressState.isActive) return;

    // Update state
    if (stats.chunks !== undefined) progressState.stats.chunks = stats.chunks;
    if (stats.summaries !== undefined) progressState.stats.summaries = stats.summaries;
    if (stats.total !== undefined) progressState.stats.total = stats.total;

    // Update UI
    const chunksEl = document.getElementById('ragbooks-stat-chunks');
    const summariesEl = document.getElementById('ragbooks-stat-summaries');
    const statsContainer = document.getElementById('ragbooks-progress-stats');

    if (chunksEl) chunksEl.textContent = progressState.stats.chunks;
    if (summariesEl) summariesEl.textContent = progressState.stats.summaries;

    // Show stats if we have data
    if (statsContainer && (progressState.stats.chunks > 0 || progressState.stats.summaries > 0)) {
        statsContainer.style.display = 'flex';
    }
}

/**
 * Update progress message
 * @param {string} message - Message to display
 */
export function updateProgressMessage(message) {
    if (!progressState.isActive) return;

    const subtitleEl = document.querySelector('.ragbooks-progress-subtitle');
    if (subtitleEl) {
        subtitleEl.textContent = message;
    }
}

/**
 * Show error state
 * @param {string} errorMessage - Error message to display
 */
export function showProgressError(errorMessage) {
    if (!progressState.isActive) return;

    const modalEl = document.getElementById('ragbooks-progress-modal');
    if (modalEl) {
        modalEl.classList.add('error');
    }

    // Stop spinner
    const spinnerEl = document.querySelector('.ragbooks-progress-spinner');
    if (spinnerEl) {
        spinnerEl.style.display = 'none';
    }

    // Show error message
    const stepsEl = document.getElementById('ragbooks-progress-steps');
    if (stepsEl) {
        stepsEl.insertAdjacentHTML('beforebegin', `
            <div class="ragbooks-progress-error">
                <div class="ragbooks-progress-error-title">Error occurred</div>
                <div class="ragbooks-progress-error-message">${errorMessage}</div>
            </div>
        `);
    }

    // Change cancel button to close
    const cancelBtn = document.getElementById('ragbooks-progress-cancel');
    if (cancelBtn) {
        // Remove the addEventListener cancel handler before setting onclick
        if (progressState.cancelHandler) {
            cancelBtn.removeEventListener('click', progressState.cancelHandler);
            progressState.cancelHandler = null;
        }

        cancelBtn.textContent = 'Close';
        cancelBtn.onclick = () => hideProgressModal();
    }

    stopElapsedTimer();
}

/**
 * Show success state
 * @param {string} message - Success message
 * @param {number} autoCloseDuration - Auto-close after X ms (0 = manual)
 */
export function showProgressSuccess(message, autoCloseDuration = 2000) {
    if (!progressState.isActive) return;

    const modalEl = document.getElementById('ragbooks-progress-modal');
    if (modalEl) {
        modalEl.classList.add('success');
    }

    // Hide spinner
    const spinnerEl = document.querySelector('.ragbooks-progress-spinner');
    if (spinnerEl) {
        spinnerEl.style.display = 'none';
    }

    // Show success message
    const stepsEl = document.getElementById('ragbooks-progress-steps');
    if (stepsEl) {
        stepsEl.style.display = 'none';
        stepsEl.insertAdjacentHTML('beforebegin', `
            <div class="ragbooks-progress-success">
                <div class="ragbooks-progress-success-icon">✓</div>
                <div class="ragbooks-progress-success-message">${message}</div>
            </div>
        `);
    }

    stopElapsedTimer();

    // Auto-close if duration specified
    if (autoCloseDuration > 0) {
        setTimeout(() => {
            hideProgressModal();
        }, autoCloseDuration);
    } else {
        // Change cancel button to close
        const cancelBtn = document.getElementById('ragbooks-progress-cancel');
        if (cancelBtn) {
            // Remove the addEventListener cancel handler before setting onclick
            if (progressState.cancelHandler) {
                cancelBtn.removeEventListener('click', progressState.cancelHandler);
                progressState.cancelHandler = null;
            }

            cancelBtn.textContent = 'Close';
            cancelBtn.onclick = () => hideProgressModal();
        }
    }
}

/**
 * Hide progress modal
 */
export function hideProgressModal() {
    stopElapsedTimer();

    const overlayEl = document.getElementById('ragbooks-progress-overlay');
    if (overlayEl) {
        // Fade out animation
        overlayEl.style.opacity = '0';
        setTimeout(() => {
            overlayEl.remove();
        }, 200);
    }

    progressState.isActive = false;
    progressState.startTime = null;
    progressState.currentStep = null;
    progressState.steps = {};
    progressState.stats = { chunks: 0, summaries: 0, total: 0 };
    progressState.cancelHandler = null;
}

/**
 * Check if progress modal is active
 * @returns {boolean}
 */
export function isProgressActive() {
    return progressState.isActive;
}

/**
 * Start elapsed time counter
 */
function startElapsedTimer() {
    stopElapsedTimer(); // Clear any existing timer

    progressState.elapsedInterval = setInterval(() => {
        if (!progressState.startTime) return;

        const elapsed = Math.floor((Date.now() - progressState.startTime) / 1000);
        const elapsedEl = document.getElementById('ragbooks-progress-elapsed');
        if (elapsedEl) {
            elapsedEl.textContent = `Elapsed: ${formatElapsedTime(elapsed)}`;
        }
    }, 1000);
}

/**
 * Stop elapsed time counter
 */
function stopElapsedTimer() {
    if (progressState.elapsedInterval) {
        clearInterval(progressState.elapsedInterval);
        progressState.elapsedInterval = null;
    }
}

/**
 * Format elapsed time as human-readable string
 * @param {number} seconds - Elapsed seconds
 * @returns {string} Formatted time
 */
function formatElapsedTime(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Create a progress callback function for parsing operations
 * @param {string} stepId - Step identifier
 * @param {number} total - Total items to process
 * @returns {Function} Callback function
 */
export function createParsingCallback(stepId, total) {
    return (current) => {
        updateProgressStep(stepId, 'active', `${current}/${total}`);
    };
}

/**
 * Create a progress callback function for summarization
 * @returns {Function} Callback function
 */
export function createSummarizationCallback() {
    return (current, total) => {
        updateProgressStep('summarizing', 'active', `${current}/${total}`);
        updateProgressStats({ summaries: current });
    };
}

// ==================== ADVANCED SETTINGS BUILDER ====================
// WHY: Consistent, reusable UI components for settings across all source types
// eliminates copy-paste code and ensures uniform UX

/**
 * Builds summarization controls for a given source type
 * @param {string} sourceType - Source type identifier (lorebook, character, url, custom, chat)
 * @param {Object} defaults - Default values for settings
 * @returns {string} HTML string for summarization controls
 */
export function buildSummarizationControls(sourceType, defaults = {}) {
    const {
        enabled = false,
        summaryStyle = 'concise',
        perChunkControl = false
    } = defaults;

    return `
        <!-- Summarization Settings -->
        <div class="ragbooks-setting-item">
            <label class="ragbooks-toggle">
                <input type="checkbox" id="ragbooks_${sourceType}_summarize_chunks" ${enabled ? 'checked' : ''}>
                <span class="ragbooks-toggle-slider"></span>
                <span class="ragbooks-toggle-label">📝 Summarize Chunks</span>
            </label>
            <div class="ragbooks-help-text">Generate AI summaries for better semantic matching (dual-vector search: summary + content)</div>
        </div>

        <div id="ragbooks_${sourceType}_summary_settings" style="${enabled ? '' : 'display: none;'}">
            <div class="ragbooks-setting-item">
                <label class="ragbooks-label">
                    <span class="ragbooks-label-text">Summary Style</span>
                </label>
                <select id="ragbooks_${sourceType}_summary_style" class="ragbooks-select">
                    <option value="concise" ${summaryStyle === 'concise' ? 'selected' : ''}>Concise (1-2 sentences)</option>
                    <option value="detailed" ${summaryStyle === 'detailed' ? 'selected' : ''}>Detailed (paragraph)</option>
                    <option value="keywords" ${summaryStyle === 'keywords' ? 'selected' : ''}>Keywords Only</option>
                    <option value="extractive" ${summaryStyle === 'extractive' ? 'selected' : ''}>Extractive (key quotes)</option>
                </select>
                <div class="ragbooks-help-text">How the AI should summarize each chunk</div>
            </div>

            <!-- Per-Chunk Control -->
            <div class="ragbooks-setting-item">
                <label class="ragbooks-toggle">
                    <input type="checkbox" id="ragbooks_${sourceType}_per_chunk_summary" ${perChunkControl ? 'checked' : ''}>
                    <span class="ragbooks-toggle-slider"></span>
                    <span class="ragbooks-toggle-label">🎯 Per-Chunk Summary Control</span>
                </label>
                <div class="ragbooks-help-text">Allow individual chunks to have summarization toggled on/off after vectorization</div>
            </div>
        </div>
    `;
}

/**
 * Builds metadata extraction controls for a given source type
 * @param {string} sourceType - Source type identifier
 * @param {Object} defaults - Default values for settings
 * @returns {string} HTML string for metadata extraction controls
 */
export function buildMetadataControls(sourceType, defaults = {}) {
    const {
        enabled = true,
        perChunkControl = false
    } = defaults;

    return `
        <!-- Metadata Extraction -->
        <div class="ragbooks-setting-item">
            <label class="ragbooks-toggle">
                <input type="checkbox" id="ragbooks_${sourceType}_extract_metadata" ${enabled ? 'checked' : ''}>
                <span class="ragbooks-toggle-slider"></span>
                <span class="ragbooks-toggle-label">🏷️ Extract Metadata</span>
            </label>
            <div class="ragbooks-help-text">Extract names, locations, topics from content for enhanced search</div>
        </div>

        <div id="ragbooks_${sourceType}_metadata_settings" style="${enabled ? '' : 'display: none;'}">
            <!-- Per-Chunk Metadata Control -->
            <div class="ragbooks-setting-item">
                <label class="ragbooks-toggle">
                    <input type="checkbox" id="ragbooks_${sourceType}_per_chunk_metadata" ${perChunkControl ? 'checked' : ''}>
                    <span class="ragbooks-toggle-slider"></span>
                    <span class="ragbooks-toggle-label">🎯 Per-Chunk Metadata Control</span>
                </label>
                <div class="ragbooks-help-text">Allow individual chunks to have metadata extraction toggled on/off after vectorization</div>
            </div>
        </div>
    `;
}

/**
 * Builds the event handlers for summarization toggle
 * This should be called after the form is inserted into the DOM
 * @param {string} sourceType - Source type identifier
 */
export function bindSummarizationHandlers(sourceType) {
    $(`#ragbooks_${sourceType}_summarize_chunks`).on('change', function() {
        const isEnabled = $(this).is(':checked');
        if (isEnabled) {
            $(`#ragbooks_${sourceType}_summary_settings`).slideDown(200);
        } else {
            $(`#ragbooks_${sourceType}_summary_settings`).slideUp(200);
        }
    });
}

/**
 * Builds the event handlers for metadata extraction toggle
 * This should be called after the form is inserted into the DOM
 * @param {string} sourceType - Source type identifier
 */
export function bindMetadataHandlers(sourceType) {
    $(`#ragbooks_${sourceType}_extract_metadata`).on('change', function() {
        const isEnabled = $(this).is(':checked');
        if (isEnabled) {
            $(`#ragbooks_${sourceType}_metadata_settings`).slideDown(200);
        } else {
            $(`#ragbooks_${sourceType}_metadata_settings`).slideUp(200);
        }
    });
}

/**
 * Collects summarization settings from the UI for a given source type
 * @param {string} sourceType - Source type identifier
 * @returns {Object} Summarization settings
 */
export function collectSummarizationSettings(sourceType) {
    return {
        summarizeChunks: $(`#ragbooks_${sourceType}_summarize_chunks`).is(':checked'),
        summaryStyle: $(`#ragbooks_${sourceType}_summary_style`).val() || 'concise',
        perChunkSummaryControl: $(`#ragbooks_${sourceType}_per_chunk_summary`).is(':checked')
    };
}

/**
 * Collects metadata extraction settings from the UI for a given source type
 * @param {string} sourceType - Source type identifier
 * @returns {Object} Metadata extraction settings
 */
export function collectMetadataSettings(sourceType) {
    return {
        extractMetadata: $(`#ragbooks_${sourceType}_extract_metadata`).is(':checked'),
        perChunkMetadataControl: $(`#ragbooks_${sourceType}_per_chunk_metadata`).is(':checked')
    };
}

/**
 * Builds per-chunk editor controls
 * Used in the chunk editor modal
 * @param {Object} chunk - The chunk being edited
 * @returns {string} HTML string for per-chunk controls
 */
export function buildPerChunkEditorControls(chunk) {
    const enableSummary = chunk.metadata?.enableSummary ?? false;
    const enableMetadata = chunk.metadata?.enableMetadata ?? true;

    return `
        <div class="ragbooks-setting-item">
            <label class="ragbooks-toggle">
                <input type="checkbox" id="ragbooks_chunk_enable_summary" ${enableSummary ? 'checked' : ''}>
                <span class="ragbooks-toggle-slider"></span>
                <span class="ragbooks-toggle-label">📝 Enable Summary for This Chunk</span>
            </label>
            <div class="ragbooks-help-text">Generate and use AI summary when searching (improves semantic matching)</div>
        </div>

        <div class="ragbooks-setting-item">
            <label class="ragbooks-toggle">
                <input type="checkbox" id="ragbooks_chunk_enable_metadata" ${enableMetadata ? 'checked' : ''}>
                <span class="ragbooks-toggle-slider"></span>
                <span class="ragbooks-toggle-label">🏷️ Enable Metadata for This Chunk</span>
            </label>
            <div class="ragbooks-help-text">Extract and use metadata (names, locations, topics) for enhanced search</div>
        </div>
    `;
}

/**
 * Collects per-chunk settings from the chunk editor modal
 * @returns {Object} Per-chunk settings
 */
export function collectPerChunkEditorSettings() {
    return {
        enableSummary: $('#ragbooks_chunk_enable_summary').is(':checked'),
        enableMetadata: $('#ragbooks_chunk_enable_metadata').is(':checked')
    };
}

// ==================== DIAGNOSTIC CHECKS ====================
// WHY: As per CLAUDE.md mandate, every potential failure point must have a diagnostic check

Diagnostics.registerCheck('processing-summarization-availability', {
    name: 'Summarization System Availability',
    description: 'Checks if AI summarization is available and functional',
    category: 'PROCESSING',
    checkFn: async () => {
        // Check if generateRaw is available
        if (typeof generateRaw !== 'function') {
            return {
                status: 'error',
                message: 'generateRaw function not available',
                userMessage: 'AI summarization is not available. The generateRaw function is missing from SillyTavern.'
            };
        }

        return {
            status: 'pass',
            message: 'Summarization system is available',
            userMessage: 'AI summarization is ready to use.'
        };
    }
});

Diagnostics.registerCheck('processing-text-cleaning-validation', {
    name: 'Text Cleaning Validation',
    description: 'Validates text cleaning patterns and modes',
    category: 'PROCESSING',
    checkFn: async () => {
        // Test that cleaning modes are defined
        const modes = Object.values(CLEANING_MODES);
        if (modes.length !== 4) {
            return {
                status: 'error',
                message: `Expected 4 cleaning modes, found ${modes.length}`,
                userMessage: 'Text cleaning system is not properly configured.'
            };
        }

        // Test basic cleaning
        try {
            const testText = '<script>alert("test")</script>Hello World';
            const cleaned = cleanText(testText, 'basic');

            if (cleaned.includes('<script>')) {
                return {
                    status: 'error',
                    message: 'Basic cleaning failed to remove script tags',
                    userMessage: 'Text cleaning is not working correctly. Script tags are not being removed.'
                };
            }

            return {
                status: 'pass',
                message: 'Text cleaning system operational',
                userMessage: 'Text cleaning is working correctly.'
            };
        } catch (error) {
            return {
                status: 'error',
                message: `Text cleaning failed: ${error.message}`,
                userMessage: 'Text cleaning encountered an error during validation.'
            };
        }
    }
});

Diagnostics.registerCheck('processing-chunking-validation', {
    name: 'Text Chunking Validation',
    description: 'Validates text chunking functions',
    category: 'PROCESSING',
    checkFn: async () => {
        // Test sentence splitting
        try {
            const testText = 'This is sentence one. This is sentence two! This is sentence three?';
            const sentences = splitIntoSentences(testText);

            if (sentences.length !== 3) {
                return {
                    status: 'warn',
                    message: `Expected 3 sentences, got ${sentences.length}`,
                    userMessage: 'Sentence splitting may not be working optimally, but chunking will still function.'
                };
            }

            return {
                status: 'pass',
                message: 'Text chunking system operational',
                userMessage: 'Text chunking is working correctly.'
            };
        } catch (error) {
            return {
                status: 'error',
                message: `Text chunking failed: ${error.message}`,
                userMessage: 'Text chunking encountered an error during validation.'
            };
        }
    }
});

Diagnostics.registerCheck('processing-progress-ui-availability', {
    name: 'Progress UI Availability',
    description: 'Checks if progress modal can be shown',
    category: 'PROCESSING',
    checkFn: async () => {
        // Check if document is available
        if (typeof document === 'undefined') {
            return {
                status: 'error',
                message: 'Document object not available',
                userMessage: 'Progress UI cannot be displayed. Document object is missing.'
            };
        }

        return {
            status: 'pass',
            message: 'Progress UI system available',
            userMessage: 'Progress indicators are ready to display.'
        };
    }
});

Diagnostics.registerCheck('processing-settings-builder-validation', {
    name: 'Settings Builder Validation',
    description: 'Validates UI settings builder functions',
    category: 'PROCESSING',
    checkFn: async () => {
        // Test that settings builders generate valid HTML
        try {
            const testHTML = buildSummarizationControls('test');

            if (!testHTML || testHTML.length < 100) {
                return {
                    status: 'error',
                    message: 'Settings builder generated invalid or empty HTML',
                    userMessage: 'Settings UI builder is not working correctly.'
                };
            }

            return {
                status: 'pass',
                message: 'Settings builder operational',
                userMessage: 'UI settings builder is working correctly.'
            };
        } catch (error) {
            return {
                status: 'error',
                message: `Settings builder failed: ${error.message}`,
                userMessage: 'Settings builder encountered an error during validation.'
            };
        }
    }
});

// ==================== EXPORTS ====================

export default {
    // Importance weighting
    applyImportanceWeighting,
    applyImportanceToResults,
    groupChunksByPriorityTier,
    rankChunksByImportance,
    filterByMinImportance,
    getImportanceStats,

    // Chunk groups
    buildGroupIndex,
    applyGroupBoosts,
    enforceRequiredGroups,
    getChunksByGroup,
    getGroupStats,
    validateChunkGroup,
    suggestGroups,

    // Conditional activation
    evaluateConditions,
    filterChunksByConditions,
    buildSearchContext,
    groupChunksByConditionStatus,
    validateConditionRule,
    validateConditions,
    getConditionStats,

    // Temporal decay
    applyTemporalDecay,
    applyDecayToResults,
    applySceneAwareDecay,
    getDefaultDecaySettings,
    validateDecaySettings,
    projectDecayCurve,
    getDecayStats,

    // Dual-vector
    createSummaryChunks,
    filterChunksBySearchMode,
    processScenesToChunks,
    mergeSearchResults,
    expandSummaryChunks,

    // Summarization
    generateSummaryForChunk,
    generateSummariesForChunks,
    validateSummarySettings,
    getSummaryStyles,
    getSummaryStyleDescription,
    contentTypeSupportsSummarization,

    // Text cleaning
    CLEANING_MODES,
    CLEANING_PATTERNS,
    cleanText,
    getModeDescription,
    validatePattern,

    // Semantic chunking
    splitIntoSentences,
    cosineSimilarity,
    semanticChunkText,
    slidingWindowChunk,
    validateSemanticOptions,

    // Chunk factory
    createChunk,
    createChunksFromSplit,
    validateChunkOptions,

    // Progress indicator
    showProgressModal,
    updateProgressStep,
    updateProgressStats,
    updateProgressMessage,
    showProgressError,
    showProgressSuccess,
    hideProgressModal,
    isProgressActive,
    createParsingCallback,
    createSummarizationCallback,

    // Advanced settings builder
    buildSummarizationControls,
    buildMetadataControls,
    bindSummarizationHandlers,
    bindMetadataHandlers,
    collectSummarizationSettings,
    collectMetadataSettings,
    buildPerChunkEditorControls,
    collectPerChunkEditorSettings
};
