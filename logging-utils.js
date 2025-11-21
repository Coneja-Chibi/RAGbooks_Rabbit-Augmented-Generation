/**
 * RAGBooks Logging Utilities
 * Provides clean, collapsible console logging similar to CarrotKernel
 */

// Imports for diagnostic system
import { getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { validateConditions } from './conditional-activation.js';

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

// ============================================================================
// DIAGNOSTIC SYSTEM
// ============================================================================

/**
 * Diagnostic issue severity levels
 */
export const SEVERITY = {
    CRITICAL: 'critical',  // Prevents any functionality
    ERROR: 'error',        // Breaks core features
    WARNING: 'warning',    // Degrades functionality
    INFO: 'info'          // Performance or optimization issues
};

/**
 * Diagnostic result structure
 */
class DiagnosticResult {
    constructor(passed, severity, issue, description, autoFix = null, manualFix = null) {
        this.passed = passed;
        this.severity = severity;
        this.issue = issue;
        this.description = description;
        this.autoFix = autoFix;  // Function to auto-fix if available
        this.manualFix = manualFix;  // Instructions for manual fix
    }
}

/**
 * Show diagnostic toaster with optional Fix Now button
 */
function showDiagnosticToaster(result, onFix = null) {
    if (typeof toastr === 'undefined') {
        console.error('toastr not available');
        return;
    }

    const icon = {
        critical: '🔴',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    }[result.severity];

    const message = `${icon} ${result.issue}\n${result.description}`;

    const options = {
        timeOut: result.severity === 'critical' || result.severity === 'error' ? 0 : 8000,
        extendedTimeOut: 0,
        closeButton: true,
        positionClass: 'toast-top-center',
        preventDuplicates: true
    };

    // Add Fix Now button if auto-fix available
    if (result.autoFix && onFix) {
        options.onclick = () => {
            onFix(result);
        };
        options.tapToDismiss = false;
    }

    switch (result.severity) {
        case SEVERITY.CRITICAL:
        case SEVERITY.ERROR:
            toastr.error(message, result.autoFix ? 'Click to fix' : 'RAGBooks Issue', options);
            break;
        case SEVERITY.WARNING:
            toastr.warning(message, result.autoFix ? 'Click to fix' : 'RAGBooks Warning', options);
            break;
        case SEVERITY.INFO:
            toastr.info(message, 'RAGBooks Info', options);
            break;
    }
}

/**
 * ============================================================================
 * VECTOR DATABASE DIAGNOSTICS (8 checks)
 * ============================================================================
 */

/**
 * Check if vector source is properly configured
 */
export async function checkVectorSource(settings) {
    if (!settings?.vectors?.source) {
        return new DiagnosticResult(
            false,
            SEVERITY.CRITICAL,
            'No vector source selected',
            'RAGBooks requires a vector provider (ChromaDB, Transformers, etc.). Go to Extensions > Vector Storage and select a source.',
            null,
            'Go to Extensions > Vector Storage > Select a vector source (ChromaDB, Transformers, WebLLM, etc.)'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Vector source configured', `Using ${settings.vectors.source}`);
}

/**
 * Check if vector database is accessible
 */
export async function checkVectorConnection(collectionId, source) {
    try {
        const response = await fetch('/api/vector/list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getRequestHeaders()
            },
            body: JSON.stringify({ collectionId, source })
        });

        if (!response.ok) {
            if (response.status === 404) {
                return new DiagnosticResult(
                    false,
                    SEVERITY.ERROR,
                    'Vector API not available',
                    'The vector storage API endpoint is not responding. Make sure your vector provider is running.',
                    null,
                    'Restart your vector provider (ChromaDB, Transformers, etc.) and ensure it\'s accessible'
                );
            }

            return new DiagnosticResult(
                false,
                SEVERITY.ERROR,
                'Vector database connection failed',
                `HTTP ${response.status}: Cannot connect to vector database`,
                null,
                'Check vector provider logs and ensure service is running'
            );
        }

        return new DiagnosticResult(true, SEVERITY.INFO, 'Vector database connected', 'Successfully connected to vector API');
    } catch (error) {
        return new DiagnosticResult(
            false,
            SEVERITY.CRITICAL,
            'Vector database unreachable',
            `Cannot reach vector API: ${error.message}`,
            null,
            'Ensure your vector provider (ChromaDB, Transformers, etc.) is running and accessible'
        );
    }
}

/**
 * Check if collection exists in vector database
 */
export async function checkCollectionExists(collectionId, source) {
    try {
        const response = await fetch('/api/vector/list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getRequestHeaders()
            },
            body: JSON.stringify({ collectionId, source })
        });

        if (!response.ok) {
            return new DiagnosticResult(false, SEVERITY.ERROR, 'Cannot verify collection', 'Vector API error');
        }

        const data = await response.json();
        // Handle both API response formats: {hashes: [...]} or direct [...]
        const hashes = Array.isArray(data) ? data : (data.hashes || []);

        if (hashes.length === 0) {
            return new DiagnosticResult(
                false,
                SEVERITY.WARNING,
                'Collection is empty in vector database',
                `Collection "${collectionId}" exists but has no vectors. You need to re-vectorize this content.`,
                null,
                'Open the collection in RAGBooks settings and click the "Re-vectorize" button.'
            );
        }

        return new DiagnosticResult(
            true,
            SEVERITY.INFO,
            'Collection has vectors',
            `Found ${hashes.length} vectors in database`
        );
    } catch (error) {
        return new DiagnosticResult(
            false,
            SEVERITY.ERROR,
            'Failed to check collection',
            error.message
        );
    }
}

