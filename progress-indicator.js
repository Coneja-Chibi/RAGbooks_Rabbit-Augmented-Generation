/**
 * VectHare Progress Indicator Module
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
        console.warn('[VectHare Progress] Modal already active');
        return;
    }

    // Initialize state
    progressState.isActive = true;
    progressState.startTime = Date.now();
    progressState.currentStep = null;
    progressState.steps = {};
    progressState.stats = { chunks: 0, summaries: 0, total: 0 };

    // Create modal HTML with "Glass Ring" design
    const modalHTML = `
        <div class="ragbooks-progress-overlay" id="ragbooks-progress-overlay">
            <div class="ragbooks-progress-modal" id="ragbooks-progress-modal">
                <!-- Header -->
                <div class="ragbooks-progress-header">
                    <div class="ragbooks-progress-title">${title}</div>
                    ${subtitle ? `<div class="ragbooks-progress-subtitle">${subtitle}</div>` : ''}
                </div>

                <!-- Hero Ring -->
                <div class="ragbooks-ring-container indeterminate" id="ragbooks-ring-container">
                    <svg class="ragbooks-ring-svg" viewBox="0 0 160 160">
                        <circle class="ragbooks-ring-bg" cx="80" cy="80" r="72"></circle>
                        <circle class="ragbooks-ring-progress" id="ragbooks-ring-progress" cx="80" cy="80" r="72"></circle>
                    </svg>
                    <div class="ragbooks-ring-content">
                        <i class="fa-solid fa-bolt ragbooks-ring-icon" id="ragbooks-ring-icon"></i>
                        <span class="ragbooks-ring-text" id="ragbooks-ring-status">Working</span>
                    </div>
                </div>

                <!-- Active Step Label -->
                <div class="rag-active-step-label" id="ragbooks-active-step-label">
                    Initializing...
                </div>
                <div class="rag-step-counter" id="ragbooks-step-counter"></div>

                <!-- Dot Steps -->
                <div class="ragbooks-progress-steps" id="ragbooks-progress-steps">
                    ${Object.keys(PROGRESS_STEPS).map((id) => `
                        <div class="rag-step-dot" id="ragbooks-step-${id}" title="${PROGRESS_STEPS[id].label}"></div>
                    `).join('')}
                </div>

                <!-- Stats Cards -->
                <div class="ragbooks-progress-stats" id="ragbooks-progress-stats" style="display: none;">
                    <div class="rag-stat-card">
                        <span class="rag-stat-val" id="ragbooks-stat-chunks">0</span>
                        <span class="rag-stat-label">Chunks</span>
                    </div>
                    <div class="rag-stat-card">
                        <span class="rag-stat-val" id="ragbooks-stat-summaries">0</span>
                        <span class="rag-stat-label">Summaries</span>
                    </div>
                </div>

                <!-- Footer -->
                <div class="ragbooks-progress-footer">
                    ${options.cancelable !== false ? `
                        <button class="rag-cancel-btn" id="ragbooks-progress-cancel">Cancel</button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    // Add to DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Add cancel handler
    if (options.cancelable !== false && options.onCancel) {
        const cancelHandler = () => {
            if (confirm('Are you sure you want to cancel this operation?')) {
                options.onCancel();
                hideProgressModal();
            }
        };
        progressState.cancelHandler = cancelHandler;
        const cancelBtn = document.getElementById('ragbooks-progress-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', cancelHandler);
    }
}

/**
 * Update progress for a specific step
 */
export function updateProgressStep(stepId, status, count = '') {
    if (!progressState.isActive) return;

    const stepEl = document.getElementById(`ragbooks-step-${stepId}`);
    if (!stepEl) return; // Unknown step

    // Update dot visual
    if (status === 'active') {
        stepEl.className = 'rag-step-dot active';
        // Update central label
        const labelEl = document.getElementById('ragbooks-active-step-label');
        if (labelEl) labelEl.innerHTML = `<i class="fa-solid ${PROGRESS_STEPS[stepId].icon}"></i> ${PROGRESS_STEPS[stepId].label}`;
        
        // Update ring status text
        const ringText = document.getElementById('ragbooks-ring-status');
        if (ringText) ringText.textContent = stepId.toUpperCase();

    } else if (status === 'completed') {
        stepEl.className = 'rag-step-dot completed';
    } else {
        stepEl.className = 'rag-step-dot';
    }

    progressState.steps[stepId] = status;
    progressState.currentStep = stepId;

    // Update counter text
    const counterEl = document.getElementById('ragbooks-step-counter');
    if (counterEl && count) {
        counterEl.textContent = count;
    }
}

/**
 * Update statistics
 */
