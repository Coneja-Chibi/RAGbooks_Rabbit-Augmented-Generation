/**
 * Rabbit Augmented Generation - Core System Module
 *
 * WHY: Consolidates diagnostics, logging, and error handling into a single module.
 * These three systems are tightly coupled and form the foundation of the extension.
 *
 * This module provides:
 * - Diagnostic system: Check registry, execution, result tracking, fix system
 * - Error handling: Typed error classes, user-friendly messages, recovery strategies
 * - Logging: Structured console logging with collapsible groups, log level controls
 *
 * Consolidated from: core-diagnostics.js + core-errors.js + core-logging.js
 */

// ==================== DIAGNOSTICS SYSTEM ====================

/**
 * Diagnostic System
 *
 * WHY: Every potential failure point needs a diagnostic check with user-friendly
 * explanations and fix buttons. No silent failures allowed.
 */
export class Diagnostics {
    // Registry of all diagnostic checks
    static checks = new Map();

    // Results of check executions
    static results = new Map();

    // Runtime issue tracking
    static runtimeIssues = [];

    /**
     * Register a diagnostic check
     * WHY: Allows modules to register their checks during initialization
     *
     * @param {string} id - Unique check identifier (e.g., 'state-structure-valid')
     * @param {object} config - Check configuration
     * @param {string} config.name - Human-readable check name
     * @param {string} config.description - What this check validates
     * @param {string} config.category - Category (CORE, EMBEDDINGS, SEARCH, PARSE, UI)
     * @param {function} config.checkFn - Async function that performs the check
     * @param {function} [config.fixFn] - Optional auto-fix function
     */
    static registerCheck(id, config) {
        if (this.checks.has(id)) {
            console.warn(`[RAG:DIAGNOSTICS] Check ${id} already registered, overwriting`);
        }

        // Validate config
        if (!config.name || !config.checkFn) {
            throw new Error(`Invalid check config for ${id}: missing name or checkFn`);
        }

        this.checks.set(id, {
            id,
            name: config.name,
            description: config.description || '',
            category: config.category || 'GENERAL',
            checkFn: config.checkFn,
            fixFn: config.fixFn || null,
            registeredAt: Date.now()
        });

        console.log(`[RAG:DIAGNOSTICS] Registered check: ${id}`);
    }

    /**
     * Run a single diagnostic check
     * WHY: Allows targeted diagnosis of specific issues
     *
     * @param {string} id - Check identifier
     * @returns {Promise<object>} Check result
     */
    static async runCheck(id) {
        const check = this.checks.get(id);

        if (!check) {
            return {
                id,
                status: 'error',
                message: `Check ${id} not found`,
                userMessage: `Diagnostic check not found: ${id}`,
                timestamp: Date.now()
            };
        }

        try {
            console.log(`[RAG:DIAGNOSTICS] Running check: ${id}`);

            const startTime = performance.now();
            const result = await check.checkFn();
            const duration = performance.now() - startTime;

            // Validate result format
            if (!result || !result.status) {
                throw new Error('Check function must return {status, message, ...}');
            }

            // Valid statuses: pass, info, warn, error, critical
            const validStatuses = ['pass', 'info', 'warn', 'error', 'critical'];
            if (!validStatuses.includes(result.status)) {
                throw new Error(`Invalid status: ${result.status}. Must be one of: ${validStatuses.join(', ')}`);
            }

            const fullResult = {
                ...result,
                id,
                name: check.name,
                category: check.category,
                duration,
                timestamp: Date.now()
            };

            // Store result
            this.results.set(id, fullResult);

            // Log result
            const logLevel = result.status === 'pass' ? 'log' : result.status === 'critical' || result.status === 'error' ? 'error' : 'warn';
            console[logLevel](`[RAG:DIAGNOSTICS] ${id}: ${result.status.toUpperCase()} - ${result.message}`);

            return fullResult;

        } catch (error) {
            console.error(`[RAG:DIAGNOSTICS] Check ${id} threw error:`, error);

            const errorResult = {
                id,
                name: check.name,
                category: check.category,
                status: 'error',
                message: `Check failed: ${error.message}`,
                userMessage: `Diagnostic check failed: ${error.message}`,
                error: error.message,
                timestamp: Date.now()
            };

            this.results.set(id, errorResult);
            return errorResult;
        }
    }

    /**
     * Run all registered diagnostic checks
     * WHY: Provides comprehensive system health report
     *
     * @param {object} options - Execution options
     * @param {string[]} [options.categories] - Only run checks in these categories
     * @param {function} [options.progressCallback] - Called after each check
     * @returns {Promise<object[]>} Array of check results
     */
    static async runAll(options = {}) {
        const { categories, progressCallback } = options;

        console.log('[RAG:DIAGNOSTICS] Running all diagnostic checks...');

        const results = [];
        const checksToRun = Array.from(this.checks.values()).filter(check => {
            if (!categories || categories.length === 0) return true;
            return categories.includes(check.category);
        });

        for (let i = 0; i < checksToRun.length; i++) {
            const check = checksToRun[i];
            const result = await this.runCheck(check.id);
            results.push(result);

            if (progressCallback) {
                progressCallback({
                    current: i + 1,
                    total: checksToRun.length,
                    checkId: check.id,
                    result
                });
            }
        }

        console.log(`[RAG:DIAGNOSTICS] Completed ${results.length} checks`);

        return results;
    }