/**
 * Check for hash mismatches between library and vector DB
 */
export async function checkHashMismatch(collectionId, library, source) {
    try {
        const response = await fetch('/api/vector/list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getRequestHeaders()
            },
            body: JSON.stringify({ collectionId, source })
        });

        if (!response.ok) {
            return new DiagnosticResult(false, SEVERITY.ERROR, 'Cannot check hashes', 'Vector API error');
        }

        const data = await response.json();
        // Handle both API response formats: {hashes: [...]} or direct [...]
        const hashes = Array.isArray(data) ? data : (data.hashes || []);
        const dbHashes = new Set(hashes.map(h => parseInt(h)));
        const libraryHashes = Object.keys(library).map(h => parseInt(h));

        const missingInDb = libraryHashes.filter(h => !dbHashes.has(h));
        const orphanedInDb = Array.from(dbHashes).filter(h => !libraryHashes.includes(h));

        if (missingInDb.length > 0) {
            return new DiagnosticResult(
                false,
                SEVERITY.WARNING,
                'Library chunks not in vector database',
                `${missingInDb.length} chunks exist in library but not in vector DB. This means they were never vectorized or DB was cleared.`,
                null,
                'Re-vectorize this collection to sync library with vector database'
            );
        }

        if (orphanedInDb.length > 0) {
            return new DiagnosticResult(
                false,
                SEVERITY.INFO,
                'Orphaned vectors in database',
                `${orphanedInDb.length} vectors in DB have no corresponding library chunks. This can happen after chunk edits.`,
                null,
                'Consider purging and re-vectorizing to clean up orphaned vectors'
            );
        }

        return new DiagnosticResult(
            true,
            SEVERITY.INFO,
            'Library and vector DB in sync',
            `All ${libraryHashes.length} chunks properly vectorized`
        );
    } catch (error) {
        return new DiagnosticResult(false, SEVERITY.ERROR, 'Hash check failed', error.message);
    }
}

/**
 * Check if summary chunks are vectorized
 */
export async function checkSummaryVectorization(collectionId, library, source) {
    const summaryChunks = Object.values(library).filter(c => c.isSummaryChunk);

    if (summaryChunks.length === 0) {
        return new DiagnosticResult(
            true,
            SEVERITY.INFO,
            'No summary chunks',
            'Collection has no summary chunks (dual-vector search not enabled)'
        );
    }

    try {
        const response = await fetch('/api/vector/list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getRequestHeaders()
            },
            body: JSON.stringify({ collectionId, source })
        });

        if (!response.ok) {
            return new DiagnosticResult(false, SEVERITY.ERROR, 'Cannot check summaries', 'Vector API error');
        }

        const data = await response.json();
        // Handle both API response formats: {hashes: [...]} or direct [...]
        const hashes = Array.isArray(data) ? data : (data.hashes || []);
        const dbHashes = new Set(hashes.map(h => parseInt(h)));
        const summaryHashes = summaryChunks.map(c => c.hash);
        const missingSummaries = summaryHashes.filter(h => !dbHashes.has(h));

        if (missingSummaries.length > 0) {
            return new DiagnosticResult(
                false,
                SEVERITY.ERROR,
                'Summary chunks not vectorized',
                `${missingSummaries.length} of ${summaryChunks.length} summary chunks are missing from vector DB. This breaks dual-vector search.`,
                null,
                'Re-vectorize this collection to fix summary vectorization (this was a bug that has been fixed)'
            );
        }

        return new DiagnosticResult(
            true,
            SEVERITY.INFO,
            'Summary chunks vectorized',
            `All ${summaryChunks.length} summary chunks in vector DB`
        );
    } catch (error) {
        return new DiagnosticResult(false, SEVERITY.ERROR, 'Summary check failed', error.message);
    }
}

/**
 * Check for vector dimension mismatches
 */
export async function checkVectorDimensions(collectionId, source, expectedDim = null) {
    // This would require querying actual vectors from DB to check dimensions
    // Most vector DBs enforce dimension consistency, so this is low priority
    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Vector dimensions',
        'Dimension validation requires DB query (skipped for performance)'
    );
}

/**
 * Check for stale vector collections
 */
export async function checkStaleCollections(libraries, source) {
    // Check for collections in vector DB that no longer exist in libraries
    // This requires enumerating all collections which is expensive
    // Mark as info-level check
    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Stale collections',
        'Stale collection detection requires full DB scan (skipped for performance)'
    );
}

/**
 * Check vector database performance/health
 */
export async function checkVectorPerformance() {
    // Could measure query latency, but requires actual query
    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Vector database performance',
        'Performance check requires benchmark query (skipped)'
    );
}

/**
 * ============================================================================
 * LIBRARY/STORAGE DIAGNOSTICS (8 checks)
 * ============================================================================
 */

/**
 * Check if library exists for current scope
 */
export function checkLibraryExists(ragState, scope, scopeId, collectionId) {
    let library = null;

    switch (scope) {
        case 'global':
            library = ragState.libraries?.global?.[collectionId];
            break;
        case 'character':
            library = ragState.libraries?.character?.[scopeId]?.[collectionId];
            break;
        case 'chat':
            library = ragState.libraries?.chat?.[scopeId]?.[collectionId];
            break;
    }

    if (!library || Object.keys(library).length === 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.ERROR,
            'Library not found or empty',
            `No chunks found in library for ${scope} scope. Content may not have been chunked yet.`,
            null,
            'Open the content in RAGBooks and click "Chunk Document" to create chunks'
        );
    }

    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Library exists',
        `Found ${Object.keys(library).length} chunks in library`
    );
}

