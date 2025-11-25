/**
 * ============================================================================
 * VECTHARE PROGRESS TRACKER
 * ============================================================================
 * Real-time progress panel for vectorization operations
 * Shows detailed status, progress bars, and live updates
 *
 * @author VectHare
 * @version 2.0.0-alpha
 * ============================================================================
 */

/**
 * Progress Tracker - Manages progress panel UI
 */
export class ProgressTracker {
    constructor() {
        this.panel = null;
        this.isVisible = false;
        this.currentOperation = null;
        this.stats = {
            totalItems: 0,
            processedItems: 0,
            currentBatch: 0,
            totalBatches: 0,
            startTime: null,
            errors: [],
        };
    }

    /**
     * Show progress panel
     * @param {string} operation - Operation name (e.g., "Vectorizing Chat", "Purging Index")
     * @param {number} totalItems - Total number of items to process
     */
    show(operation, totalItems = 0) {
        this.currentOperation = operation;
        this.stats = {
            totalItems: totalItems,
            processedItems: 0,
            currentBatch: 0,
            totalBatches: 0,
            startTime: Date.now(),
            errors: [],
        };

        if (!this.panel) {
            this.createPanel();
        }

        this.updateDisplay();
        this.panel.style.display = 'block';
        this.isVisible = true;
    }

    /**
     * Hide progress panel
     */
    hide() {
        if (this.panel) {
            this.panel.style.display = 'none';
        }
        this.isVisible = false;
        this.currentOperation = null;
    }

    /**
     * Update progress
     * @param {number} processedItems - Number of items processed so far
     * @param {string} status - Current status message
     */
    updateProgress(processedItems, status = '') {
        this.stats.processedItems = processedItems;
        this.updateDisplay(status);
    }

    /**
     * Update batch progress
     * @param {number} currentBatch - Current batch number
     * @param {number} totalBatches - Total number of batches
     */
    updateBatch(currentBatch, totalBatches) {
        this.stats.currentBatch = currentBatch;
        this.stats.totalBatches = totalBatches;
        this.updateDisplay();
    }

    /**
     * Add error to tracker
     * @param {string} error - Error message
     */
    addError(error) {
        this.stats.errors.push({
            message: error,
            timestamp: Date.now(),
        });
        this.updateDisplay();
    }

    /**
     * Complete operation
     * @param {boolean} success - Whether operation succeeded
     * @param {string} message - Completion message
     */
    complete(success, message = '') {
        const duration = Date.now() - this.stats.startTime;
        const seconds = (duration / 1000).toFixed(1);

        const completionMessage = success
            ? `✅ ${message || 'Operation completed successfully'} (${seconds}s)`
            : `❌ ${message || 'Operation failed'} (${seconds}s)`;

        this.updateDisplay(completionMessage);

        // Don't auto-hide - let user close manually
    }

