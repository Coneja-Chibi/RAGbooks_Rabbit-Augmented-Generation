/**
 * ============================================================================
 * VECTHARE SCENES PANEL
 * ============================================================================
 * Modal panel for managing scenes - view, edit, delete scenes with
 * collapsible cards showing title, summary, and preview.
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import {
    getScenes,
    getSceneStats,
    updateScene,
    deleteScene,
    clearAllScenes,
} from '../core/scenes.js';
import { getContext } from '../../../../extensions.js';
import { eventSource } from '../../../../../script.js';

// ============================================================================
// STATE
// ============================================================================

let isPanelOpen = false;
let cachedScenes = [];

// ============================================================================
// HELPERS
// ============================================================================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Gets preview text for a scene
 * @param {object} scene
 * @returns {string}
 */
function getScenePreview(scene) {
    const context = getContext();
    const chat = context.chat || [];

    if (scene.end === null) {
        return '(Scene is still open)';
    }

    const messages = chat.slice(scene.start, scene.end + 1);
    const previewMessages = messages
        .filter(m => m.mes && !m.is_system)
        .slice(0, 3)
        .map(m => `${m.name}: ${m.mes.substring(0, 100)}${m.mes.length > 100 ? '...' : ''}`);

    if (previewMessages.length === 0) {
        return '(No messages)';
    }

    let preview = previewMessages.join('\n');
    if (messages.length > 3) {
        preview += `\n... and ${messages.length - 3} more messages`;
    }

    return preview;
}

// ============================================================================
// RENDER
// ============================================================================

/**
 * Renders a single scene card
 * @param {object} scene
 * @param {number} index
 * @returns {string}
 */