    /**
     * Run quick health check (only critical checks)
     * WHY: Fast system health validation during initialization
     *
     * @returns {Promise<boolean>} True if all critical checks pass
     */
    static async runQuickCheck() {
        console.log('[RAG:DIAGNOSTICS] Running quick health check...');

        // Run only checks that are typically critical
        const criticalCheckIds = [
            'diagnostic-system-health',
            'state-structure-valid',
            'errors-no-unhandled',
            'index-init-success'
        ];

        const results = [];
        for (const id of criticalCheckIds) {
            if (this.checks.has(id)) {
                const result = await this.runCheck(id);
                results.push(result);
            }
        }

        const hasCriticalIssues = results.some(r => r.status === 'critical' || r.status === 'error');

        if (hasCriticalIssues) {
            console.error('[RAG:DIAGNOSTICS] Quick check FAILED - critical issues detected');
            return false;
        }

        console.log('[RAG:DIAGNOSTICS] Quick check PASSED');
        return true;
    }

    /**
     * Record a successful operation (for tracking)
     * WHY: Allows modules to record successes for later diagnostic validation
     *
     * @param {string} checkId - Associated check ID
     * @param {object} data - Success data
     */
    static recordSuccess(checkId, data = {}) {
        this.runtimeIssues = this.runtimeIssues.filter(issue => issue.checkId !== checkId);
        console.log(`[RAG:DIAGNOSTICS] Success recorded: ${checkId}`);
    }

    /**
     * Record a failure (for tracking)
     * WHY: Allows modules to record failures that diagnostics can later report
     *
     * @param {string} checkId - Associated check ID
     * @param {object} data - Failure data
     */
    static recordFailure(checkId, data = {}) {
        const issue = {
            checkId,
            data,
            timestamp: Date.now()
        };

        this.runtimeIssues.push(issue);
        console.warn(`[RAG:DIAGNOSTICS] Failure recorded: ${checkId}`, data);
    }

    /**
     * Get runtime issues for a specific check
     * WHY: Allows checks to access previously recorded failures
     *
     * @param {string} checkId - Check ID
     * @returns {object[]} Array of recorded issues
     */
    static getRuntimeIssues(checkId) {
        return this.runtimeIssues.filter(issue => issue.checkId === checkId);
    }

    /**
     * Clear all runtime issues
     * WHY: Allows resetting issue tracking (e.g., after fixes applied)
     */
    static clearRuntimeIssues() {
        this.runtimeIssues = [];
        console.log('[RAG:DIAGNOSTICS] Runtime issues cleared');
    }

    /**
     * Generate HTML report of check results
     * WHY: Provides user-friendly diagnostic report
     *
     * @param {object[]} results - Check results to report
     * @returns {string} HTML report
     */
    static generateReport(results = null) {
        const resultsToReport = results || Array.from(this.results.values());

        // Group by status
        const grouped = {
            critical: resultsToReport.filter(r => r.status === 'critical'),
            error: resultsToReport.filter(r => r.status === 'error'),
            warn: resultsToReport.filter(r => r.status === 'warn'),
            info: resultsToReport.filter(r => r.status === 'info'),
            pass: resultsToReport.filter(r => r.status === 'pass')
        };

        const totalChecks = resultsToReport.length;
        const passedChecks = grouped.pass.length;
        const issueCount = grouped.critical.length + grouped.error.length + grouped.warn.length;

        let html = `
            <div class="rag_diagnostic_report">
                <div class="rag_diagnostic_summary">
                    <h3>Diagnostic Summary</h3>
                    <p><strong>${passedChecks}/${totalChecks}</strong> checks passed</p>
                    ${issueCount > 0 ? `<p class="rag_issues"><strong>${issueCount}</strong> issues found</p>` : '<p class="rag_all_good">All checks passed!</p>'}
                </div>
        `;

        // Critical issues
        if (grouped.critical.length > 0) {
            html += this._generateSection('Critical Issues', grouped.critical, 'critical');
        }

        // Errors
        if (grouped.error.length > 0) {
            html += this._generateSection('Errors', grouped.error, 'error');
        }

        // Warnings
        if (grouped.warn.length > 0) {
            html += this._generateSection('Warnings', grouped.warn, 'warn');
        }

        // Info
        if (grouped.info.length > 0) {
            html += this._generateSection('Information', grouped.info, 'info');
        }

        // Passed checks (collapsible)
        if (grouped.pass.length > 0) {
            html += `
                <div class="rag_diagnostic_section rag_passed">
                    <h4 class="rag_section_header" data-toggle="collapse">
                        <span class="rag_collapse_icon">▶</span>
                        Passed Checks (${grouped.pass.length})
                    </h4>
                    <div class="rag_section_content" style="display: none;">
                        ${grouped.pass.map(r => `
                            <div class="rag_check_item pass">
                                <span class="rag_check_status">✓</span>
                                <span class="rag_check_name">${r.name}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        html += '</div>';

        return html;
    }

    /**
     * Generate report section HTML
     * WHY: Reusable section generator for different severity levels
     *
     * @private
     */
    static _generateSection(title, results, severity) {
        const icons = {
            critical: '🔴',
            error: '❌',
            warn: '⚠️',
            info: 'ℹ️'
        };

        let html = `
            <div class="rag_diagnostic_section rag_${severity}">
                <h4>${icons[severity]} ${title} (${results.length})</h4>
        `;

        for (const result of results) {
            html += `
                <div class="rag_check_item ${severity}">
                    <div class="rag_check_header">
                        <strong>${result.name}</strong>
                        <span class="rag_check_category">${result.category}</span>
                    </div>
                    <div class="rag_check_message">
                        ${result.userMessage || result.message}
                    </div>
            `;

            // Add fix buttons if available
            if (result.fixes && result.fixes.length > 0) {
                html += '<div class="rag_check_fixes">';
                for (const fix of result.fixes) {
                    html += `
                        <button class="rag_fix_button" data-check-id="${result.id}" data-fix-action="${fix.action}">
                            ${fix.label}
                        </button>
                    `;
                    if (fix.description) {
                        html += `<span class="rag_fix_description">${fix.description}</span>`;
                    }
                }
                html += '</div>';
            }

            html += '</div>';
        }

        html += '</div>';

        return html;
    }

    /**
     * Get summary statistics
     * WHY: Quick overview of diagnostic health
     *
     * @returns {object} Summary stats
     */
    static getSummary() {
        const results = Array.from(this.results.values());

        return {
            totalChecks: this.checks.size,
            runChecks: results.length,
            passed: results.filter(r => r.status === 'pass').length,
            critical: results.filter(r => r.status === 'critical').length,
            errors: results.filter(r => r.status === 'error').length,
            warnings: results.filter(r => r.status === 'warn').length,
            info: results.filter(r => r.status === 'info').length
        };
    }
}

// ==================== ERROR HANDLING ====================

/**
 * Base error class for all RAG errors
 * WHY: Typed errors allow us to handle different failure modes appropriately
 */
export class RAGError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'RAGError';
        this.code = code;
        this.details = details;
        this.timestamp = Date.now();
        this.isRecoverable = false;

