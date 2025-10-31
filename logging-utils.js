/**
 * RAGBooks Logging Utilities
 * Provides clean, collapsible console logging similar to CarrotKernel
 */

export class RAGLogger {
    constructor(enabled = true, verboseMode = false) {
        this.enabled = enabled;
        this.verboseMode = verboseMode; // Show detailed debug info
        this.groupStack = [];
    }

    /**
     * Enable or disable verbose logging
     * @param {boolean} verbose - Whether to show verbose logs
     */
    setVerbose(verbose) {
        this.verboseMode = verbose;
    }

    /**
     * Start a collapsible console group
     * @param {string} title - Group title with emoji/icon
     * @param {object} data - Optional data to display in group
     */
    group(title, data = null) {
        if (!this.enabled) return;

        console.group(title);
        this.groupStack.push(title);

        if (data) {
            if (typeof data === 'object' && !Array.isArray(data) && console.table) {
                console.table(data);
            } else {
                console.log(data);
            }
        }
    }

    /**
     * End the current console group
     */
    groupEnd() {
        if (!this.enabled) return;
        if (this.groupStack.length > 0) {
            console.groupEnd();
            this.groupStack.pop();
        }
    }

    /**
     * Log a message (optionally with data)
     * @param {string} message - Message to log
     * @param {any} data - Optional data to display
     */
    log(message, data = null) {
        if (!this.enabled) return;

        console.log(message);

        if (data !== null && data !== undefined) {
            if (typeof data === 'object' && !Array.isArray(data) && console.table) {
                console.table(data);
            } else {
                console.log(data);
            }
        }
    }

    /**
     * Log verbose/debug information (only shows if verbose mode is enabled)
     * @param {string} message - Debug message
     * @param {any} data - Optional data
     */
    verbose(message, data = null) {
        if (!this.enabled || !this.verboseMode) return;

        console.log(`[DEBUG] ${message}`);

        if (data !== null && data !== undefined) {
            console.log(data);
        }
    }

    /**
     * Log a warning message
     * @param {string} message - Warning message
     * @param {any} data - Optional data
     */
    warn(message, data = null) {
        if (!this.enabled) return;

        console.warn(message);

        if (data !== null && data !== undefined) {
            console.log(data);
        }
    }

    /**
     * Log an error message
     * @param {string} message - Error message
     * @param {any} data - Optional data
     */
    error(message, data = null) {
        if (!this.enabled) return;

        console.error(message);

        if (data !== null && data !== undefined) {
            console.log(data);
        }
    }

    /**
     * Print a visual separator line
     * @param {string} style - 'top', 'middle', 'bottom', or 'full'
     * @param {number} length - Character length (default 60)
     */
    separator(style = 'full', length = 60) {
        if (!this.enabled) return;

        const lines = {
            top: '┌' + '─'.repeat(length - 2) + '┐',
            middle: '├' + '─'.repeat(length - 2) + '┤',
            bottom: '└' + '─'.repeat(length - 2) + '┘',
            full: '─'.repeat(length)
        };

        console.log(lines[style] || lines.full);
    }

    /**
     * Log an indented list item
     * @param {string} message - Item message
     * @param {number} level - Indentation level (default 1)
     */
    item(message, level = 1) {
        if (!this.enabled) return;
        const indent = '   '.repeat(level);
        console.log(`${indent}${message}`);
    }

    /**
     * Close all open groups (cleanup)
     */
    closeAll() {
        if (!this.enabled) return;
        while (this.groupStack.length > 0) {
            console.groupEnd();
            this.groupStack.pop();
        }
    }
}

// Singleton instance for global use
export const ragLogger = new RAGLogger();

// Expose to window for easy debugging in console
if (typeof window !== 'undefined') {
    window.ragLogger = ragLogger;
}

// Convenience functions for common log patterns
export const logSearchStart = (query, mode, features) => {
    ragLogger.group('🔍 [RAG Search] Enhanced search pipeline');
    ragLogger.log(`Query: "${query.substring(0, 100)}${query.length > 100 ? '...' : ''}"`);
    ragLogger.log(`Mode: ${mode}`);
    if (features) {
        ragLogger.log('Features:', features);
    }
};

export const logSearchStep = (stepNum, description, data = null) => {
    ragLogger.log(`Step ${stepNum}: ${description}`, data);
};

export const logSearchEnd = (chunksFound, chunks = []) => {
    ragLogger.separator('bottom');
    if (chunksFound > 0) {
        ragLogger.log(`✅ RAG: Found ${chunksFound} relevant chunk${chunksFound > 1 ? 's' : ''}`);

        // Show chunk details like CarrotKernel does
        if (chunks && chunks.length > 0) {
            ragLogger.log('📦 RAG: Chunks being injected:');
            chunks.forEach((chunk, i) => {
                const preview = chunk.text ? chunk.text.substring(0, 60) : 'No text';
                const section = chunk.section || chunk.name || 'Unknown';
                const score = chunk.score !== undefined ? chunk.score.toFixed(3) : chunk.rrfScore !== undefined ? chunk.rrfScore.toFixed(3) : 'N/A';
                const size = chunk.text ? chunk.text.length : 0;
                ragLogger.log(`   ${i + 1}. [${section}] ${preview}... (score: ${score}, ${size} chars)`);
            });
        }
    } else {
        ragLogger.warn('⚠️  RAG: No relevant chunks found for this query');
    }
    ragLogger.log('✅ RAG: Search complete');
    ragLogger.groupEnd();
};

export const logInjection = (chunks, characterName) => {
    ragLogger.group('💉 [RAG Injection] Inserting chunks into prompt');
    ragLogger.log(`Character: ${characterName}`);
    ragLogger.log(`Chunks: ${chunks.length}`);

    if (chunks.length > 0) {
        ragLogger.log('📦 Chunks being injected:');
        chunks.forEach((chunk, i) => {
            const preview = chunk.text ? chunk.text.substring(0, 60) : '';
            const section = chunk.section || chunk.name || 'Untitled';
            ragLogger.item(`${i + 1}. [${section}] ${preview}... (${chunk.text?.length || 0} chars)`);
        });
    }

    ragLogger.log('✅ Injection complete');
    ragLogger.groupEnd();
};

export const logKeywordExtraction = (functionName, input, output) => {
    ragLogger.group(`🔍 [${functionName}] Keyword extraction`);
    ragLogger.log('Input:', input);
    ragLogger.log('Output:', output);
    ragLogger.groupEnd();
};

export const logChunkMetadata = (sectionTitle, keywords, features) => {
    ragLogger.group(`🔍 [buildChunkMetadata] Processing: ${sectionTitle}`);
    ragLogger.log(`Total keywords: ${keywords?.length || 0}`);
    if (features) {
        ragLogger.log('Features:', features);
    }
    ragLogger.log('Final keywords:', keywords?.slice(0, 10));
    ragLogger.groupEnd();
};

/**
 * CONSOLE LOGGING CONTROL
 *
 * RAGBooks uses grouped, collapsible console logging to keep output clean.
 * All logs are contained in groups that can be collapsed in the browser console.
 *
 * To control logging verbosity:
 *
 * 1. Disable all RAGBooks logging:
 *    ragLogger.enabled = false
 *
 * 2. Enable verbose/debug logging:
 *    ragLogger.setVerbose(true)
 *
 * 3. Re-enable logging:
 *    ragLogger.enabled = true
 *
 * You can run these commands directly in the browser console.
 * The ragLogger is exposed globally as window.ragLogger.
 */
