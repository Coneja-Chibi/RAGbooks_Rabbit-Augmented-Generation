// =============================================================================
// ADVANCED SETTINGS BUILDER
// Reusable UI components for consistent settings across all source types
// =============================================================================

/**
 * Builds summarization controls for a given source type
 * @param {string} sourceType - Source type identifier (lorebook, character, url, custom, chat)
 * @param {Object} defaults - Default values for settings
 * @returns {string} HTML string for summarization controls
 */
export function buildSummarizationControls(sourceType, defaults = {}) {
    const {
        enabled = false,
        summaryStyle = 'concise',
        perChunkControl = false
    } = defaults;

    return `
        <!-- Summarization Settings -->
        <div class="ragbooks-setting-item">
            <label class="ragbooks-toggle">
                <input type="checkbox" id="ragbooks_${sourceType}_summarize_chunks" ${enabled ? 'checked' : ''}>
                <span class="ragbooks-toggle-slider"></span>
                <span class="ragbooks-toggle-label">📝 Summarize Chunks</span>
            </label>
            <div class="ragbooks-help-text">Generate AI summaries for better semantic matching (dual-vector search: summary + content)</div>
        </div>

        <div id="ragbooks_${sourceType}_summary_settings" style="${enabled ? '' : 'display: none;'}">
            <div class="ragbooks-setting-item">
                <label class="ragbooks-label">
                    <span class="ragbooks-label-text">Summary Style</span>
                </label>
                <select id="ragbooks_${sourceType}_summary_style" class="ragbooks-select">
                    <option value="concise" ${summaryStyle === 'concise' ? 'selected' : ''}>Concise (1-2 sentences)</option>
                    <option value="detailed" ${summaryStyle === 'detailed' ? 'selected' : ''}>Detailed (paragraph)</option>
                    <option value="keywords" ${summaryStyle === 'keywords' ? 'selected' : ''}>Keywords Only</option>
                    <option value="extractive" ${summaryStyle === 'extractive' ? 'selected' : ''}>Extractive (key quotes)</option>
                </select>
                <div class="ragbooks-help-text">How the AI should summarize each chunk</div>
            </div>

            <!-- Per-Chunk Control -->
            <div class="ragbooks-setting-item">
                <label class="ragbooks-toggle">
                    <input type="checkbox" id="ragbooks_${sourceType}_per_chunk_summary" ${perChunkControl ? 'checked' : ''}>
                    <span class="ragbooks-toggle-slider"></span>
                    <span class="ragbooks-toggle-label">🎯 Per-Chunk Summary Control</span>
                </label>
                <div class="ragbooks-help-text">Allow individual chunks to have summarization toggled on/off after vectorization</div>
            </div>
        </div>
    `;
}

/**
 * Builds metadata extraction controls for a given source type
 * @param {string} sourceType - Source type identifier
 * @param {Object} defaults - Default values for settings
 * @returns {string} HTML string for metadata extraction controls
 */
export function buildMetadataControls(sourceType, defaults = {}) {
    const {
        enabled = true,
        perChunkControl = false
    } = defaults;

    return `
        <!-- Metadata Extraction -->
        <div class="ragbooks-setting-item">
            <label class="ragbooks-toggle">
                <input type="checkbox" id="ragbooks_${sourceType}_extract_metadata" ${enabled ? 'checked' : ''}>
                <span class="ragbooks-toggle-slider"></span>
                <span class="ragbooks-toggle-label">🏷️ Extract Metadata</span>
            </label>
            <div class="ragbooks-help-text">Extract names, locations, topics from content for enhanced search</div>
        </div>

        <div id="ragbooks_${sourceType}_metadata_settings" style="${enabled ? '' : 'display: none;'}">
            <!-- Per-Chunk Metadata Control -->
            <div class="ragbooks-setting-item">
                <label class="ragbooks-toggle">
                    <input type="checkbox" id="ragbooks_${sourceType}_per_chunk_metadata" ${perChunkControl ? 'checked' : ''}>
                    <span class="ragbooks-toggle-slider"></span>
                    <span class="ragbooks-toggle-label">🎯 Per-Chunk Metadata Control</span>
                </label>
                <div class="ragbooks-help-text">Allow individual chunks to have metadata extraction toggled on/off after vectorization</div>
            </div>
        </div>
    `;
}

