/**
 * RAGBooks Semantic Chunking Module
 *
 * Implements AI-powered semantic chunking using embeddings to detect topic shifts.
 * Uses cosine similarity between consecutive sentences to identify natural boundaries.
 */

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
        console.warn('[RAGBooks Semantic] Vector length mismatch:', vec1.length, 'vs', vec2.length);
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
 * DISABLED: Semantic chunking requires too many embedding API calls
 * Would need to create temporary collections or have a dedicated embedding endpoint
 * For now, semantic chunking is not available
 */
async function getEmbedding(text) {
    throw new Error('Semantic chunking is currently disabled - requires embedding API infrastructure');
}

/**
 * DISABLED: Batch embeddings not available
 */
async function getBatchEmbeddings(texts, progressCallback = null) {
    throw new Error('Semantic chunking is currently disabled - requires embedding API infrastructure');
}

/**
 * DISABLED: Semantic chunking disabled until embedding API infrastructure is added
 * This would require creating temporary collections or a dedicated embedding endpoint
 * For now, falls back to simple sentence-based chunking
 */
export async function semanticChunkText(text, options = {}) {
    console.warn('[RAGBooks Semantic] Semantic chunking is disabled - falling back to sentence grouping');

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
 * Split a chunk that exceeds max size
 * @param {string} text - Text to split
 * @param {number} maxSize - Maximum chunk size
 * @returns {string[]} Array of sub-chunks
 */
function splitLargeChunk(text, maxSize) {
    const chunks = [];
    const sentences = splitIntoSentences(text);

    let currentChunk = '';
    for (const sentence of sentences) {
        if ((currentChunk + ' ' + sentence).length > maxSize && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
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

    console.log(`[RAGBooks Sliding Window] Created ${chunks.length} chunks (${config.windowSize} chars, ${config.overlapPercent}% overlap)`);

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