/**
 * Check for corrupted library data
 */
export function checkLibraryIntegrity(library) {
    const chunks = Object.values(library);
    const issues = [];

    for (const chunk of chunks) {
        // Check required fields
        if (!chunk.hash) issues.push('Chunk missing hash');
        if (!chunk.text) issues.push('Chunk missing text');
        if (chunk.text && typeof chunk.text !== 'string') issues.push('Chunk text is not a string');

        // Check summary chunk integrity
        if (chunk.isSummaryChunk) {
            if (!chunk.parentHash) issues.push('Summary chunk missing parentHash');
            if (!chunk.chunkLinks || chunk.chunkLinks.length === 0) {
                issues.push('Summary chunk missing force link to parent');
            }
        }

        // Check for negative or invalid scores
        if (chunk.score !== undefined && (chunk.score < 0 || chunk.score > 1)) {
            issues.push(`Invalid score: ${chunk.score}`);
        }
    }

    if (issues.length > 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Library integrity issues',
            `Found ${issues.length} problems: ${issues.slice(0, 3).join(', ')}${issues.length > 3 ? '...' : ''}`,
            null,
            'Re-chunk and re-vectorize this collection to rebuild library'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Library data valid', 'All chunks have required fields');
}

/**
 * Check for orphaned parent references
 */
export function checkOrphanedParents(library) {
    const chunks = Object.values(library);
    const hashSet = new Set(chunks.map(c => c.hash));
    const orphaned = [];

    for (const chunk of chunks) {
        if (chunk.isSummaryChunk && chunk.parentHash && !hashSet.has(chunk.parentHash)) {
            orphaned.push(chunk.hash);
        }

        if (chunk.chunkLinks) {
            for (const link of chunk.chunkLinks) {
                if (!hashSet.has(link.targetHash)) {
                    orphaned.push(`${chunk.hash} → ${link.targetHash}`);
                }
            }
        }
    }

    if (orphaned.length > 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Orphaned chunk references',
            `${orphaned.length} chunks reference non-existent chunks. This can break chunk linking.`,
            null,
            'Re-chunk this collection to rebuild proper references'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'No orphaned references', 'All chunk links are valid');
}

/**
 * Check for duplicate chunks
 */
export function checkDuplicateChunks(library) {
    const chunks = Object.values(library);
    const textMap = new Map();
    const duplicates = [];

    for (const chunk of chunks) {
        const text = chunk.text?.trim();
        if (!text) continue;

        if (textMap.has(text)) {
            duplicates.push({ hash1: textMap.get(text), hash2: chunk.hash, text: text.substring(0, 50) });
        } else {
            textMap.set(text, chunk.hash);
        }
    }

    if (duplicates.length > 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Duplicate chunks detected',
            `Found ${duplicates.length} chunks with identical text. This wastes vector storage and can skew search results.`,
            null,
            'Review your chunking strategy or manually remove duplicates in chunk visualizer'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'No duplicate chunks', 'All chunks have unique text');
}

/**
 * Check library storage size
 */
export function checkLibrarySize(ragState) {
    try {
        const serialized = JSON.stringify(ragState.libraries || {});
        const sizeKB = new Blob([serialized]).size / 1024;
        const sizeMB = sizeKB / 1024;

        if (sizeMB > 5) {
            return new DiagnosticResult(
                false,
                SEVERITY.WARNING,
                'Large library storage',
                `RAGBooks library is ${sizeMB.toFixed(2)} MB. Large libraries can slow down loading and saving.`,
                null,
                'Consider removing unused collections or reducing chunk count per collection'
            );
        }

        return new DiagnosticResult(
            true,
            SEVERITY.INFO,
            'Library size OK',
            `${sizeKB.toFixed(2)} KB in storage`
        );
    } catch (error) {
        return new DiagnosticResult(false, SEVERITY.ERROR, 'Cannot check library size', error.message);
    }
}

/**
 * Check for missing metadata
 */
export function checkMetadata(library) {
    const chunks = Object.values(library);
    const missingMetadata = chunks.filter(c => !c.metadata || Object.keys(c.metadata || {}).length === 0);

    if (missingMetadata.length > chunks.length * 0.5) {
        return new DiagnosticResult(
            false,
            SEVERITY.INFO,
            'Many chunks missing metadata',
            `${missingMetadata.length} of ${chunks.length} chunks have no metadata. Metadata improves search quality.`,
            null,
            'Regenerate keywords to add metadata to chunks'
        );
    }

    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Metadata present',
        `${chunks.length - missingMetadata.length} chunks have metadata`
    );
}

/**
 * Check for scope mismatch
 */
export function checkScopeMismatch(collectionId, expectedScope, ragState) {
    const scopes = ['global', 'character', 'chat'];
    const foundScopes = [];

    for (const scope of scopes) {
        if (scope === 'global' && ragState.libraries?.global?.[collectionId]) {
            foundScopes.push('global');
        } else if (scope === 'character') {
            for (const charId in ragState.libraries?.character || {}) {
                if (ragState.libraries.character[charId][collectionId]) {
                    foundScopes.push(`character:${charId}`);
                }
            }
        } else if (scope === 'chat') {
            for (const chatId in ragState.libraries?.chat || {}) {
                if (ragState.libraries.chat[chatId][collectionId]) {
                    foundScopes.push(`chat:${chatId}`);
                }
            }
        }
    }

    if (foundScopes.length > 1) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Collection exists in multiple scopes',
            `Collection "${collectionId}" found in: ${foundScopes.join(', ')}. This can cause confusion.`,
            null,
            'Remove collection from unwanted scopes using RAGBooks UI'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Scope OK', `Collection in ${foundScopes[0] || 'no scope'}`);
}

