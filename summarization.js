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
            trimNames: false  // Mark as quiet generation to prevent extension interference (e.g., Rabbit Response Team)
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

    console.log(`[RAGBooks Summarization] Generating ${style} summaries for ${chunks.length} chunks...`);

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
        console.warn(`[RAGBooks Summarization] ⚠️ Skipped all chunks: ${reason}`);
        return chunks;
    }

    console.log(`[RAGBooks Summarization] ${chunksToSummarize.length} chunks eligible for summarization`);
    if (skipReasons.length > 0) {
        console.warn(`[RAGBooks Summarization] ⚠️ Skipped ${skipReasons.join(', ')}`);
    }

    let successCount = 0;
    let failCount = 0;
    let currentDelay = delayMs; // Track current delay (may be upgraded dynamically)

    // Process chunks sequentially to avoid API rate limits
    for (let i = 0; i < chunksToSummarize.length; i++) {
        // Check for cancellation before processing each chunk
        if (abortSignal?.aborted) {
            console.log(`[RAGBooks Summarization] Cancelled after ${successCount} summaries`);
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

                    console.log(`[RAGBooks Summarization] ✓ Chunk ${i + 1}/${chunksToSummarize.length}: "${summary.substring(0, 50)}..."`);
                } else {
                    // No summary returned but no error thrown
                    failCount++;
                    console.warn(`[RAGBooks Summarization] ✗ Chunk ${i + 1}/${chunksToSummarize.length}: No summary generated`);
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
                    console.warn(`[RAGBooks Summarization] ⚠ Rate limit detected on chunk ${i + 1}. Upgrading delay: ${oldDelay}ms → ${Math.round(currentDelay)}ms`);

                    // Exponential backoff for immediate retry: 2s, 4s, 8s, 16s...
                    const retryDelay = Math.min(2000 * Math.pow(2, retryCount - 1), 30000); // Cap at 30s
                    console.warn(`[RAGBooks Summarization] ⚠ Retrying chunk ${i + 1} in ${retryDelay/1000}s (attempt ${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    // Continue the loop to retry
                } else if (!isRateLimit) {
                    // Non-rate-limit error - log and stop retrying this chunk
                    console.error(`[RAGBooks Summarization] ✗ Error on chunk ${i + 1}:`, error.message);
                    failCount++;
                    break;
                } else {
                    // Should not reach here, but just in case
                    console.error(`[RAGBooks Summarization] ✗ Chunk ${i + 1} failed:`, error.message);
                    failCount++;
                    break;
                }
            }
        }

        // If still not successful after all retries, mark as failed
        if (!success && retryCount > maxRetries) {
            console.error(`[RAGBooks Summarization] ✗ Chunk ${i + 1} abandoned after ${maxRetries} retries with rate limit errors`);
            failCount++;
        }

        // Use dynamically adjusted delay between chunks (only if successful)
        if (success && currentDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, currentDelay));
        }
    }

    console.log(`[RAGBooks Summarization] Complete: ${successCount} succeeded, ${failCount} failed`);

    // Log if delay was dynamically upgraded
    if (currentDelay > delayMs) {
        console.log(`[RAGBooks Summarization] ⚙️ Delay auto-upgraded from ${delayMs}ms to ${Math.round(currentDelay)}ms due to rate limiting`);
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
