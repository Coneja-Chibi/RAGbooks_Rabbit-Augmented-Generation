// =============================================================================
// CONDITIONAL ACTIVATION SYSTEM
// Evaluates conditions to determine if chunks should be activated
// =============================================================================

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
            const recentText = context.recentMessages.join(' ').toLowerCase();
            result = recentText.includes((rule.value || '').toLowerCase());
            break;

        case 'speaker':
            // Check if last speaker matches
            result = context.lastSpeaker === rule.value;
            break;

        case 'messageCount':
            // Check if message count meets threshold
            const threshold = parseInt(rule.value) || 0;
            result = context.messageCount >= threshold;
            break;

        case 'chunkActive':
            // Check if another chunk (by hash) is active in results
            const targetHash = parseInt(rule.value);
            result = context.activeChunks.some(chunk => chunk.hash === targetHash);
            break;

        case 'timeOfDay':
            // Check if current real-world time is in range (HH:MM-HH:MM)
            try {
                const now = new Date();
                const currentTime = now.getHours() * 60 + now.getMinutes();
                const [startTime, endTime] = (rule.value || '00:00-23:59').split('-');
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
                console.warn(`⚠️ [Conditions] Invalid timeOfDay format: ${rule.value}`);
                result = false;
            }
            break;

        case 'emotion':
            // Check emotion/sentiment in recent messages using keyword matching
            const emotionKeywords = {
                happy: ['happy', 'joy', 'smile', 'laugh', 'glad', 'cheerful', 'delighted', 'pleased'],
                sad: ['sad', 'cry', 'tear', 'depressed', 'unhappy', 'sorrow', 'miserable', 'gloomy'],
                angry: ['angry', 'mad', 'furious', 'rage', 'irritated', 'annoyed', 'hostile'],
                neutral: [], // Neutral has no keywords - always returns false
                excited: ['excited', 'thrilled', 'energetic', 'pumped', 'hyped', 'enthusiastic'],
                fearful: ['scared', 'afraid', 'fear', 'terrified', 'frightened', 'anxious', 'nervous'],
                surprised: ['surprised', 'shocked', 'amazed', 'astonished', 'startled', 'stunned']
            };

            const targetEmotion = (rule.value || 'neutral').toLowerCase();
            const keywords = emotionKeywords[targetEmotion] || [];
            const emotionText = context.recentMessages.join(' ').toLowerCase();

            result = keywords.some(kw => emotionText.includes(kw));
            break;

        case 'location':
            // Check if location matches in recent messages or metadata
            const locationValue = (rule.value || '').toLowerCase();
            const locationText = context.recentMessages.join(' ').toLowerCase();

            // Check for {{location}} macro expansion
            if (locationValue.includes('{{location}}')) {
                // Get current location from context
                const currentLocation = (context.location || '').toLowerCase();
                const searchTerm = locationValue.replace('{{location}}', '').trim();
                result = searchTerm ? currentLocation.includes(searchTerm) : currentLocation.length > 0;
            } else {
                // Simple keyword search in messages
                result = locationText.includes(locationValue);
            }
            break;

        case 'characterPresent':
            // Check if character name appears as a speaker in recent messages
            const characterName = (rule.value || '').toLowerCase();
            const speakers = context.messageSpeakers || [];

            result = speakers.some(speaker =>
                (speaker || '').toLowerCase().includes(characterName)
            );
            break;

        case 'storyBeat':
            // Check story beat/phase from metadata
            const beatValue = (rule.value || '').toLowerCase();

            // Check for {{storyphase}} macro
            if (beatValue.includes('{{storyphase}}')) {
                const currentBeat = (context.storyBeat || '').toLowerCase();
                const searchTerm = beatValue.replace('{{storyphase}}', '').trim();
                result = searchTerm ? currentBeat.includes(searchTerm) : currentBeat.length > 0;
            } else {
                // Direct match against metadata
                const currentBeat = (context.storyBeat || '').toLowerCase();
                result = currentBeat.includes(beatValue);
            }
            break;

        case 'randomChance':
            // Random percentage chance (0-100)
            const chance = parseInt(rule.value) || 50;
            const roll = Math.random() * 100;
            result = roll <= chance;
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

    return {
        recentMessages,
        lastSpeaker: lastMessage.name || (lastMessage.is_user ? 'User' : 'Character'),
        messageCount: chat.length,
        activeChunks,

        // NEW: Additional context for advanced conditions
        messageSpeakers,           // Array of speaker names for characterPresent
        location: metadata.location || '',          // Location from chat metadata
        storyBeat: metadata.storyBeat || metadata.storyphase || '',  // Story phase/beat
        timestamp: new Date()      // Current timestamp for timeOfDay
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

    if (rule.type === 'location' || rule.type === 'characterPresent' || rule.type === 'storyBeat') {
        if (!rule.value || rule.value.trim() === '') {
            errors.push(`${rule.type} value cannot be empty`);
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