        // Record in diagnostics
        Diagnostics.recordFailure('error-occurred', {
            code: this.code,
            message: this.message,
            details: this.details,
            timestamp: this.timestamp
        });
    }

    /**
     * Get user-friendly error message
     * WHY: Technical errors need to be translated to user-actionable messages
     */
    getUserMessage() {
        return this.message;
    }

    /**
     * Get recovery suggestions
     * WHY: Help users fix the problem themselves
     */
    getRecoverySuggestions() {
        return [];
    }
}

/**
 * Embedding provider errors
 * WHY: Embeddings are critical - these errors need clear guidance
 */
export class EmbeddingError extends RAGError {
    constructor(message, provider, originalError = null) {
        super(message, 'EMBEDDING_ERROR', {
            provider,
            originalError: originalError?.message || null
        });
        this.name = 'EmbeddingError';
        this.provider = provider;
        this.isRecoverable = true;
    }

    getUserMessage() {
        const messages = {
            'PROVIDER_NOT_CONFIGURED': `No embedding provider is configured. Please configure a provider in Extensions > Vectors.`,
            'PROVIDER_UNREACHABLE': `Cannot reach embedding provider (${this.provider}). Check that it's running and accessible.`,
            'DIMENSION_MISMATCH': `Embedding dimensions don't match. Collections were created with different providers. Re-vectorize affected collections.`,
            'EMPTY_EMBEDDING': `Embedding provider returned empty result. Check provider configuration.`,
            'RATE_LIMIT': `Embedding provider rate limit exceeded. Wait a moment and try again.`,
            'API_KEY_INVALID': `Embedding provider API key is invalid or expired. Update your API key.`,
            'QUOTA_EXCEEDED': `Embedding provider quota exceeded. Upgrade your plan or wait for reset.`
        };

        return messages[this.code] || this.message;
    }

    getRecoverySuggestions() {
        const suggestions = {
            'PROVIDER_NOT_CONFIGURED': [
                'Open Extensions > Vector Storage',
                'Select an embedding provider (Transformers, OpenAI, etc.)',
                'Configure provider settings',
                'Test connection'
            ],
            'PROVIDER_UNREACHABLE': [
                'Check that the provider service is running',
                'Verify network connectivity',
                'Check firewall settings',
                'Try a different provider'
            ],
            'DIMENSION_MISMATCH': [
                'Identify which collections have mismatched dimensions',
                'Re-vectorize affected collections with current provider',
                'Delete and recreate collections if needed'
            ],
            'RATE_LIMIT': [
                'Wait 60 seconds and retry',
                'Reduce concurrent embedding requests',
                'Consider upgrading provider plan'
            ]
        };

        return suggestions[this.code] || ['Check console for detailed error information'];
    }
}

/**
 * State management errors
 * WHY: State corruption can break everything - need clear recovery path
 */