export function updateProgressStats(stats) {
    if (!progressState.isActive) return;

    if (stats.chunks !== undefined) progressState.stats.chunks = stats.chunks;
    if (stats.summaries !== undefined) progressState.stats.summaries = stats.summaries;

    const chunksEl = document.getElementById('ragbooks-stat-chunks');
    const summariesEl = document.getElementById('ragbooks-stat-summaries');
    const statsContainer = document.getElementById('ragbooks-progress-stats');

    if (chunksEl) chunksEl.textContent = progressState.stats.chunks;
    if (summariesEl) summariesEl.textContent = progressState.stats.summaries;

    if (statsContainer && (progressState.stats.chunks > 0 || progressState.stats.summaries > 0)) {
        statsContainer.style.display = 'grid';
    }
    
    // Calculate determinate progress if total is known
    if (stats.total > 0 && stats.current > 0) {
        const container = document.getElementById('ragbooks-ring-container');
        const circle = document.getElementById('ragbooks-ring-progress');
        
        if (container && circle) {
            container.classList.remove('indeterminate');
            const percent = stats.current / stats.total;
            const dashOffset = 339.292 * (1 - percent);
            circle.style.strokeDashoffset = dashOffset;
        }
    }
}

/**
 * Update progress message (Renamed for cache busting)
 * @param {string} message - Message to display
 */
export function updateProgressMessageText(message) {
    if (!progressState.isActive) return;

    const subtitleEl = document.querySelector('.ragbooks-progress-subtitle');
    if (subtitleEl) {
        subtitleEl.textContent = message;
    }
}

/**
 * Show error state
 */
export function showProgressError(errorMessage) {
    if (!progressState.isActive) return;

    const modalEl = document.getElementById('ragbooks-progress-modal');
    if (modalEl) modalEl.classList.add('error');

    // Update ring
    const ringContainer = document.getElementById('ragbooks-ring-container');
    const ringIcon = document.getElementById('ragbooks-ring-icon');
    const ringText = document.getElementById('ragbooks-ring-status');
    
    if (ringContainer) ringContainer.classList.remove('indeterminate');
    if (ringIcon) {
        ringIcon.className = 'fa-solid fa-triangle-exclamation ragbooks-ring-icon';
        ringIcon.style.color = '#ef4444';
        ringIcon.style.animation = 'none';
    }
    if (ringText) {
        ringText.textContent = 'Error';
        ringText.style.color = '#ef4444';
    }

    // Insert error message
    const stepsEl = document.getElementById('ragbooks-progress-steps');
    if (stepsEl) {
        stepsEl.style.display = 'none';
        stepsEl.insertAdjacentHTML('beforebegin', `
            <div class="rag-result-msg error">
                ${errorMessage}
            </div>
        `);
    }

    // Update button
    const cancelBtn = document.getElementById('ragbooks-progress-cancel');
    if (cancelBtn) {
        if (progressState.cancelHandler) {
            cancelBtn.removeEventListener('click', progressState.cancelHandler);
        }
        cancelBtn.textContent = 'Close';
        cancelBtn.onclick = () => hideProgressModal();
    }
}

/**
 * Show success state
 */
export function showProgressSuccess(message, autoCloseDuration = 2000) {
    if (!progressState.isActive) return;

    const modalEl = document.getElementById('ragbooks-progress-modal');
    if (modalEl) modalEl.classList.add('success');

    // Update ring to full green
    const ringContainer = document.getElementById('ragbooks-ring-container');
    const ringProgress = document.getElementById('ragbooks-ring-progress');
    const ringIcon = document.getElementById('ragbooks-ring-icon');
    const ringText = document.getElementById('ragbooks-ring-status');

    if (ringContainer) ringContainer.classList.remove('indeterminate');
    if (ringProgress) ringProgress.style.strokeDashoffset = 0;
    
    if (ringIcon) {
        ringIcon.className = 'fa-solid fa-check ragbooks-ring-icon';
        ringIcon.style.color = '#10b981';
        ringIcon.style.animation = 'none';
    }
    if (ringText) {
        ringText.textContent = 'Complete';
        ringText.style.color = '#10b981';
    }

    // Update message
    const stepsEl = document.getElementById('ragbooks-progress-steps');
    if (stepsEl) {
        stepsEl.style.display = 'none'; // Hide steps list
        stepsEl.insertAdjacentHTML('beforebegin', `
            <div class="rag-result-msg success">
                ${message}
            </div>
        `);
    }

    if (autoCloseDuration > 0) {
        setTimeout(() => hideProgressModal(), autoCloseDuration);
    } else {
        const cancelBtn = document.getElementById('ragbooks-progress-cancel');
        if (cancelBtn) {
            if (progressState.cancelHandler) cancelBtn.removeEventListener('click', progressState.cancelHandler);
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