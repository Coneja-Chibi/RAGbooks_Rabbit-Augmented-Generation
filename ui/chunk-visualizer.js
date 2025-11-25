/**
 * ============================================================================
 * VECTHARE CHUNK VISUALIZER
 * ============================================================================
 * Modal for displaying, searching, and inspecting vector search results
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

// State
let currentResults = null;
let filteredChunks = [];

/**
 * Opens the visualizer modal with search results
 * @param {object} results Search results object
 */
export function openVisualizer(results) {
    currentResults = results;
    filteredChunks = [...results.chunks];

    renderChunks();
    $('#vecthare_visualizer_modal').fadeIn(200);
}

/**
 * Renders all chunks into the container
 */
function renderChunks() {
    const container = $('#vecthare_visualizer_content');
    container.empty();

    if (filteredChunks.length === 0) {
        container.html(renderEmptyState());
        return;
    }

    filteredChunks.forEach(chunk => {
        container.append(renderChunkCard(chunk));
    });

    updateStats();
}

/**
 * Renders a single chunk card
 * @param {object} chunk Chunk data
 * @returns {string} HTML for chunk card
 */
function renderChunkCard(chunk) {
    const scorePercent = (chunk.score * 100).toFixed(1);
    const similarityPercent = (chunk.similarity * 100).toFixed(1);

    return `
        <div class="vecthare-chunk-card" data-hash="${chunk.hash}">
            <div class="vecthare-chunk-header">
                <div class="vecthare-chunk-score-badge">${scorePercent}%</div>
                <div class="vecthare-chunk-meta">
                    <span class="vecthare-chunk-source">
                        <i class="fa-solid fa-comments"></i> Chat
                    </span>
                    <span class="vecthare-chunk-index">#${chunk.index}</span>
                </div>
            </div>
            <div class="vecthare-chunk-body">
                <div class="vecthare-chunk-text">${escapeHtml(chunk.text)}</div>
            </div>
            <div class="vecthare-chunk-footer">
                <div class="vecthare-chunk-details">
                    <span title="Raw similarity score">
                        <i class="fa-solid fa-chart-line"></i> ${similarityPercent}%
                    </span>
                    ${renderTemporalDecayInfo(chunk)}
                </div>
            </div>
        </div>
    `;
}

/**
 * Renders temporal decay information if applicable
 * @param {object} chunk Chunk data
 * @returns {string} HTML for decay info
 */
function renderTemporalDecayInfo(chunk) {
    if (!chunk.decayApplied) return '';

    const decayPercent = (chunk.decayMultiplier * 100).toFixed(1);

    return `
        <span title="Message age">
            <i class="fa-solid fa-clock"></i> ${chunk.messageAge} msgs
        </span>
        <span title="Decay multiplier applied">
            <i class="fa-solid fa-arrow-trend-down"></i> ${decayPercent}%
        </span>
    `;
}

/**
 * Filters chunks based on search text
 * @param {string} searchText Search query
 */
function filterChunks(searchText) {
    if (!searchText) {
        filteredChunks = [...currentResults.chunks];
    } else {
        const query = searchText.toLowerCase();
        filteredChunks = currentResults.chunks.filter(chunk =>
            chunk.text.toLowerCase().includes(query)
        );
    }
    renderChunks();
}

/**
 * Updates stats display
 */
function updateStats() {
    const count = filteredChunks.length;
    const total = currentResults.chunks.length;

    if (count === total) {
        $('#vecthare_visualizer_count').text(`${count} chunks`);
    } else {
        $('#vecthare_visualizer_count').text(`${count} / ${total} chunks`);
    }
}

/**
 * Initializes visualizer event handlers
 */
export function initializeVisualizer() {
    // Close buttons
    $(document).on('click', '#vecthare_visualizer_close, #vecthare_visualizer_done', () => {
        $('#vecthare_visualizer_modal').fadeOut(200);
    });

    // Overlay click to close
    $(document).on('click', '.vecthare-modal-overlay', function(e) {
        if (e.target === this) {
            $('#vecthare_visualizer_modal').fadeOut(200);
        }
    });

    // ESC key to close
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $('#vecthare_visualizer_modal').is(':visible')) {
            $('#vecthare_visualizer_modal').fadeOut(200);
        }
    });

    // Search input
    $(document).on('input', '#vecthare_visualizer_search', function() {
        filterChunks($(this).val());
    });

    console.log('VectHare: Visualizer initialized');
}

/**
 * Renders empty state when no results match
 * @returns {string} HTML for empty state
 */
function renderEmptyState() {
    return `
        <div class="vecthare-empty-state">
            <i class="fa-solid fa-magnifying-glass" style="font-size: 3em; opacity: 0.3;"></i>
            <p>No chunks match your search</p>
        </div>
    `;
}

/**
 * Escapes HTML entities
 * @param {string} text Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
