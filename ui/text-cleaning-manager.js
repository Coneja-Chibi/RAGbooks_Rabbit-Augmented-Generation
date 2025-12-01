/**
 * ============================================================================
 * VECTHARE TEXT CLEANING MANAGER
 * ============================================================================
 * Standalone UI for managing text cleaning regex patterns.
 * Accessible from the Actions panel.
 *
 * @author Coneja Chibi
 * @version 1.0.0
 * ============================================================================
 */

import { saveSettingsDebounced } from '../../../../../script.js';
import {
    BUILTIN_PATTERNS,
    CLEANING_PRESETS,
    getCleaningSettings,
    saveCleaningSettings,
    addCustomPattern,
    updateCustomPattern,
    removeCustomPattern,
    exportPatterns,
    importPatterns,
    testPattern,
} from '../core/text-cleaning.js';

/**
 * Opens the Text Cleaning Manager modal
 */
export function openTextCleaningManager() {
    // Remove existing modal if present
    $('#vecthare_text_cleaning_modal').remove();

    const settings = getCleaningSettings();

    const html = `
        <div id="vecthare_text_cleaning_modal" class="vecthare-modal">
            <div class="vecthare-modal-overlay"></div>
            <div class="vecthare-modal-content vecthare-text-cleaning-content">
                <div class="vecthare-modal-header">
                    <h3>
                        <i class="fa-solid fa-broom"></i>
                        Text Cleaning Manager
                    </h3>
                    <button class="vecthare-modal-close" id="vecthare_tcm_close">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>

                <div class="vecthare-tcm-body">
                    <p class="vecthare-tcm-intro">
                        Configure regex patterns to clean text before vectorization.
                        Patterns are applied in order to remove HTML tags, metadata, and unwanted content.
                    </p>

                    <!-- Current Preset Display -->
                    <div class="vecthare-tcm-section">
                        <div class="vecthare-tcm-section-header">
                            <h4>Active Preset</h4>
                        </div>
                        <div class="vecthare-tcm-preset-info">
                            <select id="vecthare_tcm_preset" class="vecthare-select">
                                ${Object.entries(CLEANING_PRESETS).map(([id, preset]) => `
                                    <option value="${id}" ${settings.selectedPreset === id ? 'selected' : ''}>
                                        ${preset.name}
                                    </option>
                                `).join('')}
                                <option value="custom" ${settings.selectedPreset === 'custom' ? 'selected' : ''}>
                                    Custom
                                </option>
                            </select>
                            <span class="vecthare-tcm-preset-desc" id="vecthare_tcm_preset_desc">
                                ${getPresetDescription(settings.selectedPreset)}
                            </span>
                        </div>
                    </div>

                    <!-- Built-in Patterns -->
                    <div class="vecthare-tcm-section">
                        <div class="vecthare-tcm-section-header">
                            <h4>Built-in Patterns</h4>
                            <span class="vecthare-tcm-hint">Used when preset is "Custom"</span>
                        </div>
                        <div class="vecthare-tcm-patterns-grid" id="vecthare_tcm_builtin_patterns">
                            ${Object.values(BUILTIN_PATTERNS).map(p => `
                                <label class="vecthare-tcm-pattern-item" title="${escapeHtml(p.pattern)}">
                                    <input type="checkbox" data-id="${p.id}"
                                           ${settings.enabledBuiltins?.includes(p.id) ? 'checked' : ''}>
                                    <div class="vecthare-tcm-pattern-info">
                                        <span class="vecthare-tcm-pattern-name">${p.name}</span>
                                        <code class="vecthare-tcm-pattern-regex">${escapeHtml(p.pattern.substring(0, 40))}${p.pattern.length > 40 ? '...' : ''}</code>
                                    </div>
                                </label>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Custom Patterns -->
                    <div class="vecthare-tcm-section">
                        <div class="vecthare-tcm-section-header">
                            <h4>Custom Patterns</h4>
                            <div class="vecthare-tcm-actions">
                                <button class="vecthare-btn-sm vecthare-btn-secondary" id="vecthare_tcm_add_pattern">
                                    <i class="fa-solid fa-plus"></i> Add
                                </button>
                                <button class="vecthare-btn-sm vecthare-btn-secondary" id="vecthare_tcm_import">
                                    <i class="fa-solid fa-upload"></i> Import
                                </button>
                                <button class="vecthare-btn-sm vecthare-btn-secondary" id="vecthare_tcm_export">
                                    <i class="fa-solid fa-download"></i> Export
                                </button>
                                <input type="file" id="vecthare_tcm_import_file" accept=".json" hidden>
                            </div>
                        </div>
                        <div class="vecthare-tcm-custom-list" id="vecthare_tcm_custom_patterns">
                            ${renderCustomPatterns(settings.customPatterns || [])}
                        </div>
                    </div>

                    <!-- Pattern Tester -->
                    <div class="vecthare-tcm-section">
                        <div class="vecthare-tcm-section-header">
                            <h4>Pattern Tester</h4>
                        </div>
                        <div class="vecthare-tcm-tester">
                            <div class="vecthare-tcm-tester-inputs">
                                <input type="text" id="vecthare_tcm_test_pattern" placeholder="Regex pattern" class="vecthare-input">
                                <input type="text" id="vecthare_tcm_test_flags" value="gi" placeholder="Flags" class="vecthare-input vecthare-input-xs">
                                <input type="text" id="vecthare_tcm_test_replacement" placeholder="Replacement (empty = remove)" class="vecthare-input">
                                <button class="vecthare-btn-secondary" id="vecthare_tcm_test_run">
                                    <i class="fa-solid fa-play"></i> Test
                                </button>
                            </div>
                            <textarea id="vecthare_tcm_test_input" rows="3" placeholder="Paste sample text to test against..." class="vecthare-textarea"></textarea>
                            <div class="vecthare-tcm-test-result" id="vecthare_tcm_test_result"></div>
                        </div>
                    </div>
                </div>

                <div class="vecthare-modal-footer">
                    <button class="vecthare-btn-secondary" id="vecthare_tcm_cancel">Close</button>
                    <button class="vecthare-btn-primary" id="vecthare_tcm_save">
                        <i class="fa-solid fa-save"></i> Save Changes
                    </button>
                </div>
            </div>
        </div>
    `;

    $('body').append(html);
    $('#vecthare_text_cleaning_modal').fadeIn(200);

    bindEvents();
}

/**
 * Gets preset description
 */
function getPresetDescription(presetId) {
    const descriptions = {
        none: 'No cleaning applied - text vectorized as-is',
        html_formatting: 'Removes font, color, bold/italic tags but keeps text content',
        metadata_blocks: 'Removes hidden divs and details/summary sections',
        ai_reasoning: 'Removes <thinking> and <tucao> AI reasoning tags',
        comprehensive: 'All formatting, metadata, and reasoning tags removed',
        nuclear: 'Strips ALL HTML tags - plain text only',
        custom: 'Uses your selected built-in and custom patterns',
    };
    return descriptions[presetId] || '';
}

/**
 * Renders custom patterns list
 */
function renderCustomPatterns(patterns) {
    if (!patterns || patterns.length === 0) {
        return `<div class="vecthare-tcm-empty">No custom patterns. Click "Add" or "Import" to create patterns.</div>`;
    }

    return patterns.map(p => `
        <div class="vecthare-tcm-custom-item" data-id="${p.id}">
            <input type="checkbox" class="vecthare-tcm-custom-enabled" ${p.enabled !== false ? 'checked' : ''}>
            <div class="vecthare-tcm-custom-fields">
                <input type="text" class="vecthare-tcm-custom-name" value="${escapeHtml(p.name)}" placeholder="Name">
                <input type="text" class="vecthare-tcm-custom-pattern" value="${escapeHtml(p.pattern)}" placeholder="Regex pattern">
                <input type="text" class="vecthare-tcm-custom-replacement" value="${escapeHtml(p.replacement || '')}" placeholder="Replacement">
                <input type="text" class="vecthare-tcm-custom-flags" value="${p.flags || 'gi'}" placeholder="Flags">
            </div>
            <button class="vecthare-btn-icon vecthare-btn-danger" data-action="delete" title="Delete">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

/**
 * Escapes HTML entities
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Binds event handlers
 */
function bindEvents() {
    // Close handlers
    $('#vecthare_tcm_close, #vecthare_tcm_cancel').on('click', closeModal);
    $('#vecthare_text_cleaning_modal .vecthare-modal-overlay').on('click', closeModal);

    // Preset change
    $('#vecthare_tcm_preset').on('change', function() {
        const presetId = $(this).val();
        $('#vecthare_tcm_preset_desc').text(getPresetDescription(presetId));
    });

    // Add custom pattern
    $('#vecthare_tcm_add_pattern').on('click', () => {
        const id = addCustomPattern({
            name: 'New Pattern',
            pattern: '',
            replacement: '',
            flags: 'gi',
        });

        // Refresh the list
        const settings = getCleaningSettings();
        $('#vecthare_tcm_custom_patterns').html(renderCustomPatterns(settings.customPatterns));
    });

    // Delete custom pattern
    $(document).on('click', '#vecthare_tcm_custom_patterns [data-action="delete"]', function() {
        const id = $(this).closest('.vecthare-tcm-custom-item').data('id');
        removeCustomPattern(id);

        // Refresh the list
        const settings = getCleaningSettings();
        $('#vecthare_tcm_custom_patterns').html(renderCustomPatterns(settings.customPatterns));
    });

    // Import patterns
    $('#vecthare_tcm_import').on('click', () => {
        $('#vecthare_tcm_import_file').click();
    });

    $('#vecthare_tcm_import_file').on('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const result = importPatterns(event.target.result);
            if (result.success) {
                toastr.success(`Imported ${result.count} patterns`, 'VectHare');
                const settings = getCleaningSettings();
                $('#vecthare_tcm_custom_patterns').html(renderCustomPatterns(settings.customPatterns));
            } else {
                toastr.error(`Import failed: ${result.error}`, 'VectHare');
            }
        };
        reader.readAsText(file);
        $(this).val('');
    });

    // Export patterns
    $('#vecthare_tcm_export').on('click', () => {
        const json = exportPatterns();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vecthare-cleaning-patterns.json';
        a.click();
        URL.revokeObjectURL(url);
        toastr.success('Patterns exported', 'VectHare');
    });

    // Test pattern
    $('#vecthare_tcm_test_run').on('click', () => {
        const pattern = $('#vecthare_tcm_test_pattern').val();
        const flags = $('#vecthare_tcm_test_flags').val() || 'gi';
        const replacement = $('#vecthare_tcm_test_replacement').val();
        const sampleText = $('#vecthare_tcm_test_input').val();

        if (!pattern || !sampleText) {
            toastr.warning('Enter a pattern and sample text');
            return;
        }

        const result = testPattern(pattern, flags, replacement, sampleText);
        const resultEl = $('#vecthare_tcm_test_result');

        if (result.success) {
            resultEl.html(`
                <div class="vecthare-tcm-test-success">
                    <strong>Result:</strong>
                    <pre>${escapeHtml(result.result)}</pre>
                </div>
            `);
        } else {
            resultEl.html(`
                <div class="vecthare-tcm-test-error">
                    <i class="fa-solid fa-times-circle"></i> ${escapeHtml(result.error)}
                </div>
            `);
        }
    });

    // Save changes
    $('#vecthare_tcm_save').on('click', () => {
        const settings = getCleaningSettings();

        // Get selected preset
        settings.selectedPreset = $('#vecthare_tcm_preset').val();

        // Get enabled built-ins
        settings.enabledBuiltins = [];
        $('#vecthare_tcm_builtin_patterns input:checked').each(function() {
            settings.enabledBuiltins.push($(this).data('id'));
        });

        // Get custom pattern updates
        $('#vecthare_tcm_custom_patterns .vecthare-tcm-custom-item').each(function() {
            const id = $(this).data('id');
            const update = {
                enabled: $(this).find('.vecthare-tcm-custom-enabled').is(':checked'),
                name: $(this).find('.vecthare-tcm-custom-name').val(),
                pattern: $(this).find('.vecthare-tcm-custom-pattern').val(),
                replacement: $(this).find('.vecthare-tcm-custom-replacement').val(),
                flags: $(this).find('.vecthare-tcm-custom-flags').val() || 'gi',
            };
            updateCustomPattern(id, update);
        });

        saveCleaningSettings(settings);
        saveSettingsDebounced();

        toastr.success('Text cleaning settings saved', 'VectHare');
        closeModal();
    });
}

/**
 * Closes the modal
 */
function closeModal() {
    $('#vecthare_text_cleaning_modal').fadeOut(200, function() {
        $(this).remove();
    });
}
