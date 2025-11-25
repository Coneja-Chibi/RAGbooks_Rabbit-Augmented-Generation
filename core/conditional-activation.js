/**
 * ============================================================================
 * VECTHARE CONDITIONAL ACTIVATION SYSTEM
 * ============================================================================
 * Evaluates conditions to determine if chunks should be activated
 * Ported from legacy VectHare with enhanced structure
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

// ============================================================================
// EXPRESSIONS EXTENSION INTEGRATION
// ============================================================================

// Try to import expressions extension for emotion detection
let expressionsExtension = null;

/**
 * Initializes the expressions extension integration
 * Called during module load
 */
async function initExpressionsExtension() {
    try {
        // Dynamic import of expressions extension (may not be available)
        const module = await import('../../../expressions/index.js');
        expressionsExtension = module;
        console.log('VectHare Conditions: Character Expressions extension loaded for emotion detection');
    } catch (e) {
        console.log('VectHare Conditions: Character Expressions extension not available, using keyword-based emotion detection');
    }
}

// Initialize on module load
initExpressionsExtension();

// ============================================================================
// EMOTION KEYWORDS
// ============================================================================

/**
 * Enhanced emotion keywords - expanded to include all expressions extension terminology
 * Maps emotion names to arrays of related keywords for fallback detection
 */
