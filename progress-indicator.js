/**
 * RAGBooks Progress Indicator Module
 *
 * Provides visible progress tracking for chunking, summarization, and vectorization operations.
 */

// Progress state
let progressState = {
    isActive: false,
    startTime: null,
    elapsedInterval: null,
    currentStep: null,
    steps: {},
    stats: {
        chunks: 0,
        summaries: 0,
        total: 0
    },
    cancelHandler: null // Store cancel handler reference for cleanup
};

// Step configuration
const PROGRESS_STEPS = {
    parsing: {
        icon: '📚',
        label: 'Parsing & chunking',
        order: 1
    },
    chunking: {
        icon: '✂️',
        label: 'Chunks created',
        order: 2
    },
    cleaning: {
        icon: '🧹',
        label: 'Cleaning text',
        order: 3
    },
    summarizing: {
        icon: '✨',
        label: 'Generating summaries',
        order: 4
    },
    saving: {
        icon: '💾',
        label: 'Saving to database',
        order: 5
    }
};

/**
 * Show progress modal
 * @param {string} title - Main title (e.g., "Vectorizing Lorebook")
 * @param {string} subtitle - Subtitle (e.g., "World Info")
 * @param {Object} options - Optional configuration
 */
export function showProgressModal(title, subtitle = '', options = {}) {
    // Prevent multiple modals
    if (progressState.isActive) {
        console.warn('[RAGBooks Progress] Modal already active');
        return;
    }

    // Initialize state
    progressState.isActive = true;
    progressState.startTime = Date.now();
    progressState.currentStep = null;
    progressState.steps = {};
    progressState.stats = { chunks: 0, summaries: 0, total: 0 };

    // Create modal HTML
    const modalHTML = `
        <div class="ragbooks-progress-overlay" id="ragbooks-progress-overlay">
            <div class="ragbooks-progress-modal" id="ragbooks-progress-modal">
                <div class="ragbooks-progress-header">
                    <div class="ragbooks-progress-title">${title}</div>
                    ${subtitle ? `<div class="ragbooks-progress-subtitle">${subtitle}</div>` : ''}
                </div>

                <div class="ragbooks-progress-spinner"></div>

                <div class="ragbooks-progress-steps" id="ragbooks-progress-steps">
                    ${Object.entries(PROGRESS_STEPS).map(([id, step]) => `
                        <div class="ragbooks-progress-step pending" id="ragbooks-step-${id}">
                            <span class="ragbooks-progress-step-icon">${step.icon}</span>
                            <span class="ragbooks-progress-step-label">${step.label}</span>
                            <span class="ragbooks-progress-step-count" id="ragbooks-step-${id}-count"></span>
                        </div>
                    `).join('')}
                </div>

                <div class="ragbooks-progress-stats" id="ragbooks-progress-stats" style="display: none;">
                    <div class="ragbooks-progress-stat">
                        <span class="ragbooks-progress-stat-value" id="ragbooks-stat-chunks">0</span>
                        <span class="ragbooks-progress-stat-label">Chunks</span>
                    </div>
                    <div class="ragbooks-progress-stat">
                        <span class="ragbooks-progress-stat-value" id="ragbooks-stat-summaries">0</span>
                        <span class="ragbooks-progress-stat-label">Summaries</span>
                    </div>
                </div>

                <div class="ragbooks-progress-elapsed" id="ragbooks-progress-elapsed">
                    Elapsed: 0s
                </div>

                ${options.cancelable !== false ? `
                    <button class="ragbooks-progress-cancel" id="ragbooks-progress-cancel">
                        Cancel
                    </button>
                ` : ''}
            </div>
        </div>
    `;

    // Add to DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Start elapsed time counter
    startElapsedTimer();

    // Add cancel handler
    if (options.cancelable !== false && options.onCancel) {
        // Create handler and store reference for later cleanup
        const cancelHandler = () => {
            if (confirm('Are you sure you want to cancel this operation?')) {
                options.onCancel();
                hideProgressModal();
            }
        };

        progressState.cancelHandler = cancelHandler;

        const cancelBtn = document.getElementById('ragbooks-progress-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', cancelHandler);
        }
    }
}