/**
 * Builds the event handlers for summarization toggle
 * This should be called after the form is inserted into the DOM
 * @param {string} sourceType - Source type identifier
 */
export function bindSummarizationHandlers(sourceType) {
    $(`#ragbooks_${sourceType}_summarize_chunks`).on('change', function() {
        const isEnabled = $(this).is(':checked');
        if (isEnabled) {
            $(`#ragbooks_${sourceType}_summary_settings`).slideDown(200);
        } else {
            $(`#ragbooks_${sourceType}_summary_settings`).slideUp(200);
        }
    });
}

/**
 * Builds the event handlers for metadata extraction toggle
 * This should be called after the form is inserted into the DOM
 * @param {string} sourceType - Source type identifier
 */
export function bindMetadataHandlers(sourceType) {
    $(`#ragbooks_${sourceType}_extract_metadata`).on('change', function() {
        const isEnabled = $(this).is(':checked');
        if (isEnabled) {
            $(`#ragbooks_${sourceType}_metadata_settings`).slideDown(200);
        } else {
            $(`#ragbooks_${sourceType}_metadata_settings`).slideUp(200);
        }
    });
}

/**
 * Collects summarization settings from the UI for a given source type
 * @param {string} sourceType - Source type identifier
 * @returns {Object} Summarization settings
 */
export function collectSummarizationSettings(sourceType) {
    return {
        summarizeChunks: $(`#ragbooks_${sourceType}_summarize_chunks`).is(':checked'),
        summaryStyle: $(`#ragbooks_${sourceType}_summary_style`).val() || 'concise',
        perChunkSummaryControl: $(`#ragbooks_${sourceType}_per_chunk_summary`).is(':checked')
    };
}

/**
 * Collects metadata extraction settings from the UI for a given source type
 * @param {string} sourceType - Source type identifier
 * @returns {Object} Metadata extraction settings
 */
export function collectMetadataSettings(sourceType) {
    return {
        extractMetadata: $(`#ragbooks_${sourceType}_extract_metadata`).is(':checked'),
        perChunkMetadataControl: $(`#ragbooks_${sourceType}_per_chunk_metadata`).is(':checked')
    };
}

/**
 * Builds per-chunk editor controls
 * Used in the chunk editor modal
 * @param {Object} chunk - The chunk being edited
 * @returns {string} HTML string for per-chunk controls
 */
export function buildPerChunkEditorControls(chunk) {
    const enableSummary = chunk.metadata?.enableSummary ?? false;
    const enableMetadata = chunk.metadata?.enableMetadata ?? true;

    return `
        <div class="ragbooks-setting-item">
            <label class="ragbooks-toggle">
                <input type="checkbox" id="ragbooks_chunk_enable_summary" ${enableSummary ? 'checked' : ''}>
                <span class="ragbooks-toggle-slider"></span>
                <span class="ragbooks-toggle-label">📝 Enable Summary for This Chunk</span>
            </label>
            <div class="ragbooks-help-text">Generate and use AI summary when searching (improves semantic matching)</div>
        </div>

        <div class="ragbooks-setting-item">
            <label class="ragbooks-toggle">
                <input type="checkbox" id="ragbooks_chunk_enable_metadata" ${enableMetadata ? 'checked' : ''}>
                <span class="ragbooks-toggle-slider"></span>
                <span class="ragbooks-toggle-label">🏷️ Enable Metadata for This Chunk</span>
            </label>
            <div class="ragbooks-help-text">Extract and use metadata (names, locations, topics) for enhanced search</div>
        </div>
    `;
}

/**
 * Collects per-chunk settings from the chunk editor modal
 * @returns {Object} Per-chunk settings
 */
export function collectPerChunkEditorSettings() {
    return {
        enableSummary: $('#ragbooks_chunk_enable_summary').is(':checked'),
        enableMetadata: $('#ragbooks_chunk_enable_metadata').is(':checked')
    };
}

export default {
    buildSummarizationControls,
    buildMetadataControls,
    bindSummarizationHandlers,
    bindMetadataHandlers,
    collectSummarizationSettings,
    collectMetadataSettings,
    buildPerChunkEditorControls,
    collectPerChunkEditorSettings
};
