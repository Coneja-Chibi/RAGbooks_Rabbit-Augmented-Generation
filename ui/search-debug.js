/**
 * ============================================================================
 * VECTHARE SEARCH DEBUG MODAL
 * ============================================================================
 * Shows detailed breakdown of the last RAG query pipeline:
 * - Query text used
 * - Initial vector search results
 * - Temporal decay effects
 * - Condition filtering
 * - Final injection results
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

// ============================================================================
// STATE
// ============================================================================

let lastDebugData = null;

// ============================================================================
// DATA STRUCTURE
// ============================================================================

/**
 * Structure for debug data - populated during RAG pipeline
 * @typedef {Object} SearchDebugData
 * @property {string} query - The query text used
 * @property {number} timestamp - When the search was performed
 * @property {string} collectionId - Collection that was searched
 * @property {Object} settings - Settings used for the search
 * @property {Object} stages - Data from each pipeline stage
 * @property {Array} stages.initial - Chunks from initial vector query
 * @property {Array} stages.afterDecay - Chunks after temporal decay
 * @property {Array} stages.afterConditions - Chunks after condition filtering
 * @property {Array} stages.injected - Chunks that were actually injected
 * @property {Object} stats - Summary statistics
 */

/**
 * Creates empty debug data structure with full tracing support
 * @returns {SearchDebugData}
 */
export function createDebugData() {
    return {
        query: '',
        timestamp: Date.now(),
        collectionId: null,
        settings: {},
        stages: {
            initial: [],
            afterThreshold: [],
            afterDecay: [],
            afterConditions: [],
            injected: []
        },
        // Detailed trace log - every operation recorded
        trace: [],
        // Per-chunk tracking - what happened to each chunk
        chunkFates: {},
        stats: {
            totalInCollection: 0,
            retrievedFromVector: 0,
            passedThreshold: 0,
            afterDecay: 0,
            afterConditions: 0,
            actuallyInjected: 0,
            skippedDuplicates: 0,
            tokensBudget: 0,
            tokensUsed: 0
        }
    };
}

/**
 * Adds a trace entry to debug data
 * @param {SearchDebugData} debugData
 * @param {string} stage - Pipeline stage name
 * @param {string} action - What happened
 * @param {Object} details - Additional details
 */
export function addTrace(debugData, stage, action, details = {}) {
    if (!debugData.trace) debugData.trace = [];
    debugData.trace.push({
        time: Date.now(),
        stage,
        action,
        ...details
    });
}

/**
 * Records the fate of a specific chunk
 * @param {SearchDebugData} debugData
 * @param {string} hash - Chunk hash
 * @param {string} stage - Where it was dropped/passed
 * @param {string} fate - 'passed' | 'dropped'
 * @param {string} reason - Why it was dropped (if dropped)
 * @param {Object} data - Additional data (scores, etc)
 */
export function recordChunkFate(debugData, hash, stage, fate, reason = null, data = {}) {
    if (!debugData.chunkFates) debugData.chunkFates = {};
    if (!debugData.chunkFates[hash]) {
        debugData.chunkFates[hash] = {
            hash,
            stages: [],
            finalFate: null,
            finalReason: null
        };
    }

    debugData.chunkFates[hash].stages.push({
        stage,
        fate,
        reason,
        ...data
    });

    // Update final fate if dropped
    if (fate === 'dropped') {
        debugData.chunkFates[hash].finalFate = 'dropped';
        debugData.chunkFates[hash].finalReason = reason;
        debugData.chunkFates[hash].droppedAt = stage;
    } else if (fate === 'injected') {
        debugData.chunkFates[hash].finalFate = 'injected';
    }
}

/**
 * Stores debug data for the last search
 * @param {SearchDebugData} data
 */
export function setLastSearchDebug(data) {
    lastDebugData = data;
    console.log('VectHare Debug: Stored search debug data', {
        query: data.query?.substring(0, 50) + '...',
        stages: {
            initial: data.stages.initial.length,
            afterDecay: data.stages.afterDecay.length,
            afterConditions: data.stages.afterConditions.length,
            injected: data.stages.injected.length
        }
    });
}

/**
 * Gets the last search debug data
 * @returns {SearchDebugData|null}
 */
export function getLastSearchDebug() {
    return lastDebugData;
}

// ============================================================================
// MODAL UI
// ============================================================================

/**
 * Opens the search debug modal
 */
export function openSearchDebugModal() {
    if (!lastDebugData) {
        toastr.info('No search has been performed yet. Send a message to trigger a RAG query.', 'VectHare');
        return;
    }

    // Remove existing modal
    $('#vecthare_search_debug_modal').remove();

    const html = createModalHtml(lastDebugData);
    $('body').append(html);

    bindEvents();
    $('#vecthare_search_debug_modal').fadeIn(200);
}

/**
 * Closes the search debug modal
 */
export function closeSearchDebugModal() {
    $('#vecthare_search_debug_modal').fadeOut(200, function() {
        $(this).remove();
    });
}

/**
 * Creates the modal HTML
 * @param {SearchDebugData} data
 * @returns {string}
 */
