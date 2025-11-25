/**
 * ============================================================================
 * VECTHARE UI MANAGER
 * ============================================================================
 * Handles ALL UI rendering and event binding
 * Keeps index.js clean and lean
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { openVisualizer } from './chunk-visualizer.js';
import { openDatabaseBrowser } from './database-browser.js';

/**
 * Renders the VectHare settings UI
 * @param {string} containerId - The container element ID to render into
 * @param {object} settings - VectHare settings object
 * @param {object} callbacks - Object containing callback functions
 * @param {Function} callbacks.onVectorizeAll - Called when "Vectorize All" is clicked
 * @param {Function} callbacks.onPurge - Called when "Purge" is clicked
 * @param {Function} callbacks.onRunDiagnostics - Called when "Run Diagnostics" is clicked
 */
export function renderSettings(containerId, settings, callbacks) {
    console.log('VectHare UI: Rendering settings...');

    const html = `
        <div id="vecthare_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>VectHare - Advanced RAG</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">

                    <!-- Core Settings Card -->
                    <div class="vecthare-card">
                        <div class="vecthare-card-header">
                            <h3 class="vecthare-card-title">
                                <span class="vecthare-icon">
                                    <i class="fa-solid fa-cog"></i>
                                </span>
                                Core Settings
                            </h3>
                            <p class="vecthare-card-subtitle">Configure embedding provider and vectorization parameters</p>
                        </div>
                        <div class="vecthare-card-body">

                            <label class="checkbox_label" for="vecthare_enabled_chats">
                                <input type="checkbox" id="vecthare_enabled_chats" />
                                <span>Enable Chat Vectorization</span>
                            </label>

                            <label for="vecthare_vector_backend">
                                <small>Vector Backend</small>
                            </label>
                            <select id="vecthare_vector_backend" class="vecthare-select">
                                <option value="standard">Standard (ST's Vectra - file-based)</option>
                                <option value="lancedb">LanceDB (disk-based, scalable)</option>
                                <option value="qdrant">Qdrant (production vector search)</option>
                            </select>
                            <small class="vecthare-help-text" style="display: block; margin-top: -8px; margin-bottom: 16px; opacity: 0.7; font-size: 0.85em; line-height: 1.5;">
                                • Standard: ST's built-in Vectra (best for <100k vectors)<br>
                                • LanceDB: Disk-based, handles millions of vectors (requires plugin)<br>
                                • Qdrant: Production-grade with HNSW, filtering, cloud support
                            </small>

                            <!-- Qdrant Settings (shown only when Qdrant backend is selected) -->
                            <div id="vecthare_qdrant_settings" style="display: none;">
                                <label class="checkbox_label">
                                    <input type="checkbox" id="vecthare_qdrant_use_cloud" />
                                    <span>Use Qdrant Cloud</span>
                                </label>

                                <!-- Local Qdrant Settings -->
                                <div id="vecthare_qdrant_local_settings">
                                    <label for="vecthare_qdrant_host">
                                        <small>Qdrant Host:</small>
                                    </label>
                                    <input type="text" id="vecthare_qdrant_host" class="vecthare-input" placeholder="localhost" />

                                    <label for="vecthare_qdrant_port">
                                        <small>Qdrant Port:</small>
                                    </label>
                                    <input type="number" id="vecthare_qdrant_port" class="vecthare-input" placeholder="6333" />
                                </div>

                                <!-- Cloud Qdrant Settings -->
                                <div id="vecthare_qdrant_cloud_settings" style="display: none;">
                                    <label for="vecthare_qdrant_url">
                                        <small>Qdrant Cloud URL:</small>
                                    </label>
                                    <input type="text" id="vecthare_qdrant_url" class="vecthare-input" placeholder="https://xxx.cloud.qdrant.io" />

                                    <label for="vecthare_qdrant_api_key">
                                        <small>API Key:</small>
                                    </label>
                                    <input type="password" id="vecthare_qdrant_api_key" class="vecthare-input" placeholder="Your Qdrant Cloud API key" />
                                </div>
                            </div>

                            <label for="vecthare_source">
                                <small>Embedding Provider</small>
                            </label>
                            <select id="vecthare_source" class="vecthare-select">
                            <option value="transformers">Transformers (Local)</option>
                            <option value="openai">OpenAI</option>
                            <option value="ollama">Ollama</option>
                            <option value="cohere">Cohere</option>
                            <option value="togetherai">Together AI</option>
                            <option value="extras">Extras API</option>
                            <option value="electronhub">ElectronHub</option>
                            <option value="openrouter">OpenRouter</option>
                            <option value="llamacpp">LlamaCPP</option>
                            <option value="vllm">vLLM</option>
                            <option value="koboldcpp">KoboldCPP</option>
                            <option value="webllm">WebLLM</option>
                            <option value="palm">Google PaLM</option>
                            <option value="vertexai">Google VertexAI</option>
                            <option value="mistral">Mistral AI</option>
                            <option value="nomicai">Nomic AI</option>
                        </select>

                        <!-- Provider-Specific Settings -->
                        <div id="vecthare_provider_settings">

                            <!-- ElectronHub Model -->
                            <div class="vecthare_provider_setting" data-provider="electronhub">
                                <label for="vecthare_electronhub_model">
                                    <small>ElectronHub Model:</small>
                                </label>
                                <select id="vecthare_electronhub_model" class="vecthare-select">
                                    <option value="text-embedding-3-small">text-embedding-3-small</option>
                                    <option value="text-embedding-3-large">text-embedding-3-large</option>
                                    <option value="text-embedding-ada-002">text-embedding-ada-002</option>
                                </select>
                            </div>

                            <!-- Alternative Endpoint (for local providers) -->
                            <div class="vecthare_provider_setting" data-provider="ollama,vllm,llamacpp,koboldcpp">
                                <label class="checkbox_label">
                                    <input type="checkbox" id="vecthare_use_alt_endpoint" />
                                    <span>Use Alternative Endpoint</span>
                                </label>
                                <input type="text" id="vecthare_alt_endpoint_url" class="vecthare-input" placeholder="http://localhost:11434" />
                                <small class="vecthare_hint">Override default API URL for this provider</small>
                            </div>

                            <!-- WebLLM Model -->
                            <div class="vecthare_provider_setting" data-provider="webllm">
                                <label for="vecthare_webllm_model">
                                    <small>WebLLM Model:</small>
                                </label>
                                <select id="vecthare_webllm_model" class="vecthare-select"></select>
                                <button id="vecthare_webllm_load" class="menu_button">
                                    <i class="fa-solid fa-download"></i> Load Model
                                </button>
                            </div>

                            <!-- Ollama Model -->
                            <div class="vecthare_provider_setting" data-provider="ollama">
                                <label for="vecthare_ollama_model">
                                    <small>Ollama Model:</small>
                                </label>
                                <input type="text" id="vecthare_ollama_model" class="vecthare-input" placeholder="mxbai-embed-large" />
                                <label class="checkbox_label">
                                    <input type="checkbox" id="vecthare_ollama_keep" />
                                    <span>Keep Model in Memory</span>
                                </label>
                                <small class="vecthare_hint">Enter the model name from your local Ollama installation</small>
                            </div>

                            <!-- KoboldCPP Info -->
                            <div class="vecthare_provider_setting" data-provider="koboldcpp">
                                <small class="vecthare_info">
                                    <i class="fa-solid fa-info-circle"></i>
                                    KoboldCPP uses the currently loaded model for embeddings. Ensure your model supports embeddings.
                                </small>
                            </div>

                            <!-- LlamaCPP Info -->
                            <div class="vecthare_provider_setting" data-provider="llamacpp">
                                <small class="vecthare_info">
                                    <i class="fa-solid fa-info-circle"></i>
                                    LlamaCPP requires the --embedding flag to be enabled. Restart your server with this flag if not already set.
                                </small>
                            </div>

                            <!-- OpenAI Model -->
                            <div class="vecthare_provider_setting" data-provider="openai">
                                <label for="vecthare_openai_model">
                                    <small>OpenAI Model:</small>
                                </label>
                                <select id="vecthare_openai_model" class="vecthare-select">
                                    <option value="text-embedding-ada-002">text-embedding-ada-002</option>
                                    <option value="text-embedding-3-small">text-embedding-3-small</option>
                                    <option value="text-embedding-3-large">text-embedding-3-large</option>
                                </select>
                            </div>

                            <!-- Cohere Model -->
                            <div class="vecthare_provider_setting" data-provider="cohere">
                                <label for="vecthare_cohere_model">
                                    <small>Cohere Model:</small>
                                </label>
                                <select id="vecthare_cohere_model" class="vecthare-select">
                                    <option value="embed-english-v3.0">embed-english-v3.0</option>
                                    <option value="embed-multilingual-v3.0">embed-multilingual-v3.0</option>
                                    <option value="embed-english-light-v3.0">embed-english-light-v3.0</option>
                                    <option value="embed-multilingual-light-v3.0">embed-multilingual-light-v3.0</option>
                                    <option value="embed-english-v2.0">embed-english-v2.0</option>
                                    <option value="embed-english-light-v2.0">embed-english-light-v2.0</option>
                                    <option value="embed-multilingual-v2.0">embed-multilingual-v2.0</option>
                                    <option value="embed-multilingual-light-v2.0">embed-multilingual-light-v2.0</option>
                                </select>
                            </div>

                            <!-- TogetherAI Model -->
                            <div class="vecthare_provider_setting" data-provider="togetherai">
                                <label for="vecthare_togetherai_model">
                                    <small>Together AI Model:</small>
                                </label>
                                <select id="vecthare_togetherai_model" class="vecthare-select">
                                    <option value="togethercomputer/m2-bert-80M-32k-retrieval">togethercomputer/m2-bert-80M-32k-retrieval</option>
                                    <option value="togethercomputer/m2-bert-80M-8k-retrieval">togethercomputer/m2-bert-80M-8k-retrieval</option>
                                    <option value="togethercomputer/m2-bert-80M-2k-retrieval">togethercomputer/m2-bert-80M-2k-retrieval</option>
                                    <option value="WhereIsAI/UAE-Large-V1">WhereIsAI/UAE-Large-V1</option>
                                    <option value="BAAI/bge-large-en-v1.5">BAAI/bge-large-en-v1.5</option>
                                    <option value="BAAI/bge-base-en-v1.5">BAAI/bge-base-en-v1.5</option>
                                    <option value="sentence-transformers/msmarco-bert-base-dot-v5">sentence-transformers/msmarco-bert-base-dot-v5</option>
                                    <option value="bert-base-uncased">bert-base-uncased</option>
                                </select>
                            </div>

                            <!-- vLLM Model -->
                            <div class="vecthare_provider_setting" data-provider="vllm">
                                <label for="vecthare_vllm_model">
                                    <small>vLLM Model:</small>
                                </label>
                                <input type="text" id="vecthare_vllm_model" class="vecthare-input" placeholder="Model name" />
                                <small class="vecthare_hint">Enter the model name from your vLLM deployment</small>
                            </div>

                            <!-- Google Model (PaLM/VertexAI) -->
                            <div class="vecthare_provider_setting" data-provider="palm,vertexai">
                                <label for="vecthare_google_model">
                                    <small>Google Model:</small>
                                </label>
                                <select id="vecthare_google_model" class="vecthare-select">
                                    <option value="text-embedding-005">text-embedding-005</option>
                                    <option value="text-embedding-004">text-embedding-004</option>
                                    <option value="text-multilingual-embedding-002">text-multilingual-embedding-002</option>
                                    <option value="textembedding-gecko">textembedding-gecko</option>
                                    <option value="textembedding-gecko-multilingual">textembedding-gecko-multilingual</option>
                                </select>
                            </div>

                            <!-- NomicAI API Key -->
                            <div class="vecthare_provider_setting" data-provider="nomicai">
                                <button id="vecthare_nomicai_api_key" class="menu_button">
                                    <i class="fa-solid fa-key"></i> Set Nomic API Key
                                </button>
                                <small class="vecthare_hint">Configure your Nomic API key in SillyTavern settings</small>
                            </div>

                            <!-- OpenRouter Model -->
                            <div class="vecthare_provider_setting" data-provider="openrouter">
                                <label for="vecthare_openrouter_model">
                                    <small>OpenRouter Model:</small>
                                </label>
                                <input type="text" id="vecthare_openrouter_model" class="vecthare-input" placeholder="openai/text-embedding-3-large" />
                                <small class="vecthare_hint">Enter OpenRouter-compatible model ID</small>
                            </div>

                        </div>

                        <label for="vecthare_message_chunk_size">
                            <small>Message Chunk Size: <span id="vecthare_chunk_size_value">400</span> characters</small>
                        </label>
                        <input type="range" id="vecthare_message_chunk_size" class="vecthare-slider" min="100" max="2000" step="50" />
                        <small class="vecthare_hint">Characters per chunk (100-2000)</small>

                            <label for="vecthare_score_threshold">
                                <small>Similarity Threshold: <span id="vecthare_threshold_value">0.25</span></small>
                            </label>
                            <input type="range" id="vecthare_score_threshold" class="vecthare-slider" min="0" max="1" step="0.05" />
                            <small class="vecthare_hint">Minimum relevance score for retrieval</small>

                            <label class="checkbox_label" for="vecthare_temporal_decay_enabled">
                                <input type="checkbox" id="vecthare_temporal_decay_enabled" />
                                <span>Enable Temporal Decay</span>
                            </label>
                            <small class="vecthare_hint">Prioritizes recent messages over older ones in search results</small>

                            <div id="vecthare_temporal_decay_settings" style="display: none;">
                                <label for="vecthare_decay_halflife">
                                    <small>Half-life: <span id="vecthare_halflife_value">50</span> messages</small>
                                </label>
                                <input type="range" id="vecthare_decay_halflife" class="vecthare-slider" min="10" max="200" step="10" value="50" />
                                <small class="vecthare_hint">Number of messages until relevance drops to 50%</small>
                            </div>

                        </div>
                    </div>

                    <!-- Actions Card -->
                    <div class="vecthare-card">
                        <div class="vecthare-card-header">
                            <h3 class="vecthare-card-title">
                                <span class="vecthare-icon">
                                    <i class="fa-solid fa-bolt"></i>
                                </span>
                                Actions
                            </h3>
                            <p class="vecthare-card-subtitle">Manage your vector database</p>
                        </div>
                        <div class="vecthare-card-body">

                            <div class="vecthare-actions-grid">
                                <button id="vecthare_vectorize_all" class="vecthare-action-btn vecthare-btn-primary">
                                    <i class="fa-solid fa-database"></i>
                                    <span>Vectorize All</span>
                                </button>
                                <button id="vecthare_purge" class="vecthare-action-btn vecthare-btn-danger">
                                    <i class="fa-solid fa-trash"></i>
                                    <span>Purge Index</span>
                                </button>
                                <button id="vecthare_run_diagnostics" class="vecthare-action-btn vecthare-btn-secondary">
                                    <i class="fa-solid fa-stethoscope"></i>
                                    <span>Run Diagnostics</span>
                                </button>
                                <button id="vecthare_database_browser" class="vecthare-action-btn vecthare-btn-primary">
                                    <i class="fa-solid fa-folder-open"></i>
                                    <span>Database Browser</span>
                                </button>
                                <button id="vecthare_view_results" class="vecthare-action-btn vecthare-btn-secondary">
                                    <i class="fa-solid fa-eye"></i>
                                    <span>View Last Search</span>
                                </button>
                            </div>

                            <label class="checkbox_label" for="vecthare_include_production_tests" style="margin-top: 20px;">
                                <input type="checkbox" id="vecthare_include_production_tests" />
                                <span>Include Production Tests</span>
                            </label>
                            <small class="vecthare_hint">Tests actual embedding generation, storage, and retrieval (slower but thorough)</small>

                        </div>
                    </div>

                </div>
            </div>
        </div>

        <!-- Diagnostics Modal -->
        <div id="vecthare_diagnostics_modal" class="vecthare-modal" style="display: none;">
            <div class="vecthare-modal-overlay"></div>
            <div class="vecthare-modal-content">
                <div class="vecthare-modal-header">
                    <h3>
                        <i class="fa-solid fa-stethoscope"></i>
                        Diagnostics Results
                    </h3>
                    <button class="vecthare-modal-close" id="vecthare_diagnostics_close">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="vecthare-modal-body">
                    <div id="vecthare_diagnostics_content"></div>
                </div>
            </div>
        </div>

        <!-- Chunk Visualizer Modal -->
        <div id="vecthare_visualizer_modal" class="vecthare-modal" style="display: none;">
            <div class="vecthare-modal-overlay"></div>
            <div class="vecthare-modal-content vecthare-visualizer-content">
                <div class="vecthare-modal-header">
                    <h3>
                        <i class="fa-solid fa-cube"></i>
                        Search Results
                    </h3>
                    <button class="vecthare-modal-close" id="vecthare_visualizer_close">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="vecthare-visualizer-toolbar">
                    <input type="text" id="vecthare_visualizer_search"
                           class="vecthare-search-input"
                           placeholder="Search chunks...">
                    <div class="vecthare-visualizer-stats">
                        <span id="vecthare_visualizer_count">0 chunks</span>
                    </div>
                </div>
                <div class="vecthare-modal-body">
                    <div id="vecthare_visualizer_content"></div>
                </div>
                <div class="vecthare-modal-footer">
                    <button class="vecthare-btn-secondary" id="vecthare_visualizer_done">Done</button>
                </div>
            </div>
        </div>
    `;

    $(`#${containerId}`).append(html);

    // Bind all events
    bindSettingsEvents(settings, callbacks);

    // Initialize collapsible cards
    initializeCollapsibleCards();

    // Initialize modal
    initializeDiagnosticsModal();

    console.log('VectHare UI: Settings rendered');
}