export class StateError extends RAGError {
    constructor(message, stateType, originalError = null) {
        super(message, 'STATE_ERROR', {
            stateType,
            originalError: originalError?.message || null
        });
        this.name = 'StateError';
        this.stateType = stateType;
        this.isRecoverable = true;
    }

    getUserMessage() {
        const messages = {
            'STATE_NOT_FOUND': `Extension state not found. This is normal on first run.`,
            'STATE_CORRUPTED': `Extension state is corrupted. Settings will be reset to defaults.`,
            'STATE_MIGRATION_FAILED': `Failed to migrate old state format. Manual migration may be needed.`,
            'STATE_SAVE_FAILED': `Failed to save extension state. Check browser storage permissions.`,
            'STATE_LOAD_FAILED': `Failed to load extension state. Using defaults.`
        };

        return messages[this.code] || this.message;
    }

    getRecoverySuggestions() {
        const suggestions = {
            'STATE_CORRUPTED': [
                'Export important collections before resetting',
                'Clear browser cache and reload',
                'Manually edit extension_settings.json if needed',
                'Contact support if issue persists'
            ],
            'STATE_SAVE_FAILED': [
                'Check browser storage quota',
                'Clear old cached data',
                'Try a different browser',
                'Check browser console for detailed error'
            ],
            'STATE_LOAD_FAILED': [
                'Check that extension_settings.json is valid JSON',
                'Try clearing browser cache',
                'Restore from backup if available'
            ]
        };

        return suggestions[this.code] || [];
    }
}

/**
 * Search/query errors
 * WHY: Search failures need actionable guidance (threshold, collections, etc.)
 */
export class SearchError extends RAGError {
    constructor(message, searchType, details = {}) {
        super(message, 'SEARCH_ERROR', {
            searchType,
            ...details
        });
        this.name = 'SearchError';
        this.searchType = searchType;
        this.isRecoverable = true;
    }

    getUserMessage() {
        const messages = {
            'NO_COLLECTIONS': `No RAG collections available for search. Create and vectorize content first.`,
            'EMPTY_QUERY': `Search query is empty or too short. Use at least 3 characters.`,
            'NO_RESULTS': `No results found. Try lowering the relevance threshold or rephrasing your query.`,
            'THRESHOLD_INVALID': `Relevance threshold must be between 0 and 1.`,
            'TOP_K_INVALID': `top-K must be a positive number.`,
            'SIMILARITY_CALCULATION_FAILED': `Failed to calculate similarity scores. Check embeddings and vectors.`
        };

        return messages[this.code] || this.message;
    }

    getRecoverySuggestions() {
        const suggestions = {
            'NO_COLLECTIONS': [
                'Create a new collection',
                'Import existing content',
                'Vectorize at least one collection'
            ],
            'NO_RESULTS': [
                'Lower relevance threshold (try 0.5-0.7)',
                'Use more general search terms',
                'Check that collections are not empty',
                'Verify embeddings are generated'
            ],
            'THRESHOLD_INVALID': [
                'Set threshold between 0 and 1',
                'Recommended range: 0.5-0.75',
                'Lower = more results, higher = fewer but more relevant'
            ]
        };

        return suggestions[this.code] || [];
    }
}

/**
 * Chunk processing errors
 * WHY: Chunking failures need clear guidance on what went wrong
 */
export class ChunkError extends RAGError {
    constructor(message, operation, details = {}) {
        super(message, 'CHUNK_ERROR', {
            operation,
            ...details
        });
        this.name = 'ChunkError';
        this.operation = operation;
        this.isRecoverable = true;
    }

    getUserMessage() {
        const messages = {
            'EMPTY_TEXT': `Cannot chunk empty text. Provide content to process.`,
            'TEXT_TOO_LARGE': `Content exceeds maximum size limit. Split into smaller documents.`,
            'INVALID_STRATEGY': `Invalid chunking strategy. Use: semantic, size, paragraph, or sentence.`,
            'CHUNK_SIZE_INVALID': `Chunk size must be between 50 and 5000 characters.`,
            'CHUNKING_FAILED': `Failed to split content into chunks. Check text format and settings.`
        };

        return messages[this.code] || this.message;
    }

    getRecoverySuggestions() {
        const suggestions = {
            'TEXT_TOO_LARGE': [
                'Split document into smaller sections',
                'Increase chunk size limit in settings',
                'Remove unnecessary content'
            ],
            'INVALID_STRATEGY': [
                'Use "semantic" for intelligent splitting',
                'Use "size" for fixed-size chunks',
                'Use "paragraph" for paragraph-based splitting',
                'Use "sentence" for sentence-based splitting'
            ],
            'CHUNK_SIZE_INVALID': [
                'Set chunk size between 500-1500 characters',
                'Consider your model\'s context window',
                'Balance between context and precision'
            ]
        };

        return suggestions[this.code] || [];
    }
}

/**
 * Collection management errors
 * WHY: Collection errors need clear scope/lifecycle guidance
 */
