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
                                <button class="vecthare-btn-sm vecthare-btn-secondary" id="vecthare_tcm_save_template">
                                    <i class="fa-solid fa-bookmark"></i> Save Template
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
                            <div class="vecthare-tcm-tester-row">
                                <input type="text" id="vecthare_tcm_test_pattern" placeholder="Find regex (e.g. /pattern/gi)" class="vecthare-input">
                                <input type="text" id="vecthare_tcm_test_replacement" placeholder="Replace with" class="vecthare-input">
                                <button class="vecthare-btn-primary" id="vecthare_tcm_test_run">
                                    <i class="fa-solid fa-play"></i> Test
                                </button>
                            </div>
                            <textarea id="vecthare_tcm_test_input" rows="3" placeholder="Sample text to test against..." class="vecthare-textarea"></textarea>
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

    return patterns.map(p => {
        // Convert old format (pattern + flags) to /pattern/flags format if needed
        let displayPattern = p.pattern || '';
        if (displayPattern && !displayPattern.startsWith('/') && p.flags) {
            displayPattern = `/${displayPattern}/${p.flags}`;
        }

        return `
            <div class="vecthare-tcm-custom-item" data-id="${p.id}">
                <input type="checkbox" class="vecthare-tcm-custom-enabled" ${p.enabled !== false ? 'checked' : ''} title="Enable/disable">
                <input type="text" class="vecthare-tcm-custom-name" value="${escapeHtml(p.name)}" placeholder="Name">
                <input type="text" class="vecthare-tcm-custom-pattern" value="${escapeHtml(displayPattern)}" placeholder="/pattern/gi">
                <input type="text" class="vecthare-tcm-custom-replacement" value="${escapeHtml(p.replacement || '')}" placeholder="Replace with (empty = remove)">
                <button class="vecthare-btn-icon vecthare-btn-danger" data-action="delete" title="Delete">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
    }).join('');
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
 * Parses a regex string in /pattern/flags format (like ST's native regex)
 * Also accepts plain patterns (assumes 'gi' flags)
 * @param {string} input - Regex string
 * @returns {{pattern: string, flags: string}|null}
 */
function parseRegexString(input) {
    if (!input) return null;

    // Try to parse /pattern/flags format
    const match = input.match(/^\/(.+)\/([gimsuy]*)$/);
    if (match) {
        return { pattern: match[1], flags: match[2] || 'g' };
    }

    // Plain pattern - use default flags
    return { pattern: input, flags: 'gi' };
}

/**
 * Validates a regex pattern
 * @param {string} pattern
 * @param {string} flags
 * @returns {{valid: boolean, error?: string}}
 */
function validateRegex(pattern, flags) {
    try {
        new RegExp(pattern, flags);
        return { valid: true };
    } catch (e) {
        return { valid: false, error: e.message };
    }
}

/**
 * Rebinds delete handlers for custom patterns (scoped to modal, not document)
 */
function rebindDeleteHandlers() {
    // Remove old handlers and bind new ones scoped to the modal
    $('#vecthare_tcm_custom_patterns [data-action="delete"]').off('click').on('click', function() {
        const id = $(this).closest('.vecthare-tcm-custom-item').data('id');
        removeCustomPattern(id);

        // Refresh the list
        const settings = getCleaningSettings();
        $('#vecthare_tcm_custom_patterns').html(renderCustomPatterns(settings.customPatterns));
        rebindDeleteHandlers();
        saveSettingsDebounced();
    });
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
        addCustomPattern({
            name: 'New Pattern',
            pattern: '',
            replacement: '',
            flags: 'gi',
        });

        // Refresh the list
        const settings = getCleaningSettings();
        $('#vecthare_tcm_custom_patterns').html(renderCustomPatterns(settings.customPatterns));
        rebindDeleteHandlers();
        saveSettingsDebounced();
    });

    // Initial bind for delete handlers
    rebindDeleteHandlers();

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
                // Check if modal still exists before updating DOM
                if ($('#vecthare_text_cleaning_modal').length) {
                    const settings = getCleaningSettings();

                    // If template was imported, also update preset and built-in checkboxes
                    if (result.isTemplate) {
                        toastr.success(`Template "${result.templateName}" loaded (${result.count} new patterns)`, 'VectHare');

                        // Update preset dropdown
                        $('#vecthare_tcm_preset').val(settings.selectedPreset);
                        $('#vecthare_tcm_preset_desc').text(getPresetDescription(settings.selectedPreset));

                        // Update built-in pattern checkboxes
                        $('#vecthare_tcm_builtin_patterns input').each(function() {
                            const id = $(this).data('id');
                            $(this).prop('checked', settings.enabledBuiltins?.includes(id));
                        });
                    } else {
                        toastr.success(`Imported ${result.count} patterns`, 'VectHare');
                    }

                    // Update custom patterns list
                    $('#vecthare_tcm_custom_patterns').html(renderCustomPatterns(settings.customPatterns));
                    rebindDeleteHandlers();
                }
                saveSettingsDebounced();
            } else {
                toastr.error(`Import failed: ${result.error}`, 'VectHare');
            }
        };
        reader.readAsText(file);
        $(this).val('');
    });

    // Save as template (prompts for name, saves full config)
    $('#vecthare_tcm_save_template').on('click', () => {
        const templateName = prompt('Enter a name for this template:', 'My Cleaning Template');
        if (!templateName) return;

        const settings = getCleaningSettings();

        // Gather current UI state
        const currentPreset = $('#vecthare_tcm_preset').val();
        const enabledBuiltins = [];
        $('#vecthare_tcm_builtin_patterns input:checked').each(function() {
            enabledBuiltins.push($(this).data('id'));
        });

        const template = {
            name: templateName,
            version: '1.0',
            createdAt: new Date().toISOString(),
            preset: currentPreset,
            enabledBuiltins: enabledBuiltins,
            customPatterns: settings.customPatterns || [],
        };

        const json = JSON.stringify(template, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vecthare-template-${templateName.toLowerCase().replace(/\s+/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toastr.success(`Template "${templateName}" saved`, 'VectHare');
    });

    // Export patterns (custom patterns only)
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
        const rawPattern = $('#vecthare_tcm_test_pattern').val();
        const replacement = $('#vecthare_tcm_test_replacement').val();
        const sampleText = $('#vecthare_tcm_test_input').val();

        if (!rawPattern || !sampleText) {
            toastr.warning('Enter a pattern and sample text');
            return;
        }

        const parsed = parseRegexString(rawPattern);
        if (!parsed) {
            toastr.error('Invalid pattern format');
            return;
        }

        const result = testPattern(parsed.pattern, parsed.flags, replacement, sampleText);
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

        // Validate and get custom pattern updates
        let hasInvalidPattern = false;
        $('#vecthare_tcm_custom_patterns .vecthare-tcm-custom-item').each(function() {
            const id = $(this).data('id');
            const rawPattern = $(this).find('.vecthare-tcm-custom-pattern').val();
            const enabled = $(this).find('.vecthare-tcm-custom-enabled').is(':checked');

            // Parse /pattern/flags format
            const parsed = parseRegexString(rawPattern);

            // Validate regex if pattern is enabled and has content
            if (enabled && parsed) {
                const validation = validateRegex(parsed.pattern, parsed.flags);
                if (!validation.valid) {
                    hasInvalidPattern = true;
                    $(this).find('.vecthare-tcm-custom-pattern').css('border-color', 'var(--vecthare-danger)');
                    toastr.error(`Invalid regex: ${validation.error}`, 'VectHare');
                    return false; // break out of .each()
                }
            }

            // Reset border
            $(this).find('.vecthare-tcm-custom-pattern').css('border-color', '');

            const update = {
                enabled: enabled,
                name: $(this).find('.vecthare-tcm-custom-name').val(),
                pattern: parsed?.pattern || '',
                replacement: $(this).find('.vecthare-tcm-custom-replacement').val(),
                flags: parsed?.flags || 'gi',
            };
            updateCustomPattern(id, update);
        });

        if (hasInvalidPattern) {
            return; // Don't save if there's an invalid pattern
        }

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
