/**
 * ============================================================================
 * VECTHARE - ADVANCED RAG SYSTEM
 * ============================================================================
 * Entry point - lean and clean
 * All logic is in separate modules - see project guidelines
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

// VectHare modules - Core
import { synchronizeChat, rearrangeChat, vectorizeAll } from './core/chat-vectorization.js';
import { purgeAllVectorIndexes, purgeVectorIndex } from './core/core-vector-api.js';
import { getChatCollectionId } from './core/chat-vectorization.js';
import { getDefaultDecaySettings } from './core/temporal-decay.js';
import { migrateOldEnabledKeys } from './core/collection-metadata.js';
import { clearCollectionRegistry, discoverExistingCollections } from './core/collection-loader.js';

// VectHare modules - UI
import { renderSettings, openDiagnosticsModal, loadWebLlmModels, updateWebLlmStatus, refreshAutoSyncCheckbox } from './ui/ui-manager.js';
import { initializeVisualizer } from './ui/chunk-visualizer.js';
import { initializeDatabaseBrowser } from './ui/database-browser.js';
import { initializeSceneMarkers, updateAllMarkerStates, setSceneSettings } from './ui/scene-markers.js';

// VectHare modules - Cotton-Tales Integration
import './core/emotion-classifier.js'; // Exposes window.VectHareEmotionClassifier

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
    milvus_host: 'localhost',
    milvus_port: 19530,
    milvus_username: '',
    milvus_password: '',
    milvus_token: '',
    milvus_address: '',
    alt_endpoint_url: '',
    use_alt_endpoint: false,
    rate_limit_calls: 5,
    rate_limit_interval: 60, // seconds
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
    bananabread_rerank: false,

    // Chat vectorization
    enabled_chats: false,
    chunking_strategy: 'per_message',
    batch_size: 4,
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

    // RAG Prompt Context (Global level)
    // Wraps ALL injected content with context prompts and/or XML tags
    rag_context: '',      // Natural language context shown before all RAG content
    rag_xml_tag: '',      // XML tag to wrap all RAG content (e.g., "retrieved_context")

    // Collection-level metadata (managed by collection-metadata.js)
    collections: {},

    // Collection registry (list of known collection IDs)
    vecthare_collection_registry: [],
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
 * Action: Full purge - wipes ALL vector data and settings
 */
async function onPurgeClick() {
    const confirmed = confirm(
        'WARNING: This will delete ALL vector data and reset VectHare settings.\n\n' +
        'This cannot be undone. Continue?'
    );

    if (!confirmed) {
        toastr.info('Purge cancelled');
        return;
    }

    try {
        const { getRequestHeaders } = await import('../../../../script.js');

        // 1. Delete entire vectors folder
        await fetch('/api/plugins/similharity/purge-all', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        // 2. Clear extension_settings.vecthare
        for (const key in extension_settings.vecthare) {
            if (key !== 'enabled') {
                delete extension_settings.vecthare[key];
            }
        }

        // 3. Save settings
        const { saveSettingsDebounced } = await import('../../../../script.js');
        saveSettingsDebounced();

        toastr.success('All vector data purged', 'Purge Complete');

    } catch (error) {
        console.error('VectHare: Purge failed:', error);
        toastr.error('Purge failed: ' + error.message);
    }
}

/**
 * Action: Run diagnostics - opens the diagnostics modal
 */
function onRunDiagnosticsClick() {
    openDiagnosticsModal();
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
        },
        collections: {
            ...defaultSettings.collections,
            ...extension_settings.vecthare.collections
        }
    };

    // Migrate old scattered enabled keys to new collections structure
    const migrationResult = migrateOldEnabledKeys();
    if (migrationResult.migrated > 0) {
        console.log(`VectHare: Migrated ${migrationResult.migrated} old collection enabled keys`);
    }

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

    // Initialize scene markers on chat messages (settings needed for DB operations)
    setSceneSettings(settings);
    initializeSceneMarkers();

    // Discover existing collections on load (async, non-blocking)
    discoverExistingCollections(settings).then(collections => {
        if (collections.length > 0) {
            console.log(`VectHare: Discovered ${collections.length} existing collections`);
        }
    }).catch(err => {
        console.warn('VectHare: Collection discovery failed:', err.message);
    });

    // Register event handlers
    eventSource.on(event_types.MESSAGE_DELETED, onChatEvent);
    eventSource.on(event_types.MESSAGE_EDITED, onChatEvent);
    eventSource.on(event_types.MESSAGE_SENT, onChatEvent);
    eventSource.on(event_types.MESSAGE_RECEIVED, onChatEvent);
    eventSource.on(event_types.MESSAGE_SWIPED, onChatEvent);
    // When a chat is deleted, purge its vectors (not full purge, just that chat)
    eventSource.on(event_types.CHAT_DELETED, async (chatId) => {
        if (chatId) {
            const collectionId = getChatCollectionId(chatId);
            if (collectionId) {
                await purgeVectorIndex(collectionId, settings);
                console.log(`VectHare: Purged vectors for deleted chat: ${chatId}`);
            }
        }
    });
    eventSource.on(event_types.GROUP_CHAT_DELETED, async (chatId) => {
        if (chatId) {
            const collectionId = getChatCollectionId(chatId);
            if (collectionId) {
                await purgeVectorIndex(collectionId, settings);
                console.log(`VectHare: Purged vectors for deleted group chat: ${chatId}`);
            }
        }
    });

    // When WebLLM extension is loaded, refresh the model list
    eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, async (manifest) => {
        if (settings.source === 'webllm' && manifest?.display_name === 'WebLLM') {
            console.log('VectHare: WebLLM extension loaded, refreshing models...');
            updateWebLlmStatus();
            await loadWebLlmModels(settings);
        }
    });

    // When chat changes, refresh UI state to match settings
    eventSource.on(event_types.CHAT_CHANGED, () => {
        console.log('VectHare: Chat changed, refreshing UI state');
        refreshAutoSyncCheckbox(settings);
    });

    console.log('VectHare: ✅ Initialized successfully');
});
