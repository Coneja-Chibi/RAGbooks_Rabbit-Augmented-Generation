/**
 * ============================================================================
 * VECTHARE KEYWORD LEARNER
 * ============================================================================
 * Analyzes individual entries to suggest keywords based on word frequency
 * within that entry's content.
 *
 * If a word appears X times in an entry, suggest it as a keyword for that entry.
 *
 * @version 1.0.0
 * ============================================================================
 */

// Stop words to ignore
const STOP_WORDS = new Set([
    // Articles
    'a', 'an', 'the',
    // Pronouns
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
    'you', 'your', 'yours', 'yourself', 'yourselves',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    // Prepositions
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'down',
    'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'over', 'out', 'off', 'against', 'around',
    // Conjunctions
    'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    // Common verbs
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
    'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
    'can', 'need', 'dare', 'ought', 'used', 'get', 'got', 'getting',
    'make', 'made', 'making', 'go', 'goes', 'went', 'going', 'gone',
    'come', 'came', 'coming', 'take', 'took', 'taken', 'taking',
    'see', 'saw', 'seen', 'seeing', 'know', 'knew', 'known', 'knowing',
    'think', 'thought', 'thinking', 'say', 'said', 'saying',
    // Common adverbs
    'very', 'really', 'just', 'also', 'only', 'even', 'still', 'already',
    'always', 'never', 'often', 'sometimes', 'usually', 'now', 'then',
    'here', 'there', 'where', 'when', 'why', 'how', 'all', 'each', 'every',
    'any', 'some', 'no', 'not', 'more', 'most', 'other', 'such', 'own',
    // Common adjectives
    'new', 'old', 'good', 'bad', 'great', 'little', 'big', 'small', 'large',
    'long', 'high', 'low', 'right', 'left', 'first', 'last', 'next', 'same',
    'different', 'few', 'many', 'much', 'well', 'back', 'way',
    // Misc
    'like', 'than', 'too', 'as', 'if', 'because', 'while', 'although',
    'though', 'since', 'until', 'unless', 'however', 'therefore',
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'etc', 'thing', 'things', 'something', 'anything', 'nothing', 'everything',
    'someone', 'anyone', 'everyone', 'nobody', 'people', 'person', 'time', 'times',
    'being', 'using', 'able', 'also', 'another', 'because', 'been', 'before',
    'being', 'between', 'both', 'came', 'come', 'could', 'did', 'does', 'done',
    'each', 'even', 'find', 'found', 'from', 'give', 'given', 'goes', 'going',
    'gone', 'gotten', 'had', 'has', 'have', 'having', 'here', 'hers', 'herself',
    'himself', 'into', 'itself', 'just', 'keep', 'kept', 'know', 'known', 'last',
    'left', 'less', 'made', 'make', 'many', 'might', 'more', 'most', 'much',
    'must', 'myself', 'never', 'next', 'none', 'only', 'other', 'others', 'ought',
    'ourselves', 'over', 'said', 'same', 'seem', 'seemed', 'seems', 'seen',
    'shall', 'since', 'some', 'still', 'such', 'take', 'taken', 'tell', 'than',
    'that', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
    'they', 'this', 'those', 'through', 'thus', 'told', 'took', 'toward',
    'towards', 'under', 'upon', 'very', 'want', 'wanted', 'wants', 'well',
    'went', 'were', 'what', 'whatever', 'when', 'whenever', 'where', 'wherever',
    'whether', 'which', 'whichever', 'while', 'whom', 'whose', 'will', 'with',
    'within', 'without', 'wont', 'would', 'yeah', 'yes', 'your', 'yours',
    'yourself', 'yourselves',
]);

// Minimum word length
const MIN_WORD_LENGTH = 4;

// Default threshold - word must appear this many times to be suggested
const DEFAULT_THRESHOLD = 3;

/**
 * Check if a word is trackable (not a stop word, long enough, etc.)
 * @param {string} word
 * @returns {boolean}
 */
function isTrackableWord(word) {
    if (!word || typeof word !== 'string') return false;
    const normalized = word.toLowerCase().trim();
    if (normalized.length < MIN_WORD_LENGTH) return false;
    if (STOP_WORDS.has(normalized)) return false;
    if (/\d/.test(normalized)) return false;
    if (!/^[a-z]+$/i.test(normalized)) return false;
    return true;
}

/**
 * Count word frequency in text
 * @param {string} text - Text to analyze
 * @returns {Map<string, number>} Word frequency map
 */
function countWords(text) {
    if (!text || typeof text !== 'string') return new Map();

    const words = text.split(/[^a-zA-Z]+/).filter(isTrackableWord);
    const counts = new Map();

    for (const word of words) {
        const normalized = word.toLowerCase();
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }

    return counts;
}

/**
 * Get suggested keywords for a single entry based on word frequency
 * @param {string} text - Entry content
 * @param {number} threshold - Minimum occurrences to suggest (default: 3)
 * @returns {Array<{word: string, count: number}>} Suggested keywords sorted by frequency
 */
export function getSuggestedKeywordsForEntry(text, threshold = DEFAULT_THRESHOLD) {
    const counts = countWords(text);
    const suggestions = [];

    for (const [word, count] of counts) {
        if (count >= threshold) {
            suggestions.push({ word, count });
        }
    }

    // Sort by count descending
    suggestions.sort((a, b) => b.count - a.count);

    return suggestions;
}

/**
 * Get suggested keywords as simple string array
 * @param {string} text - Entry content
 * @param {number} threshold - Minimum occurrences (default: 3)
 * @returns {string[]} Array of suggested keyword strings
 */
export function extractSuggestedKeywords(text, threshold = DEFAULT_THRESHOLD) {
    return getSuggestedKeywordsForEntry(text, threshold).map(s => s.word);
}

/**
 * Analyze an entry and return full word frequency data
 * @param {string} text - Entry content
 * @returns {{total: number, unique: number, frequencies: Array<{word: string, count: number}>}}
 */
export function analyzeEntry(text) {
    const counts = countWords(text);
    const frequencies = [];

    let total = 0;
    for (const [word, count] of counts) {
        frequencies.push({ word, count });
        total += count;
    }

    frequencies.sort((a, b) => b.count - a.count);

    return {
        total,
        unique: counts.size,
        frequencies,
    };
}
