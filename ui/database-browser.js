/**
 * ============================================================================
 * VECTHARE DATABASE BROWSER
 * ============================================================================
 * Comprehensive vector database browser UI
 * Main entry point for browsing, managing, and editing all vector collections
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import {
    loadAllCollections,
    setCollectionEnabled,
    registerCollection,
    unregisterCollection
} from '../core/collection-loader.js';
import { purgeVectorIndex } from '../core/core-vector-api.js';
import { getRequestHeaders } from '../../../../../script.js';
import { cleanupOrphanedMeta, deleteCollectionMeta } from '../core/collection-metadata.js';

// Browser state
let browserState = {
    isOpen: false,
    collections: [],
    selectedCollection: null,
    filters: {
        scope: 'all',        // 'all', 'global', 'character', 'chat'
        collectionType: 'all', // 'all', 'chat', 'file', 'lorebook'
        searchQuery: ''
    },
    settings: null
};

/**
 * Initializes the database browser
 * @param {object} settings VectHare settings
 */
export function initializeDatabaseBrowser(settings) {
    browserState.settings = settings;
    console.log('VectHare Database Browser: Initialized');
}

/**
 * Opens the database browser modal
 */
export async function openDatabaseBrowser() {
    if (browserState.isOpen) {
        console.log('VectHare Database Browser: Already open');
        return;
    }

    browserState.isOpen = true;

    // Create modal if it doesn't exist
    if ($('#vecthare_database_browser_modal').length === 0) {
        createBrowserModal();
    }

    // Load collections
    await refreshCollections();

    // Show modal
    $('#vecthare_database_browser_modal').fadeIn(200);
    console.log('VectHare Database Browser: Opened');
}

/**
 * Closes the database browser modal
 */
export function closeDatabaseBrowser() {
    $('#vecthare_database_browser_modal').fadeOut(200);
    browserState.isOpen = false;
    console.log('VectHare Database Browser: Closed');
}

/**
 * Creates the browser modal HTML structure
 */
function createBrowserModal() {
    const modalHtml = `
        <div id="vecthare_database_browser_modal" class="vecthare-modal">
            <div class="vecthare-modal-content vecthare-database-browser-content popup">
                <!-- Header -->
                <div class="vecthare-modal-header">
                    <h3>📂 VectHare Database Browser</h3>
                    <button class="vecthare-btn-icon" id="vecthare_browser_close">✕</button>
                </div>

                <!-- Tabs (Phase 1: Collections only) -->
                <div class="vecthare-browser-tabs">
                    <button class="vecthare-tab-btn active" data-tab="collections">
                        📂 Collections
                    </button>
                    <button class="vecthare-tab-btn" data-tab="search" disabled title="Coming in Phase 2">
                        🔍 Search
                    </button>
                    <button class="vecthare-tab-btn" data-tab="bulk" disabled title="Coming in Phase 4">
                        ✓ Bulk Operations
                    </button>
                </div>

                <!-- Tab Content -->
                <div class="vecthare-browser-content">
                    <!-- Collections Tab -->
                    <div id="vecthare_tab_collections" class="vecthare-tab-content active">
                        <!-- Scope Filters (V1-style) -->
                        <div class="vecthare-scope-filters">
                            <button class="vecthare-scope-filter active" data-scope="all">All</button>
                            <button class="vecthare-scope-filter" data-scope="global">Global</button>
                            <button class="vecthare-scope-filter" data-scope="character">Character</button>
                            <button class="vecthare-scope-filter" data-scope="chat">Chat</button>
                        </div>

                        <!-- Type Filters -->
                        <div class="vecthare-type-filters">
                            <label>
                                <input type="radio" name="vecthare_type_filter" value="all" checked>
                                All Types
                            </label>
                            <label>
                                <input type="radio" name="vecthare_type_filter" value="chat">
                                💬 Chats
                            </label>
                            <label>
                                <input type="radio" name="vecthare_type_filter" value="file">
                                📄 Files
                            </label>
                            <label>
                                <input type="radio" name="vecthare_type_filter" value="lorebook">
                                📚 Lorebooks
                            </label>
                        </div>

                        <!-- Search Box -->
                        <div class="vecthare-search-box">
                            <input type="text"
                                   id="vecthare_collection_search"
                                   placeholder="Search collections..."
                                   autocomplete="off">
                        </div>

                        <!-- Collections List -->
                        <div id="vecthare_collections_list" class="vecthare-collections-list">
                            <div class="vecthare-loading">Loading collections...</div>
                        </div>

                        <!-- Stats Footer -->
                        <div class="vecthare-browser-stats">
                            <span id="vecthare_browser_stats_text">No collections</span>
                        </div>
                    </div>

                    <!-- Other tabs (Phase 2+) -->
                    <div id="vecthare_tab_search" class="vecthare-tab-content">
                        <p>Search across all collections - Coming in Phase 2</p>
                    </div>

                    <div id="vecthare_tab_bulk" class="vecthare-tab-content">
                        <p>Bulk operations - Coming in Phase 4</p>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    // Bind events
    bindBrowserEvents();
}

/**
 * Binds event handlers for browser UI
 */
function bindBrowserEvents() {
    // Close button
    $('#vecthare_browser_close').on('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        closeDatabaseBrowser();
    });

    // Close on background click (modal itself, not content)
    $('#vecthare_database_browser_modal').on('click', function(e) {
        if (e.target === this) {
            e.stopPropagation();
            e.preventDefault();
            closeDatabaseBrowser();
        }
    });

    // Tab switching
    $('.vecthare-tab-btn').on('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        const tab = $(this).data('tab');
        switchTab(tab);
    });

    // Scope filters
    $('.vecthare-scope-filter').on('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        $('.vecthare-scope-filter').removeClass('active');
        $(this).addClass('active');
        browserState.filters.scope = $(this).data('scope');
        renderCollections();
    });

    // Type filters
    $('input[name="vecthare_type_filter"]').on('change', function(e) {
        e.stopPropagation();
        browserState.filters.collectionType = $(this).val();
        renderCollections();
    });

    // Search input
    $('#vecthare_collection_search').on('input', function(e) {
        e.stopPropagation();
        browserState.filters.searchQuery = $(this).val().toLowerCase();
        renderCollections();
    });

    // Keyboard shortcuts
    $(document).on('keydown.vecthare_browser', function(e) {
        if (!browserState.isOpen) return;

        if (e.key === 'Escape') {
            closeDatabaseBrowser();
        }
    });
}

/**
 * Switches active tab
 * @param {string} tabName Tab identifier
 */
function switchTab(tabName) {
    $('.vecthare-tab-btn').removeClass('active');
    $(`.vecthare-tab-btn[data-tab="${tabName}"]`).addClass('active');

    $('.vecthare-tab-content').removeClass('active');
    $(`#vecthare_tab_${tabName}`).addClass('active');
}