/**
 * Check for library sync with storage
 */
export function checkLibrarySync() {
    // This would require comparing extension_settings with actual storage
    // Low priority check
    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Library sync',
        'Sync validation requires storage comparison (skipped)'
    );
}

/**
 * ============================================================================
 * SEARCH/QUERY DIAGNOSTICS (8 checks)
 * ============================================================================
 */

/**
 * Check if query is too short
 */
export function checkQueryLength(query, minLength = 3) {
    if (!query || query.trim().length < minLength) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Query too short',
            `Query "${query}" is too short for meaningful vector search. Minimum ${minLength} characters recommended.`,
            null,
            'Use longer, more descriptive queries for better search results'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Query length OK', `${query.length} characters`);
}

/**
 * Check threshold settings
 */
export function checkThresholdSettings(threshold, provider) {
    if (threshold === undefined || threshold === null) {
        return new DiagnosticResult(
            false,
            SEVERITY.ERROR,
            'Threshold not set',
            'Relevance threshold is not configured. This can cause unpredictable search behavior.',
            null,
            'Set threshold in RAGBooks settings (recommended: 0.50-0.75)'
        );
    }

    if (threshold < 0 || threshold > 1) {
        return new DiagnosticResult(
            false,
            SEVERITY.ERROR,
            'Invalid threshold value',
            `Threshold ${threshold} is outside valid range [0, 1]`,
            async (settings) => {
                settings.ragbooks.rag.threshold = 0.60;
                return 'Reset threshold to 0.60';
            },
            'Set threshold between 0 and 1 in RAGBooks settings'
        );
    }

    if (threshold < 0.20) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Threshold very low',
            `Threshold ${threshold} will match almost everything, including irrelevant chunks`,
            async (settings) => {
                settings.ragbooks.rag.threshold = 0.60;
                return 'Increased threshold to 0.60';
            },
            'Consider raising threshold to 0.50-0.75 for better relevance'
        );
    }

    if (threshold > 0.90) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Threshold very high',
            `Threshold ${threshold} may be too restrictive and miss relevant chunks`,
            null,
            'Consider lowering threshold to 0.60-0.80 for more results'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Threshold OK', `Set to ${threshold}`);
}

/**
 * Check top-K settings
 */
export function checkTopKSettings(topK) {
    if (!topK || topK <= 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.ERROR,
            'Invalid top-K value',
            `top-K is ${topK}, which will return no results`,
            async (settings) => {
                settings.ragbooks.rag.topK = 5;
                return 'Reset top-K to 5';
            },
            'Set top-K to a positive number (recommended: 3-10)'
        );
    }

    if (topK > 50) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Top-K very large',
            `top-K of ${topK} may inject too many chunks and waste context`,
            null,
            'Consider reducing top-K to 5-15 for better focus'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Top-K OK', `Set to ${topK}`);
}

/**
 * Check for active collections across all relevant scopes
 * WHY: Users need to know what collections are available for the current context
 * This checks global (always available) + character/chat scopes based on context
 */
export function checkActiveCollections(ragState, scope, scopeId) {
    // Collect all available collections for current context
    const availableCollections = {
        global: [],
        character: [],
        chat: []
    };

    // Global collections are always available
    availableCollections.global = Object.keys(ragState.libraries?.global || {});

    // Character-scoped collections (if character context exists)
    if (scope === 'character' && scopeId) {
        availableCollections.character = Object.keys(ragState.libraries?.character?.[scopeId] || {});
    } else if (scope === 'chat' && scopeId) {
        // For chat scope, also check if there's a character context
        // Chat scope inherits from character scope
        availableCollections.chat = Object.keys(ragState.libraries?.chat?.[scopeId] || {});
    }

    // Calculate totals
    const totalCollections =
        availableCollections.global.length +
        availableCollections.character.length +
        availableCollections.chat.length;

    if (totalCollections === 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'No active collections',
            `No RAG collections found in any scope. Nothing to search.`,
            null,
            'Create and vectorize content in RAGBooks to enable search'
        );
    }

    // Build description showing what's available
    const scopeDetails = [];
    if (availableCollections.global.length > 0) {
        scopeDetails.push(`${availableCollections.global.length} global`);
    }
    if (availableCollections.character.length > 0) {
        scopeDetails.push(`${availableCollections.character.length} character`);
    }
    if (availableCollections.chat.length > 0) {
        scopeDetails.push(`${availableCollections.chat.length} chat`);
    }

    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Active collections',
        `${totalCollections} collection(s) available: ${scopeDetails.join(', ')}`
    );
}

/**
 * Check search mode configuration
 */
export function checkSearchMode(searchMode) {
    const validModes = ['combined', 'vector', 'keyword', 'hybrid'];

    if (!searchMode || !validModes.includes(searchMode)) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Invalid search mode',
            `Search mode "${searchMode}" is not recognized. Using default.`,
            async (settings) => {
                settings.ragbooks.rag.searchMode = 'combined';
                return 'Reset search mode to "combined"';
            },
            'Set search mode in RAGBooks settings (combined, vector, keyword, or hybrid)'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Search mode OK', `Using "${searchMode}"`);
}

/**
 * Check for embedding provider availability
 */
export async function checkEmbeddingProvider(source) {
    // This would require actually calling the embedding API
    // Defer to connection check
    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Embedding provider',
        'Provider check deferred to connection test'
    );
}

/**
 * Check reranking configuration
 */