    /**
     * Create progress panel HTML
     */
    createPanel() {
        const panelHTML = `
            <div id="vecthare_progress_panel" class="vecthare-progress-panel">
                <div class="vecthare-progress-header">
                    <h3 id="vecthare_progress_title">VectHare Progress</h3>
                    <button id="vecthare_progress_close" class="vecthare-progress-close">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="vecthare-progress-body">
                    <!-- Main Progress Bar -->
                    <div class="vecthare-progress-section">
                        <div class="vecthare-progress-label">
                            <span id="vecthare_progress_status">Initializing...</span>
                            <span id="vecthare_progress_percent">0%</span>
                        </div>
                        <div class="vecthare-progress-bar-container">
                            <div id="vecthare_progress_bar" class="vecthare-progress-bar" style="width: 0%"></div>
                        </div>
                    </div>

                    <!-- Stats Grid -->
                    <div class="vecthare-progress-stats">
                        <div class="vecthare-progress-stat">
                            <div class="vecthare-progress-stat-label">Processed</div>
                            <div id="vecthare_progress_processed" class="vecthare-progress-stat-value">0 / 0</div>
                        </div>
                        <div class="vecthare-progress-stat">
                            <div class="vecthare-progress-stat-label">Batch</div>
                            <div id="vecthare_progress_batch" class="vecthare-progress-stat-value">0 / 0</div>
                        </div>
                        <div class="vecthare-progress-stat">
                            <div class="vecthare-progress-stat-label">Time</div>
                            <div id="vecthare_progress_time" class="vecthare-progress-stat-value">0.0s</div>
                        </div>
                        <div class="vecthare-progress-stat">
                            <div class="vecthare-progress-stat-label">Speed</div>
                            <div id="vecthare_progress_speed" class="vecthare-progress-stat-value">0/s</div>
                        </div>
                    </div>

                    <!-- Errors (hidden by default) -->
                    <div id="vecthare_progress_errors" class="vecthare-progress-errors" style="display: none;">
                        <div class="vecthare-progress-errors-header">
                            <i class="fa-solid fa-exclamation-triangle"></i>
                            <span>Errors</span>
                        </div>
                        <div id="vecthare_progress_errors_list" class="vecthare-progress-errors-list"></div>
                    </div>
                </div>
            </div>
        `;

        // Insert panel into DOM
        const container = document.createElement('div');
        container.innerHTML = panelHTML;
        document.body.appendChild(container.firstElementChild);

        this.panel = document.getElementById('vecthare_progress_panel');

        // Bind close button
        document.getElementById('vecthare_progress_close').addEventListener('click', () => {
            this.hide();
        });

        // Start time update interval
        this.startTimeUpdater();
    }

    /**
     * Update display with current stats
     * @param {string} statusOverride - Override status message
     */
    updateDisplay(statusOverride = '') {
        if (!this.panel || !this.isVisible) return;

        const percent = this.stats.totalItems > 0
            ? Math.round((this.stats.processedItems / this.stats.totalItems) * 100)
            : 0;

        // Update title
        document.getElementById('vecthare_progress_title').textContent = this.currentOperation || 'VectHare Progress';

        // Update status
        const status = statusOverride || this.generateStatusMessage();
        document.getElementById('vecthare_progress_status').textContent = status;

        // Update progress bar
        document.getElementById('vecthare_progress_percent').textContent = `${percent}%`;
        document.getElementById('vecthare_progress_bar').style.width = `${percent}%`;

        // Update stats
        document.getElementById('vecthare_progress_processed').textContent =
            `${this.stats.processedItems} / ${this.stats.totalItems}`;

        document.getElementById('vecthare_progress_batch').textContent =
            `${this.stats.currentBatch} / ${this.stats.totalBatches}`;

        // Calculate speed
        const elapsed = (Date.now() - this.stats.startTime) / 1000;
        const speed = elapsed > 0 ? (this.stats.processedItems / elapsed).toFixed(1) : '0.0';
        document.getElementById('vecthare_progress_speed').textContent = `${speed}/s`;

        // Show/hide errors
        if (this.stats.errors.length > 0) {
            this.updateErrorsList();
            document.getElementById('vecthare_progress_errors').style.display = 'block';
        }
    }

    /**
     * Generate status message based on current state
     */
    generateStatusMessage() {
        if (this.stats.processedItems === 0) {
            return 'Starting...';
        } else if (this.stats.processedItems >= this.stats.totalItems) {
            return 'Finalizing...';
        } else if (this.stats.totalBatches > 0) {
            return `Processing batch ${this.stats.currentBatch}/${this.stats.totalBatches}`;
        } else {
            return `Processing items...`;
        }
    }

    /**
     * Update errors list display
     */
    updateErrorsList() {
        const errorsList = document.getElementById('vecthare_progress_errors_list');
        errorsList.innerHTML = this.stats.errors
            .map(err => `<div class="vecthare-progress-error-item">${err.message}</div>`)
            .join('');
    }

    /**
     * Start interval to update elapsed time
     */
    startTimeUpdater() {
        setInterval(() => {
            if (this.isVisible && this.stats.startTime) {
                const elapsed = ((Date.now() - this.stats.startTime) / 1000).toFixed(1);
                document.getElementById('vecthare_progress_time').textContent = `${elapsed}s`;
            }
        }, 100);
    }
}

// Export singleton instance
export const progressTracker = new ProgressTracker();