/**
 * Update progress for a specific step
 * @param {string} stepId - Step identifier (parsing, chunking, cleaning, summarizing, saving)
 * @param {string} status - Status (active, completed, pending)
 * @param {string} count - Optional count text (e.g., "45/100")
 */
export function updateProgressStep(stepId, status, count = '') {
    if (!progressState.isActive) return;

    const stepEl = document.getElementById(`ragbooks-step-${stepId}`);
    if (!stepEl) {
        console.warn(`[RAGBooks Progress] Unknown step: ${stepId}`);
        return;
    }

    // Update step status
    stepEl.className = `ragbooks-progress-step ${status}`;
    progressState.steps[stepId] = status;
    progressState.currentStep = stepId;

    // Update count
    const countEl = document.getElementById(`ragbooks-step-${stepId}-count`);
    if (countEl) {
        countEl.textContent = count;
    }

    console.log(`[RAGBooks Progress] Step ${stepId}: ${status} ${count}`);
}

/**
 * Update statistics
 * @param {Object} stats - Stats object { chunks, summaries, total }
 */
export function updateProgressStats(stats) {
    if (!progressState.isActive) return;

    // Update state
    if (stats.chunks !== undefined) progressState.stats.chunks = stats.chunks;
    if (stats.summaries !== undefined) progressState.stats.summaries = stats.summaries;
    if (stats.total !== undefined) progressState.stats.total = stats.total;

    // Update UI
    const chunksEl = document.getElementById('ragbooks-stat-chunks');
    const summariesEl = document.getElementById('ragbooks-stat-summaries');
    const statsContainer = document.getElementById('ragbooks-progress-stats');

    if (chunksEl) chunksEl.textContent = progressState.stats.chunks;
    if (summariesEl) summariesEl.textContent = progressState.stats.summaries;

    // Show stats if we have data
    if (statsContainer && (progressState.stats.chunks > 0 || progressState.stats.summaries > 0)) {
        statsContainer.style.display = 'flex';
    }
}

/**
 * Update progress message
 * @param {string} message - Message to display
 */
export function updateProgressMessage(message) {
    if (!progressState.isActive) return;

    const subtitleEl = document.querySelector('.ragbooks-progress-subtitle');
    if (subtitleEl) {
        subtitleEl.textContent = message;
    }
}

/**
 * Show error state
 * @param {string} errorMessage - Error message to display
 */
export function showProgressError(errorMessage) {
    if (!progressState.isActive) return;

    const modalEl = document.getElementById('ragbooks-progress-modal');
    if (modalEl) {
        modalEl.classList.add('error');
    }

    // Stop spinner
    const spinnerEl = document.querySelector('.ragbooks-progress-spinner');
    if (spinnerEl) {
        spinnerEl.style.display = 'none';
    }

    // Show error message
    const stepsEl = document.getElementById('ragbooks-progress-steps');
    if (stepsEl) {
        stepsEl.insertAdjacentHTML('beforebegin', `
            <div class="ragbooks-progress-error">
                <div class="ragbooks-progress-error-title">Error occurred</div>
                <div class="ragbooks-progress-error-message">${errorMessage}</div>
            </div>
        `);
    }

    // Change cancel button to close
    const cancelBtn = document.getElementById('ragbooks-progress-cancel');
    if (cancelBtn) {
        // Remove the addEventListener cancel handler before setting onclick
        if (progressState.cancelHandler) {
            cancelBtn.removeEventListener('click', progressState.cancelHandler);
            progressState.cancelHandler = null;
        }

        cancelBtn.textContent = 'Close';
        cancelBtn.onclick = () => hideProgressModal();
    }

    stopElapsedTimer();
}