function renderSceneCard(scene, index) {
    const isOpen = scene.end === null;
    const rangeText = isOpen
        ? `#${scene.start} - open`
        : `#${scene.start} - #${scene.end}`;
    const messageCount = isOpen ? '?' : (scene.end - scene.start + 1);
    const statusClass = isOpen ? 'vecthare-scene-badge-open' : 'vecthare-scene-badge-closed';
    const statusText = isOpen ? 'Open' : 'Closed';
    const displayTitle = scene.title || `Scene ${index + 1}`;
    const preview = getScenePreview(scene);

    return `
        <div class="vecthare-scene-card" data-scene-hash="${scene.hash}" data-scene-index="${index}">
            <div class="vecthare-scene-card-header">
                <div class="vecthare-scene-card-title">
                    <i class="fa-solid fa-chevron-right vecthare-scene-expand-icon"></i>
                    <span class="vecthare-scene-display-title">${escapeHtml(displayTitle)}</span>
                    <span class="vecthare-scene-card-range">${rangeText}</span>
                </div>
                <div class="vecthare-scene-card-status">
                    <span class="vecthare-scene-badge ${statusClass}">${statusText}</span>
                    <div class="vecthare-scene-card-actions">
                        <button class="vecthare-scene-card-btn vecthare-scene-jump" title="Jump to scene">
                            <i class="fa-solid fa-arrow-right"></i>
                        </button>
                        <button class="vecthare-scene-card-btn danger vecthare-scene-delete" title="Delete scene">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div class="vecthare-scene-card-body">
                <div class="vecthare-scene-field">
                    <label>Title</label>
                    <input type="text" class="vecthare-scene-title-input"
                           value="${escapeHtml(scene.title)}"
                           placeholder="Scene ${index + 1}">
                </div>
                <div class="vecthare-scene-field">
                    <label>Summary (for vector search)</label>
                    <textarea class="vecthare-scene-summary-input"
                              placeholder="Brief description of what happens in this scene...">${escapeHtml(scene.summary)}</textarea>
                </div>
                <div class="vecthare-scene-field">
                    <label>Preview (${messageCount} messages)</label>
                    <div class="vecthare-scene-preview">${escapeHtml(preview)}</div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Renders the scenes panel content
 * @param {object[]} scenes - Pre-loaded scenes array
 * @param {object} stats - Pre-loaded stats object
 * @returns {string}
 */
function renderPanelContent(scenes, stats) {
    let bodyContent = '';

    if (scenes.length === 0) {
        bodyContent = `
            <div class="vecthare-scenes-empty">
                <i class="fa-solid fa-film"></i>
                <p>No scenes marked yet</p>
                <p style="font-size: 0.9em; margin-top: 8px;">
                    Use the <i class="fa-solid fa-flag" style="color: var(--vecthare-success);"></i> flag buttons on messages to mark scene boundaries
                </p>
            </div>
        `;
    } else {
        bodyContent = scenes.map((scene, idx) => renderSceneCard(scene, idx)).join('');
    }

    const statsText = scenes.length > 0
        ? `${stats.total} scene${stats.total !== 1 ? 's' : ''} (${stats.closed} closed, ${stats.open} open)`
        : 'No scenes';

    return `
        <div class="vecthare-scenes-panel" id="vecthare_scenes_panel">
            <div class="vecthare-scenes-header">
                <div class="vecthare-scenes-title">
                    <i class="fa-solid fa-film"></i>
                    <span>Scene Manager</span>
                </div>
                <button class="vecthare-scenes-close" id="vecthare_scenes_close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="vecthare-scenes-body" id="vecthare_scenes_body">
                ${bodyContent}
            </div>
            <div class="vecthare-scenes-footer">
                <span class="vecthare-scenes-stats">${statsText}</span>
                <div class="vecthare-scenes-footer-actions">
                    ${scenes.length > 0 ? `
                        <button class="menu_button" id="vecthare_scenes_clear_all">
                            <i class="fa-solid fa-trash"></i> Clear All
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
        <div class="vecthare-scenes-overlay" id="vecthare_scenes_overlay"></div>
    `;
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function bindEvents() {
    const $panel = $('#vecthare_scenes_panel');

    // Close panel
    $('#vecthare_scenes_close, #vecthare_scenes_overlay').on('click', closePanel);

    // Expand/collapse cards
    $panel.on('click', '.vecthare-scene-card-header', function(e) {
        // Don't toggle if clicking action buttons
        if ($(e.target).closest('.vecthare-scene-card-actions').length) return;

        const $card = $(this).closest('.vecthare-scene-card');
        $card.toggleClass('expanded');

        // Rotate icon
        const $icon = $card.find('.vecthare-scene-expand-icon');
        if ($card.hasClass('expanded')) {
            $icon.css('transform', 'rotate(90deg)');
        } else {
            $icon.css('transform', 'rotate(0deg)');
        }
    });

    // Jump to scene
    $panel.on('click', '.vecthare-scene-jump', function(e) {
        e.stopPropagation();
        const $card = $(this).closest('.vecthare-scene-card');
        const sceneIndex = parseInt($card.data('scene-index'));
        const scene = cachedScenes[sceneIndex];

        if (scene) {
            // Scroll to message
            const $message = $(`.mes[mesid="${scene.start}"]`);
            if ($message.length) {
                $message[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Brief highlight
                $message.addClass('flash');
                setTimeout(() => $message.removeClass('flash'), 1000);
                toastr.info(`Jumped to Scene ${sceneIndex + 1} (message #${scene.start})`);
            }
        }
    });

    // Delete scene
    $panel.on('click', '.vecthare-scene-delete', async function(e) {
        e.stopPropagation();
        const $card = $(this).closest('.vecthare-scene-card');
        const sceneHash = $card.data('scene-hash');
        const sceneIndex = parseInt($card.data('scene-index'));

        if (confirm(`Delete Scene ${sceneIndex + 1}? This cannot be undone.`)) {
            const result = await deleteScene(sceneHash);
            if (result) {
                toastr.success('Scene deleted');
                await refreshPanel();
                eventSource.emit('vecthare_scenes_changed');
            } else {
                toastr.error('Failed to delete scene');
            }
        }
    });

    // Update title (debounced)
    let titleDebounce = null;
    $panel.on('input', '.vecthare-scene-title-input', function() {
        const $card = $(this).closest('.vecthare-scene-card');
        const sceneHash = $card.data('scene-hash');
        const sceneIndex = parseInt($card.data('scene-index'));
        const title = $(this).val();

        // Update display title in header immediately
        const displayTitle = title || `Scene ${sceneIndex + 1}`;
        $card.find('.vecthare-scene-display-title').text(displayTitle);

        // Debounce the save
        clearTimeout(titleDebounce);
        titleDebounce = setTimeout(async () => {
            await updateScene(sceneHash, { title });
        }, 500);
    });

    // Update summary (debounced)
    let summaryDebounce = null;
    $panel.on('input', '.vecthare-scene-summary-input', function() {
        const $card = $(this).closest('.vecthare-scene-card');
        const sceneHash = $card.data('scene-hash');
        const summary = $(this).val();

        // Debounce the save
        clearTimeout(summaryDebounce);
        summaryDebounce = setTimeout(async () => {
            await updateScene(sceneHash, { summary });
        }, 500);
    });

    // Clear all scenes
    $('#vecthare_scenes_clear_all').on('click', async function() {
        const stats = await getSceneStats();
        if (confirm(`Clear all ${stats.total} scenes? This cannot be undone.`)) {
            const result = await clearAllScenes();
            if (result.success) {
                toastr.success(`Cleared ${result.deleted} scenes`);
            } else {
                toastr.warning(`Cleared ${result.deleted} scenes (some failed)`);
            }
            await refreshPanel();
            eventSource.emit('vecthare_scenes_changed');
        }
    });
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Opens the scenes panel
 */
export async function openPanel() {
    if (isPanelOpen) return;

    // Remove any existing
    $('#vecthare_scenes_panel, #vecthare_scenes_overlay').remove();

    // Load scenes
    cachedScenes = await getScenes();
    const stats = await getSceneStats();

    // Add to body
    $('body').append(renderPanelContent(cachedScenes, stats));

    // Bind events
    bindEvents();

    // Show with animation
    $('#vecthare_scenes_overlay').fadeIn(200);
    $('#vecthare_scenes_panel').fadeIn(200);

    isPanelOpen = true;
}

/**
 * Closes the scenes panel
 */
export function closePanel() {
    $('#vecthare_scenes_overlay').fadeOut(200);
    $('#vecthare_scenes_panel').fadeOut(200, function() {
        $(this).remove();
        $('#vecthare_scenes_overlay').remove();
    });

    isPanelOpen = false;
    cachedScenes = [];
}

/**
 * Refreshes the panel content (keeps it open)
 */
export async function refreshPanel() {
    if (!isPanelOpen) return;

    cachedScenes = await getScenes();
    const stats = await getSceneStats();

    // Update body
    let bodyContent = '';
    if (cachedScenes.length === 0) {
        bodyContent = `
            <div class="vecthare-scenes-empty">
                <i class="fa-solid fa-film"></i>
                <p>No scenes marked yet</p>
                <p style="font-size: 0.9em; margin-top: 8px;">
                    Use the <i class="fa-solid fa-flag" style="color: var(--vecthare-success);"></i> flag buttons on messages to mark scene boundaries
                </p>
            </div>
        `;
    } else {
        bodyContent = cachedScenes.map((scene, idx) => renderSceneCard(scene, idx)).join('');
    }
    $('#vecthare_scenes_body').html(bodyContent);

    // Update stats
    const statsText = cachedScenes.length > 0
        ? `${stats.total} scene${stats.total !== 1 ? 's' : ''} (${stats.closed} closed, ${stats.open} open)`
        : 'No scenes';
    $('.vecthare-scenes-stats').text(statsText);

    // Update clear all button visibility
    if (cachedScenes.length > 0) {
        if (!$('#vecthare_scenes_clear_all').length) {
            $('.vecthare-scenes-footer-actions').html(`
                <button class="menu_button" id="vecthare_scenes_clear_all">
                    <i class="fa-solid fa-trash"></i> Clear All
                </button>
            `);
        }
    } else {
        $('#vecthare_scenes_clear_all').remove();
    }
}

/**
 * Toggles the scenes panel
 */
export async function togglePanel() {
    if (isPanelOpen) {
        closePanel();
    } else {
        await openPanel();
    }
}

/**
 * Checks if panel is currently open
 * @returns {boolean}
 */
export function isOpen() {
    return isPanelOpen;
}