export class CollectionError extends RAGError {
    constructor(message, collectionId, operation, details = {}) {
        super(message, 'COLLECTION_ERROR', {
            collectionId,
            operation,
            ...details
        });
        this.name = 'CollectionError';
        this.collectionId = collectionId;
        this.operation = operation;
        this.isRecoverable = true;
    }

    getUserMessage() {
        const messages = {
            'COLLECTION_NOT_FOUND': `Collection "${this.collectionId}" not found in current scope.`,
            'COLLECTION_EMPTY': `Collection "${this.collectionId}" has no chunks. Chunk content first.`,
            'COLLECTION_EXISTS': `Collection "${this.collectionId}" already exists. Use a different name.`,
            'INVALID_SCOPE': `Invalid collection scope. Use: global, character, or chat.`,
            'SCOPE_MISMATCH': `Collection exists in different scope than expected.`
        };

        return messages[this.code] || this.message;
    }

    getRecoverySuggestions() {
        const suggestions = {
            'COLLECTION_NOT_FOUND': [
                'Check collection name spelling',
                'Verify you\'re in the correct scope (global/character/chat)',
                'Create the collection if it doesn\'t exist'
            ],
            'COLLECTION_EMPTY': [
                'Add content to the collection',
                'Chunk the source document',
                'Verify content was imported correctly'
            ],
            'COLLECTION_EXISTS': [
                'Use a different collection name',
                'Delete existing collection first',
                'Update existing collection instead'
            ]
        };

        return suggestions[this.code] || [];
    }
}

/**
 * Validation errors
 * WHY: Input validation failures need specific field guidance
 */
export class ValidationError extends RAGError {
    constructor(message, field, value, expectedType) {
        super(message, 'VALIDATION_ERROR', {
            field,
            value,
            expectedType
        });
        this.name = 'ValidationError';
        this.field = field;
        this.value = value;
        this.expectedType = expectedType;
        this.isRecoverable = true;
    }

    getUserMessage() {
        return `Invalid ${this.field}: ${this.message}`;
    }

    getRecoverySuggestions() {
        return [
            `Check that ${this.field} is a valid ${this.expectedType}`,
            `Current value: ${this.value}`,
            'See documentation for valid values'
        ];
    }
}

/**
 * Parser errors
 * WHY: Parser failures need clear guidance on what went wrong during parsing
 */
export class ParserError extends RAGError {
    constructor(message, details = {}) {
        super(message, 'PARSER_ERROR', details);
        this.name = 'ParserError';
        this.isRecoverable = true;
    }
}

// ==================== ERROR UTILITIES ====================

/**
 * Wrap async function with error handling
 * WHY: Consistent error handling across all async operations
 */
export function withErrorHandling(fn, context = '') {
    return async function(...args) {
        try {
            return await fn.apply(this, args);
        } catch (error) {
            // Convert to RAG error if not already
            if (!(error instanceof RAGError)) {
                console.error(`[RAG:ERROR] Unhandled error in ${context}:`, error);
                throw new RAGError(
                    error.message || 'Unknown error occurred',
                    'UNKNOWN_ERROR',
                    { context, originalError: error.message }
                );
            }
            throw error;
        }
    };
}

/**
 * Assert condition with error
 * WHY: Clean assertion pattern for validation
 */
export function assert(condition, ErrorClass, message, ...args) {
    if (!condition) {
        throw new ErrorClass(message, ...args);
    }
}

/**
 * Retry async operation with exponential backoff
 * WHY: Transient failures (rate limits, network) should retry automatically
 */
export async function retry(fn, options = {}) {
    const {
        attempts = 3,
        delay = 1000,
        backoff = 2,
        shouldRetry = () => true
    } = options;

    let lastError = null;

    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Don't retry if not recoverable
            if (error instanceof RAGError && !error.isRecoverable) {
                throw error;
            }

            // Don't retry if custom predicate says no
            if (!shouldRetry(error, i)) {
                throw error;
            }

            // Don't sleep on last attempt
            if (i < attempts - 1) {
                const sleepTime = delay * Math.pow(backoff, i);
                console.warn(`[RAG:RETRY] Attempt ${i + 1} failed, retrying in ${sleepTime}ms...`);
                await sleep(sleepTime);
            }
        }
    }

    throw lastError;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Show user-friendly error notification
 * WHY: Users need to see errors with recovery guidance
 */
export function showErrorNotification(error) {
    if (typeof toastr === 'undefined') {
        console.error('[RAG:ERROR] toastr not available, cannot show error notification');
        return;
    }

    let message = error.message;
    let title = 'Error';

    if (error instanceof RAGError) {
        message = error.getUserMessage();
        title = error.name.replace('Error', ' Error');

        const suggestions = error.getRecoverySuggestions();
        if (suggestions.length > 0) {
            message += '\n\nSuggestions:\n' + suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
        }
    }

    toastr.error(message, title, {
        timeOut: 0, // Don't auto-dismiss errors
        extendedTimeOut: 0,
        closeButton: true,
        positionClass: 'toast-top-center'
    });
}

// ==================== LOGGING SYSTEM ====================

/**
 * Structured logger with collapsible console groups
 * WHY: Clean console output that doesn't spam - all logs in collapsible groups
 */