function createModalHtml(data) {
    const timeAgo = getTimeAgo(data.timestamp);
    const queryPreview = data.query.length > 200
        ? data.query.substring(0, 200) + '...'
        : data.query;

    return `
        <div id="vecthare_search_debug_modal" class="vecthare-modal" style="display: none;">
            <div class="vecthare-modal-content vecthare-search-debug-content">
                <!-- Header -->
                <div class="vecthare-modal-header">
                    <h3><i class="fa-solid fa-bug"></i> Search Debug</h3>
                    <button class="vecthare-debug-copy-btn" id="vecthare_copy_diagnostic" title="Copy diagnostic dump">
                        <i class="fa-solid fa-copy"></i> Copy Debug
                    </button>
                    <button class="vecthare-modal-close" id="vecthare_search_debug_close">✕</button>
                </div>

                <!-- Body -->
                <div class="vecthare-modal-body vecthare-search-debug-body">

                    <!-- Query Info Card -->
                    <div class="vecthare-debug-card">
                        <div class="vecthare-debug-card-header">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <span>Query</span>
                            <span class="vecthare-debug-timestamp">${timeAgo}</span>
                        </div>
                        <div class="vecthare-debug-card-body">
                            <div class="vecthare-debug-query-text">${escapeHtml(queryPreview)}</div>
                            ${data.query.length > 200 ? `
                                <button class="vecthare-debug-expand-btn" data-target="query">
                                    Show full query (${data.query.length} chars)
                                </button>
                                <div class="vecthare-debug-expanded" id="vecthare_debug_query_full" style="display: none;">
                                    <pre>${escapeHtml(data.query)}</pre>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Pipeline Overview -->
                    <div class="vecthare-debug-pipeline">
                        <div class="vecthare-debug-pipeline-title">
                            <i class="fa-solid fa-diagram-project"></i>
                            RAG Pipeline
                        </div>
                        <div class="vecthare-debug-pipeline-stages">
                            ${createPipelineStage('Vector Search', data.stages.initial.length, data.stats.retrievedFromVector, 'fa-database', 'primary')}
                            <div class="vecthare-debug-pipeline-arrow">→</div>
                            ${createPipelineStage('Threshold', data.stages.initial.filter(c => c.score >= (data.settings.threshold || 0)).length, data.stages.initial.length, 'fa-filter', 'info')}
                            <div class="vecthare-debug-pipeline-arrow">→</div>
                            ${createPipelineStage('Decay', data.stages.afterDecay.length, data.stages.initial.length, 'fa-clock', 'warning')}
                            <div class="vecthare-debug-pipeline-arrow">→</div>
                            ${createPipelineStage('Conditions', data.stages.afterConditions.length, data.stages.afterDecay.length, 'fa-code-branch', 'secondary')}
                            <div class="vecthare-debug-pipeline-arrow">→</div>
                            ${createPipelineStage('Injected', data.stages.injected.length, data.stages.afterConditions.length, 'fa-syringe', 'success')}
                        </div>
                    </div>

                    <!-- Settings Used -->
                    <div class="vecthare-debug-card vecthare-debug-settings">
                        <div class="vecthare-debug-card-header">
                            <i class="fa-solid fa-gear"></i>
                            <span>Settings Used</span>
                        </div>
                        <div class="vecthare-debug-card-body">
                            <div class="vecthare-debug-settings-grid">
                                <div class="vecthare-debug-setting">
                                    <span class="vecthare-debug-setting-label">Threshold</span>
                                    <span class="vecthare-debug-setting-value">${data.settings.threshold || 'N/A'}</span>
                                </div>
                                <div class="vecthare-debug-setting">
                                    <span class="vecthare-debug-setting-label">Top K</span>
                                    <span class="vecthare-debug-setting-value">${data.settings.topK || 'N/A'}</span>
                                </div>
                                <div class="vecthare-debug-setting">
                                    <span class="vecthare-debug-setting-label">Temporal Decay</span>
                                    <span class="vecthare-debug-setting-value">${data.settings.temporal_decay?.enabled ? 'On' : 'Off'}</span>
                                </div>
                                <div class="vecthare-debug-setting">
                                    <span class="vecthare-debug-setting-label">Collection</span>
                                    <span class="vecthare-debug-setting-value vecthare-debug-setting-mono">${data.collectionId || 'Unknown'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Chunks by Stage -->
                    <div class="vecthare-debug-card">
                        <div class="vecthare-debug-card-header">
                            <i class="fa-solid fa-layer-group"></i>
                            <span>Chunks by Stage</span>
                        </div>
                        <div class="vecthare-debug-card-body">
                            <!-- Stage Tabs -->
                            <div class="vecthare-debug-stage-tabs">
                                <button class="vecthare-debug-stage-tab active" data-stage="initial">
                                    Initial (${data.stages.initial.length})
                                </button>
                                <button class="vecthare-debug-stage-tab" data-stage="afterDecay">
                                    After Decay (${data.stages.afterDecay.length})
                                </button>
                                <button class="vecthare-debug-stage-tab" data-stage="afterConditions">
                                    After Conditions (${data.stages.afterConditions.length})
                                </button>
                                <button class="vecthare-debug-stage-tab" data-stage="injected">
                                    Injected (${data.stages.injected.length})
                                </button>
                            </div>

                            <!-- Stage Content -->
                            <div class="vecthare-debug-stage-content" id="vecthare_debug_stage_content">
                                ${renderStageChunks(data.stages.initial, 'initial', data)}
                            </div>
                        </div>
                    </div>

                    <!-- Critical Failure Alert (0 injected) -->
                    ${renderCriticalFailure(data)}

                    <!-- Excluded Chunks Analysis -->
                    ${renderExcludedAnalysis(data)}

                    <!-- Developer Trace Log -->
                    ${renderTraceLog(data)}

                    <!-- Per-Chunk Fate Tracking -->
                    ${renderChunkFates(data)}

                </div>
            </div>
        </div>
    `;
}

/**
 * Creates a pipeline stage box
 */
function createPipelineStage(label, count, fromCount, icon, colorClass) {
    const percentage = fromCount > 0 ? Math.round((count / fromCount) * 100) : 0;
    const lost = fromCount - count;

    return `
        <div class="vecthare-debug-pipeline-stage vecthare-debug-stage-${colorClass}">
            <div class="vecthare-debug-stage-icon">
                <i class="fa-solid ${icon}"></i>
            </div>
            <div class="vecthare-debug-stage-count">${count}</div>
            <div class="vecthare-debug-stage-label">${label}</div>
            ${lost > 0 ? `<div class="vecthare-debug-stage-lost">-${lost}</div>` : ''}
        </div>
    `;
}

/**
 * Renders chunks for a specific stage
 */
function renderStageChunks(chunks, stageName, data) {
    if (!chunks || chunks.length === 0) {
        return `
            <div class="vecthare-debug-empty">
                <i class="fa-solid fa-inbox"></i>
                <p>No chunks at this stage</p>
            </div>
        `;
    }

    let html = '<div class="vecthare-debug-chunks-list">';

    chunks.forEach((chunk, idx) => {
        const textPreview = chunk.text
            ? (chunk.text.length > 100 ? chunk.text.substring(0, 100) + '...' : chunk.text)
            : '(text not found)';

        const scoreClass = getScoreClass(chunk.score);
        const decayInfo = chunk.decayApplied
            ? `<span class="vecthare-debug-decay-badge" title="Original: ${chunk.originalScore?.toFixed(3)}">
                   Decay: ${((1 - chunk.decayMultiplier) * 100).toFixed(0)}%↓
               </span>`
            : '';

        // Build score breakdown showing the math
        const scoreBreakdown = buildScoreBreakdown(chunk);

        // Check if this chunk was excluded in later stages
        const wasExcluded = getExclusionStatus(chunk, stageName, data);

        html += `
            <div class="vecthare-debug-chunk ${wasExcluded ? 'vecthare-debug-chunk-excluded' : ''}">
                <div class="vecthare-debug-chunk-header">
                    <span class="vecthare-debug-chunk-rank">#${idx + 1}</span>
                    <span class="vecthare-debug-chunk-score ${scoreClass}">${chunk.score?.toFixed(3) || 'N/A'}</span>
                    ${decayInfo}
                    ${wasExcluded ? `<span class="vecthare-debug-excluded-badge">${wasExcluded}</span>` : ''}
                </div>
                ${scoreBreakdown}
                <div class="vecthare-debug-chunk-text">${escapeHtml(textPreview)}</div>
                <div class="vecthare-debug-chunk-meta">
                    <span>Hash: ${chunk.hash}</span>
                    ${chunk.index !== undefined ? `<span>Msg #${chunk.index}</span>` : ''}
                    ${chunk.messageAge !== undefined ? `<span>Age: ${chunk.messageAge} msgs</span>` : ''}
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

/**
 * Determines why a chunk was excluded
 */
function getExclusionStatus(chunk, currentStage, data) {
    const stages = ['initial', 'afterDecay', 'afterConditions', 'injected'];
    const currentIdx = stages.indexOf(currentStage);

    // Check if chunk exists in later stages
    for (let i = currentIdx + 1; i < stages.length; i++) {
        const stageChunks = data.stages[stages[i]];
        const existsInStage = stageChunks.some(c => c.hash === chunk.hash);

        if (!existsInStage) {
            switch(stages[i]) {
                case 'afterDecay': return 'Lost to decay';
                case 'afterConditions': return 'Failed conditions';
                case 'injected': return 'Not injected';
            }
        }
    }

    return null;
}

/**
 * Builds a score breakdown showing the math behind the final score
 * Shows: vectorScore × keywordBoost × decayMultiplier = finalScore
 */
function buildScoreBreakdown(chunk) {
    // Get the original vector similarity score (before any boosts)
    const vectorScore = chunk.originalScore ?? chunk.score;
    const keywordBoost = chunk.keywordBoost ?? 1.0;
    const decayMultiplier = chunk.decayMultiplier ?? 1.0;
    const finalScore = chunk.score;

    // Only show breakdown if there's something to break down
    const hasKeywordBoost = keywordBoost && keywordBoost !== 1.0;
    const hasDecay = chunk.decayApplied && decayMultiplier !== 1.0;

    if (!hasKeywordBoost && !hasDecay && vectorScore === finalScore) {
        // No modifications, just show vector score
        return `<div class="vecthare-debug-score-breakdown">
            <span class="vecthare-score-math">Vector: ${vectorScore?.toFixed(3) || 'N/A'}</span>
        </div>`;
    }

    // Build the math equation
    let mathParts = [];
    mathParts.push(`<span class="vecthare-score-vector">${vectorScore?.toFixed(3) || '?'}</span>`);

    if (hasKeywordBoost) {
        // Show keyword breakdown with weights if available
        let boostTitle = 'Keyword boost';
        if (chunk.matchedKeywordsWithWeights?.length > 0) {
            const kwDetails = chunk.matchedKeywordsWithWeights.map(k =>
                `${k.text}: +${((k.weight - 1) * 100).toFixed(0)}%`
            ).join(', ');
            boostTitle = `Additive boost: ${kwDetails}`;
        } else if (chunk.matchedKeywords?.length > 0) {
            boostTitle = `Matched: ${chunk.matchedKeywords.join(', ')}`;
        }
        mathParts.push(`<span class="vecthare-score-operator">×</span>`);
        mathParts.push(`<span class="vecthare-score-boost" title="${boostTitle}">${keywordBoost.toFixed(2)}x</span>`);
    }

    if (hasDecay) {
        mathParts.push(`<span class="vecthare-score-operator">×</span>`);
        mathParts.push(`<span class="vecthare-score-decay" title="Age: ${chunk.messageAge || '?'} msgs">${decayMultiplier.toFixed(2)}↓</span>`);
    }

    mathParts.push(`<span class="vecthare-score-operator">=</span>`);
    mathParts.push(`<span class="vecthare-score-final">${finalScore?.toFixed(3) || '?'}</span>`);

    // Add keyword matches with weights if present
    let keywordInfo = '';
    if (chunk.matchedKeywordsWithWeights?.length > 0) {
        const kwStr = chunk.matchedKeywordsWithWeights.map(k =>
            k.weight !== 1.5 ? `${k.text} (${k.weight}x)` : k.text
        ).join(', ');
        keywordInfo = `<div class="vecthare-score-keywords">Keywords: ${kwStr}</div>`;
    } else if (chunk.matchedKeywords?.length > 0) {
        keywordInfo = `<div class="vecthare-score-keywords">Keywords: ${chunk.matchedKeywords.join(', ')}</div>`;
    }

    return `<div class="vecthare-debug-score-breakdown">
        <div class="vecthare-score-math">${mathParts.join(' ')}</div>
        ${keywordInfo}
    </div>`;
}

/**
 * Renders critical failure alert when 0 chunks were injected
 * Diagnoses the pipeline and provides actionable fixes
 */
function renderCriticalFailure(data) {
    // Only show if we got 0 injected chunks
    if (data.stages.injected.length > 0) {
        return '';
    }

    // Diagnose the pipeline step by step
    const diagnosis = diagnosePipeline(data);

    // Build a one-line summary of what went wrong
    const failedStage = diagnosis.find(d => d.isCause);
    const failureSummary = failedStage
        ? `Failed at: ${failedStage.label}`
        : 'Unknown failure point';

    return `
        <div class="vecthare-debug-critical-failure">
            <div class="vecthare-debug-critical-header">
                <div class="vecthare-debug-critical-icon">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                </div>
                <div>
                    <div class="vecthare-debug-critical-title">No Chunks Injected — ${failureSummary}</div>
                    <div class="vecthare-debug-critical-subtitle">
                        ${data.stages.initial.length === 0
                            ? 'Vector search returned no results'
                            : `${data.stages.initial.length} chunks retrieved, but all were filtered out before injection`}
                    </div>
                </div>
            </div>

            <div class="vecthare-debug-diagnosis">
                <div class="vecthare-debug-diagnosis-title">
                    <i class="fa-solid fa-stethoscope"></i>
                    Pipeline Diagnosis
                </div>

                ${diagnosis.map((item, idx) => `
                    <div class="vecthare-debug-diagnosis-item ${item.isCause ? 'is-cause' : ''} ${item.isOk ? 'is-ok' : ''}">
                        <div class="vecthare-debug-diagnosis-number">${idx + 1}</div>
                        <div class="vecthare-debug-diagnosis-content">
                            <div class="vecthare-debug-diagnosis-label">
                                ${item.label}
                                <span class="vecthare-debug-diagnosis-status ${item.isOk ? 'status-ok' : 'status-fail'}">
                                    ${item.isOk ? '✓ OK' : '✗ FAILED'}
                                </span>
                            </div>
                            <div class="vecthare-debug-diagnosis-detail">${item.detail}</div>
                            ${item.fix ? `
                                <div class="vecthare-debug-diagnosis-fix">
                                    <strong>Fix:</strong> ${item.fix}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Diagnoses the RAG pipeline to find where and why chunks were lost
 * Returns bespoke, specific fixes based on the actual data
 * @returns {Array<{label: string, detail: string, fix?: string, isCause: boolean, isOk: boolean}>}
 */
function diagnosePipeline(data) {
    const diagnosis = [];
    const threshold = data.settings.threshold || 0;
    const topK = data.settings.topK || 10;
    const temporalDecay = data.settings.temporal_decay;

    // Step 1: Initial Vector Search
    const initialCount = data.stages.initial.length;
    if (initialCount === 0) {
        diagnosis.push({
            label: 'Vector Search',
            detail: `No matches returned from vector database for collection "${data.collectionId}".`,
            fix: `Open Database Browser and check if "${data.collectionId}" exists and contains chunks. If empty, send some messages first to build the vector index.`,
            isCause: true,
            isOk: false
        });
        return diagnosis;
    }

    // Analyze initial chunks in detail
    const scores = data.stages.initial.map(c => c.score || 0);
    const bestScore = Math.max(...scores);
    const worstScore = Math.min(...scores);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    diagnosis.push({
        label: 'Vector Search',
        detail: `Retrieved ${initialCount} chunks. Scores: best ${bestScore.toFixed(3)}, worst ${worstScore.toFixed(3)}, avg ${avgScore.toFixed(3)}`,
        isCause: false,
        isOk: true
    });

    // Step 2: Threshold Filter - find chunks that would fail
    const aboveThreshold = data.stages.initial.filter(c => (c.score || 0) >= threshold);
    const belowThreshold = data.stages.initial.filter(c => (c.score || 0) < threshold);

    if (aboveThreshold.length === 0) {
        // ALL chunks failed threshold - give very specific fix
        const marginNeeded = (threshold - bestScore).toFixed(3);
        const suggestedThreshold = Math.max(0, bestScore - 0.02).toFixed(2);

        // Find the closest chunk to the threshold
        const closestChunk = data.stages.initial.reduce((closest, chunk) => {
            const diff = threshold - (chunk.score || 0);
            const closestDiff = threshold - (closest.score || 0);
            return diff < closestDiff ? chunk : closest;
        });

        diagnosis.push({
            label: 'Threshold Filter',
            detail: `All ${initialCount} chunks rejected. Your threshold is ${threshold}, but the best match only scored ${bestScore.toFixed(3)} (${marginNeeded} short).`,
            fix: `Change threshold from ${threshold} → ${suggestedThreshold}. Your closest chunk "${truncateText(closestChunk.text, 50)}" scored ${closestChunk.score?.toFixed(3)}.`,
            isCause: true,
            isOk: false
        });
        return diagnosis;
    } else if (belowThreshold.length > 0) {
        // Some chunks failed - show which ones and why
        const justMissed = belowThreshold.filter(c => (c.score || 0) >= threshold - 0.1);
        let detail = `${aboveThreshold.length}/${initialCount} passed threshold (${threshold}).`;
        if (justMissed.length > 0) {
            detail += ` ${justMissed.length} chunks just missed (within 0.1 of threshold).`;
        }
        diagnosis.push({
            label: 'Threshold Filter',
            detail: detail,
            isCause: false,
            isOk: true
        });
    } else {
        diagnosis.push({
            label: 'Threshold Filter',
            detail: `All ${initialCount} chunks passed threshold (${threshold}).`,
            isCause: false,
            isOk: true
        });
    }

    // Step 3: Temporal Decay - analyze actual decay impact
    const afterDecay = data.stages.afterDecay;
    const afterDecayCount = afterDecay.length;

    if (temporalDecay?.enabled) {
        // Find chunks that were lost specifically to decay
        const lostToDecay = aboveThreshold.filter(chunk => {
            return !afterDecay.some(dc => dc.hash === chunk.hash);
        });

        if (afterDecayCount === 0 && aboveThreshold.length > 0) {
            // All chunks killed by decay - analyze the decay impact
            const decayedChunks = aboveThreshold.map(chunk => {
                const afterDecayChunk = data.stages.initial.find(c => c.hash === chunk.hash);
                return {
                    ...chunk,
                    originalScore: chunk.originalScore || chunk.score,
                    finalScore: afterDecayChunk?.score || 0,
                    age: chunk.messageAge || 'unknown'
                };
            });

            // Find the chunk that was closest to surviving
            const bestSurvivor = decayedChunks.reduce((best, chunk) => {
                return (chunk.finalScore || 0) > (best.finalScore || 0) ? chunk : best;
            });

            const decayStrength = temporalDecay.strength || temporalDecay.rate || 'unknown';
            const halfLife = temporalDecay.halfLife || temporalDecay.half_life || 'unknown';

            diagnosis.push({
                label: 'Temporal Decay',
                detail: `All ${aboveThreshold.length} chunks fell below threshold after decay. Best surviving score was ${bestSurvivor.finalScore?.toFixed(3) || 'N/A'} (age: ${bestSurvivor.age} messages).`,
                fix: `Your decay settings (strength: ${decayStrength}, half-life: ${halfLife}) are too aggressive. Either disable temporal decay, or increase half-life to preserve older messages longer.`,
                isCause: true,
                isOk: false
            });
            return diagnosis;
        } else if (lostToDecay.length > 0) {
            // Some chunks lost to decay - show specifics
            const oldestLost = lostToDecay.reduce((oldest, c) => {
                return (c.messageAge || 0) > (oldest.messageAge || 0) ? c : oldest;
            });
            diagnosis.push({
                label: 'Temporal Decay',
                detail: `${afterDecayCount}/${aboveThreshold.length} survived decay. Lost ${lostToDecay.length} chunks, oldest was ${oldestLost.messageAge || '?'} messages ago.`,
                isCause: false,
                isOk: true
            });
        } else {
            diagnosis.push({
                label: 'Temporal Decay',
                detail: `All ${afterDecayCount} chunks survived decay.`,
                isCause: false,
                isOk: true
            });
        }
    } else {
        diagnosis.push({
            label: 'Temporal Decay',
            detail: 'Disabled.',
            isCause: false,
            isOk: true
        });
    }

    // Step 4: Condition Filtering - analyze what conditions failed
    const afterConditions = data.stages.afterConditions;
    const afterConditionsCount = afterConditions.length;

    // Find chunks lost to conditions
    const lostToConditions = afterDecay.filter(chunk => {
        return !afterConditions.some(cc => cc.hash === chunk.hash);
    });

    if (afterConditionsCount === 0 && afterDecayCount > 0) {
        // All chunks failed conditions - try to determine why
        const chunksWithConditions = afterDecay.filter(c => c.metadata?.conditions);

        if (chunksWithConditions.length > 0) {
            // Chunks had explicit conditions that failed
            const conditionTypes = [...new Set(chunksWithConditions.map(c =>
                c.metadata.conditions?.type || 'unknown'
            ))];
            diagnosis.push({
                label: 'Condition Filtering',
                detail: `All ${afterDecayCount} chunks failed their conditions. Condition types present: ${conditionTypes.join(', ')}.`,
                fix: `Check the conditions on your chunks. ${chunksWithConditions.length} chunks have explicit conditions (${conditionTypes.join(', ')}). These may be character filters, keyword requirements, or custom rules that aren't being met.`,
                isCause: true,
                isOk: false
            });
        } else {
            // No explicit conditions - might be protected messages or other filtering
            diagnosis.push({
                label: 'Condition Filtering',
                detail: `All ${afterDecayCount} chunks were filtered out. This may be due to message protection settings.`,
                fix: `Check if these messages fall within your "protect recent N messages" setting. Messages in the protected range won't be injected as RAG context.`,
                isCause: true,
                isOk: false
            });
        }
        return diagnosis;
    } else if (lostToConditions.length > 0) {
        diagnosis.push({
            label: 'Condition Filtering',
            detail: `${afterConditionsCount}/${afterDecayCount} passed conditions. ${lostToConditions.length} filtered out.`,
            isCause: false,
            isOk: true
        });
    } else {
        diagnosis.push({
            label: 'Condition Filtering',
            detail: `All ${afterConditionsCount} chunks passed.`,
            isCause: false,
            isOk: true
        });
    }

    // Step 5: Final Injection
    const injected = data.stages.injected;
    const injectedCount = injected.length;

    // Find chunks that passed conditions but weren't injected
    const notInjected = afterConditions.filter(chunk => {
        return !injected.some(ic => ic.hash === chunk.hash);
    });

    // Get skipped duplicates count from stats
    const skippedDuplicates = data.stats?.skippedDuplicates || 0;

    if (injectedCount === 0 && afterConditionsCount > 0) {
        if (topK === 0) {
            diagnosis.push({
                label: 'Injection',
                detail: `${afterConditionsCount} chunks ready but Top K is set to 0.`,
                fix: `Set Top K to at least 1. Currently Top K = 0 which means no chunks will ever be injected.`,
                isCause: true,
                isOk: false
            });
        } else if (skippedDuplicates > 0 && skippedDuplicates >= afterConditionsCount) {
            // All chunks were already in context - this is actually fine, not a failure
            diagnosis.push({
                label: 'Injection',
                detail: `All ${afterConditionsCount} retrieved chunks are already in current chat context.`,
                fix: `This is normal! The relevant content is already in your recent messages, so no injection was needed. RAG will inject when older/forgotten content becomes relevant.`,
                isCause: false,
                isOk: true
            });
        } else {
            // No specific failure reason tracked - this shouldn't happen
            diagnosis.push({
                label: 'Injection',
                detail: `${afterConditionsCount} chunks passed all filters but none were injected. No specific reason was recorded.`,
                fix: `This may be a bug. Open DevTools (F12) → Console tab, look for "VectHare" errors, and report the issue with console output.`,
                isCause: true,
                isOk: false
            });
        }
    } else if (notInjected.length > 0) {
        // Some chunks not injected - explain why
        const reasons = [];
        if (skippedDuplicates > 0) reasons.push(`${skippedDuplicates} already in context`);
        const hitTopK = notInjected.length - skippedDuplicates;
        if (hitTopK > 0) reasons.push(`${hitTopK} hit Top K limit`);
        const reason = reasons.length > 0 ? reasons.join(', ') : `hit Top K limit (${topK})`;

        diagnosis.push({
            label: 'Injection',
            detail: `${injectedCount}/${afterConditionsCount} injected. ${notInjected.length} not injected: ${reason}.`,
            isCause: false,
            isOk: true
        });
    } else if (afterConditionsCount > 0) {
        diagnosis.push({
            label: 'Injection',
            detail: `All ${injectedCount} chunks injected successfully.`,
            isCause: false,
            isOk: true
        });
    }

    // Fallback if we somehow still have 0 injected and no cause found
    if (injectedCount === 0 && !diagnosis.some(d => d.isCause)) {
        diagnosis.push({
            label: 'Unknown',
            detail: 'Pipeline completed but no chunks were injected. No specific cause identified.',
            fix: `This may be a bug. Open DevTools (F12) → Console tab, look for "VectHare" errors, and report the issue with console output.`,
            isCause: true,
            isOk: false
        });
    }

    return diagnosis;
}