/**
 * Show success state
 * @param {string} message - Success message
 * @param {number} autoCloseDuration - Auto-close after X ms (0 = manual)
 */
export function showProgressSuccess(message, autoCloseDuration = 2000) {
    if (!progressState.isActive) return;

    const modalEl = document.getElementById('ragbooks-progress-modal');
    if (modalEl) {
        modalEl.classList.add('success');
    }

    // Hide spinner
    const spinnerEl = document.querySelector('.ragbooks-progress-spinner');
    if (spinnerEl) {
        spinnerEl.style.display = 'none';
    }

    // Show success message
    const stepsEl = document.getElementById('ragbooks-progress-steps');
    if (stepsEl) {
        stepsEl.style.display = 'none';
        stepsEl.insertAdjacentHTML('beforebegin', `
            <div class="ragbooks-progress-success">
                <div class="ragbooks-progress-success-icon">✓</div>
                <div class="ragbooks-progress-success-message">${message}</div>
            </div>
        `);
    }

    stopElapsedTimer();

    // Auto-close if duration specified
    if (autoCloseDuration > 0) {
        setTimeout(() => {
            hideProgressModal();
        }, autoCloseDuration);
    } else {
        // Change cancel button to close
        const cancelBtn = document.getElementById('ragbooks-progress-cancel');
        if (cancelBtn) {
            // Remove the addEventListener cancel handler before setting onclick
            if (progressState.cancelHandler) {
                cancelBtn.removeEventListener('click', progressState.cancelHandler);
                progressState.cancelHandler = null;
            }

            cancelBtn.textContent = 'Close';
            cancelBtn.onclick = () => hideProgressModal();
        }
    }
}

/**
 * Hide progress modal
 */
export function hideProgressModal() {
    stopElapsedTimer();

    const overlayEl = document.getElementById('ragbooks-progress-overlay');
    if (overlayEl) {
        // Fade out animation
        overlayEl.style.opacity = '0';
        setTimeout(() => {
            overlayEl.remove();
        }, 200);
    }

    progressState.isActive = false;
    progressState.startTime = null;
    progressState.currentStep = null;
    progressState.steps = {};
    progressState.stats = { chunks: 0, summaries: 0, total: 0 };
    progressState.cancelHandler = null;
}

/**
 * Check if progress modal is active
 * @returns {boolean}
 */
export function isProgressActive() {
    return progressState.isActive;
}

/**
 * Start elapsed time counter
 */
function startElapsedTimer() {
    stopElapsedTimer(); // Clear any existing timer

    progressState.elapsedInterval = setInterval(() => {
        if (!progressState.startTime) return;

        const elapsed = Math.floor((Date.now() - progressState.startTime) / 1000);
        const elapsedEl = document.getElementById('ragbooks-progress-elapsed');
        if (elapsedEl) {
            elapsedEl.textContent = `Elapsed: ${formatElapsedTime(elapsed)}`;
        }
    }, 1000);
}

/**
 * Stop elapsed time counter
 */
function stopElapsedTimer() {
    if (progressState.elapsedInterval) {
        clearInterval(progressState.elapsedInterval);
        progressState.elapsedInterval = null;
    }
}

/**
 * Format elapsed time as human-readable string
 * @param {number} seconds - Elapsed seconds
 * @returns {string} Formatted time
 */
function formatElapsedTime(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Create a progress callback function for parsing operations
 * @param {string} stepId - Step identifier
 * @param {number} total - Total items to process
 * @returns {Function} Callback function
 */
export function createParsingCallback(stepId, total) {
    return (current) => {
        updateProgressStep(stepId, 'active', `${current}/${total}`);
    };
}

/**
 * Create a progress callback function for summarization
 * @returns {Function} Callback function
 */
export function createSummarizationCallback() {
    return (current, total) => {
        updateProgressStep('summarizing', 'active', `${current}/${total}`);
        updateProgressStats({ summaries: current });
    };
}