export class RAGLogger {
    constructor(enabled = true, verboseMode = false) {
        this.enabled = enabled;
        this.verboseMode = verboseMode;
        this.groupStack = [];
    }

    /**
     * Enable or disable verbose logging
     * WHY: Allow users to control debug detail level
     */
    setVerbose(verbose) {
        this.verboseMode = verbose;
        console.log(`[RAG:LOG] Verbose mode ${verbose ? 'enabled' : 'disabled'}`);
    }

    /**
     * Start a collapsible console group
     * WHY: Group related logs together for cleaner console
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
     * Log verbose/debug information (only shows if verbose mode enabled)
     * WHY: Allow detailed debugging without spamming normal users
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
     * WHY: Errors always show (even if logging disabled) for visibility
     */
    error(message, data = null) {
        // Errors always show - don't respect enabled flag
        console.error(message);

        if (data !== null && data !== undefined) {
            console.log(data);
        }

        // Record in diagnostics system
        Diagnostics.recordFailure('logging-error', {
            message,
            timestamp: Date.now()
        });
    }

    /**
     * Print a visual separator line
     * WHY: Visual organization in console
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
     * WHY: Show hierarchical relationships in logs
     */
    item(message, level = 1) {
        if (!this.enabled) return;
        const indent = '   '.repeat(level);
        console.log(`${indent}${message}`);
    }

    /**
     * Close all open groups (cleanup)
     * WHY: Ensure console isn't left with unclosed groups
     */
    closeAll() {
        if (!this.enabled) return;
        while (this.groupStack.length > 0) {
            console.groupEnd();
            this.groupStack.pop();
        }
    }

    /**
     * Log performance timing
     * WHY: Track operation durations for performance analysis
     */
    time(label) {
        if (!this.enabled) return;
        console.time(label);
    }

    timeEnd(label) {
        if (!this.enabled) return;
        console.timeEnd(label);
    }
}

// Singleton instance for global use
export const logger = new RAGLogger();

// Expose to window for easy debugging in console
if (typeof window !== 'undefined') {
    window.ragLogger = logger;
}

// ==================== LOGGING CONVENIENCE FUNCTIONS ====================

/**
 * Log search start
 * WHY: Standardized logging for search operations
 */
export const logSearchStart = (query, mode, features) => {
    logger.group('🔍 [RAG:SEARCH] Enhanced search pipeline');
    logger.log(`Query: "${query.substring(0, 100)}${query.length > 100 ? '...' : ''}"`);
    logger.log(`Mode: ${mode}`);
    if (features) {
        logger.log('Features:', features);
    }
};

/**
 * Log search step
 */
export const logSearchStep = (stepNum, description, data = null) => {
    logger.log(`Step ${stepNum}: ${description}`, data);
};

/**
 * Log search end
 * WHY: Show results summary with chunk details
 */
export const logSearchEnd = (chunksFound, chunks = []) => {
    logger.separator('bottom');

    if (chunksFound > 0) {
        logger.log(`✅ RAG: Found ${chunksFound} relevant chunk${chunksFound > 1 ? 's' : ''}`);

        // Show chunk details
        if (chunks && chunks.length > 0) {
            logger.log('📦 RAG: Chunks being injected:');
            chunks.forEach((chunk, i) => {
                const preview = chunk.text ? chunk.text.substring(0, 60) : 'No text';
                const section = chunk.section || chunk.name || 'Unknown';
                const score = chunk.score !== undefined
                    ? chunk.score.toFixed(3)
                    : chunk.rrfScore !== undefined
                    ? chunk.rrfScore.toFixed(3)
                    : 'N/A';
                const size = chunk.text ? chunk.text.length : 0;
                logger.log(`   ${i + 1}. [${section}] ${preview}... (score: ${score}, ${size} chars)`);
            });
        }

        // Record success in diagnostics
        Diagnostics.recordSuccess('search-results', { count: chunksFound });
    } else {
        logger.warn('⚠️  RAG: No relevant chunks found for this query');

        // Record failure in diagnostics
        Diagnostics.recordFailure('search-results', {
            reason: 'No chunks found',
            timestamp: Date.now()
        });
    }

    logger.log('✅ RAG: Search complete');
    logger.groupEnd();
};

/**
 * Log injection
 * WHY: Show what chunks are being injected into prompt
 */
export const logInjection = (chunks, characterName) => {
    logger.group('💉 [RAG:INJECTION] Inserting chunks into prompt');
    logger.log(`Character: ${characterName}`);
    logger.log(`Chunks: ${chunks.length}`);

    if (chunks.length > 0) {
        logger.log('📦 Chunks being injected:');
        chunks.forEach((chunk, i) => {
            const preview = chunk.text ? chunk.text.substring(0, 60) : '';
            const section = chunk.section || chunk.name || 'Untitled';
            logger.item(`${i + 1}. [${section}] ${preview}... (${chunk.text?.length || 0} chars)`);
        });
    }

    logger.log('✅ Injection complete');
    logger.groupEnd();
};

/**
 * Log keyword extraction
 */
export const logKeywordExtraction = (functionName, input, output) => {
    logger.group(`🔍 [${functionName}] Keyword extraction`);
    logger.log('Input:', input);
    logger.log('Output:', output);
    logger.groupEnd();
};

