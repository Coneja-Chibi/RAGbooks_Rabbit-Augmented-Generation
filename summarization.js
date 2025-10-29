/**
 * RAGBooks Summarization Module
 *
 * Handles AI-powered chunk summarization for dual-vector search.
 * Generates concise summaries that improve semantic matching.
 */

import { generateRaw } from '../../../../script.js';

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
            console.warn('[RAGBooks Summarization] Invalid chunk text');
            return null;
        }

        // Get style preset
        const styleConfig = SUMMARY_STYLES[style] || SUMMARY_STYLES.concise;

        // Prepare prompt - simpler and more direct with generateRaw
        const prompt = `${styleConfig.systemPrompt}\n\nSummarize the following text:\n\n${chunkText}`;

        // Call SillyTavern's raw generation API (like qvink_memory does)
        const summary = await generateRaw({
            prompt: prompt,
            trimNames: false
        });

        // Validate and clean response
        if (!summary || typeof summary !== 'string') {
            console.warn('[RAGBooks Summarization] Empty or invalid summary response');
            return null;
        }

        const cleanSummary = summary.trim();

        // Enforce max length
        if (cleanSummary.length > styleConfig.maxLength) {
            return cleanSummary.substring(0, styleConfig.maxLength) + '...';
        }

        return cleanSummary;

    } catch (error) {
        console.error('[RAGBooks Summarization] Failed to generate summary:', error);
        return null;
    }
}

/**
 * Generate summaries for multiple chunks in batch
 * @param {Array} chunks - Array of chunk objects
 * @param {string} style - Summary style
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<Array>} Chunks with summaries added
 */
export async function generateSummariesForChunks(chunks, style = 'concise', progressCallback = null) {
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
        return chunks;
    }

    console.log(`[RAGBooks Summarization] Generating ${style} summaries for ${chunks.length} chunks...`);

    const chunksToSummarize = chunks.filter(chunk =>
        chunk.metadata?.enableSummary === true &&
        !chunk.isSummaryChunk &&
        chunk.text &&
        chunk.text.length > 50 // Skip very short chunks
    );

    if (chunksToSummarize.length === 0) {
        console.log('[RAGBooks Summarization] No chunks need summarization');
        return chunks;
    }

    console.log(`[RAGBooks Summarization] ${chunksToSummarize.length} chunks eligible for summarization`);

    let successCount = 0;
    let failCount = 0;

    // Process chunks sequentially to avoid API rate limits
    for (let i = 0; i < chunksToSummarize.length; i++) {
        const chunk = chunksToSummarize[i];

        try {
            // Generate summary
            const summary = await generateSummaryForChunk(chunk.text, style);

            if (summary) {
                // Add summary to chunk
                chunk.summary = summary;
                chunk.summaryVector = true; // Enable dual-vector search
                successCount++;

                console.log(`[RAGBooks Summarization] ✓ Chunk ${i + 1}/${chunksToSummarize.length}: "${summary.substring(0, 50)}..."`);
            } else {
                failCount++;
                console.warn(`[RAGBooks Summarization] ✗ Chunk ${i + 1}/${chunksToSummarize.length}: Failed`);
            }

            // Progress callback
            if (progressCallback) {
                progressCallback(i + 1, chunksToSummarize.length);
            }

        } catch (error) {
            failCount++;
            console.error(`[RAGBooks Summarization] Error on chunk ${i + 1}:`, error);
        }

        // Small delay to avoid hammering API
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`[RAGBooks Summarization] Complete: ${successCount} succeeded, ${failCount} failed`);

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
        console.warn(`[RAGBooks Summarization] Unknown style: ${style}, using concise`);
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
