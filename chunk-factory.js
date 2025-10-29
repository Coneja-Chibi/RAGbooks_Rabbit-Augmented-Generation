// =============================================================================
// CHUNK FACTORY
// Centralized chunk creation to eliminate code duplication across parsers
// =============================================================================

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

export default {
    createChunk,
    createChunksFromSplit,
    validateChunkOptions
};