/**
 * Log chunk metadata
 */
export const logChunkMetadata = (sectionTitle, keywords, features) => {
    logger.group(`🔍 [buildChunkMetadata] Processing: ${sectionTitle}`);
    logger.log(`Total keywords: ${keywords?.length || 0}`);
    if (features) {
        logger.log('Features:', features);
    }
    logger.log('Final keywords:', keywords?.slice(0, 10));
    logger.groupEnd();
};

/**
 * Log embedding generation
 * WHY: Track embedding API calls for debugging
 */
export const logEmbeddingGeneration = (textLength, embeddingDim, duration) => {
    logger.verbose(`[RAG:EMBED] Generated ${embeddingDim}D embedding for ${textLength} chars in ${duration}ms`);
};

/**
 * Log vectorization progress
 */
export const logVectorizationProgress = (current, total, collectionName) => {
    logger.log(`[RAG:VECTORIZE] ${collectionName}: ${current}/${total} chunks`);
};

/**
 * Log chunking operation
 */
export const logChunking = (sourceName, chunkCount, strategy) => {
    logger.group(`✂️ [RAG:CHUNK] ${sourceName}`);
    logger.log(`Strategy: ${strategy}`);
    logger.log(`Chunks created: ${chunkCount}`);
    logger.groupEnd();
};

/**
 * Log collection creation
 */
export const logCollectionCreated = (collectionId, scope, chunkCount) => {
    logger.log(`📚 [RAG:COLLECTION] Created "${collectionId}" in ${scope} scope with ${chunkCount} chunks`);
};

/**
 * Log state persistence
 */
export const logStateSaved = (scope, collections) => {
    logger.verbose(`💾 [RAG:STATE] Saved ${collections} collection(s) to ${scope} scope`);
};

/**
 * Log state loaded
 */
export const logStateLoaded = (scope, collections) => {
    logger.verbose(`📂 [RAG:STATE] Loaded ${collections} collection(s) from ${scope} scope`);
};

// ==================== DIAGNOSTIC CHECKS ====================

// Diagnostic system self-check
Diagnostics.registerCheck('diagnostic-system-health', {
    name: 'Diagnostic System Health',
    description: 'Validates that the diagnostic system is functional',
    category: 'CORE',
    checkFn: async () => {
        // Check that checks are registered
        if (Diagnostics.checks.size === 0) {
            return {
                status: 'warn',
                message: 'No diagnostic checks registered yet',
                userMessage: 'The diagnostic system is running, but no checks have been registered yet. This is normal during early initialization.'
            };
        }

        // Check that check registry is working
        const testCheckId = '__test_check__';
        try {
            Diagnostics.registerCheck(testCheckId, {
                name: 'Test Check',
                checkFn: async () => ({ status: 'pass', message: 'Test' })
            });

            const hasTestCheck = Diagnostics.checks.has(testCheckId);
            Diagnostics.checks.delete(testCheckId); // Clean up

            if (!hasTestCheck) {
                return {
                    status: 'error',
                    message: 'Check registration failed',
                    userMessage: 'The diagnostic system is not registering checks correctly. This is a bug.'
                };
            }
        } catch (error) {
            return {
                status: 'error',
                message: `Registration test failed: ${error.message}`,
                userMessage: 'The diagnostic system encountered an error during self-test.'
            };
        }

        return {
            status: 'pass',
            message: `Diagnostic system operational (${Diagnostics.checks.size} checks registered)`,
            userMessage: `Diagnostic system is working correctly. ${Diagnostics.checks.size} checks are registered.`
        };
    }
});

// Logging system health check
Diagnostics.registerCheck('logging-system-health', {
    name: 'Logging System Health',
    description: 'Validates that the logging system is functional',
    category: 'CORE',
    checkFn: async () => {
        // Check that logger is initialized
        if (!logger) {
            return {
                status: 'critical',
                message: 'Logger not initialized',
                userMessage: 'The logging system failed to initialize. This is a critical bug.'
            };
        }

        // Check for unclosed groups
        if (logger.groupStack.length > 0) {
            return {
                status: 'warn',
                message: `${logger.groupStack.length} unclosed console groups`,
                userMessage: `There are ${logger.groupStack.length} unclosed console groups. This may clutter console output.`,
                fixes: [
                    {
                        label: 'Close All Groups',
                        description: 'Close all unclosed console groups',
                        action: () => {
                            logger.closeAll();
                        }
                    }
                ]
            };
        }

        return {
            status: 'pass',
            message: 'Logging system operational',
            userMessage: `Logging is ${logger.enabled ? 'enabled' : 'disabled'}. Verbose mode is ${logger.verboseMode ? 'on' : 'off'}.`
        };
    }
});

