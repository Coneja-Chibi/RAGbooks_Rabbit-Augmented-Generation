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

import { saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { writeSecret, SECRET_KEYS, secret_state, readSecretState } from '../../../../secrets.js';
import { openVisualizer } from './chunk-visualizer.js';
import { openDatabaseBrowser } from './database-browser.js';
import { openContentVectorizer } from './content-vectorizer.js';
import { openSearchDebugModal, getLastSearchDebug } from './search-debug.js';

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
                            <option value="bananabread">BananaBread</option>
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
                            <div class="vecthare_provider_setting" data-provider="ollama,vllm,llamacpp,koboldcpp,bananabread">
                                <label class="checkbox_label">
                                    <input type="checkbox" id="vecthare_use_alt_endpoint" />
                                    <span>Use Alternative Endpoint</span>
                                </label>
                                <input type="text" id="vecthare_alt_endpoint_url" class="vecthare-input" placeholder="http://localhost:11434" />
                                <small class="vecthare_hint">Override default API URL for this provider</small>
                            </div>

                            <!-- BananaBread Info & Reranking -->
                            <div class="vecthare_provider_setting" data-provider="bananabread">
                                <small class="vecthare_info">
                                    <i class="fa-solid fa-info-circle"></i>
                                    BananaBread default: http://localhost:8008. Supports MixedBread AI and Qwen3 embedding models.
                                </small>
                                <label class="checkbox_label" style="margin-top: 8px;">
                                    <input type="checkbox" id="vecthare_bananabread_rerank" />
                                    <span>Enable Reranking</span>
                                </label>
                                <small class="vecthare_hint">Re-score results using BananaBread's reranker for better relevance</small>
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
                                <label for="vecthare_openrouter_apikey" style="margin-top: 8px;">
                                    <small>OpenRouter API Key:</small>
                                </label>
                                <input type="password" id="vecthare_openrouter_apikey" class="vecthare-input" placeholder="Paste key here to save..." autocomplete="off" />
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
                                <button id="vecthare_vectorize_content" class="vecthare-action-btn vecthare-btn-primary vecthare-action-featured">
                                    <i class="fa-solid fa-plus-circle"></i>
                                    <span>Vectorize Content</span>
                                </button>
                                <button id="vecthare_vectorize_all" class="vecthare-action-btn vecthare-btn-secondary">
                                    <i class="fa-solid fa-sync"></i>
                                    <span>Sync Chat</span>
                                </button>
                                <button id="vecthare_database_browser" class="vecthare-action-btn vecthare-btn-secondary">
                                    <i class="fa-solid fa-folder-open"></i>
                                    <span>Database Browser</span>
                                </button>
                                <button id="vecthare_run_diagnostics" class="vecthare-action-btn vecthare-btn-secondary">
                                    <i class="fa-solid fa-stethoscope"></i>
                                    <span>Diagnostics</span>
                                </button>
                                <button id="vecthare_view_results" class="vecthare-action-btn vecthare-btn-secondary">
                                    <i class="fa-solid fa-bug"></i>
                                    <span>Debug Query</span>
                                </button>
                                <button id="vecthare_purge" class="vecthare-action-btn vecthare-btn-danger-outline">
                                    <i class="fa-solid fa-trash"></i>
                                    <span>Purge</span>
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
            <div class="vecthare-modal-content vecthare-diagnostics-modal">
                <div class="vecthare-modal-header">
                    <h3>
                        <i class="fa-solid fa-stethoscope"></i>
                        <span id="vecthare_diagnostics_title">Run Diagnostics</span>
                    </h3>
                    <button class="vecthare-modal-close" id="vecthare_diagnostics_close">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="vecthare-modal-body">
                    <!-- Phase 1: Category Selection -->
                    <div id="vecthare_diagnostics_selection" class="vecthare-diagnostics-phase">
                        <p class="vecthare-diagnostics-intro">Select which diagnostic categories to run:</p>

                        <div class="vecthare-diagnostics-categories">
                            <label class="vecthare-diagnostics-category-option">
                                <input type="checkbox" id="vecthare_diag_infrastructure" checked>
                                <div class="vecthare-diagnostics-category-card">
                                    <i class="fa-solid fa-server"></i>
                                    <div class="vecthare-diagnostics-category-info">
                                        <strong>Infrastructure</strong>
                                        <span>Backend connections, plugins, API endpoints</span>
                                    </div>
                                </div>
                            </label>

                            <label class="vecthare-diagnostics-category-option">
                                <input type="checkbox" id="vecthare_diag_configuration" checked>
                                <div class="vecthare-diagnostics-category-card">
                                    <i class="fa-solid fa-sliders"></i>
                                    <div class="vecthare-diagnostics-category-info">
                                        <strong>Configuration</strong>
                                        <span>Settings validation, chunk size, thresholds</span>
                                    </div>
                                </div>
                            </label>

                            <label class="vecthare-diagnostics-category-option">
                                <input type="checkbox" id="vecthare_diag_visualizer" checked>
                                <div class="vecthare-diagnostics-category-card">
                                    <i class="fa-solid fa-eye"></i>
                                    <div class="vecthare-diagnostics-category-info">
                                        <strong>Visualizer</strong>
                                        <span>Chunk editing, deletion, summary vectors</span>
                                    </div>
                                </div>
                            </label>

                            <label class="vecthare-diagnostics-category-option">
                                <input type="checkbox" id="vecthare_diag_production">
                                <div class="vecthare-diagnostics-category-card">
                                    <i class="fa-solid fa-vial"></i>
                                    <div class="vecthare-diagnostics-category-info">
                                        <strong>Production Tests</strong>
                                        <span>Live embedding, storage, retrieval tests</span>
                                    </div>
                                </div>
                            </label>
                        </div>

                        <div class="vecthare-diagnostics-actions">
                            <button class="vecthare-btn-secondary" id="vecthare_diag_cancel">Cancel</button>
                            <button class="vecthare-btn-primary" id="vecthare_diag_run">
                                <i class="fa-solid fa-play"></i> Run Diagnostics
                            </button>
                        </div>
                    </div>

                    <!-- Phase 2: Running -->
                    <div id="vecthare_diagnostics_running" class="vecthare-diagnostics-phase" style="display: none;">
                        <div class="vecthare-diagnostics-spinner">
                            <i class="fa-solid fa-spinner fa-spin"></i>
                            <span>Running diagnostics...</span>
                        </div>
                    </div>

                    <!-- Phase 3: Results -->
                    <div id="vecthare_diagnostics_results" class="vecthare-diagnostics-phase" style="display: none;">
                        <div id="vecthare_diagnostics_content"></div>
                        <div class="vecthare-diagnostics-footer">
                            <button class="vecthare-btn-secondary" id="vecthare_diag_back">
                                <i class="fa-solid fa-arrow-left"></i> Run Again
                            </button>
                            <button class="vecthare-btn-secondary" id="vecthare_diag_copy">
                                <i class="fa-solid fa-copy"></i> Copy Report
                            </button>
                            <button class="vecthare-btn-danger" id="vecthare_diag_fix_all" style="display: none;">
                                <i class="fa-solid fa-wand-magic-sparkles"></i> Fix All Issues
                            </button>
                            <button class="vecthare-btn-primary" id="vecthare_diag_done">Done</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Chunk Visualizer Modal -->
        <div id="vecthare_visualizer_modal" class="vecthare-modal" style="display: none;">
            <div class="vecthare-modal-overlay"></div>
            <div class="vecthare-modal-content vecthare-visualizer-content">
                <div class="vecthare-modal-header">
                    <h3>
                        <i class="fa-solid fa-cubes"></i>
                        Chunk Visualizer
                    </h3>
                    <button class="vecthare-modal-close" id="vecthare_visualizer_close">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="vecthare-visualizer-toolbar">
                    <input type="text" id="vecthare_visualizer_search"
                           class="vecthare-visualizer-search"
                           placeholder="Search chunks by text, keywords, or name...">
                    <div class="vecthare-visualizer-stats">
                        <span id="vecthare_visualizer_count">0 chunks</span>
                        <span id="vecthare_visualizer_tiers"></span>
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
        closeDiagnosticsModal();
    });

    // Click overlay to close
    $('#vecthare_diagnostics_modal .vecthare-modal-overlay').on('click', function() {
        closeDiagnosticsModal();
    });

    // ESC key to close
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $('#vecthare_diagnostics_modal').is(':visible')) {
            closeDiagnosticsModal();
        }
    });

    // Cancel button
    $('#vecthare_diag_cancel').on('click', function() {
        closeDiagnosticsModal();
    });

    // Done button
    $('#vecthare_diag_done').on('click', function() {
        closeDiagnosticsModal();
    });

    // Back button - go back to selection
    $('#vecthare_diag_back').on('click', function() {
        showDiagnosticsPhase('selection');
        $('#vecthare_diagnostics_title').text('Run Diagnostics');
    });

    // Run button - execute diagnostics
    $('#vecthare_diag_run').on('click', async function() {
        await executeDiagnostics();
    });
}