/**
 * Refreshes collections from storage
 */
async function refreshCollections() {
    try {
        browserState.collections = await loadAllCollections(browserState.settings);

        // Clean up orphaned metadata entries (collections that no longer exist)
        const actualIds = browserState.collections.map(c => c.id);
        const cleanupResult = cleanupOrphanedMeta(actualIds);
        if (cleanupResult.removed > 0) {
            console.log(`VectHare: Cleaned up ${cleanupResult.removed} orphaned metadata entries`);
        }

        renderCollections();
    } catch (error) {
        console.error('VectHare: Failed to load collections', error);
        $('#vecthare_collections_list').html(`
            <div class="vecthare-error">
                Failed to load collections. Check console for details.
            </div>
        `);
    }
}

/**
 * Renders collections list based on current filters
 */
function renderCollections() {
    const container = $('#vecthare_collections_list');

    // Apply filters
    let filtered = browserState.collections.filter(c => {
        // Scope filter
        if (browserState.filters.scope !== 'all' && c.scope !== browserState.filters.scope) {
            return false;
        }

        // Type filter
        if (browserState.filters.collectionType !== 'all' && c.type !== browserState.filters.collectionType) {
            return false;
        }

        // Search filter
        if (browserState.filters.searchQuery) {
            const searchLower = browserState.filters.searchQuery;
            return c.name.toLowerCase().includes(searchLower) ||
                   c.id.toLowerCase().includes(searchLower);
        }

        return true;
    });

    if (filtered.length === 0) {
        container.html(`
            <div class="vecthare-empty-state">
                <p>No collections found.</p>
                <small>Vectorize some chat messages to create collections!</small>
            </div>
        `);
        updateStats(0, 0);
        return;
    }

    // Render collection cards
    const cardsHtml = filtered.map(c => renderCollectionCard(c)).join('');
    container.html(cardsHtml);

    // Bind card events
    bindCollectionCardEvents();

    // Update stats
    const totalChunks = filtered.reduce((sum, c) => sum + c.chunkCount, 0);
    updateStats(filtered.length, totalChunks);
}

/**
 * Renders a single collection card (V1-inspired layout)
 * @param {object} collection Collection data
 * @returns {string} Card HTML
 */