// Logged errors check
Diagnostics.registerCheck('logging-errors-recorded', {
    name: 'Logged Errors',
    description: 'Checks for errors recorded by the logging system',
    category: 'CORE',
    checkFn: async () => {
        const errors = Diagnostics.getRuntimeIssues('logging-error');

        if (errors.length > 0) {
            return {
                status: 'warn',
                message: `${errors.length} errors logged`,
                userMessage: `${errors.length} error(s) have been logged. Check console for details.`,
                data: errors.slice(-5) // Show last 5 errors
            };
        }

        return {
            status: 'pass',
            message: 'No errors logged',
            userMessage: 'No errors have been logged since last diagnostic run.'
        };
    }
});

// Search results health check
Diagnostics.registerCheck('search-results-health', {
    name: 'Search Results Health',
    description: 'Tracks search success/failure rate',
    category: 'SEARCH',
    checkFn: async () => {
        const failures = Diagnostics.getRuntimeIssues('search-results');

        if (failures.length > 5) {
            return {
                status: 'warn',
                message: `${failures.length} searches with no results`,
                userMessage: `${failures.length} recent searches returned no results. This may indicate threshold is too high or collections are empty.`,
                fixes: [
                    {
                        label: 'View Details',
                        description: 'Show search failure details',
                        action: () => {
                            console.log('[RAG:DIAGNOSTICS] Search failures:', failures);
                            alert('Check console for details');
                        }
                    }
                ]
            };
        }

        return {
            status: 'pass',
            message: 'Search results healthy',
            userMessage: 'Searches are returning results successfully.'
        };
    }
});

// Unhandled errors check
Diagnostics.registerCheck('errors-no-unhandled', {
    name: 'No Unhandled Errors',
    description: 'Checks for unhandled errors in the system',
    category: 'CORE',
    checkFn: async () => {
        const errors = Diagnostics.getRuntimeIssues('error-occurred');

        if (errors.length > 0) {
            // Check for critical error codes
            const criticalErrors = errors.filter(e =>
                e.data.code === 'EMBEDDING_ERROR' ||
                e.data.code === 'STATE_CORRUPTED' ||
                e.data.code === 'UNKNOWN_ERROR'
            );

            if (criticalErrors.length > 0) {
                return {
                    status: 'error',
                    message: `${criticalErrors.length} critical errors occurred`,
                    userMessage: `${criticalErrors.length} critical error(s) detected. Check console for details and follow recovery suggestions.`,
                    data: criticalErrors.slice(-3)
                };
            }

            return {
                status: 'warn',
                message: `${errors.length} errors occurred`,
                userMessage: `${errors.length} error(s) have occurred. Most were recoverable. Check console if issues persist.`,
                data: errors.slice(-3)
            };
        }

        return {
            status: 'pass',
            message: 'No errors recorded',
            userMessage: 'No errors have been recorded since last diagnostic run.'
        };
    }
});

// Error recovery rate check
Diagnostics.registerCheck('error-recovery-rate', {
    name: 'Error Recovery Rate',
    description: 'Tracks how many errors were successfully recovered from',
    category: 'CORE',
    checkFn: async () => {
        const errors = Diagnostics.getRuntimeIssues('error-occurred');

        if (errors.length === 0) {
            return {
                status: 'pass',
                message: 'No errors to analyze',
                userMessage: 'No errors have occurred.'
            };
        }

        const recoverableErrors = errors.filter(e => {
            const errorCode = e.data.code;
            return errorCode !== 'UNKNOWN_ERROR' && errorCode !== 'STATE_CORRUPTED';
        });

        const recoveryRate = (recoverableErrors.length / errors.length) * 100;

        if (recoveryRate < 50) {
            return {
                status: 'warn',
                message: `Low recovery rate: ${recoveryRate.toFixed(0)}%`,
                userMessage: `Only ${recoveryRate.toFixed(0)}% of errors were recoverable. Many errors are critical failures.`
            };
        }

        return {
            status: 'pass',
            message: `Recovery rate: ${recoveryRate.toFixed(0)}%`,
            userMessage: `${recoveryRate.toFixed(0)}% of errors are recoverable with user action.`
        };
    }
});

// ==================== EXPORTS ====================

export default {
    // Diagnostics
    Diagnostics,
    // Errors
    RAGError,
    EmbeddingError,
    StateError,
    SearchError,
    ChunkError,
    CollectionError,
    ValidationError,
    ParserError,
    // Error utilities
    withErrorHandling,
    assert,
    retry,
    showErrorNotification,
    // Logging
    RAGLogger,
    logger,
    // Logging convenience functions
    logSearchStart,
    logSearchStep,
    logSearchEnd,
    logInjection,
    logKeywordExtraction,
    logChunkMetadata,
    logEmbeddingGeneration,
    logVectorizationProgress,
    logChunking,
    logCollectionCreated,
    logStateSaved,
    logStateLoaded
};

/**
 * CONSOLE LOGGING CONTROL
 *
 * Rabbit Augmented Generation uses grouped, collapsible console logging.
 * All logs are contained in groups that can be collapsed in the browser console.
 *
 * To control logging verbosity:
 *
 * 1. Disable all logging:
 *    window.ragLogger.enabled = false
 *
 * 2. Enable verbose/debug logging:
 *    window.ragLogger.setVerbose(true)
 *
 * 3. Re-enable logging:
 *    window.ragLogger.enabled = true
 *
 * You can run these commands directly in the browser console.
 */
