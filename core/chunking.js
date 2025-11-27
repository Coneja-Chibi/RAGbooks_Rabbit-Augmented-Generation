/**
 * ============================================================================
 * VECTHARE CHUNKING STRATEGIES
 * ============================================================================
 * Unified chunking system for all content types.
 * Each strategy is a pure function that takes text and options, returns chunks.
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

// Note: Scenes are now stored as chunks directly in the vector DB with isScene:true metadata
// The by_scene chunking strategy is deprecated - scenes are created via UI markers

/**
 * Main entry point - chunks text using specified strategy
 * @param {string} text - Text to chunk
 * @param {object} options - Chunking options
 * @param {string} options.strategy - Strategy ID
 * @param {number} options.chunkSize - Target chunk size in characters
 * @param {number} options.chunkOverlap - Overlap between chunks
 * @returns {Array<{text: string, metadata: object}>} Array of chunks
 */
export async function chunkText(text, options = {}) {
    const {
        strategy = 'paragraph',
        chunkSize = 500,
        chunkOverlap = 50,
    } = options;

    // Allow arrays for unit-based strategies (per_entry, per_field, by_message)
    if (!text || (typeof text !== 'string' && !Array.isArray(text))) {
        return [];
    }

    // Select strategy
    const strategyFn = STRATEGIES[strategy] || STRATEGIES.paragraph;
    const chunks = strategyFn(text, { chunkSize, chunkOverlap });

    // Add metadata to each chunk
    return chunks.map((chunk, index) => ({
        text: typeof chunk === 'string' ? chunk : chunk.text,
        metadata: {
            chunkIndex: index,
            totalChunks: chunks.length,
            strategy: strategy,
            ...(typeof chunk === 'object' ? chunk.metadata : {}),
        },
    }));
}

/**
 * Strategy implementations
 */