/**
 * Initializes diagnostics modal functionality
 */
function initializeDiagnosticsModal() {
    // Close button
    $('#vecthare_diagnostics_close').on('click', function() {
        $('#vecthare_diagnostics_modal').fadeOut(200);
    });

    // Click overlay to close
    $('.vecthare-modal-overlay').on('click', function() {
        $('#vecthare_diagnostics_modal').fadeOut(200);
    });

    // ESC key to close
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $('#vecthare_diagnostics_modal').is(':visible')) {
            $('#vecthare_diagnostics_modal').fadeOut(200);
        }
    });
}

/**
 * Initializes collapsible functionality
 */
function initializeCollapsibleCards() {
    $('.vecthare-collapsible-header').on('click', function() {
        const content = $(this).next('.vecthare-collapsible-content');
        const icon = $(this).find('.vecthare-collapsible-icon');

        content.slideToggle(200);
        icon.toggleClass('rotated');
    });
}

/**
 * Toggles provider-specific settings visibility
 * @param {string} selectedProvider - Currently selected provider
 */
function toggleProviderSettings(selectedProvider) {
    // Hide all provider-specific settings
    $('.vecthare_provider_setting').hide();

    // Show settings for selected provider
    $(`.vecthare_provider_setting`).each(function() {
        const providers = $(this).attr('data-provider').split(',');
        if (providers.includes(selectedProvider)) {
            $(this).show();
        }
    });
}