/**
 * Closes the diagnostics modal and resets to selection phase
 */
function closeDiagnosticsModal() {
    $('#vecthare_diagnostics_modal').fadeOut(200, function() {
        // Reset to selection phase for next open
        showDiagnosticsPhase('selection');
        $('#vecthare_diagnostics_title').text('Run Diagnostics');
    });
}

/**
 * Shows a specific phase of the diagnostics modal
 * @param {string} phase - 'selection', 'running', or 'results'
 */
function showDiagnosticsPhase(phase) {
    $('#vecthare_diagnostics_selection').hide();
    $('#vecthare_diagnostics_running').hide();
    $('#vecthare_diagnostics_results').hide();
    $(`#vecthare_diagnostics_${phase}`).show();
}

// Console error capture for diagnostics
let capturedConsoleLogs = [];
let originalConsoleError = null;
let originalConsoleWarn = null;

/**
 * Starts capturing console errors and warnings
 */
function startConsoleCapture() {
    capturedConsoleLogs = [];

    // Store originals
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;

    // Override console.error
    console.error = function(...args) {
        capturedConsoleLogs.push({
            type: 'error',
            message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
            timestamp: new Date().toISOString(),
            stack: new Error().stack
        });
        originalConsoleError.apply(console, args);
    };

    // Override console.warn
    console.warn = function(...args) {
        capturedConsoleLogs.push({
            type: 'warning',
            message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
            timestamp: new Date().toISOString()
        });
        originalConsoleWarn.apply(console, args);
    };
}