function renderCollectionCard(collection) {
    const typeIcon = {
        chat: '💬',
        file: '📄',
        lorebook: '📚',
        unknown: '❓'
    }[collection.type] || '❓';

    const scopeBadge = {
        global: '<span class="vecthare-badge vecthare-badge-global">Global</span>',
        character: '<span class="vecthare-badge vecthare-badge-character">Character</span>',
        chat: '<span class="vecthare-badge vecthare-badge-chat">Chat</span>'
    }[collection.scope] || '';

    const statusBadge = collection.enabled
        ? '<span class="vecthare-badge vecthare-badge-success">Active</span>'
        : '<span class="vecthare-badge vecthare-badge-muted">Paused</span>';

    // Backend badge - shows vector database (Standard, LanceDB, Qdrant)
    const backendDisplayName = {
        standard: 'Standard',
        lancedb: 'LanceDB',
        qdrant: 'Qdrant'
    }[collection.backend] || collection.backend;

    const backendBadge = collection.backend
        ? `<span class="vecthare-badge vecthare-badge-backend" title="Vector backend">${backendDisplayName}</span>`
        : '';

    // Source badge - shows embedding source (transformers, palm, openai, etc.)
    const sourceBadge = collection.source && collection.source !== 'unknown'
        ? `<span class="vecthare-badge vecthare-badge-source" title="Embedding source">${collection.source}</span>`
        : '';

    return `
        <div class="vecthare-collection-card" data-collection-id="${collection.id}">
            <div class="vecthare-collection-header">
                <span class="vecthare-collection-title">
                    ${typeIcon} ${collection.name}
                </span>
                <div class="vecthare-collection-badges">
                    ${scopeBadge}
                    ${backendBadge}
                    ${sourceBadge}
                    ${statusBadge}
                </div>
            </div>

            <div class="vecthare-collection-meta">
                <span>🧊 ${collection.chunkCount} chunks</span>
                <span>ID: ${collection.id}</span>
            </div>

            <div class="vecthare-collection-actions">
                <button class="vecthare-btn-sm vecthare-btn-primary vecthare-action-toggle"
                        data-collection-id="${collection.id}"
                        data-enabled="${collection.enabled}">
                    ${collection.enabled ? '⏸ Pause' : '▶ Enable'}
                </button>
                <button class="vecthare-btn-sm vecthare-action-open-folder"
                        data-collection-id="${collection.id}"
                        data-backend="${collection.backend}"
                        data-source="${collection.source || 'transformers'}"
                        title="Open in file explorer">
                    📁 Open Folder
                </button>
                <button class="vecthare-btn-sm vecthare-action-visualize"
                        data-collection-id="${collection.id}"
                        disabled
                        title="Coming in Phase 2">
                    📦 View Chunks
                </button>
                <button class="vecthare-btn-sm vecthare-btn-danger vecthare-action-delete"
                        data-collection-id="${collection.id}">
                    🗑 Delete
                </button>
            </div>
        </div>
    `;
}

/**
 * Binds events for collection card actions
 */
function bindCollectionCardEvents() {
    // Toggle enabled/disabled
    $('.vecthare-action-toggle').off('click').on('click', async function(e) {
        e.stopPropagation();
        const collectionId = $(this).data('collection-id');
        const currentEnabled = $(this).data('enabled');
        const newEnabled = !currentEnabled;

        setCollectionEnabled(collectionId, newEnabled);

        // Update UI
        const collection = browserState.collections.find(c => c.id === collectionId);
        if (collection) {
            collection.enabled = newEnabled;
        }

        renderCollections();

        toastr.success(
            `Collection ${newEnabled ? 'enabled' : 'paused'}`,
            'VectHare'
        );
    });

    // Delete collection
    $('.vecthare-action-delete').off('click').on('click', async function(e) {
        e.stopPropagation();
        const collectionId = $(this).data('collection-id');
        const collection = browserState.collections.find(c => c.id === collectionId);

        if (!collection) return;

        const confirmed = confirm(
            `Delete collection "${collection.name}"?\n\n` +
            `This will remove ${collection.chunkCount} chunks from the vector index.\n` +
            `This action cannot be undone.`
        );

        if (!confirmed) return;

        try {
            // Purge from vector backend
            await purgeVectorIndex(collectionId, browserState.settings);

            // Unregister from registry
            unregisterCollection(collectionId);

            // Delete collection metadata
            deleteCollectionMeta(collectionId);

            // Remove from state
            browserState.collections = browserState.collections.filter(c => c.id !== collectionId);

            // Re-render
            renderCollections();

            toastr.success(`Deleted collection "${collection.name}"`, 'VectHare');
        } catch (error) {
            console.error('VectHare: Failed to delete collection', error);
            toastr.error('Failed to delete collection. Check console.', 'VectHare');
        }
    });

    // Open folder
    $('.vecthare-action-open-folder').off('click').on('click', async function(e) {
        e.stopPropagation();
        const collectionId = $(this).data('collection-id');
        const backend = $(this).data('backend');
        const source = $(this).data('source');

        try {
            const response = await fetch('/api/plugins/similharity/open-folder', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ collectionId, backend, source }),
            });

            if (!response.ok) {
                throw new Error(`Failed to open folder: ${response.statusText}`);
            }

            toastr.success('Opened collection folder', 'VectHare');
        } catch (error) {
            console.error('VectHare: Failed to open folder', error);
            toastr.error('Failed to open folder. Check console.', 'VectHare');
        }
    });

    // Visualize (Phase 2)
    $('.vecthare-action-visualize').off('click').on('click', function(e) {
        e.stopPropagation();
        toastr.info('Chunk viewer coming in Phase 2!', 'VectHare');
    });
}

/**
 * Updates stats footer
 * @param {number} collectionCount Number of collections shown
 * @param {number} chunkCount Total chunks
 */
function updateStats(collectionCount, chunkCount) {
    const statsText = collectionCount === 0
        ? 'No collections'
        : `${collectionCount} collection${collectionCount === 1 ? '' : 's'}, ${chunkCount} total chunks`;

    $('#vecthare_browser_stats_text').text(statsText);
}