const STRATEGIES = {
    /**
     * Split on paragraph boundaries (double newlines)
     * Each paragraph becomes its own chunk - no size-based splitting or merging
     */
    paragraph: (text, options) => {
        // Split on double newlines OR horizontal rules (---)
        const paragraphs = text.split(/\n\n+|^---+$/m).filter(p => p.trim());

        // Each paragraph is its own chunk - don't merge or split
        return paragraphs.map(p => p.trim());
    },

    /**
     * Split on markdown section headers
     * Each section (from one header to the next) becomes its own chunk
     */
    section: (text, options) => {
        // Match markdown headers (# to ######)
        const headerRegex = /^(#{1,6})\s+(.+)$/gm;
        const sections = [];
        let lastIndex = 0;
        let match;

        while ((match = headerRegex.exec(text)) !== null) {
            // Get content before this header
            if (match.index > lastIndex) {
                const beforeContent = text.slice(lastIndex, match.index).trim();
                if (beforeContent) {
                    sections.push(beforeContent);
                }
            }
            lastIndex = match.index;
        }

        // Get remaining content
        if (lastIndex < text.length) {
            sections.push(text.slice(lastIndex).trim());
        }

        // If no headers found, fall back to paragraph
        if (sections.length === 0) {
            return STRATEGIES.paragraph(text, options);
        }

        // Each section is its own chunk - no splitting
        return sections.filter(s => s);
    },

    /**
     * Split on sentence boundaries
     */
    sentence: (text, options) => {
        // Split on sentence-ending punctuation followed by space or newline
        const sentences = text
            .split(/(?<=[.!?])\s+/)
            .filter(s => s.trim())
            .map(s => s.trim());

        // Group sentences to reach target chunk size
        const chunks = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            if (currentChunk.length + sentence.length + 1 <= options.chunkSize) {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            } else {
                if (currentChunk) chunks.push(currentChunk);
                currentChunk = sentence;
            }
        }

        if (currentChunk) chunks.push(currentChunk);

        return chunks;
    },

    /**
     * Smart size-based chunking with natural boundaries
     */
    natural: (text, options) => {
        return naturalChunk(text, options);
    },

    /**
     * Adaptive chunking - alias for natural/recursive approach
     * Intelligently splits at natural boundaries (paragraphs → sentences → words)
     */
    adaptive: (text, options) => {
        return naturalChunk(text, options);
    },

    /**
     * Sliding window with overlap
     */
    sliding: (text, options) => {
        const { chunkSize, chunkOverlap } = options;
        const chunks = [];
        let start = 0;

        while (start < text.length) {
            let end = start + chunkSize;

            // Try to break at a natural boundary
            if (end < text.length) {
                // Look for sentence end
                const searchStart = Math.max(end - 50, start);
                const segment = text.slice(searchStart, end + 50);
                const sentenceEnd = segment.search(/[.!?]\s/);

                if (sentenceEnd !== -1) {
                    end = searchStart + sentenceEnd + 1;
                } else {
                    // Look for word boundary
                    const spaceIndex = text.lastIndexOf(' ', end);
                    if (spaceIndex > start) {
                        end = spaceIndex;
                    }
                }
            } else {
                end = text.length;
            }

            chunks.push(text.slice(start, end).trim());

            // Move start, accounting for overlap
            start = end - chunkOverlap;
            if (start >= text.length) break;
        }

        return chunks;
    },

    /**
     * Per message (for chat) - expects array input
     */
    by_message: (text, options) => {
        // If already split (array), return as-is
        if (Array.isArray(text)) {
            return text.map(t => typeof t === 'string' ? t : t.text || String(t));
        }
        // Otherwise treat as single chunk
        return [text];
    },

    /**
     * Per entry (for lorebook) - expects array input
     */
    per_entry: (text, options) => {
        if (Array.isArray(text)) {
            return text.map(t => typeof t === 'string' ? t : t.text || String(t));
        }
        return [text];
    },

    /**
     * Per field (for character) - expects object input
     */
    per_field: (text, options) => {
        if (typeof text === 'object' && !Array.isArray(text)) {
            return Object.entries(text)
                .filter(([, value]) => value && typeof value === 'string')
                .map(([field, value]) => ({
                    text: value,
                    metadata: { field },
                }));
        }
        return [text];
    },

    /**
     * By speaker (for chat) - expects messages array
     */
    by_speaker: (messages, options) => {
        if (!Array.isArray(messages)) return [messages];

        const chunks = [];
        let currentChunk = { speakers: [], messages: [], text: '' };

        for (const msg of messages) {
            const speaker = msg.name || msg.is_user ? 'user' : 'assistant';

            // Check if same speaker or first message
            if (currentChunk.messages.length === 0 ||
                currentChunk.speakers[currentChunk.speakers.length - 1] === speaker) {
                currentChunk.messages.push(msg);
                currentChunk.text += (currentChunk.text ? '\n' : '') + `${speaker}: ${msg.mes || msg.text || ''}`;
                if (!currentChunk.speakers.includes(speaker)) {
                    currentChunk.speakers.push(speaker);
                }
            } else {
                // Different speaker - start new chunk
                if (currentChunk.text) {
                    chunks.push({
                        text: currentChunk.text,
                        metadata: {
                            speakers: currentChunk.speakers,
                            messageCount: currentChunk.messages.length,
                        },
                    });
                }
                currentChunk = {
                    speakers: [speaker],
                    messages: [msg],
                    text: `${speaker}: ${msg.mes || msg.text || ''}`,
                };
            }
        }

        // Push last chunk
        if (currentChunk.text) {
            chunks.push({
                text: currentChunk.text,
                metadata: {
                    speakers: currentChunk.speakers,
                    messageCount: currentChunk.messages.length,
                },
            });
        }

        return chunks;
    },

    /**
     * By scene - DEPRECATED
     * Scenes are now stored directly as chunks in the vector DB with isScene:true metadata.
     * Scene chunks are created via the UI markers, not through this chunking strategy.
     */
    by_scene: (_messages, _options) => {
        console.warn('by_scene chunking strategy is deprecated. Scenes are now created via UI markers and stored directly in the vector DB.');
        return [];
    },

    /**
     * Dialogue-aware - keeps quoted speech intact
     */
    dialogue: (text, options) => {
        // Split preserving dialogue blocks
        const dialogueRegex = /"[^"]+"|'[^']+'|「[^」]+」|『[^』]+』/g;

        let chunks = [];
        let currentChunk = '';
        let lastIndex = 0;

        // Find all dialogue sections
        let match;
        while ((match = dialogueRegex.exec(text)) !== null) {
            // Add text before dialogue
            const before = text.slice(lastIndex, match.index);
            currentChunk += before;

            // Add dialogue (try to keep with context)
            const dialogue = match[0];

            if (currentChunk.length + dialogue.length <= options.chunkSize) {
                currentChunk += dialogue;
            } else {
                if (currentChunk.trim()) chunks.push(currentChunk.trim());
                currentChunk = dialogue;
            }

            lastIndex = match.index + dialogue.length;
        }

        // Add remaining text
        currentChunk += text.slice(lastIndex);
        if (currentChunk.trim()) chunks.push(currentChunk.trim());

        // Further split any chunks that are too large
        const finalChunks = [];
        for (const chunk of chunks) {
            if (chunk.length <= options.chunkSize) {
                finalChunks.push(chunk);
            } else {
                finalChunks.push(...naturalChunk(chunk, options));
            }
        }

        return finalChunks;
    },

    /**
     * Combined - merge all content then chunk (for character cards)
     */
    combined: (text, options) => {
        let combined = '';

        if (typeof text === 'object' && !Array.isArray(text)) {
            combined = Object.values(text)
                .filter(v => v && typeof v === 'string')
                .join('\n\n');
        } else if (Array.isArray(text)) {
            combined = text.map(t => typeof t === 'string' ? t : t.text || '').join('\n\n');
        } else {
            combined = String(text);
        }

        return STRATEGIES.natural(combined, options);
    },
};