export const EMOTION_KEYWORDS = {
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
 * List of all valid emotion names
 */
export const VALID_EMOTIONS = Object.keys(EMOTION_KEYWORDS);

// ============================================================================
// CONDITION EVALUATORS
// ============================================================================

/**
 * Evaluates a keyword condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateKeywordCondition(rule, context) {
    const settings = rule.settings || { values: [rule.value || ''], matchMode: 'contains', caseSensitive: false };
    const keywords = settings.values || [];
    const matchMode = settings.matchMode || 'contains';
    const caseSensitive = settings.caseSensitive !== false;

    const recentText = caseSensitive
        ? context.recentMessages.join(' ')
        : context.recentMessages.join(' ').toLowerCase();

    return keywords.some(kw => {
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
}

/**
 * Evaluates a speaker condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateSpeakerCondition(rule, context) {
    const settings = rule.settings || { values: [rule.value || ''], matchType: 'any' };
    const targetSpeakers = settings.values || [];
    const matchType = settings.matchType || 'any';

    if (matchType === 'all') {
        // All speakers must be in recent messages
        const speakers = context.messageSpeakers || [];
        return targetSpeakers.every(target => speakers.includes(target));
    } else {
        // Any speaker matches (default)
        return targetSpeakers.includes(context.lastSpeaker);
    }
}

/**
 * Evaluates a message count condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateMessageCountCondition(rule, context) {
    const settings = rule.settings || { count: parseInt(rule.value) || 0, operator: 'gte' };
    const count = settings.count || 0;
    const operator = settings.operator || 'gte';
    const upperBound = settings.upperBound || 0;

    switch (operator) {
        case 'eq':
            return context.messageCount === count;
        case 'gte':
            return context.messageCount >= count;
        case 'lte':
            return context.messageCount <= count;
        case 'between':
            return context.messageCount >= count && context.messageCount <= upperBound;
        default:
            return context.messageCount >= count;
    }
}

/**
 * Evaluates a chunk active condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateChunkActiveCondition(rule, context) {
    const settings = rule.settings || { values: [rule.value || ''], matchBy: 'hash' };
    const targetChunks = settings.values || [];
    const matchBy = settings.matchBy || 'hash';

    return targetChunks.some(target => {
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
}

/**
 * Evaluates a time of day condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateTimeOfDayCondition(rule, context) {
    try {
        const settings = rule.settings || {};
        const startTime = settings.startTime || '00:00';
        const endTime = settings.endTime || '23:59';

        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const [startH, startM] = startTime.split(':').map(n => parseInt(n));
        const [endH, endM] = endTime.split(':').map(n => parseInt(n));
        const start = startH * 60 + startM;
        const end = endH * 60 + endM;

        if (start <= end) {
            // Normal range (e.g., 09:00-17:00)
            return currentTime >= start && currentTime <= end;
        } else {
            // Midnight crossing (e.g., 22:00-02:00)
            return currentTime >= start || currentTime <= end;
        }
    } catch (error) {
        console.warn('VectHare Conditions: Invalid timeOfDay format');
        return false;
    }
}

/**
 * Evaluates an emotion condition
 * Uses hybrid detection: Character Expressions extension -> Enhanced keyword fallback
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateEmotionCondition(rule, context) {
    const settings = rule.settings || { values: [], detectionMethod: 'auto' };
    const targetEmotions = settings.values || [];

    if (targetEmotions.length === 0) {
        console.warn('VectHare Conditions: No target emotions selected. Condition fails.');
        return false;
    }

    const detectionMethod = settings.detectionMethod || 'auto';
    let detectedEmotion = null;
    let usingExpressions = false;
    let result = false;

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
                    console.log(`VectHare Conditions: Expressions match: "${detectedEmotion}" matches target [${targetEmotions.join(', ')}]`);
                } else if (detectionMethod === 'expressions') {
                    // If expressions-only mode and no match, don't fall back
                    console.log(`VectHare Conditions: Expressions no match: "${detectedEmotion}" != [${targetEmotions.join(', ')}]`);
                    return false;
                }
            }
        } catch (error) {
            console.warn('VectHare Conditions: Failed to get expression:', error);
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
                console.log(`VectHare Conditions: Keyword match: "${targetEmotion}" found in recent messages`);
            }

            return found;
        });

        if (!result && !usingExpressions) {
            console.log(`VectHare Conditions: No keyword match for [${targetEmotions.join(', ')}]`);
        }
    }

    return result;
}

/**
 * Evaluates a character present condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateCharacterPresentCondition(rule, context) {
    const settings = rule.settings || { values: [rule.value || ''], matchType: 'any', lookback: 10 };
    const targetCharacters = settings.values || [];
    const matchType = settings.matchType || 'any';
    const speakers = context.messageSpeakers || [];

    if (matchType === 'all') {
        // All characters must be present
        return targetCharacters.every(char =>
            speakers.some(speaker => (speaker || '').toLowerCase().includes(char.toLowerCase()))
        );
    } else {
        // Any character present (default)
        return targetCharacters.some(char =>
            speakers.some(speaker => (speaker || '').toLowerCase().includes(char.toLowerCase()))
        );
    }
}

/**
 * Evaluates a random chance condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateRandomChanceCondition(rule, context) {
    const settings = rule.settings || { probability: parseInt(rule.value) || 50 };
    const chance = settings.probability || 50;
    const roll = Math.random() * 100;
    return roll <= chance;
}

/**
 * Evaluates a generation type condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateGenerationTypeCondition(rule, context) {
    const settings = rule.settings || { values: [rule.value || 'normal'], matchType: 'any' };
    const targetGenTypes = settings.values || ['normal'];
    const matchType = settings.matchType || 'any';
    const currentGenType = (context.generationType || 'normal').toLowerCase();

    if (matchType === 'all') {
        // All types must match (doesn't make sense for single context, but kept for consistency)
        return targetGenTypes.every(type => type.toLowerCase() === currentGenType);
    } else {
        // Any type matches (default)
        return targetGenTypes.some(type => type.toLowerCase() === currentGenType);
    }
}

/**
 * Evaluates a swipe count condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateSwipeCountCondition(rule, context) {
    const settings = rule.settings || { count: parseInt(rule.value) || 0, operator: 'gte' };
    const swipeCount = settings.count || 0;
    const operator = settings.operator || 'gte';
    const upperBound = settings.upperBound || 0;
    const currentSwipeCount = context.swipeCount || 0;

    switch (operator) {
        case 'eq':
            return currentSwipeCount === swipeCount;
        case 'gte':
            return currentSwipeCount >= swipeCount;
        case 'lte':
            return currentSwipeCount <= swipeCount;
        case 'between':
            return currentSwipeCount >= swipeCount && currentSwipeCount <= upperBound;
        default:
            return currentSwipeCount >= swipeCount;
    }
}

/**
 * Evaluates a lorebook active condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateLorebookActiveCondition(rule, context) {
    const settings = rule.settings || { values: [rule.value || ''], matchType: 'any' };
    const targetEntries = settings.values || [];
    const matchType = settings.matchType || 'any';
    const activeEntries = context.activeLorebookEntries || [];

    if (matchType === 'all') {
        // All entries must be active
        return targetEntries.every(target => {
            const targetLower = target.toLowerCase();
            return activeEntries.some(entry => {
                const entryKey = (entry.key || '').toLowerCase();
                const entryUid = String(entry.uid || '').toLowerCase();
                return entryKey.includes(targetLower) || entryUid === targetLower;
            });
        });
    } else {
        // Any entry active (default)
        return targetEntries.some(target => {
            const targetLower = target.toLowerCase();
            return activeEntries.some(entry => {
                const entryKey = (entry.key || '').toLowerCase();
                const entryUid = String(entry.uid || '').toLowerCase();
                return entryKey.includes(targetLower) || entryUid === targetLower;
            });
        });
    }
}

/**
 * Evaluates an is group chat condition
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
function evaluateIsGroupChatCondition(rule, context) {
    const settings = rule.settings || { isGroup: rule.value === 'true' || rule.value === true };
    const expectGroupChat = settings.isGroup !== false;
    const isGroup = context.isGroupChat || false;
    return isGroup === expectGroupChat;
}

// ============================================================================
// MAIN EVALUATION FUNCTIONS
// ============================================================================

/**
 * Evaluates a single condition rule
 * @param {object} rule Condition rule
 * @param {object} context Search context
 * @returns {boolean} Whether condition is met
 */
export function evaluateConditionRule(rule, context) {
    let result = false;

    switch (rule.type) {
        case 'keyword':
            result = evaluateKeywordCondition(rule, context);
            break;

        case 'speaker':
            result = evaluateSpeakerCondition(rule, context);
            break;

        case 'messageCount':
            result = evaluateMessageCountCondition(rule, context);
            break;

        case 'chunkActive':
            result = evaluateChunkActiveCondition(rule, context);
            break;

        case 'timeOfDay':
            result = evaluateTimeOfDayCondition(rule, context);
            break;

        case 'emotion':
            result = evaluateEmotionCondition(rule, context);
            break;

        case 'characterPresent':
            result = evaluateCharacterPresentCondition(rule, context);
            break;

        case 'randomChance':
            result = evaluateRandomChanceCondition(rule, context);
            break;

        case 'generationType':
            result = evaluateGenerationTypeCondition(rule, context);
            break;

        case 'swipeCount':
            result = evaluateSwipeCountCondition(rule, context);
            break;

        case 'lorebookActive':
            result = evaluateLorebookActiveCondition(rule, context);
            break;

        case 'isGroupChat':
            result = evaluateIsGroupChatCondition(rule, context);
            break;

        default:
            console.warn(`VectHare Conditions: Unknown condition type: ${rule.type}`);
            result = false;
    }

    // Apply negation if specified
    return rule.negate ? !result : result;
}

/**
 * Evaluates all conditions for a chunk
 * @param {object} chunk Chunk with conditions
 * @param {object} context Search context
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
 * @param {Array} chunks Array of chunks
 * @param {object} context Search context
 * @returns {Array} Chunks that meet their conditions
 */
export function filterChunksByConditions(chunks, context) {
    const filtered = chunks.filter(chunk => evaluateConditions(chunk, context));

    console.log(`VectHare Conditions: Filtered ${chunks.length} chunks to ${filtered.length} based on conditions`);

    return filtered;
}

/**
 * Builds search context from current chat state
 * @param {Array} chat Chat messages
 * @param {number} contextWindow How many recent messages to consider
 * @param {Array} activeChunks Chunks currently in results (for chunkActive conditions)
 * @param {object} metadata Additional metadata
 * @returns {object} Search context
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
 * @param {Array} chunks Array of chunks
 * @param {object} context Search context
 * @returns {object} Chunks grouped by status
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

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Valid generation types
 */
export const VALID_GENERATION_TYPES = ['normal', 'swipe', 'regenerate', 'continue', 'impersonate'];

/**
 * Validates a condition rule
 * @param {object} rule Condition rule to validate
 * @returns {object} Validation result { valid: boolean, errors: string[] }
 */
export function validateConditionRule(rule) {
    const errors = [];

    if (!rule.type) {
        errors.push('Condition type is required');
    }

    // Value validation depends on whether settings are used
    const hasSettings = rule.settings && Object.keys(rule.settings).length > 0;
    if (!hasSettings && (!rule.value || String(rule.value).trim() === '')) {
        errors.push('Condition value is required');
    }

    switch (rule.type) {
        case 'messageCount':
            const mcCount = rule.settings?.count ?? parseInt(rule.value);
            if (isNaN(mcCount) || mcCount < 0) {
                errors.push('Message count must be a positive number');
            }
            break;

        case 'chunkActive':
            if (rule.settings?.matchBy === 'hash' || !rule.settings) {
                const hash = parseInt(rule.settings?.values?.[0] ?? rule.value);
                if (isNaN(hash)) {
                    errors.push('Chunk hash must be a number');
                }
            }
            break;

        case 'timeOfDay':
            const todSettings = rule.settings || {};
            if (todSettings.startTime || todSettings.endTime) {
                const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
                if (todSettings.startTime && !timeRegex.test(todSettings.startTime)) {
                    errors.push('Invalid start time format. Use HH:MM (e.g., 09:00)');
                }
                if (todSettings.endTime && !timeRegex.test(todSettings.endTime)) {
                    errors.push('Invalid end time format. Use HH:MM (e.g., 17:00)');
                }
            } else if (rule.value) {
                // Legacy format: HH:MM-HH:MM
                const timeParts = rule.value.split('-');
                if (timeParts.length !== 2) {
                    errors.push('Time range must be in format HH:MM-HH:MM (e.g., 09:00-17:00)');
                } else {
                    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
                    if (!timeRegex.test(timeParts[0]) || !timeRegex.test(timeParts[1])) {
                        errors.push('Invalid time format. Use HH:MM (e.g., 09:00, 17:30)');
                    }
                }
            }
            break;

        case 'emotion':
            const emotionValues = rule.settings?.values || [rule.value];
            for (const emotion of emotionValues) {
                if (emotion && !VALID_EMOTIONS.includes(emotion.toLowerCase())) {
                    errors.push(`Unknown emotion: "${emotion}". Valid emotions: ${VALID_EMOTIONS.join(', ')}`);
                }
            }
            break;

        case 'randomChance':
            const chance = rule.settings?.probability ?? parseInt(rule.value);
            if (isNaN(chance) || chance < 0 || chance > 100) {
                errors.push('Random chance must be between 0 and 100');
            }
            break;

        case 'characterPresent':
            const cpValues = rule.settings?.values || [rule.value];
            if (cpValues.length === 0 || cpValues.every(v => !v || v.trim() === '')) {
                errors.push('Character name cannot be empty');
            }
            break;

        case 'generationType':
            const gtValues = rule.settings?.values || [rule.value];
            for (const genType of gtValues) {
                if (genType && !VALID_GENERATION_TYPES.includes(genType.toLowerCase())) {
                    errors.push(`Invalid generation type: "${genType}". Valid types: ${VALID_GENERATION_TYPES.join(', ')}`);
                }
            }
            break;

        case 'swipeCount':
            const scCount = rule.settings?.count ?? parseInt(rule.value);
            if (isNaN(scCount) || scCount < 0) {
                errors.push('Swipe count must be a positive number');
            }
            break;

        case 'lorebookActive':
            const lbValues = rule.settings?.values || [rule.value];
            if (lbValues.length === 0 || lbValues.every(v => !v || v.trim() === '')) {
                errors.push('Lorebook entry key or UID cannot be empty');
            }
            break;

        case 'isGroupChat':
            const gcValue = rule.settings?.isGroup ?? rule.value;
            if (gcValue !== 'true' && gcValue !== 'false' && gcValue !== true && gcValue !== false) {
                errors.push('isGroupChat value must be true or false');
            }
            break;
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validates all conditions for a chunk
 * @param {object} conditions Chunk conditions object
 * @returns {object} Validation result { valid: boolean, errors: string[] }
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

// ============================================================================
// STATISTICS FUNCTIONS
// ============================================================================

/**
 * Gets statistics about condition usage in a chunk collection
 * @param {Array} chunks Array of chunks
 * @returns {object} Statistics
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

                const mode = chunk.conditions.logic || chunk.conditions.mode || 'AND';
                stats.byMode[mode] = (stats.byMode[mode] || 0) + 1;

                chunk.conditions.rules.forEach(rule => {
                    stats.byType[rule.type] = (stats.byType[rule.type] || 0) + 1;
                });
            }
        }
    });

    return stats;
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
    // Core evaluation
    evaluateConditionRule,
    evaluateConditions,
    filterChunksByConditions,
    buildSearchContext,
    groupChunksByConditionStatus,

    // Validation
    validateConditionRule,
    validateConditions,

    // Statistics
    getConditionStats,

    // Constants
    EMOTION_KEYWORDS,
    VALID_EMOTIONS,
    VALID_GENERATION_TYPES
};