export function checkReranking(settings) {
    const rerank = settings?.ragbooks?.rag?.rerank;

    if (rerank?.enabled && !rerank?.model) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Reranking enabled but no model set',
            'Reranking is enabled but no reranking model is configured',
            async (settings) => {
                settings.ragbooks.rag.rerank.enabled = false;
                return 'Disabled reranking';
            },
            'Either disable reranking or configure a reranking model'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Reranking OK', rerank?.enabled ? 'Enabled' : 'Disabled');
}

/**
 * Check for empty search results pattern
 */
export function checkEmptyResults(results, threshold) {
    // This is called after search
    if (!results || results.length === 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'No search results',
            `No chunks matched your query with threshold ${threshold}. Try lowering threshold or rephrasing query.`,
            null,
            'Lower your relevance threshold in RAGBooks settings or use a more general query'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Search results found', `${results.length} matches`);
}

/**
 * ============================================================================
 * CONFIGURATION DIAGNOSTICS (6 checks)
 * ============================================================================
 */

/**
 * Check if RAGBooks is enabled
 */
export function checkRAGBooksEnabled(settings) {
    if (!settings?.ragbooks?.enabled) {
        return new DiagnosticResult(
            false,
            SEVERITY.ERROR,
            'RAGBooks is disabled',
            'RAGBooks extension is not enabled. No RAG functionality will work.',
            async (settings) => {
                settings.ragbooks.enabled = true;
                return 'Enabled RAGBooks';
            },
            'Enable RAGBooks in extension settings'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'RAGBooks enabled', 'Extension is active');
}

/**
 * Check injection settings
 */
export function checkInjectionSettings(settings) {
    const injection = settings?.ragbooks?.rag?.injection;

    if (!injection) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Injection settings missing',
            'RAG injection configuration is not set',
            async (settings) => {
                if (!settings.ragbooks) settings.ragbooks = {};
                if (!settings.ragbooks.rag) settings.ragbooks.rag = {};
                settings.ragbooks.rag.injection = {
                    position: 'after_scenario',
                    depth: 4
                };
                return 'Configured injection settings with defaults';
            },
            'Configure injection settings in RAGBooks'
        );
    }

    if (!injection.position) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Injection position not set',
            'No injection position configured. Chunks may not be inserted into prompts properly.',
            async (settings) => {
                settings.ragbooks.rag.injection.position = 'after_scenario';
                if (!settings.ragbooks.rag.injection.depth) {
                    settings.ragbooks.rag.injection.depth = 4;
                }
                return 'Set injection position to "after_scenario"';
            },
            'Set injection position in RAGBooks settings (recommended: "after_scenario")'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Injection configured', `Position: ${injection.position}`);
}

/**
 * Check chunking strategy
 */
export function checkChunkingStrategy(settings) {
    const strategy = settings?.ragbooks?.rag?.chunkingStrategy;
    const validStrategies = ['semantic', 'size', 'paragraph', 'sentence'];

    if (!strategy || !validStrategies.includes(strategy)) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Invalid chunking strategy',
            `Chunking strategy "${strategy}" is not recognized`,
            async (settings) => {
                settings.ragbooks.rag.chunkingStrategy = 'semantic';
                return 'Reset chunking strategy to "semantic"';
            },
            'Set chunking strategy in RAGBooks settings'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Chunking strategy OK', `Using "${strategy}"`);
}

/**
 * Check chunk size settings
 */
export function checkChunkSize(settings) {
    const ragState = settings?.ragbooks?.rag;
    const chunkSize = ragState?.chunkSize;

    if (!chunkSize || chunkSize === undefined) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Chunk size not configured',
            'Default chunk size setting is missing',
            async (settings) => {
                if (!settings.ragbooks) settings.ragbooks = {};
                if (!settings.ragbooks.rag) settings.ragbooks.rag = {};
                settings.ragbooks.rag.chunkSize = 1000;
                return 'Set chunk size to 1000 chars';
            },
            'Configure chunk size in RAGBooks settings (recommended: 500-1500 chars)'
        );
    }

    if (chunkSize < 50) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Chunk size very small',
            `Chunk size of ${chunkSize} chars may create fragments that lack context`,
            async (settings) => {
                settings.ragbooks.rag.chunkSize = 500;
                return 'Increased chunk size to 500 chars';
            },
            'Consider increasing chunk size to 500-1500 chars'
        );
    }

    if (chunkSize > 5000) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Chunk size very large',
            `Chunk size of ${chunkSize} chars may create oversized chunks that waste context`,
            async (settings) => {
                settings.ragbooks.rag.chunkSize = 1500;
                return 'Reduced chunk size to 1500 chars';
            },
            'Consider reducing chunk size to 500-1500 chars'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Chunk size OK', `${chunkSize} chars`);
}

/**
 * Check keyword extraction settings
 */
export function checkKeywordSettings(settings) {
    const keywords = settings?.ragbooks?.rag?.keywords;

    if (!keywords) {
        return new DiagnosticResult(
            true,
            SEVERITY.INFO,
            'Keywords disabled',
            'Keyword extraction not configured (optional feature)'
        );
    }

    if (keywords.enabled && !keywords.model) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Keyword extraction enabled without model',
            'Keyword extraction is on but no model is set',
            async (settings) => {
                settings.ragbooks.rag.keywords.enabled = false;
                return 'Disabled keyword extraction';
            },
            'Either disable keywords or configure extraction model'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Keywords OK', keywords.enabled ? 'Enabled' : 'Disabled');
}

/**
 * Check importance weighting
 */