/**
 * Natural chunking - splits at natural boundaries respecting size limits
 */
function naturalChunk(text, options) {
    const { chunkSize } = options;
    const chunks = [];

    // First try paragraph splits
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

    let currentChunk = '';

    for (const para of paragraphs) {
        const trimmedPara = para.trim();

        if (!trimmedPara) continue;

        // If adding this paragraph exceeds limit
        if (currentChunk.length + trimmedPara.length + 2 > chunkSize) {
            // If current chunk has content, push it
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }

            // If paragraph itself is too big, split it
            if (trimmedPara.length > chunkSize) {
                chunks.push(...splitLargeParagraph(trimmedPara, chunkSize));
            } else {
                currentChunk = trimmedPara;
            }
        } else {
            currentChunk += (currentChunk ? '\n\n' : '') + trimmedPara;
        }
    }

    if (currentChunk) chunks.push(currentChunk.trim());

    return chunks;
}

/**
 * Splits a large paragraph at sentence boundaries
 */
function splitLargeParagraph(text, maxSize) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
        if (currentChunk.length + sentence.length + 1 <= maxSize) {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
        } else {
            if (currentChunk) chunks.push(currentChunk);

            // If single sentence is too big, split by words
            if (sentence.length > maxSize) {
                const words = sentence.split(/\s+/);
                let wordChunk = '';
                for (const word of words) {
                    if (wordChunk.length + word.length + 1 <= maxSize) {
                        wordChunk += (wordChunk ? ' ' : '') + word;
                    } else {
                        if (wordChunk) chunks.push(wordChunk);
                        wordChunk = word;
                    }
                }
                if (wordChunk) currentChunk = wordChunk;
            } else {
                currentChunk = sentence;
            }
        }
    }

    if (currentChunk) chunks.push(currentChunk);

    return chunks;
}

/**
 * Merge very small chunks together
 */
function mergeTinyChunks(chunks, targetSize) {
    const minSize = Math.floor(targetSize * 0.3); // 30% of target
    const merged = [];
    let currentChunk = '';

    for (const chunk of chunks) {
        if (chunk.length < minSize && currentChunk.length + chunk.length < targetSize) {
            currentChunk += (currentChunk ? '\n\n' : '') + chunk;
        } else {
            if (currentChunk) merged.push(currentChunk);
            currentChunk = chunk;
        }
    }

    if (currentChunk) merged.push(currentChunk);

    return merged;
}

/**
 * Get available strategies
 */
export function getAvailableStrategies() {
    return Object.keys(STRATEGIES);
}