/**
 * Truncates text to specified length with ellipsis
 */
function truncateText(text, maxLength) {
    if (!text) return '(no text)';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

/**
 * Renders analysis of why chunks were excluded
 */
function renderExcludedAnalysis(data) {
    const initial = data.stages.initial;
    const injected = data.stages.injected;
    const excluded = initial.filter(c => !injected.some(i => i.hash === c.hash));

    if (excluded.length === 0) {
        return '';
    }

    // Categorize exclusions
    const belowThreshold = excluded.filter(c => c.score < (data.settings.threshold || 0));
    const lostToDecay = excluded.filter(c => {
        const inDecay = data.stages.afterDecay.some(d => d.hash === c.hash);
        return !inDecay && c.score >= (data.settings.threshold || 0);
    });
    const failedConditions = excluded.filter(c => {
        const inDecay = data.stages.afterDecay.some(d => d.hash === c.hash);
        const inConditions = data.stages.afterConditions.some(d => d.hash === c.hash);
        return inDecay && !inConditions;
    });
    const limitExceeded = excluded.filter(c => {
        const inConditions = data.stages.afterConditions.some(d => d.hash === c.hash);
        const inInjected = data.stages.injected.some(d => d.hash === c.hash);
        return inConditions && !inInjected;
    });

    return `
        <div class="vecthare-debug-card vecthare-debug-exclusions">
            <div class="vecthare-debug-card-header">
                <i class="fa-solid fa-filter-circle-xmark"></i>
                <span>Exclusion Analysis</span>
                <span class="vecthare-debug-exclusion-count">${excluded.length} chunks excluded</span>
            </div>
            <div class="vecthare-debug-card-body">
                <div class="vecthare-debug-exclusion-categories">
                    ${belowThreshold.length > 0 ? `
                        <div class="vecthare-debug-exclusion-category">
                            <div class="vecthare-debug-exclusion-icon vecthare-debug-exclusion-threshold">
                                <i class="fa-solid fa-less-than"></i>
                            </div>
                            <div class="vecthare-debug-exclusion-info">
                                <strong>${belowThreshold.length}</strong> below threshold
                                <small>Score < ${data.settings.threshold}</small>
                            </div>
                        </div>
                    ` : ''}
                    ${lostToDecay.length > 0 ? `
                        <div class="vecthare-debug-exclusion-category">
                            <div class="vecthare-debug-exclusion-icon vecthare-debug-exclusion-decay">
                                <i class="fa-solid fa-clock"></i>
                            </div>
                            <div class="vecthare-debug-exclusion-info">
                                <strong>${lostToDecay.length}</strong> lost to temporal decay
                                <small>Score reduced below threshold</small>
                            </div>
                        </div>
                    ` : ''}
                    ${failedConditions.length > 0 ? `
                        <div class="vecthare-debug-exclusion-category">
                            <div class="vecthare-debug-exclusion-icon vecthare-debug-exclusion-conditions">
                                <i class="fa-solid fa-code-branch"></i>
                            </div>
                            <div class="vecthare-debug-exclusion-info">
                                <strong>${failedConditions.length}</strong> failed conditions
                                <small>Chunk conditions not met</small>
                            </div>
                        </div>
                    ` : ''}
                    ${limitExceeded.length > 0 ? `
                        <div class="vecthare-debug-exclusion-category">
                            <div class="vecthare-debug-exclusion-icon vecthare-debug-exclusion-limit">
                                <i class="fa-solid fa-ban"></i>
                            </div>
                            <div class="vecthare-debug-exclusion-info">
                                <strong>${limitExceeded.length}</strong> hit injection limit
                                <small>Top K limit reached</small>
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

/**
 * Gets CSS class for score value
 */
function getScoreClass(score) {
    if (score >= 0.7) return 'vecthare-debug-score-high';
    if (score >= 0.4) return 'vecthare-debug-score-medium';
    return 'vecthare-debug-score-low';
}

/**
 * Gets human-readable time ago string
 */
function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return new Date(timestamp).toLocaleString();
}

/**
 * Escapes HTML special characters
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// DEVELOPER TRACE LOG
// ============================================================================

/**
 * Renders the full trace log for debugging
 */
function renderTraceLog(data) {
    if (!data.trace || data.trace.length === 0) {
        return '';
    }

    const startTime = data.trace[0]?.time || data.timestamp;

    return `
        <div class="vecthare-debug-card vecthare-debug-trace">
            <div class="vecthare-debug-card-header">
                <i class="fa-solid fa-terminal"></i>
                <span>Pipeline Trace Log</span>
                <button class="vecthare-debug-toggle-btn" id="vecthare_toggle_trace">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
            </div>
            <div class="vecthare-debug-card-body vecthare-debug-trace-body" id="vecthare_trace_body" style="display: none;">
                <div class="vecthare-debug-trace-list">
                    ${data.trace.map((entry, idx) => {
                        const relTime = entry.time - startTime;
                        const stageClass = getStageClass(entry.stage);
                        const detailsJson = JSON.stringify(
                            Object.fromEntries(
                                Object.entries(entry).filter(([k]) => !['time', 'stage', 'action'].includes(k))
                            ),
                            null, 2
                        );

                        return `
                            <div class="vecthare-debug-trace-entry ${stageClass}">
                                <div class="vecthare-debug-trace-time">+${relTime}ms</div>
                                <div class="vecthare-debug-trace-stage">${entry.stage}</div>
                                <div class="vecthare-debug-trace-action">${escapeHtml(entry.action)}</div>
                                ${detailsJson !== '{}' ? `
                                    <pre class="vecthare-debug-trace-details">${escapeHtml(detailsJson)}</pre>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

/**
 * Renders per-chunk fate tracking
 */
function renderChunkFates(data) {
    if (!data.chunkFates || Object.keys(data.chunkFates).length === 0) {
        return '';
    }

    const fates = Object.values(data.chunkFates);
    const dropped = fates.filter(f => f.finalFate === 'dropped');
    const injected = fates.filter(f => f.finalFate === 'injected');

    return `
        <div class="vecthare-debug-card vecthare-debug-fates">
            <div class="vecthare-debug-card-header">
                <i class="fa-solid fa-route"></i>
                <span>Chunk Fate Tracker</span>
                <span class="vecthare-debug-fate-summary">
                    <span class="vecthare-fate-injected">${injected.length} injected</span>
                    <span class="vecthare-fate-dropped">${dropped.length} dropped</span>
                </span>
                <button class="vecthare-debug-toggle-btn" id="vecthare_toggle_fates">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
            </div>
            <div class="vecthare-debug-card-body vecthare-debug-fates-body" id="vecthare_fates_body" style="display: none;">
                <div class="vecthare-debug-fates-list">
                    ${fates.map(fate => {
                        const isDropped = fate.finalFate === 'dropped';
                        const hashShort = String(fate.hash).substring(0, 12);

                        return `
                            <div class="vecthare-debug-fate-entry ${isDropped ? 'fate-dropped' : 'fate-injected'}">
                                <div class="vecthare-debug-fate-header">
                                    <span class="vecthare-debug-fate-hash" title="${fate.hash}">${hashShort}...</span>
                                    <span class="vecthare-debug-fate-result ${isDropped ? 'result-dropped' : 'result-injected'}">
                                        ${isDropped ? `✗ Dropped at ${fate.droppedAt}` : '✓ Injected'}
                                    </span>
                                </div>
                                ${isDropped && fate.finalReason ? `
                                    <div class="vecthare-debug-fate-reason">${escapeHtml(fate.finalReason)}</div>
                                ` : ''}
                                <div class="vecthare-debug-fate-journey">
                                    ${fate.stages.map(s => `
                                        <span class="vecthare-fate-stage ${s.fate === 'dropped' ? 'stage-dropped' : s.fate === 'injected' ? 'stage-injected' : 'stage-passed'}">
                                            ${s.stage}${s.fate === 'dropped' ? ' ✗' : s.fate === 'injected' ? ' ✓' : ''}
                                        </span>
                                    `).join('<span class="vecthare-fate-arrow">→</span>')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

/**
 * Gets CSS class for trace stage
 */
function getStageClass(stage) {
    const stageClasses = {
        'init': 'trace-init',
        'vector_search': 'trace-search',
        'threshold': 'trace-threshold',
        'decay': 'trace-decay',
        'conditions': 'trace-conditions',
        'injection': 'trace-injection',
        'final': 'trace-final'
    };
    return stageClasses[stage] || 'trace-default';
}

/**
 * Generates diagnostic dump for debugging
 */
function generateDiagnosticDump(data) {
    const d = data;
    const s = d.settings;
    const st = d.stages;

    // Chunk fates - readable format
    const fates = Object.values(d.chunkFates || {});
    const fatesSummary = fates.map(f => {
        const journey = f.stages.map(s => {
            const status = s.fate === 'passed' ? '✓' : s.fate === 'dropped' ? '✗' : '→';
            return `${s.stage}${status}`;
        }).join(' → ');
        const result = f.finalFate === 'dropped'
            ? `DROPPED at ${f.droppedAt}: ${f.finalReason || 'unknown'}`
            : f.finalFate === 'injected' ? 'INJECTED' : 'unknown';
        return `  [${String(f.hash).slice(0,10)}] ${journey}\n    Result: ${result}`;
    });

    // Trace - readable
    const startTime = d.trace?.[0]?.time || d.timestamp;
    const traceLines = (d.trace || []).map(t => {
        const ms = t.time - startTime;
        const details = Object.entries(t)
            .filter(([k]) => !['time', 'stage', 'action'].includes(k))
            .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join(', ');
        return `  +${String(ms).padStart(4)}ms [${t.stage.padEnd(12)}] ${t.action}${details ? '\n           ' + details : ''}`;
    });

    // Injection info - skipped duplicates (chunks already in context)
    const skippedCount = d.stats?.skippedDuplicates || 0;
    const injectionInfo = skippedCount > 0
        ? `  ${skippedCount} chunks skipped (already in current chat context)`
        : '  No chunks skipped';

    // Build human-readable dump
    const dump = `VECTHARE DEBUG DUMP
${'='.repeat(50)}
Time: ${new Date(d.timestamp).toLocaleString()}
Collection: ${d.collectionId}

SETTINGS
  Threshold: ${s.threshold}
  Top K: ${s.topK}
  Protect Messages: ${s.protect} (last ${s.protect} of ${s.chatLength} total)
  Temporal Decay: ${s.temporal_decay?.enabled ? `ON (half-life: ${s.temporal_decay.halfLife || s.temporal_decay.half_life})` : 'OFF'}

PIPELINE RESULTS
  Vector Search: ${st.initial?.length || 0} chunks retrieved
  After Threshold: ${st.afterThreshold?.length || 0} passed (threshold: ${s.threshold})
  After Decay: ${st.afterDecay?.length || 0} survived
  After Conditions: ${st.afterConditions?.length || 0} passed
  Final Injected: ${st.injected?.length || 0}

INITIAL SCORES (top 10)
  ${st.initial?.slice(0, 10).map((c, i) => {
      const parts = [`#${i+1}: ${c.score?.toFixed(3)}`];
      if (c.originalScore !== undefined && c.originalScore !== c.score) {
          parts.push(`(vector: ${c.originalScore?.toFixed(3)}`);
          if (c.keywordBoost && c.keywordBoost !== 1.0) {
              parts.push(`× ${c.keywordBoost?.toFixed(2)}x boost`);
          }
          if (c.decayMultiplier && c.decayMultiplier !== 1.0) {
              parts.push(`× ${c.decayMultiplier?.toFixed(2)} decay`);
          }
          parts.push(')');
      }
      if (c.matchedKeywordsWithWeights?.length > 0) {
          const kwStr = c.matchedKeywordsWithWeights.map(k =>
              k.weight !== 1.5 ? `${k.text}(${k.weight}x)` : k.text
          ).join(', ');
          parts.push(`[keywords: ${kwStr}]`);
      } else if (c.matchedKeywords?.length > 0) {
          parts.push(`[keywords: ${c.matchedKeywords.join(', ')}]`);
      }
      parts.push(`[${String(c.hash).slice(0,8)}]`);
      return parts.join(' ');
  }).join('\n  ') || 'none'}

INJECTION STATUS
${injectionInfo}
  Skipped: ${skippedCount} chunks (already in context)
  Injected: ${st.injected?.length || 0} chunks

CHUNK FATES
${fatesSummary.join('\n\n') || '  none'}

TRACE LOG
${traceLines.join('\n') || '  none'}

QUERY (full)
  ${d.query?.replace(/\n/g, '\n  ') || 'empty'}
${'='.repeat(50)}`;

    return dump;
}

/**
 * Copies diagnostic dump to clipboard
 */
async function copyDiagnosticDump() {
    if (!lastDebugData) {
        toastr.warning('No debug data available');
        return;
    }

    try {
        const dump = generateDiagnosticDump(lastDebugData);
        await navigator.clipboard.writeText(dump);
        toastr.success('Diagnostic dump copied to clipboard');
    } catch (err) {
        console.error('Failed to copy diagnostic:', err);
        toastr.error('Failed to copy to clipboard');
    }
}

// ============================================================================
// EVENT BINDING
// ============================================================================

function bindEvents() {
    // Close button
    $('#vecthare_search_debug_close').on('click', closeSearchDebugModal);

    // Copy diagnostic dump
    $('#vecthare_copy_diagnostic').on('click', copyDiagnosticDump);

    // Click outside to close
    $('#vecthare_search_debug_modal').on('click', function(e) {
        if (e.target === this) {
            closeSearchDebugModal();
        }
    });

    // Stage tabs
    $('.vecthare-debug-stage-tab').on('click', function() {
        const stage = $(this).data('stage');
        $('.vecthare-debug-stage-tab').removeClass('active');
        $(this).addClass('active');

        const data = lastDebugData;
        if (data && data.stages[stage]) {
            $('#vecthare_debug_stage_content').html(
                renderStageChunks(data.stages[stage], stage, data)
            );
        }
    });

    // Expand query button
    $('.vecthare-debug-expand-btn').on('click', function() {
        const target = $(this).data('target');
        $(`#vecthare_debug_${target}_full`).slideToggle();
        $(this).text($(this).text().includes('Show') ? 'Hide full query' : `Show full query (${lastDebugData.query.length} chars)`);
    });

    // Toggle trace log
    $('#vecthare_toggle_trace').on('click', function() {
        $('#vecthare_trace_body').slideToggle();
        $(this).find('i').toggleClass('fa-chevron-down fa-chevron-up');
    });

    // Toggle chunk fates
    $('#vecthare_toggle_fates').on('click', function() {
        $('#vecthare_fates_body').slideToggle();
        $(this).find('i').toggleClass('fa-chevron-down fa-chevron-up');
    });
}