/**
 * Binds event handlers to UI elements
 * @param {object} settings - VectHare settings object
 * @param {object} callbacks - Callback functions
 */
function bindSettingsEvents(settings, callbacks) {
    // Enable/disable chat vectorization
    $('#vecthare_enabled_chats')
        .prop('checked', settings.enabled_chats)
        .on('input', function() {
            settings.enabled_chats = $(this).prop('checked');
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
            console.log(`VectHare: Chat vectorization ${settings.enabled_chats ? 'enabled' : 'disabled'}`);
        });

    // Vector backend selection
    $('#vecthare_vector_backend')
        .val(settings.vector_backend || 'standard')
        .on('change', function() {
            settings.vector_backend = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();

            // Show/hide Qdrant settings
            if (settings.vector_backend === 'qdrant') {
                $('#vecthare_qdrant_settings').show();
            } else {
                $('#vecthare_qdrant_settings').hide();
            }

            console.log(`VectHare: Vector backend changed to ${settings.vector_backend}`);
        });

    // Qdrant cloud toggle
    $('#vecthare_qdrant_use_cloud')
        .prop('checked', settings.qdrant_use_cloud || false)
        .on('change', function() {
            settings.qdrant_use_cloud = $(this).prop('checked');
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();

            // Toggle between local and cloud settings
            if (settings.qdrant_use_cloud) {
                $('#vecthare_qdrant_local_settings').hide();
                $('#vecthare_qdrant_cloud_settings').show();
            } else {
                $('#vecthare_qdrant_local_settings').show();
                $('#vecthare_qdrant_cloud_settings').hide();
            }
        })
        .trigger('change');

    // Qdrant settings
    $('#vecthare_qdrant_host')
        .val(settings.qdrant_host || 'localhost')
        .on('input', function() {
            settings.qdrant_host = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    $('#vecthare_qdrant_port')
        .val(settings.qdrant_port || 6333)
        .on('input', function() {
            settings.qdrant_port = parseInt($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    $('#vecthare_qdrant_url')
        .val(settings.qdrant_url || '')
        .on('input', function() {
            settings.qdrant_url = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    $('#vecthare_qdrant_api_key')
        .val(settings.qdrant_api_key || '')
        .on('input', function() {
            settings.qdrant_api_key = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // Show Qdrant settings if backend is qdrant
    if (settings.vector_backend === 'qdrant') {
        $('#vecthare_qdrant_settings').show();
    }

    // Embedding provider
    $('#vecthare_source')
        .val(settings.source)
        .on('change', function() {
            settings.source = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
            toggleProviderSettings(settings.source);
            console.log(`VectHare: Embedding provider changed to ${settings.source}`);
        });

    // Message chunk size
    $('#vecthare_message_chunk_size')
        .val(settings.message_chunk_size)
        .on('input', function() {
            const value = parseInt($(this).val());
            $('#vecthare_chunk_size_value').text(value);
            settings.message_chunk_size = value;
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });
    $('#vecthare_chunk_size_value').text(settings.message_chunk_size);

    // Score threshold
    $('#vecthare_score_threshold')
        .val(settings.score_threshold)
        .on('input', function() {
            const value = parseFloat($(this).val());
            $('#vecthare_threshold_value').text(value.toFixed(2));
            settings.score_threshold = value;
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });
    $('#vecthare_threshold_value').text(settings.score_threshold.toFixed(2));

    // Provider-specific settings

    // ElectronHub model
    $('#vecthare_electronhub_model')
        .val(settings.electronhub_model)
        .on('change', function() {
            settings.electronhub_model = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // Alternative endpoint
    $('#vecthare_use_alt_endpoint')
        .prop('checked', settings.use_alt_endpoint)
        .on('input', function() {
            settings.use_alt_endpoint = $(this).prop('checked');
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
            $('#vecthare_alt_endpoint_url').toggle(settings.use_alt_endpoint);
        });

    $('#vecthare_alt_endpoint_url')
        .val(settings.alt_endpoint_url)
        .toggle(settings.use_alt_endpoint)
        .on('input', function() {
            settings.alt_endpoint_url = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // WebLLM model
    $('#vecthare_webllm_model')
        .val(settings.webllm_model)
        .on('change', function() {
            settings.webllm_model = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // Ollama model
    $('#vecthare_ollama_model')
        .val(settings.ollama_model)
        .on('input', function() {
            settings.ollama_model = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    $('#vecthare_ollama_keep')
        .prop('checked', settings.ollama_keep)
        .on('input', function() {
            settings.ollama_keep = $(this).prop('checked');
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // OpenAI model
    $('#vecthare_openai_model')
        .val(settings.openai_model)
        .on('change', function() {
            settings.openai_model = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // Cohere model
    $('#vecthare_cohere_model')
        .val(settings.cohere_model)
        .on('change', function() {
            settings.cohere_model = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // TogetherAI model
    $('#vecthare_togetherai_model')
        .val(settings.togetherai_model)
        .on('change', function() {
            settings.togetherai_model = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // vLLM model
    $('#vecthare_vllm_model')
        .val(settings.vllm_model)
        .on('input', function() {
            settings.vllm_model = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // Google model
    $('#vecthare_google_model')
        .val(settings.google_model)
        .on('change', function() {
            settings.google_model = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // OpenRouter model
    $('#vecthare_openrouter_model')
        .val(settings.openrouter_model)
        .on('input', function() {
            settings.openrouter_model = String($(this).val());
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });

    // Temporal decay toggle
    $('#vecthare_temporal_decay_enabled')
        .prop('checked', settings.temporal_decay.enabled)
        .on('input', function() {
            settings.temporal_decay.enabled = $(this).prop('checked');
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();

            // Show/hide advanced settings
            $('#vecthare_temporal_decay_settings').toggle(settings.temporal_decay.enabled);

            console.log(`VectHare: Temporal decay ${settings.temporal_decay.enabled ? 'enabled' : 'disabled'}`);
        });

    // Temporal decay half-life
    $('#vecthare_decay_halflife')
        .val(settings.temporal_decay.halfLife)
        .on('input', function() {
            const value = parseInt($(this).val());
            $('#vecthare_halflife_value').text(value);
            settings.temporal_decay.halfLife = value;
            Object.assign(extension_settings.vecthare, settings);
            saveSettingsDebounced();
        });
    $('#vecthare_halflife_value').text(settings.temporal_decay.halfLife);

    // Action buttons
    $('#vecthare_vectorize_all').on('click', callbacks.onVectorizeAll);
    $('#vecthare_purge').on('click', callbacks.onPurge);
    $('#vecthare_run_diagnostics').on('click', callbacks.onRunDiagnostics);
    $('#vecthare_database_browser').on('click', () => {
        openDatabaseBrowser();
    });
    $('#vecthare_view_results').on('click', () => {
        if (window.VectHare_LastSearch) {
            openVisualizer(window.VectHare_LastSearch);
        } else {
            toastr.info('No search results yet. Send a message to trigger vector search.', 'VectHare');
        }
    });

    // Show temporal decay settings if enabled
    if (settings.temporal_decay.enabled) {
        $('#vecthare_temporal_decay_settings').show();
    }

    // Initialize provider-specific settings visibility
    toggleProviderSettings(settings.source);
}

/**
 * Shows diagnostics results in a modal
 * @param {object} results - Diagnostics results object
 */
export function showDiagnosticsResults(results) {
    const output = $('#vecthare_diagnostics_content');
    output.empty();

    const statusIcons = {
        'pass': '<i class="fa-solid fa-circle-check" style="color: var(--vecthare-success);"></i>',
        'warning': '<i class="fa-solid fa-triangle-exclamation" style="color: var(--vecthare-warning);"></i>',
        'fail': '<i class="fa-solid fa-circle-xmark" style="color: var(--vecthare-danger);"></i>',
        'skipped': '<i class="fa-solid fa-circle-minus" style="color: var(--grey70);"></i>'
    };

    const categoryTitles = {
        infrastructure: '<i class="fa-solid fa-server"></i> Infrastructure',
        configuration: '<i class="fa-solid fa-sliders"></i> Configuration',
        production: '<i class="fa-solid fa-vial"></i> Production Tests'
    };

    const renderChecks = (checks) => checks.map(check => `
        <div class="diagnostic-item ${check.status}">
            <div class="diagnostic-main">
                <span class="diagnostic-icon">${statusIcons[check.status]}</span>
                <span class="diagnostic-label">${check.name}</span>
                <span class="diagnostic-message">${check.message}</span>
            </div>
            ${check.fixable ? `
                <button class="diagnostic-fix-btn" data-fix-action="${check.fixAction}">
                    <i class="fa-solid fa-wrench"></i>
                    Fix Now
                </button>
            ` : ''}
        </div>
    `).join('');

    const html = `
        ${Object.entries(results.categories).map(([category, checks]) => {
            if (checks.length === 0) return '';
            return `
                <div class="diagnostic-category">
                    <h4 class="diagnostic-category-title">${categoryTitles[category]}</h4>
                    <div class="vecthare-diagnostics">
                        ${renderChecks(checks)}
                    </div>
                </div>
            `;
        }).join('')}

        <div class="vecthare-diagnostics-summary">
            <strong>Overall Status:</strong> ${results.overall === 'healthy' ? statusIcons.pass + ' Healthy' : results.overall === 'warnings' ? statusIcons.warning + ' Has Warnings' : statusIcons.fail + ' Issues Found'}
        </div>
    `;

    output.html(html);

    // Bind fix button click handlers
    $('.diagnostic-fix-btn').on('click', function() {
        const action = $(this).data('fix-action');
        handleDiagnosticFix(action);
    });

    // Show modal with fade-in
    $('#vecthare_diagnostics_modal').fadeIn(200);
}

/**
 * Handles diagnostic fix actions
 * @param {string} action - The fix action to perform
 */
function handleDiagnosticFix(action) {
    const settings = extension_settings.vecthare;

    switch (action) {
        case 'enable_chats':
            $('#vecthare_enabled_chats').prop('checked', true).trigger('change');
            toastr.success('Chat vectorization enabled');
            break;

        case 'vectorize_all':
            $('#vecthare_vectorize_all').click();
            break;

        case 'configure_provider':
            // Scroll to provider settings
            $('#vecthare_provider_settings')[0].scrollIntoView({ behavior: 'smooth' });
            toastr.info('Please select an embedding provider');
            break;

        case 'configure_api_key':
            toastr.info('Go to Settings > API Connections to add your API key');
            break;

        case 'configure_url':
            // Scroll to provider settings
            $('#vecthare_provider_settings')[0].scrollIntoView({ behavior: 'smooth' });
            toastr.info('Please configure your API URL in the provider settings');
            break;

        case 'fix_chunk_size':
            $('#vecthare_message_chunk_size').val(400).trigger('change');
            toastr.success('Chunk size reset to 400');
            break;

        case 'fix_threshold':
            $('#vecthare_score_threshold').val(0.25).trigger('change');
            toastr.success('Score threshold reset to 0.25');
            break;

        case 'fix_counts':
            if (settings.insert < 1) {
                $('#vecthare_insert').val(3).trigger('change');
            }
            if (settings.query < 1) {
                $('#vecthare_query').val(2).trigger('change');
            }
            toastr.success('Insert/Query counts fixed');
            break;

        case 'fix_decay':
            $('#vecthare_decay_rate').val(0.1).trigger('change');
            $('#vecthare_decay_halflife').val(10).trigger('change');
            toastr.success('Temporal decay settings reset to defaults');
            break;


        default:
            toastr.error(`Unknown fix action: ${action}`);
    }

    // Close modal after fix
    setTimeout(() => {
        $('#vecthare_diagnostics_modal').fadeOut(200);
    }, 500);
}

/**
 * Hides diagnostics output
 */
export function hideDiagnosticsResults() {
    $('#vecthare_diagnostics_output').hide();
}
