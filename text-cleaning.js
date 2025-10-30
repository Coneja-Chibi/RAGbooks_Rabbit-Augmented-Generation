/**
 * RAGBooks Text Cleaning Module
 *
 * Provides HTML/code scrubbing functionality with multiple cleaning modes
 * and user-customizable regex patterns.
 */

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
            console.warn(`[RAGBooks TextCleaning] Failed to apply preset pattern: ${pattern}`, error);
        }
    }

    // Apply user's custom patterns
    for (const customPattern of customPatterns) {
        if (customPattern.enabled !== false) {
            try {
                const regex = new RegExp(customPattern.pattern, customPattern.flags || 'g');
                cleaned = cleaned.replace(regex, customPattern.replacement || '');
            } catch (error) {
                console.warn(`[RAGBooks TextCleaning] Failed to apply custom pattern: ${customPattern.name}`, error);
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