export function checkImportanceWeighting(settings) {
    const importance = settings?.ragbooks?.rag?.importanceWeighting;

    if (importance?.enabled) {
        const weights = importance.weights;
        if (!weights || Object.keys(weights).length === 0) {
            return new DiagnosticResult(
                false,
                SEVERITY.WARNING,
                'Importance weighting enabled without weights',
                'Importance weighting is on but no priority weights are defined',
                async (settings) => {
                    settings.ragbooks.rag.importanceWeighting.enabled = false;
                    return 'Disabled importance weighting';
                },
                'Either disable importance weighting or configure priority weights'
            );
        }
    }

    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Importance weighting OK',
        importance?.enabled ? 'Enabled' : 'Disabled'
    );
}

/**
 * ============================================================================
 * CHUNK/DATA DIAGNOSTICS (10 checks)
 * ============================================================================
 */

/**
 * Check for empty chunks
 */
export function checkEmptyChunks(library) {
    const empty = Object.values(library).filter(c => !c.text || c.text.trim().length === 0);

    if (empty.length > 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Empty chunks found',
            `${empty.length} chunks have no text content. These waste storage and won't match searches.`,
            null,
            'Delete empty chunks in chunk visualizer or re-chunk the content'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'No empty chunks', 'All chunks have text');
}

/**
 * Check for oversized chunks
 */
export function checkOversizedChunks(library, maxSize = 2000) {
    const oversized = Object.values(library).filter(c => c.text && c.text.length > maxSize);

    if (oversized.length > 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Oversized chunks detected',
            `${oversized.length} chunks exceed ${maxSize} chars. Large chunks waste context and may have poor embeddings.`,
            null,
            'Adjust chunk size settings and re-chunk, or manually split large chunks'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Chunk sizes OK', `All chunks under ${maxSize} chars`);
}

/**
 * Check for undersized chunks
 */
export function checkUndersizedChunks(library, minSize = 50) {
    const undersized = Object.values(library).filter(c => c.text && c.text.length < minSize && !c.isSummaryChunk);

    if (undersized.length > Object.keys(library).length * 0.3) {
        return new DiagnosticResult(
            false,
            SEVERITY.INFO,
            'Many small chunks',
            `${undersized.length} chunks are under ${minSize} chars. Small chunks may lack context for good matches.`,
            null,
            'Consider increasing min chunk size in settings'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Chunk sizes OK', 'Most chunks have adequate length');
}

/**
 * Check summary chunk configuration
 */
export function checkSummaryChunkConfig(library) {
    const summaries = Object.values(library).filter(c => c.isSummaryChunk);
    const summaryParents = Object.values(library).filter(c => c.summaryVector && !c.isSummaryChunk);

    if (summaryParents.length > 0 && summaries.length === 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.ERROR,
            'Summary vectors not created',
            `${summaryParents.length} chunks have summaryVector=true but no summary chunks exist. Dual-vector search won't work.`,
            null,
            'Click "Update Summary Chunks" in chunk visualizer to create missing summaries'
        );
    }

    if (summaries.length > 0) {
        const orphaned = summaries.filter(s => {
            const parent = Object.values(library).find(c => c.hash === s.parentHash);
            return !parent;
        });

        if (orphaned.length > 0) {
            return new DiagnosticResult(
                false,
                SEVERITY.WARNING,
                'Orphaned summary chunks',
                `${orphaned.length} summary chunks have missing parent chunks`,
                null,
                'Re-chunk to rebuild summary relationships'
            );
        }
    }

    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Summary configuration OK',
        summaries.length > 0 ? `${summaries.length} summaries` : 'No summaries'
    );
}

/**
 * Check chunk links
 */
export function checkChunkLinks(library) {
    const withLinks = Object.values(library).filter(c => c.chunkLinks && c.chunkLinks.length > 0);
    const brokenLinks = [];

    const hashSet = new Set(Object.values(library).map(c => c.hash));

    for (const chunk of withLinks) {
        for (const link of chunk.chunkLinks) {
            if (!hashSet.has(link.targetHash)) {
                brokenLinks.push({ source: chunk.hash, target: link.targetHash });
            }
        }
    }

    if (brokenLinks.length > 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Broken chunk links',
            `${brokenLinks.length} chunk links point to non-existent chunks`,
            null,
            'Re-chunk to rebuild proper linking'
        );
    }

    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Chunk links OK',
        `${withLinks.length} chunks with links`
    );
}

/**
 * Check metadata quality
 */
export function checkMetadataQuality(library) {
    const withKeywords = Object.values(library).filter(c =>
        c.metadata?.keywords && c.metadata.keywords.length > 0
    );

    if (withKeywords.length < Object.keys(library).length * 0.5) {
        return new DiagnosticResult(
            false,
            SEVERITY.INFO,
            'Limited metadata coverage',
            `Only ${withKeywords.length} of ${Object.keys(library).length} chunks have keywords`,
            null,
            'Regenerate keywords to improve metadata coverage'
        );
    }

    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Metadata quality OK',
        `${withKeywords.length} chunks with keywords`
    );
}

/**
 * Check conditional activation
 */
export function checkConditionalActivation(library) {
    const withConditions = Object.values(library).filter(c =>
        c.conditions && Object.keys(c.conditions).length > 0
    );

    if (withConditions.length > 0) {
        // Validate condition syntax
        for (const chunk of withConditions) {
            try {
                validateConditions(chunk.conditions);
            } catch (error) {
                return new DiagnosticResult(
                    false,
                    SEVERITY.ERROR,
                    'Invalid conditional activation syntax',
                    `Chunk ${chunk.hash} has malformed conditions: ${error.message}`,
                    null,
                    'Fix conditional activation rules in chunk visualizer'
                );
            }
        }
    }

    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Conditional activation OK',
        `${withConditions.length} chunks with conditions`
    );
}