/**
 * Stops capturing console errors and returns captured logs
 * @returns {Array} Captured console logs
 */
function stopConsoleCapture() {
    // Restore originals
    if (originalConsoleError) {
        console.error = originalConsoleError;
        originalConsoleError = null;
    }
    if (originalConsoleWarn) {
        console.warn = originalConsoleWarn;
        originalConsoleWarn = null;
    }

    return capturedConsoleLogs;
}

/**
 * Executes diagnostics based on selected categories
 */
async function executeDiagnostics() {
    const settings = extension_settings.vecthare;

    // Get selected categories
    const runInfrastructure = $('#vecthare_diag_infrastructure').prop('checked');
    const runConfiguration = $('#vecthare_diag_configuration').prop('checked');
    const runVisualizer = $('#vecthare_diag_visualizer').prop('checked');
    const runProduction = $('#vecthare_diag_production').prop('checked');

    if (!runInfrastructure && !runConfiguration && !runVisualizer && !runProduction) {
        toastr.warning('Please select at least one category to run');
        return;
    }

    // Show running phase
    showDiagnosticsPhase('running');
    $('#vecthare_diagnostics_title').text('Running Diagnostics...');

    // Start capturing console errors
    startConsoleCapture();

    try {
        // Import and run diagnostics
        const { runDiagnostics } = await import('../diagnostics/index.js');
        const results = await runDiagnostics(settings, runProduction);

        // Stop capturing and get logs
        const consoleLogs = stopConsoleCapture();

        // Filter results based on selected categories
        const filteredResults = {
            categories: {},
            checks: [],
            overall: results.overall,
            timestamp: results.timestamp,
            consoleErrors: consoleLogs
        };

        if (runInfrastructure && results.categories.infrastructure) {
            filteredResults.categories.infrastructure = results.categories.infrastructure;
            filteredResults.checks.push(...results.categories.infrastructure);
        }
        if (runConfiguration && results.categories.configuration) {
            filteredResults.categories.configuration = results.categories.configuration;
            filteredResults.checks.push(...results.categories.configuration);
        }
        if (runVisualizer && results.categories.visualizer) {
            filteredResults.categories.visualizer = results.categories.visualizer;
            filteredResults.checks.push(...results.categories.visualizer);
        }
        if (runProduction && results.categories.production) {
            filteredResults.categories.production = results.categories.production;
            filteredResults.checks.push(...results.categories.production);
        }

        // Add console errors as a category if any were captured
        if (consoleLogs.length > 0) {
            filteredResults.categories.console = consoleLogs.map(log => ({
                name: `Console ${log.type}`,
                status: log.type === 'error' ? 'fail' : 'warning',
                message: log.message.substring(0, 200) + (log.message.length > 200 ? '...' : ''),
                category: 'console'
            }));
            filteredResults.checks.push(...filteredResults.categories.console);
        }

        // Recalculate overall status based on filtered results
        const failCount = filteredResults.checks.filter(c => c.status === 'fail').length;
        const warnCount = filteredResults.checks.filter(c => c.status === 'warning').length;
        filteredResults.overall = failCount > 0 ? 'issues' : warnCount > 0 ? 'warnings' : 'healthy';

        // Show results
        showDiagnosticsResults(filteredResults);

    } catch (error) {
        stopConsoleCapture();
        console.error('VectHare Diagnostics error:', error);
        toastr.error('Failed to run diagnostics: ' + error.message);
        showDiagnosticsPhase('selection');
        $('#vecthare_diagnostics_title').text('Run Diagnostics');
    }
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

    // BananaBread reranking
    $('#vecthare_bananabread_rerank')
        .prop('checked', settings.bananabread_rerank)
        .on('input', function() {
            settings.bananabread_rerank = $(this).prop('checked');
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

    // OpenRouter API key - saves directly to ST secrets
    // Show existing key if set
    const updateOpenRouterKeyDisplay = () => {
        const secrets = secret_state[SECRET_KEYS.OPENROUTER];
        if (Array.isArray(secrets) && secrets.length > 0) {
            const activeSecret = secrets.find(s => s.active) || secrets[0];
            if (activeSecret?.value) {
                $('#vecthare_openrouter_apikey').attr('placeholder', activeSecret.value);
            }
        }
    };
    updateOpenRouterKeyDisplay();

    $('#vecthare_openrouter_apikey')
        .on('change', async function() {
            const value = String($(this).val()).trim();
            if (value) {
                await writeSecret(SECRET_KEYS.OPENROUTER, value);
                await readSecretState(); // Refresh state to get masked value
                toastr.success('OpenRouter API key saved');
                $(this).val(''); // Clear input
                updateOpenRouterKeyDisplay(); // Show masked key in placeholder
            }
        });

    // Action buttons
    $('#vecthare_vectorize_content').on('click', () => {
        openContentVectorizer();
    });
    $('#vecthare_vectorize_all').on('click', callbacks.onVectorizeAll);
    $('#vecthare_purge').on('click', callbacks.onPurge);
    $('#vecthare_run_diagnostics').on('click', callbacks.onRunDiagnostics);
    $('#vecthare_database_browser').on('click', () => {
        openDatabaseBrowser();
    });
    $('#vecthare_view_results').on('click', () => {
        openSearchDebugModal();
    });

    // Initialize provider-specific settings visibility
    toggleProviderSettings(settings.source);
}

// Store current diagnostic results for copy/filter functionality
let currentDiagnosticResults = null;
let currentDiagnosticFilter = 'all'; // 'all', 'pass', 'warning', 'fail'

/**
 * Shows diagnostics results in the results phase
 * @param {object} results - Diagnostics results object
 */
export function showDiagnosticsResults(results) {
    // Store results globally for copy/filter functionality
    currentDiagnosticResults = results;
    currentDiagnosticFilter = 'all';

    renderDiagnosticsContent(results, 'all');

    // Show results phase
    showDiagnosticsPhase('results');
}

/**
 * Renders diagnostic content with optional status filter
 * @param {object} results - Diagnostics results object
 * @param {string} filter - Filter: 'all', 'pass', 'warning', 'fail'
 */
function renderDiagnosticsContent(results, filter = 'all') {
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
        visualizer: '<i class="fa-solid fa-eye"></i> Visualizer',
        production: '<i class="fa-solid fa-vial"></i> Production Tests',
        console: '<i class="fa-solid fa-terminal"></i> Console Logs'
    };

    // Count stats
    const passCount = results.checks.filter(c => c.status === 'pass').length;
    const warnCount = results.checks.filter(c => c.status === 'warning').length;
    const failCount = results.checks.filter(c => c.status === 'fail').length;
    const fixableCount = results.checks.filter(c => c.fixable && (c.status === 'fail' || c.status === 'warning')).length;

    // Filter checks if needed
    const filterCheck = (check) => {
        if (filter === 'all') return true;
        return check.status === filter;
    };

    const renderChecks = (checks) => {
        const filteredChecks = checks.filter(filterCheck);
        if (filteredChecks.length === 0) {
            return '<div class="diagnostic-item-empty">No items match current filter</div>';
        }
        return filteredChecks.map(check => `
            <div class="diagnostic-item ${check.status}" data-fix-action="${check.fixAction || ''}" data-status="${check.status}">
                <div class="diagnostic-main">
                    <span class="diagnostic-icon">${statusIcons[check.status]}</span>
                    <span class="diagnostic-label">${check.name}</span>
                    <span class="diagnostic-message">${check.message}</span>
                </div>
                ${check.fixable ? `
                    <button class="diagnostic-fix-btn" data-fix-action="${check.fixAction}">
                        <i class="fa-solid fa-wrench"></i>
                        Fix
                    </button>
                ` : ''}
            </div>
        `).join('');
    };

    const html = `
        <!-- Summary Stats Bar (Clickable Filters) -->
        <div class="vecthare-diagnostics-stats">
            <div class="vecthare-diag-stat pass ${filter === 'pass' ? 'active' : ''}" data-filter="pass" title="Click to filter by passed">
                ${statusIcons.pass}
                <span class="vecthare-diag-stat-count">${passCount}</span>
                <span class="vecthare-diag-stat-label">Passed</span>
            </div>
            <div class="vecthare-diag-stat warning ${filter === 'warning' ? 'active' : ''}" data-filter="warning" title="Click to filter by warnings">
                ${statusIcons.warning}
                <span class="vecthare-diag-stat-count">${warnCount}</span>
                <span class="vecthare-diag-stat-label">Warnings</span>
            </div>
            <div class="vecthare-diag-stat fail ${filter === 'fail' ? 'active' : ''}" data-filter="fail" title="Click to filter by failed">
                ${statusIcons.fail}
                <span class="vecthare-diag-stat-count">${failCount}</span>
                <span class="vecthare-diag-stat-label">Failed</span>
            </div>
        </div>

        ${filter !== 'all' ? `
            <div class="vecthare-diag-filter-notice">
                <span>Showing only: <strong>${filter}</strong></span>
                <button class="vecthare-diag-clear-filter" data-filter="all">
                    <i class="fa-solid fa-times"></i> Show All
                </button>
            </div>
        ` : ''}

        ${Object.entries(results.categories).map(([category, checks]) => {
            if (checks.length === 0) return '';

            // Category-level stats
            const catPass = checks.filter(c => c.status === 'pass').length;
            const catWarn = checks.filter(c => c.status === 'warning').length;
            const catFail = checks.filter(c => c.status === 'fail').length;
            const catTotal = checks.length;
            const filteredCount = checks.filter(filterCheck).length;

            // Don't show category if all items filtered out
            if (filter !== 'all' && filteredCount === 0) return '';

            return `
                <div class="diagnostic-category" data-category="${category}">
                    <div class="diagnostic-category-header" data-collapsed="false">
                        <h4 class="diagnostic-category-title">
                            <span class="diagnostic-category-collapse-icon">
                                <i class="fa-solid fa-chevron-down"></i>
                            </span>
                            ${categoryTitles[category] || `<i class="fa-solid fa-folder"></i> ${category}`}
                        </h4>
                        <div class="diagnostic-category-stats">
                            <span class="diag-cat-stat pass" title="Passed">${catPass}</span>
                            <span class="diag-cat-stat warning" title="Warnings">${catWarn}</span>
                            <span class="diag-cat-stat fail" title="Failed">${catFail}</span>
                        </div>
                    </div>
                    <div class="diagnostic-category-content">
                        <div class="vecthare-diagnostics">
                            ${renderChecks(checks)}
                        </div>
                    </div>
                </div>
            `;
        }).join('')}
    `;

    output.html(html);

    // Update title based on results
    const titleText = results.overall === 'healthy'
        ? 'All Checks Passed!'
        : results.overall === 'warnings'
            ? 'Completed with Warnings'
            : 'Issues Found';
    $('#vecthare_diagnostics_title').text(titleText);

    // Show/hide Fix All button based on fixable issues
    if (fixableCount > 0) {
        $('#vecthare_diag_fix_all')
            .show()
            .html(`<i class="fa-solid fa-wand-magic-sparkles"></i> Fix All (${fixableCount})`)
            .off('click')
            .on('click', function() {
                handleFixAll(results.checks);
            });
    } else {
        $('#vecthare_diag_fix_all').hide();
    }

    // Bind filter click handlers on stat boxes
    $('.vecthare-diag-stat').off('click').on('click', function() {
        const clickedFilter = $(this).data('filter');
        // Toggle: if already active, show all; otherwise apply filter
        if (currentDiagnosticFilter === clickedFilter) {
            currentDiagnosticFilter = 'all';
        } else {
            currentDiagnosticFilter = clickedFilter;
        }
        renderDiagnosticsContent(currentDiagnosticResults, currentDiagnosticFilter);
    });

    // Bind clear filter button
    $('.vecthare-diag-clear-filter').off('click').on('click', function() {
        currentDiagnosticFilter = 'all';
        renderDiagnosticsContent(currentDiagnosticResults, 'all');
    });

    // Bind category collapse handlers
    $('.diagnostic-category-header').off('click').on('click', function() {
        const $header = $(this);
        const $content = $header.next('.diagnostic-category-content');
        const isCollapsed = $header.attr('data-collapsed') === 'true';

        if (isCollapsed) {
            $content.slideDown(200);
            $header.attr('data-collapsed', 'false');
            $header.find('.diagnostic-category-collapse-icon i').removeClass('fa-chevron-right').addClass('fa-chevron-down');
        } else {
            $content.slideUp(200);
            $header.attr('data-collapsed', 'true');
            $header.find('.diagnostic-category-collapse-icon i').removeClass('fa-chevron-down').addClass('fa-chevron-right');
        }
    });

    // Bind individual fix button click handlers
    $('.diagnostic-fix-btn').off('click').on('click', function(e) {
        e.stopPropagation();
        const action = $(this).data('fix-action');
        handleDiagnosticFix(action);
        // Mark this item as fixed visually
        $(this).closest('.diagnostic-item')
            .removeClass('fail warning')
            .addClass('pass')
            .find('.diagnostic-icon').html(statusIcons.pass);
        $(this).fadeOut(200);
    });

    // Bind copy button
    $('#vecthare_diag_copy').off('click').on('click', function() {
        copyDiagnosticsReport(currentDiagnosticResults);
    });
}

/**
 * Generates and copies a nicely formatted diagnostics report
 * Respects the current filter selection
 * @param {object} results - Diagnostics results object
 */
function copyDiagnosticsReport(results) {
    if (!results) {
        toastr.warning('No diagnostic results to copy');
        return;
    }

    const filter = currentDiagnosticFilter;
    const isFiltered = filter !== 'all';

    // Filter checks if a specific filter is active
    const filterCheck = (check) => {
        if (!isFiltered) return true;
        return check.status === filter;
    };

    const timestamp = new Date(results.timestamp).toLocaleString();

    // Total counts (always show these for context)
    const totalPass = results.checks.filter(c => c.status === 'pass').length;
    const totalWarn = results.checks.filter(c => c.status === 'warning').length;
    const totalFail = results.checks.filter(c => c.status === 'fail').length;
    const totalCount = totalPass + totalWarn + totalFail;

    // Filtered counts
    const filteredChecks = results.checks.filter(filterCheck);
    const filteredCount = filteredChecks.length;

    const statusSymbols = {
        'pass': '✓',
        'warning': '⚠',
        'fail': '✗',
        'skipped': '○'
    };

    const filterNames = {
        'pass': 'PASSED ONLY',
        'warning': 'WARNINGS ONLY',
        'fail': 'FAILURES ONLY'
    };

    let report = `╔══════════════════════════════════════════════════════════════╗
║              VECTHARE DIAGNOSTICS REPORT                      ║
╚══════════════════════════════════════════════════════════════╝

📅 Generated: ${timestamp}
${isFiltered ? `🔍 Filter: ${filterNames[filter]} (${filteredCount} of ${totalCount} checks)\n` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                         SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ Passed:   ${String(totalPass).padStart(3)}${filter === 'pass' ? ' ◀ showing' : ''}
  ⚠ Warnings: ${String(totalWarn).padStart(3)}${filter === 'warning' ? ' ◀ showing' : ''}
  ✗ Failed:   ${String(totalFail).padStart(3)}${filter === 'fail' ? ' ◀ showing' : ''}
  ─────────────────
  Total:      ${String(totalCount).padStart(3)}

`;

    const categoryNames = {
        infrastructure: '🔧 INFRASTRUCTURE',
        configuration: '⚙️  CONFIGURATION',
        visualizer: '👁️  VISUALIZER',
        production: '🧪 PRODUCTION TESTS',
        console: '💻 CONSOLE LOGS'
    };

    for (const [category, checks] of Object.entries(results.categories)) {
        // Filter checks for this category
        const filteredCatChecks = checks.filter(filterCheck);
        if (filteredCatChecks.length === 0) continue;

        // Show filtered counts vs total for this category
        const catTotal = checks.length;
        const catFiltered = filteredCatChecks.length;
        const catStats = isFiltered
            ? `(${catFiltered} of ${catTotal})`
            : `(✓${checks.filter(c => c.status === 'pass').length} ⚠${checks.filter(c => c.status === 'warning').length} ✗${checks.filter(c => c.status === 'fail').length})`;

        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${categoryNames[category] || category.toUpperCase()}  ${catStats}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

        for (const check of filteredCatChecks) {
            const symbol = statusSymbols[check.status] || '?';
            const name = check.name.padEnd(28);
            report += `  ${symbol} ${name} ${check.message}\n`;
        }

        report += '\n';
    }

    // Add console errors if present (only when showing all or failures)
    if (results.consoleErrors && results.consoleErrors.length > 0 && (!isFiltered || filter === 'fail')) {
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💻 CONSOLE ERRORS CAPTURED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
        for (const error of results.consoleErrors) {
            report += `  [${error.type.toUpperCase()}] ${error.message}\n`;
            if (error.stack) {
                report += `           ${error.stack.split('\n')[0]}\n`;
            }
        }
        report += '\n';
    }

    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                      END OF REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    // Copy to clipboard
    const filterMsg = isFiltered ? ` (${filterNames[filter]})` : '';
    navigator.clipboard.writeText(report).then(() => {
        toastr.success(`Diagnostics report${filterMsg} copied to clipboard`, 'VectHare');
    }).catch(err => {
        console.error('Failed to copy:', err);
        toastr.error('Failed to copy report');
    });
}

/**
 * Opens the diagnostics modal (starts at selection phase)
 */
export function openDiagnosticsModal() {
    showDiagnosticsPhase('selection');
    $('#vecthare_diagnostics_title').text('Run Diagnostics');
    $('#vecthare_diagnostics_modal').fadeIn(200);
}

/**
 * Handles fixing all fixable issues
 * @param {Array} checks - Array of diagnostic checks
 */
function handleFixAll(checks) {
    const fixableChecks = checks.filter(c => c.fixable && (c.status === 'fail' || c.status === 'warning'));

    if (fixableChecks.length === 0) {
        toastr.info('No fixable issues found');
        return;
    }

    let fixedCount = 0;
    const statusIcons = {
        'pass': '<i class="fa-solid fa-circle-check" style="color: var(--vecthare-success);"></i>'
    };

    fixableChecks.forEach(check => {
        try {
            handleDiagnosticFix(check.fixAction, true); // silent mode
            fixedCount++;

            // Update UI for this item
            $(`.diagnostic-item[data-fix-action="${check.fixAction}"]`)
                .removeClass('fail warning')
                .addClass('pass')
                .find('.diagnostic-icon').html(statusIcons.pass);
            $(`.diagnostic-item[data-fix-action="${check.fixAction}"] .diagnostic-fix-btn`).fadeOut(200);
        } catch (e) {
            console.warn(`Failed to fix: ${check.fixAction}`, e);
        }
    });

    // Hide Fix All button after use
    $('#vecthare_diag_fix_all').fadeOut(200);

    toastr.success(`Fixed ${fixedCount} issue${fixedCount !== 1 ? 's' : ''}`);
}

/**
 * Handles diagnostic fix actions
 * @param {string} action - The fix action to perform
 * @param {boolean} silent - If true, suppress toast notifications and don't close modal
 */
function handleDiagnosticFix(action, silent = false) {
    const settings = extension_settings.vecthare;

    switch (action) {
        case 'enable_chats':
            $('#vecthare_enabled_chats').prop('checked', true).trigger('change');
            if (!silent) toastr.success('Chat vectorization enabled');
            break;

        case 'vectorize_all':
            $('#vecthare_vectorize_all').click();
            break;

        case 'configure_provider':
            // Scroll to provider settings
            $('#vecthare_provider_settings')[0]?.scrollIntoView({ behavior: 'smooth' });
            if (!silent) toastr.info('Please select an embedding provider');
            break;

        case 'configure_api_key':
            if (!silent) toastr.info('Go to Settings > API Connections to add your API key');
            break;

        case 'configure_url':
            // Scroll to provider settings
            $('#vecthare_provider_settings')[0]?.scrollIntoView({ behavior: 'smooth' });
            if (!silent) toastr.info('Please configure your API URL in the provider settings');
            break;

        case 'fix_chunk_size':
            $('#vecthare_message_chunk_size').val(400).trigger('change');
            if (!silent) toastr.success('Chunk size reset to 400');
            break;

        case 'fix_threshold':
            $('#vecthare_score_threshold').val(0.25).trigger('change');
            if (!silent) toastr.success('Score threshold reset to 0.25');
            break;

        case 'fix_counts':
            if (settings.insert < 1) {
                $('#vecthare_insert').val(3).trigger('change');
            }
            if (settings.query < 1) {
                $('#vecthare_query').val(2).trigger('change');
            }
            if (!silent) toastr.success('Insert/Query counts fixed');
            break;

        default:
            if (!silent) toastr.error(`Unknown fix action: ${action}`);
    }

    // Only close modal for individual fixes (not batch Fix All)
    if (!silent) {
        setTimeout(() => {
            closeDiagnosticsModal();
        }, 500);
    }
}

/**
 * Hides diagnostics output
 */
export function hideDiagnosticsResults() {
    $('#vecthare_diagnostics_output').hide();
}
