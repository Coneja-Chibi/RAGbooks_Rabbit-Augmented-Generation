// =============================================================================
// CONDITIONAL ACTIVATION SYSTEM
// Evaluates conditions to determine if chunks should be activated
// =============================================================================

// Try to import expressions extension for emotion detection
let expressionsExtension = null;
try {
    // Dynamic import of expressions extension (may not be available)
    const module = await import('../../expressions/index.js');
    expressionsExtension = module;
    console.log('✅ [RAGBooks Conditions] Character Expressions extension loaded for emotion detection');
} catch (e) {
    console.log('ℹ️ [RAGBooks Conditions] Character Expressions extension not available, using keyword-based emotion detection');
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
            const settings = rule.settings || { values: [], detectionMethod: 'auto' };
            const targetEmotions = settings.values || [];
            
            if (targetEmotions.length === 0) {
                console.warn('⚠️ [Conditions:Emotion] No target emotions selected. Condition fails.');
                result = false;
                break;
            }

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
        return true; // Enabled but no rules = active
    }

    // Evaluate each rule
    const results = rules.map(rule => evaluateConditionRule(rule, context));

    // Apply AND/OR logic (use 'logic' field, fallback to 'mode' for compatibility)
    const logic = chunk.conditions.logic || chunk.conditions.mode || 'AND';
    if (logic === 'AND') {
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

export default {
    evaluateConditions,
    filterChunksByConditions,
    buildSearchContext,
    groupChunksByConditionStatus,
    validateConditionRule,
    validateConditions,
    getConditionStats
};