/**
 * Check temporal decay settings
 */
export function checkTemporalDecay(library, settings) {
    const decay = settings?.ragbooks?.rag?.temporalDecay;

    if (!decay?.enabled) {
        return new DiagnosticResult(true, SEVERITY.INFO, 'Temporal decay disabled', 'Optional feature not in use');
    }

    const withTimestamps = Object.values(library).filter(c => c.timestamp || c.metadata?.timestamp);

    if (withTimestamps.length === 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Temporal decay enabled but no timestamps',
            'Temporal decay is on but chunks have no timestamp data',
            async (settings) => {
                settings.ragbooks.rag.temporalDecay.enabled = false;
                return 'Disabled temporal decay';
            },
            'Either disable temporal decay or add timestamps to chunks'
        );
    }

    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Temporal decay OK',
        `${withTimestamps.length} chunks with timestamps`
    );
}

/**
 * Check chunk groups
 */
export function checkChunkGroups(library, settings) {
    const groups = settings?.ragbooks?.rag?.chunkGroups;

    if (!groups?.enabled) {
        return new DiagnosticResult(true, SEVERITY.INFO, 'Chunk groups disabled', 'Optional feature not in use');
    }

    const withGroups = Object.values(library).filter(c => c.group);

    if (withGroups.length === 0) {
        return new DiagnosticResult(
            false,
            SEVERITY.WARNING,
            'Chunk groups enabled but no groups assigned',
            'Chunk grouping is on but no chunks have group assignments',
            async (settings) => {
                settings.ragbooks.rag.chunkGroups.enabled = false;
                return 'Disabled chunk groups';
            },
            'Either disable chunk groups or assign chunks to groups'
        );
    }

    return new DiagnosticResult(
        true,
        SEVERITY.INFO,
        'Chunk groups OK',
        `${withGroups.length} chunks in groups`
    );
}

/**
 * Check text cleaning
 */
export function checkTextCleaning(library) {
    const suspiciousPatterns = [
        /\*{3,}/,  // Multiple asterisks
        /_{3,}/,   // Multiple underscores
        /\s{5,}/,  // Excessive whitespace
        /\.{4,}/,  // Multiple periods
    ];

    const dirty = Object.values(library).filter(c => {
        return c.text && suspiciousPatterns.some(pattern => pattern.test(c.text));
    });

    if (dirty.length > Object.keys(library).length * 0.2) {
        return new DiagnosticResult(
            false,
            SEVERITY.INFO,
            'Chunks may need text cleaning',
            `${dirty.length} chunks contain formatting artifacts that could affect search`,
            null,
            'Enable text cleaning in RAGBooks settings before chunking'
        );
    }

    return new DiagnosticResult(true, SEVERITY.INFO, 'Text quality OK', 'Chunks appear clean');
}

/**
 * ============================================================================
 * MAIN DIAGNOSTIC RUNNER
 * ============================================================================
 */

/**
 * Run all diagnostics and return results
 * @param {Object} options - Diagnostic options
 * @param {string} options.collectionId - Collection to diagnose
 * @param {string} options.scope - Scope (global, character, chat)
 * @param {string} options.scopeId - Scope ID (characterId or chatId)
 * @param {boolean} options.showToasters - Whether to show toaster notifications
 * @param {boolean} options.skipSlowChecks - Skip checks that require API calls
 * @returns {Promise<Object>} Diagnostic results grouped by category
 */
