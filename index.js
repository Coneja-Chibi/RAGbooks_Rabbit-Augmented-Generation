/**
 * ============================================================================
 * VECTHARE - ADVANCED RAG SYSTEM
 * ============================================================================
 * Entry point - lean and clean
 * All logic is in separate modules per CLAUDE.md
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import {
    eventSource,
    event_types,
    extension_prompt_types,
} from '../../../../script.js';
import {
    ModuleWorkerWrapper,
    extension_settings,
} from '../../../extensions.js';
import { debounce } from '../../../utils.js';
import { debounce_timeout } from '../../../constants.js';

// VectHare modules
import { synchronizeChat, rearrangeChat, vectorizeAll, purgeChatIndex } from './chat-vectorization.js';
import { renderSettings, showDiagnosticsResults } from './ui-manager.js';
import { runDiagnostics } from './diagnostics.js';
import { getDefaultDecaySettings } from './temporal-decay.js';
import { initializeVisualizer } from './chunk-visualizer.js';
import { initializeDatabaseBrowser } from './database-browser.js';

// Constants
const MODULE_NAME = 'VectHare';

// Default settings
const defaultSettings = {
    // Core vector settings
    source: 'transformers',
    vector_backend: 'standard', // Backend: 'standard' (ST Vectra), 'lancedb', 'qdrant'
    qdrant_host: 'localhost',
    qdrant_port: 6333,
    qdrant_url: '',
    qdrant_api_key: '',
    qdrant_use_cloud: false,
    alt_endpoint_url: '',
    use_alt_endpoint: false,
    togetherai_model: 'togethercomputer/m2-bert-80M-32k-retrieval',
    openai_model: 'text-embedding-ada-002',
    electronhub_model: 'text-embedding-3-small',
    openrouter_model: 'openai/text-embedding-3-large',
    cohere_model: 'embed-english-v3.0',
    ollama_model: 'mxbai-embed-large',
    ollama_keep: false,
    vllm_model: '',
    webllm_model: '',
    google_model: 'text-embedding-005',

    // Chat vectorization
    enabled_chats: false,
    template: 'Past events:\n{{text}}',
    depth: 2,
    position: extension_prompt_types.IN_PROMPT,
    protect: 5,
    insert: 3,
    query: 2,
    message_chunk_size: 400,
    score_threshold: 0.25,

    // Advanced features
    temporal_decay: getDefaultDecaySettings(),
};

// Runtime settings (merged with saved settings)
let settings = { ...defaultSettings };

// Module worker for automatic syncing
const moduleWorker = new ModuleWorkerWrapper(() => synchronizeChat(settings, getBatchSize()));

// Batch size based on provider
const getBatchSize = () => ['transformers', 'ollama'].includes(settings.source) ? 1 : 5;

// Chat event handler (debounced)
const onChatEvent = debounce(async () => await moduleWorker.update(), debounce_timeout.relaxed);

/**
 * Generation interceptor - searches and injects relevant messages
 */
async function vecthare_rearrangeChat(chat, _contextSize, _abort, type) {
    await rearrangeChat(chat, settings, type);
}

// Export to window for ST to call
window['vecthare_rearrangeChat'] = vecthare_rearrangeChat;

/**
 * Action: Vectorize all messages in current chat
 */
async function onVectorizeAllClick() {
    await vectorizeAll(settings, getBatchSize());
}

/**
 * Action: Purge vector index for current chat
 */
async function onPurgeClick() {
    await purgeChatIndex(settings);
}

/**
 * Action: Run diagnostics
 */
async function onRunDiagnosticsClick() {
    const includeProductionTests = $('#vecthare_include_production_tests').prop('checked');
    const results = await runDiagnostics(settings, includeProductionTests);
    showDiagnosticsResults(results);
}

/**
 * Initialize VectHare extension
 */
jQuery(async () => {
    console.log('VectHare: Initializing...');

    // Load saved settings
    if (!extension_settings.vecthare) {
        extension_settings.vecthare = defaultSettings;
    }

    // Merge saved settings with defaults
    settings = {
        ...defaultSettings,
        ...extension_settings.vecthare,
        temporal_decay: {
            ...defaultSettings.temporal_decay,
            ...extension_settings.vecthare.temporal_decay
        }
    };

    // Render UI
    renderSettings('extensions_settings2', settings, {
        onVectorizeAll: onVectorizeAllClick,
        onPurge: onPurgeClick,
        onRunDiagnostics: onRunDiagnosticsClick
    });

    // Initialize visualizer
    initializeVisualizer();

    // Initialize database browser
    initializeDatabaseBrowser(settings);

    // Register event handlers
    eventSource.on(event_types.MESSAGE_DELETED, onChatEvent);
    eventSource.on(event_types.MESSAGE_EDITED, onChatEvent);
    eventSource.on(event_types.MESSAGE_SENT, onChatEvent);
    eventSource.on(event_types.MESSAGE_RECEIVED, onChatEvent);
    eventSource.on(event_types.MESSAGE_SWIPED, onChatEvent);
    eventSource.on(event_types.CHAT_DELETED, (chatId) => purgeChatIndex(settings));
    eventSource.on(event_types.GROUP_CHAT_DELETED, (chatId) => purgeChatIndex(settings));

    console.log('VectHare: ✅ Initialized successfully');
});