export async function runDiagnostics(options = {}) {
    const {
        collectionId = null,
        scope = 'character',
        scopeId = null,
        showToasters = true,
        skipSlowChecks = false
    } = options;

    const results = {
        vectorDatabase: [],
        library: [],
        search: [],
        configuration: [],
        chunkData: [],
        productionTests: [],
        summary: {
            total: 0,
            passed: 0,
            failed: 0,
            critical: 0,
            errors: 0,
            warnings: 0,
            info: 0
        }
    };

    // Get settings and state
    const settings = extension_settings;
    const ragState = settings?.ragbooks?.rag;

    if (!ragState) {
        const result = new DiagnosticResult(
            false,
            SEVERITY.CRITICAL,
            'RAGBooks not initialized',
            'RAGBooks settings are missing. Extension may not be properly installed.',
            null,
            'Reinstall RAGBooks extension'
        );
        if (showToasters) showDiagnosticToaster(result);
        results.configuration.push(result);
        return results;
    }

    // Configuration checks (always run)
    results.configuration.push(checkRAGBooksEnabled(settings));
    results.configuration.push(checkInjectionSettings(settings));
    results.configuration.push(checkChunkingStrategy(settings));
    results.configuration.push(checkChunkSize(settings));
    results.configuration.push(checkKeywordSettings(settings));
    results.configuration.push(checkImportanceWeighting(settings));

    // Vector source check
    const sourceCheck = await checkVectorSource(settings);
    results.vectorDatabase.push(sourceCheck);

    // If collection specified, run collection-specific checks
    if (collectionId) {
        // Library checks
        const libraryCheck = checkLibraryExists(ragState, scope, scopeId, collectionId);
        results.library.push(libraryCheck);

        if (libraryCheck.passed) {
            let library;
            switch (scope) {
                case 'global':
                    library = ragState.libraries?.global?.[collectionId];
                    break;
                case 'character':
                    library = ragState.libraries?.character?.[scopeId]?.[collectionId];
                    break;
                case 'chat':
                    library = ragState.libraries?.chat?.[scopeId]?.[collectionId];
                    break;
            }

            if (library) {
                // Library/storage diagnostics
                results.library.push(checkLibraryIntegrity(library));
                results.library.push(checkOrphanedParents(library));
                results.library.push(checkDuplicateChunks(library));
                results.library.push(checkMetadata(library));
                results.library.push(checkScopeMismatch(collectionId, scope, ragState));

                // Chunk/data diagnostics
                results.chunkData.push(checkEmptyChunks(library));
                results.chunkData.push(checkOversizedChunks(library));
                results.chunkData.push(checkUndersizedChunks(library));
                results.chunkData.push(checkSummaryChunkConfig(library));
                results.chunkData.push(checkChunkLinks(library));
                results.chunkData.push(checkMetadataQuality(library));
                results.chunkData.push(checkConditionalActivation(library));
                results.chunkData.push(checkTemporalDecay(library, settings));
                results.chunkData.push(checkChunkGroups(library, settings));
                results.chunkData.push(checkTextCleaning(library));

                // Vector database checks (can be slow)
                if (!skipSlowChecks && sourceCheck.passed) {
                    const source = settings.vectors.source;
                    results.vectorDatabase.push(await checkVectorConnection(collectionId, source));
                    results.vectorDatabase.push(await checkCollectionExists(collectionId, source));
                    results.vectorDatabase.push(await checkHashMismatch(collectionId, library, source));
                    results.vectorDatabase.push(await checkSummaryVectorization(collectionId, library, source));
                }
            }
        }
    }

    // General library size check
    results.library.push(checkLibrarySize(ragState));

    // Search diagnostics (general)
    results.search.push(checkThresholdSettings(ragState.threshold, settings.vectors?.source));
    results.search.push(checkTopKSettings(ragState.topK));
    results.search.push(checkActiveCollections(ragState, scope, scopeId));
    results.search.push(checkSearchMode(ragState.searchMode));
    results.search.push(checkReranking(settings));

    // Calculate summary statistics
    const allResults = [
        ...results.vectorDatabase,
        ...results.library,
        ...results.search,
        ...results.configuration,
        ...results.chunkData,
        ...results.productionTests
    ];

    results.summary.total = allResults.length;
    results.summary.passed = allResults.filter(r => r.passed).length;
    results.summary.failed = allResults.filter(r => !r.passed).length;
    results.summary.critical = allResults.filter(r => r.severity === SEVERITY.CRITICAL).length;
    results.summary.errors = allResults.filter(r => r.severity === SEVERITY.ERROR).length;
    results.summary.warnings = allResults.filter(r => r.severity === SEVERITY.WARNING).length;
    results.summary.info = allResults.filter(r => r.severity === SEVERITY.INFO).length;

    // Show toasters for failed checks
    if (showToasters) {
        const failures = allResults.filter(r => !r.passed && r.severity !== SEVERITY.INFO);

        // Show critical/error first
        failures
            .filter(r => r.severity === SEVERITY.CRITICAL || r.severity === SEVERITY.ERROR)
            .forEach(result => {
                showDiagnosticToaster(result, async (result) => {
                    if (result.autoFix) {
                        try {
                            const message = await result.autoFix(settings);
                            toastr.success(message, 'Fixed');
                            await saveSettingsDebounced();
                        } catch (error) {
                            toastr.error(`Auto-fix failed: ${error.message}`);
                        }
                    }
                });
            });

        // Then warnings
        failures
            .filter(r => r.severity === SEVERITY.WARNING)
            .slice(0, 3) // Limit warnings to avoid spam
            .forEach(result => {
                showDiagnosticToaster(result, async (result) => {
                    if (result.autoFix) {
                        try {
                            const message = await result.autoFix(settings);
                            toastr.success(message, 'Fixed');
                            await saveSettingsDebounced();
                        } catch (error) {
                            toastr.error(`Auto-fix failed: ${error.message}`);
                        }
                    }
                });
            });
    }

    return results;
}

/**
 * Run diagnostics for current active context
 */
export async function runActiveDiagnostics() {
    const context = getContext();
    const characterId = context.characterId;
    const chatId = context.chatId;

    // Determine scope
    let scope = 'global';
    let scopeId = null;

    if (characterId) {
        scope = 'character';
        scopeId = characterId;
    } else if (chatId) {
        scope = 'chat';
        scopeId = chatId;
    }

    return await runDiagnostics({
        scope,
        scopeId,
        showToasters: true,
        skipSlowChecks: false
    });
}

/**
 * Quick diagnostics (skip slow API calls)
 */
export async function runQuickDiagnostics(collectionId, scope, scopeId) {
    return await runDiagnostics({
        collectionId,
        scope,
        scopeId,
        showToasters: false,
        skipSlowChecks: true
    });
}

// Expose diagnostics to window for console access
if (typeof window !== 'undefined') {
    window.ragDiagnostics = {
        run: runDiagnostics,
        runActive: runActiveDiagnostics,
        runQuick: runQuickDiagnostics
    };
}

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
 *
 * DIAGNOSTICS:
 *
 * Run comprehensive diagnostics:
 *    await window.ragDiagnostics.runActive()
 *
 * Run diagnostics for specific collection:
 *    await window.ragDiagnostics.run({ collectionId: 'your_collection_id', scope: 'character', scopeId: 'characterId' })
 *
 * Quick diagnostics (skip slow checks):
 *    await window.ragDiagnostics.runQuick('collection_id', 'character', 'charId')
 */
