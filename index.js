/**
 * ============================================================================
 * RAGBOOKS - UNIVERSAL RAG SYSTEM
 * ============================================================================
 * Vectorizes and intelligently injects any text content - lorebooks, character
 * cards, world info, custom documents - using semantic search to reduce context
 * consumption by 80-90%.
 *
 * Features:
 * - Universal content support (not limited to documents)
 * - Per-source vector collections (lorebooks, characters, custom docs)
 * - Flexible chunking strategies (semantic, size-based, manual)
 * - Top-K retrieval with crosslinking and keyword fallback
 * - Storage at global, character, or chat level
 * - Works with any embedding provider
 *
 * Collection Pattern: ragbooks_${sourceName}_${documentId}
 *
 * @author Coneja Chibi
 * @version 1.0.0
 */

// ============================================================================
// IMPORTS
// ============================================================================
import {
    eventSource,
    event_types,
    chat,
    chat_metadata,
    saveSettingsDebounced,
    getRequestHeaders,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    is_send_press,
    substituteParams,
    name1,
    name2,
    generateQuietPrompt,
} from '../../../../script.js';
import { getStringHash } from '../../../utils.js';
import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { textgen_types, textgenerationwebui_settings } from '../../../textgen-settings.js';
import { oai_settings } from '../../../openai.js';
import { WebLlmVectorProvider } from '../../vectors/webllm.js';

// RAGBooks advanced features modules
import { createSummaryChunks, filterChunksBySearchMode, expandSummaryChunks, mergeSearchResults, processScenesToChunks } from './dual-vector.js';
import { applyImportanceWeighting, applyImportanceToResults, rankChunksByImportance, groupChunksByPriorityTier } from './importance-weighting.js';
import { evaluateConditions, filterChunksByConditions, buildSearchContext, validateConditions } from './conditional-activation.js';
import { buildGroupIndex, applyGroupBoosts, enforceRequiredGroups, getGroupStats } from './chunk-groups.js';
import { applyTemporalDecay, applyDecayToResults, applySceneAwareDecay, getDefaultDecaySettings } from './temporal-decay.js';
import { performEnhancedSearch, performBasicSearch, buildSearchParams, getSearchFunction } from './search-orchestrator.js';
import { generateSummariesForChunks, validateSummarySettings, contentTypeSupportsSummarization } from './summarization.js';
import { cleanText, CLEANING_MODES, CLEANING_PATTERNS, validatePattern } from './text-cleaning.js';
import {
    showProgressModal,
    hideProgressModal,
    updateProgressStep,
    updateProgressStats,
    updateProgressMessage,
    showProgressError,
    showProgressSuccess,
    createParsingCallback,
    createSummarizationCallback
} from './progress-indicator.js';

import {
    semanticChunkText,
    slidingWindowChunk,
    cosineSimilarity,
    splitIntoSentences
} from './semantic-chunking.js';

// Export generateQuietPrompt to window scope for testing/debugging
if (typeof window !== 'undefined') {
    window.generateQuietPrompt = generateQuietPrompt;
}

// ============================================================================
// CONSTANTS
// ============================================================================
const EXTENSION_NAME = 'ragbooks';

// Dynamically get the actual folder name from the script URL
// This works regardless of whether users name it 'RAGBooks', 'ragbooks', etc.
const actualFolderName = new URL(import.meta.url).pathname.split('/').slice(-2, -1)[0];
const MODULE_NAME = actualFolderName;

// Standard SillyTavern extension variables
const extensionName = EXTENSION_NAME;  // Use lowercase for settings key
const extensionFolderPath = `scripts/extensions/third-party/${MODULE_NAME}`;

// Collection ID prefix for RAGBooks collections
const COLLECTION_PREFIX = 'ragbooks_';

// Content source types
const CONTENT_SOURCES = {
    LOREBOOK: 'lorebook',
    CHARACTER: 'character',
    CHAT: 'chat',
    CUSTOM: 'custom'
};

// Chunking strategies
const CHUNKING_STRATEGIES = {
    PER_ENTRY: 'per_entry',        // Lorebooks: one entry = one chunk
    PER_FIELD: 'per_field',        // Characters: description, personality as separate chunks
    BY_SPEAKER: 'by_speaker',      // Chats: group by character turns
    BY_TOPIC: 'by_topic',          // AI-detected topic shifts
    SECTION_BASED: 'section',      // Split by section headers
    SIZE_BASED: 'size',            // Fixed size with overlap
    PARAGRAPH: 'paragraph',        // Split by \n\n
    SMART_MERGE: 'smart_merge',    // Combine related entries
    SEMANTIC: 'semantic',          // AI-powered semantic chunking (embedding similarity)
    SLIDING_WINDOW: 'sliding'      // Sliding window with sentence-aware boundaries
};

// Section header regex for document chunking - LANGUAGE-AGNOSTIC & VERY PERMISSIVE
// \S+ matches ANY Unicode non-whitespace (Chinese/Japanese/Korean/Arabic/Cyrillic/etc.)
// Examples: "## SECTION 1/8", "##セクション 1/8", "# 部分 1/8", "SECCIÓN 1/8", "##Раздел 1/8"
const SECTION_HEADER_REGEX = /^#{1,2}\s*\S+\s+\d+\/\d+/mi;

// Minimum size to be considered a document (3000 chars - more permissive)
const DOCUMENT_MIN_SIZE = 3000;

// BunnymoTags pattern - UNIVERSAL TAG STRUCTURE (works for ALL languages)
// [^\s>]+ matches ANY Unicode non-whitespace (not just English letters)
// Examples: <NAME:John>, <名前:太郎>, <NOMBRE:Juan>, <ИМЯ:Иван>, <이름:철수>, <اسم:أحمد>
const BUNNYMOTAGS_PATTERN = /<[^\s>]+:[^>]+>/;

// Prompt tag used when injecting results into the model
const RAG_PROMPT_TAG = 'ragbooks';
const RAG_BUTTON_CLASS = 'ragbooks-button';
const vectorApiSourcesRequiringUrl = ['ollama', 'llamacpp', 'vllm', 'koboldcpp'];
const DEFAULT_SECTION_TITLE = 'Document';
const MAX_DEBUG_PREVIEW = 180;

const webllmProvider = new WebLlmVectorProvider();

// ============================================================================
// EARLY INITIALIZATION
// ============================================================================
// Initialize extension settings synchronously before async operations start
// This ensures settings are available immediately when the extension loads
// Must be declared after ensureRagState() is defined, so we'll call it at the end of the file

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getCurrentContextLevel() {
    const settings = extension_settings[extensionName]?.rag || {};
    return settings.contextLevel || 'global';
}

function ensureRagState() {
    // CRITICAL: Never overwrite extension_settings[extensionName] completely
    // This would destroy all user settings on page refresh
    if (!extension_settings[extensionName]) {
        // Only initialize if it truly doesn't exist (first-time setup)
        console.warn('⚠️ RAG: extension_settings[extensionName] does not exist - initializing empty object. This should only happen on first load.');
        extension_settings[extensionName] = {};
    }
    if (!extension_settings[extensionName].rag) {
        extension_settings[extensionName].rag = {};
    }
    if (!extension_settings[extensionName].rag.library) {
        extension_settings[extensionName].rag.library = {};
    }
    // Initialize collection metadata structure (for activation triggers)
    if (!extension_settings[extensionName].rag.collectionMetadata) {
        extension_settings[extensionName].rag.collectionMetadata = {};
    }
    // Initialize sources metadata if not exists
    if (!extension_settings[extensionName].rag.sources) {
        extension_settings[extensionName].rag.sources = {};
    }

    // Initialize advanced feature settings with defaults (persist them for consistency)
    const rag = extension_settings[extensionName].rag;
    if (rag.summarySearchMode === undefined) {
        rag.summarySearchMode = 'both';
    }
    if (rag.enableImportance === undefined) {
        rag.enableImportance = true;
    }
    if (rag.usePriorityTiers === undefined) {
        rag.usePriorityTiers = false;
    }
    if (rag.enableConditions === undefined) {
        rag.enableConditions = true;
    }
    if (rag.enableGroups === undefined) {
        rag.enableGroups = true;
    }
    if (rag.groupBoostMultiplier === undefined) {
        rag.groupBoostMultiplier = 1.3;
    }
    if (rag.contextWindow === undefined) {
        rag.contextWindow = 10;
    }
    if (!rag.temporalDecay) {
        rag.temporalDecay = {
            enabled: false,
            mode: 'exponential',
            halfLife: 50,
            linearRate: 0.01,
            minRelevance: 0.3,
            sceneAware: false
        };
    }

    return extension_settings[extensionName].rag;
}

function getContextualLibrary() {
    const contextLevel = getCurrentContextLevel();
    const context = getContext();

    // Ensure base structure exists
    ensureRagState();
    const ragState = extension_settings[extensionName].rag;

    if (!ragState.libraries) {
        ragState.libraries = {
            global: {},
            character: {},
            chat: {}
        };
    }

    // Get the appropriate library based on context level
    switch (contextLevel) {
        case 'character':
            const charId = context?.characterId;
            if (charId !== null && charId !== undefined) {
                if (!ragState.libraries.character[charId]) {
                    ragState.libraries.character[charId] = {};
                }
                return ragState.libraries.character[charId];
            }
            // Fallback to global if no character
            return ragState.libraries.global;

        case 'chat':
            const chatId = context?.chatId;
            if (chatId) {
                if (!ragState.libraries.chat[chatId]) {
                    ragState.libraries.chat[chatId] = {};
                }
                return ragState.libraries.chat[chatId];
            }
            // Fallback to global if no chat
            return ragState.libraries.global;

        case 'global':
        default:
            return ragState.libraries.global;
    }
}

/**
 * Get ALL contextual libraries relevant to the current chat context
 * Returns: { global: {...}, character: {...}, chat: {...} } with actual library objects
 */
function getAllContextualLibraries() {
    const context = getContext();
    ensureRagState();
    const ragState = extension_settings[extensionName].rag;

    if (!ragState.libraries) {
        ragState.libraries = {
            global: {},
            character: {},
            chat: {}
        };
    }

    const result = {
        global: ragState.libraries.global || {},
        character: null,
        chat: null
    };

    // Add character library if we have a character context
    const charId = context?.characterId;
    if (charId !== null && charId !== undefined) {
        if (!ragState.libraries.character[charId]) {
            ragState.libraries.character[charId] = {};
        }
        result.character = ragState.libraries.character[charId];
    }

    // Add chat library if we have a chat context
    const chatId = context?.chatId;
    if (chatId) {
        if (!ragState.libraries.chat[chatId]) {
            ragState.libraries.chat[chatId] = {};
        }
        result.chat = ragState.libraries.chat[chatId];
    }

    return result;
}

/**
 * Get all sources that are relevant to the current context (scope-aware)
 * Returns sources from global + character-specific + chat-specific scopes
 */
function getScopedSources() {
    const context = getContext();
    const ragState = ensureRagState();

    // Ensure scoped sources structure exists
    if (!ragState.scopedSources) {
        ragState.scopedSources = {
            global: {},
            character: {},
            chat: {}
        };
    }

    const result = {};

    // Always include global sources
    Object.assign(result, ragState.scopedSources.global || {});

    // Add character-specific sources if we have a character
    const charId = context?.characterId;
    if (charId !== null && charId !== undefined) {
        if (!ragState.scopedSources.character[charId]) {
            ragState.scopedSources.character[charId] = {};
        }
        Object.assign(result, ragState.scopedSources.character[charId]);
    }

    // Add chat-specific sources if we have a chat
    const chatId = context?.chatId;
    if (chatId) {
        if (!ragState.scopedSources.chat[chatId]) {
            ragState.scopedSources.chat[chatId] = {};
        }
        Object.assign(result, ragState.scopedSources.chat[chatId]);
    }

    return result;
}

/**
 * Save a source to the appropriate scoped storage based on metadata
 */
function saveScopedSource(collectionId, sourceData) {
    const ragState = ensureRagState();
    const metadata = ragState.collectionMetadata?.[collectionId];

    if (!metadata) {
        console.warn(`No metadata found for collection ${collectionId}, defaulting to global scope`);
    }

    const scope = metadata?.scope || 'global';
    const scopeIdentifier = metadata?.scopeIdentifier;

    // Ensure scoped sources structure exists
    if (!ragState.scopedSources) {
        ragState.scopedSources = {
            global: {},
            character: {},
            chat: {}
        };
    }

    // Save to appropriate scope
    switch (scope) {
        case 'character':
            if (scopeIdentifier) {
                if (!ragState.scopedSources.character[scopeIdentifier]) {
                    ragState.scopedSources.character[scopeIdentifier] = {};
                }
                ragState.scopedSources.character[scopeIdentifier][collectionId] = sourceData;
            } else {
                // Fallback to global if no identifier
                ragState.scopedSources.global[collectionId] = sourceData;
            }
            break;

        case 'chat':
            if (scopeIdentifier) {
                if (!ragState.scopedSources.chat[scopeIdentifier]) {
                    ragState.scopedSources.chat[scopeIdentifier] = {};
                }
                ragState.scopedSources.chat[scopeIdentifier][collectionId] = sourceData;
            } else {
                // Fallback to global if no identifier
                ragState.scopedSources.global[collectionId] = sourceData;
            }
            break;

        case 'global':
        default:
            ragState.scopedSources.global[collectionId] = sourceData;
            break;
    }

    console.log(`💾 Saved source ${collectionId} to ${scope} scope` + (scopeIdentifier ? ` (${scopeIdentifier})` : ''));
}

/**
 * Delete a scoped source
 */
function deleteScopedSource(collectionId) {
    const ragState = ensureRagState();
    const metadata = ragState.collectionMetadata?.[collectionId];

    if (!metadata || !ragState.scopedSources) {
        // Fallback: try to delete from old flat structure
        if (ragState.sources && ragState.sources[collectionId]) {
            delete ragState.sources[collectionId];
        }
        return;
    }

    const scope = metadata.scope || 'global';
    const scopeIdentifier = metadata.scopeIdentifier;

    // Delete from appropriate scope
    switch (scope) {
        case 'character':
            if (scopeIdentifier && ragState.scopedSources.character[scopeIdentifier]) {
                delete ragState.scopedSources.character[scopeIdentifier][collectionId];
            }
            break;

        case 'chat':
            if (scopeIdentifier && ragState.scopedSources.chat[scopeIdentifier]) {
                delete ragState.scopedSources.chat[scopeIdentifier][collectionId];
            }
            break;

        case 'global':
        default:
            if (ragState.scopedSources.global) {
                delete ragState.scopedSources.global[collectionId];
            }
            break;
    }

    console.log(`🗑️ Deleted source ${collectionId} from ${scope} scope`);
}

/**
 * Migrate flat sources to scoped structure (one-time migration)
 */
function migrateFlatSourcesToScoped() {
    const ragState = ensureRagState();

    // Check if migration already done or no flat sources exist
    if (!ragState.sources || Object.keys(ragState.sources).length === 0) {
        console.log('✅ No flat sources to migrate');
        return { migrated: 0, skipped: 0 };
    }

    // Check if migration flag exists
    if (ragState.scopeMigrationDone) {
        console.log('✅ Scope migration already completed');
        return { migrated: 0, skipped: Object.keys(ragState.sources).length };
    }

    console.log('🔄 Starting migration of flat sources to scoped structure...');

    let migrated = 0;
    let skipped = 0;

    for (const [collectionId, sourceData] of Object.entries(ragState.sources)) {
        try {
            // Use saveScopedSource which reads metadata and places in correct scope
            saveScopedSource(collectionId, sourceData);
            migrated++;
        } catch (error) {
            console.error(`Failed to migrate ${collectionId}:`, error);
            skipped++;
        }
    }

    // Mark migration as done
    ragState.scopeMigrationDone = true;

    // Keep flat sources for backup during transition
    console.log(`✅ Migration complete: ${migrated} migrated, ${skipped} skipped`);
    console.log('📝 Flat sources kept as backup (can be removed manually if needed)');

    saveSettingsDebounced();

    return { migrated, skipped };
}

/**
 * Recover orphaned collections by rebuilding scopedSources from libraries and sources data
 * This fixes collections that disappeared from the UI but still have their data intact
 */
function recoverOrphanedCollections() {
    const ragState = ensureRagState();
    const recovered = [];
    const skipped = [];

    console.log('🔍 [Recovery] Scanning for orphaned collections...');

    // Ensure scopedSources structure exists
    if (!ragState.scopedSources) {
        ragState.scopedSources = {
            global: {},
            character: {},
            chat: {}
        };
    }

    // Check all libraries (global, character, chat)
    const allLibraries = {
        global: ragState.libraries?.global || {},
        character: ragState.libraries?.character || {},
        chat: ragState.libraries?.chat || {}
    };

    for (const [scopeType, library] of Object.entries(allLibraries)) {
        if (scopeType === 'global') {
            // Process global library directly
            for (const collectionId of Object.keys(library)) {
                const sourceData = ragState.sources?.[collectionId];
                const chunks = library[collectionId];

                // Check if collection has data but is missing from scopedSources
                if (chunks && Object.keys(chunks).length > 0) {
                    const existsInScoped = ragState.scopedSources.global?.[collectionId];

                    if (!existsInScoped && sourceData) {
                        // Restore to scopedSources
                        ragState.scopedSources.global[collectionId] = sourceData;
                        recovered.push({
                            id: collectionId,
                            name: sourceData.name,
                            type: sourceData.type,
                            chunks: Object.keys(chunks).length,
                            scope: 'global'
                        });
                        console.log(`✅ [Recovery] Restored global collection: ${collectionId} (${Object.keys(chunks).length} chunks)`);
                    } else if (!sourceData) {
                        skipped.push({
                            id: collectionId,
                            reason: 'No source metadata found',
                            chunks: Object.keys(chunks).length
                        });
                        console.warn(`⚠️ [Recovery] Collection ${collectionId} has chunks but no source metadata`);
                    }
                }
            }
        } else {
            // Process character/chat scoped libraries
            for (const [scopeIdentifier, scopedCollections] of Object.entries(library)) {
                for (const collectionId of Object.keys(scopedCollections)) {
                    const sourceData = ragState.sources?.[collectionId];
                    const chunks = scopedCollections[collectionId];

                    if (chunks && Object.keys(chunks).length > 0) {
                        const existsInScoped = ragState.scopedSources[scopeType]?.[scopeIdentifier]?.[collectionId];

                        if (!existsInScoped && sourceData) {
                            // Ensure nested structure exists
                            if (!ragState.scopedSources[scopeType][scopeIdentifier]) {
                                ragState.scopedSources[scopeType][scopeIdentifier] = {};
                            }

                            // Restore to scopedSources
                            ragState.scopedSources[scopeType][scopeIdentifier][collectionId] = sourceData;
                            recovered.push({
                                id: collectionId,
                                name: sourceData.name,
                                type: sourceData.type,
                                chunks: Object.keys(chunks).length,
                                scope: `${scopeType}:${scopeIdentifier}`
                            });
                            console.log(`✅ [Recovery] Restored ${scopeType} collection: ${collectionId} (${Object.keys(chunks).length} chunks)`);
                        } else if (!sourceData) {
                            skipped.push({
                                id: collectionId,
                                reason: 'No source metadata found',
                                chunks: Object.keys(chunks).length,
                                scope: `${scopeType}:${scopeIdentifier}`
                            });
                        }
                    }
                }
            }
        }
    }

    if (recovered.length > 0) {
        saveSettingsDebounced();
        console.log(`✅ [Recovery] Successfully recovered ${recovered.length} collection(s)`);
        return { success: true, recovered, skipped };
    } else if (skipped.length > 0) {
        console.log(`⚠️ [Recovery] Found ${skipped.length} orphaned chunk(s) but couldn't recover (missing source metadata)`);
        return { success: false, recovered: [], skipped };
    } else {
        console.log('✅ [Recovery] No orphaned collections found - all collections are properly registered');
        return { success: true, recovered: [], skipped: [] };
    }
}

// ============================================================================
// VECTOR API HELPERS
// ============================================================================

/**
 * Retrieve vector settings, preferring the core SillyTavern vectors extension configuration
 * so CarrotKernel stays perfectly in sync with the built-in RAG pipeline.
 * Falls back to local overrides only if the core extension isn't available yet.
 */
function getVectorSettings() {
    const defaults = {
        source: 'transformers',
        use_alt_endpoint: false,
        alt_endpoint_url: '',
        togetherai_model: 'togethercomputer/m2-bert-80M-32k-retrieval',
        openai_model: 'text-embedding-ada-002',
        cohere_model: 'embed-english-v3.0',
        ollama_model: 'mxbai-embed-large',
        ollama_keep: false,
        vllm_model: '',
        webllm_model: '',
        google_model: 'text-embedding-005',
    };

    const coreVectorSettings = extension_settings?.vectors;
    if (coreVectorSettings) {
        return {
            source: coreVectorSettings.source ?? defaults.source,
            use_alt_endpoint: coreVectorSettings.use_alt_endpoint ?? defaults.use_alt_endpoint,
            alt_endpoint_url: coreVectorSettings.alt_endpoint_url ?? defaults.alt_endpoint_url,
            togetherai_model: coreVectorSettings.togetherai_model ?? defaults.togetherai_model,
            openai_model: coreVectorSettings.openai_model ?? defaults.openai_model,
            cohere_model: coreVectorSettings.cohere_model ?? defaults.cohere_model,
            ollama_model: coreVectorSettings.ollama_model ?? defaults.ollama_model,
            ollama_keep: coreVectorSettings.ollama_keep ?? defaults.ollama_keep,
            vllm_model: coreVectorSettings.vllm_model ?? defaults.vllm_model,
            webllm_model: coreVectorSettings.webllm_model ?? defaults.webllm_model,
            google_model: coreVectorSettings.google_model ?? defaults.google_model,
        };
    }

    const ragSettings = extension_settings[extensionName]?.rag || {};
    return {
        source: ragSettings.vectorSource || defaults.source,
        use_alt_endpoint: ragSettings.useAltUrl ?? defaults.use_alt_endpoint,
        alt_endpoint_url: ragSettings.altUrl || defaults.alt_endpoint_url,
        togetherai_model: ragSettings.togetheraiModel || defaults.togetherai_model,
        openai_model: ragSettings.openaiModel || defaults.openai_model,
        cohere_model: ragSettings.cohereModel || defaults.cohere_model,
        ollama_model: ragSettings.ollamaModel || defaults.ollama_model,
        ollama_keep: ragSettings.ollamaKeep ?? defaults.ollama_keep,
        vllm_model: ragSettings.vllmModel || defaults.vllm_model,
        webllm_model: ragSettings.webllmModel || defaults.webllm_model,
        google_model: ragSettings.googleModel || defaults.google_model,
    };
}

/**
 * Builds the base body shared across vector API calls.
 * Mirrors native Vectors extension logic so all backend providers keep working.
 * @param {object} overrides
 * @returns {object}
 */
function getVectorsRequestBody(overrides = {}) {
    const vectors = getVectorSettings();
    const body = Object.assign({}, overrides);

    switch (vectors.source) {
        case 'extras':
            body.extrasUrl = extension_settings.apiUrl;
            body.extrasKey = extension_settings.apiKey;
            break;
        case 'togetherai':
            body.model = vectors.togetherai_model;
            break;
        case 'openai':
        case 'mistral':
            body.model = vectors.openai_model;
            break;
        case 'nomicai':
            // No client configuration required; handled server-side with stored secret
            break;
        case 'cohere':
            body.model = vectors.cohere_model;
            break;
        case 'ollama':
            body.model = vectors.ollama_model;
            body.apiUrl = vectors.use_alt_endpoint && vectors.alt_endpoint_url
                ? vectors.alt_endpoint_url
                : textgenerationwebui_settings.server_urls[textgen_types.OLLAMA];
            body.keep = !!vectors.ollama_keep;
            break;
        case 'llamacpp':
            body.apiUrl = vectors.use_alt_endpoint && vectors.alt_endpoint_url
                ? vectors.alt_endpoint_url
                : textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP];
            break;
        case 'vllm':
            body.model = vectors.vllm_model;
            body.apiUrl = vectors.use_alt_endpoint && vectors.alt_endpoint_url
                ? vectors.alt_endpoint_url
                : textgenerationwebui_settings.server_urls[textgen_types.VLLM];
            break;
        case 'webllm':
            body.model = vectors.webllm_model;
            break;
        case 'palm':
            body.model = vectors.google_model;
            body.api = 'makersuite';
            break;
        case 'vertexai':
            body.model = vectors.google_model;
            body.api = 'vertexai';
            body.vertexai_auth_mode = oai_settings.vertexai_auth_mode;
            body.vertexai_region = oai_settings.vertexai_region;
            body.vertexai_express_project_id = oai_settings.vertexai_express_project_id;
            break;
        default:
            break;
    }

    return body;
}

/**
 * Build additional arguments required by some embeddings backends.
 * @param {string[]} items
 * @returns {Promise<object>}
 */
async function getAdditionalVectorArgs(items) {
    const vectors = getVectorSettings();

    switch (vectors.source) {
        case 'webllm': {
            if (!items.length) return {};
            const embeddings = await webllmProvider.embedTexts(items, vectors.webllm_model);
            const result = {};
            for (let i = 0; i < items.length; i++) {
                result[items[i]] = embeddings[i];
            }
            return { embeddings: result };
        }
        case 'koboldcpp': {
            if (!items.length) return {};
            const response = await fetch('/api/backends/kobold/embed', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    items: items,
                    server: vectors.use_alt_endpoint && vectors.alt_endpoint_url
                        ? vectors.alt_endpoint_url
                        : textgenerationwebui_settings.server_urls[textgen_types.KOBOLDCPP],
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to get KoboldCpp embeddings');
            }

            const { embeddings, model } = await response.json();
            return { embeddings, model };
        }
        default:
            return {};
    }
}

/**
 * Basic validation to help users notice incomplete configuration (e.g. Ollama without URL).
 */
function ensureVectorConfig() {
    const vectors = getVectorSettings();
    if (vectorApiSourcesRequiringUrl.includes(vectors.source) && !vectors.use_alt_endpoint && !vectors.alt_endpoint_url) {
        console.warn(`CarrotKernel RAG: Source "${vectors.source}" usually needs a server URL. Set one in the Vectors extension if you see embedding errors.`);
    }
}

/**
 * Get saved hashes for a collection (checks if collection exists)
 */
async function apiGetSavedHashes(collectionId) {
    ensureVectorConfig();
    const body = {
        ...getVectorsRequestBody(await getAdditionalVectorArgs([])),
        collectionId: collectionId,
        source: getVectorSettings().source,
    };
    debugLog('[API] apiGetSavedHashes request body:', body); // ADDED

    const response = await fetch('/api/vector/list', {
        method: 'POST',
        headers: getRequestHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify(body), // MODIFIED to use body var
    });

    if (!response.ok) {
        const errorText = await response.text(); // ADDED
        debugLog('[API] apiGetSavedHashes ERROR:', { status: response.status, text: errorText }); // ADDED
        throw new Error(`Failed to get saved hashes for collection ${collectionId}. Status: ${response.status}. Message: ${errorText}`); // MODIFIED
    }

    const jsonResponse = await response.json(); // ADDED
    debugLog('[API] apiGetSavedHashes SUCCESS response:', jsonResponse); // ADDED
    return jsonResponse; // MODIFIED
}

/**
 * Insert vector items into a collection
 */
async function apiInsertVectorItems(collectionId, items) {
    ensureVectorConfig();

    // Final safety check: filter out any items with empty text
    const validItems = items.filter(item => item.text && item.text.trim().length > 0);

    if (validItems.length === 0) {
        console.warn('[RAGBooks] apiInsertVectorItems called with no valid items (all empty text)');
        return; // Early return, no items to insert
    }

    if (validItems.length < items.length) {
        console.warn(`[RAGBooks] Filtered ${items.length - validItems.length} items with empty text in apiInsertVectorItems`);
    }

    const args = await getAdditionalVectorArgs(validItems.map(item => item.text));
    const body = {
        ...getVectorsRequestBody(args),
        collectionId: collectionId,
        items: validItems.map(item => ({
            hash: item.hash,
            text: item.text,
            index: item.index,
        })),
        source: getVectorSettings().source,
    };
    debugLog('[API] apiInsertVectorItems request body:', body); // ADDED

    const response = await fetch('/api/vector/insert', {
        method: 'POST',
        headers: getRequestHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify(body), // MODIFIED
    });

    if (!response.ok) {
        const errorText = await response.text(); // ADDED
        debugLog('[API] apiInsertVectorItems ERROR:', { status: response.status, text: errorText }); // ADDED
        throw new Error(`Failed to insert vector items for collection ${collectionId}. Status: ${response.status}. Message: ${errorText}`); // MODIFIED
    }
    debugLog('[API] apiInsertVectorItems SUCCESS'); // ADDED
}

/**
 * Query a vector collection
 */
async function apiQueryCollection(collectionId, searchText, topK, threshold = 0.2) {
    ensureVectorConfig();

    const args = await getAdditionalVectorArgs([searchText]);

    const response = await fetch('/api/vector/query', {
        method: 'POST',
        headers: getRequestHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({
            ...getVectorsRequestBody(args),
            collectionId: collectionId,
            searchText: searchText,
            topK: topK,
            source: getVectorSettings().source,
            threshold: threshold,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to query collection ${collectionId}`);
    }

    return await response.json();
}

/**
 * Delete specific hashes from a vector collection
 */
async function apiDeleteVectorHashes(collectionId, hashes) {
    ensureVectorConfig();

    const response = await fetch('/api/vector/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({
            collectionId: collectionId,
            hashes: hashes,
            source: getVectorSettings().source,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete vectors from ${collectionId}. Status: ${response.status}. Message: ${errorText}`);
    }

    return await response.json();
}

/**
 * Delete an entire vector collection
 */
async function apiDeleteCollection(collectionId) {
    ensureVectorConfig();

    const response = await fetch('/api/vector/purge', {
        method: 'POST',
        headers: getRequestHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({
            collectionId: collectionId,
            source: getVectorSettings().source,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to purge collection ${collectionId}. Status: ${response.status}. Message: ${errorText}`);
    }

    // API returns plain text "OK" instead of JSON
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return { success: true, message: text };
    }
}

/**
 * Update chunks in the library with modified data from chunk visualizer
 * Handles metadata updates (keywords, weights, links) and text changes (re-vectorization)
 *
 * @param {string} collectionId - Collection ID to update
 * @param {Object} chunks - Modified chunks object { hash: chunkData, ... }
 * @returns {Promise<void>}
 */
/**
 * Save chunks to library (for new collections)
 */
async function saveChunksToLibrary(collectionId, chunks) {
    console.log('💾 [saveChunksToLibrary] Saving new collection...', {
        collectionId,
        chunkCount: chunks.length
    });

    const library = getContextualLibrary();

    // Initialize collection in library
    library[collectionId] = {};

    // Convert array of chunks to hash-indexed object
    chunks.forEach((chunk, index) => {
        const hash = chunk.hash || getStringHash(chunk.text);

        // DEFENSIVE FALLBACK: Ensure name has a value from topic, section, or text
        let chunkName = chunk.name || chunk.topic || chunk.section || chunk.metadata?.section || chunk.metadata?.topic || '';
        if (!chunkName && chunk.text) {
            // Last resort: generate from first sentence of text
            chunkName = getFirstSentenceTitle(chunk.text, 80) || 'Untitled Chunk';
        }

        library[collectionId][hash] = {
            text: chunk.text,
            metadata: chunk.metadata || {},
            hash: hash,
            index: index,
            // Keyword system
            keywords: Array.isArray(chunk.keywords) ? chunk.keywords : [],
            systemKeywords: chunk.systemKeywords || chunk.keywords || [],
            customKeywords: chunk.customKeywords || [],
            customWeights: chunk.customWeights || {},
            disabledKeywords: chunk.disabledKeywords || [],
            // Titles & comments
            name: chunkName,  // User-editable title with fallbacks
            section: chunk.section || chunk.metadata?.section || '',
            topic: chunk.topic || chunk.metadata?.topic || '',
            comment: chunk.comment || '',
            // Linking system
            chunkLinks: chunk.chunkLinks || [],
            // Inclusion system
            inclusionGroup: chunk.inclusionGroup || '',
            inclusionPrioritize: chunk.inclusionPrioritize || false,
            // Enabled/disabled state
            disabled: chunk.disabled || false,
            // NEW: Summary system (Phase 1)
            summary: chunk.summary || '',                    // Short abstract for semantic search
            summaryVector: chunk.summaryVector !== undefined ? chunk.summaryVector : false,  // Create separate embedding?
            summaryVectors: chunk.summaryVectors || [],      // Multiple searchable summary tags (array)
            isSummaryChunk: chunk.isSummaryChunk || false,   // Is this a summary-only chunk?
            parentHash: chunk.parentHash || null,            // If summary chunk, hash of parent
            // NEW: Importance weighting (Phase 3)
            importance: chunk.importance !== undefined ? chunk.importance : 100,  // 0-200%, default 100% (neutral)
            // NEW: Conditional activation (Phase 3)
            conditions: chunk.conditions || {
                enabled: false,
                mode: 'AND',
                rules: []
            },
            // NEW: Chunk groups (Phase 4)
            chunkGroup: chunk.chunkGroup || {
                name: '',
                groupKeywords: [],
                requiresGroupMember: false
            }
        };
    });

    // Library is a reference to extension_settings, so changes are automatically persisted
    // Just trigger a save to write to disk
    saveSettingsDebounced();

    console.log(`✅ Saved ${chunks.length} chunks to library for collection ${collectionId}`);
}

/**
 * Get chunks from library for a specific collection (searches all scopes)
 * @param {string} collectionId - Collection ID to retrieve
 * @returns {Object|null} Chunks object or null if not found
 */
function getChunksFromLibrary(collectionId) {
    const ragState = ensureRagState();

    // First check flat library (for backward compatibility)
    if (ragState.library?.[collectionId]) {
        console.log('[getChunksFromLibrary] Found chunks in flat library');
        return ragState.library[collectionId];
    }

    // Then search ALL scoped libraries (global, character, chat)
    const allLibraries = getAllContextualLibraries();

    // Check global scope
    if (allLibraries.global?.[collectionId]) {
        console.log('[getChunksFromLibrary] Found chunks in global scope');
        return allLibraries.global[collectionId];
    }

    // Check character scope
    if (allLibraries.character?.[collectionId]) {
        console.log('[getChunksFromLibrary] Found chunks in character scope');
        return allLibraries.character[collectionId];
    }

    // Check chat scope
    if (allLibraries.chat?.[collectionId]) {
        console.log('[getChunksFromLibrary] Found chunks in chat scope');
        return allLibraries.chat[collectionId];
    }

    console.warn('[getChunksFromLibrary] No chunks found for collection:', collectionId);
    return null;
}

/**
 * Delete chunks from library for a specific collection
 * @param {string} collectionId - Collection ID to delete
 */
function deleteChunksFromLibrary(collectionId) {
    const library = getContextualLibrary();
    if (library[collectionId]) {
        delete library[collectionId];
        saveSettingsDebounced();
        console.log(`🗑️ Deleted collection ${collectionId} from library`);
    }
}

async function updateChunksInLibrary(collectionId, chunks) {
    console.log('📝 [updateChunksInLibrary] Starting update...', {
        collectionId,
        chunkCount: Object.keys(chunks).length
    });

    const library = getContextualLibrary();

    if (!library[collectionId]) {
        throw new Error(`Collection ${collectionId} not found in library`);
    }

    const chunksToRevectorize = [];
    const updatedHashes = [];

    // Process each modified chunk
    for (const [hash, chunkData] of Object.entries(chunks)) {
        const existingChunk = library[collectionId][hash];

        if (!existingChunk) {
            console.warn(`⚠️ Chunk ${hash} not found in library - skipping`);
            continue;
        }

        // Normalize chunk data structure (handle both flat and nested metadata)
        const chunkText = chunkData.text;
        const metadata = chunkData.metadata || chunkData;

        // Check if text content changed (requires re-vectorization)
        const textChanged = existingChunk.text !== chunkText;

        if (textChanged) {
            console.log(`🔄 Text changed for chunk ${hash} - will re-vectorize`);
            chunksToRevectorize.push({
                hash: parseInt(hash),
                text: chunkText,
                index: metadata.index || 0,
                metadata: {
                    ...metadata,
                    // Ensure text is NOT stored in metadata (it's separate)
                    text: undefined
                }
            });
        }

        // CRITICAL FIX: Properly merge all chunk data
        // The issue was that we were destructuring and potentially losing fields
        // Now we explicitly keep ALL fields from chunkData and just ensure text is handled correctly

        const updatedChunk = {
            // Start with existing chunk to preserve any fields we might not be updating
            ...existingChunk,
            // Override with new chunk data (this includes all edits from the viewer)
            ...chunkData,
            // Text must be at top level, not in metadata
            text: chunkText,
            // If chunkData has metadata object, merge it but don't nest it
            ...(chunkData.metadata || {})
        };

        // Remove the nested metadata object if it exists (we've already spread its contents)
        delete updatedChunk.metadata;

        // DEBUG: Log what we're saving (only first chunk)
        if (Object.keys(chunks).indexOf(hash) === 0) {
            console.log('[updateChunksInLibrary] First chunk save debug:', {
                hash,
                'updatedChunk.name': updatedChunk.name,
                'updatedChunk.keywords': updatedChunk.keywords?.length,
                'updatedChunk.text length': updatedChunk.text?.length,
                'updatedChunk fields': Object.keys(updatedChunk).slice(0, 15).join(', ')
            });
        }

        // DEFENSIVE FALLBACK #1: Ensure name field always has a value
        if (!updatedChunk.name || updatedChunk.name.trim() === '') {
            updatedChunk.name = updatedChunk.topic || updatedChunk.section || getFirstSentenceTitle(updatedChunk.text, 80) || 'Untitled Chunk';
            console.warn(`⚠️ Chunk ${hash} missing name - using fallback: "${updatedChunk.name}"`);
        }

        // DEFENSIVE FALLBACK #2: Ensure arrays are initialized
        if (!Array.isArray(updatedChunk.keywords)) {
            updatedChunk.keywords = [];
        }
        if (!Array.isArray(updatedChunk.summaryVectors)) {
            updatedChunk.summaryVectors = [];
        }
        if (!Array.isArray(updatedChunk.chunkLinks)) {
            updatedChunk.chunkLinks = [];
        }

        // DEFENSIVE FALLBACK #3: Ensure customWeights is an object
        if (!updatedChunk.customWeights || typeof updatedChunk.customWeights !== 'object') {
            updatedChunk.customWeights = {};
        }

        // Write the fully merged chunk back to the library
        library[collectionId][hash] = updatedChunk;

        updatedHashes.push(hash);
    }

    // CRITICAL: Force immediate save to extension_settings
    // Using debounced save can sometimes lose data if page closes before debounce fires
    console.log(`💾 [updateChunksInLibrary] Saving ${updatedHashes.length} chunks to extension_settings...`);

    try {
        // Call saveSettingsDebounced to trigger the save
        saveSettingsDebounced();

        // Verify the save by checking the library reference
        const verifyLibrary = getContextualLibrary();
        if (!verifyLibrary[collectionId]) {
            throw new Error('Library verification failed - collection disappeared after save!');
        }

        // Verify first chunk was actually saved
        const firstHash = updatedHashes[0];
        if (firstHash && !verifyLibrary[collectionId][firstHash]) {
            throw new Error(`Library verification failed - chunk ${firstHash} not found after save!`);
        }

        console.log(`✅ Updated ${updatedHashes.length} chunks in library (verified)`);
    } catch (saveError) {
        console.error('❌ [updateChunksInLibrary] Save verification failed:', saveError);
        throw new Error(`Failed to save chunks: ${saveError.message}`);
    }

    // Re-vectorize chunks with changed text
    if (chunksToRevectorize.length > 0) {
        console.log(`🔬 Re-vectorizing ${chunksToRevectorize.length} chunks with text changes...`);

        try {
            // Delete old vectors
            const hashesToDelete = chunksToRevectorize.map(c => c.hash);
            await apiDeleteVectorHashes(collectionId, hashesToDelete);
            console.log(`🗑️  Deleted ${hashesToDelete.length} old vectors`);

            // Insert new vectors with updated text
            const itemsToInsert = chunksToRevectorize;

            await apiInsertVectorItems(collectionId, itemsToInsert);
            console.log(`✅ Re-vectorized ${itemsToInsert.length} chunks`);

            toastr.success(`Updated ${updatedHashes.length} chunks (${chunksToRevectorize.length} re-vectorized)`);
        } catch (error) {
            console.error('❌ Re-vectorization failed:', error);
            toastr.error(`Failed to re-vectorize chunks: ${error.message}`);
            throw error;
        }
    } else {
        toastr.success(`Updated ${updatedHashes.length} chunks`);
    }

    console.log('✅ [updateChunksInLibrary] Update complete');
}

// ============================================================================
// SETTINGS MANAGEMENT
// ============================================================================

/**
 * Get RAG settings with defaults
 */
function getRAGSettings() {
    const ragState = ensureRagState();

    return {
        enabled: ragState.enabled ?? false,
        orangeMode: ragState.orangeMode ?? true, // Orange accent mode (default on)
        simpleChunking: ragState.simpleChunking ?? false,
        chunkSize: ragState.chunkSize ?? 1000,
        chunkOverlap: ragState.chunkOverlap ?? 300,
        topK: ragState.topK ?? 3,
        threshold: ragState.threshold ?? 0.15, // RAGBooks uses 'threshold' instead of 'scoreThreshold'
        scoreThreshold: ragState.scoreThreshold ?? 0.15,
        queryContext: ragState.queryContext ?? 3, // Number of recent messages to use for query
        injectionDepth: ragState.injectionDepth ?? 4,
        injectionRole: ragState.injectionRole ?? 'system',
        autoVectorize: ragState.autoVectorize ?? true,
        debugMode: ragState.debugMode ?? false,
        smartCrossReference: ragState.smartCrossReference ?? true,
        crosslinkThreshold: ragState.crosslinkThreshold ?? 0.25,
        lastEmbeddingSource: ragState.lastEmbeddingSource ?? null,
        lastEmbeddingModel: ragState.lastEmbeddingModel ?? null,
        keywordFallback: ragState.keywordFallback ?? true,
        keywordFallbackPriority: ragState.keywordFallbackPriority ?? false,
        keywordFallbackLimit: ragState.keywordFallbackLimit ?? 2,
        sources: ragState.sources ?? {}, // RAGBooks collection metadata
        // Advanced features
        summarySearchMode: ragState.summarySearchMode ?? 'both',
        enableImportance: ragState.enableImportance !== false, // default true
        usePriorityTiers: ragState.usePriorityTiers ?? false,
        enableConditions: ragState.enableConditions !== false, // default true
        enableGroups: ragState.enableGroups !== false, // default true
        groupBoostMultiplier: ragState.groupBoostMultiplier ?? 1.3,
        contextWindow: ragState.contextWindow ?? 10, // For conditional activation
        temporalDecay: ragState.temporalDecay ?? {
            enabled: false,
            mode: 'exponential',
            halfLife: 50,
            linearRate: 0.01,
            minRelevance: 0.3,
            sceneAware: false
        },
    };
}

/**
 * Save RAG settings
 */
function saveRAGSettings(ragSettings) {
    const ragState = ensureRagState();
    Object.assign(ragState, ragSettings);
    saveSettingsDebounced();
}

/**
 * Debug logging helper
 */
function debugLog(message, data = null) {
    const settings = getRAGSettings();
    if (settings.debugMode) {
        console.log(`🔍 [CarrotKernel RAG] ${message}`, data || '');
    }
}

// ============================================================================
// CHARACTER NAME & COLLECTION
// ============================================================================

/**
 * Generate collection ID for a character
 *
 * @param {string} characterName - Character name
 * @returns {string} Collection ID (e.g., "carrotkernel_char_Atsu")
 */
function generateCollectionId(characterName, contextOverride = null) {
    // Sanitize character name (keep Unicode letters, numbers, and underscores)
    // This preserves non-English characters while removing only problematic symbols
    const sanitized = characterName
        .replace(/[\s\-]+/g, '_')  // Replace spaces and hyphens with underscores
        .replace(/[^\p{L}\p{N}_]/gu, '_')  // Keep Unicode letters (\p{L}), numbers (\p{N}), and underscores
        .replace(/_+/g, '_')  // Collapse multiple underscores
        .replace(/^_|_$/g, '')  // Remove leading/trailing underscores
        .toLowerCase();

    // Include context level in collection ID to prevent cross-contamination
    const contextLevel = contextOverride || getCurrentContextLevel();
    const context = getContext();

    let collectionId = `${COLLECTION_PREFIX}${sanitized}`;

    // Add context suffix based on storage level
    switch(contextLevel) {
        case 'chat':
            const chatId = context?.chatId;
            if (chatId) {
                // Include chat ID to keep chat-level embeddings separate
                const safeChatId = String(chatId).replace(/[^a-z0-9_]/gi, '_').toLowerCase();
                collectionId += `_chat_${safeChatId}`;
            }
            break;
        case 'character':
            const charId = context?.characterId;
            if (charId !== null && charId !== undefined) {
                // Include character ID to keep character-level embeddings separate
                collectionId += `_charid_${charId}`;
            }
            break;
        case 'global':
        default:
            // Global uses just the character name (shared across all contexts)
            break;
    }

    return collectionId;
}

// ============================================================================
// DOCUMENT CHUNKING
// ============================================================================

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'it', 'its',
    'his', 'her', 'their', 'he', 'she', 'they', 'them', 'we', 'you', 'i'
]);

/**
 * Very lightweight stemming to help keyword overlap (handles plural/past variations).
 * @param {string} word
 * @returns {string}
 */
function normalizeKeyword(word) {
    // Check if case-sensitive matching is enabled
    const caseSensitive = extension_settings[extensionName]?.rag?.caseSensitiveKeywords || false;

    // If case-sensitive, preserve original case; otherwise lowercase
    let normalized = caseSensitive ? word : word.toLowerCase();

    // Apply stemming only if not case-sensitive (stemming requires lowercase)
    if (!caseSensitive) {
        const replacements = [
            /(?:ing|ingly)$/,
            /(?:edly|edly)$/,
            /(?:edly)$/,
            /(?:tion|tions)$/,
            /(?:ment|ments)$/,
            /(?:ness|nesses)$/,
            /(?:ally|ally)$/,
            /(?:ies)$/,
            /(?:ers|er)$/,
            /(?:less)$/,
            /(?:ful)$/,
            /(?:ous)$/,
            /(?:ly)$/,
            /(?:ed)$/,
            /(?:es)$/,
            /(?:s)$/,
        ];

        for (const regex of replacements) {
            if (regex.test(normalized)) {
                normalized = normalized.replace(regex, '');
                break;
            }
        }

        if (normalized.length < 4) {
            normalized = word.toLowerCase();
        }
    }

    return normalized;
}

const KEYWORD_GROUPS = {
    identity: {
        priority: 35,
        keywords: ['identity', 'introduction', 'name', 'titles', 'title', 'role', 'occupation', 'species', 'gender', 'pronouns', 'age', 'core context', 'summary', 'overview', 'genre', 'archetype'],
    },
    physical: {
        priority: 45,
        keywords: ['physical', 'appearance', 'body', 'physique', 'build', 'height', 'weight', 'hair', 'eyes', 'skin', 'hands', 'aura', 'presence', 'intimate details', 'style', 'fashion'],
        tagHints: ['PHYS', 'BUILD', 'SKIN', 'HAIR', 'STYLE'],
        regexes: [
            { pattern: '\\bphysic(?:al|s)?\\b', flags: 'i' },
            { pattern: '\\bappearance\\b', flags: 'i' },
            { pattern: '\\baura\\b', flags: 'i' },
        ],
    },
    psyche: {
        priority: 55,
        keywords: ['psyche', 'behavior', 'psychology', 'motivation', 'moral', 'value system', 'personality', 'desire', 'fear', 'habit', 'vulnerability', 'growth'],
    },
    relational: {
        priority: 60,
        keywords: ['relationship', 'dynamic', 'bond', 'social', 'loyalty', 'alliances', 'power dynamic', 'manipulation', 'possessive', 'protective', 'interaction'],
        tagHints: ['CHEMISTRY', 'RELATIONSHIP', 'CONFLICT'],
        regexes: [
            { pattern: '\\bpower dynamic', flags: 'i' },
            { pattern: '\\brelationship\\b', flags: 'i' },
        ],
    },
    linguistic: {
        priority: 40,
        keywords: ['linguistic', 'voice', 'tone', 'speech', 'language', 'dialect', 'accent', 'phrases', 'expressions', 'kaomoji', 'verbal', 'communication', 'words', 'word choice'],
    },
    origin: {
        priority: 35,
        keywords: ['origin', 'history', 'backstory', 'timeline', 'legacy', 'heritage', 'ancestry', 'milestones', 'past', 'foundation'],
    },
    aesthetic: {
        priority: 30,
        keywords: ['aesthetic', 'style', 'presentation', 'fashion', 'silhouette', 'design', 'color palette', 'visual identity'],
    },
    chemistry: {
        priority: 90,
        keywords: ['chemistry', 'spark', 'connection', 'compatibility', 'resonance', 'magnetism', 'charge'],
        regexes: [
            { pattern: '\\bchemistry\\b', flags: 'i' },
            { pattern: '\\bmagn(?:etism|etic)\\b', flags: 'i' },
        ],
    },
    dere: {
        priority: 85,
        keywords: ['dere', 'sadodere', 'tsundere', 'yandere', 'oujidere', 'kuudere', 'dandere', 'archetype'],
        tagHints: ['Dere'],
        regexes: [{ pattern: '\\bdere\\b', flags: 'i' }],
    },
    attachment: {
        priority: 95,
        keywords: ['attachment', 'bonding', 'fearful-avoidant', 'anxious', 'security', 'validation', 'trust', 'connection approach', 'conflict integration'],
        tagHints: ['ATTACHMENT'],
        regexes: [
            { pattern: '\\battachment\\b', flags: 'i' },
            { pattern: '\\bavoidant\\b', flags: 'i' },
        ],
    },
    trauma: {
        priority: 120,
        keywords: ['trauma', 'wound', 'wounds', 'scar', 'scarred', 'trigger', 'triggered', 'ptsd', 'flashback', 'fight response', 'freeze response', 'flight response', 'healing', 'coping', 'psychological wound', 'resilience'],
        tagHints: ['TRAUMA', 'WOUND'],
        regexes: [
            { pattern: '\\btrauma\\b', flags: 'i' },
            { pattern: '\\btrigger(?:ed|s)?\\b', flags: 'i' },
            { pattern: '\\bflashback\\b', flags: 'i' },
            { pattern: '\\bptsd\\b', flags: 'i' },
        ],
    },
    boundaries: {
        priority: 130,
        keywords: ['boundary', 'boundaries', 'limit', 'limits', 'consent', 'personal space', 'crossing the line', 'violation', 'respect', 'perimeter', 'barrier', 'invasion', 'permission'],
        tagHints: ['BOUNDARIES', 'CONSENT'],
        regexes: [
            { pattern: '\\bboundar(?:y|ies)\\b', flags: 'i' },
            { pattern: '\\bhard\\s+limit(s)?\\b', flags: 'i' },
            { pattern: '\\bsoft\\s+limit(s)?\\b', flags: 'i' },
            { pattern: '\\bcross(?:ed)?\\s+the\\s+line\\b', flags: 'i' },
            { pattern: '\\bconsent\\b', flags: 'i' },
            { pattern: '\\bpersonal\\s+space\\b', flags: 'i' },
        ],
    },
    flirting: {
        priority: 100,
        keywords: ['flirt', 'flirting', 'seduce', 'seduction', 'tease', 'teasing', 'coax', 'coquette', 'playful touch', 'cruel flirting', 'charm'],
        tagHints: ['FLIRTING'],
        regexes: [
            { pattern: '\\bflirt(?:ing|s)?\\b', flags: 'i' },
            { pattern: '\\bseduce(?:s|d|r)?\\b', flags: 'i' },
            { pattern: '\\bteas(?:e|ing)\\b', flags: 'i' },
        ],
    },
    jealousy: {
        priority: 110,
        keywords: ['jealous', 'jealousy', 'envious', 'possessive', 'territorial', 'threatened', 'insecure', 'clingy'],
        tagHints: ['JEALOUSY'],
        regexes: [
            { pattern: '\\bjealous(?:y)?\\b', flags: 'i' },
            { pattern: '\\bpossessive\\b', flags: 'i' },
            { pattern: '\\bterritorial\\b', flags: 'i' },
        ],
    },
    arousal: {
        priority: 105,
        keywords: ['arousal', 'aroused', 'turned on', 'excited', 'lust', 'desire', 'yearning', 'heated', 'breathless', 'horny'],
        tagHints: ['AROUSAL', 'NSFW'],
        regexes: [
            { pattern: '\\barous(?:al|ed)\\b', flags: 'i' },
            { pattern: '\\blust(?:ful)?\\b', flags: 'i' },
            { pattern: '\\bturned\\s+on\\b', flags: 'i' },
        ],
    },
    conflict: {
        priority: 90,
        keywords: ['conflict', 'resolution', 'de-escalation', 'deescalation', 'mediation', 'negotiation', 'intervention', 'hostility', 'argument', 'dispute', 'reconciliation'],
        tagHints: ['CONFLICT', 'RESOLUTION'],
        regexes: [
            { pattern: '\bconflicts?\b', flags: 'i' },
            { pattern: '\bresolution\b', flags: 'i' },
            { pattern: '\bde-?escalat', flags: 'i' },
        ],
    },
    hiddenDepths: {
        priority: 45,
        keywords: ['hidden', 'secret', 'depths', 'private', 'shame', 'fear', 'mask', 'reality', 'vulnerable', 'concealed'],
    },
    tagSynthesis: {
        priority: 25,
        keywords: ['tag', 'synthesis', 'metadata', 'bunnymotags', 'summary', 'consolidated'],
    },
};

const KEYWORD_PRESETS = [
    { match: /Character Title|Core Identity|Context/i, groups: ['identity'] },
    { match: /Physical Manifestation/i, groups: ['physical'] },
    { match: /Psyche|Behavioral Matrix|Psychological Analysis/i, groups: ['psyche'] },
    { match: /Relational Dynamics|Social Architecture|Relationship/i, groups: ['relational', 'jealousy', 'boundaries'] },
    { match: /Linguistic Signature|Communication DNA/i, groups: ['linguistic'] },
    { match: /Origin Story|Historical Tapestry/i, groups: ['origin'] },
    { match: /Aesthetic Expression|Style Philosophy/i, groups: ['aesthetic'] },
    { match: /Trauma|Resilience/i, groups: ['trauma'] },
    { match: /Boundar/i, groups: ['boundaries'] },
    { match: /Flirt|Flirtation|Flirtation Signature/i, groups: ['flirting', 'arousal'] },
    { match: /Attachment/i, groups: ['attachment'] },
    { match: /Chemistry/i, groups: ['chemistry', 'arousal', 'flirting'] },
    { match: /Dere/i, groups: ['dere', 'flirting'] },
    { match: /Jealousy Dynamics/i, groups: ['jealousy'] },
    { match: /Arousal Architecture/i, groups: ['arousal'] },
    { match: /Conflict Resolution/i, groups: ['conflict', 'boundaries'] },
    { match: /Boundary Architecture/i, groups: ['boundaries'] },
    { match: /Hidden Depths|Secret Architecture/i, groups: ['hiddenDepths'] },
    { match: /Tag Synthesis/i, groups: ['tagSynthesis'] },
];

const KEYWORD_GROUP_REGEX_RULES = KEYWORD_PRESETS
    .filter(preset => preset.regexes)
    .flatMap(preset => preset.regexes || []);

const KEYWORD_PRIORITY_CACHE = new Map();
const KEYWORD_REGEX_LOOKUP = [];

for (const [groupKey, data] of Object.entries(KEYWORD_GROUPS)) {
    const priority = data.priority ?? 20;
    if (Array.isArray(data.keywords)) {
        for (const keyword of data.keywords) {
            KEYWORD_PRIORITY_CACHE.set(normalizeKeyword(keyword), priority);
        }
    }
    if (Array.isArray(data.regexes)) {
        for (const regexEntry of data.regexes) {
            KEYWORD_REGEX_LOOKUP.push({
                group: groupKey,
                pattern: regexEntry.pattern,
                flags: regexEntry.flags || 'i',
                priority,
            });
        }
    }
}

const CUSTOM_KEYWORD_PRIORITY = 140;

function getKeywordPriority(keyword) {
    return KEYWORD_PRIORITY_CACHE.get(normalizeKeyword(keyword)) ?? 20;
}

/**
 * Extract ONLY truly semantic keywords from text - not every single word!
 * Uses frequency analysis and importance weighting.
 * @param {string} text
 * @returns {string[]}
 */
/**
 * Extract keywords using hybrid approach:
 * 1. Title/topic words (language-agnostic)
 * 2. Frequency analysis (language-agnostic)
 * 3. Semantic mapping for English enhancement
 */
function extractKeywords(text, sectionTitle = '', topic = '') {
    // Language-agnostic keyword extraction with weighted frequency analysis
    const weightedKeywords = new Map(); // lowercase -> { word, weight, sources }

    // STEP 1: Extract section title/header words BUT ONLY if they appear in the text
    // This prevents headers from becoming keywords in unrelated sections
    const titleText = (sectionTitle + ' ' + topic)
        .replace(/[^\p{L}\s]/gu, ' ') // Keep all letters (Unicode), remove punctuation
        .split(/\s+/)
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase()));

    const lowerText = text.toLowerCase();

    titleText.forEach(word => {
        const lower = word.toLowerCase();
        // CRITICAL: Only add header word if it actually appears in THIS section's text
        if (lowerText.includes(lower)) {
            if (!weightedKeywords.has(lower)) {
                weightedKeywords.set(lower, {
                    word: lower,
                    weight: 10.0, // HIGH base weight for section header (only when present in text)
                    sources: ['header']
                });
            } else {
                const entry = weightedKeywords.get(lower);
                entry.weight += 10.0;
                entry.sources.push('header');
            }
        }
    });

    // STEP 2: Extract quoted words (HIGH WEIGHT - user explicitly quoted them)
    const quotedMatches = text.matchAll(/["'"`]([\p{L}\s]{3,}?)["'"`]/gu);
    for (const match of quotedMatches) {
        const quotedPhrase = match[1].trim();
        const words = quotedPhrase.split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase()));

        words.forEach(word => {
            const lower = word.toLowerCase();
            if (!weightedKeywords.has(lower)) {
                weightedKeywords.set(lower, {
                    word: lower,
                    weight: 5.0, // HIGH weight for quoted words
                    sources: ['quoted']
                });
            } else {
                const entry = weightedKeywords.get(lower);
                entry.weight += 5.0;
                if (!entry.sources.includes('quoted')) entry.sources.push('quoted');
            }
        });
    }

    // STEP 3: Frequency analysis from text (weight increases per mention)
    const tokens = text
        .replace(/[<>]/g, ' ')
        .match(/[\p{L}]{3,}/gu) || []; // Match 3+ letter words (any language)

    const frequency = new Map();
    tokens.forEach(word => {
        const lower = word.toLowerCase();
        if (!STOP_WORDS.has(lower)) {
            frequency.set(lower, (frequency.get(lower) || 0) + 1);
        }
    });

    // Add frequency-based weights
    for (const [word, count] of frequency.entries()) {
        if (!weightedKeywords.has(word)) {
            // New word - weight based on frequency
            // 1 mention = 0.5, 2 mentions = 1.0, 3 mentions = 1.5, etc.
            weightedKeywords.set(word, {
                word: word,
                weight: count * 0.5,
                sources: ['frequency']
            });
        } else {
            // Existing word from header/quotes - boost weight by frequency
            const entry = weightedKeywords.get(word);
            entry.weight += count * 0.5;
            if (!entry.sources.includes('frequency')) entry.sources.push('frequency');
        }
    }

    // STEP 4: Filter out very low-weight keywords (< 1.0 weight)
    // This means words must appear 2+ times OR be in header/quotes to be included
    const filteredKeywords = Array.from(weightedKeywords.entries())
        .filter(([_, data]) => data.weight >= 1.0)
        .map(([_, data]) => ({ ...data }));

    // STEP 5: Sort by weight (descending) and return top keywords
    const sortedKeywords = filteredKeywords
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 12) // Limit to top 12
        .map(k => k.word);

    console.log('🔍 [extractKeywords] Keyword extraction:', {
        section: sectionTitle,
        totalCandidates: weightedKeywords.size,
        afterFiltering: filteredKeywords.length,
        topKeywords: sortedKeywords,
        topWeights: filteredKeywords.slice(0, 12).map(k => `${k.word}(${k.weight.toFixed(1)})`)
    });

    return sortedKeywords;
}

// English Language Bank for Section-Specific Keywords
// Automatically adds weighted keywords AND regex patterns when English language is detected
const ENGLISH_SECTION_KEYWORDS = {
    // Section 1: Core Identity & Context
    'core identity': {
        keywords: ['identity', 'name', 'species', 'role', 'occupation', 'gender', 'pronouns', 'context', 'core', 'tags', 'genre', 'character', 'being', 'type', 'position', 'profession', 'background'],
        regexes: [
            { pattern: '\\b(?:core|primary|central)\\s+identity\\b', flags: 'i', priority: 70 },
            { pattern: '\\b(?:species|race|type)\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:role|occupation|profession|position)\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:gender|pronouns?)\\s+(?:identity)?\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:genre|tags?)\\b', flags: 'i', priority: 60 }
        ],
        weight: 60
    },
    'identity': {
        keywords: ['identity', 'name', 'species', 'role', 'occupation', 'gender', 'pronouns', 'context', 'core', 'tags', 'genre', 'character', 'being', 'type', 'position', 'profession', 'background'],
        regexes: [
            { pattern: '\\bidentit(?:y|ies)\\b', flags: 'i', priority: 70 },
            { pattern: '\\b(?:character|being)\\s+(?:type|archetype)\\b', flags: 'i', priority: 65 }
        ],
        weight: 60
    },
    'context': {
        keywords: ['identity', 'name', 'species', 'role', 'occupation', 'gender', 'pronouns', 'context', 'core', 'tags', 'genre', 'character', 'being', 'type', 'position', 'profession', 'background'],
        regexes: [
            { pattern: '\\bcontexts?\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:background|setting)\\s+context\\b', flags: 'i', priority: 70 }
        ],
        weight: 60
    },

    // Section 2: Physical Manifestation
    'physical': {
        keywords: ['physical', 'body', 'appearance', 'build', 'hair', 'eyes', 'skin', 'height', 'features', 'aesthetic', 'style', 'clothing', 'looks', 'physique', 'form', 'figure', 'face', 'hands', 'muscular', 'lean', 'tall', 'short'],
        regexes: [
            { pattern: '\\bphysical(?:\\s+(?:manifestation|appearance|form|body))?\\b', flags: 'i', priority: 70 },
            { pattern: '\\b(?:body|physique)\\s+(?:build|type|form)\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:hair|eyes|skin)\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:tall|short|lean|muscular|built|slender|lithe)\\b', flags: 'i', priority: 63 },
            { pattern: '\\b(?:distinguishing|striking)\\s+features?\\b', flags: 'i', priority: 68 },
            { pattern: '\\baura\\s+(?:and|&)?\\s+presence\\b', flags: 'i', priority: 65 }
        ],
        weight: 60
    },
    'manifestation': {
        keywords: ['physical', 'body', 'appearance', 'build', 'hair', 'eyes', 'skin', 'height', 'features', 'aesthetic', 'style', 'clothing', 'looks', 'physique', 'form', 'figure', 'face', 'hands'],
        regexes: [
            { pattern: '\\bmanifestations?\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:appearance|looks|presentation)\\b', flags: 'i', priority: 65 }
        ],
        weight: 60
    },

    // Section 3: Psyche & Behavioral Matrix
    'psyche': {
        keywords: ['psyche', 'psychology', 'personality', 'behavior', 'mind', 'thoughts', 'motivation', 'morals', 'values', 'fears', 'strengths', 'weaknesses', 'habits', 'mental', 'emotional', 'thinking', 'traits', 'patterns', 'desires', 'aversions'],
        regexes: [
            { pattern: '\\bpsyche\\b', flags: 'i', priority: 70 },
            { pattern: '\\bpsycholog(?:y|ical)\\b', flags: 'i', priority: 68 },
            { pattern: '\\bpersonalit(?:y|ies)\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:core\\s+)?personality\\s+architecture\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:motivational?|drivers?)\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:moral|ethical)\\s+compass\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:value|belief)\\s+system\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:passionate\\s+)?(?:attractions?|aversions?)\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:strengths?|weaknesses?|vulnerabilit(?:y|ies))\\b', flags: 'i', priority: 63 },
            { pattern: '\\b(?:habitual\\s+)?patterns?\\b', flags: 'i', priority: 60 },
            { pattern: '\\bcrisis\\s+response\\b', flags: 'i', priority: 65 }
        ],
        weight: 60
    },
    'behavioral': {
        keywords: ['behavior', 'habits', 'patterns', 'response', 'actions', 'conduct', 'manner', 'personality', 'traits'],
        regexes: [
            { pattern: '\\bbehavio(?:r|ral|rs?)\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:habitual\\s+)?(?:habits?|patterns?)\\b', flags: 'i', priority: 65 },
            { pattern: '\\btraits?\\b', flags: 'i', priority: 63 }
        ],
        weight: 60
    },
    'matrix': {
        keywords: ['psyche', 'psychology', 'personality', 'behavior', 'mind', 'thoughts', 'motivation', 'morals', 'values', 'fears', 'strengths', 'weaknesses', 'habits'],
        regexes: [
            { pattern: '\\bmatri(?:x|ces)\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:psychological|behavioral)\\s+matrix\\b', flags: 'i', priority: 72 }
        ],
        weight: 60
    },

    // Section 4: Relational Dynamics & Social Architecture
    'relational': {
        keywords: ['relationship', 'relational', 'social', 'bonds', 'dynamics', 'connections', 'family', 'friends', 'lover', 'partner', 'trust', 'loyalty', 'interaction', 'interpersonal', 'ties', 'network', 'alliance', 'rivalry'],
        regexes: [
            { pattern: '\\brelational(?:\\s+dynamics)?\\b', flags: 'i', priority: 70 },
            { pattern: '\\brelationships?\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:social|interpersonal)\\s+(?:bonds?|dynamics?|ties?)\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:family|friends?|lover|partner|ally|allies|rival)\\b', flags: 'i', priority: 63 },
            { pattern: '\\b(?:trust|loyalty|devotion)\\b', flags: 'i', priority: 65 },
            { pattern: '\\bleadership\\s+style\\b', flags: 'i', priority: 68 }
        ],
        weight: 60
    },
    'dynamics': {
        keywords: ['relationship', 'relational', 'social', 'bonds', 'dynamics', 'connections', 'family', 'friends', 'lover', 'partner', 'trust', 'loyalty'],
        regexes: [
            { pattern: '\\bdynamics?\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:power|relationship)\\s+dynamics?\\b', flags: 'i', priority: 72 }
        ],
        weight: 60
    },
    'social': {
        keywords: ['social', 'relationship', 'bonds', 'connections', 'interaction', 'interpersonal', 'network', 'companionship'],
        regexes: [
            { pattern: '\\bsocial\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:social\\s+)?(?:architecture|network|structure)\\b', flags: 'i', priority: 70 },
            { pattern: '\\binterpersonal\\b', flags: 'i', priority: 65 }
        ],
        weight: 60
    },
    'architecture': {
        keywords: ['structure', 'framework', 'system', 'organization', 'dynamics'],
        regexes: [
            { pattern: '\\barchitectures?\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:social|relational)\\s+architecture\\b', flags: 'i', priority: 72 }
        ],
        weight: 50
    },

    // Section 5: Linguistic Signature & Communication DNA
    'linguistic': {
        keywords: ['linguistic', 'language', 'speech', 'voice', 'communication', 'words', 'tone', 'expression', 'dialogue', 'speaking', 'verbal', 'talking', 'conversation', 'accent', 'vocabulary', 'rhetoric'],
        regexes: [
            { pattern: '\\blinguistic(?:\\s+(?:signature|style|DNA))?\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:speech|voice|vocal)\\s+(?:pattern|style|identity)\\b', flags: 'i', priority: 70 },
            { pattern: '\\blanguage\\s+architecture\\b', flags: 'i', priority: 72 },
            { pattern: '\\bcommunication\\s+(?:style|mode|DNA)\\b', flags: 'i', priority: 70 },
            { pattern: '\\b(?:signature|characteristic)\\s+expressions?\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:emotional\\s+)?communication\\s+modes?\\b', flags: 'i', priority: 70 },
            { pattern: '\\b(?:conversational|dialogue|verbal)\\s+(?:flow|style)\\b', flags: 'i', priority: 65 }
        ],
        weight: 60
    },
    'signature': {
        keywords: ['signature', 'style', 'pattern', 'characteristic', 'distinctive', 'unique'],
        regexes: [
            { pattern: '\\bsignatures?\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:linguistic|verbal)\\s+signature\\b', flags: 'i', priority: 72 }
        ],
        weight: 50
    },
    'communication': {
        keywords: ['communication', 'speech', 'voice', 'language', 'words', 'tone', 'expression', 'dialogue', 'speaking', 'verbal', 'talking', 'conversation'],
        regexes: [
            { pattern: '\\bcommunications?\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:speech|speaking|verbal)\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:tone|accent|vocabulary)\\b', flags: 'i', priority: 63 }
        ],
        weight: 60
    },

    // Section 6: Origin Story & Historical Tapestry
    'origin': {
        keywords: ['origin', 'history', 'past', 'background', 'story', 'childhood', 'upbringing', 'formative', 'events', 'legacy', 'backstory', 'youth', 'born', 'raised', 'heritage', 'ancestry', 'memories'],
        regexes: [
            { pattern: '\\borigins?(?:\\s+story)?\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:formative|crucible)\\s+(?:events?|experiences?|moments?)\\b', flags: 'i', priority: 70 },
            { pattern: '\\b(?:backstory|background)\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:childhood|youth|upbringing)\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:born|raised|grew\\s+up)\\b', flags: 'i', priority: 63 },
            { pattern: '\\b(?:legacy|heritage|ancestry)\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:life\\s+)?narrative\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:character\\s+)?metamorphosis\\b', flags: 'i', priority: 68 }
        ],
        weight: 60
    },
    'historical': {
        keywords: ['history', 'past', 'historical', 'background', 'story', 'events', 'legacy', 'heritage', 'ancestry'],
        regexes: [
            { pattern: '\\bhistor(?:y|ical)\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:historical\\s+)?tapestry\\b', flags: 'i', priority: 72 },
            { pattern: '\\bpasts?\\b', flags: 'i', priority: 63 }
        ],
        weight: 60
    },
    'tapestry': {
        keywords: ['history', 'story', 'narrative', 'tale', 'background', 'past'],
        regexes: [
            { pattern: '\\btapestr(?:y|ies)\\b', flags: 'i', priority: 70 },
            { pattern: '\\b(?:historical|life)\\s+tapestry\\b', flags: 'i', priority: 72 }
        ],
        weight: 50
    },

    // Section 7: Aesthetic Expression & Style Philosophy
    'aesthetic': {
        keywords: ['aesthetic', 'style', 'fashion', 'clothing', 'outfit', 'ensemble', 'wardrobe', 'dress', 'appearance', 'attire', 'garments', 'wear', 'formal', 'casual', 'comfort', 'presentation'],
        regexes: [
            { pattern: '\\baesthetics?(?:\\s+(?:expression|philosophy|style))?\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:fashion|clothing|attire|wardrobe)\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:outfit|ensemble|garments?)\\b', flags: 'i', priority: 63 },
            { pattern: '\\b(?:formal|casual|intimate)\\s+(?:wear|presentation|attire|ensemble)\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:style\\s+)?(?:evolution|philosophy)\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:seductive\\s+)?arsenal\\b', flags: 'i', priority: 65 }
        ],
        weight: 60
    },
    'expression': {
        keywords: ['expression', 'style', 'aesthetic', 'presentation', 'appearance'],
        regexes: [
            { pattern: '\\bexpressions?\\b', flags: 'i', priority: 65 },
            { pattern: '\\baesthetic\\s+expression\\b', flags: 'i', priority: 72 }
        ],
        weight: 50
    },
    'style': {
        keywords: ['style', 'aesthetic', 'fashion', 'clothing', 'outfit', 'dress', 'appearance', 'attire'],
        regexes: [
            { pattern: '\\bstyles?\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:fashion|clothing)\\s+style\\b', flags: 'i', priority: 70 }
        ],
        weight: 60
    },
    'philosophy': {
        keywords: ['philosophy', 'belief', 'principle', 'values', 'approach', 'mindset'],
        regexes: [
            { pattern: '\\bphilosoph(?:y|ies)\\b', flags: 'i', priority: 65 },
            { pattern: '\\b(?:style|aesthetic)\\s+philosophy\\b', flags: 'i', priority: 72 }
        ],
        weight: 50
    },

    // Section 8: Psychological Analysis Modules (broken into subsections)
    'dere': {
        keywords: ['dere', 'archetype', 'love', 'expression', 'romantic', 'affection', 'tsundere', 'yandere', 'kuudere', 'dandere', 'sadodere', 'oujidere'],
        regexes: [
            { pattern: '\\b(?:express(?:es|ing)?|show(?:s|ing)?|manifest(?:s|ing)?|hide(?:s|ing)?)\\s+(?:love|affection|feelings?|emotions?)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:love|romantic|affection(?:ate)?)\\s+(?:expression|manifestation|display|behavior)\\b', flags: 'i', priority: 73 },
            { pattern: '\\b(?:romantic|loving|affectionate)\\s+(?:behavioral\\s+)?(?:patterns?|gestures?|actions?)\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:cold|distant|aloof|detached)\\s+(?:but|yet|while|though).{0,30}(?:caring|loving|protective|devoted)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:cruel|sadistic|possessive|obsessive|controlling).{0,30}(?:love|affection|devotion)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:hid(?:es?|ing|den)|conceal(?:s|ing|ed)|mask(?:s|ing|ed)|suppres(?:s|sing|sed))\\s+(?:his|her|their).{0,20}(?:feelings?|affection|love|emotions?)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:struggles?|difficult|hard)\\s+(?:to\\s+)?(?:express|show|admit|acknowledge).{0,20}(?:feelings?|affection|love|emotions?)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:tsun|yan|kuu|dan|sado|ouji|hime)dere\\b', flags: 'i', priority: 70 }
        ],
        weight: 70
    },
    'attachment': {
        keywords: ['attachment', 'bonding', 'style', 'connection', 'relationship', 'trust', 'intimacy', 'avoidant', 'anxious', 'secure', 'fearful'],
        regexes: [
            { pattern: '\\b(?:fears?|craves?|avoids?|seeks?)\\s+(?:closeness|intimacy|connection|attachment|abandonment)\\b', flags: 'i', priority: 76 },
            { pattern: '\\b(?:push(?:es|ing)?|pull(?:s|ing)?)\\s+(?:away|closer).{0,30}(?:relationship|partner|loved|connection)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:struggles?|difficult(?:y)?|hard)\\s+(?:to\\s+)?(?:trust|bond|connect|open\\s+up|get\\s+close)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:clings?|clingy|needy|dependent|smothering)\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:distant|aloof|independent|self[-\\s]?reliant|emotionally\\s+unavailable)\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:abandonment|rejection|losing).{0,20}(?:fears?|anxiety|terror|dread)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:trust|intimacy)\\s+(?:issues?|problems?|difficult(?:y|ies))\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:secure|healthy|stable)\\s+(?:in\\s+)?(?:relationships?|bonds?|connections?)\\b', flags: 'i', priority: 72 }
        ],
        weight: 70
    },
    'chemistry': {
        keywords: ['chemistry', 'compatibility', 'attraction', 'connection', 'spark', 'resonance', 'magnetism', 'tension', 'synergy', 'harmony'],
        regexes: [
            { pattern: '\\bchemistr(?:y|ies)\\s+(?:analysis|matrix|monitor)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:volatile|magnetic|toxic|strong)\\s+chemistry\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:compatibility|attraction|connection)\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:intellectual|emotional|physical|sexual)\\s+(?:spark|resonance|magnetism|synergy)\\b', flags: 'i', priority: 72 },
            { pattern: '\\bintimate\\s+synergy\\b', flags: 'i', priority: 70 },
            { pattern: '\\b(?:overall\\s+)?chemistry\\s*:\\s*\\d+%\\b', flags: 'i', priority: 75 }
        ],
        weight: 70
    },
    'trauma': {
        keywords: ['trauma', 'traumatic', 'wound', 'wounds', 'psychological', 'trigger', 'triggers', 'triggered', 'response', 'healing', 'resilience', 'coping', 'ptsd'],
        regexes: [
            { pattern: '\\b(?:haunted|scarred|marked)\\s+by.{0,30}(?:past|childhood|experience|event|memory)\\b', flags: 'i', priority: 76 },
            { pattern: '\\b(?:triggers?|triggered|sets?\\s+off).{0,30}(?:memories?|flashbacks?|panic|anxiety|fear|rage)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:fight|flight|freeze|fawn)\\s+(?:response|mode|instinct)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:lash(?:es)?\\s+out|shut(?:s)?\\s+down|dissociate(?:s)?|numb(?:s)?|withdraw(?:s)?)\\s+when\\b', flags: 'i', priority: 73 },
            { pattern: '\\b(?:deep[-\\s]?seated|buried|unresolved|repressed)\\s+(?:trauma|pain|wounds?|hurt|fear)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:copes?|coping|survives?|endures?)\\s+(?:by|through|with|via)\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:nightmares?|flashbacks?|intrusive\\s+thoughts?)\\b', flags: 'i', priority: 73 },
            { pattern: '\\b(?:hypervigilant|on\\s+edge|constantly\\s+alert|scanning\\s+for\\s+threats?)\\b', flags: 'i', priority: 74 }
        ],
        weight: 70
    },
    'resilience': {
        keywords: ['resilience', 'recovery', 'healing', 'coping', 'strength', 'endurance'],
        regexes: [
            { pattern: '\\bresilience\\s+profile\\b', flags: 'i', priority: 75 },
            { pattern: '\\bresilient?\\b', flags: 'i', priority: 68 },
            { pattern: '\\b(?:recovery|healing)\\s+(?:process|mechanisms?)\\b', flags: 'i', priority: 70 }
        ],
        weight: 60
    },
    'flirtation': {
        keywords: ['flirtation', 'flirting', 'seduction', 'charm', 'attraction', 'courtship', 'wooing', 'romantic', 'tease', 'teasing'],
        regexes: [
            { pattern: '\\b(?:flirts?|flirting|teases?|teasing)\\s+(?:by|through|with|via)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:seduce(?:s)?|charm(?:s)?|woo(?:s)?|court(?:s)?)\\s+(?:by|through|with|via)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:playful|suggestive|provocative|coy|subtle)\\s+(?:touches?|glances?|remarks?|comments?|innuendo)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:close\\s+proximity|lingering\\s+touch|eye\\s+contact|body\\s+language)\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:aggressive|dominant|possessive)\\s+(?:approach|advances?|pursuit|courtship)\\b', flags: 'i', priority: 73 },
            { pattern: '\\b(?:backhanded\\s+)?compliments?\\b', flags: 'i', priority: 70 },
            { pattern: '\\b(?:leans?\\s+(?:in|close|forward)|invades?\\s+(?:personal\\s+)?space|whispers?)\\b', flags: 'i', priority: 72 }
        ],
        weight: 70
    },
    'arousal': {
        keywords: ['arousal', 'aroused', 'desire', 'attraction', 'attracted', 'intimate', 'intimacy', 'sexual', 'erotic', 'sensual', 'lust', 'passion'],
        regexes: [
            { pattern: '\\b(?:aroused?|turned\\s+on|excited)\\s+(?:by|when|from)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:desire(?:s)?|craves?|wants?|needs?|hungers?\\s+for)\\s+(?:control|power|submission|dominance|intimacy|touch)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:finds?|derives?)\\s+(?:pleasure|satisfaction|arousal)\\s+(?:in|from|through)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:dominance|submission|control|power|vulnerability|helplessness)\\s+(?:is|as).{0,20}(?:arousing|stimulating|exciting|aphrodisiac)\\b', flags: 'i', priority: 76 },
            { pattern: '\\b(?:breath(?:s)?|pulse|heart(?:beat)?|body)\\s+(?:quickens?|races?|responds?|reacts?)\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:intimate|sexual|erotic|sensual)\\s+(?:thoughts?|fantasies|desires?|needs?)\\b', flags: 'i', priority: 73 },
            { pattern: '\\b(?:spark(?:s)?|ignite(?:s)?|kindle(?:s)?|stir(?:s)?)\\s+(?:desire|passion|lust|arousal|hunger)\\b', flags: 'i', priority: 74 }
        ],
        weight: 70
    },
    'jealousy': {
        keywords: ['jealousy', 'jealous', 'envy', 'envious', 'possessive', 'possessiveness', 'territorial', 'rivalry', 'competition'],
        regexes: [
            { pattern: '\\b(?:jealous|possessive|territorial|protective)\\s+(?:of|over|about|when)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:seethes?|simmers?|burns?|flares?)\\s+(?:with\\s+)?(?:jealousy|envy|possessiveness|rage)\\s+(?:when|at|seeing)\\b', flags: 'i', priority: 76 },
            { pattern: '\\b(?:mine|theirs?|belongs?\\s+to\\s+(?:me|him|her|them))\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:can\'?t\\s+stand|hates?|loathes?|despises?)\\s+(?:seeing|watching|others?).{0,30}(?:attention|touch|near|close|flirt)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:eliminates?|removes?|drives?\\s+away|threatens?)\\s+(?:rivals?|competition|threats?)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:glares?|glowers?|stares?)\\s+(?:at|daggers|coldly)\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:claims?|marks?|stakes?\\s+(?:a\\s+)?claim)\\b', flags: 'i', priority: 73 }
        ],
        weight: 70
    },
    'conflict': {
        keywords: ['conflict', 'resolution', 'dispute', 'argument', 'disagreement', 'confrontation', 'negotiation', 'compromise', 'debate'],
        regexes: [
            { pattern: '\\b(?:handles?|approaches?|navigates?|responds?\\s+to)\\s+(?:conflict|disagreement|argument|confrontation)\\s+(?:by|through|with)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:escalates?|defuses?|avoids?|confronts?)\\s+(?:conflict|tension|disagreement|argument)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:fights?|argues?|debates?|confronts?|withdraws?|compromises?)\\s+(?:when|during|in)\\b', flags: 'i', priority: 73 },
            { pattern: '\\b(?:shuts?\\s+down|stonewalls?|silent\\s+treatment|passive[-\\s]?aggressive)\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:seeks?|pursues?|aims?\\s+for)\\s+(?:resolution|compromise|understanding|victory|dominance)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:aggressive|defensive|submissive|assertive)\\s+(?:in|during|when)\\s+(?:conflict|disagreement|argument)\\b', flags: 'i', priority: 73 },
            { pattern: '\\b(?:wins?|loses?|resolves?|settles?)\\s+(?:argument|dispute|conflict|disagreement)\\s+(?:by|through)\\b', flags: 'i', priority: 72 }
        ],
        weight: 70
    },
    'boundaries': {
        keywords: ['boundaries', 'boundary', 'limits', 'personal', 'space', 'privacy', 'consent', 'respect', 'autonomy'],
        regexes: [
            { pattern: '\\b(?:sets?|establishes?|maintains?|enforces?|violates?|crosses?)\\s+(?:boundaries|limits)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:respects?|ignores?|disregards?|tramples?)\\s+(?:boundaries|limits|space|privacy|autonomy)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:rigid|flexible|porous|loose|firm|strict)\\s+(?:about|with|regarding)\\s+(?:boundaries|limits|space)\\b', flags: 'i', priority: 73 },
            { pattern: '\\b(?:invades?|respects?|guards?|protects?)\\s+(?:personal|physical|emotional)\\s+space\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:needs?|requires?|demands?|expects?)\\s+(?:space|distance|privacy|autonomy)\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:push(?:es)?|test(?:s)?)\\s+(?:boundaries|limits)\\b', flags: 'i', priority: 73 },
            { pattern: '\\b(?:uncomfortable|uneasy)\\s+(?:when|with).{0,20}(?:touched|close|intimacy)\\b', flags: 'i', priority: 72 }
        ],
        weight: 70
    },
    'hidden': {
        keywords: ['hidden', 'secret', 'concealed', 'buried', 'private', 'vulnerability', 'vulnerable', 'mask', 'facade', 'truth'],
        regexes: [
            { pattern: '\\b(?:hides?|conceals?|buries?|masks?|suppresses?)\\s+(?:his|her|their).{0,20}(?:true|real|deep|inner)\\s+(?:self|feelings?|nature|desires?|fears?)\\b', flags: 'i', priority: 76 },
            { pattern: '\\b(?:beneath|behind|under)\\s+(?:the|his|her|their).{0,20}(?:mask|facade|exterior|surface|veneer)\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:secret|hidden|buried|private|deep)\\s+(?:desires?|fears?|shame|pain|truth|vulnerability)\\b', flags: 'i', priority: 74 },
            { pattern: '\\b(?:rarely|never|seldom)\\s+(?:shows?|reveals?|admits?|acknowledges?)\\b', flags: 'i', priority: 72 },
            { pattern: '\\b(?:vulnerable|weak|exposed)\\s+(?:when|if|only)\\b', flags: 'i', priority: 73 },
            { pattern: '\\b(?:presents?|projects?|shows?)\\s+(?:a\\s+)?(?:mask|facade|front|image)\\s+(?:of|to)\\b', flags: 'i', priority: 74 }
        ],
        weight: 60
    },
    'depths': {
        keywords: ['depths', 'hidden', 'deep', 'inner', 'secret', 'private', 'vulnerability'],
        regexes: [
            { pattern: '\\bdepths?\\b', flags: 'i', priority: 68 },
            { pattern: '\\bhidden\\s+depths?\\b', flags: 'i', priority: 75 },
            { pattern: '\\b(?:deep|inner|secret)\\b', flags: 'i', priority: 65 }
        ],
        weight: 60
    },
};

const EMOJI_HEADER_REGEX = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u;
const UPPERCASE_HEADER_REGEX = /^[A-Z0-9][A-Z0-9\s&'\/:,-]{4,}$/;
const BULLET_LINE_REGEX = /^[\s]*[•\-–*·]/;
const TAG_REGEX = /<([^>]+:[^>]+)>/g;

function isSectionHeaderLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
        return false;
    }
    if (SECTION_HEADER_REGEX.test(trimmed)) {
        return true;
    }
    if (EMOJI_HEADER_REGEX.test(trimmed)) {
        return true;
    }
    if (/^SECTION\s+\d+\/\d+/i.test(trimmed)) {
        return true;
    }
    return UPPERCASE_HEADER_REGEX.test(trimmed) && !trimmed.includes('.');
}

function normalizeSectionHeader(line) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^##\s+SECTION\s+\d+\/\d+:\s*(.+)$/i);
    if (sectionMatch) {
        return sectionMatch[1].trim();
    }
    return trimmed.replace(/^##\s*/, '').trim();
}

function collectTags(text) {
    const tags = new Set();
    const matches = text.matchAll(TAG_REGEX);
    for (const match of matches) {
        if (match[1]) {
            tags.add(match[1]);
        }
    }
    return Array.from(tags);
}

function sanitizeDescriptor(value) {
    // Remove markdown formatting and section headers (language-agnostic)
    return (value || '')
        .replace(/[*_`~<>[\]#]/g, '')  // Remove markdown chars
        .replace(/\S+\s+\d+\/\d+:/gi, '')  // Remove any "WORD #/#:" pattern
        .trim();
}

function buildKeywordSetsFromGroups(groups, keywordsSet, regexSet) {
    for (const groupKey of groups) {
        const group = KEYWORD_GROUPS[groupKey];
        if (!group) continue;

        // Limit keywords per group to top 3 to prevent explosion (reduced from 5)
        if (Array.isArray(group.keywords)) {
            const limitedKeywords = group.keywords.slice(0, 3);
            for (const keyword of limitedKeywords) {
                keywordsSet.add(keyword);
            }
        }

        // Add all regexes with weighting support
        if (Array.isArray(group.regexes)) {
            for (const regexEntry of group.regexes) {
                regexSet.add(JSON.stringify({
                    pattern: regexEntry.pattern,
                    flags: regexEntry.flags || 'i',
                    group: groupKey,
                    priority: regexEntry.priority ?? group.priority ?? 20,
                    source: 'preset',
                }));
            }
        }
    }
}

function buildDefaultKeywordMetadata(sectionTitle, topic, chunkText, tags) {
    const keywordsSet = new Set();
    const regexSet = new Set();
    const detectedGroups = new Set();
    const customWeights = {}; // For English language bank keyword weights

    const sanitizedSection = sanitizeDescriptor(sectionTitle);
    const sanitizedTopic = sanitizeDescriptor(topic);

    // English Language Bank Integration
    // Check if content is primarily English by testing for common English words
    const isEnglish = /\b(the|and|or|is|are|was|were|been|have|has|had|do|does|did|will|would|should|could|may|might|can)\b/i.test(chunkText);
    let matchedEnglishSection = null;

    if (isEnglish) {
        // Match section title against English keyword bank
        // Check both the sanitized section title AND topic for matches
        const lowerTitle = (sanitizedSection + ' ' + (sanitizedTopic || '')).toLowerCase();

        for (const [sectionKey, data] of Object.entries(ENGLISH_SECTION_KEYWORDS)) {
            // Match against the section key (e.g., 'core identity', 'dere', 'attachment')
            if (lowerTitle.includes(sectionKey)) {
                // Add all keywords for THIS section with their weight
                data.keywords.forEach(keyword => {
                    keywordsSet.add(keyword);
                    customWeights[keyword] = data.weight;
                });

                // Add all regex patterns for THIS section with their priorities
                if (data.regexes && Array.isArray(data.regexes)) {
                    data.regexes.forEach(regexEntry => {
                        regexSet.add(JSON.stringify({
                            pattern: regexEntry.pattern,
                            flags: regexEntry.flags || 'i',
                            priority: regexEntry.priority || data.weight,
                            source: 'english-bank',
                        }));
                    });
                }

                matchedEnglishSection = sectionKey;
                console.log(`📚 [English Bank] Matched "${sectionKey}" in section "${sectionTitle}" (topic: ${topic}) - added ${data.keywords.length} keywords + ${data.regexes?.length || 0} regexes at weight ${data.weight}`);
                break; // Only match one section
            }
        }
    }

    for (const preset of KEYWORD_PRESETS) {
        if (preset.match && (preset.match.test(sanitizedSection) || preset.match.test(sanitizedTopic))) {
            if (preset.groups) {
                preset.groups.forEach(group => detectedGroups.add(group));
            }
            if (preset.keywords) {
                preset.keywords.forEach(keyword => keywordsSet.add(keyword));
            }
            if (preset.regexes) {
                preset.regexes.forEach(pattern => regexSet.add(JSON.stringify({
                    pattern,
                    flags: 'i',
                    priority: 60,
                    source: 'preset',
                })));
            }
        }
    }

    if (Array.isArray(tags)) {
        for (const tag of tags) {
            const parts = tag.split(':').map(part => sanitizeDescriptor(part));
            parts.forEach(part => {
                if (!part) return;
                const keywordCandidate = part.replace(/_/g, ' ');
                keywordsSet.add(keywordCandidate);

                for (const [groupKey, data] of Object.entries(KEYWORD_GROUPS)) {
                    if (data.tagHints && data.tagHints.some(hint => new RegExp(hint, 'i').test(keywordCandidate))) {
                        detectedGroups.add(groupKey);
                    }
                }
            });

            if (/boundar/i.test(tag)) detectedGroups.add('boundaries');
            if (/trauma/i.test(tag)) detectedGroups.add('trauma');
            if (/flirt/i.test(tag)) detectedGroups.add('flirting');
            if (/arous/i.test(tag)) detectedGroups.add('arousal');
            if (/jealous/i.test(tag)) detectedGroups.add('jealousy');
            if (/attachment/i.test(tag)) detectedGroups.add('attachment');
        }
    }

    // REMOVED: Don't scan entire chunk text for keyword groups
    // This was causing keyword bleeding between sections
    // Only detect groups based on section title and tags, not full text

    // Only build keyword groups if they match the section title/topic SPECIFICALLY
    const lowerSection = (sanitizedSection + ' ' + sanitizedTopic).toLowerCase();

    // Manual heuristics - ONLY check section title, not entire chunk text
    if (lowerSection.includes('boundar') || lowerSection.includes('consent')) detectedGroups.add('boundaries');
    if (lowerSection.includes('trauma') || lowerSection.includes('trigger') || lowerSection.includes('ptsd')) detectedGroups.add('trauma');
    if (lowerSection.includes('flirt') || lowerSection.includes('seduc')) detectedGroups.add('flirting');
    if (lowerSection.includes('arous') || lowerSection.includes('lust') || lowerSection.includes('desire')) detectedGroups.add('arousal');
    if (lowerSection.includes('jealous') || lowerSection.includes('possessive')) detectedGroups.add('jealousy');
    if (lowerSection.includes('attachment') || lowerSection.includes('avoidant')) detectedGroups.add('attachment');

    // Limit keywords per group to prevent explosion (reduced from 5 to 3)
    buildKeywordSetsFromGroups(detectedGroups, keywordsSet, regexSet);

    return {
        keywords: Array.from(keywordsSet),
        regex: Array.from(regexSet).map(entry => JSON.parse(entry)),
        groups: Array.from(detectedGroups),
        customWeights, // Return English bank keyword weights
        matchedEnglishSection, // Which English section was matched (for cross-section filtering)
    };
}

/**
 * Get the stem/root of a word by stripping common suffixes
 * Examples: "psychological" -> "psych", "psychology" -> "psych", "psyche" -> "psych"
 */
function getWordStem(word) {
    const lower = word.toLowerCase();

    // Strip common suffixes to find root (order matters - longest first)
    const suffixes = [
        'ological', 'ology', 'ical', 'ation', 'ness', 'ment', 'ship', 'able', 'ible',
        'ing', 'ed', 'ies', 'es', 's', 'ly', 'al', 'ic', 'y', 'e'
    ];

    for (const suffix of suffixes) {
        if (lower.endsWith(suffix) && lower.length > suffix.length + 2) {
            return lower.slice(0, -suffix.length);
        }
    }

    return lower;
}

/**
 * Convert keywords to regex patterns ONLY when we find actual related words
 * Strategy:
 * 1. Find words in the list that share a common prefix (function + functionally -> /\bfunction(?:ally)?\b/i)
 * 2. Find phrase overlaps (interdimensional + interdimensional being)
 * 3. Convert multi-word keywords to regex with word boundaries
 * 4. Leave simple keywords as plain keywords (NO unintelligent suffix guessing)
 */
function convertKeywordsToRegex(keywords) {
    console.log('🔍 [convertKeywordsToRegex] Input:', { count: keywords.length, keywords: keywords });

    const regexPatterns = [];
    const used = new Set();
    const sorted = [...keywords].sort((a, b) => b.length - a.length); // Longest first

    // PASS 1: Find ACTUAL word families by looking at what keywords we HAVE
    // If we have both "function" and "functionally", group them
    // If we only have "species", DON'T add made-up suffixes
    for (let i = 0; i < sorted.length; i++) {
        if (used.has(i)) continue;

        const word1 = sorted[i].toLowerCase();
        if (word1.includes(' ')) continue; // Skip multi-word for this pass

        const family = [{ word: word1, idx: i }];

        // Find other keywords that share a common root with this word
        for (let j = 0; j < sorted.length; j++) {
            if (i === j || used.has(j)) continue;
            const word2 = sorted[j].toLowerCase();
            if (word2.includes(' ')) continue;

            // Check if they share a common root (at least 4 characters)
            let commonRoot = '';
            const minLen = Math.min(word1.length, word2.length);
            for (let k = 0; k < minLen; k++) {
                if (word1[k] === word2[k]) {
                    commonRoot += word1[k];
                } else {
                    break;
                }
            }

            // If they share a meaningful root (4+ chars), they're likely related
            // psyche (5), psychology (10), psychological (13) -> common root "psych" (5 chars)
            if (commonRoot.length >= 4) {
                family.push({ word: word2, idx: j });
            }
        }

        // If we found a real family (2+ members from our ACTUAL keywords), create regex
        if (family.length >= 2) {
            family.forEach(f => used.add(f.idx));

            // Sort by length to get base word first
            const words = family.map(f => f.word).sort((a, b) => a.length - b.length);
            const baseWord = words[0];

            // Find the common root among ALL words in the family
            let commonRoot = baseWord;
            for (const word of words) {
                let newRoot = '';
                for (let k = 0; k < Math.min(commonRoot.length, word.length); k++) {
                    if (commonRoot[k] === word[k]) {
                        newRoot += commonRoot[k];
                    } else {
                        break;
                    }
                }
                commonRoot = newRoot;
            }

            // Create suffixes from the common root
            const suffixes = words.map(w => w.slice(commonRoot.length)).filter(s => s);

            // Check if the bare root (common root without suffix) is in the family
            const hasBareRoot = words.some(w => w === commonRoot);

            // Use word boundaries for precision
            // If bare root exists: /\bpsych(?:e|ology|ological)?\b/i (? makes suffixes optional)
            // If no bare root: /\bpsych(?:e|ology|ological)\b/i (no ?, must have suffix)
            const pattern = suffixes.length > 0
                ? `\\b${commonRoot}(?:${suffixes.join('|')})${hasBareRoot ? '?' : ''}\\b`
                : `\\b${baseWord}\\b`;

            regexPatterns.push({
                pattern,
                flags: 'i',
                priority: 30,
                source: 'word-family',
            });

            console.log(`🔍 Created word family regex: /${pattern}/i from:`, words, `(bare root: ${hasBareRoot})`);
        }
    }

    // PASS 2: Find phrase-based overlaps (interdimensional + interdimensional being)
    for (let i = 0; i < sorted.length; i++) {
        if (used.has(i)) continue;

        const base = sorted[i].toLowerCase();
        const baseWords = base.split(/\s+/);
        const variants = [];

        // Find all keywords that extend this base phrase
        for (let j = 0; j < sorted.length; j++) {
            if (i === j || used.has(j)) continue;
            const candidate = sorted[j].toLowerCase();

            if (candidate.startsWith(base + ' ')) {
                const suffix = candidate.slice(base.length).trim();
                variants.push(suffix);
                used.add(j);
            }
        }

        // Create regex for phrase variants
        if (variants.length > 0) {
            const escapedBase = base.replace(/\s+/g, '\\s+');
            const escapedVariants = variants.map(v => v.replace(/\s+/g, '\\s+'));
            const pattern = `\\b${escapedBase}(?:\\s+(?:${escapedVariants.join('|')}))?\\b`;
            regexPatterns.push({
                pattern,
                flags: 'i',
                priority: 25,
                source: 'phrase-family',
            });
            used.add(i);
        } else if (baseWords.length > 1) {
            // Multi-word keyword: add word boundaries
            const escapedBase = base.replace(/\s+/g, '\\s+');
            regexPatterns.push({
                pattern: `\\b${escapedBase}\\b`,
                flags: 'i',
                priority: 20,
                source: 'multiword',
            });
            used.add(i);
        }
        // REMOVED: The unintelligent single-word suffix additions (no more speciesed/genreing!)
    }

    // PASS 3: Keep remaining keywords as-is (lowercase, no regex conversion)
    const remainingKeywords = sorted
        .filter((_, i) => !used.has(i))
        .map(kw => kw.toLowerCase());

    console.log('🔍 [convertKeywordsToRegex] Output:', {
        regexCount: regexPatterns.length,
        regexes: regexPatterns.map(r => `/${r.pattern}/${r.flags} (${r.source})`),
        remainingCount: remainingKeywords.length,
        remaining: remainingKeywords,
        conversionRate: `${Math.round((regexPatterns.length / keywords.length) * 100)}%`
    });

    return {
        keywords: remainingKeywords,
        regexes: regexPatterns
    };
}

function buildChunkMetadata(sectionTitle, topic, chunkText, tags, characterName = null, allSectionTitles = []) {
    const autoKeywords = extractKeywords(chunkText, sectionTitle, topic);
    const keywordMeta = buildDefaultKeywordMetadata(sectionTitle, topic, chunkText, tags);

    // Create filter set for unwanted keywords
    const filterSet = new Set();
    if (characterName) {
        // Filter out character name and its variations
        filterSet.add(characterName.toLowerCase());
        // Also filter out parts of the name (e.g., "Atsu" from "Atsu Ibn Oba Al-Masri")
        characterName.split(/\s+/).forEach(part => {
            if (part.length >= 3) {
                filterSet.add(part.toLowerCase());
            }
        });
    }

    // Track cross-section keyword mentions for automatic linking
    const crossSectionMentions = {}; // { sectionTitle: mentionCount }

    // Filter out OTHER section titles (not this section's title)
    // AND count how many times this section mentions keywords from other sections
    // ALSO filter out English bank keywords from other sections
    allSectionTitles.forEach(title => {
        if (title && title !== sectionTitle) {
            // Extract words from the other section's title
            const titleWords = title
                .replace(/[^\p{L}\s]/gu, ' ')
                .split(/\s+/)
                .filter(w => w.length >= 3);

            // Count mentions of this other section's keywords in current text
            const lowerText = chunkText.toLowerCase();
            let mentionCount = 0;

            titleWords.forEach(word => {
                const lower = word.toLowerCase();
                filterSet.add(lower); // Still filter it out from keywords

                // Count how many times this word appears in the text
                const regex = new RegExp(`\\b${lower}\\b`, 'gi');
                const matches = lowerText.match(regex);
                if (matches) {
                    mentionCount += matches.length;
                }
            });

            if (mentionCount > 0) {
                crossSectionMentions[title] = mentionCount;
            }
        }
    });

    // Also filter out English bank keywords from OTHER sections
    if (keywordMeta.matchedEnglishSection) {
        const lowerText = chunkText.toLowerCase();

        for (const [sectionKey, data] of Object.entries(ENGLISH_SECTION_KEYWORDS)) {
            // Skip if this is OUR matched section
            if (sectionKey === keywordMeta.matchedEnglishSection) continue;

            // Count mentions of keywords from other English sections
            let sectionMentionCount = 0;

            data.keywords.forEach(keyword => {
                const lower = keyword.toLowerCase();
                filterSet.add(lower); // Filter out from keywords

                // Count mentions for automatic linking
                const regex = new RegExp(`\\b${lower}\\b`, 'gi');
                const matches = lowerText.match(regex);
                if (matches) {
                    sectionMentionCount += matches.length;
                }
            });

            if (sectionMentionCount > 0) {
                // Use the sectionKey as the "title" for English bank sections
                crossSectionMentions[sectionKey] = (crossSectionMentions[sectionKey] || 0) + sectionMentionCount;
            }
        }
    }

    // Merge and deduplicate (case-insensitive) - store as lowercase
    const keywordMap = new Map();
    [...autoKeywords, ...keywordMeta.keywords].forEach(kw => {
        const lower = kw.toLowerCase();
        // Skip if it's the character name or a common word
        if (!keywordMap.has(lower) && !filterSet.has(lower)) {
            keywordMap.set(lower, lower); // Store lowercase version
        }
    });

    const allKeywords = Array.from(keywordMap.values());

    // Convert keywords to regex patterns for flexible matching
    const { keywords: remainingKeywords, regexes: autoRegexes } = convertKeywordsToRegex(allKeywords);

    console.log('🔍 [buildChunkMetadata] Keyword conversion results:', {
        totalInputKeywords: allKeywords.length,
        inputKeywords: allKeywords,
        remainingKeywords: remainingKeywords,
        autoRegexesCount: autoRegexes.length,
        autoRegexes: autoRegexes.map(r => ({ pattern: r.pattern, flags: r.flags, source: r.source }))
    });

    // Format regexes as strings in the SAME format as ST lorebook: /pattern/flags
    // Mix them with regular keywords - ST handles detection automatically via parseRegexFromString
    const regexStrings = autoRegexes.map(r => `/${r.pattern}/${r.flags || 'i'}`);

    const systemKeywords = [
        ...remainingKeywords,  // Plain keywords
        ...regexStrings         // Regex patterns as /pattern/flags strings
    ];

    console.log('🔍 [buildChunkMetadata] Final systemKeywords:', systemKeywords);

    // Store regex objects separately for programmatic access
    const keywordRegex = [
        ...keywordMeta.regex.map(entry => ({ ...entry })),
        ...autoRegexes,
    ];

    return {
        section: sectionTitle,
        topic: topic ?? null,
        tags,
        keywords: [...systemKeywords], // All keywords (lowercase)
        systemKeywords, // All keywords (lowercase)
        defaultSystemKeywords: [...systemKeywords],
        keywordGroups: keywordMeta.groups,
        defaultKeywordGroups: [...keywordMeta.groups],
        keywordRegex,
        defaultKeywordRegex: keywordRegex.map(entry => ({ ...entry })),
        customKeywords: [],
        customWeights: keywordMeta.customWeights || {}, // English bank keyword weights (1-200 scale)
        customRegex: [],
        disabledKeywords: [],
        crossSectionMentions, // For automatic linking: { sectionTitle: mentionCount }
    };
}

/**
 * Apply automatic cross-section linking based on keyword frequency thresholds
 * @param {Array} chunks - Array of chunks to process
 */
function applyAutomaticLinks(chunks) {
    // Thresholds for automatic linking
    const SOFT_LINK_THRESHOLD = 3;  // 3+ mentions → soft link
    const FORCE_LINK_THRESHOLD = 7; // 7+ mentions → force link

    // Build a map of section title → chunk hash for quick lookup
    const sectionToHash = new Map();
    chunks.forEach(chunk => {
        if (chunk.metadata && chunk.metadata.section) {
            sectionToHash.set(chunk.metadata.section, chunk.hash);
        }
    });

    // Process each chunk's cross-section mentions
    chunks.forEach(chunk => {
        if (!chunk.metadata || !chunk.metadata.crossSectionMentions) return;

        const mentions = chunk.metadata.crossSectionMentions;
        const links = [];

        for (const [mentionedSection, count] of Object.entries(mentions)) {
            const targetHash = sectionToHash.get(mentionedSection);
            if (!targetHash) continue; // Target section not found

            // Determine link mode based on frequency
            if (count >= FORCE_LINK_THRESHOLD) {
                links.push({ targetHash, mode: 'force' });
                console.log(`🔗 [AutoLink] FORCE link: ${chunk.metadata.section} → ${mentionedSection} (${count} mentions)`);
            } else if (count >= SOFT_LINK_THRESHOLD) {
                links.push({ targetHash, mode: 'soft' });
                console.log(`🔗 [AutoLink] SOFT link: ${chunk.metadata.section} → ${mentionedSection} (${count} mentions)`);
            }
        }

        // Add links to chunk (or merge with existing)
        if (links.length > 0) {
            if (!chunk.chunkLinks) {
                chunk.chunkLinks = [];
            }
            chunk.chunkLinks.push(...links);
        }
    });
}

function looksLikeBulletBlock(block) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length) {
        return false;
    }
    const bulletCount = lines.filter(line => BULLET_LINE_REGEX.test(line)).length;
    return bulletCount && bulletCount >= Math.ceil(lines.length / 2);
}

/**
 * Get first sentence from text for use as chunk title
 * @param {string} text - Chunk text
 * @param {number} maxLength - Maximum length for title (default 100)
 * @returns {string} First sentence or truncated text
 */
function getFirstSentenceTitle(text, maxLength = 100) {
    if (!text || !text.trim()) {
        return '';
    }

    // Use the imported splitIntoSentences from semantic-chunking.js
    const sentences = splitIntoSentences(text);
    if (sentences.length === 0) {
        return text.substring(0, maxLength).trim() + '...';
    }

    let title = sentences[0].trim();

    // Remove speaker prefix if present (e.g., "User: " or "Character: ")
    const speakerMatch = title.match(/^[^:]+:\s*/);
    if (speakerMatch) {
        title = title.substring(speakerMatch[0].length);
    }

    // Truncate if too long
    if (title.length > maxLength) {
        title = title.substring(0, maxLength).trim() + '...';
    }

    return title;
}

function splitByLength(text, targetLength) {
    const words = text.split(/\s+/);
    const pieces = [];
    let buffer = '';

    for (const word of words) {
        if (!word) {
            continue;
        }
        const candidate = buffer ? `${buffer} ${word}` : word;
        if (candidate.length > targetLength && buffer) {
            pieces.push(buffer.trim());
            buffer = word;
        } else if (word.length > targetLength) {
            pieces.push(word);
            buffer = '';
        } else {
            buffer = candidate;
        }
    }

    if (buffer.trim().length) {
        pieces.push(buffer.trim());
    }

    return pieces;
}

function splitTextToSizedChunks(text, targetLength, overlap) {
    const trimmed = text.trim();
    if (!trimmed) {
        return [];
    }

    if (trimmed.length <= targetLength) {
        return [trimmed];
    }

    const sentences = splitIntoSentences(trimmed);
    const chunks = [];
    let buffer = '';

    const pushBuffer = () => {
        const clean = buffer.trim();
        if (clean.length) {
            chunks.push(clean);
        }
        buffer = '';
    };

    for (const sentence of sentences) {
        const candidate = buffer ? `${buffer} ${sentence}` : sentence;
        if (candidate.length > targetLength && buffer.length) {
            pushBuffer();
            const overlapText = overlap > 0 && chunks.length
                ? chunks[chunks.length - 1].slice(-Math.min(overlap, targetLength))
                : '';
            buffer = overlapText ? `${overlapText.trim()} ${sentence}`.trim() : sentence;
            if (buffer.length > targetLength) {
                splitByLength(buffer, targetLength).forEach(piece => chunks.push(piece));
                buffer = '';
            }
        } else {
            buffer = candidate;
        }
    }

    pushBuffer();

    const normalized = [];
    for (const chunk of chunks) {
        if (chunk.length > targetLength) {
            normalized.push(...splitByLength(chunk, targetLength));
        } else {
            normalized.push(chunk);
        }
    }

    return normalized;
}

function buildChunkText(section, topic, tags, body) {
    const headerParts = [];
    if (section) {
        headerParts.push(`Section: ${section}`);
    }
    if (topic) {
        headerParts.push(`Focus: ${topic}`);
    }
    if (tags && tags.length) {
        headerParts.push(`Tags: ${tags.join(', ')}`);
    }

    const header = headerParts.length ? `[${headerParts.join(' | ')}]` : '';
    return header ? `${header}\n${body.trim()}` : body.trim();
}

/**
 * Strip out TAG SYNTHESIS section - not for chunking
 * @param {string} content
 * @returns {string}
 */
function stripTagSynthesis(content) {
    // Check if TAG SYNTHESIS exclusion is enabled
    const settings = getRAGSettings();
    if (!settings.excludeTagSynthesis) {
        return content; // Don't strip if setting is disabled
    }

    // Remove TAG SYNTHESIS section (# 🎯**TAG SYNTHESIS**🎯 and everything after it until next main section or end)
    // Language-agnostic: look for the emoji pattern, not English text
    const tagSynthesisRegex = /^#\s*🎯\*\*[^*]+\*\*🎯.*?(?=^##\s+\S+\s+\d+\/\d+:|^##\s+[🤫💕🔗⚗️🌊😘🔥💚⚖️🚧]|\s*$)/gims;
    let cleaned = content.replace(tagSynthesisRegex, '');

    // Also remove if it appears as a subsection
    const subsectionTagSynthesisRegex = /^##\s*🎯\*\*[^*]+\*\*🎯.*?(?=^##\s+|^#\s+|\s*$)/gims;
    cleaned = cleaned.replace(subsectionTagSynthesisRegex, '');

    console.log('🚫 [stripTagSynthesis] Excluded TAG SYNTHESIS section from chunking');
    return cleaned;
}

// ============================================================================
// CONTENT SOURCE PARSERS
// ============================================================================

/**
 * Load a world info / lorebook file from SillyTavern
 * @param {string} lorebookName - Name of the lorebook file (without .json)
 * @returns {Promise<Object>} The lorebook data
 */
async function loadWorldInfo(lorebookName) {
    try {
        const response = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name: lorebookName })
        });

        if (!response.ok) {
            throw new Error(`Failed to load lorebook: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Failed to load lorebook "${lorebookName}":`, error);
        throw error;
    }
}

/**
 * Natural text chunking using recursive character splitting
 * Similar to LangChain's RecursiveCharacterTextSplitter
 * @param {string} text - Text to chunk
 * @param {object} options - Chunking options
 * @returns {string[]} Array of text chunks
 */
function naturalChunkText(text, options = {}) {
    const chunkSize = options.chunkSize || 500;
    const chunkOverlap = options.chunkOverlap !== undefined ? options.chunkOverlap : 50;

    if (!text || text.length === 0) return [];
    if (text.length <= chunkSize) return [text];

    const chunks = [];
    const separators = ['\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' ', ''];

    function splitText(remainingText, separatorIndex) {
        if (remainingText.length <= chunkSize) {
            if (remainingText.trim()) chunks.push(remainingText.trim());
            return;
        }

        const separator = separators[separatorIndex];

        if (separatorIndex >= separators.length - 1) {
            // Last resort: hard split
            chunks.push(remainingText.substring(0, chunkSize).trim());
            // If overlap is 0, start at chunkSize, otherwise use overlap
            const nextStart = chunkOverlap > 0 ? chunkSize - chunkOverlap : chunkSize;
            splitText(remainingText.substring(nextStart), separatorIndex);
            return;
        }

        if (!separator || !remainingText.includes(separator)) {
            splitText(remainingText, separatorIndex + 1);
            return;
        }

        const parts = remainingText.split(separator);
        let currentChunk = '';

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const testChunk = currentChunk + (currentChunk ? separator : '') + part;

            if (testChunk.length <= chunkSize) {
                currentChunk = testChunk;
            } else {
                if (currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                }

                // Start new chunk with overlap (or no overlap if chunkOverlap is 0)
                if (chunkOverlap > 0) {
                    const overlapStart = Math.max(0, currentChunk.length - chunkOverlap);
                    currentChunk = currentChunk.substring(overlapStart) + separator + part;
                } else {
                    // No overlap: start fresh with just the current part
                    currentChunk = part;
                }

                // If single part is too large, recurse with finer separator
                if (part.length > chunkSize) {
                    if (currentChunk.trim()) chunks.push(currentChunk.trim());
                    splitText(part, separatorIndex + 1);
                    currentChunk = '';
                }
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }
    }

    splitText(text, 0);
    return chunks.filter(c => c.trim().length > 0);
}

/**
 * Parse and vectorize a lorebook/world info
 */
async function parseLorebook(lorebookName, options = {}, progressCallback = null) {
    console.log(`📚 Parsing lorebook: ${lorebookName}`);

    const lorebook = await loadWorldInfo(lorebookName);
    console.log('📚 Lorebook data received:', lorebook);

    if (!lorebook) {
        throw new Error(`Failed to load lorebook: ${lorebookName} - lorebook is null/undefined`);
    }

    // Handle different lorebook data structures
    let entriesData = lorebook.entries;

    // Check if it's in a nested structure
    if (!entriesData && lorebook.data && lorebook.data.entries) {
        entriesData = lorebook.data.entries;
    }

    if (!entriesData) {
        console.error('📚 Lorebook structure:', Object.keys(lorebook));
        throw new Error(`Lorebook "${lorebookName}" has no entries property. Structure: ${JSON.stringify(Object.keys(lorebook))}`);
    }

    // Convert to array if it's an object
    const entriesArray = Array.isArray(entriesData)
        ? entriesData
        : Object.values(entriesData);

    console.log(`📚 Found ${entriesArray.length} total entries`);

    const entries = entriesArray.filter(entry => {
        if (!entry || typeof entry !== 'object') {
            console.warn('📚 Skipping invalid entry:', entry);
            return false;
        }
        if (!entry.content || entry.content.trim().length === 0) {
            console.log('📚 Skipping entry with no content:', entry.comment || 'unnamed');
            return false;
        }
        if (!options.includeDisabled && entry.disable) {
            console.log('📚 Skipping disabled entry:', entry.comment || 'unnamed');
            return false;
        }
        return true;
    });

    console.log(`📚 Filtered to ${entries.length} valid entries`);

    const chunkingStrategy = options.chunkingStrategy || 'per_entry';
    const chunks = [];

    // Extract settings with defaults
    const summarizeChunks = options.summarizeChunks || false;
    const summaryStyle = options.summaryStyle || 'concise';
    const perChunkSummaryControl = options.perChunkSummaryControl || false;
    const extractMetadata = options.extractMetadata !== false; // default true
    const perChunkMetadataControl = options.perChunkMetadataControl || false;

    // Text cleaning settings
    const cleaningMode = options.cleaningMode || 'balanced';
    const customPatterns = options.customPatterns || [];

    let entryIndex = 0;
    for (const entry of entries) {
        entryIndex++;

        // Report progress
        if (progressCallback) {
            progressCallback(entryIndex, entries.length);
        }
        // Clean the entry content before processing
        entry.content = cleanText(entry.content, cleaningMode, customPatterns);

        // Skip entries that become empty after text cleaning (HTML-only, code-only, etc.)
        if (!entry.content || entry.content.trim().length === 0) {
            console.warn(`📚 Skipping lorebook entry (empty after cleaning): "${entry.comment || entry.title || 'unnamed'}"`);
            continue;
        }

        // Handle different key formats
        let keys = [];
        if (Array.isArray(entry.key)) {
            keys = entry.key;
        } else if (typeof entry.key === 'string') {
            keys = entry.key.split(',').map(k => k.trim()).filter(Boolean);
        } else if (entry.keys && Array.isArray(entry.keys)) {
            keys = entry.keys;
        }

        const entryName = entry.comment || entry.title || 'Unnamed Entry';

        if (chunkingStrategy === 'paragraph') {
            // Split by paragraphs (double newlines)
            const paragraphs = entry.content.split(/\n\n+/).filter(p => p.trim().length > 0);

            paragraphs.forEach((para, idx) => {
                const chunkText = para.trim();
                // Use parent entry's keys instead of extracting from chunk
                chunks.push({
                    text: chunkText,
                    metadata: {
                        source: CONTENT_SOURCES.LOREBOOK,
                        lorebookName: lorebookName,
                        entryName: entryName,
                        paragraphIndex: idx,
                        keys: keys,
                        // Per-chunk control flags
                        enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                        enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                        summaryStyle: summaryStyle
                    },
                    section: entryName,
                    topic: `Paragraph ${idx + 1}`,
                    keywords: keys, // Use parent entry's keywords
                    systemKeywords: keys // Use parent entry's keywords
                });
            });
        } else if (chunkingStrategy === 'natural') {
            // Natural chunking using RecursiveCharacterTextSplitter-like logic
            const naturalChunks = naturalChunkText(entry.content, {
                chunkSize: options.chunkSize || 500,
                chunkOverlap: options.chunkOverlap || 50
            });

            naturalChunks.forEach((chunkText, idx) => {
                const title = getFirstSentenceTitle(chunkText) || `${entryName} (Part ${idx + 1})`;

                // Use parent entry's keys instead of extracting from chunk
                chunks.push({
                    text: chunkText,
                    metadata: {
                        source: CONTENT_SOURCES.LOREBOOK,
                        lorebookName: lorebookName,
                        entryName: entryName,
                        chunkIndex: idx,
                        keys: keys,
                        // Per-chunk control flags
                        enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                        enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                        summaryStyle: summaryStyle
                    },
                    section: entryName,
                    topic: title,
                    keywords: keys, // Use parent entry's keywords
                    systemKeywords: keys // Use parent entry's keywords
                });
            });
        } else if (chunkingStrategy === 'size') {
            // Fixed size chunking
            const sizedChunks = chunkDocumentSimple(entry.content, {
                chunkSize: options.chunkSize || 400,
                chunkOverlap: options.chunkOverlap || 50
            });

            sizedChunks.forEach((chunkText, idx) => {
                const title = getFirstSentenceTitle(chunkText) || `${entryName} (Part ${idx + 1})`;

                // Use parent entry's keys instead of extracting from chunk
                chunks.push({
                    text: chunkText,
                    metadata: {
                        source: CONTENT_SOURCES.LOREBOOK,
                        lorebookName: lorebookName,
                        entryName: entryName,
                        chunkIndex: idx,
                        keys: keys,
                        // Per-chunk control flags
                        enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                        enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                        summaryStyle: summaryStyle
                    },
                    section: entryName,
                    topic: title,
                    keywords: keys, // Use parent entry's keywords
                    systemKeywords: keys // Use parent entry's keywords
                });
            });
        } else if (chunkingStrategy === CHUNKING_STRATEGIES.SEMANTIC) {
            // Semantic chunking using AI embeddings to detect topic shifts
            console.log(`🧠 [RAGBooks] Using semantic chunking for entry: ${entryName}`);

            const semanticChunks = await semanticChunkText(entry.content, {
                similarityThreshold: options.semanticThreshold || 0.5,
                minChunkSize: options.minChunkSize || 100,
                maxChunkSize: options.maxChunkSize || 1500,
                progressCallback: (current, total) => {
                    console.log(`  Embedding ${current}/${total} sentences...`);
                }
            });

            semanticChunks.forEach((chunkText, idx) => {
                const title = getFirstSentenceTitle(chunkText) || `${entryName} (Part ${idx + 1})`;

                chunks.push({
                    text: chunkText,
                    metadata: {
                        source: CONTENT_SOURCES.LOREBOOK,
                        lorebookName: lorebookName,
                        entryName: entryName,
                        chunkIndex: idx,
                        keys: keys,
                        chunkingMethod: 'semantic',
                        // Per-chunk control flags
                        enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                        enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                        summaryStyle: summaryStyle
                    },
                    section: entryName,
                    topic: title,
                    keywords: keys,
                    systemKeywords: keys
                });
            });
        } else if (chunkingStrategy === CHUNKING_STRATEGIES.SLIDING_WINDOW) {
            // Sliding window with sentence-aware boundaries
            console.log(`🪟 [RAGBooks] Using sliding window chunking for entry: ${entryName}`);

            const windowChunks = slidingWindowChunk(entry.content, {
                windowSize: options.chunkSize || 500,
                overlapPercent: options.overlapPercent || 20,
                sentenceAware: true
            });

            windowChunks.forEach((chunkText, idx) => {
                const title = getFirstSentenceTitle(chunkText) || `${entryName} (Part ${idx + 1})`;

                chunks.push({
                    text: chunkText,
                    metadata: {
                        source: CONTENT_SOURCES.LOREBOOK,
                        lorebookName: lorebookName,
                        entryName: entryName,
                        chunkIndex: idx,
                        keys: keys,
                        chunkingMethod: 'sliding_window',
                        // Per-chunk control flags
                        enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                        enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                        summaryStyle: summaryStyle
                    },
                    section: entryName,
                    topic: title,
                    keywords: keys,
                    systemKeywords: keys
                });
            });
        } else {
            // Default: per_entry (one chunk per entry)
            // Use parent entry's keys instead of extracting
            chunks.push({
                text: entry.content,
                metadata: {
                    source: CONTENT_SOURCES.LOREBOOK,
                    lorebookName: lorebookName,
                    entryName: entryName,
                    keys: keys,
                    // Per-chunk control flags
                    enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                    enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                    summaryStyle: summaryStyle
                },
                section: entryName,
                topic: '',
                keywords: keys, // Use parent entry's keywords
                systemKeywords: keys // Use parent entry's keywords
            });
        }
    }

    console.log(`📚 Created ${chunks.length} chunks from lorebook using "${chunkingStrategy}" strategy`);

    // Generate AI summaries if enabled and content type supports it
    if (summarizeChunks && contentTypeSupportsSummarization('lorebook') && validateSummarySettings({ summarizeChunks, summaryStyle })) {
        console.log(`🤖 Generating ${summaryStyle} summaries for lorebook chunks...`);
        try {
            await generateSummariesForChunks(chunks, summaryStyle, options.summarizationCallback);
        } catch (error) {
            console.error('Failed to generate summaries, continuing without them:', error);
        }
    }

    // Create summary chunks for chunks with summaryVector enabled
    const chunksWithSummaries = createSummaryChunks(chunks);
    console.log(`📚 Total chunks including summaries: ${chunksWithSummaries.length}`);

    return chunksWithSummaries;
}

/**
 * Parse a character card into chunks based on selected fields
 * @param {string} characterId - Character ID or name
 * @param {object} options - Parsing options
 * @param {string[]} options.fields - Fields to include: 'description', 'personality', 'scenario', 'first_message', 'example_dialogs'
 * @param {string} options.chunkingStrategy - How to chunk: 'per_field', 'paragraph', 'smart_merge'
 * @returns {Promise<Array>} Array of chunk objects
 */
async function parseCharacterCard(characterId, options = {}, progressCallback = null) {
    console.log(`👤 Parsing character card: ${characterId}`);

    const defaultOptions = {
        fields: ['description', 'personality', 'scenario', 'creator_notes', 'system_prompt'],
        chunkingStrategy: CHUNKING_STRATEGIES.PER_FIELD
    };
    const config = { ...defaultOptions, ...options };

    // Extract settings with defaults
    const summarizeChunks = options.summarizeChunks || false;
    const summaryStyle = options.summaryStyle || 'concise';
    const perChunkSummaryControl = options.perChunkSummaryControl || false;
    const extractMetadata = options.extractMetadata !== false; // default true
    const perChunkMetadataControl = options.perChunkMetadataControl || false;

    // Text cleaning settings
    const cleaningMode = options.cleaningMode || 'balanced';
    const customPatterns = options.customPatterns || [];

    // Load character data from SillyTavern
    const characters = getContext().characters;
    const character = characters.find(c => c.avatar === characterId || c.name === characterId);

    if (!character) {
        throw new Error(`Character not found: ${characterId}`);
    }

    const chunks = [];

    // Field mapping with text cleaning applied
    const fieldMap = {
        description: { text: cleanText(character.description || '', cleaningMode, customPatterns), label: 'Description' },
        personality: { text: cleanText(character.personality || '', cleaningMode, customPatterns), label: 'Personality' },
        scenario: { text: cleanText(character.scenario || '', cleaningMode, customPatterns), label: 'Scenario' },
        first_message: { text: cleanText(character.first_mes || '', cleaningMode, customPatterns), label: 'First Message' },
        example_dialogs: { text: cleanText(character.mes_example || '', cleaningMode, customPatterns), label: 'Example Dialogs' },
        // V3 fields
        creator_notes: { text: cleanText(character.creator_notes || character.creatorcomment || '', cleaningMode, customPatterns), label: 'Creator Notes' },
        system_prompt: { text: cleanText(character.system_prompt || '', cleaningMode, customPatterns), label: 'System Prompt' },
        post_history_instructions: { text: cleanText(character.post_history_instructions || '', cleaningMode, customPatterns), label: 'Post-History Instructions' },
        // Extension fields
        depth_prompt: { text: cleanText(character.extensions?.depth_prompt?.prompt || '', cleaningMode, customPatterns), label: 'Depth Prompt' }
    };

    let fieldIndex = 0;
    if (config.chunkingStrategy === CHUNKING_STRATEGIES.PER_FIELD) {
        // One chunk per field
        for (const fieldName of config.fields) {
            fieldIndex++;

            // Report progress
            if (progressCallback) {
                progressCallback(fieldIndex, config.fields.length);
            }
            const field = fieldMap[fieldName];
            if (field && field.text && field.text.trim().length > 0) {
                // No keyword extraction for character cards - semantic search handles it
                chunks.push({
                    text: field.text,
                    metadata: {
                        source: CONTENT_SOURCES.CHARACTER,
                        characterName: character.name,
                        characterId: characterId,
                        field: fieldName,
                        fieldLabel: field.label,
                        // Per-chunk control flags
                        enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                        enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                        summaryStyle: summaryStyle
                    },
                    section: field.label,
                    topic: character.name,
                    keywords: [], // No keywords for natural character content
                    systemKeywords: [] // No keywords for natural character content
                });
            }
        }
    } else if (config.chunkingStrategy === CHUNKING_STRATEGIES.PARAGRAPH) {
        // Split each field by paragraphs
        fieldIndex = 0;
        for (const fieldName of config.fields) {
            fieldIndex++;

            // Report progress
            if (progressCallback) {
                progressCallback(fieldIndex, config.fields.length);
            }

            const field = fieldMap[fieldName];
            if (field && field.text && field.text.trim().length > 0) {
                const paragraphs = field.text.split(/\n\n+/).filter(p => p.trim().length > 0);
                paragraphs.forEach((para, idx) => {
                    const chunkText = para.trim();
                    // No keyword extraction for character cards - semantic search handles it
                    chunks.push({
                        text: chunkText,
                        metadata: {
                            source: CONTENT_SOURCES.CHARACTER,
                            characterName: character.name,
                            characterId: characterId,
                            field: fieldName,
                            fieldLabel: field.label,
                            paragraphIndex: idx,
                            // Per-chunk control flags
                            enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                            enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                            summaryStyle: summaryStyle
                        },
                        section: field.label,
                        topic: `Paragraph ${idx + 1}`,
                        keywords: [], // No keywords for natural character content
                        systemKeywords: [] // No keywords for natural character content
                    });
                });
            }
        }
    } else if (config.chunkingStrategy === 'natural') {
        // Natural chunking for all fields
        fieldIndex = 0;
        for (const fieldName of config.fields) {
            fieldIndex++;

            // Report progress
            if (progressCallback) {
                progressCallback(fieldIndex, config.fields.length);
            }

            const field = fieldMap[fieldName];
            if (field && field.text && field.text.trim().length > 0) {
                const naturalChunks = naturalChunkText(field.text, {
                    chunkSize: options.chunkSize || 500,
                    chunkOverlap: options.chunkOverlap || 50
                });
                naturalChunks.forEach((chunkText, idx) => {
                    const title = getFirstSentenceTitle(chunkText) || `${field.label} (Part ${idx + 1})`;

                    // No keyword extraction for character cards - semantic search handles it
                    chunks.push({
                        text: chunkText,
                        metadata: {
                            source: CONTENT_SOURCES.CHARACTER,
                            characterName: character.name,
                            characterId: characterId,
                            field: fieldName,
                            fieldLabel: field.label,
                            chunkIndex: idx,
                            // Per-chunk control flags
                            enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                            enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                            summaryStyle: summaryStyle
                        },
                        section: field.label,
                        topic: title,
                        keywords: [], // No keywords for natural character content
                        systemKeywords: [] // No keywords for natural character content
                    });
                });
            }
        }
    } else if (config.chunkingStrategy === CHUNKING_STRATEGIES.SEMANTIC) {
        // Semantic chunking for character fields using AI embeddings
        console.log(`🧠 [RAGBooks] Using semantic chunking for character: ${character.name}`);

        fieldIndex = 0;
        for (const fieldName of config.fields) {
            fieldIndex++;

            if (progressCallback) {
                progressCallback(fieldIndex, config.fields.length);
            }

            const field = fieldMap[fieldName];
            if (field && field.text && field.text.trim().length > 0) {
                const semanticChunks = await semanticChunkText(field.text, {
                    similarityThreshold: options.semanticThreshold || 0.5,
                    minChunkSize: options.minChunkSize || 100,
                    maxChunkSize: options.maxChunkSize || 1500,
                    progressCallback: (current, total) => {
                        console.log(`  ${field.label}: Embedding ${current}/${total} sentences...`);
                    }
                });

                semanticChunks.forEach((chunkText, idx) => {
                    const title = getFirstSentenceTitle(chunkText) || `${field.label} (Part ${idx + 1})`;

                    chunks.push({
                        text: chunkText,
                        metadata: {
                            source: CONTENT_SOURCES.CHARACTER,
                            characterName: character.name,
                            characterId: characterId,
                            field: fieldName,
                            fieldLabel: field.label,
                            chunkIndex: idx,
                            chunkingMethod: 'semantic',
                            enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                            enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                            summaryStyle: summaryStyle
                        },
                        section: field.label,
                        topic: title,
                        keywords: [],
                        systemKeywords: []
                    });
                });
            }
        }
    } else if (config.chunkingStrategy === CHUNKING_STRATEGIES.SLIDING_WINDOW) {
        // Sliding window for character fields with sentence-aware boundaries
        console.log(`🪟 [RAGBooks] Using sliding window chunking for character: ${character.name}`);

        fieldIndex = 0;
        for (const fieldName of config.fields) {
            fieldIndex++;

            if (progressCallback) {
                progressCallback(fieldIndex, config.fields.length);
            }

            const field = fieldMap[fieldName];
            if (field && field.text && field.text.trim().length > 0) {
                const windowChunks = slidingWindowChunk(field.text, {
                    windowSize: options.chunkSize || 500,
                    overlapPercent: options.overlapPercent || 20,
                    sentenceAware: true
                });

                windowChunks.forEach((chunkText, idx) => {
                    const title = getFirstSentenceTitle(chunkText) || `${field.label} (Part ${idx + 1})`;

                    chunks.push({
                        text: chunkText,
                        metadata: {
                            source: CONTENT_SOURCES.CHARACTER,
                            characterName: character.name,
                            characterId: characterId,
                            field: fieldName,
                            fieldLabel: field.label,
                            chunkIndex: idx,
                            chunkingMethod: 'sliding_window',
                            enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                            enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                            summaryStyle: summaryStyle
                        },
                        section: field.label,
                        topic: title,
                        keywords: [],
                        systemKeywords: []
                    });
                });
            }
        }
    } else if (config.chunkingStrategy === CHUNKING_STRATEGIES.SMART_MERGE) {
        // Merge all selected fields into a single chunk
        const combinedText = config.fields
            .map(fieldName => {
                const field = fieldMap[fieldName];
                if (field && field.text && field.text.trim().length > 0) {
                    return `${field.label}:\n${field.text}`;
                }
                return '';
            })
            .filter(t => t.length > 0)
            .join('\n\n');

        if (combinedText.length > 0) {
            // No keyword extraction for character cards - semantic search handles it
            chunks.push({
                text: combinedText,
                metadata: {
                    source: CONTENT_SOURCES.CHARACTER,
                    characterName: character.name,
                    characterId: characterId,
                    field: 'merged',
                    fieldLabel: 'All Fields',
                    // Per-chunk control flags
                    enableSummary: perChunkSummaryControl ? true : summarizeChunks,
                    enableMetadata: perChunkMetadataControl ? true : extractMetadata,
                    summaryStyle: summaryStyle
                },
                section: 'Character Card',
                topic: character.name,
                keywords: [], // No keywords for natural character content
                systemKeywords: [] // No keywords for natural character content
            });
        }
    }

    console.log(`👤 Created ${chunks.length} chunks from character card`);

    // Generate AI summaries if enabled and content type supports it
    if (summarizeChunks && contentTypeSupportsSummarization('character') && validateSummarySettings({ summarizeChunks, summaryStyle })) {
        console.log(`🤖 Generating ${summaryStyle} summaries for character chunks...`);
        try {
            await generateSummariesForChunks(chunks, summaryStyle, options.summarizationCallback);
        } catch (error) {
            console.error('Failed to generate summaries, continuing without them:', error);
        }
    }

    // Create summary chunks for chunks with summaryVector enabled
    const chunksWithSummaries = createSummaryChunks(chunks);
    console.log(`👤 Total chunks including summaries: ${chunksWithSummaries.length}`);

    return chunksWithSummaries;
}

/**
 * Parse chat history into chunks
 * @param {object} options - Parsing options
 * @param {string} options.chatId - Chat file identifier (defaults to current chat)
 * @param {string} options.chunkingStrategy - How to chunk: 'by_speaker', 'by_topic', 'size'
 * @param {number} options.messageRange - Number of recent messages to include (default: all)
 * @param {number} options.chunkSize - Size for size-based chunking (default: 500)
 * @returns {Promise<Array>} Array of chunk objects
 */
async function parseChatHistory(options = {}, progressCallback = null) {
    console.log(`💬 Parsing chat history`);

    const defaultOptions = {
        chatId: null, // null = current chat
        chunkingStrategy: CHUNKING_STRATEGIES.BY_SPEAKER,
        messageRange: null, // null = all messages
        chunkSize: 500,
        nameFormat: 'actual' // 'actual' or 'macros'
    };
    const config = { ...defaultOptions, ...options };

    // Get chat data from SillyTavern
    const context = getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) {
        console.warn('No chat messages found');
        return [];
    }

    // Apply message range filter
    const messages = config.messageRange
        ? chat.slice(-config.messageRange)
        : chat;

    const chunks = [];
    const characterName = context.name2; // Bot name
    const userName = context.name1; // User name

    // Extract settings with defaults
    const summarizeChunks = options.summarizeChunks || false;
    const summaryStyle = options.summaryStyle || 'concise';

    // Text cleaning settings
    const cleaningMode = options.cleaningMode || 'basic'; // Chat defaults to basic cleaning
    const customPatterns = options.customPatterns || [];

    // Determine name format based on settings
    const useMacros = config.nameFormat === 'macros';
    const getUserName = () => useMacros ? '{{user}}' : userName;
    const getCharName = () => useMacros ? '{{char}}' : characterName;

    let messageIndex = 0;
    const totalMessages = messages.length;

    if (config.chunkingStrategy === CHUNKING_STRATEGIES.BY_SPEAKER) {
        // Group consecutive messages by the same speaker
        let currentSpeaker = null;
        let currentGroup = [];

        for (const msg of messages) {
            messageIndex++;

            // Report progress
            if (progressCallback) {
                progressCallback(messageIndex, totalMessages);
            }
            const speaker = msg.is_user ? getUserName() : getCharName();
            // Clean the message text
            const cleanedMessage = cleanText(msg.mes || '', cleaningMode, customPatterns);

            // Skip messages that are empty after cleaning (image-only, deleted, etc.)
            if (!cleanedMessage || cleanedMessage.trim().length === 0) {
                continue;
            }

            if (speaker !== currentSpeaker && currentGroup.length > 0) {
                // Save previous group
                const chunkText = currentGroup.join('\n\n');
                const title = getFirstSentenceTitle(chunkText) || `${currentSpeaker}'s Messages`;

                // No keyword extraction for chat - semantic search handles it
                chunks.push({
                    text: chunkText,
                    metadata: {
                        source: CONTENT_SOURCES.CHAT,
                        speaker: currentSpeaker,
                        messageCount: currentGroup.length,
                        chatId: config.chatId || 'current'
                    },
                    section: `${currentSpeaker}'s Messages`,
                    topic: title,
                    keywords: [], // No keywords for natural chat content
                    systemKeywords: [], // No keywords for natural chat content
                    conditions: { enabled: false } // Chat chunks default to always active
                });
                currentGroup = [];
            }

            currentSpeaker = speaker;
            currentGroup.push(`${speaker}: ${cleanedMessage}`);
        }

        // Save final group
        if (currentGroup.length > 0) {
            const chunkText = currentGroup.join('\n\n');
            const title = getFirstSentenceTitle(chunkText) || `${currentSpeaker}'s Messages`;

            // No keyword extraction for chat - semantic search handles it
            chunks.push({
                text: chunkText,
                metadata: {
                    source: CONTENT_SOURCES.CHAT,
                    speaker: currentSpeaker,
                    messageCount: currentGroup.length,
                    chatId: config.chatId || 'current'
                },
                section: `${currentSpeaker}'s Messages`,
                topic: title,
                keywords: [], // No keywords for natural chat content
                systemKeywords: [], // No keywords for natural chat content
                conditions: { enabled: false } // Chat chunks default to always active
            });
        }
    } else if (config.chunkingStrategy === 'by_scene') {
        // Scene-based chunking - use processScenesToChunks from dual-vector.js
        const scenes = getScenes();

        // Validate scenes exist
        if (!scenes || scenes.length === 0) {
            throw new Error(
                '❌ Scene-based chunking selected, but no scenes are marked in this chat.\n\n' +
                '📝 To fix this:\n' +
                '• Mark scenes using the green flag button (scene start) and red flag button (scene end) in your chat\n' +
                '• OR choose a different chunking strategy (By Speaker, Natural, etc.)'
            );
        }

        // Validate at least one scene is closed
        const closedScenes = scenes.filter(s => s.end !== null && s.start <= s.end);
        if (closedScenes.length === 0) {
            throw new Error(
                `❌ Scene-based chunking selected, but all ${scenes.length} scene(s) are still open.\n\n` +
                '📝 To fix this:\n' +
                '• Close at least one scene using the red flag button (scene end)\n' +
                '• OR choose a different chunking strategy (By Speaker, Natural, etc.)'
            );
        }

        console.log(`💬 Processing ${closedScenes.length} closed scene(s) into chunks...`);
        const sceneChunks = processScenesToChunks(chat, closedScenes, config);
        chunks.push(...sceneChunks);

        if (sceneChunks.length === 0) {
            console.warn(`⚠️ Scene processing returned 0 chunks - this may indicate an issue`);
        }
    } else if (config.chunkingStrategy === CHUNKING_STRATEGIES.SIZE_BASED) {
        // Fixed-size chunks with overlap - actually respects character limit
        // Build full chat text first
        const chatMessages = [];
        messageIndex = 0;
        for (const msg of messages) {
            messageIndex++;

            // Report progress
            if (progressCallback) {
                progressCallback(messageIndex, totalMessages);
            }

            const speaker = msg.is_user ? getUserName() : getCharName();
            const cleanedMessage = cleanText(msg.mes || '', cleaningMode, customPatterns);

            // Skip messages that are empty after cleaning
            if (!cleanedMessage || cleanedMessage.trim().length === 0) {
                continue;
            }

            chatMessages.push(`${speaker}: ${cleanedMessage}`);
        }

        if (chatMessages.length === 0) {
            console.warn('⚠️ All chat messages were empty after cleaning');
            return [];
        }

        // Join all messages and split by target size
        const fullChatText = chatMessages.join('\n\n');
        const overlap = Math.floor(config.chunkSize * 0.1); // 10% overlap
        const textChunks = splitTextToSizedChunks(fullChatText, config.chunkSize, overlap);

        textChunks.forEach((chunkText, index) => {
            const title = getFirstSentenceTitle(chunkText) || `Chunk ${index + 1} of ${textChunks.length}`;

            chunks.push({
                text: chunkText,
                metadata: {
                    source: CONTENT_SOURCES.CHAT,
                    chatId: config.chatId || 'current'
                },
                section: 'Chat History',
                topic: title,
                keywords: [],
                systemKeywords: [],
                conditions: { enabled: false }
            });
        });
    }

    console.log(`💬 Created ${chunks.length} chunks from chat history`);

    // Filter out empty chunks (can happen after aggressive text cleaning)
    const originalCount = chunks.length;
    chunks = chunks.filter(chunk => chunk.text && chunk.text.trim().length > 0);
    if (chunks.length < originalCount) {
        console.warn(`⚠️ Filtered out ${originalCount - chunks.length} empty chunks after text cleaning`);
    }

    if (chunks.length === 0) {
        throw new Error('All chat messages were filtered out (empty text after cleaning). Try adjusting your text cleaning settings or check if chat contains valid content.');
    }

    console.log(`💬 Final chunk count after filtering: ${chunks.length}`);

    // Generate AI summaries if enabled and content type supports it
    if (summarizeChunks && contentTypeSupportsSummarization('chat') && validateSummarySettings({ summarizeChunks, summaryStyle })) {
        console.log(`🤖 Generating ${summaryStyle} summaries for chat chunks...`);
        try {
            await generateSummariesForChunks(chunks, summaryStyle, options.summarizationCallback);
        } catch (error) {
            console.error('Failed to generate summaries, continuing without them:', error);
        }
    }

    // Create summary chunks for chunks with summaryVector enabled
    const chunksWithSummaries = createSummaryChunks(chunks);
    console.log(`💬 Total chunks including summaries: ${chunksWithSummaries.length}`);

    return chunksWithSummaries;
}

/**
 * Parse custom document/text
 * @param {string} text - Raw text content
 * @param {object} metadata - Document metadata (name, category, etc.)
 * @param {object} options - Parsing options
 * @param {string} options.chunkingStrategy - How to chunk: 'section', 'paragraph', 'size'
 * @param {number} options.chunkSize - Size for size-based chunking (default: 500)
 * @returns {Promise<Array>} Array of chunk objects
 */
async function parseCustomDocument(text, metadata = {}, options = {}, progressCallback = null) {
    console.log(`📄 Parsing custom document: ${metadata.name || 'Unnamed'}`);

    const defaultOptions = {
        chunkingStrategy: CHUNKING_STRATEGIES.PARAGRAPH,
        chunkSize: 500
    };
    const config = { ...defaultOptions, ...options };

    // Extract settings with defaults
    const summarizeChunks = options.summarizeChunks || false;
    const summaryStyle = options.summaryStyle || 'concise';
    const perChunkSummaryControl = options.perChunkSummaryControl || false;
    const extractMetadata = options.extractMetadata !== false; // default true
    const perChunkMetadataControl = options.perChunkMetadataControl || false;

    // Text cleaning settings
    const cleaningMode = options.cleaningMode || 'balanced';
    const customPatterns = options.customPatterns || [];

    // Validate text parameter
    if (!text || typeof text !== 'string') {
        throw new Error('Document text must be a valid string');
    }

    if (text.trim().length === 0) {
        throw new Error('Document text is empty');
    }

    // Clean the document text before processing
    text = cleanText(text, cleaningMode, customPatterns);

    const chunks = [];
    const baseMetadata = {
        source: CONTENT_SOURCES.CUSTOM,
        documentName: metadata.name || 'Unnamed Document',
        category: metadata.category || 'General',
        // Per-chunk control flags
        enableSummary: perChunkSummaryControl ? true : summarizeChunks,
        enableMetadata: perChunkMetadataControl ? true : extractMetadata,
        summaryStyle: summaryStyle,
        ...metadata
    };

    if (config.chunkingStrategy === CHUNKING_STRATEGIES.SECTION_BASED) {
        // Split by markdown headers (## or #)
        const normalized = text.replace(/\r\n/g, '\n');
        const headerRegex = /^#{1,3}\s*(.+)$/gm;
        const sections = [];

        let lastIndex = 0;
        let match;
        let lastHeader = null;

        while ((match = headerRegex.exec(normalized)) !== null) {
            if (lastIndex > 0) {
                const sectionText = normalized.slice(lastIndex, match.index).trim();
                if (sectionText.length > 0) {
                    sections.push({
                        header: lastHeader,
                        text: sectionText
                    });
                }
            }
            lastHeader = match[1];
            lastIndex = match.index + match[0].length;
        }

        // Add final section
        if (lastIndex < normalized.length) {
            const sectionText = normalized.slice(lastIndex).trim();
            if (sectionText.length > 0) {
                sections.push({
                    header: lastHeader,
                    text: sectionText
                });
            }
        }

        sections.forEach((section, idx) => {
            // No keyword extraction for URL/custom content - semantic search handles it
            chunks.push({
                text: section.text,
                metadata: {
                    ...baseMetadata,
                    sectionHeader: section.header,
                    sectionIndex: idx
                },
                section: section.header || `Section ${idx + 1}`,
                topic: baseMetadata.documentName,
                keywords: [], // No keywords for natural URL/custom content
                systemKeywords: [] // No keywords for natural URL/custom content
            });
        });
    } else if (config.chunkingStrategy === CHUNKING_STRATEGIES.PARAGRAPH) {
        // Split by paragraphs (\n\n)
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

        paragraphs.forEach((para, idx) => {
            const chunkText = para.trim();
            // No keyword extraction for URL/custom content - semantic search handles it
            chunks.push({
                text: chunkText,
                metadata: {
                    ...baseMetadata,
                    paragraphIndex: idx
                },
                section: baseMetadata.documentName,
                topic: `Paragraph ${idx + 1}`,
                keywords: [], // No keywords for natural URL/custom content
                systemKeywords: [] // No keywords for natural URL/custom content
            });
        });
    } else if (config.chunkingStrategy === CHUNKING_STRATEGIES.SIZE_BASED) {
        // Fixed-size chunks with overlap
        const normalized = text.replace(/\r\n/g, '\n');
        const words = normalized.split(/\s+/);
        const overlap = Math.floor(config.chunkSize * 0.1);

        let currentChunk = [];
        let currentLength = 0;

        for (const word of words) {
            if (currentLength + word.length > config.chunkSize && currentChunk.length > 0) {
                const chunkText = currentChunk.join(' ');
                // No keyword extraction for URL/custom content - semantic search handles it
                chunks.push({
                    text: chunkText,
                    metadata: {
                        ...baseMetadata,
                        chunkIndex: chunks.length
                    },
                    section: baseMetadata.documentName,
                    topic: `Chunk ${chunks.length + 1}`,
                    keywords: [], // No keywords for natural URL/custom content
                    systemKeywords: [] // No keywords for natural URL/custom content
                });

                // Keep last N words for overlap
                currentChunk = currentChunk.slice(-overlap);
                currentLength = currentChunk.join(' ').length;
            }

            currentChunk.push(word);
            currentLength += word.length + 1; // +1 for space
        }

        // Save final chunk
        if (currentChunk.length > 0) {
            const chunkText = currentChunk.join(' ');
            // No keyword extraction for URL/custom content - semantic search handles it
            chunks.push({
                text: chunkText,
                metadata: {
                    ...baseMetadata,
                    chunkIndex: chunks.length
                },
                section: baseMetadata.documentName,
                topic: `Chunk ${chunks.length + 1}`,
                keywords: [], // No keywords for natural URL/custom content
                systemKeywords: [] // No keywords for natural URL/custom content
            });
        }
    } else if (config.chunkingStrategy === CHUNKING_STRATEGIES.SEMANTIC) {
        // Semantic chunking using AI embeddings to detect topic shifts
        console.log(`🧠 [RAGBooks] Using semantic chunking for document: ${baseMetadata.documentName}`);

        const semanticChunks = await semanticChunkText(text, {
            similarityThreshold: options.semanticThreshold || 0.5,
            minChunkSize: options.minChunkSize || 100,
            maxChunkSize: options.maxChunkSize || 1500,
            progressCallback: (current, total) => {
                console.log(`  Embedding ${current}/${total} sentences...`);
                if (progressCallback) {
                    progressCallback(current, total);
                }
            }
        });

        semanticChunks.forEach((chunkText, idx) => {
            const title = getFirstSentenceTitle(chunkText) || `Part ${idx + 1}`;

            chunks.push({
                text: chunkText,
                metadata: {
                    ...baseMetadata,
                    chunkIndex: idx,
                    chunkingMethod: 'semantic'
                },
                section: baseMetadata.documentName,
                topic: title,
                keywords: [],
                systemKeywords: []
            });
        });
    } else if (config.chunkingStrategy === CHUNKING_STRATEGIES.SLIDING_WINDOW) {
        // Sliding window with sentence-aware boundaries
        console.log(`🪟 [RAGBooks] Using sliding window chunking for document: ${baseMetadata.documentName}`);

        const windowChunks = slidingWindowChunk(text, {
            windowSize: options.chunkSize || 500,
            overlapPercent: options.overlapPercent || 20,
            sentenceAware: true
        });

        windowChunks.forEach((chunkText, idx) => {
            const title = getFirstSentenceTitle(chunkText) || `Part ${idx + 1}`;

            chunks.push({
                text: chunkText,
                metadata: {
                    ...baseMetadata,
                    chunkIndex: idx,
                    chunkingMethod: 'sliding_window'
                },
                section: baseMetadata.documentName,
                topic: title,
                keywords: [],
                systemKeywords: []
            });
        });
    }

    console.log(`📄 Created ${chunks.length} chunks from custom document`);

    // Generate AI summaries if enabled and content type supports it
    if (summarizeChunks && contentTypeSupportsSummarization('custom') && validateSummarySettings({ summarizeChunks, summaryStyle })) {
        console.log(`🤖 Generating ${summaryStyle} summaries for custom document chunks...`);
        try {
            await generateSummariesForChunks(chunks, summaryStyle, options.summarizationCallback);
        } catch (error) {
            console.error('Failed to generate summaries, continuing without them:', error);
        }
    }

    // Create summary chunks for chunks with summaryVector enabled
    const chunksWithSummaries = createSummaryChunks(chunks);
    console.log(`📄 Total chunks including summaries: ${chunksWithSummaries.length}`);

    return chunksWithSummaries;
}

// ============================================================================
// DOCUMENT CHUNKING FUNCTIONS
// ============================================================================

/**
 * Simple chunking: Split by ## headers only
 */
function chunkDocumentSimple(content, characterName) {
    // Strip TAG SYNTHESIS before chunking
    content = stripTagSynthesis(content);

    const normalized = content.replace(/\r\n/g, '\n');
    const chunks = [];
    let chunkIndex = 0;

    // Split by any ## or # header - VERY PERMISSIVE
    const headerRegex = /^#{1,2}\s*(.+)$/gm;
    const sections = [];

    // Collect all matches first
    const matches = [];
    let match;
    while ((match = headerRegex.exec(normalized)) !== null) {
        matches.push({
            index: match.index,
            length: match[0].length,
            title: match[1].trim()
        });
    }

    debugLog(`Simple chunking: Found ${matches.length} header matches`);

    // IMPORTANT: Track what content we've captured to ensure nothing is lost
    let capturedRanges = [];

    // Store any content before first header
    if (matches.length > 0 && matches[0].index > 0) {
        const preContent = normalized.substring(0, matches[0].index).trim();
        if (preContent && preContent.length >= 10) { // Only skip if truly empty (allow very short content)
            sections.push({
                title: 'Header',
                content: preContent
            });
            capturedRanges.push({ start: 0, end: matches[0].index });
        }
    }

    // Process each match
    matches.forEach((currentMatch, idx) => {
        const nextMatch = matches[idx + 1];
        const endIndex = nextMatch ? nextMatch.index : normalized.length;
        const sectionContent = normalized.substring(currentMatch.index + currentMatch.length, endIndex).trim();

        // ALWAYS include the section, even if content is empty or just whitespace
        // This ensures every header gets chunked
        sections.push({
            title: currentMatch.title,
            content: sectionContent || '(Empty section)' // Placeholder for empty sections
        });
        capturedRanges.push({ start: currentMatch.index, end: endIndex });
    });

    // FAILSAFE: If no sections found, treat entire content as one chunk
    if (sections.length === 0) {
        sections.push({
            title: DEFAULT_SECTION_TITLE,
            content: normalized.trim() || '(Empty content)'
        });
    }

    // VALIDATION: Check if we missed any content
    const totalContentLength = normalized.length;
    const capturedLength = capturedRanges.reduce((sum, range) => sum + (range.end - range.start), 0);
    if (capturedLength < totalContentLength * 0.9) { // If we missed more than 10% of content
        console.warn(`⚠️ Simple chunking may have missed content: Captured ${capturedLength}/${totalContentLength} chars (${Math.round(capturedLength/totalContentLength*100)}%)`);
    }

    debugLog(`Simple chunking: Found ${sections.length} sections, captured ${capturedLength}/${totalContentLength} chars`);

    // Collect all section titles for filtering
    const allSectionTitles = sections.map(s => s.title);

    // Create one chunk per section - NEVER skip sections
    sections.forEach(section => {
        const tags = collectTags(section.content);
        const chunkText = `[${section.title}]\n${section.content}`;
        const hash = getStringHash(`${characterName}|${section.title}|${chunkIndex}|${chunkText}`);
        const metadata = buildChunkMetadata(section.title, null, chunkText, tags, characterName, allSectionTitles);

        chunks.push({
            text: chunkText,
            hash,
            index: chunkIndex++,
            metadata,
        });
    });

    debugLog(`Simple chunked document for ${characterName}`, {
        totalChunks: chunks.length,
        averageSize: chunks.length ? Math.round(chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length) : 0,
        sections: sections.map(s => ({ title: s.title, length: s.content.length })),
    });

    // Apply automatic cross-section linking based on keyword frequency
    applyAutomaticLinks(chunks);

    return chunks;
}

/**
 * Split document content into semantic chunks respecting SECTION 1-8 structure.
 * @param {string} content
 * @param {string} characterName
 * @param {number} targetChunkSize
 * @param {number} overlapSize
 * @returns {{text: string, hash: number, index: number, metadata: object}[]}
 */
function chunkDocument(content, characterName, targetChunkSize = 1000, overlapSize = 300) {
    const settings = getRAGSettings();

    // Use section-based chunking if enabled
    if (settings.simpleChunking) {
        return chunkDocumentSimple(content, characterName);
    }

    // Math-based chunking: Split entire content into equal-sized chunks
    return chunkDocumentMathBased(content, characterName, targetChunkSize, overlapSize);
}

/**
 * Pure math-based chunking: Split entire content into equal-sized chunks with overlap
 * Ignores section headers, just splits by size
 */
function chunkDocumentMathBased(content, characterName, targetChunkSize = 1000, overlapSize = 300) {
    // Strip TAG SYNTHESIS before chunking
    content = stripTagSynthesis(content);

    const normalized = content.replace(/\r\n/g, '\n').trim();
    const chunks = [];

    if (!normalized) {
        return chunks;
    }

    debugLog(`Math-based chunking: Total content length = ${normalized.length} chars`);

    // Split the entire content into chunks using the math-based splitter
    const fragments = splitTextToSizedChunks(normalized, targetChunkSize, overlapSize);

    debugLog(`Math-based chunking: Split into ${fragments.length} chunks`);

    fragments.forEach((fragment, idx) => {
        const chunkText = fragment.trim();
        if (!chunkText || chunkText.length < 50) {
            return; // Skip tiny/empty chunks
        }

        const hash = getStringHash(`${characterName}|math|${idx}|${chunkText}`);
        const tags = collectTags(chunkText);

        // Build metadata for math-based chunk
        const metadata = buildChunkMetadata(
            `Chunk ${idx + 1}/${fragments.length}`,
            null,
            chunkText,
            tags,
            characterName
        );

        chunks.push({
            text: chunkText,
            hash,
            index: idx,
            metadata,
        });
    });

    debugLog(`Math-based chunking complete for ${characterName}`, {
        totalChunks: chunks.length,
        averageSize: chunks.length ? Math.round(chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length) : 0,
        targetSize: targetChunkSize,
        overlap: overlapSize,
    });

    return chunks;
}

/**
 * Section-based chunking with intelligent subsection handling
 * This is the OLD chunkDocument logic, now renamed for clarity
 */
function chunkDocumentSectionBased(content, characterName, targetChunkSize = 1000, overlapSize = 300) {
    // Strip TAG SYNTHESIS before chunking
    content = stripTagSynthesis(content);

    const normalized = content.replace(/\r\n/g, '\n');
    const chunks = [];
    let chunkIndex = 0;

    // Split by numbered section headers - VERY PERMISSIVE & LANGUAGE-AGNOSTIC
    // Matches ANY word followed by numbers (works for all languages):
    // ## SECTION 1/8:, ##セクション 1/8, # 部分 1/8, SECCIÓN 1/8:, etc.
    // \S+ matches any non-whitespace = works for Chinese, Japanese, Korean, Arabic, Cyrillic, etc.
    const sectionRegex = /^#{0,2}\s*(\S+)\s+(\d+)\s*\/\s*(\d+):?\s*(.*)$/gim;
    const sections = [];
    let sectionKeyword = 'Section'; // Will be extracted from first match

    // Collect all matches first to avoid lastIndex issues
    const matches = [];
    let match;
    while ((match = sectionRegex.exec(normalized)) !== null) {
        matches.push({
            index: match.index,
            length: match[0].length,
            keyword: match[1],
            sectionNum: parseInt(match[2]),
            totalSections: parseInt(match[3]),
            sectionTitle: match[4].trim()
        });
    }

    debugLog(`Found ${matches.length} section headers in document`);

    // Store any content before the first section (title, header, etc.)
    if (matches.length > 0 && matches[0].index > 0) {
        const preContent = normalized.substring(0, matches[0].index).trim();
        if (preContent) {
            sections.push({
                number: 0,
                title: 'Header',
                content: preContent
            });
        }
    }

    // Process each match
    matches.forEach((currentMatch, idx) => {
        if (sections.length === 0) {
            sectionKeyword = currentMatch.keyword; // Remember the keyword used
        }

        const nextMatch = matches[idx + 1];
        const endIndex = nextMatch ? nextMatch.index : normalized.length;
        const sectionContent = normalized.substring(currentMatch.index + currentMatch.length, endIndex).trim();

        sections.push({
            number: currentMatch.sectionNum,
            title: currentMatch.sectionTitle,
            content: sectionContent,
            fullTitle: `${sectionKeyword} ${currentMatch.sectionNum}/${currentMatch.totalSections}: ${currentMatch.sectionTitle}`
        });
    });

    // If no sections found, treat entire content as one chunk
    if (sections.length === 0) {
        sections.push({
            number: 1,
            title: DEFAULT_SECTION_TITLE,
            content: normalized.trim(),
            fullTitle: DEFAULT_SECTION_TITLE
        });
    }

    debugLog(`Found ${sections.length} main sections in document`);

    // Collect all section titles for keyword filtering
    const allSectionTitles = sections.map(s => s.title).concat(sections.map(s => s.fullTitle)).filter(Boolean);

    // Filter function to check if content should be chunked
    function shouldChunkContent(content, title) {
        const trimmed = content.trim();

        // Skip empty or nearly empty content
        if (!trimmed || trimmed.length < 50 || trimmed === '---') {
            return false;
        }

        // Skip metadata sections (strip markdown formatting first)
        const cleanTitle = title.replace(/[\*\#\~\_]/g, '').trim();
        const metadataTitles = [
            /ANALYSIS\s*COMPLETE/i,
            /TAG\s*SYNTHESIS/i,
            /\bsection\b\s*$/i,  // Just the word "section"
            /BunnymoTags/i,
            /^(Header|Footer|Metadata)$/i,
        ];

        for (const pattern of metadataTitles) {
            if (pattern.test(cleanTitle)) {
                return false;
            }
        }

        // Skip sections that are mostly BunnymoTags closing blocks
        if (/<\/BunnymoTags>/i.test(trimmed) || /<Genre>/i.test(trimmed)) {
            return false;
        }

        return true;
    }

    // Process each section
    sections.forEach(section => {
        // Skip empty or metadata sections
        if (!shouldChunkContent(section.content, section.fullTitle || section.title)) {
            return;
        }

        const tags = collectTags(section.content);

        // Last section special handling - split by emoji subsection headers
        // Works for any total (8, 6, 10, etc.) - just check if it's the last numbered section
        const isLastSection = sections.length > 0 && section.number === Math.max(...sections.map(s => s.number));
        if (isLastSection) {
            // Match any ## header with optional emoji prefix
            const subsectionRegex = /^##\s+([^\n]+)$/gim;
            const subsections = [];
            let subLastIndex = 0;
            let subMatch;

            while ((subMatch = subsectionRegex.exec(section.content)) !== null) {
                subsectionRegex.lastIndex = subMatch.index + subMatch[0].length;
                const nextSubMatch = subsectionRegex.exec(section.content);
                subsectionRegex.lastIndex = subMatch.index + subMatch[0].length;

                const subEndIndex = nextSubMatch ? nextSubMatch.index : section.content.length;
                const subsectionContent = section.content.substring(subMatch.index + subMatch[0].length, subEndIndex).trim();
                const subsectionTitle = subMatch[1].trim()
                    .replace(/\*/g, '')  // Remove asterisks
                    .replace(/^[💕🔗⚗️🌊😘🔥💚⚖️🚧🎯]\s*/, '');  // Remove leading emojis

                // Skip metadata subsections
                if (shouldChunkContent(subsectionContent, subsectionTitle)) {
                    subsections.push({
                        title: subsectionTitle,
                        content: subsectionContent
                    });
                }

                subLastIndex = subEndIndex;
            }

            // Create chunks for each subsection
            if (subsections.length > 0) {
                debugLog(`Last section split into ${subsections.length} subsections`);
                subsections.forEach(subsection => {
                    const chunkText = `[${section.fullTitle} > ${subsection.title}]\n${subsection.content}`;
                    const hash = getStringHash(`${characterName}|${section.fullTitle}|${subsection.title}|${chunkIndex}|${chunkText}`);
                    const tags = collectTags(subsection.content);
                    const metadata = buildChunkMetadata(section.fullTitle, subsection.title, chunkText, tags, characterName, allSectionTitles);

                    chunks.push({
                        text: chunkText,
                        hash,
                        index: chunkIndex++,
                        metadata,
                    });
                });
            } else {
                // No subsections found, treat as single chunk
                const chunkText = `[${section.fullTitle}]\n${section.content}`;
                const hash = getStringHash(`${characterName}|${section.fullTitle}|${chunkIndex}|${chunkText}`);
                const metadata = buildChunkMetadata(section.fullTitle, null, chunkText, tags, characterName, allSectionTitles);

                chunks.push({
                    text: chunkText,
                    hash,
                    index: chunkIndex++,
                    metadata,
                });
            }
        } else {
            // Other sections: Keep as single chunks, or split if too large
            if (section.content.length <= targetChunkSize * 1.5) {
                // Small enough to keep as single chunk
                const chunkText = `[${section.fullTitle}]\n${section.content}`;
                const hash = getStringHash(`${characterName}|${section.fullTitle}|${chunkIndex}|${chunkText}`);
                const metadata = buildChunkMetadata(section.fullTitle, null, chunkText, tags, characterName, allSectionTitles);

                chunks.push({
                    text: chunkText,
                    hash,
                    index: chunkIndex++,
                    metadata,
                });
            } else {
                // Too large, split into smaller chunks with overlap
                const fragments = splitTextToSizedChunks(section.content, targetChunkSize, overlapSize);
                fragments.forEach((fragment, fragIdx) => {
                const chunkText = `[${section.fullTitle}${fragments.length > 1 ? ` (Part ${fragIdx + 1}/${fragments.length})` : ''}]\n${fragment}`;
                const hash = getStringHash(`${characterName}|${section.fullTitle}|${fragIdx}|${chunkIndex}|${chunkText}`);
                const tags = collectTags(fragment);
                const metadata = buildChunkMetadata(section.fullTitle, fragments.length > 1 ? `Part ${fragIdx + 1}/${fragments.length}` : null, chunkText, tags, characterName, allSectionTitles);

                chunks.push({
                    text: chunkText,
                    hash,
                    index: chunkIndex++,
                    metadata,
                });
                });
            }
        }
    });

    debugLog(`Chunked document for ${characterName}`, {
        totalChunks: chunks.length,
        averageSize: chunks.length ? Math.round(chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length) : 0,
        mainSections: sections.length,
    });

    // Apply automatic cross-section linking based on keyword frequency
    applyAutomaticLinks(chunks);

    return chunks;
}

function getChunkLibrary(collectionId) {
    const library = getContextualLibrary();
    return library?.[collectionId] || null;
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function libraryEntryToChunk(hash, data, additional = {}) {
    if (!data) {
        return null;
    }

    const sectionTitle = data.section || DEFAULT_SECTION_TITLE;
    const topic = data.topic ?? null;
    const tags = ensureArray(data.tags);
    const baseMetadata = buildChunkMetadata(sectionTitle, topic, data.text || '', tags);

    const systemKeywords = Array.from(new Set([
        ...ensureArray(data.systemKeywords),
        ...ensureArray(data.defaultSystemKeywords),
        ...ensureArray(data.keywords),
        ...baseMetadata.systemKeywords,
    ]));

    const defaultSystemKeywords = Array.from(new Set([
        ...baseMetadata.defaultSystemKeywords,
        ...ensureArray(data.defaultSystemKeywords),
    ]));

    const customKeywords = ensureArray(data.customKeywords);
    const disabledKeywords = ensureArray(data.disabledKeywords).map(normalizeKeyword);

    const keywordGroups = Array.from(new Set([
        ...ensureArray(data.keywordGroups),
        ...baseMetadata.keywordGroups,
    ]));
    const defaultKeywordGroups = Array.from(new Set([
        ...baseMetadata.defaultKeywordGroups,
        ...ensureArray(data.defaultKeywordGroups),
    ]));

    const keywordRegex = Array.from(new Set([
        ...ensureArray(data.keywordRegex).map(entry => JSON.stringify(entry)),
        ...baseMetadata.keywordRegex.map(entry => JSON.stringify(entry)),
    ])).map(entry => JSON.parse(entry));
    const defaultKeywordRegex = Array.from(new Set([
        ...baseMetadata.defaultKeywordRegex.map(entry => JSON.stringify(entry)),
        ...ensureArray(data.defaultKeywordRegex).map(entry => JSON.stringify(entry)),
    ])).map(entry => JSON.parse(entry));

    const customRegex = ensureArray(data.customRegex);

    const finalKeywords = Array.from(new Set([...systemKeywords, ...customKeywords])).filter(keyword => !disabledKeywords.includes(normalizeKeyword(keyword)));

    return Object.assign({
        hash: Number(hash),
        text: data.text,
        section: sectionTitle,
        topic,
        tags,
        keywords: finalKeywords,
        systemKeywords,
        defaultSystemKeywords,
        keywordGroups,
        defaultKeywordGroups,
        keywordRegex,
        defaultKeywordRegex,
        customKeywords,
        customRegex,
        disabledKeywords,
        index: data.index ?? additional.index ?? 0,
    }, additional);
}

function scoreCrosslink(base, candidate) {
    const baseTags = new Set(base.tags || []);
    const candidateTags = new Set(candidate.tags || []);
    const sharedTags = [...baseTags].filter(tag => candidateTags.has(tag));

    const baseKeywords = new Set(base.keywords || []);
    const candidateKeywords = new Set(candidate.keywords || []);
    const sharedKeywords = [...baseKeywords].filter(keyword => candidateKeywords.has(keyword));

    const keywordScore = baseKeywords.size ? sharedKeywords.length / baseKeywords.size : 0;
    const tagScore = sharedTags.length ? Math.min(0.5, sharedTags.length * 0.25) : 0;

    return {
        score: Number((keywordScore + tagScore).toFixed(3)),
        sharedKeywords,
        sharedTags,
    };
}

function deriveCrosslinks(library, primaryChunks, settings) {
    if (!settings.smartCrossReference) {
        return [];
    }

    const threshold = settings.crosslinkThreshold ?? 0.25;
    const selectedHashes = new Set(primaryChunks.map(chunk => chunk.hash));
    const extras = new Map();

    for (const baseChunk of primaryChunks) {
        for (const [hashKey, candidate] of Object.entries(library)) {
            const hash = Number(hashKey);
            if (selectedHashes.has(hash) || extras.has(hash)) {
                continue;
            }

            const scoreInfo = scoreCrosslink(baseChunk, candidate);
            if (scoreInfo.score >= threshold) {
                extras.set(hash, libraryEntryToChunk(hash, candidate, {
                    inferred: true,
                    reason: scoreInfo,
                }));
            }
        }
    }

    return Array.from(extras.values());
}

/**
 * Adds keyword-based fallback chunks when semantic search misses.
 * @param {string[]} queryKeywords Keywords extracted from the query text
 * @param {Record<string, any>} library Stored chunk library
 * @param {Set<number>} selectedHashes Already selected chunk hashes
 * @param {number} limit Maximum fallback chunks to include
 * @returns {ReturnType<typeof libraryEntryToChunk>[]} Fallback chunks
 */
function deriveKeywordFallback(queryKeywords, queryText, library, selectedHashes, limit, settings) {
    if ((!queryKeywords || queryKeywords.length === 0) && !queryText) {
        return [];
    }

    /** @type {Map<string, {priority: number, originals: Set<string>}>} */
    const keywordPriorityMap = new Map();
    for (const keyword of queryKeywords || []) {
        const normalized = normalizeKeyword(keyword);
        const priority = Math.max(getKeywordPriority(keyword), 20);
        if (!keywordPriorityMap.has(normalized)) {
            keywordPriorityMap.set(normalized, { priority, originals: new Set([keyword]) });
        } else {
            keywordPriorityMap.get(normalized).originals.add(keyword);
        }
    }

    const loweredQueryText = (queryText || '').toLowerCase();

    /** @type {{hash: number, score: number, chunk: ReturnType<typeof libraryEntryToChunk>}[]} */
    const candidates = [];

    for (const [hashKey, data] of Object.entries(library)) {
        const hash = Number(hashKey);
        if (selectedHashes.has(hash)) {
            continue;
        }
        const effectiveData = libraryEntryToChunk(hash, data);
        if (!effectiveData) {
            continue;
        }

        const disabledSet = new Set((data.disabledKeywords || []).map(normalizeKeyword));
        const customKeywords = Array.isArray(data.customKeywords) ? data.customKeywords : [];
        const systemKeywords = Array.isArray(data.systemKeywords) ? data.systemKeywords : Array.isArray(data.keywords) ? data.keywords : [];
        const combinedKeywords = [...systemKeywords, ...customKeywords];

        let score = 0;
        const matchedKeywords = [];
        const matchedFromQuery = [];

        combinedKeywords.forEach(keyword => {
            const normalized = normalizeKeyword(keyword);
            if (disabledSet.has(normalized)) {
                return;
            }

            const mapEntry = keywordPriorityMap.get(normalized);
            if (mapEntry) {
                const isCustom = customKeywords.some(custom => normalizeKeyword(custom) === normalized);

                // Check for custom weight override first
                let effectivePriority;
                if (data.customWeights && data.customWeights[normalized] !== undefined) {
                    effectivePriority = data.customWeights[normalized];
                } else if (isCustom) {
                    effectivePriority = Math.max(CUSTOM_KEYWORD_PRIORITY, mapEntry.priority);
                } else {
                    effectivePriority = Math.max(mapEntry.priority, getKeywordPriority(keyword));
                }

                score += effectivePriority;
                matchedKeywords.push(keyword);
                matchedFromQuery.push(...mapEntry.originals);
            }
        });

        const regexEntries = [];
        if (Array.isArray(data.keywordRegex)) {
            for (const entry of data.keywordRegex) {
                if (entry && entry.pattern) {
                    regexEntries.push({ ...entry, source: entry.source || 'preset' });
                }
            }
        }
        if (Array.isArray(data.customRegex)) {
            for (const pattern of data.customRegex) {
                if (!pattern) continue;
                if (typeof pattern === 'string') {
                    regexEntries.push({ pattern, flags: 'i', priority: CUSTOM_KEYWORD_PRIORITY, source: 'custom' });
                } else if (pattern.pattern) {
                    regexEntries.push({ ...pattern, source: 'custom', priority: pattern.priority ?? CUSTOM_KEYWORD_PRIORITY });
                }
            }
        }

        const regexMatches = [];
        for (const entry of regexEntries) {
            try {
                const regex = new RegExp(entry.pattern, entry.flags || 'i');
                if (regex.test(loweredQueryText)) {
                    const regexPriority = entry.priority ?? (entry.source === 'custom' ? CUSTOM_KEYWORD_PRIORITY : 80);
                    score += regexPriority;
                    regexMatches.push(entry.pattern);
                }
            } catch {
                // ignore malformed regex
            }
        }

        if (score <= 0) {
            continue;
        }

        const chunk = libraryEntryToChunk(hash, data, {
            inferred: true,
            reason: {
                source: 'keyword-fallback',
                sharedKeywords: matchedKeywords,
                queryKeywords: Array.from(new Set(matchedFromQuery)),
                regexMatches,
                weight: score,
            },
        });

        candidates.push({ hash, score, chunk });
    }

    candidates.sort((a, b) => b.score - a.score || a.hash - b.hash);
    const limited = candidates.slice(0, Math.max(0, limit));
    return limited.map(entry => entry.chunk);
}

/**
 * Calculate keyword weight boost for a chunk based on query keywords
 * This applies custom weights from the visualizer to boost semantic scores
 *
 * @param {Object} chunk - Chunk object with keywords metadata
 * @param {string[]} queryKeywords - Keywords extracted from query
 * @param {string} queryText - Full query text for regex matching
 * @param {Object} libraryEntry - Raw library entry with customWeights
 * @returns {{boost: number, matches: Array}} Total keyword weight boost and matched keywords
 */
function calculateKeywordBoost(chunk, queryKeywords, queryText, libraryEntry) {
    if (!chunk || !libraryEntry) {
        return { boost: 0, matches: [] };
    }

    const CUSTOM_KEYWORD_PRIORITY = 100;
    let boost = 0;
    const matches = [];

    // Build keyword priority map from query
    const keywordPriorityMap = new Map();
    for (const keyword of queryKeywords || []) {
        const normalized = normalizeKeyword(keyword);
        const priority = Math.max(getKeywordPriority(keyword), 20);
        if (!keywordPriorityMap.has(normalized)) {
            keywordPriorityMap.set(normalized, { priority, originals: new Set([keyword]) });
        } else {
            keywordPriorityMap.get(normalized).originals.add(keyword);
        }
    }

    // Get chunk's keywords
    const disabledSet = new Set((libraryEntry.disabledKeywords || []).map(normalizeKeyword));
    const customKeywords = Array.isArray(libraryEntry.customKeywords) ? libraryEntry.customKeywords : [];
    const systemKeywords = Array.isArray(libraryEntry.systemKeywords)
        ? libraryEntry.systemKeywords
        : Array.isArray(libraryEntry.keywords) ? libraryEntry.keywords : [];
    const combinedKeywords = [...systemKeywords, ...customKeywords];

    // Calculate keyword match boost
    combinedKeywords.forEach(keyword => {
        const normalized = normalizeKeyword(keyword);
        if (disabledSet.has(normalized)) {
            return;
        }

        const mapEntry = keywordPriorityMap.get(normalized);
        if (mapEntry) {
            const isCustom = customKeywords.some(custom => normalizeKeyword(custom) === normalized);

            // Check for custom weight override (from visualizer)
            let effectivePriority;
            if (libraryEntry.customWeights && libraryEntry.customWeights[normalized] !== undefined) {
                effectivePriority = libraryEntry.customWeights[normalized];
            } else if (isCustom) {
                effectivePriority = Math.max(CUSTOM_KEYWORD_PRIORITY, mapEntry.priority);
            } else {
                effectivePriority = Math.max(mapEntry.priority, getKeywordPriority(keyword));
            }

            boost += effectivePriority;
            matches.push({ keyword, weight: effectivePriority });
        }
    });

    // Apply regex boosts
    const loweredQueryText = (queryText || '').toLowerCase();
    const regexEntries = [];

    if (Array.isArray(libraryEntry.keywordRegex)) {
        for (const entry of libraryEntry.keywordRegex) {
            if (entry && entry.pattern) {
                regexEntries.push({ ...entry, source: entry.source || 'preset' });
            }
        }
    }

    if (Array.isArray(libraryEntry.customRegex)) {
        for (const pattern of libraryEntry.customRegex) {
            if (!pattern) continue;
            if (typeof pattern === 'string') {
                regexEntries.push({ pattern, flags: 'i', priority: CUSTOM_KEYWORD_PRIORITY, source: 'custom' });
            } else if (pattern.pattern) {
                regexEntries.push({ ...pattern, source: 'custom', priority: pattern.priority ?? CUSTOM_KEYWORD_PRIORITY });
            }
        }
    }

    for (const entry of regexEntries) {
        try {
            const regex = new RegExp(entry.pattern, entry.flags || 'i');
            if (regex.test(loweredQueryText)) {
                const regexPriority = entry.priority ?? (entry.source === 'custom' ? CUSTOM_KEYWORD_PRIORITY : 80);
                boost += regexPriority;
                matches.push({ regex: entry.pattern, weight: regexPriority });
            }
        } catch {
            // ignore malformed regex
        }
    }

    return { boost, matches };
}

// ============================================================================
// VECTOR OPERATIONS
// ============================================================================

/**
 * Check if a collection exists
 *
 * @param {string} collectionId - Collection ID
 * @returns {Promise<boolean>} True if collection exists
 */
async function collectionExists(collectionId) {
    try {
        const hashes = await apiGetSavedHashes(collectionId);
        return hashes && hashes.length > 0;
    } catch (error) {
        debugLog(`Collection ${collectionId} does not exist`, error);
        return false;
    }
}

/**
 * Query RAG collection for relevant chunks
 *
 * @param {string} characterName - Character name
 * @param {string} queryText - Query text (recent chat messages)
 * @returns {Promise<Array>} Array of relevant chunks with scores
 */
/**
 * Query all active RAGBooks collections and return relevant chunks
 * @param {string} queryText - The query string (usually recent conversation context)
 * @returns {Promise<Array>} Array of relevant chunks from all active sources
 */
async function queryAllRAGBooksCollections(queryText) {
    const settings = getRAGSettings();

    if (!settings.enabled || !settings.sources) {
        debugLog('RAGBooks disabled or no sources, skipping query');
        return [];
    }

    // ============================================================================
    // COLLECTION ACTIVATION SYSTEM
    // Determines WHICH collections to query based on activation triggers
    // (Similar to how lorebook entries activate based on triggers)
    // ============================================================================

    const queryLower = queryText.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    console.log('🔍 [RAGBooks] Query analysis:', {
        queryLower: queryLower.substring(0, 100),
        wordCount: queryWords.length,
        firstFewWords: queryWords.slice(0, 10)
    });

    // Get collection metadata (contains activation triggers)
    ensureRagState();
    const ragState = extension_settings[extensionName].rag;
    const collectionMetadata = ragState.collectionMetadata || {};

    const activatedCollections = new Set();

    // Get all active collections (scope-aware: includes global + character + chat)
    const scopedSources = getScopedSources();
    const activeCollectionsList = Object.entries(scopedSources)
        .filter(([_, sourceData]) => sourceData.active)
        .map(([collectionId, sourceData]) => ({ collectionId, sourceData }));

    if (activeCollectionsList.length === 0) {
        debugLog('No active RAGBooks collections in current scope');
        return [];
    }

    // Check each collection to see if it should be activated based on triggers
    for (const { collectionId, sourceData } of activeCollectionsList) {
        const metadata = collectionMetadata[collectionId];

        // Legacy collections without metadata won't activate (user needs to set triggers)
        if (!metadata) {
            console.log(`⚠️ [RAGBooks] Collection ${collectionId} has no metadata - skipping`);
            continue;
        }

        // Check if collection is always active (ignores triggers)
        if (metadata.alwaysActive) {
            console.log(`✅ [RAGBooks] Collection ${collectionId} is ALWAYS ACTIVE - activating`);
            activatedCollections.add(collectionId);
            continue;
        }

        // Check if conditionals are enabled (advanced activation)
        if (metadata.conditions?.enabled) {
            console.log(`🔧 [RAGBooks] Collection ${collectionId} uses CONDITIONAL ACTIVATION`);
            // Note: Actual condition evaluation would happen here
            // For now, we'll treat conditional collections as always active
            // Full condition evaluation requires context (speaker, emotion, etc.)
            console.log(`⚠️ [RAGBooks] Conditional activation not yet fully implemented - treating as always active`);
            activatedCollections.add(collectionId);
            continue;
        }

        // Check if any activation triggers match (case-insensitive)
        const triggers = metadata.keywords || [];

        console.log(`🔍 [RAGBooks] Checking collection ${sourceData.name}:`, {
            triggers: triggers,
            triggerCount: triggers.length
        });

        // No triggers = collection won't activate
        if (triggers.length === 0) {
            console.log(`⚠️ [RAGBooks] Collection ${collectionId} has no triggers - skipping`);
            continue;
        }

        // Check if any trigger appears in query
        let matched = false;
        for (const trigger of triggers) {
            const triggerLower = trigger.toLowerCase().trim();
            if (queryLower.includes(triggerLower)) {
                console.log(`✅ [RAGBooks] Collection "${sourceData.name}" activated! Trigger "${trigger}" found in query`);
                activatedCollections.add(collectionId);
                matched = true;
                break;
            }
        }

        if (!matched) {
            console.log(`❌ [RAGBooks] Collection "${sourceData.name}" NOT activated - no triggers matched`);
        }
    }

    debugLog(`Collection activation based on triggers:`, {
        queryText: queryText,
        totalCollections: activeCollectionsList.length,
        activatedCollections: activatedCollections.size,
        activatedList: Array.from(activatedCollections)
    });

    if (activatedCollections.size === 0) {
        console.log('📚 [RAGBooks] No collections activated by triggers');
        return [];
    }

    console.log(`📚 [RAGBooks] Querying ${activatedCollections.size} activated collections`);

    // Query only activated collections - get PRIMARY chunks
    const allResults = [];

    for (const { collectionId, sourceData } of activeCollectionsList) {
        // Skip if not activated
        if (!activatedCollections.has(collectionId)) {
            continue;
        }

        try {
            console.log(`📖 [RAGBooks] Querying collection: ${sourceData.name} (${sourceData.type})`);

            const results = await apiQueryVector(collectionId, queryText, settings.topK);

            if (results && results.length > 0) {
                // Filter by threshold and add collection metadata
                const filteredResults = results
                    .filter(r => r.score <= settings.threshold)
                    .map(r => ({
                        ...r,
                        collectionId: collectionId,
                        collectionName: sourceData.name,
                        collectionType: sourceData.type
                    }));

                console.log(`   ✅ Found ${filteredResults.length} relevant chunks (threshold: ${settings.threshold})`);
                allResults.push(...filteredResults);
            }
        } catch (error) {
            console.error(`   ❌ Error querying collection ${collectionId}:`, error);
        }
    }

    // Extract query keywords for boosting
    const queryKeywords = extractKeywords(queryText, '', '');

    // Get merged library for all collections
    const mergedLibrary = {};
    for (const { collectionId } of activeCollectionsList) {
        if (activatedCollections.has(collectionId)) {
            const library = getContextualLibrary(collectionId);
            Object.assign(mergedLibrary, library);
        }
    }

    // ============================================================================
    // APPLY KEYWORD WEIGHT BOOSTS
    // This is CRITICAL - without this, custom weights are ignored!
    // ============================================================================
    console.log('🎯 [RAGBooks] Applying keyword weight boosts...');
    for (const result of allResults) {
        const libraryEntry = mergedLibrary[result.hash];
        if (!libraryEntry) continue;

        const { boost: keywordBoost, matches } = calculateKeywordBoost(result, queryKeywords, queryText, libraryEntry);
        const semanticScore = result.score ?? 0;
        const boostedScore = semanticScore + (keywordBoost / 100); // Normalize boost

        result.semanticScore = semanticScore;
        result.keywordBoost = keywordBoost;
        result.keywordMatches = matches;
        result.score = boostedScore;

        if (matches.length > 0) {
            console.log(`  📊 Chunk ${result.hash}: semantic=${semanticScore.toFixed(3)}, keywordBoost=${keywordBoost}, final=${boostedScore.toFixed(3)}`);
        }
    }

    // Sort by boosted score BEFORE taking top-K
    allResults.sort((a, b) => a.score - b.score);

    // ============================================================================
    // RESOLVE LINKED CHUNKS
    // Chunks can specify other chunks to always inject together
    // ============================================================================
    const primaryResults = allResults.slice(0, settings.topK);
    const linkedChunks = [];
    const seen = new Set(primaryResults.map(r => r.hash));

    console.log('🔗 [RAGBooks] Resolving linked chunks...');
    for (const result of primaryResults) {
        const libraryEntry = mergedLibrary[result.hash];
        if (!libraryEntry || !libraryEntry.chunkLinks) continue;

        for (const targetHash of libraryEntry.chunkLinks) {
            if (seen.has(targetHash)) continue;

            const linkedEntry = mergedLibrary[targetHash];
            if (!linkedEntry || linkedEntry.disabled) continue;

            // Add linked chunk
            linkedChunks.push({
                hash: targetHash,
                text: linkedEntry.text,
                score: result.score, // Inherit score from parent
                collectionId: result.collectionId,
                collectionName: result.collectionName,
                collectionType: result.collectionType,
                isLinked: true,
                linkedFrom: result.hash
            });
            seen.add(targetHash);
            console.log(`  🔗 Linked chunk ${targetHash} (from ${result.hash})`);
        }
    }

    // Combine primary and linked chunks
    const combined = [...primaryResults, ...linkedChunks];

    // ============================================================================
    // APPLY INCLUSION GROUP FILTERING
    // Only one chunk per inclusion group can activate
    // ============================================================================
    const inclusionGroups = {};
    const filteredByInclusion = [];

    console.log('🎯 [RAGBooks] Applying inclusion group filtering...');
    for (const chunk of combined) {
        const libraryEntry = mergedLibrary[chunk.hash];
        const group = libraryEntry?.inclusionGroup;

        if (!group || group.trim() === '') {
            // No inclusion group - always include
            filteredByInclusion.push(chunk);
            continue;
        }

        if (!inclusionGroups[group]) {
            // First chunk with this group - include it
            inclusionGroups[group] = chunk;
            filteredByInclusion.push(chunk);
            console.log(`  📌 Inclusion group "${group}": selected chunk ${chunk.hash}`);
        } else {
            // Another chunk with same group exists
            const existing = inclusionGroups[group];
            const existingEntry = mergedLibrary[existing.hash];
            const currentPrioritize = libraryEntry.inclusionPrioritize || false;
            const existingPrioritize = existingEntry?.inclusionPrioritize || false;

            // If this chunk is prioritized and existing isn't, replace it
            if (currentPrioritize && !existingPrioritize) {
                const existingIndex = filteredByInclusion.indexOf(existing);
                if (existingIndex !== -1) {
                    filteredByInclusion[existingIndex] = chunk;
                }
                inclusionGroups[group] = chunk;
                console.log(`  🔄 Inclusion group "${group}": replaced with prioritized chunk ${chunk.hash}`);
            } else {
                console.log(`  ⏭️  Inclusion group "${group}": skipped chunk ${chunk.hash} (group already filled)`);
            }
        }
    }

    console.log(`📚 [RAGBooks] Final results: ${filteredByInclusion.length} chunks (${primaryResults.length} primary + ${linkedChunks.length} linked, after inclusion filtering)`);

    return filteredByInclusion;
}

/**
 * Enhanced collection search using the search orchestrator
 * Wraps apiQueryCollection to work with the orchestrator's expected signature
 * @param {string} collectionId - Collection to search
 * @param {string} queryText - Search query
 * @param {Object} allChunks - All chunks in collection (hash-indexed)
 * @param {Object} settings - RAG settings
 * @returns {Promise<Array>} Enhanced search results
 */
async function performCollectionSearch(collectionId, queryText, allChunks, settings) {
    // Create a search function that matches the orchestrator's expected signature
    const searchFunction = async (query, chunks, topK, threshold) => {
        // The orchestrator passes us filtered chunks - we need to query the actual vector DB
        // For now, we'll query the full collection and then filter to the provided chunks
        const response = await apiQueryCollection(collectionId, query, topK, threshold);

        const metadata = Array.isArray(response?.metadata) ? response.metadata : [];
        const hashes = Array.isArray(response?.hashes) ? response.hashes : [];
        const scores = Array.isArray(response?.scores) ? response.scores : (Array.isArray(response?.similarities) ? response.similarities : []);

        const results = [];
        for (let i = 0; i < Math.max(metadata.length, hashes.length, scores.length); i++) {
            const meta = metadata[i] || {};
            const hash = Number(hashes[i] ?? meta.hash);
            if (Number.isNaN(hash)) continue;

            const score = meta.score ?? scores[i] ?? null;
            if (score === null) continue;

            // Find this chunk in the provided chunks array
            const chunk = chunks.find(c => c.hash === hash);
            if (!chunk) continue;

            results.push({
                ...chunk,
                score: score,
                reason: {
                    score: score,
                    rank: i,
                    source: collectionId
                }
            });
        }

        return results;
    };

    // Check if enhanced features are enabled
    const enableEnhanced = settings.enableImportance !== false ||
                          settings.enableConditions !== false ||
                          settings.enableGroups !== false ||
                          (settings.temporalDecay && settings.temporalDecay.enabled);

    if (!enableEnhanced) {
        // Use basic search if no features enabled
        console.log(`🔍 [RAGBooks] Using basic search for ${collectionId}`);
        const chunksArray = Object.values(allChunks);
        return await searchFunction(queryText, chunksArray, settings.topK, settings.scoreThreshold);
    }

    // Use enhanced search with orchestrator
    console.log(`🔍 [RAGBooks] Using enhanced search for ${collectionId}`);

    const context = getContext();
    const searchParams = buildSearchParams({
        queryText,
        allChunks,
        searchFunction,
        settings: {
            ...settings,
            summarySearchMode: settings.summarySearchMode || 'both',
            enableImportance: settings.enableImportance !== false,
            enableConditions: settings.enableConditions !== false,
            enableGroups: settings.enableGroups !== false,
            enableDecay: settings.temporalDecay?.enabled === true,
            temporalDecay: settings.temporalDecay || { enabled: false },
            topK: settings.topK || 5,
            threshold: settings.scoreThreshold || 0.15,
            usePriorityTiers: settings.usePriorityTiers === true,
            groupBoostMultiplier: settings.groupBoostMultiplier || 1.3,
            maxForcedGroupMembers: settings.maxForcedGroupMembers || 5,
            contextWindow: settings.contextWindow || 10
        },
        chat: context.chat || [],
        scenes: chat_metadata?.ragbooks_scenes || [],
        metadata: chat_metadata || {}  // Pass full chat metadata for advanced conditions
    });

    return await performEnhancedSearch(searchParams);
}

async function queryRAG(characterName, queryText) {
    const settings = getRAGSettings();

    if (!settings.enabled) {
        debugLog('RAG disabled, skipping query');
        return [];
    }

    const collectionId = generateCollectionId(characterName);

    // Check if this collection is disabled
    if (settings.disabledCollections?.includes(collectionId)) {
        debugLog(`Collection ${collectionId} is disabled, skipping query`);
        return [];
    }

    const allLibraries = getAllContextualLibraries();

    debugLog(`Querying RAG for ${characterName} across all contextual libraries`, {
        collectionId,
        queryLength: queryText.length,
        topK: settings.topK,
        availableLibraries: Object.keys(allLibraries),
        libraryContents: Object.entries(allLibraries).map(([name, lib]) => ({
            name,
            hasLibrary: !!lib,
            hasCollection: lib ? !!lib[collectionId] : false,
            collectionKeys: lib ? Object.keys(lib).slice(0, 5) : []
        }))
    });

    const queryKeywords = extractKeywords(queryText);

    console.log('🔑 [CarrotKernel RAG] Extracted keywords from query:', queryKeywords);

    // ============================================================================
    // COLLECTION ACTIVATION SYSTEM
    // Determines WHICH collections to query based on activation triggers
    // (Similar to how lorebook entries activate based on triggers)
    // ============================================================================

    // Detect which collections should be activated based on triggers
    const queryLower = queryText.toLowerCase();
    const queryWords = queryLower.split(/\s+/); // Split into words for whole-word matching

    console.log('🔍 [CarrotKernel RAG] Query analysis:', {
        queryLower: queryLower.substring(0, 100),
        wordCount: queryWords.length,
        firstFewWords: queryWords.slice(0, 10)
    });

    // Get collection metadata (contains activation triggers)
    ensureRagState();
    const ragState = extension_settings[extensionName].rag;
    const collectionMetadata = ragState.collectionMetadata || {};

    const activatedCollections = new Set();
    const allCollectionNames = [];

    for (const [, library] of Object.entries(allLibraries)) {
        if (library && typeof library === 'object') {
            allCollectionNames.push(...Object.keys(library));
        }
    }

    // Check each collection to see if it should be activated
    for (const collectionId of allCollectionNames) {
        const metadata = collectionMetadata[collectionId];

        // Legacy collections without metadata won't activate (user needs to set triggers)
        if (!metadata) {
            console.log(`⚠️ [CarrotKernel RAG] Collection ${collectionId} has no metadata - skipping`);
            continue;
        }

        // Check if collection is always active (ignores triggers)
        if (metadata.alwaysActive) {
            console.log(`✅ [CarrotKernel RAG] Collection ${collectionId} is ALWAYS ACTIVE - activating`);
            activatedCollections.add(collectionId);
            continue;
        }

        // Check if conditionals are enabled (advanced activation)
        if (metadata.conditions?.enabled) {
            console.log(`🔧 [CarrotKernel RAG] Collection ${collectionId} uses CONDITIONAL ACTIVATION`);
            // Note: Actual condition evaluation would happen here
            // For now, we'll treat conditional collections as always active
            // Full condition evaluation requires context (speaker, emotion, etc.)
            console.log(`⚠️ [CarrotKernel RAG] Conditional activation not yet fully implemented - treating as always active`);
            activatedCollections.add(collectionId);
            continue;
        }

        // Check if any activation triggers match (case-insensitive)
        const triggers = metadata.keywords || []; // NOTE: Still called 'keywords' in data for backwards compatibility

        console.log(`🔍 [CarrotKernel RAG] Checking collection ${collectionId}:`, {
            triggers: triggers,
            triggerCount: triggers.length
        });

        // No triggers = collection won't activate (user must explicitly set triggers or enable "Always Active")
        if (triggers.length === 0) {
            console.log(`⚠️ [CarrotKernel RAG] Collection ${collectionId} has no triggers - skipping`);
            continue;
        }

        // Check if any trigger appears in query
        let matched = false;
        for (const trigger of triggers) {
            const triggerLower = trigger.toLowerCase().trim();
            // Support both substring and whole-word matching
            if (queryLower.includes(triggerLower)) {
                console.log(`✅ [CarrotKernel RAG] Collection ${collectionId} activated! Trigger "${trigger}" found in query`);
                activatedCollections.add(collectionId);
                matched = true;
                break;
            }
        }

        if (!matched) {
            console.log(`❌ [CarrotKernel RAG] Collection ${collectionId} NOT activated - no triggers matched`);
        }
    }

    debugLog(`Collection activation based on triggers:`, {
        queryText: queryText,
        totalCollections: allCollectionNames.length,
        activatedCollections: activatedCollections.size,
        activatedList: Array.from(activatedCollections)
    });

    // Build parallel queries for each library that has this collection
    const libraryQueries = [];
    const libraryNames = [];

    for (const [libName, library] of Object.entries(allLibraries)) {
        if (!library || typeof library !== 'object') {
            debugLog(`Skipping ${libName}: not a valid library object`);
            continue;
        }

        // Filter to only activated collections (based on keywords/alwaysActive)
        let collectionsInLibrary = Object.keys(library).filter(collectionId => {
            return activatedCollections.has(collectionId);
        });
        debugLog(`Checking ${libName} library:`, {
            hasLibrary: true,
            collectionsCount: collectionsInLibrary.length,
            collections: collectionsInLibrary.slice(0, 10) // Show first 10
        });

        if (collectionsInLibrary.length === 0) {
            debugLog(`Skipping ${libName}: no collections in library`);
            continue;
        }

        // Query each collection in this library
        for (const currentCollectionId of collectionsInLibrary) {
            libraryNames.push(`${libName}:${currentCollectionId}`);
            libraryQueries.push(
                (async () => {
                    try {
                        const exists = await collectionExists(currentCollectionId);
                        if (!exists) {
                            debugLog(`Collection ${currentCollectionId} not found in vector DB`);
                            return { libName: `${libName}:${currentCollectionId}`, chunks: [] };
                        }

                        // Use enhanced search with orchestrator if features are enabled
                        const chunks = await performCollectionSearch(
                            currentCollectionId,
                            queryText,
                            library[currentCollectionId],
                            settings
                        );

                        // Convert chunks to proper format with libraryEntryToChunk if needed
                        const formattedChunks = chunks.map(chunk => {
                            // If chunk is already formatted with reason, return as-is
                            if (chunk.reason && chunk.text) {
                                return chunk;
                            }
                            // Otherwise convert library entry to chunk
                            return libraryEntryToChunk(chunk.hash, library[currentCollectionId][chunk.hash], {
                                reason: chunk.reason || {
                                    score: chunk.score || 0,
                                    rank: 0,
                                    source: `${libName}:${currentCollectionId}`,
                                },
                            });
                        }).filter(c => c !== null);

                        debugLog(`Queried ${currentCollectionId} in ${libName}: found ${formattedChunks.length} chunks`);
                        return { libName: `${libName}:${currentCollectionId}`, chunks: formattedChunks, library: library[currentCollectionId] };
                    } catch (error) {
                        console.error(`Failed to query ${currentCollectionId} in ${libName} library:`, error);
                        return { libName: `${libName}:${currentCollectionId}`, chunks: [] };
                    }
                })()
            );
        }
    }

    if (libraryQueries.length === 0) {
        debugLog(`No libraries contain collection ${collectionId}; vectorize the document first.`);
        return [];
    }

    try {
        // Run all library queries in parallel for performance
        const results = await Promise.all(libraryQueries);

        // Merge all primary chunks, deduplicating by hash (prefer higher scores)
        const primaryChunksMap = new Map();
        let totalPrimary = 0;

        for (const { libName, chunks } of results) {
            for (const chunk of chunks) {
                totalPrimary++;
                const existing = primaryChunksMap.get(chunk.hash);
                if (!existing || (chunk.reason?.score ?? 0) > (existing.reason?.score ?? 0)) {
                    primaryChunksMap.set(chunk.hash, chunk);
                }
            }
        }

        const primaryChunks = Array.from(primaryChunksMap.values());

        // Merge all libraries for crosslinking and fallback
        const mergedLibrary = {};
        for (const { library } of results) {
            if (library) {
                Object.assign(mergedLibrary, library);
            }
        }

        // Apply crosslinking across merged library
        const crosslinked = deriveCrosslinks(mergedLibrary, primaryChunks, settings);
        const selectedHashes = new Set(primaryChunks.map(chunk => chunk.hash));
        crosslinked.forEach(chunk => selectedHashes.add(chunk.hash));

        const combined = [];
        const seen = new Set();
        const pushUnique = (chunk) => {
            if (!chunk || !chunk.text) return;
            if (seen.has(chunk.hash)) return;
            seen.add(chunk.hash);
            combined.push(chunk);
        };

        // Filter out disabled chunks before adding to results
        primaryChunks.filter(chunk => !chunk.disabled).forEach(pushUnique);
        crosslinked.filter(chunk => !chunk.disabled).forEach(pushUnique);

        // Apply keyword fallback across merged library
        let fallbackCount = 0;
        let fallbackChunks = [];
        if ((settings.keywordFallback ?? true) && (settings.keywordFallbackLimit ?? 0) > 0) {
            fallbackChunks = deriveKeywordFallback(
                queryKeywords,
                queryText,
                mergedLibrary,
                selectedHashes,
                settings.keywordFallbackLimit ?? 2,
                settings,
            );
            const before = combined.length;
            fallbackChunks.forEach(chunk => {
                pushUnique(chunk);
                if (chunk?.hash !== undefined) {
                    selectedHashes.add(Number(chunk.hash));
                }
            });
            fallbackCount = combined.length - before;
        }

        // Prioritize keyword fallback if enabled
        if ((settings.keywordFallbackPriority ?? false) && fallbackChunks.length) {
            const fallbackHashes = new Set(fallbackChunks.filter(Boolean).map(chunk => Number(chunk.hash)));
            combined.sort((a, b) => {
                const aIsFallback = fallbackHashes.has(Number(a.hash));
                const bIsFallback = fallbackHashes.has(Number(b.hash));
                if (aIsFallback === bIsFallback) return 0;
                return aIsFallback ? -1 : 1;
            });
        }

        // Process chunk links (force and soft modes)
        const linkedChunks = [];
        const softLinkedHashes = new Set();

        for (const chunk of combined) {
            const chunkLinks = Array.isArray(chunk.chunkLinks) ? chunk.chunkLinks : [];

            for (const link of chunkLinks) {
                const targetChunk = mergedLibrary[link.targetHash];
                if (!targetChunk || targetChunk.disabled) continue;

                if (link.mode === 'force') {
                    // Force mode: add chunk immediately if not already present
                    if (!seen.has(link.targetHash)) {
                        const linkedChunk = libraryEntryToChunk(link.targetHash, targetChunk, {
                            inferred: true,
                            reason: { type: 'force-link', source: chunk.hash },
                        });
                        linkedChunks.push(linkedChunk);
                        seen.add(link.targetHash);
                    }
                } else if (link.mode === 'soft') {
                    // Soft mode: mark for priority boosting
                    softLinkedHashes.add(link.targetHash);
                }
            }
        }

        // Add force-linked chunks
        linkedChunks.forEach(chunk => combined.push(chunk));

        // Soft-link boost: if soft-linked chunks exist in the result set, move them up
        if (softLinkedHashes.size > 0) {
            combined.sort((a, b) => {
                const aIsSoft = softLinkedHashes.has(a.hash);
                const bIsSoft = softLinkedHashes.has(b.hash);
                if (aIsSoft === bIsSoft) return 0;
                return aIsSoft ? -1 : 1; // Soft-linked chunks come first
            });
        }

        // Apply inclusion group filtering (only one chunk per group)
        const inclusionGroups = {};
        const filteredByInclusion = [];

        for (const chunk of combined) {
            const group = chunk.inclusionGroup;

            if (!group || group.trim() === '') {
                // No inclusion group - always include
                filteredByInclusion.push(chunk);
                continue;
            }

            if (!inclusionGroups[group]) {
                // First chunk in this group
                inclusionGroups[group] = chunk;
                filteredByInclusion.push(chunk);
            } else {
                // Another chunk with same group exists
                const existing = inclusionGroups[group];

                // If this chunk is prioritized and existing isn't, replace it
                if (chunk.inclusionPrioritize && !existing.inclusionPrioritize) {
                    const existingIndex = filteredByInclusion.indexOf(existing);
                    if (existingIndex !== -1) {
                        filteredByInclusion[existingIndex] = chunk;
                    }
                    inclusionGroups[group] = chunk;
                }
                // Otherwise skip this chunk (existing one stays)
            }
        }

        // ⚠️ CRITICAL: Enforce topK limit on final combined results
        // This is separate from the per-collection topK sent to the vector DB
        // We need to limit the TOTAL number of chunks returned across all collections
        let finalResults = filteredByInclusion;

        // Apply keyword weight boosts to all chunks before ranking
        // This combines semantic similarity scores with custom keyword weights
        console.log('🎯 [CarrotKernel RAG] Applying keyword weight boosts...');
        for (const chunk of finalResults) {
            const libraryEntry = mergedLibrary[chunk.hash];
            if (!libraryEntry) continue;

            const { boost: keywordBoost, matches } = calculateKeywordBoost(chunk, queryKeywords, queryText, libraryEntry);
            const semanticScore = chunk.reason?.score ?? 0;
            const boostedScore = semanticScore + (keywordBoost / 100); // Normalize boost to 0-2 range

            // Store both scores for debugging
            chunk.reason = {
                ...chunk.reason,
                semanticScore: semanticScore,
                keywordBoost: keywordBoost,
                keywordMatches: matches,
                score: boostedScore, // Final score used for ranking
            };

            if (matches.length > 0) {
                console.log(`  📊 Chunk ${chunk.hash} (${chunk.header || 'unknown'}): semantic=${semanticScore.toFixed(3)}, keywordBoost=${keywordBoost}, final=${boostedScore.toFixed(3)}`);
                console.log(`     Matched keywords:`, matches);
            } else {
                console.log(`  📊 Chunk ${chunk.hash} (${chunk.header || 'unknown'}): semantic=${semanticScore.toFixed(3)}, no keyword matches, final=${boostedScore.toFixed(3)}`);
            }
        }

        // Sort by boosted score (highest first) before limiting
        finalResults.sort((a, b) => {
            const scoreA = a.reason?.score ?? 0;
            const scoreB = b.reason?.score ?? 0;
            return scoreB - scoreA;
        });

        // Apply global topK limit if we have too many results
        if (finalResults.length > settings.topK) {
            console.log(`🔍 RAG LIMITING: Trimming ${finalResults.length} results down to topK=${settings.topK}`);
            finalResults = finalResults.slice(0, settings.topK);
        }

        debugLog(`Multi-library query results for ${characterName}`, {
            libraries: libraryNames.join(', '),
            totalPrimary,
            deduplicated: primaryChunks.length,
            crosslinked: crosslinked.length,
            linkedChunks: linkedChunks.length,
            beforeInclusion: combined.length,
            afterInclusion: filteredByInclusion.length,
            afterTopKLimit: finalResults.length,
            delivered: finalResults.length,
            fallback: fallbackCount,
        });

        return finalResults;
    } catch (error) {
        console.error(`Failed to query RAG for ${characterName}:`, error);
        return [];
    }
}

// ============================================================================
// QUERY CONTEXT BUILDING
// ============================================================================

/**
 * Build query context from recent chat messages
 *
 * @param {number} messageCount - Number of recent messages to include
 * @returns {string} Query text for RAG
 */
function buildQueryContext(messageCount = 3) {
    if (!chat || chat.length === 0) {
        return '';
    }

    // Filter to only non-system messages (matching ST's native lorebook behavior)
    // This excludes: system messages, narrator messages, and any other is_system=true messages
    const activeMessages = chat.filter(x => !x.is_system);

    // Get last N active messages
    const recentMessages = activeMessages.slice(-messageCount);

    // Combine message text
    const queryText = recentMessages
        .map(msg => msg.mes || '')
        .filter(text => text.length > 0)
        .join('\n\n');

    // Enhanced debug logging
    console.log('🔍 [CarrotKernel RAG] Building query context:', {
        totalMessages: chat.length,
        activeMessages: activeMessages.length,
        selectedMessages: recentMessages.length,
        requestedCount: messageCount,
        queryLength: queryText.length
    });

    // Log each selected message for debugging
    recentMessages.forEach((msg, idx) => {
        console.log(`📝 [CarrotKernel RAG] Message ${idx + 1}/${recentMessages.length}:`, {
            name: msg.name,
            is_user: msg.is_user,
            is_system: msg.is_system,
            preview: (msg.mes || '').substring(0, 100) + '...'
        });
    });

    console.log('📋 [CarrotKernel RAG] Final queryText:', queryText);

    return queryText;
}

// ============================================================================
// RAG INJECTION
// ============================================================================

/**
 * Inject RAG results into AI context
 *
 * @param {string} characterName - Character name
 * @param {Array} results - RAG query results
 */
async function injectRAGResults(characterName, results) {
    const settings = getRAGSettings();
    const roleKey = settings.injectionRole?.toUpperCase?.() || 'SYSTEM';
    const promptRole = extension_prompt_roles?.[roleKey] ?? extension_prompt_roles.SYSTEM;

    if (!settings.enabled || !results.length) {
        debugLog('Skipping RAG injection', {
            enabled: settings.enabled,
            resultsCount: results.length,
        });
        setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);
        return;
    }

    const uniqueChunks = [];
    const seen = new Set();
    for (const chunk of results) {
        if (!chunk || !chunk.text) {
            continue;
        }
        if (seen.has(chunk.hash)) {
            continue;
        }
        seen.add(chunk.hash);
        uniqueChunks.push(chunk);
    }

    if (!uniqueChunks.length) {
        debugLog('No unique RAG chunks to inject');
        setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);
        return;
    }

    const formatted = uniqueChunks
        .map((chunk) => {
            const headerParts = [chunk.section || DEFAULT_SECTION_TITLE];
            if (chunk.topic) {
                headerParts.push(chunk.topic);
            }
            if (chunk.inferred) {
                headerParts.push('linked');
            }

            const lines = ['### ' + headerParts.join(' � ')];

            if (chunk.tags?.length) {
                lines.push('Tags: ' + chunk.tags.join(', '));
            }

            if (settings.debugMode && chunk.reason) {
                const reasonParts = [];
                if (typeof chunk.reason.rank === 'number') {
                    reasonParts.push('rank ' + (chunk.reason.rank + 1));
                }
                if (chunk.reason.score) {
                    reasonParts.push('score ' + chunk.reason.score);
                }
                if (chunk.reason.sharedKeywords?.length) {
                    reasonParts.push('keywords ' + chunk.reason.sharedKeywords.slice(0, 4).join(', '));
                }
                if (chunk.reason.sharedTags?.length) {
                    reasonParts.push('tags ' + chunk.reason.sharedTags.join(', '));
                }
                if (reasonParts.length) {
                    reasonParts.push('hash ' + chunk.hash);
                    lines.push('Reason: ' + reasonParts.join(' | '));
                }
            }

            lines.push(chunk.text.trim());
            return lines.join('\\n');
        })
        .join('\\n\\n');

    setExtensionPrompt(
        RAG_PROMPT_TAG,
        formatted,
        extension_prompt_types.IN_PROMPT,
        settings.injectionDepth,
        false,
        promptRole,
    );

    debugLog(`Injected RAG results for ${characterName}`, {
        injectedChunks: uniqueChunks.length,
    });

    if (settings.debugMode) {
        console.log('[CarrotKernel RAG] Injection', { characterName, injectedChunks: uniqueChunks.length });
        console.log(formatted);
    }
}

function detectDocumentInMessage(messageText) {
    console.log('🔍 [detectDocumentInMessage] Starting detection...');
    console.log(`   Message length: ${messageText?.length || 0} chars`);
    console.log(`   Min size required: ${DOCUMENT_MIN_SIZE}`);

    // Very permissive - if there's ANY structured content, try to parse it
    if (!messageText || messageText.length < 1000) {
        console.log('❌ [detectDocumentInMessage] Message too short or empty');
        return null;
    }

    // Check for section headers with pattern - VERY PERMISSIVE & LANGUAGE-AGNOSTIC
    console.log('🔍 [detectDocumentInMessage] Looking for numbered section headers...');
    console.log(`   Pattern: [##] [ANY-WORD] number/number (works for all languages)`);
    console.log(`   Examples: "## SECTION 1/8", "##セクション 1/8", "# 部分 1/8", "SECCIÓN 1/8"`);
    console.log(`   Message sample:`, messageText.substring(0, 500));

    // Match any header with format - allows with/without ##, with/without colon, spaces around /
    // \S+ matches ANY non-whitespace characters (Chinese/Japanese/Korean/Arabic/Cyrillic/etc.)
    const sectionMatches = messageText.match(/^#{0,2}\s*\S+\s+\d+\s*\/\s*\d+/gim);
    console.log(`   Found ${sectionMatches?.length || 0} numbered section headers`);
    if (sectionMatches) {
        console.log(`   Matches:`, sectionMatches);
    }

    // Check for BunnymoTags - UNIVERSAL & LANGUAGE-AGNOSTIC
    console.log('🔍 [detectDocumentInMessage] Looking for BunnymoTags...');
    console.log(`   Checking for tag structure <TAG:content> (works for ALL languages)`);
    console.log(`   Examples: <NAME:John>, <名前:太郎>, <NOMBRE:Juan>, <ИМЯ:Иван>`);

    // [^\s>]+ matches ANY non-whitespace non-> characters (works for all Unicode)
    const tagMatches = messageText.match(/<[^\s>]+:[^>]+>/g);
    const tagCount = tagMatches ? tagMatches.length : 0;
    console.log(`   Found ${tagCount} tags with format <TAG:content>`);

    // VERY PERMISSIVE: Need either 2+ sections OR 3+ tags
    const hasSections = sectionMatches && sectionMatches.length >= 2;
    const hasTags = tagCount >= 3;

    console.log(`   Has sufficient sections: ${hasSections} (${sectionMatches?.length || 0} found, need 2+)`);
    console.log(`   Has sufficient tags: ${hasTags} (${tagCount} found, need 3+)`);

    if (!hasSections && !hasTags) {
        console.log('❌ [detectDocumentInMessage] Not enough structure (need 2+ sections OR 3+ tags)');
        return null;
    }

    console.log('✅ [detectDocumentInMessage] Document structure detected!');

    // Try to extract character name from the FIRST tag - LANGUAGE-AGNOSTIC
    console.log('🔍 [detectDocumentInMessage] Extracting character name as suggestion...');

    // Universal name extraction: Find the first tag in the document (usually the name tag)
    // Works for ANY language: <NAME:John>, <名前:太郎>, <NOMBRE:Juan>, <ИМЯ:Иван>, etc.
    // [^\s>]+ matches any non-whitespace characters (all Unicode scripts)
    const firstTagMatch = messageText.match(/<[^\s>]+:\s*([^>]+)>/);
    console.log(`   First tag match:`, firstTagMatch);

    const characterName = firstTagMatch ? firstTagMatch[1].trim().replace(/_/g, ' ') : 'Unknown';
    console.log(`   Extracted name suggestion: "${characterName}" (user can override this)`);

    const result = {
        characterName,
        content: messageText,
        sectionCount: sectionMatches?.length || 0
    };

    console.log('✅ [detectDocumentInMessage] Document detected!', result);
    debugLog('Document detected in message', result);

    return result;
}

/**
 * Add RAG button to a message containing a document
 *
 * @param {number} messageId - Message ID
 */
function addRAGButtonToMessage(messageId) {
    const settings = getRAGSettings();
    if (!settings.enabled) {
        return;
    }

    // Find the message element
    const messageElement = $(`.mes[mesid="${messageId}"]`);
    if (messageElement.length === 0) {
        debugLog(`Message ${messageId} not found in DOM`);
        return;
    }

    // Check if button already exists
    if (messageElement.find(`.${RAG_BUTTON_CLASS}`).length > 0) {
        return;
    }

    // Get message data
    const message = chat.find(msg => msg.index === messageId);
    if (!message || !message.mes) {
        return;
    }

    // Detect document
    const documentInfo = detectDocumentInMessage(message.mes);
    if (!documentInfo) {
        return;
    }

    debugLog(`Adding RAG button to message ${messageId}`, documentInfo);

    // Create the button
    const button = $('<div>')
        .addClass(RAG_BUTTON_CLASS)
        .attr('data-message-id', messageId)
        .css({
            'position': 'absolute',
            'top': '5px',
            'right': '40px', // Position to the left of Baby Bunny button if it exists
            'padding': '6px 12px',
            'background': 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
            'color': 'white',
            'border-radius': '6px',
            'cursor': 'pointer',
            'font-size': '0.85em',
            'font-weight': '600',
            'display': 'flex',
            'align-items': 'center',
            'gap': '6px',
            'z-index': '10',
            'transition': 'all 0.2s'
        })
        .html('<i class="fa-solid fa-cube"></i> Vectorize Document')
        .on('click', async function(e) {
            e.stopPropagation();
            await handleRAGButtonClick(messageId, documentInfo);
        })
        .on('mouseenter touchstart', function() {
            $(this).css({
                'background': 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                'transform': 'translateY(-2px)',
                'box-shadow': '0 4px 12px rgba(139, 92, 246, 0.4)'
            });
        })
        .on('mouseleave touchend', function() {
            $(this).css({
                'background': 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                'transform': 'translateY(0)',
                'box-shadow': 'none'
            });
        });

    // Add button to message
    messageElement.css('position', 'relative').append(button);
}

/**
 * Handle RAG button click - vectorize the document
 *
 * @param {number} messageId - Message ID
 * @param {Object} documentInfo - Document information
 */
async function handleRAGButtonClick(messageId, documentInfo) {
    const button = $(`.${RAG_BUTTON_CLASS}[data-message-id="${messageId}"]`);

    try {
        // Prompt user for character name
        const characterName = prompt(
            'Enter character name for this document:',
            documentInfo.characterName || ''
        );

        if (!characterName || characterName.trim() === '') {
            toastr.info('Vectorization cancelled');
            return;
        }

        const trimmedName = characterName.trim();

        button.html('<i class="fa-solid fa-spinner fa-spin"></i> Vectorizing...')
              .css('pointer-events', 'none');

        debugLog(`Vectorizing document for ${trimmedName}`);

        // Vectorize the document with user-provided name
        const success = await vectorizeDocumentFromMessage(
            trimmedName,
            documentInfo.content
        );

        if (success) {
            button.html('<i class="fa-solid fa-check"></i> Vectorized!')
                  .css('background', 'linear-gradient(135deg, #10b981, #059669)');

            setTimeout(() => {
                button.fadeOut(300, function() {
                    $(this).remove();
                });
            }, 2000);

            // Show success toast
            if (typeof toastr !== 'undefined') {
                toastr.success(`✅ ${trimmedName} document vectorized!`);
            }
        } else {
            throw new Error('Vectorization failed');
        }

    } catch (error) {
        console.error('RAG vectorization error:', error);
        const originalHTML = button.html();
        button.html('<i class="fa-solid fa-xmark"></i> Failed')
              .css('background', 'linear-gradient(135deg, #ef4444, #dc2626)');

        setTimeout(() => {
            button.html(originalHTML).css({
                'background': 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                'pointer-events': 'auto'
            });
        }, 2000);

        if (typeof toastr !== 'undefined') {
            toastr.error(`Failed to vectorize document: ${error.message}`);
        }
    }
}

/**
 * Vectorize a document from message content
 *
 * @param {string} characterName - Character name
 * @param {string} content - Document content
 * @returns {Promise<boolean>} Success status
 */

/**
 * Main entry point: Vectorize content from any source
 */
async function vectorizeContentSource(sourceType, sourceName, sourceConfig = {}) {
    console.log(`🔮 Vectorizing ${sourceType}: ${sourceName}`);

    try {
        let chunks;

        // Create progress callbacks for parsing and summarization
        const parsingCallback = (current, total) => {
            updateProgressStep('parsing', 'active', `${current}/${total}`);
        };

        const summarizationCallback = createSummarizationCallback();

        // Add callbacks to sourceConfig
        sourceConfig.summarizationCallback = summarizationCallback;

        // Start parsing step
        updateProgressStep('parsing', 'active', '');
        updateProgressStep('chunking', 'pending', '');
        updateProgressStep('summarizing', 'pending', '');
        updateProgressStep('saving', 'pending', '');

        switch (sourceType) {
            case CONTENT_SOURCES.LOREBOOK:
                chunks = await parseLorebook(sourceName, sourceConfig, parsingCallback);
                break;

            case CONTENT_SOURCES.CHARACTER:
                chunks = await parseCharacterCard(sourceName, sourceConfig, parsingCallback);
                break;

            case CONTENT_SOURCES.CHAT:
                chunks = await parseChatHistory(sourceConfig, parsingCallback);
                break;

            case CONTENT_SOURCES.CUSTOM:
                if (!sourceConfig.text) {
                    throw new Error('Custom documents require "text" field in sourceConfig');
                }
                chunks = await parseCustomDocument(
                    sourceConfig.text,
                    { name: sourceName, ...sourceConfig.metadata },
                    sourceConfig,
                    parsingCallback
                );
                break;

            default:
                throw new Error(`Unknown content source type: ${sourceType}`);
        }

        // Mark parsing as completed
        updateProgressStep('parsing', 'completed', '');
        updateProgressStep('chunking', 'completed', `${chunks.length} chunks`);
        updateProgressStats({ chunks: chunks.length });

        // Validate that chunks were created
        if (!chunks || chunks.length === 0) {
            const strategy = sourceConfig.chunkingStrategy || 'default';
            let errorMsg = `❌ Vectorization produced 0 chunks.\n\n`;

            if (sourceType === CONTENT_SOURCES.CHAT) {
                errorMsg += '📝 Possible causes:\n';
                if (strategy === 'by_scene') {
                    errorMsg += '• Scene-based chunking with no valid closed scenes\n';
                    errorMsg += '• Scenes may be marked incorrectly\n';
                } else if (!getContext()?.chat || getContext().chat.length === 0) {
                    errorMsg += '• This chat has no messages\n';
                } else {
                    errorMsg += '• All messages were filtered as empty (image-only, deleted, or removed by text cleaning)\n';
                    errorMsg += '• Chat may contain only system messages or empty content\n';
                }
                errorMsg += '\n🔧 Try:\n';
                errorMsg += '• Using a different chunking strategy\n';
                errorMsg += '• Checking that your chat has valid text messages\n';
                errorMsg += '• Reducing text cleaning aggressiveness (try "basic" or "none" mode)\n';
                errorMsg += '• Check console for warnings about filtered messages\n';
            } else {
                errorMsg += `📝 Source type: ${sourceType}\n`;
                errorMsg += `📝 Chunking strategy: ${strategy}\n`;
                errorMsg += '\n🔧 This content may be empty or the chunking strategy failed.\n';
            }

            throw new Error(errorMsg);
        }

        console.log(`✅ Created ${chunks.length} chunks from ${sourceType}`);

        // Ensure sourceName is a valid string
        if (!sourceName || typeof sourceName !== 'string') {
            sourceName = 'Unnamed Source';
        }

        const collectionId = `${COLLECTION_PREFIX}${sourceType}_${sourceName.replace(/[^a-zA-Z0-9]/g, '_')}`;

        // Filter out chunks with empty/invalid text before creating items
        const validChunks = chunks.filter(chunk => chunk.text && chunk.text.trim().length > 0);

        if (validChunks.length === 0) {
            throw new Error('All chunks have empty text after filtering. This may be caused by aggressive text cleaning removing all content. Please check your text cleaning settings or source content.');
        }

        if (validChunks.length < chunks.length) {
            console.warn(`⚠️ Filtered out ${chunks.length - validChunks.length} chunks with empty text`);
        }

        const items = validChunks.map(chunk => ({
            text: chunk.text,
            hash: getStringHash(chunk.text),
            metadata: chunk.metadata
        }));

        // Update progress: saving to database
        updateProgressStep('summarizing', 'completed', '');
        updateProgressStep('saving', 'active', 'Saving vectors...');

        await apiInsertVectorItems(collectionId, items);
        await saveChunksToLibrary(collectionId, validChunks);

        // Mark saving as completed
        updateProgressStep('saving', 'completed', '');

        const ragState = ensureRagState();
        if (!ragState.sources) ragState.sources = {};

        // Sanitize config to only store serializable properties (no circular refs)
        const sanitizedConfig = {};
        if (sourceConfig.chunkingStrategy) sanitizedConfig.chunkingStrategy = sourceConfig.chunkingStrategy;
        if (sourceConfig.includeDisabled !== undefined) sanitizedConfig.includeDisabled = sourceConfig.includeDisabled;
        if (sourceConfig.fields) sanitizedConfig.fields = sourceConfig.fields;
        if (sourceConfig.messageRange !== undefined) sanitizedConfig.messageRange = sourceConfig.messageRange;
        // Don't store 'text' property as it can be very large

        const sourceData = {
            type: sourceType,
            name: sourceName,
            active: true,
            chunkCount: chunks.length,
            lastVectorized: Date.now(),
            config: sanitizedConfig
        };

        // Keep for backward compatibility during migration
        ragState.sources[collectionId] = sourceData;

        // Initialize collection metadata for activation triggers (like lorebook triggers)
        if (!ragState.collectionMetadata) ragState.collectionMetadata = {};
        if (!ragState.collectionMetadata[collectionId]) {
            // Set default activation triggers based on source type and name
            const defaultTriggers = [];

            // Add source name as default trigger
            if (sourceName) {
                defaultTriggers.push(sourceName);
            }

            // For character sources, add character name
            if (sourceType === CONTENT_SOURCES.CHARACTER && sourceConfig.characterName) {
                if (!defaultTriggers.includes(sourceConfig.characterName)) {
                    defaultTriggers.push(sourceConfig.characterName);
                }
            }

            // Determine scope and alwaysActive default based on source type
            const context = getContext();
            let scope = 'global';
            let scopeIdentifier = null;
            let alwaysActive = true; // All collections default to always active

            if (sourceType === CONTENT_SOURCES.CHAT) {
                scope = 'chat';
                scopeIdentifier = context?.chatId || null;
            } else if (sourceType === CONTENT_SOURCES.CHARACTER) {
                scope = 'character';
                scopeIdentifier = context?.characterId;
            }

            ragState.collectionMetadata[collectionId] = {
                keywords: defaultTriggers, // Activation triggers (determines IF collection activates)
                alwaysActive: alwaysActive, // If true, ignores triggers and always queries this collection
                conditions: null, // Conditional activation rules (user can add via editor)
                scope: scope, // 'global', 'character', or 'chat'
                scopeIdentifier: scopeIdentifier, // chatId or characterId
                sourceName: sourceName,
                sourceType: sourceType,
                createdAt: Date.now(),
                lastModified: Date.now()
            };
        } else {
            // Update lastModified timestamp
            ragState.collectionMetadata[collectionId].lastModified = Date.now();
        }

        // Save to scoped sources (NEW: scope-aware storage)
        saveScopedSource(collectionId, sourceData);

        saveSettingsDebounced();

        const metadata = ragState.collectionMetadata[collectionId];
        console.log(`✅ Vectorized ${sourceType} "${sourceName}": ${chunks.length} chunks (scope: ${metadata.scope})`);

        if (metadata.conditions && metadata.conditions.enabled) {
            const conditionCount = metadata.conditions.rules?.length || 0;
            console.log(`   Activation: Conditional (${conditionCount} ${conditionCount === 1 ? 'condition' : 'conditions'})`);
        } else if (metadata.alwaysActive) {
            console.log(`   Activation: Always Active`);
        } else {
            console.log(`   Activation triggers: ${metadata.keywords.join(', ')}`);
        }

        return { success: true, collectionId, chunkCount: chunks.length };
    } catch (error) {
        console.error(`❌ Failed to vectorize ${sourceType}:`, error);
        throw error;
    }
}

async function vectorizeDocumentFromMessage(characterName, content) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔬 VECTORIZATION STARTED');
    console.log(`   Character: ${characterName}`);
    console.log(`   Content length: ${content.length} chars`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const settings = getRAGSettings();
    const collectionId = generateCollectionId(characterName);

    console.log(`📋 Settings:`, {
        enabled: settings.enabled,
        simpleChunking: settings.simpleChunking,
        chunkSize: settings.chunkSize,
        chunkOverlap: settings.chunkOverlap,
        contextLevel: getCurrentContextLevel()
    });
    console.log(`🗂️  Collection ID: ${collectionId}`);

    try {
        // Step 1: Chunk the document
        console.log('\n📦 STEP 1: Chunking document...');
        const chunks = chunkDocument(content, characterName, settings.chunkSize, settings.chunkOverlap);

        if (!chunks || chunks.length === 0) {
            console.error('❌ STEP 1 FAILED: Chunking resulted in 0 chunks');
            throw new Error('Document chunking resulted in 0 chunks');
        }

        console.log(`✅ STEP 1 COMPLETE: Created ${chunks.length} chunks`);
        console.log(`   First chunk preview:`, chunks[0].text.substring(0, 100) + '...');
        console.log(`   Chunk hashes:`, chunks.map(c => c.hash));

        // Step 2: Get existing hashes
        console.log('\n🔍 STEP 2: Checking for existing chunks in vector DB...');
        const savedHashes = await apiGetSavedHashes(collectionId);
        const savedHashSet = new Set(savedHashes.map(h => h.hash));
        console.log(`✅ STEP 2 COMPLETE: Found ${savedHashes.length} existing hashes`);
        if (savedHashes.length > 0) {
            console.log(`   Existing hashes:`, Array.from(savedHashSet));
        }

        // Step 3: Filter new chunks
        console.log('\n🔢 STEP 3: Filtering for new chunks...');
        const newChunks = chunks.filter(chunk => !savedHashSet.has(chunk.hash));
        console.log(`✅ STEP 3 COMPLETE:`);
        console.log(`   Total chunks: ${chunks.length}`);
        console.log(`   Already saved: ${chunks.length - newChunks.length}`);
        console.log(`   New chunks to insert: ${newChunks.length}`);

        // Step 4: Insert new chunks
        if (newChunks.length > 0) {
            console.log(`\n💾 STEP 4: Inserting ${newChunks.length} new chunks into vector DB...`);
            console.log(`   New chunk hashes:`, newChunks.map(c => c.hash));

            await apiInsertVectorItems(collectionId, newChunks);

            console.log(`✅ STEP 4 COMPLETE: Vector insertion successful`);
        } else {
            console.log('\n⏭️  STEP 4 SKIPPED: No new chunks to insert');
        }

        // Step 5: Update local library
        console.log('\n📚 STEP 5: Updating local library...');
        const library = getContextualLibrary();
        console.log(`   Current library keys:`, Object.keys(library));

        if (!library[collectionId]) {
            console.log(`   Creating new collection entry: ${collectionId}`);
            library[collectionId] = {};
        } else {
            console.log(`   Collection already exists, updating...`);
        }

        chunks.forEach(chunk => {
            library[collectionId][chunk.hash] = {
                text: chunk.text,
                ...chunk.metadata
            };
        });

        console.log(`   Updated library with ${chunks.length} chunks`);
        console.log(`   Library now has ${Object.keys(library[collectionId]).length} total entries for this collection`);

        // Initialize collection metadata if it doesn't exist
        ensureRagState();
        const ragState = extension_settings[extensionName].rag;
        if (!ragState.collectionMetadata) {
            ragState.collectionMetadata = {};
        }
        if (!ragState.collectionMetadata[collectionId]) {
            // Initialize with character name as default trigger (user can edit/remove it)
            const defaultTriggers = characterName ? [characterName] : [];

            ragState.collectionMetadata[collectionId] = {
                keywords: defaultTriggers, // Activation triggers (determines IF collection activates - like lorebook triggers)
                alwaysActive: true, // All collections default to always active
                characterName: characterName,
                createdAt: Date.now(),
                lastModified: Date.now()
            };
        } else {
            // Update lastModified timestamp
            ragState.collectionMetadata[collectionId].lastModified = Date.now();
        }

        saveSettingsDebounced();
        console.log(`✅ STEP 5 COMPLETE: Local library updated and saved`);

        // Step 6: Track current embedding provider
        console.log('\n🏷️  STEP 6: Tracking embedding provider...');
        const vectorSettings = getVectorSettings();
        // ragState already declared above, just reuse it
        ragState.lastEmbeddingSource = vectorSettings.source;
        ragState.lastEmbeddingModel = vectorSettings.model || null;
        saveSettingsDebounced();
        console.log(`✅ STEP 6 COMPLETE: Tracked embedding provider`);
        console.log(`   Source: ${vectorSettings.source}`);
        console.log(`   Model: ${vectorSettings.model || 'default'}`);

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`✅ VECTORIZATION SUCCESSFUL: ${characterName}`);
        console.log(`   Total chunks: ${chunks.length}`);
        console.log(`   Collection ID: ${collectionId}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Show success toast only if new chunks were added
        if (newChunks.length > 0) {
            toastr.success(`Chunked ${characterName}'s document (${chunks.length} chunks)`);
            return true;
        } else {
            toastr.info(`${characterName}'s document already chunked`);
            return false;
        }

    } catch (error) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ VECTORIZATION FAILED:', characterName);
        console.error('   Error message:', error.message);
        console.error('   Error stack:', error.stack);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        toastr.error(`Failed to chunk ${characterName}: ${error.message}`);
        return false;
    }
}

/**
 * Add RAG buttons to all existing messages
 */
function addRAGButtonsToAllMessages() {
    const settings = getRAGSettings();
    if (!settings.enabled) {
        return;
    }

    debugLog('Adding RAG buttons to all existing messages');

    chat.forEach((message, index) => {
        if (!message.is_user && message.mes) {
            addRAGButtonToMessage(index);
        }
    });
}

/**
 * Remove all RAG buttons
 */
function removeAllRAGButtons() {
    $(`.${RAG_BUTTON_CLASS}`).remove();
    debugLog('Removed all RAG buttons');
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the RAG system
 */
function initializeRAG() {
    debugLog('Initializing CarrotKernel RAG system');

    // Register RAG interceptor for generation events
    eventSource.on(event_types.GENERATION_STARTED, carrotKernelRagInterceptor);
    debugLog('✅ RAG interceptor registered for GENERATION_STARTED');

    // Hook into message events for button detection
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        const settings = getRAGSettings();
        if (settings.enabled) {
            addRAGButtonToMessage(messageId);

            // Auto-vectorize if enabled
            if (settings.autoVectorize) {
                autoVectorizeMessage(messageId);
            }
        }
    });

    // Hook into chat changed event to add buttons to existing messages
    eventSource.on(event_types.CHAT_CHANGED, () => {
        const settings = getRAGSettings();
        if (settings.enabled) {
            setTimeout(() => {
                addRAGButtonsToAllMessages();
            }, 500);
        }
    });

    // Add buttons to current chat on init
    setTimeout(() => {
        addRAGButtonsToAllMessages();
    }, 1000);

    debugLog('✅ CarrotKernel RAG system initialized');
}

/**
 * Auto-vectorize a message if it contains a document
 *
 * @param {number} messageId - Message ID
 */
async function autoVectorizeMessage(messageId) {
    const message = chat.find(msg => msg.index === messageId);
    if (!message || !message.mes || message.is_user) {
        return;
    }

    const documentInfo = detectDocumentInMessage(message.mes);
    if (!documentInfo) {
        return;
    }

    const collectionId = generateCollectionId(documentInfo.characterName);
    const exists = await collectionExists(collectionId);

    // Only auto-vectorize if collection doesn't exist yet
    if (!exists) {
        debugLog(`Auto-vectorizing document for ${documentInfo.characterName}`);

        const success = await vectorizeDocumentFromMessage(
            documentInfo.characterName,
            documentInfo.content
        );

        if (success && typeof toastr !== 'undefined') {
            toastr.info(`🔬 Auto-vectorized ${documentInfo.characterName} document`);
        }
    }
}

/**
 * RAGBooks interceptor for chat generation
 * Queries all active RAGBooks collections and injects relevant content
 */
async function ragbooksInterceptor(chatArray, contextSize, abort, type) {
    console.log('📚 [RAGBooks] Interceptor called!', {
        chatArrayLength: chatArray?.length,
        contextSize,
        type,
        is_send_press,
        timestamp: new Date().toISOString()
    });

    const settings = getRAGSettings();
    const roleKey = settings.injectionRole?.toUpperCase?.() || 'SYSTEM';
    const promptRole = extension_prompt_roles?.[roleKey] ?? extension_prompt_roles.SYSTEM;

    // Clear any existing prompt first
    setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);

    if (!settings.enabled) {
        console.log('❌ [RAGBooks] RAG is DISABLED - skipping');
        return false;
    }

    // Skip quiet generations
    if (type === 'quiet') {
        console.log(`⏭️ [RAGBooks] Skipping quiet generation`);
        return false;
    }

    // Only run during user-initiated generation
    if (!is_send_press) {
        console.log(`⏭️ [RAGBooks] Skipping - not user-initiated (is_send_press=false)`);
        return false;
    }

    console.log('┌─────────────────────────────────────────────────────');
    console.log('│ 📚 RAGBOOKS INTERCEPTOR ACTIVATED');
    console.log('└─────────────────────────────────────────────────────');

    try {
        const context = getContext();
        const activeCharacter = context?.characters?.[context.characterId];
        const characterName = activeCharacter?.name || context?.character?.name || null;

        if (!characterName) {
            console.log('⚠️  [RAGBooks] No active character found');
            setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);
            return false;
        }

        console.log(`📝 [RAGBooks] Character = ${characterName}`);

        const queryText = buildQueryContext(settings.queryContext).trim();
        if (!queryText.length) {
            console.log('⚠️  [RAGBooks] No recent messages to query');
            setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);
            return false;
        }

        console.log(`🔍 [RAGBooks] Query = "${queryText.substring(0, 100)}..."`);

        // Query all active RAGBooks collections
        const ragChunks = await queryAllRAGBooksCollections(queryText);

        if (ragChunks.length > 0) {
            console.log(`✅ [RAGBooks] Found ${ragChunks.length} relevant chunk${ragChunks.length > 1 ? 's' : ''} from multiple sources`);
            console.log('📦 [RAGBooks] Chunks being injected:');
            ragChunks.forEach((chunk, i) => {
                const preview = chunk.text.substring(0, 60);
                console.log(`   ${i + 1}. [${chunk.collectionType}/${chunk.collectionName}] ${preview}... (score: ${chunk.score.toFixed(3)})`);
            });

            await injectRAGResults(characterName, ragChunks);
        } else {
            console.log('ℹ️  [RAGBooks] No relevant chunks found');
            setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);
        }
    } catch (error) {
        console.error('❌ [RAGBooks] Interceptor error:', error);
        setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);
    }

    return false; // Don't abort generation
}

async function carrotKernelRagInterceptor(chatArray, contextSize, abort, type) {
    console.log('🥕🥕🥕 [CarrotKernel RAG] Interceptor called!', {
        chatArrayLength: chatArray?.length,
        contextSize,
        type,
        is_send_press,
        timestamp: new Date().toISOString()
    });

    const settings = getRAGSettings();
    console.log('⚙️ [CarrotKernel RAG] Settings loaded:', {
        enabled: settings.enabled,
        queryContext: settings.queryContext,
        injectionDepth: settings.injectionDepth,
        topK: settings.topK
    });

    const roleKey = settings.injectionRole?.toUpperCase?.() || 'SYSTEM';
    const promptRole = extension_prompt_roles?.[roleKey] ?? extension_prompt_roles.SYSTEM;

    // Clear any existing prompt first
    setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);

    if (!settings.enabled) {
        console.log('❌ [CarrotKernel RAG] RAG is DISABLED - skipping');
        return false;
    }

    // Match ST's native vector behavior: only skip 'quiet' type
    // Normal generations have type=undefined
    // 'continue', 'regenerate', 'swipe', 'impersonate' are all valid generation types we should process
    if (type === 'quiet') {
        console.log(`⏭️ [CarrotKernel RAG] Skipping quiet generation`);
        return false;
    }

    // CRITICAL: Only run RAG during actual user-initiated generation
    // is_send_press is true when user clicks Send or presses Enter
    // Deletions, UI updates, etc. have is_send_press=false
    if (!is_send_press) {
        console.log(`⏭️ [CarrotKernel RAG] Skipping - not user-initiated (is_send_press=false)`);
        return false;
    }

    console.log('┌─────────────────────────────────────────────────────');
    console.log('│ 🥕 CARROTKERNEL RAG INTERCEPTOR ACTIVATED');
    console.log('└─────────────────────────────────────────────────────');

    try {
        const context = getContext();
        const activeCharacter = context?.characters?.[context.characterId];
        const characterName = activeCharacter?.name || context?.character?.name || null;

        if (!characterName) {
            console.log('⚠️  RAG: No active character found');
            debugLog('No active character found for RAG interceptor');
            setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);
            return false;
        }

        console.log(`📝 RAG: Character = ${characterName}`);

        const queryText = buildQueryContext(settings.queryContext).trim();
        if (!queryText.length) {
            console.log('⚠️  RAG: No recent messages to query');
            debugLog('Empty query context for RAG interceptor');
            setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);
            return false;
        }

        console.log(`🔍 RAG: Query = "${queryText.substring(0, 100)}..."`);

        const ragChunks = await queryRAG(characterName, queryText);

        if (ragChunks.length > 0) {
            console.log(`✅ RAG: Found ${ragChunks.length} relevant chunk${ragChunks.length > 1 ? 's' : ''}`);
            console.log('📦 RAG: Chunks being injected:');
            ragChunks.forEach((chunk, i) => {
                console.log(`   ${i + 1}. [${chunk.section}] ${chunk.text.substring(0, 60)}... (${chunk.text.length} chars)`);
            });
        } else {
            console.log('⚠️  RAG: No relevant chunks found for this query');
        }

        await injectRAGResults(characterName, ragChunks);

        console.log('✅ RAG: Injection complete');
        console.log('─────────────────────────────────────────────────────\n');
    } catch (error) {
        console.error('❌ RAG: Interceptor failed', error);
        setExtensionPrompt(RAG_PROMPT_TAG, '', extension_prompt_types.IN_PROMPT, settings.injectionDepth, false, promptRole);
    }

    return false;
}

window.carrotKernelRagInterceptor = carrotKernelRagInterceptor;

/**
 * Purge orphaned vectors from a collection
 * Called when chunks are deleted from the library to clean up vector DB
 */
async function purgeOrphanedVectors(collectionId, deletedHashes) {
    if (!Array.isArray(deletedHashes) || deletedHashes.length === 0) {
        return;
    }

    debugLog(`Purging ${deletedHashes.length} orphaned vectors from ${collectionId}`, { deletedHashes });

    try {
        const exists = await collectionExists(collectionId);
        if (!exists) {
            debugLog(`Collection ${collectionId} doesn't exist, nothing to purge`);
            return;
        }

        await apiDeleteVectorHashes(collectionId, deletedHashes);
        debugLog(`Successfully purged ${deletedHashes.length} vectors from ${collectionId}`);
    } catch (error) {
        console.error(`Failed to purge orphaned vectors from ${collectionId}:`, error);
        throw error;
    }
}

/**
 * Delete an entire collection from the vector database
 */
async function deleteEntireCollection(collectionId) {
    debugLog(`Deleting entire collection: ${collectionId}`);

    try {
        const exists = await collectionExists(collectionId);
        if (!exists) {
            debugLog(`Collection ${collectionId} doesn't exist, nothing to delete`);
            return;
        }

        await apiDeleteCollection(collectionId);
        debugLog(`Successfully deleted collection ${collectionId}`);
    } catch (error) {
        console.error(`Failed to delete collection ${collectionId}:`, error);
        throw error;
    }
}

// ============================================================================
// PUBLIC API
// ============================================================================

globalThis.CarrotKernelDocumentRag = {
    getRAGSettings,
    saveRAGSettings,
    generateCollectionId,
    chunkDocument,
    collectionExists,
    queryRAG,
    injectRAGResults,
    addRAGButtonsToAllMessages,
    removeAllRAGButtons,
    detectDocumentInMessage,
    vectorizeDocumentFromMessage,
    getCurrentContextLevel,
    getContextualLibrary,
    getAllContextualLibraries,
    purgeOrphanedVectors,
    deleteEntireCollection,
    apiInsertVectorItems,
};

// ES6 Module Exports (for dynamic import)
export {
    initializeRAG,
    saveRAGSettings,
    addRAGButtonsToAllMessages,
    removeAllRAGButtons,
    detectDocumentInMessage,
    vectorizeDocumentFromMessage,
    getCurrentContextLevel,
    getContextualLibrary,
    getAllContextualLibraries,
    getKeywordPriority,
    normalizeKeyword,
    getRAGSettings,
    chunkDocument,
    generateCollectionId,
    buildChunkMetadata,
    regenerateChunkKeywords,
    applyAutomaticLinks,
    apiInsertVectorItems,
    updateChunksInLibrary,
};

/**
 * Regenerate keywords for a chunk based on current content
 * Shared function used by both chunk viewer and baby bunny chunking
 * @param {Object} chunk - The chunk to regenerate keywords for
 * @param {string} characterName - Character name for context
 * @param {Function} onSuccess - Callback on success
 * @param {Function} onError - Callback on error
 */
async function regenerateChunkKeywords(chunk, characterName, onSuccess, onError) {
    const confirmed = confirm(`Regenerate keywords for "${chunk.comment || chunk.section || 'this chunk'}"?\n\nThis will:\n• Re-analyze the current chunk text\n• Generate new keywords based on content\n• WIPE all custom keywords\n• Reset all keyword weights to defaults`);
    if (!confirmed) return;

    try {
        // Read CURRENT chunk text from the textarea (if it exists) or use stored text
        const hash = chunk.hash;
        // Try both selectors (baby-bunny uses .chunk-text-edit, chunk viewer uses .carrot-chunk-text-edit)
        let $textArea = $(`.chunk-text-edit[data-hash="${hash}"]`);
        if (!$textArea.length) {
            $textArea = $(`.carrot-chunk-text-edit[data-hash="${hash}"]`);
        }
        const chunkText = $textArea.length ? $textArea.val() || '' : chunk.text || '';

        const sectionTitle = chunk.section || chunk.comment || '';
        const topic = chunk.topic || null;
        // IMPORTANT: Pass empty tags array when regenerating
        // We want keywords based ONLY on current chunk text, not inherited tags from full character
        const tags = [];

        console.log('🔧 [regenerateChunkKeywords] Regenerating keywords for chunk:', {
            hash,
            sectionTitle,
            textLength: chunkText.length,
            textPreview: chunkText.substring(0, 100)
        });

        // Generate new metadata
        const newMetadata = buildChunkMetadata(sectionTitle, topic, chunkText, tags, characterName);

        console.log('📦 [regenerateChunkKeywords] New metadata generated:', {
            systemKeywords: newMetadata.systemKeywords?.slice(0, 10),
            totalKeywords: newMetadata.systemKeywords?.length
        });

        // Update the stored chunk text with current edited content
        chunk.text = chunkText;

        // COMPLETELY REPLACE all keywords with freshly generated ones
        chunk.systemKeywords = newMetadata.systemKeywords || [];
        chunk.defaultSystemKeywords = newMetadata.defaultSystemKeywords || [];
        chunk.keywords = [...chunk.systemKeywords]; // No custom keywords
        chunk.customKeywords = []; // Wipe custom keywords
        chunk.keywordGroups = newMetadata.keywordGroups || [];
        chunk.defaultKeywordGroups = newMetadata.defaultKeywordGroups || [];
        chunk.keywordRegex = newMetadata.keywordRegex || [];
        chunk.defaultKeywordRegex = newMetadata.defaultKeywordRegex || [];

        // Reset ALL weights and customizations
        chunk.customWeights = {};
        chunk.customRegex = [];
        chunk.disabledKeywords = [];

        console.log('✅ [regenerateChunkKeywords] Keywords wiped and regenerated:', {
            hash,
            newKeywords: chunk.keywords?.slice(0, 10),
            totalKeywords: chunk.keywords?.length
        });

        // Call success callback
        if (onSuccess) {
            onSuccess(chunk);
        }

        toastr.success('Keywords regenerated!');
    } catch (error) {
        console.error('[regenerateChunkKeywords] Failed to regenerate keywords:', error);
        toastr.error('Failed to regenerate keywords: ' + error.message);

        // Call error callback
        if (onError) {
            onError(error);
        }
    }
}

// ============================================================================
// UI MANAGEMENT
// ============================================================================

/**
 * Render all active collections in the UI (scope-aware with filtering)
 */
function renderCollections() {
    const collectionsContainer = $('#ragbooks_collections');
    const emptyState = $('#ragbooks_empty_state');

    // Get scoped sources (includes global + character + chat for current context)
    let scopedSources = getScopedSources();

    // Get filter state (default: 'all')
    const ragState = ensureRagState();
    const scopeFilter = ragState.scopeFilter || 'all';

    // Apply scope filter if not 'all'
    if (scopeFilter !== 'all') {
        const metadata = ragState.collectionMetadata || {};
        scopedSources = Object.fromEntries(
            Object.entries(scopedSources).filter(([collectionId]) => {
                const scope = metadata[collectionId]?.scope || 'global';
                return scope === scopeFilter;
            })
        );
    }

    if (!scopedSources || Object.keys(scopedSources).length === 0) {
        emptyState.show();
        collectionsContainer.find('.ragbooks-source-card').remove();
        return;
    }

    emptyState.hide();

    // Clear existing cards
    collectionsContainer.find('.ragbooks-source-card').remove();

    // Render each collection
    for (const [collectionId, sourceData] of Object.entries(scopedSources)) {
        const card = createCollectionCard(collectionId, sourceData);
        collectionsContainer.append(card);
    }
}

/**
 * Create a collection card HTML element matching CarrotKernel style
 */
function createCollectionCard(collectionId, sourceData) {
    // Map source type to icon
    const typeIcons = {
        lorebook: '📚',
        character: '👤',
        chat: '💬',
        custom: '📄'
    };
    const typeIcon = typeIcons[sourceData.type] || '📄';

    // Format type for display
    const typeLabel = sourceData.type.charAt(0).toUpperCase() + sourceData.type.slice(1);

    const lastVectorized = sourceData.lastVectorized
        ? new Date(sourceData.lastVectorized).toLocaleString()
        : 'Never';

    const chunkCount = sourceData.chunkCount || 0;

    // Get activation triggers metadata
    const ragState = ensureRagState();
    const metadata = ragState.collectionMetadata?.[collectionId] || {};
    const triggers = metadata.keywords || [];
    const alwaysActive = metadata.alwaysActive || false;
    const conditions = metadata.conditions || null;

    // Get scope information
    const scope = metadata.scope || 'global';
    const scopeIcons = {
        global: '🌍',
        character: '👤',
        chat: '💬'
    };
    const scopeLabels = {
        global: 'Global',
        character: 'Character',
        chat: 'Chat'
    };
    const scopeIcon = scopeIcons[scope] || '🌍';
    const scopeLabel = scopeLabels[scope] || 'Global';

    // Determine activation mode and display
    const hasConditions = conditions && conditions.enabled && conditions.rules && conditions.rules.length > 0;

    // Format triggers display
    let triggersDisplay;
    if (hasConditions) {
        // Show conditional activation badge
        const conditionCount = conditions.rules.length;
        const conditionText = conditionCount === 1 ? '1 condition' : `${conditionCount} conditions`;
        triggersDisplay = `<span class="ragbooks-conditional-badge"><i class="fa-solid fa-filter" style="font-size: 0.85em; opacity: 0.7; margin-right: 4px;"></i>Conditional (${conditionText})</span>`;
    } else if (alwaysActive) {
        triggersDisplay = '<span class="ragbooks-always-active-badge"><i class="fa-solid fa-infinity"></i> Always Active</span>';
    } else if (triggers.length > 0) {
        triggersDisplay = triggers.slice(0, 3).map(t => `<span class="ragbooks-trigger-badge"><i class="fa-solid fa-key" style="font-size: 0.85em; opacity: 0.7; margin-right: 4px;"></i>${t}</span>`).join('') +
            (triggers.length > 3 ? `<span class="ragbooks-trigger-more">+${triggers.length - 3} more</span>` : '');
    } else {
        triggersDisplay = '<span class="ragbooks-no-triggers"><i class="fa-solid fa-triangle-exclamation"></i> No triggers (won\'t activate)</span>';
    }

    const card = $(`
        <div class="ragbooks-source-card" data-collection-id="${collectionId}">
            <div class="ragbooks-source-header">
                <span class="ragbooks-source-icon">${typeIcon}</span>
                <span class="ragbooks-source-name">${sourceData.name}</span>
                <div class="ragbooks-badges-container">
                    <span class="ragbooks-type-badge ${sourceData.type}">${typeLabel}</span>
                    <div class="ragbooks-scope-dropdown">
                        <span class="ragbooks-scope-badge ${scope}" title="Click to change scope">
                            ${scopeIcon} ${scopeLabel} <i class="fa-solid fa-caret-down" style="margin-left: 4px; font-size: 0.85em;"></i>
                        </span>
                        <div class="ragbooks-scope-dropdown-menu">
                            <div class="ragbooks-scope-option" data-scope="global">
                                <span class="ragbooks-scope-badge global">🌍 Global</span>
                                <span class="ragbooks-scope-description">Available everywhere</span>
                            </div>
                            <div class="ragbooks-scope-option" data-scope="character">
                                <span class="ragbooks-scope-badge character">👤 Character</span>
                                <span class="ragbooks-scope-description">Only for this character</span>
                            </div>
                            <div class="ragbooks-scope-option" data-scope="chat">
                                <span class="ragbooks-scope-badge chat">💬 Chat</span>
                                <span class="ragbooks-scope-description">Only for this chat</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="ragbooks-source-meta">
                <span><i class="fa-solid fa-cubes"></i> ${chunkCount} chunks</span>
                <span>•</span>
                <span><i class="fa-solid fa-clock"></i> ${lastVectorized}</span>
                <span>•</span>
                <span class="ragbooks-status ${sourceData.active ? 'active' : 'paused'}">
                    <i class="fa-solid fa-circle"></i>
                    ${sourceData.active ? 'Active' : 'Paused'}
                </span>
            </div>
            <div class="ragbooks-triggers-section">
                <div class="ragbooks-triggers-header">
                    <span><i class="fa-solid fa-bolt"></i> Activation Triggers</span>
                    <button class="ragbooks-edit-triggers-btn" title="Edit activation triggers (like lorebook triggers)">
                        <i class="fa-solid fa-pen"></i> Edit
                    </button>
                </div>
                <div class="ragbooks-triggers-display">
                    ${triggersDisplay}
                </div>
                <div class="ragbooks-triggers-help">
                    <i class="fa-solid fa-info-circle" style="opacity: 0.6; margin-right: 4px;"></i>
                    ${hasConditions
                        ? 'This collection activates when its conditions are met. Click "Edit" to view/modify conditions.'
                        : (alwaysActive
                            ? 'This collection searches on every message.'
                            : (triggers.length > 0
                                ? 'Collection activates when these keywords appear in recent messages.'
                                : '<strong style="color: var(--SmartThemeQuoteColor);">⚠️ No triggers set - collection will not activate!</strong>'))}
                </div>
            </div>
            <div class="ragbooks-source-actions">
                <button class="ragbooks-toggle-btn ${sourceData.active ? 'active' : ''}" title="${sourceData.active ? 'Pause' : 'Activate'} Collection">
                    <i class="fa-solid ${sourceData.active ? 'fa-pause' : 'fa-play'}"></i>
                    ${sourceData.active ? 'Pause' : 'Activate'}
                </button>
                <button class="ragbooks-preview-btn" title="View Chunks in Visualizer">
                    <i class="fa-solid fa-cube"></i>
                    Visualizer
                </button>
                <button class="ragbooks-revectorize-btn" title="Re-vectorize Content">
                    <i class="fa-solid fa-rotate"></i>
                    Re-vectorize
                </button>
                <button class="ragbooks-delete-btn danger" title="Delete Collection">
                    <i class="fa-solid fa-trash"></i>
                    Delete
                </button>
            </div>
        </div>
    `);

    // Bind button handlers
    // Bind button handlers with touch support for mobile
    card.find('.ragbooks-toggle-btn').on('click touchend', function(e) {
        e.preventDefault();
        toggleCollection(collectionId);
    });
    card.find('.ragbooks-preview-btn').on('click touchend', function(e) {
        e.preventDefault();
        previewCollection(collectionId);
    });
    card.find('.ragbooks-revectorize-btn').on('click touchend', function(e) {
        e.preventDefault();
        revectorizeCollection(collectionId, sourceData);
    });
    card.find('.ragbooks-delete-btn').on('click touchend', function(e) {
        e.preventDefault();
        deleteCollection(collectionId);
    });
    card.find('.ragbooks-edit-triggers-btn').on('click touchend', function(e) {
        e.preventDefault();
        e.stopPropagation();
        editCollectionTriggers(collectionId);
    });

    // Bind scope badge click handler (toggle dropdown)
    card.find('.ragbooks-scope-badge').on('click', function(e) {
        e.stopPropagation();
        const dropdown = $(this).closest('.ragbooks-scope-dropdown');
        const menu = dropdown.find('.ragbooks-scope-dropdown-menu');

        // Close all other dropdowns
        $('.ragbooks-scope-dropdown-menu').not(menu).removeClass('show');

        // Toggle this dropdown
        menu.toggleClass('show');
    });

    // Bind scope option click handler
    card.find('.ragbooks-scope-option').on('click', function(e) {
        e.stopPropagation();
        const newScope = $(this).data('scope');
        const dropdown = $(this).closest('.ragbooks-scope-dropdown');
        const menu = dropdown.find('.ragbooks-scope-dropdown-menu');

        // Close dropdown
        menu.removeClass('show');

        // Change scope
        changeScopeForCollection(collectionId, sourceData, newScope);
    });

    return card;
}

/**
 * Edit activation triggers for a collection
 */
function editCollectionTriggers(collectionId) {
    const ragState = ensureRagState();
    const metadata = ragState.collectionMetadata?.[collectionId] || {};
    const sourceData = ragState.sources?.[collectionId] || {};

    const currentKeywords = (metadata.keywords || []).join(', ');
    const currentAlwaysActive = metadata.alwaysActive || false;

    // Create modal overlay
    const overlay = $(`
        <div class="ragbooks-modal-overlay">
            <div class="ragbooks-modal-dialog" style="max-width: 600px;">
                <div class="ragbooks-card">
                    <div class="ragbooks-card-header">
                        <h3><i class="fa-solid fa-bolt"></i> Edit Activation Triggers</h3>
                        <p class="ragbooks-card-subtitle">Configure when "${sourceData.name}" activates (like lorebook triggers)</p>
                    </div>
                    <div class="ragbooks-card-body">
                        <div class="ragbooks-setting-item" style="margin-bottom: 16px;">
                            <label class="ragbooks-toggle">
                                <input type="checkbox" id="ragbooks-always-active" ${currentAlwaysActive ? 'checked' : ''}>
                                <span class="ragbooks-toggle-slider"></span>
                                <span class="ragbooks-toggle-label">Always Active (ignores triggers)</span>
                            </label>
                            <div class="ragbooks-help-text">If enabled, this collection will always be queried regardless of triggers</div>
                        </div>

                        <!-- Conditionals Section (Advanced) -->
                        <div class="ragbooks-setting-item" style="margin-bottom: 16px;">
                            <label class="ragbooks-toggle">
                                <input type="checkbox" id="ragbooks-conditionals-enabled" ${metadata.conditions?.enabled ? 'checked' : ''}>
                                <span class="ragbooks-toggle-slider"></span>
                                <span class="ragbooks-toggle-label">Use Conditional Activation (Advanced)</span>
                            </label>
                            <div class="ragbooks-help-text">Use advanced conditions instead of simple keyword triggers</div>
                        </div>

                        <div id="ragbooks-conditionals-section" style="display: ${metadata.conditions?.enabled ? 'block' : 'none'}; margin-bottom: 16px; padding: 12px; background: var(--black20a); border-radius: 8px; border: 1px solid var(--SmartThemeBorderColor);">
                            <div style="margin-bottom: 12px;">
                                <label style="display: block; margin-bottom: 6px;"><strong>Condition Logic</strong></label>
                                <select id="ragbooks-condition-mode" class="text_pole" style="width: 100%;">
                                    <option value="AND" ${metadata.conditions?.mode === 'AND' ? 'selected' : ''}>Match ALL conditions (AND)</option>
                                    <option value="OR" ${metadata.conditions?.mode === 'OR' ? 'selected' : ''}>Match ANY condition (OR)</option>
                                </select>
                            </div>

                            <div style="margin-bottom: 12px;">
                                <label style="display: block; margin-bottom: 6px;"><strong>Conditions</strong></label>
                                <div id="ragbooks-conditions-list" style="display: flex; flex-direction: column; gap: 8px;">
                                    <!-- Conditions will be rendered here -->
                                </div>
                                <button id="ragbooks-add-condition" class="menu_button" style="margin-top: 8px; width: 100%;">
                                    <i class="fa-solid fa-plus"></i> Add Condition
                                </button>
                            </div>
                        </div>

                        <div class="ragbooks-setting-item">
                            <label><strong>Activation Triggers</strong></label>
                            <select id="ragbooks-triggers-input" class="text_pole" multiple="multiple" style="width: 100%; margin-top: 8px;"></select>
                            <small style="display: block; margin-top: 6px; opacity: 0.7;">
                                This collection will activate when any of these triggers appear in the query.
                            </small>
                        </div>

                        <div style="padding: 12px; background: var(--black30a, rgba(0, 0, 0, 0.3)); border-radius: 6px; border-left: 3px solid rgba(99, 102, 241, 0.8); margin-top: 16px;">
                            <strong style="display: block; margin-bottom: 6px;">📌 How This Works:</strong>
                            <ul style="margin: 0; padding-left: 20px; font-size: 0.9em;">
                                <li style="margin-bottom: 4px;"><strong>Always Active</strong> = Collection queries on every message (simple, best for chat)</li>
                                <li style="margin-bottom: 4px;"><strong>Activation Triggers</strong> = Simple keyword matching (WHEN collection activates)</li>
                                <li style="margin-bottom: 4px;"><strong>Conditional Activation</strong> = Advanced conditions (speaker, emotion, time, etc.)</li>
                                <li style="margin-bottom: 4px;"><strong>Chunk Keywords</strong> = HOW chunks are scored/ranked (weighted)</li>
                                <li>All systems work together for best results!</li>
                            </ul>
                        </div>
                    </div>
                    <div class="ragbooks-modal-footer">
                        <button id="ragbooks-save-triggers" class="ragbooks-btn-primary">
                            <i class="fa-solid fa-save"></i> Save Triggers
                        </button>
                        <button id="ragbooks-cancel-triggers" class="ragbooks-btn-secondary">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `);

    $('body').append(overlay);

    // Initialize select2 for triggers input
    const triggersInput = overlay.find('#ragbooks-triggers-input');
    triggersInput.select2({
        tags: true,
        tokenSeparators: [','],
        placeholder: 'e.g., character name, lorebook name, topic keywords',
        width: '100%',
        dropdownParent: overlay.find('.ragbooks-modal-dialog'),
        // Mobile-specific enhancements
        closeOnSelect: false,
        allowClear: true,
        dropdownAutoWidth: true,
        templateResult: function(item) {
            if (item.loading) return item.text;
            const $result = $('<span>').text(item.text);
            $result.css('touch-action', 'manipulation');
            return $result;
        }
    });

    // Add mobile-specific event handling and styling
    if ('ontouchstart' in window) {
        overlay.find('.select2-selection').css('touch-action', 'manipulation');
    }

    // Set initial values from currentKeywords array
    if (metadata.keywords && metadata.keywords.length > 0) {
        triggersInput.val(metadata.keywords).trigger('change');
    }

    // Initialize conditions
    const conditions = metadata.conditions || { enabled: false, mode: 'AND', rules: [] };

    // Render existing conditions
    function renderConditions() {
        const conditionsList = overlay.find('#ragbooks-conditions-list');
        conditionsList.empty();

        if (!conditions.rules || conditions.rules.length === 0) {
            conditionsList.html('<div style="padding: 8px; text-align: center; opacity: 0.6;">No conditions added yet. Click "Add Condition" to create one.</div>');
            return;
        }

        conditions.rules.forEach((rule, index) => {
            const conditionCard = $(`
                <div class="ragbooks-condition-card" style="padding: 8px; background: var(--black30a); border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor);">
                    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                        <select class="ragbooks-condition-type text_pole" data-index="${index}" style="flex: 1;">
                            <option value="keyword" ${rule.type === 'keyword' ? 'selected' : ''}>Keyword Present</option>
                            <option value="speaker" ${rule.type === 'speaker' ? 'selected' : ''}>Last Speaker</option>
                            <option value="messageCount" ${rule.type === 'messageCount' ? 'selected' : ''}>Message Count</option>
                            <option value="chunkActive" ${rule.type === 'chunkActive' ? 'selected' : ''}>Chunk Active</option>
                            <option value="timeOfDay" ${rule.type === 'timeOfDay' ? 'selected' : ''}>Time of Day</option>
                            <option value="emotion" ${rule.type === 'emotion' ? 'selected' : ''}>Detected Emotion</option>
                            <option value="location" ${rule.type === 'location' ? 'selected' : ''}>Location</option>
                            <option value="characterPresent" ${rule.type === 'characterPresent' ? 'selected' : ''}>Character Present</option>
                            <option value="storyBeat" ${rule.type === 'storyBeat' ? 'selected' : ''}>Story Beat</option>
                            <option value="randomChance" ${rule.type === 'randomChance' ? 'selected' : ''}>Random Chance</option>
                        </select>
                        <button class="ragbooks-remove-condition menu_button" data-index="${index}" style="padding: 6px 12px;" title="Remove condition">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <label style="display: flex; align-items: center; gap: 4px; font-size: 0.9em;">
                            <input type="checkbox" class="ragbooks-condition-negated" data-index="${index}" ${rule.negated ? 'checked' : ''}>
                            <span>Negate (NOT)</span>
                        </label>
                        <input type="text" class="ragbooks-condition-value text_pole" data-index="${index}" value="${rule.value || ''}" placeholder="Value..." style="flex: 1;">
                    </div>
                </div>
            `);
            conditionsList.append(conditionCard);
        });

        // Bind condition change handlers
        conditionsList.find('.ragbooks-condition-type').on('change', function() {
            const index = $(this).data('index');
            conditions.rules[index].type = $(this).val();
        });

        conditionsList.find('.ragbooks-condition-value').on('input', function() {
            const index = $(this).data('index');
            conditions.rules[index].value = $(this).val();
        });

        conditionsList.find('.ragbooks-condition-negated').on('change', function() {
            const index = $(this).data('index');
            conditions.rules[index].negated = $(this).is(':checked');
        });

        conditionsList.find('.ragbooks-remove-condition').on('click', function() {
            const index = $(this).data('index');
            conditions.rules.splice(index, 1);
            renderConditions();
        });
    }

    renderConditions();

    // Toggle conditionals section
    overlay.find('#ragbooks-conditionals-enabled').on('change', function() {
        const enabled = $(this).is(':checked');
        overlay.find('#ragbooks-conditionals-section').toggle(enabled);
        conditions.enabled = enabled;
    });

    // Add condition button
    overlay.find('#ragbooks-add-condition').on('click', function() {
        conditions.rules.push({
            type: 'keyword',
            value: '',
            negated: false
        });
        renderConditions();
    });

    // Condition mode change
    overlay.find('#ragbooks-condition-mode').on('change', function() {
        conditions.mode = $(this).val();
    });

    // Bind events
    overlay.find('#ragbooks-save-triggers').on('click', function() {
        const newKeywords = triggersInput.val() || [];
        const alwaysActive = $('#ragbooks-always-active').is(':checked');

        // Update metadata
        if (!ragState.collectionMetadata) ragState.collectionMetadata = {};
        if (!ragState.collectionMetadata[collectionId]) {
            ragState.collectionMetadata[collectionId] = {
                sourceName: sourceData.name,
                sourceType: sourceData.type,
                createdAt: Date.now()
            };
        }

        ragState.collectionMetadata[collectionId].keywords = newKeywords;
        ragState.collectionMetadata[collectionId].alwaysActive = alwaysActive;
        ragState.collectionMetadata[collectionId].conditions = conditions;
        ragState.collectionMetadata[collectionId].lastModified = Date.now();

        saveSettingsDebounced();
        triggersInput.select2('destroy');
        overlay.remove();
        renderCollections();
        toastr.success('Activation triggers updated!');
    });

    overlay.find('#ragbooks-cancel-triggers').on('click', function() {
        triggersInput.select2('destroy');
        overlay.remove();
    });

    // Close on backdrop click
    overlay.on('click', function(e) {
        if ($(e.target).hasClass('ragbooks-modal-overlay')) {
            triggersInput.select2('destroy');
            overlay.remove();
        }
    });
}

/**
 * Toggle collection active/paused state (scope-aware)
 */
function toggleCollection(collectionId) {
    const ragState = ensureRagState();
    const metadata = ragState.collectionMetadata?.[collectionId];

    if (!metadata) return;

    const scope = metadata.scope || 'global';
    const scopeIdentifier = metadata.scopeIdentifier;

    // Get source from appropriate scope
    let sourceData = null;
    if (scope === 'character' && scopeIdentifier) {
        sourceData = ragState.scopedSources?.character?.[scopeIdentifier]?.[collectionId];
    } else if (scope === 'chat' && scopeIdentifier) {
        sourceData = ragState.scopedSources?.chat?.[scopeIdentifier]?.[collectionId];
    } else {
        sourceData = ragState.scopedSources?.global?.[collectionId];
    }

    // Fallback to flat sources if not found in scoped
    if (!sourceData && ragState.sources?.[collectionId]) {
        sourceData = ragState.sources[collectionId];
    }

    if (!sourceData) return;

    // Toggle active state
    sourceData.active = !sourceData.active;

    // Save back to scoped sources
    saveScopedSource(collectionId, sourceData);

    // Also update flat sources for backward compatibility
    if (ragState.sources?.[collectionId]) {
        ragState.sources[collectionId].active = sourceData.active;
    }

    saveSettingsDebounced();
    renderCollections();

    const status = sourceData.active ? 'activated' : 'paused';
    toastr.success(`Collection ${status}`);
}

// ===========================================================================
// CHUNK VIEWER
// ============================================================================

let currentViewingChunks = {};
let currentViewingCollection = null;
let hasUnsavedChunkChanges = false;

// Helper functions for chunk viewer
function getCurrentCollectionId() {
    return currentViewingCollection;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Preview collection chunks
 */
function previewCollection(collectionId) {
    try {
        console.log('[Visualizer] Opening collection:', collectionId);
        const chunks = getChunksFromLibrary(collectionId);

        if (!chunks) {
            console.error('[Visualizer] Collection not found in any scope');
            toastr.warning('Collection not found. It may have been deleted or moved.');
            return;
        }

        const chunkCount = Object.keys(chunks).length;
        console.log('[Visualizer] Loaded chunks:', chunkCount);

        if (chunkCount === 0) {
            toastr.warning('No chunks found in this collection. Try re-vectorizing.');
            return;
        }

        openChunkViewer(collectionId, chunks);
    } catch (error) {
        console.error('[Visualizer] Failed to preview collection:', error);
        toastr.error('Failed to open visualizer: ' + error.message);
    }
}

function openChunkViewer(collectionId, chunks) {
    const settings = getRAGSettings();
    const sourceData = settings.sources[collectionId];
    if (!sourceData) {
        toastr.error('Collection not found');
        return;
    }

    currentViewingCollection = collectionId;
    currentViewingChunks = JSON.parse(JSON.stringify(chunks));

    // Initialize missing 'name' field for backwards compatibility
    let initializedCount = 0;
    Object.values(currentViewingChunks).forEach(chunk => {
        if (!chunk.name || chunk.name.trim().length === 0) {
            // DEFENSIVE FALLBACK: Always ensure name has a value
            // Priority: topic > section > first sentence of text > "Untitled Chunk"
            chunk.name = chunk.topic ||
                         chunk.section ||
                         (chunk.text ? getFirstSentenceTitle(chunk.text, 80) : '') ||
                         'Untitled Chunk';
            initializedCount++;
        }

        // DEFENSIVE FALLBACK: Ensure summaryVectors is always an array
        if (!Array.isArray(chunk.summaryVectors)) {
            chunk.summaryVectors = chunk.summaryVectors ? [chunk.summaryVectors] : [];
        }

        // DEFENSIVE FALLBACK: Ensure keywords is always an array
        if (!Array.isArray(chunk.keywords)) {
            chunk.keywords = [];
        }
    });

    // DEBUG: Log initialization
    const firstChunk = Object.values(currentViewingChunks)[0];
    console.log('[openChunkViewer] Initialized names:', {
        totalChunks: Object.keys(currentViewingChunks).length,
        initializedCount,
        'firstChunk.name': firstChunk?.name,
        'firstChunk.topic': firstChunk?.topic,
        'firstChunk.section': firstChunk?.section
    });

    hasUnsavedChunkChanges = false;

    // Update modal title
    $('#ragbooks_modal_title').html(`<i class="fa-solid fa-cube"></i> ${sourceData.name}`);
    $('#ragbooks_modal_subtitle').text(`${Object.keys(chunks).length} chunks`);

    // Show tabs for all collections (Chunks + Groups universal, Scenes chat-only)
    const isChatCollection = sourceData.type === 'chat' || collectionId.includes('_chat_');
    $('#ragbooks_viewer_tabs').show();

    if (isChatCollection) {
        // Chat collections: Show all 3 tabs (Chunks, Scenes, Groups)
        $('.ragbooks-viewer-tab[data-tab="scenes"]').show();
        renderSceneCards(); // Populate scenes tab
    } else {
        // Non-chat collections: Show Chunks + Groups, hide Scenes
        $('.ragbooks-viewer-tab[data-tab="scenes"]').hide();
        $('#ragbooks_scenes_container').hide();

        // Ensure we start on chunks tab for non-chat
        $('.ragbooks-viewer-tab').removeClass('active');
        $('.ragbooks-viewer-tab[data-tab="chunks"]').addClass('active');
        $('#ragbooks_chunks_container').show();
        $('#ragbooks_groups_container').hide();
    }

    renderChunkCards(currentViewingChunks);
    bindChunkViewerEvents();

    // Show modal
    $('#ragbooks_chunk_viewer_modal').addClass('is-visible').fadeIn(200, function() {
        $(this).css('display', 'flex');
    });
    $('body').css('overflow', 'hidden');
}

function closeChunkViewer() {
    if (hasUnsavedChunkChanges) {
        if (!confirm('You have unsaved changes. Close anyway?')) {
            return;
        }
    }

    $('#ragbooks_chunk_viewer_modal').fadeOut(200, function() {
        $(this).removeClass('is-visible');
    });
    $('body').css('overflow', '');

    currentViewingCollection = null;
    currentViewingChunks = {};
    hasUnsavedChunkChanges = false;
}

async function saveChunkViewerChanges() {
    if (!currentViewingCollection) {
        toastr.error('No collection to save', 'RAGBooks');
        return;
    }

    if (!hasUnsavedChunkChanges) {
        toastr.info('No changes to save', 'RAGBooks');
        return;
    }

    try {
        // Show saving indicator
        toastr.info('Saving changes...', 'RAGBooks', { timeOut: 0, extendedTimeOut: 0 });

        // Log chunks before save for debugging
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('💾 [Chunk Save] Starting save process...');
        console.log(`   Collection: ${currentViewingCollection}`);
        console.log(`   Chunks to save: ${Object.keys(currentViewingChunks).length}`);

        const sampleChunk = Object.values(currentViewingChunks)[0];
        if (sampleChunk) {
            console.log('[Chunk Save] Sample chunk BEFORE save:', {
                hash: sampleChunk.hash,
                name: sampleChunk.name,
                keywordCount: sampleChunk.keywords?.length || 0,
                text: sampleChunk.text?.substring(0, 50) + '...'
            });
        }

        // Bidirectional sync: Update scene objects from chunk changes
        const scenes = getScenes();
        if (scenes && scenes.length > 0) {
            let scenesSynced = 0;
            Object.values(currentViewingChunks).forEach(chunk => {
                if (chunk.metadata?.sceneIndex !== undefined) {
                    const scene = scenes[chunk.metadata.sceneIndex];
                    if (scene) {
                        // Sync summary
                        if (chunk.summary !== scene.summary) {
                            scene.summary = chunk.summary || '';
                            scenesSynced++;
                        }
                        // Sync keywords
                        const chunkKeywords = chunk.keywords || [];
                        const sceneKeywords = scene.keywords || [];
                        if (JSON.stringify(chunkKeywords) !== JSON.stringify(sceneKeywords)) {
                            scene.keywords = [...chunkKeywords];
                            scenesSynced++;
                        }
                    }
                }
            });

            if (scenesSynced > 0) {
                saveScenes();
                console.log(`🔄 Synced ${scenesSynced} chunk changes back to scene objects`);
            }
        }

        // Call the update function (this will save to extension_settings)
        await updateChunksInLibrary(currentViewingCollection, currentViewingChunks);

        // Mark as saved
        hasUnsavedChunkChanges = false;

        // VERIFICATION: Confirm save was successful
        console.log('🔍 [Chunk Save] Verifying save...');
        const library = getContextualLibrary();
        const savedChunks = library[currentViewingCollection];

        if (!savedChunks) {
            throw new Error('Verification FAILED - collection not found in library after save!');
        }

        const sampleHash = Object.keys(currentViewingChunks)[0];
        const verifiedChunk = savedChunks[sampleHash];

        if (!verifiedChunk) {
            throw new Error(`Verification FAILED - chunk ${sampleHash} not found in library after save!`);
        }

        console.log('[Chunk Save] Sample chunk AFTER save (verified):', {
            hash: sampleHash,
            name: verifiedChunk.name,
            keywordCount: verifiedChunk.keywords?.length || 0,
            text: verifiedChunk.text?.substring(0, 50) + '...'
        });

        console.log('✅ [Chunk Save] Save successful and verified!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Clear the "saving" toastr and show success
        toastr.clear();
        toastr.success(`Saved ${Object.keys(currentViewingChunks).length} chunks successfully`, 'RAGBooks', { timeOut: 2000 });

    } catch (error) {
        console.error('❌ [Chunk Save] Save failed:', error);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Clear the "saving" toastr and show error
        toastr.clear();
        toastr.error(`Failed to save chunks: ${error.message}`, 'RAGBooks', { timeOut: 5000 });

        // Don't mark as saved if there was an error
        throw error;
    }
}

function renderChunkCards(chunks, searchTerm = '') {
    const chunkArray = Object.entries(chunks || {}).map(([hash, data]) => ({
        hash,
        ...data
    }));

    // Filter by search term
    const normalizedSearch = (searchTerm || '').toLowerCase().trim();
    const filtered = normalizedSearch
        ? chunkArray.filter(chunk => {
            const text = (chunk.text || '').toLowerCase();
            const keywords = (chunk.keywords || []).map(k => k.toLowerCase());
            return text.includes(normalizedSearch) || keywords.some(k => k.includes(normalizedSearch));
        })
        : chunkArray;

    // Calculate stats
    const totalChars = filtered.reduce((sum, c) => sum + (c.text?.length || 0), 0);
    const avgChars = filtered.length ? Math.round(totalChars / filtered.length) : 0;

    // Update stats
    $('#ragbooks_chunk_stats').html(`
        <div class="chunk-stat">
            <i class="fa-solid fa-layer-group"></i>
            <span class="chunk-stat__label">Showing</span>
            <span class="chunk-stat__value">${filtered.length}</span>
            <span class="chunk-stat__divider">/</span>
            <span class="chunk-stat__value">${chunkArray.length}</span>
        </div>
        <div class="chunk-stat">
            <i class="fa-solid fa-ruler-horizontal"></i>
            <span class="chunk-stat__label">Average</span>
            <span class="chunk-stat__value">${avgChars} chars</span>
        </div>
    `);

    const container = $('#ragbooks_chunks_container');
    if (!filtered.length) {
        container.html('<div class="chunk-empty-state"><i class="fa-solid fa-eye-slash"></i><p>No chunks match your search</p></div>');
        return;
    }

    const html = filtered.map(chunk => renderChunkCard(chunk)).join('');
    container.html(html);

    // REMOVED: Eager initialization caused race conditions with lazy initialization
    // Select2 will be initialized lazily when chunk cards are expanded (see chunk card click handler)
    // This prevents keyword loss when cards are collapsed/expanded or when search filters change
}

// Helper functions for condition rendering
function generateConditionValueInput(hash, idx, rule) {
    switch (rule.type) {
        case 'keyword':
            return `<input type="text" class="text_pole ragbooks-condition-value" data-hash="${hash}" data-idx="${idx}" value="${escapeHtml(rule.value || '')}" placeholder="keyword or phrase" style="width: 100%;">`;

        case 'speaker':
            return `<input type="text" class="text_pole ragbooks-condition-value" data-hash="${hash}" data-idx="${idx}" value="${escapeHtml(rule.value || '')}" placeholder="character name or {{user}}" style="width: 100%;">`;

        case 'messageCount':
            return `<input type="number" class="text_pole ragbooks-condition-value" data-hash="${hash}" data-idx="${idx}" value="${rule.value || 10}" min="1" placeholder="10" style="width: 100%;">`;

        case 'chunkActive':
            return `<input type="text" class="text_pole ragbooks-condition-value" data-hash="${hash}" data-idx="${idx}" value="${escapeHtml(rule.value || '')}" placeholder="chunk hash or title" style="width: 100%;">`;

        case 'timeOfDay':
            return `
                <div style="display: flex; gap: 4px; align-items: center;">
                    <input type="time" class="text_pole ragbooks-condition-value-start" data-hash="${hash}" data-idx="${idx}" value="${rule.value?.split('-')[0] || '00:00'}" style="flex: 1;">
                    <span>to</span>
                    <input type="time" class="text_pole ragbooks-condition-value-end" data-hash="${hash}" data-idx="${idx}" value="${rule.value?.split('-')[1] || '23:59'}" style="flex: 1;">
                </div>
            `;

        case 'emotion':
            return `
                <select class="text_pole ragbooks-condition-value" data-hash="${hash}" data-idx="${idx}" style="width: 100%;">
                    <option value="happy" ${rule.value === 'happy' ? 'selected' : ''}>Happy/Joy</option>
                    <option value="sad" ${rule.value === 'sad' ? 'selected' : ''}>Sad/Sorrow</option>
                    <option value="angry" ${rule.value === 'angry' ? 'selected' : ''}>Angry/Rage</option>
                    <option value="fear" ${rule.value === 'fear' ? 'selected' : ''}>Fear/Anxiety</option>
                    <option value="love" ${rule.value === 'love' ? 'selected' : ''}>Love/Affection</option>
                    <option value="surprise" ${rule.value === 'surprise' ? 'selected' : ''}>Surprise/Shock</option>
                </select>
            `;

        case 'location':
            return `<input type="text" class="text_pole ragbooks-condition-value" data-hash="${hash}" data-idx="${idx}" value="${escapeHtml(rule.value || '')}" placeholder="location name or {{location}}" style="width: 100%;">`;

        case 'characterPresent':
            return `<input type="text" class="text_pole ragbooks-condition-value" data-hash="${hash}" data-idx="${idx}" value="${escapeHtml(rule.value || '')}" placeholder="character name" style="width: 100%;">`;

        case 'storyBeat':
            return `<input type="text" class="text_pole ragbooks-condition-value" data-hash="${hash}" data-idx="${idx}" value="${escapeHtml(rule.value || '')}" placeholder="beat name or {{storyphase}}" style="width: 100%;">`;

        case 'randomChance':
            return `
                <div style="display: flex; gap: 4px; align-items: center;">
                    <input type="number" class="text_pole ragbooks-condition-value" data-hash="${hash}" data-idx="${idx}" value="${rule.value || 50}" min="0" max="100" style="width: 80px;">
                    <span>% chance</span>
                </div>
            `;

        default:
            return `<input type="text" class="text_pole ragbooks-condition-value" data-hash="${hash}" data-idx="${idx}" value="${escapeHtml(rule.value || '')}" style="width: 100%;">`;
    }
}

function generateConditionRowHTML(hash, rule, idx) {
    return `
        <div class="ragbooks-condition-row" data-hash="${hash}" data-idx="${idx}" style="display: flex; gap: 6px; margin-bottom: 6px; align-items: flex-start; padding: 8px; background: var(--SmartThemeBlurTintColor); border-radius: 4px;">
            <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
                <select class="text_pole ragbooks-condition-type" data-hash="${hash}" data-idx="${idx}" style="width: 100%;">
                    <option value="keyword" ${rule.type === 'keyword' ? 'selected' : ''}>Keyword in recent messages</option>
                    <option value="speaker" ${rule.type === 'speaker' ? 'selected' : ''}>Speaker is</option>
                    <option value="messageCount" ${rule.type === 'messageCount' ? 'selected' : ''}>Message count >=</option>
                    <option value="chunkActive" ${rule.type === 'chunkActive' ? 'selected' : ''}>Another chunk is active</option>
                    <option value="timeOfDay" ${rule.type === 'timeOfDay' ? 'selected' : ''}>Time of day (real-world)</option>
                    <option value="emotion" ${rule.type === 'emotion' ? 'selected' : ''}>Emotion/Sentiment</option>
                    <option value="location" ${rule.type === 'location' ? 'selected' : ''}>Location matches</option>
                    <option value="characterPresent" ${rule.type === 'characterPresent' ? 'selected' : ''}>Character present</option>
                    <option value="storyBeat" ${rule.type === 'storyBeat' ? 'selected' : ''}>Story beat/phase</option>
                    <option value="randomChance" ${rule.type === 'randomChance' ? 'selected' : ''}>Random chance %</option>
                </select>

                <div class="ragbooks-condition-value-container" data-hash="${hash}" data-idx="${idx}">
                    ${generateConditionValueInput(hash, idx, rule)}
                </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
                <label style="display: flex; align-items: center; gap: 2px; margin: 0; font-size: 11px; white-space: nowrap;">
                    <input type="checkbox"
                           class="ragbooks-condition-negate"
                           data-hash="${hash}"
                           data-idx="${idx}"
                           ${rule.negate ? 'checked' : ''}>
                    <span>NOT</span>
                </label>
                <button type="button" class="menu_button ragbooks-condition-remove" data-hash="${hash}" data-idx="${idx}" style="padding: 4px 8px;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    `;
}

function refreshConditionsList(hash, chunk) {
    const $list = $(`.ragbooks-conditions-list[data-hash="${hash}"]`);
    $list.empty();
    (chunk.conditions?.rules || []).forEach((rule, idx) => {
        $list.append(generateConditionRowHTML(hash, rule, idx));
    });
}

function renderChunkCard(chunk) {
    const hash = chunk.hash;
    const keywords = chunk.keywords || [];
    const systemKeywords = chunk.systemKeywords || [];
    const customKeywords = chunk.customKeywords || [];
    const customWeights = chunk.customWeights || {};
    const disabledKeywords = chunk.disabledKeywords || [];
    const chunkLinks = chunk.chunkLinks || [];
    const isDisabled = chunk.disabled || false;

    // Detect if this is a scene chunk
    const isSceneChunk = chunk.metadata?.sceneStart !== undefined;
    const sceneStart = chunk.metadata?.sceneStart;
    const sceneEnd = chunk.metadata?.sceneEnd;
    const sceneTitle = chunk.metadata?.sceneTitle || chunk.section;
    const sceneIndex = chunk.metadata?.sceneIndex;

    // Check if this is an orphaned scene chunk (scene deleted from chat_metadata)
    const isOrphanedScene = isSceneChunk && sceneIndex !== undefined && (() => {
        const scenes = getScenes();
        return !scenes || !scenes[sceneIndex];
    })();

    // Show top 5 keywords in collapsed header
    const topKeywords = keywords.slice(0, 5);
    const remainingCount = Math.max(0, keywords.length - 5);

    const keywordPreview = topKeywords.length > 0
        ? topKeywords.map(k => {
            const weight = customWeights[k] || 100;
            const isCustom = customKeywords.includes(k);
            const isDisabledKw = disabledKeywords.includes(k);
            const tagClass = isCustom ? 'chunk-tag chunk-tag--custom' : 'chunk-tag';
            const disabledTag = isDisabledKw ? ' chunk-tag--disabled' : '';
            return `<span class="${tagClass}${disabledTag}">${k}<sup class="chunk-tag__weight">${weight}</sup></span>`;
        }).join('') + (remainingCount > 0 ? `<span class="chunk-tag__overflow">+${remainingCount} more</span>` : '')
        : '<span class="chunk-keywords-preview empty">No keywords</span>';

    const isExpanded = chunk._expanded || false;
    const chevronClass = isExpanded ? 'fa-circle-chevron-up up' : 'fa-circle-chevron-down down';
    const disabledClass = isDisabled ? 'chunk-disabled' : '';
    const toggleIcon = isDisabled ? 'fa-toggle-off' : 'fa-toggle-on';

    return `
        <div class="world_entry ${disabledClass}" data-hash="${hash}">
            <form class="world_entry_form wi-card-entry">
                <div class="inline-drawer wide100p">
                    <div class="inline-drawer-header gap5px padding0">
                        <span class="drag-handle">&#9776;</span>
                        <div class="gap5px world_entry_thin_controls wide100p alignitemscenter">
                            <div class="inline-drawer-toggle fa-fw fa-solid ${chevronClass} inline-drawer-icon"></div>
                            <div class="flex-container alignitemscenter wide100p flexNoGap">
                                <div class="WIEntryTitleAndStatus flex-container flex1 alignitemscenter">
                                    <div class="flex-container flex1 alignitemscenter">
                                        ${isSceneChunk ? `<span class="ragbooks-scene-badge" title="Scene Chunk" style="margin-right: 6px;"><i class="fa-solid fa-clapperboard"></i></span>` : ''}
                                        ${isOrphanedScene ? `<span class="ragbooks-orphan-badge" title="Scene has been deleted" style="margin-right: 6px; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; background: rgba(231, 76, 60, 0.2); color: #e74c3c; white-space: nowrap;"><i class="fa-solid fa-exclamation-triangle"></i> Scene Deleted</span>` : ''}
                                        <input type="text"
                                               class="text_pole ragbooks-chunk-name margin0"
                                               data-hash="${hash}"
                                               value="${escapeHtml(chunk.name || '')}"
                                               placeholder="Auto-generated if empty"
                                               style="flex: 1; min-width: 100px;">
                                        ${isSceneChunk ? `<small class="ragbooks-scene-range" title="Scene messages" style="margin-left: 8px; white-space: nowrap;">📍 #${sceneStart} - #${sceneEnd}</small>` : ''}
                                    </div>
                                </div>
                                <div class="chunk-header-right">
                                    <i class="fa-solid ${toggleIcon} ragbooks-chunk-enabled-toggle interactable"
                                        data-hash="${hash}"
                                        title="Toggle chunk enabled/disabled"></i>
                                    <div class="chunk-keywords-preview">${keywordPreview}</div>
                                    <div class="chunk-metadata-badges">
                                        <span class="chunk-meta-badge">${chunk.text?.length || 0} chars</span>
                                        ${isSceneChunk ? `<span class="chunk-meta-badge ragbooks-scene-meta-badge">Scene ${sceneIndex !== undefined ? sceneIndex + 1 : ''}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="inline-drawer-content inline-drawer-outlet wide100p" style="display: ${isExpanded ? 'block' : 'none'};">
                        <div class="world_entry_edit">
                            <!-- Primary Keywords Section (SELECT2 - supports keywords AND regexes) -->
                            <div class="flex-container wide100p alignitemscenter">
                                <div class="world_entry_form_control keyprimary flex1">
                                    <small class="textAlignCenter">Primary Keywords</small>
                                    <select class="keyprimaryselect keyselect ragbooks-chunk-keywords" name="key" data-hash="${hash}" placeholder="Keywords or Regexes" multiple="multiple"></select>
                                    <textarea class="text_pole keyprimarytextpole ragbooks-chunk-keywords-plaintext" name="key" data-hash="${hash}" rows="2" placeholder="Comma separated list" style="display: none;"></textarea>
                                    <button type="button" class="switch_input_type_icon" data-hash="${hash}" tabindex="-1" title="Switch to plaintext mode" data-icon-on="✨" data-icon-off="⌨️" data-tooltip-on="Switch to fancy mode" data-tooltip-off="Switch to plaintext mode">⌨️</button>
                                </div>
                            </div>

                            <!-- Content Section -->
                            <div class="world_entry_thin_controls flex-container flexFlowColumn">
                                <div class="world_entry_form_control flex1">
                                    <label><small>Content</small></label>
                                    <textarea class="text_pole autoSetHeight ragbooks-chunk-text-edit"
                                        data-hash="${hash}"
                                        style="resize: vertical; min-height: 100px;">${chunk.text || ''}</textarea>
                                </div>
                            </div>

                            ${isSceneChunk ? `
                            <!-- Scene Vectorization Controls -->
                            <div class="ragbooks-setting-item" style="margin-bottom: 12px; padding: 10px; background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 6px;">
                                <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 12px; font-weight: 600; text-transform: uppercase; opacity: 0.9;">
                                    <i class="fa-solid fa-vector-square"></i> Scene Vectorization
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; cursor: pointer;">
                                    <input type="checkbox"
                                           class="ragbooks-scene-summary-vector-chunk"
                                           data-hash="${hash}"
                                           ${chunk.summaryVector !== false ? 'checked' : ''}>
                                    <span>Create separate vector for scene summary</span>
                                </label>
                                <div class="ragbooks-help-text" style="margin-top: 6px;">When enabled, the scene summary will be vectorized separately for semantic search. Matching this summary will inject the full scene content.</div>
                            </div>
                            ` : ''}

                            <!-- Summary Vectors (Searchable, Vectorized) - Universal Feature -->
                            <div class="ragbooks-setting-item ragbooks-summary-vectors-section"
                                 data-hash="${hash}"
                                 style="margin-bottom: 12px;">
                                <label style="display: block; margin-bottom: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.7;">
                                    <i class="fa-solid fa-vector-square"></i> Summary Vectors (Searchable)
                                </label>
                                <select class="ragbooks-summary-vectors-select"
                                        data-hash="${hash}"
                                        placeholder="Add searchable summaries (any length)..."
                                        multiple="multiple"></select>
                                <div class="ragbooks-help-text">
                                    Each tag creates a separate searchable vector. Matching any of these will pull the full chunk content. Add as many or as few as you want - each can be any length (word, phrase, sentence, or paragraph).
                                </div>
                            </div>

                            <!-- Scoring & Activation Section (Horizontal Split) -->
                            <div class="ragbooks-horizontal-split" style="margin-bottom: 12px;">
                                <!-- LEFT: Importance -->
                                <div class="ragbooks-split-left ragbooks-setting-item">
                                    <label style="display: block; margin-bottom: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.7;">
                                        <i class="fa-solid fa-scale-balanced"></i> Importance
                                    </label>
                                    <div style="display: flex; align-items: center; gap: 10px;">
                                        <input type="range"
                                               class="ragbooks-importance-slider"
                                               data-hash="${hash}"
                                               min="0"
                                               max="200"
                                               value="${chunk.importance || 100}"
                                               style="flex: 1;">
                                        <span class="ragbooks-importance-value" data-hash="${hash}" style="min-width: 50px; font-weight: 600; color: var(--ragbooks-accent-primary);">
                                            ${chunk.importance || 100}%
                                        </span>
                                    </div>
                                    <div class="ragbooks-help-text">
                                        Score multiplier (0-200%)
                                    </div>
                                </div>

                                <!-- RIGHT: Conditional Activation -->
                                <div class="ragbooks-split-right ragbooks-setting-item">
                                    <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                                        <input type="checkbox"
                                               class="ragbooks-conditions-enabled"
                                               data-hash="${hash}"
                                               ${chunk.conditions?.enabled ? 'checked' : ''}>
                                        <span style="font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.7;">
                                            <i class="fa-solid fa-filter"></i> Conditional Activation
                                        </span>
                                        <i class="fa-solid fa-circle-question ragbooks-condition-help-icon"
                                           title="Only retrieve this chunk when conditions match (e.g., only when 'dragon' keyword appears in recent messages)"
                                           style="opacity: 0.5; cursor: help; font-size: 11px;"></i>
                                    </label>
                                    <div class="ragbooks-help-text" style="margin-bottom: 4px;">
                                        Rules-based retrieval filtering
                                        ${chunk.conditions?.rules?.length > 0 ? `<span class="ragbooks-condition-count">(${chunk.conditions.rules.length} rules)</span>` : ''}
                                    </div>
                                </div>
                            </div>

                            <!-- Conditions Panel (Full Width Below) -->
                            ${chunk.conditions?.enabled ? `
                            <div class="ragbooks-conditions-panel" data-hash="${hash}" style="margin-bottom: 12px; padding: 12px; background: var(--black10a); border-radius: 6px;">
                                <div style="margin-bottom: 8px;">
                                    <label style="font-size: 11px; opacity: 0.7; text-transform: uppercase;">Condition Mode</label>
                                    <select class="text_pole ragbooks-conditions-mode" data-hash="${hash}" style="width: 100%; padding: 6px;">
                                        <option value="AND" ${chunk.conditions?.mode === 'AND' ? 'selected' : ''}>ALL conditions must match (AND)</option>
                                        <option value="OR" ${chunk.conditions?.mode === 'OR' ? 'selected' : ''}>ANY condition can match (OR)</option>
                                    </select>
                                </div>

                                <div class="ragbooks-conditions-list" data-hash="${hash}">
                                    ${(chunk.conditions?.rules || []).map((rule, idx) => generateConditionRowHTML(hash, rule, idx)).join('')}
                                </div>

                                <button type="button" class="menu_button ragbooks-condition-add" data-hash="${hash}" style="width: 100%; margin-top: 6px;">
                                    <i class="fa-solid fa-plus"></i> Add Condition
                                </button>
                            </div>
                            ` : ''}

                            <!-- Chunk Grouping Section -->
                            <div class="ragbooks-unified-groups-section" style="margin-bottom: 12px; padding: 12px; background: var(--black10a); border-radius: 6px;">
                                <label style="display: block; margin-bottom: 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.7;">
                                    <i class="fa-solid fa-layer-group"></i> Chunk Grouping
                                </label>

                                <!-- Merged: Single Group Name Field -->
                                <div style="margin-bottom: 8px;">
                                    <label style="font-size: 11px; opacity: 0.7; display: block; margin-bottom: 4px;">Group Name</label>
                                    <input type="text"
                                           class="text_pole ragbooks-group-name"
                                           data-hash="${hash}"
                                           value="${escapeHtml(chunk.chunkGroup?.name || '')}"
                                           placeholder="e.g., 'Combat Abilities', 'character_intro'"
                                           style="width: 100%;">
                                </div>

                                <!-- Row 2: Group Keywords (Full Width, shows when group name exists) -->
                                <div class="ragbooks-group-keywords-section" data-hash="${hash}" style="display: ${chunk.chunkGroup?.name ? 'block' : 'none'}; margin-bottom: 8px;">
                                    <label style="font-size: 11px; opacity: 0.7; display: block; margin-bottom: 4px;">Group Keywords (trigger boost for all members)</label>
                                    <input type="text"
                                           class="text_pole ragbooks-group-keywords"
                                           data-hash="${hash}"
                                           value="${escapeHtml((chunk.chunkGroup?.groupKeywords || []).join(', '))}"
                                           placeholder="combat, fight, battle, attack"
                                           style="width: 100%;">
                                </div>

                                <!-- Row 3: Checkboxes (Horizontal) -->
                                <div class="ragbooks-horizontal-split" style="align-items: center;">
                                    <label style="display: flex; align-items: center; gap: 4px; margin: 0; font-size: 12px;">
                                        <input type="checkbox"
                                               class="ragbooks-group-required"
                                               data-hash="${hash}"
                                               ${chunk.chunkGroup?.requiresGroupMember ? 'checked' : ''}>
                                        <span>Require group member</span>
                                    </label>
                                    <label style="display: flex; align-items: center; gap: 4px; margin: 0; font-size: 12px;">
                                        <input type="checkbox"
                                               class="ragbooks-inclusion-prioritize"
                                               data-hash="${hash}"
                                               ${chunk.inclusionPrioritize ? 'checked' : ''}>
                                        <span><i class="fa-solid fa-star"></i> Prioritize inclusion</span>
                                    </label>
                                </div>

                                <div class="ragbooks-help-text" style="margin-top: 8px;">
                                    <strong>Chunk Group:</strong> Boost together when keywords match. <strong>Inclusion Group:</strong> Mutual exclusion (only one activates).
                                </div>
                            </div>

                            <!-- Advanced Processing Section -->
                            <div class="ragbooks-setting-item" style="margin-bottom: 12px;">
                                <label style="display: block; margin-bottom: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.7;">
                                    <i class="fa-solid fa-wand-magic-sparkles"></i> Advanced Processing
                                </label>

                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                    <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; margin: 0;">
                                        <input type="checkbox"
                                               class="ragbooks-enable-chunk-summary"
                                               data-hash="${hash}"
                                               ${chunk.metadata?.enableSummary ? 'checked' : ''}>
                                        <span>Enable Summarization</span>
                                    </label>
                                    <button type="button"
                                            class="menu_button ragbooks-generate-summary-now"
                                            data-hash="${hash}"
                                            style="padding: 4px 8px; font-size: 11px;"
                                            title="Generate AI summary for this chunk now">
                                        <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Now
                                    </button>
                                </div>

                                <div class="ragbooks-summary-style-section" data-hash="${hash}" style="display: ${chunk.metadata?.enableSummary ? 'block' : 'none'}; margin-left: 20px; margin-bottom: 6px;">
                                    <label style="font-size: 11px; opacity: 0.7;">Summary Style</label>
                                    <select class="text_pole ragbooks-summary-style" data-hash="${hash}" style="width: 100%;">
                                        <option value="concise" ${chunk.metadata?.summaryStyle === 'concise' ? 'selected' : ''}>Concise (1-2 sentences)</option>
                                        <option value="detailed" ${chunk.metadata?.summaryStyle === 'detailed' ? 'selected' : ''}>Detailed (paragraph)</option>
                                        <option value="keywords" ${chunk.metadata?.summaryStyle === 'keywords' ? 'selected' : ''}>Keywords Only</option>
                                        <option value="extractive" ${chunk.metadata?.summaryStyle === 'extractive' ? 'selected' : ''}>Extractive (key sentences)</option>
                                    </select>
                                </div>

                                <label style="display: flex; align-items: center; gap: 4px; font-size: 12px;">
                                    <input type="checkbox"
                                           class="ragbooks-enable-chunk-metadata"
                                           data-hash="${hash}"
                                           ${chunk.metadata?.enableMetadata ? 'checked' : ''}>
                                    <span>Enable Metadata Extraction (entities, topics)</span>
                                </label>

                                <div class="ragbooks-help-text">
                                    Per-chunk processing overrides (applied when re-vectorizing content)
                                </div>
                            </div>

                            <!-- Linked Chunks Panel -->
                            <div class="inline-drawer wide100p chunk-linked-panel">
                                <div class="inline-drawer-toggle inline-drawer-header chunk-linked-header">
                                    <div class="chunk-panel-title">
                                        <i class="fa-solid fa-link"></i>
                                        <span>Linked Chunks</span>
                                        <span class="chunk-panel-count">${chunkLinks.length}</span>
                                    </div>
                                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                                </div>
                                <div class="inline-drawer-content chunk-linked-content">
                                    ${Object.keys(currentViewingChunks).length <= 1 ? `
                                        <div class="chunk-linked-empty">
                                            <i class="fa-solid fa-unlink"></i>
                                            <p>No other chunks available to link</p>
                                        </div>
                                    ` : `
                                        <div class="chunk-linked-list">
                                            ${Object.entries(currentViewingChunks)
                                                .filter(([h]) => h !== hash)
                                                .map(([h, c]) => {
                                                    const isLinked = chunkLinks.includes(h);
                                                    const linkTitle = c.section || c.comment || 'Untitled Chunk';
                                                    return `
                                                        <label class="chunk-linked-item">
                                                            <input type="checkbox"
                                                                class="ragbooks-chunk-link-checkbox"
                                                                data-hash="${hash}"
                                                                data-target="${h}"
                                                                ${isLinked ? 'checked' : ''}>
                                                            <span class="chunk-linked-title">${linkTitle}</span>
                                                            ${isLinked ? '<i class="fa-solid fa-check chunk-linked-check"></i>' : ''}
                                                        </label>
                                                    `;
                                                }).join('')}
                                        </div>
                                        <div class="chunk-linked-help">
                                            <i class="fa-solid fa-info-circle"></i>
                                            <small>Linked chunks will be injected together when this chunk activates</small>
                                        </div>
                                    `}
                                </div>
                            </div>

                            <!-- Actions -->
                            <div class="chunk-actions-row">
                                <button type="button"
                                    class="ragbooks-chunk-delete-btn menu_button redWarningBG"
                                    data-hash="${hash}">
                                    <i class="fa-solid fa-trash"></i> Delete Chunk
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    `;
}

// ========================================================================
// SCENE TAB RENDERING
// ========================================================================

function renderSceneCards() {
    const scenes = getScenes();
    const container = $('#ragbooks_scenes_container');

    if (!scenes || scenes.length === 0) {
        container.html(`
            <div class="ragbooks-empty-state">
                <i class="fa-solid fa-bookmark"></i>
                <p>No scenes marked</p>
                <p>Click the green bookmark flag button in any message to start a scene</p>
                <p>Click the red bookmark flag button to end it</p>
            </div>
        `);
        return;
    }

    // Helper to escape HTML
    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    // Helper to check if scene has been vectorized
    const isSceneVectorized = (sceneIndex) => {
        if (!currentViewingCollection) return false;
        const library = getContextualLibrary();
        if (!library[currentViewingCollection]) return false;

        return Object.values(library[currentViewingCollection]).some(chunk =>
            chunk.metadata?.sceneIndex === sceneIndex
        );
    };

    // Helper to get scene text preview
    const getScenePreview = (scene) => {
        if (scene.end === null) return '(Open scene - no preview)';
        const messages = chat.slice(scene.start, scene.end + 1);
        if (!messages || messages.length === 0) return '(No messages found)';
        const text = messages.map(m => m.mes).join(' ');
        return text.substring(0, 150) + (text.length > 150 ? '...' : '');
    };

    const html = scenes.map((scene, idx) => {
        const vectorized = isSceneVectorized(idx);
        return `
        <div class="ragbooks-scene-card" data-scene-idx="${idx}">
            <!-- Scene Header (Collapsible) -->
            <div class="ragbooks-scene-card__header ragbooks-scene-card__header-collapsible">
                <i class="fa-solid fa-chevron-down ragbooks-collapse-icon" style="margin-right: 8px; transition: transform 0.2s;"></i>
                <div class="ragbooks-scene-card__title-line">
                    <strong>Scene ${idx + 1}</strong>
                    <span class="ragbooks-scene-card__range">
                        (#${scene.start} - ${scene.end !== null ? '#' + scene.end : 'open'})
                    </span>
                    <span class="ragbooks-scene-status-badge ${vectorized ? 'vectorized' : 'not-vectorized'}"
                          style="margin-left: 8px; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; ${vectorized ? 'background: rgba(46, 204, 113, 0.2); color: #2ecc71;' : 'background: rgba(230, 126, 34, 0.2); color: #e67e22;'}">
                        ${vectorized ? '<i class="fa-solid fa-check"></i> Vectorized' : '<i class="fa-solid fa-exclamation-triangle"></i> Not Vectorized'}
                    </span>
                </div>
                <div class="ragbooks-scene-card__actions" style="margin-left: auto;">
                    <button class="menu_button ragbooks-jump-to-scene" data-scene-idx="${idx}" title="Jump to scene in chat" onclick="event.stopPropagation()">
                        <i class="fa-solid fa-arrow-right"></i>
                    </button>
                    <button class="menu_button ragbooks-scene-delete" data-scene-idx="${idx}" title="Delete scene" onclick="event.stopPropagation()">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>

            <!-- Scene Body (Collapsible Content) -->
            <div class="ragbooks-scene-card__body" style="display: block;">
            <!-- Title Input -->
            <div class="ragbooks-setting-item" style="margin-bottom: 10px;">
                <label>
                    <i class="fa-solid fa-heading"></i> Title
                </label>
                <input type="text"
                       class="ragbooks-scene-title"
                       data-scene-idx="${idx}"
                       placeholder="e.g., 'Tavern Brawl', 'Dragon Battle'"
                       value="${escapeHtml(scene.title || '')}">
                <div class="ragbooks-help-text">Short descriptive title for this scene</div>
            </div>

            <!-- Summary Editor -->
            <div class="ragbooks-setting-item" style="margin-bottom: 10px;">
                <label>
                    <i class="fa-solid fa-file-lines"></i> Summary
                </label>
                <textarea class="text_pole ragbooks-scene-summary"
                          data-scene-idx="${idx}"
                          placeholder="Enter scene summary..."
                          style="width: 100%; min-height: 80px; resize: vertical;">${scene.summary || ''}</textarea>
                <div class="ragbooks-help-text">Scene summary. Save changes to update the scene metadata.</div>
            </div>

            <!-- Scene Preview -->
            ${scene.end !== null ? `
                <details class="ragbooks-scene-card__preview">
                    <summary>
                        <i class="fa-solid fa-eye"></i> Preview (${scene.end - scene.start + 1} messages)
                    </summary>
                    <div class="ragbooks-scene-card__preview-content">
                        ${escapeHtml(getScenePreview(scene))}
                    </div>
                </details>
            ` : ''}
            </div><!-- End Scene Body -->
        </div>
    `;
    }).join('');

    container.html(html);

    // Bind scene-specific event handlers
    bindSceneCardEvents();
}

function bindSceneCardEvents() {
    const scenes = getScenes();

    // Collapse/expand scene cards
    $('.ragbooks-scene-card__header-collapsible').off('click').on('click', function() {
        const $card = $(this).closest('.ragbooks-scene-card');
        const $body = $card.find('.ragbooks-scene-card__body');
        const $icon = $(this).find('.ragbooks-collapse-icon');

        // Toggle body visibility
        $body.slideToggle(200);

        // Rotate icon
        if ($icon.hasClass('fa-chevron-down')) {
            $icon.removeClass('fa-chevron-down').addClass('fa-chevron-right');
        } else {
            $icon.removeClass('fa-chevron-right').addClass('fa-chevron-down');
        }
    });

    // Save scene title on input change
    $('.ragbooks-scene-title').off('input').on('input', function() {
        const idx = parseInt($(this).data('scene-idx'));
        const scene = scenes[idx];
        if (!scene) return;

        const newTitle = $(this).val().trim();
        scene.title = newTitle;
        saveScenes();

        // Also update the chunk name in the library if this scene has been vectorized
        const library = getContextualLibrary();
        const currentCollection = getCurrentCollectionName();
        if (library[currentCollection]) {
            Object.values(library[currentCollection]).forEach(chunk => {
                if (chunk.metadata?.sceneIndex === idx) {
                    chunk.name = newTitle;
                }
            });
            saveLibrary();
        }
    });

    // Save scene summary on input change
    $('.ragbooks-scene-summary').off('input').on('input', function() {
        const idx = parseInt($(this).data('scene-idx'));
        const scene = scenes[idx];
        if (!scene) return;

        const newSummary = $(this).val().trim();
        scene.summary = newSummary;
        saveScenes();

        // Also update the summary in the library if this scene has been vectorized
        const library = getContextualLibrary();
        const currentCollection = getCurrentCollectionName();
        if (library[currentCollection]) {
            Object.values(library[currentCollection]).forEach(chunk => {
                if (chunk.metadata?.sceneIndex === idx) {
                    chunk.summary = newSummary;
                }
            });
            saveLibrary();
        }
    });

    // Delete scene
    $('.ragbooks-scene-delete').off('click').on('click', async function() {
        const idx = parseInt($(this).data('scene-idx'));
        const scene = scenes[idx];

        // Check if this scene has been vectorized
        const library = getContextualLibrary();
        const collectionId = currentViewingCollection;
        const hasVectorizedChunks = collectionId && library[collectionId] &&
            Object.values(library[collectionId]).some(chunk => chunk.metadata?.sceneIndex === idx);

        if (hasVectorizedChunks) {
            // Scene has chunks - offer options
            const response = await callGenericPopup(
                `<div style="text-align: left;">
                    <h3>Delete Scene ${idx + 1}?</h3>
                    <p><strong>This scene has been vectorized and has associated chunks.</strong></p>
                    <p>What would you like to do?</p>
                </div>`,
                POPUP_TYPE.CONFIRM,
                '',
                {
                    okButton: 'Delete Scene + Chunks',
                    cancelButton: 'Delete Scene Only',
                    customButtons: [{ text: 'Cancel', result: 'cancel' }]
                }
            );

            if (response === 'cancel') return;

            if (response === POPUP_RESULT.AFFIRMATIVE) {
                // Delete scene AND chunks
                const chunksToDelete = [];
                Object.entries(library[collectionId]).forEach(([hash, chunk]) => {
                    if (chunk.metadata?.sceneIndex === idx) {
                        chunksToDelete.push({ hash, chunk });
                    }
                });

                // Delete from library
                chunksToDelete.forEach(({hash}) => {
                    delete library[collectionId][hash];
                    if (currentViewingChunks[hash]) {
                        delete currentViewingChunks[hash];
                    }
                });

                // Delete from vector DB
                if (chunksToDelete.length > 0) {
                    try {
                        await apiDeleteVectorItems(collectionId, chunksToDelete.map(c => c.hash));
                        toastr.success(`Deleted scene and ${chunksToDelete.length} associated chunk(s)`);
                    } catch (error) {
                        console.error('Failed to delete vectors:', error);
                        toastr.warning('Scene deleted but some vectors may remain');
                    }
                }

                saveSettingsDebounced();
            } else {
                // Delete scene only - chunks become orphaned
                toastr.info('Scene deleted. Chunks are now orphaned.');
            }
        } else {
            // No chunks - simple confirmation
            if (!confirm(`Delete Scene ${idx + 1}? This cannot be undone.`)) {
                return;
            }
        }

        // Delete scene from metadata
        scenes.splice(idx, 1);
        saveScenes();

        // Smart re-indexing: Update sceneIndex for all chunks with higher indices
        if (collectionId && library[collectionId]) {
            let reindexedCount = 0;
            Object.values(library[collectionId]).forEach(chunk => {
                if (chunk.metadata?.sceneIndex !== undefined && chunk.metadata.sceneIndex > idx) {
                    chunk.metadata.sceneIndex--;
                    reindexedCount++;
                }
            });

            if (reindexedCount > 0) {
                console.log(`🔄 Re-indexed ${reindexedCount} chunks after scene deletion`);
                saveSettingsDebounced();
            }
        }

        updateAllSceneStates();
        renderSceneCards(); // Refresh scenes tab
        renderChunkCards(currentViewingChunks); // Refresh chunks tab to show orphan badges
    });

    // Jump to scene in chat
    $('.ragbooks-jump-to-scene').off('click').on('click', function() {
        const idx = parseInt($(this).data('scene-idx'));
        const scene = scenes[idx];
        if (!scene) return;

        // Scroll to the scene's start message
        // scene.start is 0-based index, .eq() also expects 0-based
        const $message = $('#chat .mes').eq(scene.start);
        if ($message.length) {
            $message[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Highlight briefly
            $message.addClass('highlighted');
            setTimeout(() => $message.removeClass('highlighted'), 2000);
            toastr.info(`Jumped to Scene ${idx + 1} (message #${scene.start + 1})`);
        } else {
            toastr.warning(`Message #${scene.start + 1} not found in current chat (chat has ${$('#chat .mes').length} messages)`);
        }
    });
}

function renderGroupsTab() {
    if (!currentViewingChunks) return;

    // Group chunks by their group name
    const groups = {};
    Object.values(currentViewingChunks).forEach(chunk => {
        const groupName = chunk.chunkGroup?.name;
        if (groupName) {
            if (!groups[groupName]) {
                groups[groupName] = {
                    name: groupName,
                    keywords: chunk.chunkGroup.groupKeywords || [],
                    requiresGroupMember: chunk.chunkGroup.requiresGroupMember || false,
                    chunks: []
                };
            }
            groups[groupName].chunks.push(chunk);
        }
    });

    const groupArray = Object.values(groups);
    const $container = $('#ragbooks_groups_container');
    $container.empty();

    if (groupArray.length === 0) {
        $container.html(`
            <div class="ragbooks-empty-state" style="text-align: center; padding: 60px 20px; opacity: 0.6;">
                <i class="fa-solid fa-layer-group" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p style="font-size: 16px; margin-bottom: 8px;">No groups defined</p>
                <p style="font-size: 13px;">Groups are created when you assign a group name to chunks in the Chunks tab</p>
            </div>
        `);
        return;
    }

    groupArray.forEach(group => {
        const chunkCount = group.chunks.length;
        const keywordsText = group.keywords.length > 0 ? group.keywords.join(', ') : 'None';

        const groupCard = `
            <div class="ragbooks-group-card" style="margin-bottom: 16px; padding: 16px; background: var(--black10a); border-radius: 8px; border-left: 4px solid var(--ragbooks-accent-primary);">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                    <div>
                        <h3 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 600;">
                            <i class="fa-solid fa-layer-group"></i> ${escapeHtml(group.name)}
                        </h3>
                        <div style="font-size: 12px; opacity: 0.7;">
                            ${chunkCount} chunk${chunkCount !== 1 ? 's' : ''}
                            ${group.requiresGroupMember ? ' <span style="color: var(--ragbooks-accent-primary);"><i class="fa-solid fa-star"></i> Required</span>' : ''}
                        </div>
                    </div>
                </div>
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.7; margin-bottom: 4px;">
                        <i class="fa-solid fa-tags"></i> Group Keywords
                    </div>
                    <div style="font-size: 13px;">${escapeHtml(keywordsText)}</div>
                </div>
                <div>
                    <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.7; margin-bottom: 4px;">
                        <i class="fa-solid fa-cube"></i> Chunks in Group
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${group.chunks.map(chunk => `
                            <span class="chunk-tag" style="font-size: 12px;">
                                ${escapeHtml(chunk.name || chunk.section || 'Chunk')}
                            </span>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        $container.append(groupCard);
    });
}

function initializeKeywordSelect(chunk) {
    const hash = chunk.hash;
    const $select = $(`.ragbooks-chunk-keywords[data-hash="${hash}"]`);
    const $textarea = $(`.ragbooks-chunk-keywords-plaintext[data-hash="${hash}"]`);
    const $switchBtn = $(`.switch_input_type_icon[data-hash="${hash}"]`);
    if (!$select.length) return;

    // IMPORTANT: Destroy existing select2 to prevent duplication when switching modes
    if ($select.data('select2')) {
        $select.select2('destroy');
    }

    // Remove all existing event handlers to prevent duplication
    $select.off();
    $textarea.off();
    $switchBtn.off();

    const keywords = chunk.keywords || [];
    const customKeywords = chunk.customKeywords || [];
    const disabledKeywords = chunk.disabledKeywords || [];
    const customWeights = chunk.customWeights || {};
    const customKeywordSet = new Set(customKeywords);
    const disabledSet = new Set(disabledKeywords);

    // Initialize plaintext mode setting
    if (!window.ragbooksSettings) window.ragbooksSettings = {};
    if (window.ragbooksSettings.keywordInputPlaintext === undefined) {
        window.ragbooksSettings.keywordInputPlaintext = false; // Default to fancy mode
    }

    const isPlaintext = window.ragbooksSettings.keywordInputPlaintext;

    const getWeight = (keyword) => {
        return customWeights[keyword] !== undefined ? customWeights[keyword] : 100;
    };

    // Initialize fancy mode (select2) or plaintext mode
    if (!isPlaintext) {
        // FANCY MODE: Initialize select2
        $select.show();
        $textarea.hide();
        $switchBtn.text('⌨️').attr('title', 'Switch to plaintext mode');

        $select.select2({
            tags: true,
            tokenSeparators: [','],
            placeholder: $select.attr('placeholder'),
            width: '100%',
            templateSelection: function(item) {
                if (!item.id) return item.text;

                const keyword = item.text;
                const weight = getWeight(keyword);
                const isCustom = customKeywordSet.has(keyword);
                const isDisabled = disabledSet.has(keyword);

                const $tag = $('<span>').addClass('item');
                const $text = $('<span>').addClass('keyword-text').text(keyword);

                // Weight badge with contenteditable
                const $weight = $('<sup>')
                    .addClass('keyword-weight-badge')
                    .attr('data-keyword', keyword)
                    .attr('data-hash', hash)
                    .attr('contenteditable', 'true')
                    .attr('spellcheck', 'false')
                    .attr('title', 'Click to edit weight')
                    .text(weight)
                    .on('mousedown', function(e) {
                        e.stopPropagation();
                    })
                    .on('click', function(e) {
                        e.stopPropagation();
                        $(this).select();
                    })
                    .on('keydown', function(e) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            $(this).blur();
                        }
                        if (!/^\d$/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
                            e.preventDefault();
                        }
                    })
                    .on('blur', function() {
                        const newWeight = parseInt($(this).text()) || 100;
                        const clampedWeight = Math.max(1, Math.min(200, newWeight));

                        if (!chunk.customWeights) chunk.customWeights = {};
                        chunk.customWeights[keyword] = clampedWeight;
                        hasUnsavedChunkChanges = true;

                        $(this).text(clampedWeight);
                        toastr.info(`Weight for "${keyword}" set to ${clampedWeight}`);
                    });

                $tag.append($text).append($weight);

                if (isCustom) {
                    $tag.css('color', 'var(--SmartThemeQuoteColor)');
                }
                if (isDisabled) {
                    $tag.css('opacity', '0.5');
                }

                return $tag;
            }
        });

        // Populate with keywords
        keywords.forEach(keyword => {
            const option = new Option(keyword, keyword, true, true);
            $select.append(option);
        });
        $select.trigger('change');

        // Handle keyword changes (debounced to prevent rapid-fire updates)
        let keywordChangeTimeout;
        $select.on('change', function() {
            clearTimeout(keywordChangeTimeout);
            keywordChangeTimeout = setTimeout(() => {
                const selectedKeywords = $(this).val() || [];

                // Preserve keywords in chunk object
                chunk.keywords = selectedKeywords;

                selectedKeywords.forEach(kw => {
                    if (!chunk.customKeywords) chunk.customKeywords = [];
                    if (!keywords.includes(kw) && !chunk.customKeywords.includes(kw)) {
                        chunk.customKeywords.push(kw);
                    }
                });

                hasUnsavedChunkChanges = true;
                console.log('[Keywords] Updated for chunk:', hash, 'keywords:', selectedKeywords.length);
            }, 100);
        });
    } else {
        // PLAINTEXT MODE: Show textarea with keyword:weight format
        const keywordsText = keywords.map(k => {
            const weight = getWeight(k);
            return `${k}:${weight}`;
        }).join(', ');

        $select.hide();
        $textarea.show().val(keywordsText);
        $switchBtn.text('✨').attr('title', 'Switch to fancy mode');

        $textarea.on('change input', function() {
            const text = $(this).val() || '';
            const newKeywords = [];
            const newWeights = {};

            // Parse comma-separated entries (CarrotKernel-style simple split)
            text.split(',').forEach(entry => {
                const trimmed = entry.trim();
                if (!trimmed) return;

                // Simple split on colon - works for both plain keywords and regexes
                const parts = trimmed.split(':');
                const keyword = parts[0].trim();
                const weight = parts[1] ? parseInt(parts[1].trim()) : 100;

                if (keyword) {
                    newKeywords.push(keyword);
                    // Save weight (default 100 if not provided or invalid)
                    newWeights[keyword] = !isNaN(weight) ? Math.max(1, Math.min(200, weight)) : 100;
                }
            });

            chunk.keywords = newKeywords;
            if (!chunk.customWeights) chunk.customWeights = {};
            // Replace all weights with parsed ones
            chunk.customWeights = { ...newWeights };
            hasUnsavedChunkChanges = true;
        });
    }

    // Handle mode switcher button
    $switchBtn.off('click').on('click', function() {
        // IMPORTANT: Save current plaintext values before switching
        if (window.ragbooksSettings.keywordInputPlaintext) {
            // Currently in plaintext mode - parse and save before switching to fancy
            const text = $textarea.val() || '';
            const newKeywords = [];
            const newWeights = {};

            // Parse comma-separated entries (CarrotKernel-style simple split)
            text.split(',').forEach(entry => {
                const trimmed = entry.trim();
                if (!trimmed) return;

                // Simple split on colon - works for both plain keywords and regexes
                const parts = trimmed.split(':');
                const keyword = parts[0].trim();
                const weight = parts[1] ? parseInt(parts[1].trim()) : 100;

                if (keyword) {
                    newKeywords.push(keyword);
                    // Save weight (default 100 if not provided or invalid)
                    newWeights[keyword] = !isNaN(weight) ? Math.max(1, Math.min(200, weight)) : 100;
                }
            });

            chunk.keywords = newKeywords;
            if (!chunk.customWeights) chunk.customWeights = {};
            chunk.customWeights = { ...newWeights };
            hasUnsavedChunkChanges = true;
        }

        // Toggle mode and re-initialize only this chunk's keyword input
        window.ragbooksSettings.keywordInputPlaintext = !window.ragbooksSettings.keywordInputPlaintext;

        // Re-initialize just this chunk instead of re-rendering all chunks
        initializeKeywordSelect(chunk);
    });
}

function initializeSummaryVectorsSelect(chunk) {
    const hash = chunk.hash;
    const $select = $(`.ragbooks-summary-vectors-select[data-hash="${hash}"]`);
    if (!$select.length) return;
    if ($select.data('select2')) return; // Already initialized

    const summaryVectors = chunk.summaryVectors || [];

    // Initialize Select2 for multi-tag input
    $select.select2({
        tags: true,
        tokenSeparators: [','],
        placeholder: 'Add searchable summaries (any length)...',
        width: '100%',
        templateSelection: function(item) {
            if (!item.id) return item.text;

            const $tag = $('<span>').addClass('item summary-vector-tag');
            const $text = $('<span>').text(item.text);
            $tag.append($text);

            return $tag;
        }
    });

    // Populate with existing summary vectors
    summaryVectors.forEach(vector => {
        const option = new Option(vector, vector, true, true);
        $select.append(option);
    });
    $select.trigger('change');

    // Handle changes
    $select.on('change', function() {
        const vectors = $(this).val() || [];
        chunk.summaryVectors = vectors;
        hasUnsavedChunkChanges = true;
    });
}

/**
 * Create a new empty chunk in the current collection
 */
function createNewChunk() {
    if (!currentViewingCollection) {
        console.error('[RAGBooks] No collection is currently open');
        toastr.error('No collection is currently open', 'RAGBooks');
        return;
    }

    // Generate a unique hash for the new chunk
    const newHash = `chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create a new chunk object with default values
    const newChunk = {
        hash: newHash,
        text: '',
        name: '',
        keywords: [],
        systemKeywords: [],
        customKeywords: [],
        customWeights: {},
        disabledKeywords: [],
        summaryVectors: [],
        chunkLinks: [],
        disabled: false,
        importance: 100,
        conditionalActivation: false,
        activationRules: [],
        chunkGroup: {
            name: '',
            groupKeywords: [],
            requiresGroupMember: false
        },
        inclusionPrioritize: false,
        metadata: {
            source: 'manual',
            enableSummary: false,
            summaryStyle: 'concise',
            enableMetadata: false
        },
        _expanded: true // Auto-expand new chunk
    };

    // Add to currentViewingChunks
    currentViewingChunks[newHash] = newChunk;

    // Render the new chunk and prepend it to the list
    const chunkHtml = renderChunkCard(newChunk);
    $('#ragbooks_chunks_container').prepend(chunkHtml);

    // Mark as having unsaved changes
    hasUnsavedChunkChanges = true;

    // Scroll to the new chunk
    const $newChunk = $(`.world_entry[data-hash="${newHash}"]`);
    $newChunk[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Focus on the name input
    setTimeout(() => {
        $newChunk.find('.ragbooks-chunk-name').focus();
    }, 300);

    // Update chunk count in modal subtitle
    $('#ragbooks_modal_subtitle').text(`${Object.keys(currentViewingChunks).length} chunks`);

    // Initialize select2 for the new chunk after DOM is ready
    setTimeout(() => {
        initializeKeywordSelect(newChunk);
        initializeSummaryVectorsSelect(newChunk);
    }, 100);

    console.log('[RAGBooks] Created new chunk:', newHash);
    toastr.success('New chunk created. Don\'t forget to save!', 'RAGBooks');
}

function bindChunkViewerEvents() {
    const container = $('#ragbooks_chunks_container');

    // Close buttons
    $('#ragbooks_modal_close, #ragbooks_modal_cancel').off('click').on('click', closeChunkViewer);

    // Save button
    $('#ragbooks_modal_save').off('click').on('click', saveChunkViewerChanges);

    // Create New Chunk button
    $('#ragbooks_create_chunk').off('click').on('click', createNewChunk);

    // Tab switching
    $('.ragbooks-viewer-tab').off('click').on('click', function() {
        const tab = $(this).data('tab');

        // Update active tab
        $('.ragbooks-viewer-tab').removeClass('active');
        $(this).addClass('active');

        // Show/hide containers
        if (tab === 'chunks') {
            $('#ragbooks_chunks_container').show();
            $('#ragbooks_scenes_container').hide();
            $('#ragbooks_groups_container').hide();
        } else if (tab === 'scenes') {
            $('#ragbooks_chunks_container').hide();
            $('#ragbooks_scenes_container').show();
            $('#ragbooks_groups_container').hide();
        } else if (tab === 'groups') {
            $('#ragbooks_chunks_container').hide();
            $('#ragbooks_scenes_container').hide();
            $('#ragbooks_groups_container').show();
            renderGroupsTab();
        }
    });

    // Search - optimized with show/hide instead of re-render
    $('#ragbooks_chunk_search').off('input').on('input', function() {
        const searchTerm = $(this).val().toLowerCase().trim();
        const $chunks = container.find('.world_entry');

        let visibleCount = 0;

        $chunks.each(function() {
            const $entry = $(this);
            const hash = $entry.data('hash');
            const chunk = currentViewingChunks[hash];

            if (!chunk) {
                $entry.hide();
                return;
            }

            // Check if chunk matches search term
            const text = (chunk.text || '').toLowerCase();
            const keywords = (chunk.keywords || []).map(k => k.toLowerCase());
            const matches = !searchTerm ||
                text.includes(searchTerm) ||
                keywords.some(k => k.includes(searchTerm));

            if (matches) {
                $entry.show();
                visibleCount++;
            } else {
                $entry.hide();
            }
        });

        // Update stats
        const totalChunks = Object.keys(currentViewingChunks).length;
        const visibleChunks = $chunks.filter(':visible');
        const totalChars = visibleChunks.toArray().reduce((sum, el) => {
            const hash = $(el).data('hash');
            const chunk = currentViewingChunks[hash];
            return sum + (chunk?.text?.length || 0);
        }, 0);
        const avgChars = visibleCount ? Math.round(totalChars / visibleCount) : 0;

        $('#ragbooks_chunk_stats').html(`
            <div class="chunk-stat">
                <i class="fa-solid fa-layer-group"></i>
                <span class="chunk-stat__label">Showing</span>
                <span class="chunk-stat__value">${visibleCount}</span>
                <span class="chunk-stat__divider">/</span>
                <span class="chunk-stat__value">${totalChunks}</span>
            </div>
            <div class="chunk-stat">
                <i class="fa-solid fa-ruler-horizontal"></i>
                <span class="chunk-stat__label">Average</span>
                <span class="chunk-stat__value">${avgChars} chars</span>
            </div>
        `);

        // Show/hide empty state
        if (visibleCount === 0) {
            if (!container.find('.chunk-empty-state').length) {
                container.append('<div class="chunk-empty-state"><i class="fa-solid fa-eye-slash"></i><p>No chunks match your search</p></div>');
            }
        } else {
            container.find('.chunk-empty-state').remove();
        }
    });

    // Handle inline-drawer toggle clicks to lazy-initialize select2
    container.off('click', '.inline-drawer-toggle').on('click', '.inline-drawer-toggle', function(e) {
        const $toggle = $(this);
        const $drawer = $toggle.closest('.inline-drawer');
        const $entry = $drawer.closest('.world_entry');
        const hash = $entry.data('hash');
        const chunk = currentViewingChunks[hash];

        if (!chunk) return;

        // Wait for CSS animation to complete, then check if expanded
        setTimeout(() => {
            if ($drawer.find('.inline-drawer-content').is(':visible')) {
                // Chunk was just expanded - lazy initialize select2 if not already done
                const $select = $drawer.find(`.ragbooks-chunk-keywords[data-hash="${hash}"]`);
                if ($select.length && !$select.data('select2')) {
                    initializeKeywordSelect(chunk);
                }

                // Also initialize summary vectors select2
                const $summarySelect = $drawer.find(`.ragbooks-summary-vectors-select[data-hash="${hash}"]`);
                if ($summarySelect.length && !$summarySelect.data('select2')) {
                    initializeSummaryVectorsSelect(chunk);
                }
            }
        }, 50);
    });

    // Toggle chunk enabled/disabled - optimized with targeted DOM update
    container.off('click', '.ragbooks-chunk-enabled-toggle').on('click', '.ragbooks-chunk-enabled-toggle', function() {
        const $icon = $(this);
        const hash = $icon.data('hash');
        const chunk = currentViewingChunks[hash];

        if (chunk) {
            chunk.disabled = !chunk.disabled;
            hasUnsavedChunkChanges = true;

            // Update DOM directly without re-rendering
            const $entry = $icon.closest('.world_entry');
            if (chunk.disabled) {
                $entry.addClass('chunk-disabled');
                $icon.removeClass('fa-toggle-on').addClass('fa-toggle-off');
            } else {
                $entry.removeClass('chunk-disabled');
                $icon.removeClass('fa-toggle-off').addClass('fa-toggle-on');
            }

            toastr.info(chunk.disabled ? 'Chunk disabled' : 'Chunk enabled');
        }
    });

    // Edit chunk comment
    container.off('change', '.ragbooks-chunk-comment-input').on('change', '.ragbooks-chunk-comment-input', function() {
        const hash = $(this).data('hash');
        const chunk = currentViewingChunks[hash];
        if (chunk) {
            chunk.comment = $(this).val().trim();
            hasUnsavedChunkChanges = true;
        }
    });

    // Edit chunk text
    container.off('change', '.ragbooks-chunk-text-edit').on('change', '.ragbooks-chunk-text-edit', function() {
        const hash = $(this).data('hash');
        const chunk = currentViewingChunks[hash];
        if (chunk) {
            chunk.text = $(this).val();
            hasUnsavedChunkChanges = true;
            toastr.info('Text changed - will re-vectorize on save');
        }
    });

    // Edit inclusion group
    container.off('change', '.ragbooks-inclusion-group-input').on('change', '.ragbooks-inclusion-group-input', function() {
        const hash = $(this).data('hash');
        const chunk = currentViewingChunks[hash];
        if (chunk) {
            chunk.inclusionGroup = $(this).val().trim();
            hasUnsavedChunkChanges = true;
        }
    });

    // Edit inclusion prioritize
    container.off('change', '.ragbooks-inclusion-prioritize').on('change', '.ragbooks-inclusion-prioritize', function() {
        const hash = $(this).data('hash');
        const chunk = currentViewingChunks[hash];
        if (chunk) {
            chunk.inclusionPrioritize = $(this).is(':checked');
            hasUnsavedChunkChanges = true;
        }
    });


    // Linked chunks checkbox handler - optimized (no re-render needed)
    container.off('change', '.ragbooks-chunk-link-checkbox').on('change', '.ragbooks-chunk-link-checkbox', function() {
        const hash = $(this).data('hash');
        const targetHash = $(this).data('target');
        const chunk = currentViewingChunks[hash];
        if (!chunk) return;

        if (!chunk.chunkLinks) chunk.chunkLinks = [];

        if ($(this).is(':checked')) {
            // Add link if not already present
            if (!chunk.chunkLinks.includes(targetHash)) {
                chunk.chunkLinks.push(targetHash);
                toastr.success('Chunk linked');
            }
        } else {
            // Remove link
            chunk.chunkLinks = chunk.chunkLinks.filter(h => h !== targetHash);
            toastr.info('Chunk unlinked');
        }

        hasUnsavedChunkChanges = true;
        // No re-render needed - checkbox state already updated by browser
    });

    // Delete chunk - optimized with targeted DOM removal
    container.off('click', '.ragbooks-chunk-delete-btn').on('click', '.ragbooks-chunk-delete-btn', function(e) {
        e.preventDefault();
        const $btn = $(this);
        const hash = $btn.data('hash');
        const chunk = currentViewingChunks[hash];
        if (!chunk) return;

        if (!confirm(`Delete this chunk permanently?\n\n"${chunk.section || 'Chunk'}"\n\nThis cannot be undone.`)) {
            return;
        }

        delete currentViewingChunks[hash];
        hasUnsavedChunkChanges = true;

        // Remove DOM element with animation
        const $entry = $btn.closest('.world_entry');
        $entry.fadeOut(200, function() {
            $(this).remove();

            // Update stats
            const remainingCount = container.find('.world_entry:visible').length;
            const totalCount = Object.keys(currentViewingChunks).length;
            $('#ragbooks_chunk_stats .chunk-stat__value').first().text(remainingCount);
            $('#ragbooks_chunk_stats .chunk-stat__value').eq(2).text(totalCount);
        });

        toastr.success('Chunk deleted (save to persist)');
    });

    // Bind all content/feature event handlers
    bindChunkViewerEventHandlers();
}

/**
 * Re-vectorize a collection
 */
async function revectorizeCollection(collectionId, sourceData) {
    if (!confirm(`Re-vectorize "${sourceData.name}"? This will delete existing vectors and create new ones.`)) {
        return;
    }

    try {
        toastr.info('Re-vectorizing...');

        // Delete old collection
        await apiDeleteCollection(collectionId);
        await deleteChunksFromLibrary(collectionId);

        // Re-vectorize based on source type
        const result = await vectorizeContentSource(
            sourceData.type,
            sourceData.name,
            sourceData.config || {}
        );

        toastr.success(`Re-vectorized: ${result.chunkCount} chunks`);
        renderCollections();
    } catch (error) {
        console.error('Failed to re-vectorize:', error);
        toastr.error('Failed to re-vectorize: ' + error.message);
    }
}

/**
 * Change a collection's scope to a specific scope
 */
function changeScopeForCollection(collectionId, sourceData, newScope) {
    const ragState = ensureRagState();
    const metadata = ragState.collectionMetadata?.[collectionId] || {};

    // Get current scope (default to global)
    const currentScope = metadata.scope || 'global';
    const currentScopeIdentifier = metadata.scopeIdentifier;

    // Don't do anything if already at target scope
    if (currentScope === newScope) {
        toastr.info(`Already in ${newScope} scope`);
        return;
    }

    // Fetch the actual sourceData from the current scope before we delete it
    let actualSourceData = null;
    if (currentScope === 'character' && currentScopeIdentifier) {
        actualSourceData = ragState.scopedSources?.character?.[currentScopeIdentifier]?.[collectionId];
    } else if (currentScope === 'chat' && currentScopeIdentifier) {
        actualSourceData = ragState.scopedSources?.chat?.[currentScopeIdentifier]?.[collectionId];
    } else {
        actualSourceData = ragState.scopedSources?.global?.[collectionId];
    }

    // Fallback to flat sources or passed sourceData if not found in scoped
    if (!actualSourceData) {
        actualSourceData = ragState.sources?.[collectionId] || sourceData;
    }

    if (!actualSourceData) {
        toastr.error('Collection data not found - cannot move');
        console.error(`Cannot find sourceData for collection ${collectionId}`);
        return;
    }

    // Determine new scope identifier
    let newScopeIdentifier = null;
    const context = getContext();

    if (newScope === 'character') {
        const activeCharacter = context?.characters?.[context.characterId];
        const characterName = activeCharacter?.name || context?.character?.name || null;
        if (!characterName) {
            toastr.warning('No active character - cannot move to character scope');
            return;
        }
        newScopeIdentifier = characterName;
    } else if (newScope === 'chat') {
        const chatId = context?.chatId;
        if (!chatId) {
            toastr.warning('No active chat - cannot move to chat scope');
            return;
        }
        newScopeIdentifier = chatId;
    }

    console.log(`📚 [Scope Change] Moving collection "${collectionId}" from ${currentScope} → ${newScope}`);

    // Delete from old scope (uses current metadata)
    deleteScopedSource(collectionId);

    // Update metadata to new scope
    metadata.scope = newScope;
    metadata.scopeIdentifier = newScopeIdentifier;

    if (!ragState.collectionMetadata) {
        ragState.collectionMetadata = {};
    }
    ragState.collectionMetadata[collectionId] = metadata;

    // Save to new scope (uses updated metadata and actual sourceData)
    saveScopedSource(collectionId, actualSourceData);

    // Save settings
    saveSettingsDebounced();

    // Re-render collections
    renderCollections();

    // Toast notification
    const scopeLabels = {
        global: 'Global',
        character: 'Character',
        chat: 'Chat'
    };
    toastr.success(`Collection moved to ${scopeLabels[newScope]} scope`);
}

/**
 * Delete a collection
 */
async function deleteCollection(collectionId) {
    const ragState = ensureRagState();
    const sourceData = ragState.sources?.[collectionId];

    if (!sourceData) {
        toastr.error('Collection not found');
        return;
    }

    if (!confirm(`Delete "${sourceData.name}"? This cannot be undone.`)) {
        return;
    }

    try {
        // Delete from vector database (Chromadb, Qdrant, etc.)
        await apiDeleteCollection(collectionId);

        // Delete from local library (extension_settings.ragbooks.rag.library)
        await deleteChunksFromLibrary(collectionId);

        // Delete from scoped sources (NEW: scope-aware deletion)
        deleteScopedSource(collectionId);

        // Also delete from flat sources for backward compatibility
        if (ragState.sources && ragState.sources[collectionId]) {
            delete ragState.sources[collectionId];
        }

        // Delete collection metadata (extension_settings.ragbooks.rag.collectionMetadata)
        if (ragState.collectionMetadata && ragState.collectionMetadata[collectionId]) {
            delete ragState.collectionMetadata[collectionId];
        }

        saveSettingsDebounced();

        toastr.success('Collection deleted');
        renderCollections();
    } catch (error) {
        console.error('Failed to delete collection:', error);
        toastr.error('Failed to delete collection');
    }
}

// ============================================================================
// INLINE FORM HANDLERS (NO MODALS)
// ============================================================================

/**
 * Handle source type selection from dropdown
 */
function handleSourceTypeSelection(sourceType) {
    const configArea = $('#ragbooks_inline_config');

    if (!sourceType) {
        configArea.hide().empty();
        return;
    }

    configArea.show().html(getInlineConfigForm(sourceType));

    // Populate dropdowns if needed
    if (sourceType === 'lorebook') {
        populateLorebookDropdown();

        // Add event handler for source type toggle
        $('#ragbooks_lorebook_source_type').on('change', function() {
            const sourceType = $(this).val();
            if (sourceType === 'existing') {
                $('#ragbooks_lorebook_existing_section').show();
                $('#ragbooks_lorebook_upload_section').hide();
            } else {
                $('#ragbooks_lorebook_existing_section').hide();
                $('#ragbooks_lorebook_upload_section').show();
            }
        });

        // Add event handler for chunking strategy toggle
        $('#ragbooks_chunking_strategy').on('change', function() {
            const strategy = $(this).val();
            if (strategy === 'size') {
                $('#ragbooks_lorebook_size_controls').show();
            } else {
                $('#ragbooks_lorebook_size_controls').hide();
            }
        });
    } else if (sourceType === 'character') {
        populateCharacterDropdown();

        // Add event handler for source type toggle
        $('#ragbooks_character_source_type').on('change', function() {
            const sourceType = $(this).val();
            if (sourceType === 'existing') {
                $('#ragbooks_character_existing_section').show();
                $('#ragbooks_character_upload_section').hide();
            } else {
                $('#ragbooks_character_existing_section').hide();
                $('#ragbooks_character_upload_section').show();
            }
        });

        // Add event handler for chunking strategy toggle
        $('#ragbooks_chunking_strategy').on('change', function() {
            const strategy = $(this).val();
            if (strategy === 'size') {
                $('#ragbooks_character_size_controls').show();
            } else {
                $('#ragbooks_character_size_controls').hide();
            }
        });
    } else if (sourceType === 'url') {
        // Add event handler for chunking strategy toggle
        $('#ragbooks_chunking_strategy').on('change', function() {
            const strategy = $(this).val();
            if (strategy === 'size') {
                $('#ragbooks_url_size_controls').show();
            } else {
                $('#ragbooks_url_size_controls').hide();
            }
        });
    } else if (sourceType === 'custom') {
        // Add event handler for chunking strategy toggle
        $('#ragbooks_chunking_strategy').on('change', function() {
            const strategy = $(this).val();
            if (strategy === 'size') {
                $('#ragbooks_custom_size_controls').show();
            } else {
                $('#ragbooks_custom_size_controls').hide();
            }
        });
    }
}

/**
 * Populate lorebook dropdown with available lorebooks
 */
async function populateLorebookDropdown() {
    const dropdown = $('#ragbooks_lorebook_select');
    dropdown.empty().append('<option value="">-- Select a Lorebook --</option>');

    try {
        // Import world_names from world-info module
        const worldInfoModule = await import('../../../world-info.js');
        const worldNames = worldInfoModule.world_names || [];

        if (worldNames && worldNames.length > 0) {
            worldNames.forEach(wi => {
                dropdown.append(`<option value="${wi}">${wi}</option>`);
            });
        } else {
            dropdown.append('<option value="">No lorebooks found</option>');
        }
    } catch (error) {
        console.error('Failed to load lorebooks:', error);
        dropdown.empty().append('<option value="">Error loading lorebooks</option>');
        toastr.error('Failed to load lorebooks');
    }
}

/**
 * Bind all chunk viewer event handlers
 * MOVED FROM populateLorebookDropdown() - handlers were in wrong function scope
 */
function bindChunkViewerEventHandlers() {
    const container = $('#ragbooks_chunks_container');

    // ============================================================================
    // CHUNK CONTENT EVENT HANDLERS
    // ============================================================================

    // Regex patterns input handler removed - keywords Select2 now handles both keywords and regexes

    // Chunk name input (use 'change' instead of 'input' to avoid overwriting during typing)
    container.off('change', '.ragbooks-chunk-name').on('change', '.ragbooks-chunk-name', function() {
        const hash = $(this).data('hash');
        const name = $(this).val().trim();
        const chunk = currentViewingChunks[hash];

        if (chunk) {
            chunk.name = name;
            hasUnsavedChunkChanges = true;

            // If this is a scene chunk, also update the scene title
            if (chunk.metadata?.sceneIndex !== undefined) {
                const scenes = getScenes();
                const scene = scenes[chunk.metadata.sceneIndex];
                if (scene) {
                    scene.title = name;
                    saveScenes();
                }
            }
        }
    });

    // Scene summary vector checkbox (for scene chunks only)
    container.off('change', '.ragbooks-scene-summary-vector-chunk').on('change', '.ragbooks-scene-summary-vector-chunk', function() {
        const hash = $(this).data('hash');
        const chunk = currentViewingChunks[hash];
        const isEnabled = $(this).is(':checked');

        if (chunk) {
            chunk.summaryVector = isEnabled;
            hasUnsavedChunkChanges = true;

            // Toggle Summary Vectors section visibility
            $(`.ragbooks-summary-vectors-section[data-hash="${hash}"]`).toggle(isEnabled);

            // If disabled, clean up any existing summary chunks
            if (!isEnabled && currentViewingCollection) {
                const library = getContextualLibrary();
                const collection = library[currentViewingCollection];
                if (collection) {
                    const summaryChunksToDelete = [];

                    // Find summary chunks that reference this chunk as parent
                    Object.entries(collection).forEach(([summaryHash, summaryChunk]) => {
                        if (summaryChunk.isSummaryChunk && summaryChunk.parentHash === hash) {
                            summaryChunksToDelete.push(summaryHash);
                        }
                    });

                    // Delete summary chunks from library
                    if (summaryChunksToDelete.length > 0) {
                        summaryChunksToDelete.forEach(summaryHash => {
                            delete collection[summaryHash];
                            if (currentViewingChunks[summaryHash]) {
                                delete currentViewingChunks[summaryHash];
                            }
                        });

                        console.log(`🧹 Cleaned up ${summaryChunksToDelete.length} summary chunk(s)`);

                        // Delete from vector DB
                        apiDeleteVectorItems(currentViewingCollection, summaryChunksToDelete)
                            .then(() => {
                                toastr.info(`Removed ${summaryChunksToDelete.length} summary vector(s)`);
                                saveSettingsDebounced();
                            })
                            .catch(error => {
                                console.error('Failed to delete summary vectors:', error);
                                toastr.warning('Summary disabled but vectors may still exist');
                            });
                    }
                }
            }

            // Also update the scene object in chat_metadata if this is a scene chunk
            if (chunk.metadata?.sceneIndex !== undefined) {
                const scenes = getScenes();
                const scene = scenes[chunk.metadata.sceneIndex];
                if (scene) {
                    scene.summaryVector = chunk.summaryVector;
                    saveScenes();
                }
            }
        }
    });

    // Summary vector toggle removed - replaced with Summary Vectors Select2 (handled in initializeSummaryVectorsSelect)
    // AI summary generation removed - Summary Vectors are now user-defined via Select2

    // Importance slider
    container.off('input', '.ragbooks-importance-slider').on('input', '.ragbooks-importance-slider', function() {
        const hash = $(this).data('hash');
        const value = parseInt($(this).val());

        $(`.ragbooks-importance-value[data-hash="${hash}"]`).text(value + '%');

        if (currentViewingChunks[hash]) {
            currentViewingChunks[hash].importance = value;
            hasUnsavedChunkChanges = true;
        }
    });

    // Conditions enabled
    container.off('change', '.ragbooks-conditions-enabled').on('change', '.ragbooks-conditions-enabled', function() {
        const hash = $(this).data('hash');
        const enabled = $(this).is(':checked');

        const chunk = currentViewingChunks[hash];
        if (chunk) {
            if (!chunk.conditions) chunk.conditions = { enabled: false, mode: 'AND', rules: [] };
            chunk.conditions.enabled = enabled;
            hasUnsavedChunkChanges = true;

            // Dynamically create or remove the conditions panel
            const $splitRight = $(this).closest('.ragbooks-split-right');
            let $existingPanel = $splitRight.closest('.ragbooks-horizontal-split').next('.ragbooks-conditions-panel');

            if (enabled && !$existingPanel.length) {
                // Create the panel
                const panelHTML = `
                <div class="ragbooks-conditions-panel" data-hash="${hash}" style="margin-bottom: 12px; padding: 12px; background: var(--black10a); border-radius: 6px;">
                    <div style="margin-bottom: 8px;">
                        <label style="font-size: 11px; opacity: 0.7; text-transform: uppercase;">Condition Mode</label>
                        <select class="text_pole ragbooks-conditions-mode" data-hash="${hash}" style="width: 100%; padding: 6px;">
                            <option value="AND" ${chunk.conditions?.mode === 'AND' ? 'selected' : ''}>ALL conditions must match (AND)</option>
                            <option value="OR" ${chunk.conditions?.mode === 'OR' ? 'selected' : ''}>ANY condition can match (OR)</option>
                        </select>
                    </div>

                    <div class="ragbooks-conditions-list" data-hash="${hash}">
                    </div>

                    <button type="button" class="menu_button ragbooks-condition-add" data-hash="${hash}" style="width: 100%; margin-top: 6px;">
                        <i class="fa-solid fa-plus"></i> Add Condition
                    </button>
                </div>
                `;
                $splitRight.closest('.ragbooks-horizontal-split').after(panelHTML);
                toastr.info('Conditions panel opened. Add rules below to control when this chunk activates.', 'Conditional Activation');
            } else if (!enabled && $existingPanel.length) {
                // Remove the panel
                $existingPanel.remove();
                toastr.info('Conditions disabled. This chunk will always activate during search.', 'Conditional Activation');
            }
        }
    });

    // Conditions mode
    container.off('change', '.ragbooks-conditions-mode').on('change', '.ragbooks-conditions-mode', function() {
        const hash = $(this).data('hash');
        const mode = $(this).val();

        const chunk = currentViewingChunks[hash];
        if (chunk?.conditions) {
            chunk.conditions.mode = mode;
            hasUnsavedChunkChanges = true;
        }
    });

    // Add condition
    container.off('click', '.ragbooks-condition-add').on('click', '.ragbooks-condition-add', function() {
        const hash = $(this).data('hash');
        const chunk = currentViewingChunks[hash];

        if (chunk) {
            if (!chunk.conditions) chunk.conditions = { enabled: true, mode: 'AND', rules: [] };
            chunk.conditions.rules.push({ type: 'keyword', value: '', negate: false });
            hasUnsavedChunkChanges = true;
            refreshConditionsList(hash, chunk);
        }
    });

    // Remove condition
    container.off('click', '.ragbooks-condition-remove').on('click', '.ragbooks-condition-remove', function() {
        const hash = $(this).data('hash');
        const idx = $(this).data('idx');
        const chunk = currentViewingChunks[hash];

        if (chunk?.conditions) {
            chunk.conditions.rules.splice(idx, 1);
            hasUnsavedChunkChanges = true;
            refreshConditionsList(hash, chunk);
        }
    });

    // Condition type change
    container.off('change', '.ragbooks-condition-type').on('change', '.ragbooks-condition-type', function() {
        const hash = $(this).data('hash');
        const idx = $(this).data('idx');
        const type = $(this).val();
        const chunk = currentViewingChunks[hash];

        if (chunk?.conditions?.rules[idx]) {
            chunk.conditions.rules[idx].type = type;
            chunk.conditions.rules[idx].value = '';
            hasUnsavedChunkChanges = true;

            const $container = $(`.ragbooks-condition-value-container[data-hash="${hash}"][data-idx="${idx}"]`);
            $container.html(generateConditionValueInput(hash, idx, chunk.conditions.rules[idx]));
        }
    });

    // Condition value change
    container.off('input change', '.ragbooks-condition-value').on('input change', '.ragbooks-condition-value', function() {
        const hash = $(this).data('hash');
        const idx = $(this).data('idx');
        const value = $(this).val();
        const chunk = currentViewingChunks[hash];

        if (chunk?.conditions?.rules[idx]) {
            chunk.conditions.rules[idx].value = value;
            hasUnsavedChunkChanges = true;
        }
    });

    // Time of day value change
    container.off('change', '.ragbooks-condition-value-start, .ragbooks-condition-value-end').on('change', '.ragbooks-condition-value-start, .ragbooks-condition-value-end', function() {
        const hash = $(this).data('hash');
        const idx = $(this).data('idx');

        const $container = $(this).parent();
        const start = $container.find('.ragbooks-condition-value-start').val();
        const end = $container.find('.ragbooks-condition-value-end').val();
        const value = `${start}-${end}`;

        const chunk = currentViewingChunks[hash];
        if (chunk?.conditions?.rules[idx]) {
            chunk.conditions.rules[idx].value = value;
            hasUnsavedChunkChanges = true;
        }
    });

    // Condition negate
    container.off('change', '.ragbooks-condition-negate').on('change', '.ragbooks-condition-negate', function() {
        const hash = $(this).data('hash');
        const idx = $(this).data('idx');
        const negate = $(this).is(':checked');
        const chunk = currentViewingChunks[hash];

        if (chunk?.conditions?.rules[idx]) {
            chunk.conditions.rules[idx].negate = negate;
            hasUnsavedChunkChanges = true;
        }
    });

    // Group name
    container.off('input', '.ragbooks-group-name').on('input', '.ragbooks-group-name', function() {
        const hash = $(this).data('hash');
        const name = $(this).val().trim();

        $(`.ragbooks-group-keywords-section[data-hash="${hash}"]`).toggle(!!name);

        const chunk = currentViewingChunks[hash];
        if (chunk) {
            if (name) {
                if (!chunk.chunkGroup) chunk.chunkGroup = {};
                chunk.chunkGroup.name = name;
            } else {
                delete chunk.chunkGroup;
            }
            hasUnsavedChunkChanges = true;
        }
    });

    // Group keywords
    container.off('input', '.ragbooks-group-keywords').on('input', '.ragbooks-group-keywords', function() {
        const hash = $(this).data('hash');
        const keywordsText = $(this).val().trim();
        const keywords = keywordsText ? keywordsText.split(',').map(k => k.trim()).filter(k => k) : [];

        const chunk = currentViewingChunks[hash];
        if (chunk?.chunkGroup) {
            chunk.chunkGroup.groupKeywords = keywords;
            hasUnsavedChunkChanges = true;
        }
    });

    // Group required
    container.off('change', '.ragbooks-group-required').on('change', '.ragbooks-group-required', function() {
        const hash = $(this).data('hash');
        const required = $(this).is(':checked');

        const chunk = currentViewingChunks[hash];
        if (chunk?.chunkGroup) {
            chunk.chunkGroup.requiresGroupMember = required;
            hasUnsavedChunkChanges = true;
        }
    });

    // Enable summarization
    container.off('change', '.ragbooks-enable-chunk-summary').on('change', '.ragbooks-enable-chunk-summary', function() {
        const hash = $(this).data('hash');
        const enabled = $(this).is(':checked');

        $(`.ragbooks-summary-style-section[data-hash="${hash}"]`).toggle(enabled);

        const chunk = currentViewingChunks[hash];
        if (chunk) {
            if (!chunk.metadata) chunk.metadata = {};
            chunk.metadata.enableSummary = enabled;
            if (enabled && !chunk.metadata.summaryStyle) {
                chunk.metadata.summaryStyle = 'concise';
            }
            hasUnsavedChunkChanges = true;
        }
    });

    // Generate Summary Now button
    container.off('click', '.ragbooks-generate-summary-now').on('click', '.ragbooks-generate-summary-now', async function() {
        const $button = $(this);
        const hash = $button.data('hash');
        const chunk = currentViewingChunks[hash];

        if (!chunk) {
            toastr.error('Chunk not found', 'RAGBooks');
            return;
        }

        if (!chunk.text || chunk.text.trim().length === 0) {
            toastr.warning('Cannot generate summary for empty chunk', 'RAGBooks');
            return;
        }

        // Get the selected summary style
        const style = $(`.ragbooks-summary-style[data-hash="${hash}"]`).val() || 'concise';

        // Disable button and show loading state
        $button.prop('disabled', true);
        const originalHTML = $button.html();
        $button.html('<i class="fa-solid fa-spinner fa-spin"></i> Generating...');

        try {
            console.log(`[RAGBooks] Generating ${style} summary for chunk ${hash}...`);

            // Import and call the summarization function
            const { generateSummaryForChunk } = await import('./summarization.js');
            const summary = await generateSummaryForChunk(chunk.text, style);

            if (summary) {
                // Store the summary
                chunk.summary = summary;
                chunk.summaryVector = true; // Enable dual-vector search

                // Update the summary vectors section with the new summary
                const $summarySelect = $(`.ragbooks-summary-vectors-select[data-hash="${hash}"]`);
                if ($summarySelect.length) {
                    // Add as a new option if not already present
                    if (!chunk.summaryVectors) chunk.summaryVectors = [];
                    if (!chunk.summaryVectors.includes(summary)) {
                        chunk.summaryVectors.push(summary);
                        const option = new Option(summary, summary, true, true);
                        $summarySelect.append(option).trigger('change');
                    }
                }

                hasUnsavedChunkChanges = true;
                toastr.success(`Summary generated: "${summary.substring(0, 50)}..."`, 'RAGBooks');
                console.log(`[RAGBooks] Summary generated:`, summary);
            } else {
                toastr.error('Failed to generate summary', 'RAGBooks');
            }
        } catch (error) {
            console.error('[RAGBooks] Error generating summary:', error);
            toastr.error(`Error: ${error.message}`, 'RAGBooks');
        } finally {
            // Restore button state
            $button.prop('disabled', false);
            $button.html(originalHTML);
        }
    });

    // Summary style
    container.off('change', '.ragbooks-summary-style').on('change', '.ragbooks-summary-style', function() {
        const hash = $(this).data('hash');
        const style = $(this).val();

        const chunk = currentViewingChunks[hash];
        if (chunk?.metadata) {
            chunk.metadata.summaryStyle = style;
            hasUnsavedChunkChanges = true;
        }
    });

    // Enable metadata
    container.off('change', '.ragbooks-enable-chunk-metadata').on('change', '.ragbooks-enable-chunk-metadata', function() {
        const hash = $(this).data('hash');
        const enabled = $(this).is(':checked');

        const chunk = currentViewingChunks[hash];
        if (chunk) {
            if (!chunk.metadata) chunk.metadata = {};
            chunk.metadata.enableMetadata = enabled;
            hasUnsavedChunkChanges = true;
        }
    });
}

/**
 * Populate character dropdown with available characters
 */
async function populateCharacterDropdown() {
    const dropdown = $('#ragbooks_character_select');
    dropdown.empty().append('<option value="">-- Select a Character --</option>');

    try {
        const context = getContext();
        const characters = context.characters;

        if (characters && characters.length > 0) {
            characters.forEach(char => {
                dropdown.append(`<option value="${char.avatar}">${char.name}</option>`);
            });
        } else {
            dropdown.append('<option value="">No characters found</option>');
        }
    } catch (error) {
        console.error('Failed to load characters:', error);
        dropdown.empty().append('<option value="">Error loading characters</option>');
        toastr.error('Failed to load characters');
    }
}

/**
 * Get inline config form HTML for a source type
 */
function getInlineConfigForm(sourceType) {
    let formHTML = '<div class="ragbooks-config-section">';

    switch (sourceType) {
        case 'lorebook':
            formHTML += `
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Lorebook Source</span>
                    </label>
                    <select id="ragbooks_lorebook_source_type" class="ragbooks-select">
                        <option value="existing">From Library</option>
                        <option value="upload">Upload File</option>
                    </select>
                    <div class="ragbooks-help-text">Choose a lorebook from library or upload a new one</div>
                </div>

                <div id="ragbooks_lorebook_existing_section">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Select Lorebook</span>
                        </label>
                        <select id="ragbooks_lorebook_select" class="ragbooks-select">
                            <option value="">-- Select a Lorebook --</option>
                        </select>
                        <div class="ragbooks-help-text">Choose a lorebook to vectorize</div>
                    </div>
                </div>

                <div id="ragbooks_lorebook_upload_section" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Upload Lorebook File</span>
                        </label>
                        <input type="file" id="ragbooks_lorebook_file" class="ragbooks-select" accept=".json,.lorebook" style="display: none;">
                        <div class="ragbooks-file-upload-wrapper">
                            <div class="ragbooks-dropzone" id="ragbooks_lorebook_dropzone">
                                <div class="ragbooks-dropzone-icon">
                                    <i class="fa-solid fa-cloud-arrow-up"></i>
                                </div>
                                <div class="ragbooks-dropzone-text">Drop lorebook file here</div>
                                <div class="ragbooks-dropzone-hint">or click to browse (.json, .lorebook)</div>
                            </div>
                            <button type="button" class="ragbooks-file-upload-btn" id="ragbooks_lorebook_upload_btn">
                                <i class="fa-solid fa-file-arrow-up"></i>
                                Choose Lorebook File
                            </button>
                            <div id="ragbooks_lorebook_file_list" class="ragbooks-file-list"></div>
                        </div>
                        <div class="ragbooks-help-text">Upload a .json or .lorebook file</div>
                    </div>
                </div>
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Chunking Strategy</span>
                    </label>
                    <select id="ragbooks_chunking_strategy" class="ragbooks-select">
                        <option value="per_entry">Whole Entries (one chunk per entry)</option>
                        <option value="paragraph">Paragraph Breaks (split on \\n\\n)</option>
                        <option value="natural">Smart Size (size-limited, intelligent boundaries)</option>
                        <option value="size">Fixed Size (hard size limit)</option>
                        <option value="semantic">🧠 Semantic (AI-powered topic detection)</option>
                        <option value="sliding">🪟 Sliding Window (sentence-aware overlap)</option>
                    </select>
                    <div class="ragbooks-help-text">
                        <strong>Whole Entries:</strong> Each lorebook entry becomes one chunk (recommended for most lorebooks)<br>
                        <strong>Paragraph Breaks:</strong> Splits long entries at double newlines \\n\\n<br>
                        <strong>Smart Size:</strong> Targets ~X chars, breaks at natural boundaries (paragraphs/sentences)<br>
                        <strong>Fixed Size:</strong> Hard character limit with overlap (less intelligent splitting)<br>
                        <strong>🧠 Semantic:</strong> Uses AI embeddings to detect topic shifts (automatic, intelligent, uses more API tokens)<br>
                        <strong>🪟 Sliding Window:</strong> Fixed-size window with sentence-aware boundaries and % overlap (preserves context)
                    </div>
                </div>

                <!-- Chunk Size Controls (only for natural vectorization) -->
                <div id="ragbooks_lorebook_size_controls" style="display: none;">
                    <div class="ragbooks-setting-item ragbooks-slider-container">
                        <div class="ragbooks-slider-header">
                            <span class="ragbooks-slider-icon">📏</span>
                            <span class="ragbooks-slider-title">Chunk Size: <span id="ragbooks_lorebook_chunk_size_value">400</span> chars</span>
                        </div>
                        <div class="ragbooks-slider-hint">Target size for each chunk (applies to natural vectorization)</div>
                        <input type="range" id="ragbooks_lorebook_chunk_size" class="ragbooks-slider" min="200" max="1000" step="50" value="400">
                    </div>

                    <div class="ragbooks-setting-item ragbooks-slider-container">
                        <div class="ragbooks-slider-header">
                            <span class="ragbooks-slider-icon">🔄</span>
                            <span class="ragbooks-slider-title">Chunk Overlap: <span id="ragbooks_lorebook_chunk_overlap_value">50</span> chars</span>
                        </div>
                        <div class="ragbooks-slider-hint">How much chunks overlap (helps preserve context across boundaries). Set to 0 for no overlap (clean cuts).</div>
                        <input type="range" id="ragbooks_lorebook_chunk_overlap" class="ragbooks-slider" min="0" max="200" step="10" value="50">
                    </div>
                </div>

                <!-- Text Cleaning Settings -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">🧹 Text Cleaning Mode</span>
                    </label>
                    <select id="ragbooks_lorebook_cleaning_mode" class="ragbooks-select">
                        <option value="none">None (Keep Original)</option>
                        <option value="basic">Basic (Remove Scripts/Styles)</option>
                        <option value="balanced" selected>Balanced (Remove All HTML)</option>
                        <option value="aggressive">Aggressive (Pure Text Only)</option>
                    </select>
                    <div class="ragbooks-help-text">
                        <strong>None:</strong> No cleaning<br>
                        <strong>Basic:</strong> Remove scripts, styles, hidden elements<br>
                        <strong>Balanced:</strong> Remove all HTML tags and code blocks<br>
                        <strong>Aggressive:</strong> Strip all markup, formatting, URLs
                    </div>
                </div>

                <div id="ragbooks_lorebook_cleaning_patterns" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Custom Cleaning Patterns</span>
                        </label>
                        <select id="ragbooks_lorebook_custom_patterns" class="ragbooks-select" multiple="multiple">
                            <!-- Populated dynamically from ragState.textCleaning -->
                        </select>
                        <div class="ragbooks-help-text">Add custom regex patterns to supplement the cleaning mode</div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 8px;">
                        <button type="button" class="menu_button ragbooks-add-pattern" data-source="lorebook" style="flex: 1;">
                            <i class="fa-solid fa-plus"></i> Add Pattern
                        </button>
                        <button type="button" class="menu_button ragbooks-view-patterns" data-source="lorebook" style="flex: 1;">
                            <i class="fa-solid fa-eye"></i> View All
                        </button>
                    </div>
                </div>

                <!-- Summarization Settings -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-toggle">
                        <input type="checkbox" id="ragbooks_lorebook_summarize_chunks">
                        <span class="ragbooks-toggle-slider"></span>
                        <span class="ragbooks-toggle-label">📝 Summarize Chunks</span>
                    </label>
                    <div class="ragbooks-help-text">Generate AI summaries for better semantic matching (dual-vector search: summary + content)</div>
                </div>

                <div id="ragbooks_lorebook_summary_settings" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Summary Style</span>
                        </label>
                        <select id="ragbooks_lorebook_summary_style" class="ragbooks-select">
                            <option value="concise">Concise (1-2 sentences)</option>
                            <option value="detailed">Detailed (paragraph)</option>
                            <option value="keywords">Keywords Only</option>
                            <option value="extractive">Extractive (key quotes)</option>
                        </select>
                        <div class="ragbooks-help-text">How the AI should summarize each chunk</div>
                    </div>

                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_lorebook_per_chunk_summary">
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">🎯 Per-Chunk Summary Control</span>
                        </label>
                        <div class="ragbooks-help-text">Allow individual chunks to have summarization toggled on/off after vectorization</div>
                    </div>
                </div>

                <!-- Metadata Extraction -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-toggle">
                        <input type="checkbox" id="ragbooks_lorebook_extract_metadata" checked>
                        <span class="ragbooks-toggle-slider"></span>
                        <span class="ragbooks-toggle-label">🏷️ Extract Metadata</span>
                    </label>
                    <div class="ragbooks-help-text">Extract names, locations, topics from content for enhanced search</div>
                </div>

                <div id="ragbooks_lorebook_metadata_settings" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_lorebook_per_chunk_metadata">
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">🎯 Per-Chunk Metadata Control</span>
                        </label>
                        <div class="ragbooks-help-text">Allow individual chunks to have metadata extraction toggled on/off after vectorization</div>
                    </div>
                </div>

                <div class="ragbooks-setting-item">
                    <label class="ragbooks-toggle">
                        <input type="checkbox" id="ragbooks_include_disabled">
                        <span class="ragbooks-toggle-slider"></span>
                        <span class="ragbooks-toggle-label">Include Disabled Entries</span>
                    </label>
                </div>
            `;
            break;

        case 'character':
            formHTML += `
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Character Source</span>
                    </label>
                    <select id="ragbooks_character_source_type" class="ragbooks-select">
                        <option value="existing">From Library</option>
                        <option value="upload">Upload File</option>
                    </select>
                    <div class="ragbooks-help-text">Choose a character from library or upload a new one</div>
                </div>

                <div id="ragbooks_character_existing_section">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Select Character</span>
                        </label>
                        <select id="ragbooks_character_select" class="ragbooks-select">
                            <option value="">-- Select a Character --</option>
                        </select>
                        <div class="ragbooks-help-text">Choose a character to vectorize</div>
                    </div>
                </div>

                <div id="ragbooks_character_upload_section" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Upload Character Card</span>
                        </label>
                        <input type="file" id="ragbooks_character_file" class="ragbooks-select" accept=".png,.json" style="display: none;">
                        <div class="ragbooks-file-upload-wrapper">
                            <div class="ragbooks-dropzone" id="ragbooks_character_dropzone">
                                <div class="ragbooks-dropzone-icon">
                                    <i class="fa-solid fa-cloud-arrow-up"></i>
                                </div>
                                <div class="ragbooks-dropzone-text">Drop character card here</div>
                                <div class="ragbooks-dropzone-hint">or click to browse (.png, .json)</div>
                            </div>
                            <button type="button" class="ragbooks-file-upload-btn" id="ragbooks_character_upload_btn">
                                <i class="fa-solid fa-file-arrow-up"></i>
                                Choose Character Card
                            </button>
                            <div id="ragbooks_character_file_list" class="ragbooks-file-list"></div>
                        </div>
                        <div class="ragbooks-help-text">Upload a character card (.png with embedded JSON or .json file)</div>
                    </div>
                </div>
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Fields to Include</span>
                    </label>
                    <div class="ragbooks-checkbox-group">
                        <label class="ragbooks-checkbox-option">
                            <input type="checkbox" class="ragbooks-char-field" value="description" checked>
                            <span>Description</span>
                        </label>
                        <label class="ragbooks-checkbox-option">
                            <input type="checkbox" class="ragbooks-char-field" value="personality" checked>
                            <span>Personality</span>
                        </label>
                        <label class="ragbooks-checkbox-option">
                            <input type="checkbox" class="ragbooks-char-field" value="scenario" checked>
                            <span>Scenario</span>
                        </label>
                        <label class="ragbooks-checkbox-option">
                            <input type="checkbox" class="ragbooks-char-field" value="first_message">
                            <span>First Message</span>
                        </label>
                        <label class="ragbooks-checkbox-option">
                            <input type="checkbox" class="ragbooks-char-field" value="example_dialogs">
                            <span>Example Dialogs</span>
                        </label>
                        <label class="ragbooks-checkbox-option">
                            <input type="checkbox" class="ragbooks-char-field" value="creator_notes">
                            <span>Creator Notes (V3)</span>
                        </label>
                        <label class="ragbooks-checkbox-option">
                            <input type="checkbox" class="ragbooks-char-field" value="system_prompt">
                            <span>System Prompt (V3)</span>
                        </label>
                        <label class="ragbooks-checkbox-option">
                            <input type="checkbox" class="ragbooks-char-field" value="post_history_instructions">
                            <span>Post-History (V3)</span>
                        </label>
                        <label class="ragbooks-checkbox-option">
                            <input type="checkbox" class="ragbooks-char-field" value="depth_prompt">
                            <span>Depth Prompt (Ext)</span>
                        </label>
                    </div>
                    <div class="ragbooks-help-text">Select which fields to vectorize (V3 = Character Card V3 spec, Ext = Extensions)</div>
                </div>
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Chunking Strategy</span>
                    </label>
                    <select id="ragbooks_chunking_strategy" class="ragbooks-select">
                        <option value="per_field">Whole Fields (one chunk per field)</option>
                        <option value="paragraph">Paragraph Breaks (split on \\n\\n)</option>
                        <option value="natural">Smart Size (size-limited, intelligent boundaries)</option>
                        <option value="semantic">🧠 Semantic (AI-powered topic detection)</option>
                        <option value="sliding">🪟 Sliding Window (sentence-aware overlap)</option>
                    </select>
                    <div class="ragbooks-help-text">
                        <strong>Whole Fields:</strong> Each selected field becomes one chunk (simple, respects field structure)<br>
                        <strong>Paragraph Breaks:</strong> Splits at double newlines \\n\\n (good for well-formatted content)<br>
                        <strong>Smart Size:</strong> Targets ~X chars per chunk, breaks at paragraphs/sentences when possible (requires chunk size setting)<br>
                        <strong>🧠 Semantic:</strong> Uses AI embeddings to detect topic shifts (automatic, intelligent, uses more API tokens)<br>
                        <strong>🪟 Sliding Window:</strong> Fixed-size window with sentence-aware boundaries and % overlap (preserves context)
                    </div>
                </div>

                <!-- Chunk Size Controls (only for natural vectorization) -->
                <div id="ragbooks_character_size_controls" style="display: none;">
                    <div class="ragbooks-setting-item ragbooks-slider-container">
                        <div class="ragbooks-slider-header">
                            <span class="ragbooks-slider-icon">📏</span>
                            <span class="ragbooks-slider-title">Chunk Size: <span id="ragbooks_character_chunk_size_value">400</span> chars</span>
                        </div>
                        <div class="ragbooks-slider-hint">Target size for each chunk (applies to natural vectorization)</div>
                        <input type="range" id="ragbooks_character_chunk_size" class="ragbooks-slider" min="200" max="1000" step="50" value="400">
                    </div>

                    <div class="ragbooks-setting-item ragbooks-slider-container">
                        <div class="ragbooks-slider-header">
                            <span class="ragbooks-slider-icon">🔄</span>
                            <span class="ragbooks-slider-title">Chunk Overlap: <span id="ragbooks_character_chunk_overlap_value">50</span> chars</span>
                        </div>
                        <div class="ragbooks-slider-hint">How much chunks overlap (helps preserve context across boundaries). Set to 0 for no overlap (clean cuts).</div>
                        <input type="range" id="ragbooks_character_chunk_overlap" class="ragbooks-slider" min="0" max="200" step="10" value="50">
                    </div>
                </div>

                <!-- Text Cleaning Settings -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">🧹 Text Cleaning Mode</span>
                    </label>
                    <select id="ragbooks_character_cleaning_mode" class="ragbooks-select">
                        <option value="none">None (Keep Original)</option>
                        <option value="basic">Basic (Remove Scripts/Styles)</option>
                        <option value="balanced" selected>Balanced (Remove All HTML)</option>
                        <option value="aggressive">Aggressive (Pure Text Only)</option>
                    </select>
                    <div class="ragbooks-help-text">
                        <strong>None:</strong> No cleaning<br>
                        <strong>Basic:</strong> Remove scripts, styles, hidden elements<br>
                        <strong>Balanced:</strong> Remove all HTML tags and code blocks<br>
                        <strong>Aggressive:</strong> Strip all markup, formatting, URLs
                    </div>
                </div>

                <div id="ragbooks_character_cleaning_patterns" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Custom Cleaning Patterns</span>
                        </label>
                        <select id="ragbooks_character_custom_patterns" class="ragbooks-select" multiple="multiple">
                            <!-- Populated dynamically from ragState.textCleaning -->
                        </select>
                        <div class="ragbooks-help-text">Add custom regex patterns to supplement the cleaning mode</div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 8px;">
                        <button type="button" class="menu_button ragbooks-add-pattern" data-source="character" style="flex: 1;">
                            <i class="fa-solid fa-plus"></i> Add Pattern
                        </button>
                        <button type="button" class="menu_button ragbooks-view-patterns" data-source="character" style="flex: 1;">
                            <i class="fa-solid fa-eye"></i> View All
                        </button>
                    </div>
                </div>

                <!-- Summarization Settings -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-toggle">
                        <input type="checkbox" id="ragbooks_character_summarize_chunks">
                        <span class="ragbooks-toggle-slider"></span>
                        <span class="ragbooks-toggle-label">📝 Summarize Chunks</span>
                    </label>
                    <div class="ragbooks-help-text">Generate AI summaries for better semantic matching (dual-vector search: summary + content)</div>
                </div>

                <div id="ragbooks_character_summary_settings" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Summary Style</span>
                        </label>
                        <select id="ragbooks_character_summary_style" class="ragbooks-select">
                            <option value="concise">Concise (1-2 sentences)</option>
                            <option value="detailed">Detailed (paragraph)</option>
                            <option value="keywords">Keywords Only</option>
                            <option value="extractive">Extractive (key quotes)</option>
                        </select>
                        <div class="ragbooks-help-text">How the AI should summarize each chunk</div>
                    </div>

                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_character_per_chunk_summary">
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">🎯 Per-Chunk Summary Control</span>
                        </label>
                        <div class="ragbooks-help-text">Allow individual chunks to have summarization toggled on/off after vectorization</div>
                    </div>
                </div>

                <!-- Metadata Extraction -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-toggle">
                        <input type="checkbox" id="ragbooks_character_extract_metadata" checked>
                        <span class="ragbooks-toggle-slider"></span>
                        <span class="ragbooks-toggle-label">🏷️ Extract Metadata</span>
                    </label>
                    <div class="ragbooks-help-text">Extract names, locations, topics from content for enhanced search</div>
                </div>

                <div id="ragbooks_character_metadata_settings" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_character_per_chunk_metadata">
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">🎯 Per-Chunk Metadata Control</span>
                        </label>
                        <div class="ragbooks-help-text">Allow individual chunks to have metadata extraction toggled on/off after vectorization</div>
                    </div>
                </div>
            `;
            break;

        case 'url':
            formHTML += `
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Website URL</span>
                    </label>
                    <input type="url" id="ragbooks_url_input" class="ragbooks-select" placeholder="https://example.com/page" style="padding: 10px 12px;">
                    <div class="ragbooks-help-text">Enter the URL of the webpage you want to vectorize (HTML will be cleaned automatically)</div>
                </div>

                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Collection Name (Optional)</span>
                    </label>
                    <input type="text" id="ragbooks_url_name" class="ragbooks-select" placeholder="Auto-filled from domain" style="padding: 10px 12px;">
                    <div class="ragbooks-help-text">Give this URL collection a custom name (defaults to domain name)</div>
                </div>

                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Chunking Strategy</span>
                    </label>
                    <select id="ragbooks_chunking_strategy" class="ragbooks-select">
                        <option value="paragraph">By Paragraph (Recommended)</option>
                        <option value="size">Fixed Size (~400 chars)</option>
                        <option value="natural">Natural Vectorization</option>
                    </select>
                    <div class="ragbooks-help-text">How to split the webpage content into chunks</div>
                </div>

                <!-- Chunk Size Controls (for size or natural strategies) -->
                <div id="ragbooks_url_size_controls" style="display: none;">
                    <div class="ragbooks-setting-item ragbooks-slider-container">
                        <div class="ragbooks-slider-header">
                            <span class="ragbooks-slider-icon">📏</span>
                            <span class="ragbooks-slider-title">Chunk Size: <span id="ragbooks_url_chunk_size_value">400</span> chars</span>
                        </div>
                        <div class="ragbooks-slider-hint">Target size for each chunk</div>
                        <input type="range" id="ragbooks_url_chunk_size" class="ragbooks-slider" min="200" max="1000" step="50" value="400">
                    </div>

                    <div class="ragbooks-setting-item ragbooks-slider-container">
                        <div class="ragbooks-slider-header">
                            <span class="ragbooks-slider-icon">🔄</span>
                            <span class="ragbooks-slider-title">Chunk Overlap: <span id="ragbooks_url_chunk_overlap_value">50</span> chars</span>
                        </div>
                        <div class="ragbooks-slider-hint">How much chunks overlap (helps preserve context across boundaries). Set to 0 for no overlap (clean cuts).</div>
                        <input type="range" id="ragbooks_url_chunk_overlap" class="ragbooks-slider" min="0" max="200" step="10" value="50">
                    </div>
                </div>

                <!-- Text Cleaning Settings -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">🧹 Text Cleaning Mode</span>
                    </label>
                    <select id="ragbooks_url_cleaning_mode" class="ragbooks-select">
                        <option value="none">None (Keep Original)</option>
                        <option value="basic">Basic (Remove Scripts/Styles)</option>
                        <option value="balanced" selected>Balanced (Remove All HTML)</option>
                        <option value="aggressive">Aggressive (Pure Text Only)</option>
                    </select>
                    <div class="ragbooks-help-text">
                        <strong>None:</strong> No cleaning<br>
                        <strong>Basic:</strong> Remove scripts, styles, hidden elements<br>
                        <strong>Balanced:</strong> Remove all HTML tags and code blocks<br>
                        <strong>Aggressive:</strong> Strip all markup, formatting, URLs
                    </div>
                </div>

                <div id="ragbooks_url_cleaning_patterns" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Custom Cleaning Patterns</span>
                        </label>
                        <select id="ragbooks_url_custom_patterns" class="ragbooks-select" multiple="multiple">
                            <!-- Populated dynamically from ragState.textCleaning -->
                        </select>
                        <div class="ragbooks-help-text">Add custom regex patterns to supplement the cleaning mode</div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 8px;">
                        <button type="button" class="menu_button ragbooks-add-pattern" data-source="url" style="flex: 1;">
                            <i class="fa-solid fa-plus"></i> Add Pattern
                        </button>
                        <button type="button" class="menu_button ragbooks-view-patterns" data-source="url" style="flex: 1;">
                            <i class="fa-solid fa-eye"></i> View All
                        </button>
                    </div>
                </div>

                <!-- Summarization Settings -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-toggle">
                        <input type="checkbox" id="ragbooks_url_summarize_chunks">
                        <span class="ragbooks-toggle-slider"></span>
                        <span class="ragbooks-toggle-label">📝 Summarize Chunks</span>
                    </label>
                    <div class="ragbooks-help-text">Generate AI summaries for better semantic matching (dual-vector search: summary + content)</div>
                </div>

                <div id="ragbooks_url_summary_settings" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Summary Style</span>
                        </label>
                        <select id="ragbooks_url_summary_style" class="ragbooks-select">
                            <option value="concise">Concise (1-2 sentences)</option>
                            <option value="detailed">Detailed (paragraph)</option>
                            <option value="keywords">Keywords Only</option>
                            <option value="extractive">Extractive (key quotes)</option>
                        </select>
                        <div class="ragbooks-help-text">How the AI should summarize each chunk</div>
                    </div>

                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_url_per_chunk_summary">
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">🎯 Per-Chunk Summary Control</span>
                        </label>
                        <div class="ragbooks-help-text">Allow individual chunks to have summarization toggled on/off after vectorization</div>
                    </div>
                </div>

                <!-- Metadata Extraction -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-toggle">
                        <input type="checkbox" id="ragbooks_url_extract_metadata" checked>
                        <span class="ragbooks-toggle-slider"></span>
                        <span class="ragbooks-toggle-label">🏷️ Extract Metadata</span>
                    </label>
                    <div class="ragbooks-help-text">Extract names, locations, topics from content for enhanced search</div>
                </div>

                <div id="ragbooks_url_metadata_settings" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_url_per_chunk_metadata">
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">🎯 Per-Chunk Metadata Control</span>
                        </label>
                        <div class="ragbooks-help-text">Allow individual chunks to have metadata extraction toggled on/off after vectorization</div>
                    </div>
                </div>
            `;
            break;

        case 'chat':
            // Get current chat's vectorization settings from chat_metadata
            const chatVectorSettings = chat_metadata.ragbooks_vector_config || {};

            formHTML += `
                <div class="ragbooks-chat-notice" style="margin-bottom: 16px; padding: 12px; background: var(--black30a, rgba(0,0,0,0.3)); border-left: 3px solid var(--SmartThemeQuoteColor); border-radius: 4px;">
                    <div style="font-weight: 600; margin-bottom: 4px;">💬 Chat-Specific Settings</div>
                    <div style="font-size: 0.9em; opacity: 0.85;">These settings are unique to this chat and stored in chat metadata (not global)</div>
                </div>

                <!-- Core Chat Settings -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Scene Mode</span>
                    </label>
                    <select id="ragbooks_scene_mode" class="ragbooks-select">
                        <option value="all" ${chatVectorSettings.sceneMode === 'all' ? 'selected' : ''}>Everything (All Messages)</option>
                        <option value="scenes_only" ${chatVectorSettings.sceneMode === 'scenes_only' ? 'selected' : ''}>Only Marked Scenes</option>
                        <option value="scenes_boosted" ${chatVectorSettings.sceneMode === 'scenes_boosted' ? 'selected' : ''}>Everything + Boost Scenes</option>
                    </select>
                    <div class="ragbooks-help-text">
                        <strong>Everything:</strong> Vectorize all messages<br>
                        <strong>Only Scenes:</strong> Only vectorize marked scenes<br>
                        <strong>Boost Scenes:</strong> Vectorize all, but marked scenes get 1.5x relevance weight
                    </div>
                </div>

                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Chunking Strategy</span>
                    </label>
                    <select id="ragbooks_chunking_strategy" class="ragbooks-select">
                        <option value="by_scene" ${chatVectorSettings.chunkingStrategy === 'by_scene' ? 'selected' : ''}>Scene Boundaries (if marked with flags)</option>
                        <option value="by_speaker" ${chatVectorSettings.chunkingStrategy === 'by_speaker' ? 'selected' : ''}>Speaker Groups (consecutive messages)</option>
                        <option value="size" ${chatVectorSettings.chunkingStrategy === 'size' ? 'selected' : ''}>Fixed Size (hard character limit)</option>
                        <option value="natural" ${chatVectorSettings.chunkingStrategy === 'natural' ? 'selected' : ''}>Smart Size (size-limited, intelligent boundaries)</option>
                    </select>
                    <div class="ragbooks-help-text">
                        <strong>Scene Boundaries:</strong> Each scene (green flag → red flag) becomes one chunk (requires manual scene marking)<br>
                        <strong>Speaker Groups:</strong> Groups consecutive messages from same character/user (preserves conversation flow)<br>
                        <strong>Fixed Size:</strong> Splits at hard character limit with overlap (simple, predictable sizes)<br>
                        <strong>Smart Size:</strong> Targets ~X chars, breaks at natural boundaries (paragraphs/sentences, requires chunk size setting)
                    </div>
                </div>

                <!-- Advanced Chat Settings Section -->
                <div class="ragbooks-advanced-section" style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.1));">
                    <div style="font-weight: 600; margin-bottom: 12px; color: var(--SmartThemeQuoteColor);">
                        <i class="fa-solid fa-sliders"></i> Advanced Chat Vectorization
                    </div>

                    <!-- Chunk Size Controls (only visible for 'size' chunking strategy) -->
                    <div id="ragbooks_size_controls" style="${chatVectorSettings.chunkingStrategy === 'size' ? '' : 'display: none;'}">
                        <div class="ragbooks-setting-item ragbooks-slider-container">
                            <div class="ragbooks-slider-header">
                                <span class="ragbooks-slider-icon">📏</span>
                                <span class="ragbooks-slider-title">Chunk Size: <span id="ragbooks_chat_chunk_size_value">${chatVectorSettings.chunkSize || 400}</span> chars</span>
                            </div>
                            <div class="ragbooks-slider-hint">Target size for each chunk (applies to size-based chunking)</div>
                            <input type="range" id="ragbooks_chat_chunk_size" class="ragbooks-slider" min="200" max="1000" step="50" value="${chatVectorSettings.chunkSize || 400}">
                        </div>

                        <div class="ragbooks-setting-item ragbooks-slider-container">
                            <div class="ragbooks-slider-header">
                                <span class="ragbooks-slider-icon">🔄</span>
                                <span class="ragbooks-slider-title">Chunk Overlap: <span id="ragbooks_chat_chunk_overlap_value">${chatVectorSettings.chunkOverlap || 50}</span> chars</span>
                            </div>
                            <div class="ragbooks-slider-hint">How much chunks overlap (helps preserve context across boundaries)</div>
                            <input type="range" id="ragbooks_chat_chunk_overlap" class="ragbooks-slider" min="0" max="200" step="10" value="${chatVectorSettings.chunkOverlap || 50}">
                        </div>
                    </div>

                    <!-- Name Format -->
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Name Format</span>
                        </label>
                        <select id="ragbooks_name_format" class="ragbooks-select">
                            <option value="actual" ${chatVectorSettings.nameFormat === 'actual' || !chatVectorSettings.nameFormat ? 'selected' : ''}>Actual Names (e.g., "Alice", "Bob")</option>
                            <option value="macros" ${chatVectorSettings.nameFormat === 'macros' ? 'selected' : ''}>Macros ({{user}}, {{char}})</option>
                        </select>
                        <div class="ragbooks-help-text">How to store speaker names in vectorized text</div>
                    </div>

                    <!-- Message Filtering -->
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Message Range</span>
                        </label>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                            <div>
                                <input type="number" id="ragbooks_chat_start_msg" class="ragbooks-select" placeholder="Start (optional)" min="0" value="${chatVectorSettings.startMessage || ''}" style="padding: 10px 12px;">
                            </div>
                            <div>
                                <input type="number" id="ragbooks_chat_end_msg" class="ragbooks-select" placeholder="End (optional)" min="0" value="${chatVectorSettings.endMessage || ''}" style="padding: 10px 12px;">
                            </div>
                        </div>
                        <div class="ragbooks-help-text">Only vectorize messages in this range (leave empty for all)</div>
                    </div>

                    <!-- Character/Speaker Filtering -->
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Include Message Types</span>
                        </label>
                        <div class="ragbooks-checkbox-group">
                            <label class="ragbooks-checkbox-option">
                                <input type="checkbox" class="ragbooks-chat-msg-type" value="user" ${chatVectorSettings.includeUser !== false ? 'checked' : ''}>
                                <span>User Messages</span>
                            </label>
                            <label class="ragbooks-checkbox-option">
                                <input type="checkbox" class="ragbooks-chat-msg-type" value="char" ${chatVectorSettings.includeChar !== false ? 'checked' : ''}>
                                <span>Character Messages</span>
                            </label>
                            <label class="ragbooks-checkbox-option">
                                <input type="checkbox" class="ragbooks-chat-msg-type" value="system" ${chatVectorSettings.includeSystem === true ? 'checked' : ''}>
                                <span>System Messages</span>
                            </label>
                            <label class="ragbooks-checkbox-option">
                                <input type="checkbox" class="ragbooks-chat-msg-type" value="narrator" ${chatVectorSettings.includeNarrator === true ? 'checked' : ''}>
                                <span>Narrator/OOC</span>
                            </label>
                        </div>
                        <div class="ragbooks-help-text">Filter which message types to include in vectorization</div>
                    </div>

                    <!-- Text Cleaning Settings -->
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">🧹 Text Cleaning Mode</span>
                        </label>
                        <select id="ragbooks_chat_cleaning_mode" class="ragbooks-select">
                            <option value="none">None (Keep Original)</option>
                            <option value="basic" selected>Basic (Remove Scripts/Styles)</option>
                            <option value="balanced">Balanced (Remove All HTML)</option>
                            <option value="aggressive">Aggressive (Pure Text Only)</option>
                        </select>
                        <div class="ragbooks-help-text">
                            <strong>None:</strong> No cleaning<br>
                            <strong>Basic:</strong> Remove scripts, styles, hidden elements<br>
                            <strong>Balanced:</strong> Remove all HTML tags and code blocks<br>
                            <strong>Aggressive:</strong> Strip all markup, formatting, URLs
                        </div>
                    </div>

                    <div id="ragbooks_chat_cleaning_patterns" style="display: none;">
                        <div class="ragbooks-setting-item">
                            <label class="ragbooks-label">
                                <span class="ragbooks-label-text">Custom Cleaning Patterns</span>
                            </label>
                            <select id="ragbooks_chat_custom_patterns" class="ragbooks-select" multiple="multiple">
                                <!-- Populated dynamically from ragState.textCleaning -->
                            </select>
                            <div class="ragbooks-help-text">Add custom regex patterns to supplement the cleaning mode</div>
                        </div>
                        <div style="display: flex; gap: 8px; margin-top: 8px;">
                            <button type="button" class="menu_button ragbooks-add-pattern" data-source="chat" style="flex: 1;">
                                <i class="fa-solid fa-plus"></i> Add Pattern
                            </button>
                            <button type="button" class="menu_button ragbooks-view-patterns" data-source="chat" style="flex: 1;">
                                <i class="fa-solid fa-eye"></i> View All
                            </button>
                        </div>
                    </div>

                    <!-- Summarization Settings -->
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_summarize_chunks" ${chatVectorSettings.summarizeChunks !== false ? 'checked' : ''}>
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">📝 Summarize Chunks</span>
                        </label>
                        <div class="ragbooks-help-text">Generate AI summaries for better semantic matching (dual-vector search: summary + content)</div>
                    </div>

                    <div class="ragbooks-setting-item" id="ragbooks_summary_settings" style="${chatVectorSettings.summarizeChunks !== false ? '' : 'display: none;'}">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Summary Style</span>
                        </label>
                        <select id="ragbooks_summary_style" class="ragbooks-select">
                            <option value="concise" ${chatVectorSettings.summaryStyle === 'concise' ? 'selected' : ''}>Concise (1-2 sentences)</option>
                            <option value="detailed" ${chatVectorSettings.summaryStyle === 'detailed' ? 'selected' : ''}>Detailed (paragraph)</option>
                            <option value="keywords" ${chatVectorSettings.summaryStyle === 'keywords' ? 'selected' : ''}>Keywords Only</option>
                            <option value="extractive" ${chatVectorSettings.summaryStyle === 'extractive' ? 'selected' : ''}>Extractive (key quotes)</option>
                        </select>
                        <div class="ragbooks-help-text">How the AI should summarize each chunk</div>
                    </div>

                    <!-- Recency Weighting -->
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_recency_weighting" ${chatVectorSettings.recencyWeighting === true ? 'checked' : ''}>
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">⏰ Recency Weighting</span>
                        </label>
                        <div class="ragbooks-help-text">Boost relevance of more recent messages (newer = higher score)</div>
                    </div>

                    <div class="ragbooks-setting-item ragbooks-slider-container" id="ragbooks_recency_decay_setting" style="${chatVectorSettings.recencyWeighting === true ? '' : 'display: none;'}">
                        <div class="ragbooks-slider-header">
                            <span class="ragbooks-slider-icon">📉</span>
                            <span class="ragbooks-slider-title">Recency Decay: <span id="ragbooks_recency_decay_value">${chatVectorSettings.recencyDecay || 0.95}</span></span>
                        </div>
                        <div class="ragbooks-slider-hint">How quickly older messages lose relevance (0.9 = fast decay, 0.99 = slow decay)</div>
                        <input type="range" id="ragbooks_recency_decay" class="ragbooks-slider" min="0.85" max="0.99" step="0.01" value="${chatVectorSettings.recencyDecay || 0.95}">
                    </div>

                    <!-- Auto Re-Vectorization -->
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_auto_revector" ${chatVectorSettings.autoRevector === true ? 'checked' : ''}>
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">🔄 Auto Re-Vectorize</span>
                        </label>
                        <div class="ragbooks-help-text">Automatically update vectors when new messages are added</div>
                    </div>

                    <div class="ragbooks-setting-item" id="ragbooks_auto_revector_interval" style="${chatVectorSettings.autoRevector === true ? '' : 'display: none;'}">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Re-Vectorize After</span>
                        </label>
                        <select id="ragbooks_revector_interval" class="ragbooks-select">
                            <option value="1" ${chatVectorSettings.revectorInterval === '1' ? 'selected' : ''}>Every Message</option>
                            <option value="5" ${chatVectorSettings.revectorInterval === '5' ? 'selected' : ''}>Every 5 Messages</option>
                            <option value="10" ${chatVectorSettings.revectorInterval === '10' || !chatVectorSettings.revectorInterval ? 'selected' : ''}>Every 10 Messages</option>
                            <option value="20" ${chatVectorSettings.revectorInterval === '20' ? 'selected' : ''}>Every 20 Messages</option>
                        </select>
                        <div class="ragbooks-help-text">How often to update the vector database</div>
                    </div>

                    <!-- Metadata Extraction -->
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_extract_metadata" ${chatVectorSettings.extractMetadata !== false ? 'checked' : ''}>
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">🏷️ Extract Metadata</span>
                        </label>
                        <div class="ragbooks-help-text">Extract names, locations, topics from messages for enhanced search</div>
                    </div>
                </div>
            `;
            break;

        case 'custom':
            formHTML += `
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Input Method</span>
                    </label>
                    <select id="ragbooks_input_method" class="ragbooks-select">
                        <option value="text">📝 Paste Text</option>
                        <option value="url">🌐 Fetch from URL</option>
                        <option value="wiki">📖 Scrape Wiki Page</option>
                        <option value="youtube">📺 YouTube Transcript</option>
                        <option value="github">📦 GitHub Repository</option>
                        <option value="file">📎 Upload File(s)</option>
                    </select>
                    <div class="ragbooks-help-text">Choose how to provide your document</div>
                </div>

                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Document Name</span>
                    </label>
                    <input type="text" id="ragbooks_doc_name" class="ragbooks-select" placeholder="My Document" style="padding: 10px 12px;">
                    <div class="ragbooks-help-text">Give your document a name (auto-filled for URLs)</div>
                </div>

                <!-- Text Input (default) -->
                <div id="ragbooks_text_input" class="ragbooks-input-container">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Document Text</span>
                        </label>
                        <textarea id="ragbooks_doc_text" class="ragbooks-textarea" placeholder="Paste your document content here..."></textarea>
                        <div class="ragbooks-help-text">Paste the text content you want to vectorize</div>
                    </div>
                </div>

                <!-- URL Input -->
                <div id="ragbooks_url_input" class="ragbooks-input-container" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">URL</span>
                        </label>
                        <input type="url" id="ragbooks_doc_url" class="ragbooks-select" placeholder="https://example.com/article" style="padding: 10px 12px;">
                        <div class="ragbooks-help-text">Enter a webpage URL (HTML will be cleaned automatically)</div>
                    </div>
                </div>

                <!-- Wiki Scraper Input -->
                <div id="ragbooks_wiki_input" class="ragbooks-input-container" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Wiki Type</span>
                        </label>
                        <select id="ragbooks_wiki_type" class="ragbooks-select">
                            <option value="fandom">Fandom Wiki (e.g., baldursgate.fandom.com)</option>
                            <option value="mediawiki">MediaWiki (e.g., en.wikipedia.org)</option>
                        </select>
                    </div>
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Wiki URL</span>
                        </label>
                        <input type="url" id="ragbooks_wiki_url" class="ragbooks-select" placeholder="https://baldursgate.fandom.com/wiki/Main_Page" style="padding: 10px 12px;">
                        <div class="ragbooks-help-text">Full URL to the wiki page (e.g., fandom.com wiki or Wikipedia article)</div>
                    </div>
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Page Filter (Optional)</span>
                        </label>
                        <input type="text" id="ragbooks_wiki_filter" class="ragbooks-select" placeholder="Characters, Locations" style="padding: 10px 12px;">
                        <div class="ragbooks-help-text">
                            <strong>Bulk scraping:</strong> Enter comma-separated page names to scrape multiple pages at once (e.g., "Astarion, Gale, Shadowheart").<br>
                            Leave empty to scrape only the single page from the URL above.<br>
                            <em>Note: Automatic homepage crawling is not supported - page names must be specified manually.</em>
                        </div>
                    </div>
                    <div class="ragbooks-help-text" style="margin-top: 8px; padding: 10px; background: var(--black30a, rgba(0,0,0,0.3)); border-left: 3px solid var(--SmartThemeQuoteColor); border-radius: 4px;">
                        <div style="margin-bottom: 6px;">⚠️ <strong>Requires Server Plugin</strong></div>
                        <div style="font-size: 0.9em;">Install: <a href="https://github.com/SillyTavern/SillyTavern-Fandom-Scraper" target="_blank" rel="noopener noreferrer" style="color: var(--SmartThemeQuoteColor); text-decoration: underline;">SillyTavern-Fandom-Scraper</a></div>
                        <div id="ragbooks_wiki_plugin_status" style="margin-top: 6px; font-size: 0.85em; opacity: 0.8;">
                            <span class="ragbooks-plugin-checking">Checking plugin...</span>
                        </div>
                    </div>
                </div>

                <!-- YouTube Input -->
                <div id="ragbooks_youtube_input" class="ragbooks-input-container" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">YouTube Video URL or ID</span>
                        </label>
                        <input type="text" id="ragbooks_youtube_url" class="ragbooks-select" placeholder="https://youtube.com/watch?v=dQw4w9WgXcQ or dQw4w9WgXcQ" style="padding: 10px 12px;">
                        <div class="ragbooks-help-text">Enter full YouTube URL or just the video ID</div>
                    </div>
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Language (Optional)</span>
                        </label>
                        <input type="text" id="ragbooks_youtube_lang" class="ragbooks-select" placeholder="en" maxlength="2" style="padding: 10px 12px;">
                        <div class="ragbooks-help-text">ISO 639-1 language code (e.g., en, es, fr). Leave empty for auto-detect.</div>
                    </div>
                </div>

                <!-- GitHub Input -->
                <div id="ragbooks_github_input" class="ragbooks-input-container" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">GitHub Repository URL</span>
                        </label>
                        <input type="text" id="ragbooks_github_url" class="ragbooks-select" placeholder="https://github.com/owner/repo" style="padding: 10px 12px;">
                        <div class="ragbooks-help-text">Full GitHub repository URL (e.g., https://github.com/anthropics/claude-code)</div>
                    </div>
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">File Filter (Optional)</span>
                        </label>
                        <input type="text" id="ragbooks_github_filter" class="ragbooks-select" placeholder="*.md, docs/*.txt" style="padding: 10px 12px;">
                        <div class="ragbooks-help-text">Glob patterns to filter files (e.g., *.md for markdown, docs/**/*.txt). Leave empty for README only.</div>
                    </div>
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Branch (Optional)</span>
                        </label>
                        <input type="text" id="ragbooks_github_branch" class="ragbooks-select" placeholder="main" style="padding: 10px 12px;">
                        <div class="ragbooks-help-text">Git branch name. Leave empty for default branch.</div>
                    </div>
                </div>

                <!-- File Upload -->
                <div id="ragbooks_file_input" class="ragbooks-input-container" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Upload File(s)</span>
                        </label>
                        <input type="file" id="ragbooks_doc_file" accept=".txt,.md,.json,.yaml,.yml,.html,.htm" multiple style="display: none;">
                        <div class="ragbooks-file-upload-wrapper">
                            <div class="ragbooks-dropzone" id="ragbooks_doc_dropzone">
                                <div class="ragbooks-dropzone-icon">
                                    <i class="fa-solid fa-cloud-arrow-up"></i>
                                </div>
                                <div class="ragbooks-dropzone-text">Drop documents here</div>
                                <div class="ragbooks-dropzone-hint">or click to browse (multiple files supported)</div>
                            </div>
                            <button type="button" class="ragbooks-file-upload-btn" id="ragbooks_doc_upload_btn">
                                <i class="fa-solid fa-file-arrow-up"></i>
                                Choose Files
                            </button>
                            <div id="ragbooks_doc_file_list" class="ragbooks-file-list"></div>
                        </div>
                        <div class="ragbooks-help-text">Supported: .txt, .md, .json, .yaml, .html (multiple files allowed). PDF/DOCX require server plugin.</div>
                    </div>
                </div>

                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">Chunking Strategy</span>
                    </label>
                    <select id="ragbooks_chunking_strategy" class="ragbooks-select">
                        <option value="paragraph">Paragraph Breaks (split on \n\n)</option>
                        <option value="section">Section Headers (# Markdown or HTML headings)</option>
                        <option value="size">Fixed Size (hard character limit)</option>
                        <option value="natural">Smart Size (size-limited, intelligent boundaries)</option>
                        <option value="semantic">🧠 Semantic (AI-powered topic detection)</option>
                        <option value="sliding">🪟 Sliding Window (sentence-aware overlap)</option>
                    </select>
                    <div class="ragbooks-help-text">
                        <strong>Paragraph Breaks:</strong> Splits at double newlines \n\n (recommended for most documents)<br>
                        <strong>Section Headers:</strong> Splits at Markdown # headers or HTML &lt;h1&gt;-&lt;h6&gt; tags (good for structured docs)<br>
                        <strong>Fixed Size:</strong> Hard character limit with overlap (simple, predictable sizes)<br>
                        <strong>Smart Size:</strong> Targets ~X chars, breaks at natural boundaries (paragraphs/sentences, requires chunk size setting)<br>
                        <strong>🧠 Semantic:</strong> Uses AI embeddings to detect topic shifts (automatic, intelligent, uses more API tokens)<br>
                        <strong>🪟 Sliding Window:</strong> Fixed-size window with sentence-aware boundaries and % overlap (preserves context)
                    </div>
                </div>

                <!-- Chunk Size Controls (only for size/natural strategies) -->
                <div id="ragbooks_custom_size_controls" style="display: none;">
                    <div class="ragbooks-setting-item ragbooks-slider-container">
                        <div class="ragbooks-slider-header">
                            <span class="ragbooks-slider-icon">📏</span>
                            <span class="ragbooks-slider-title">Chunk Size: <span id="ragbooks_custom_chunk_size_value">400</span> chars</span>
                        </div>
                        <div class="ragbooks-slider-hint">Target size for each chunk (applies to size/natural chunking)</div>
                        <input type="range" id="ragbooks_custom_chunk_size" class="ragbooks-slider" min="200" max="1000" step="50" value="400">
                    </div>
                    <div class="ragbooks-setting-item ragbooks-slider-container">
                        <div class="ragbooks-slider-header">
                            <span class="ragbooks-slider-icon">🔄</span>
                            <span class="ragbooks-slider-title">Chunk Overlap: <span id="ragbooks_custom_chunk_overlap_value">50</span> chars</span>
                        </div>
                        <div class="ragbooks-slider-hint">How much chunks overlap (helps preserve context across boundaries). Set to 0 for no overlap (clean cuts).</div>
                        <input type="range" id="ragbooks_custom_chunk_overlap" class="ragbooks-slider" min="0" max="200" step="10" value="50">
                    </div>
                </div>

                <!-- Text Cleaning Settings -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-label">
                        <span class="ragbooks-label-text">🧹 Text Cleaning Mode</span>
                    </label>
                    <select id="ragbooks_custom_cleaning_mode" class="ragbooks-select">
                        <option value="none">None (Keep Original)</option>
                        <option value="basic">Basic (Remove Scripts/Styles)</option>
                        <option value="balanced" selected>Balanced (Remove All HTML)</option>
                        <option value="aggressive">Aggressive (Pure Text Only)</option>
                    </select>
                    <div class="ragbooks-help-text">
                        <strong>None:</strong> No cleaning<br>
                        <strong>Basic:</strong> Remove scripts, styles, hidden elements<br>
                        <strong>Balanced:</strong> Remove all HTML tags and code blocks<br>
                        <strong>Aggressive:</strong> Strip all markup, formatting, URLs
                    </div>
                </div>

                <div id="ragbooks_custom_cleaning_patterns" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Custom Cleaning Patterns</span>
                        </label>
                        <select id="ragbooks_custom_custom_patterns" class="ragbooks-select" multiple="multiple">
                            <!-- Populated dynamically from ragState.textCleaning -->
                        </select>
                        <div class="ragbooks-help-text">Add custom regex patterns to supplement the cleaning mode</div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 8px;">
                        <button type="button" class="menu_button ragbooks-add-pattern" data-source="custom" style="flex: 1;">
                            <i class="fa-solid fa-plus"></i> Add Pattern
                        </button>
                        <button type="button" class="menu_button ragbooks-view-patterns" data-source="custom" style="flex: 1;">
                            <i class="fa-solid fa-eye"></i> View All
                        </button>
                    </div>
                </div>

                <!-- Summarization Settings -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-toggle">
                        <input type="checkbox" id="ragbooks_custom_summarize_chunks">
                        <span class="ragbooks-toggle-slider"></span>
                        <span class="ragbooks-toggle-label">📝 Summarize Chunks</span>
                    </label>
                    <div class="ragbooks-help-text">Generate AI summaries for better semantic matching (dual-vector search: summary + content)</div>
                </div>

                <div id="ragbooks_custom_summary_settings" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-label">
                            <span class="ragbooks-label-text">Summary Style</span>
                        </label>
                        <select id="ragbooks_custom_summary_style" class="ragbooks-select">
                            <option value="concise">Concise (1-2 sentences)</option>
                            <option value="detailed">Detailed (paragraph)</option>
                            <option value="keywords">Keywords Only</option>
                            <option value="extractive">Extractive (key quotes)</option>
                        </select>
                        <div class="ragbooks-help-text">How the AI should summarize each chunk</div>
                    </div>

                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_custom_per_chunk_summary">
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">🎯 Per-Chunk Summary Control</span>
                        </label>
                        <div class="ragbooks-help-text">Allow individual chunks to have summarization toggled on/off after vectorization</div>
                    </div>
                </div>

                <!-- Metadata Extraction -->
                <div class="ragbooks-setting-item">
                    <label class="ragbooks-toggle">
                        <input type="checkbox" id="ragbooks_custom_extract_metadata" checked>
                        <span class="ragbooks-toggle-slider"></span>
                        <span class="ragbooks-toggle-label">🏷️ Extract Metadata</span>
                    </label>
                    <div class="ragbooks-help-text">Extract names, locations, topics from content for enhanced search</div>
                </div>

                <div id="ragbooks_custom_metadata_settings" style="display: none;">
                    <div class="ragbooks-setting-item">
                        <label class="ragbooks-toggle">
                            <input type="checkbox" id="ragbooks_custom_per_chunk_metadata">
                            <span class="ragbooks-toggle-slider"></span>
                            <span class="ragbooks-toggle-label">🎯 Per-Chunk Metadata Control</span>
                        </label>
                        <div class="ragbooks-help-text">Allow individual chunks to have metadata extraction toggled on/off after vectorization</div>
                    </div>
                </div>
            `;
            break;
    }

    // Add action buttons
    formHTML += `
        <div class="ragbooks-config-actions">
            <button class="ragbooks-btn ragbooks-btn-secondary" id="ragbooks_cancel_btn">Cancel</button>
            <button class="ragbooks-btn ragbooks-btn-primary" id="ragbooks_vectorize_btn">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Vectorize
            </button>
        </div>
    </div>`;

    return formHTML;
}

/**
 * Fetch and clean text from a URL using ST's web scraping endpoint
 * @param {string} url - The URL to fetch
 * @returns {Promise<string>} Cleaned text content
 */
async function fetchTextFromUrl(url) {
    try {
        const response = await fetch('/api/search/visit', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ url: url }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();
        const text = await blob.text();

        // Extract plain text from HTML (simple approach)
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');

        // Remove script and style elements
        const scripts = doc.querySelectorAll('script, style, noscript');
        scripts.forEach(el => el.remove());

        // Get text content
        const cleanText = doc.body ? doc.body.innerText : doc.documentElement.textContent;

        // Ensure we have a valid string
        if (!cleanText || typeof cleanText !== 'string') {
            throw new Error('No text content found in the fetched page');
        }

        console.log(`📄 [RAGBooks] Fetched ${cleanText.length} characters from URL: ${url}`);
        return cleanText.trim();
    } catch (error) {
        console.error('📄 [RAGBooks] URL fetch failed:', error);
        throw new Error(`Failed to fetch URL: ${error.message}`);
    }
}

/**
 * Extract domain name from URL for auto-naming
 * @param {string} url - The URL
 * @returns {string} Domain name
 */
function extractDomainFromUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch {
        return 'Web Document';
    }
}

/**
 * Read a file as text
 * @param {File} file - The file to read
 * @returns {Promise<string>} File text content
 */
async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            const text = event.target.result;
            console.log(`📄 [RAGBooks] Read ${text.length} characters from file: ${file.name}`);
            resolve(text);
        };

        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };

        reader.readAsText(file);
    });
}

/**
 * Check if Fandom/MediaWiki plugin is available
 * @param {string} wikiType - 'fandom' or 'mediawiki'
 * @returns {Promise<boolean>} Whether the plugin is available
 */
async function isWikiPluginAvailable(wikiType) {
    try {
        const endpoint = wikiType === 'fandom'
            ? '/api/plugins/fandom/probe'
            : '/api/plugins/fandom/probe-mediawiki';

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        return response.ok;
    } catch (error) {
        console.debug(`📖 [RAGBooks] Wiki plugin probe failed for ${wikiType}:`, error);
        return false;
    }
}

/**
 * Scrape text from a wiki page using ST's wiki scrapers
 * @param {string} wikiType - 'fandom' or 'mediawiki'
 * @param {string} url - The wiki URL
 * @param {string} filter - Optional comma-separated page filter
 * @returns {Promise<string>} Scraped text content
 */
async function scrapeWikiPage(wikiType, url, filter = '') {
    try {
        const endpoint = wikiType === 'fandom'
            ? '/api/plugins/fandom/scrape'
            : '/api/plugins/fandom/scrape-mediawiki';

        // Extract fandom ID for fandom wikis
        let requestBody;
        if (wikiType === 'fandom') {
            const fandomId = extractFandomId(url);
            requestBody = { fandom: fandomId, filter: filter };
        } else {
            requestBody = { url: url, filter: filter };
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        const data = await response.json();

        // Combine all scraped pages
        const combinedContent = data.map((page) =>
            `${String(page.title).trim()}\n\n${String(page.content).trim()}`
        ).join('\n\n\n\n');

        console.log(`📖 [RAGBooks] Scraped ${data.length} pages from ${wikiType} wiki: ${combinedContent.length} characters`);
        return combinedContent;
    } catch (error) {
        console.error('📖 [RAGBooks] Wiki scraping failed:', error);
        throw new Error(`Failed to scrape wiki: ${error.message}`);
    }
}

/**
 * Extract fandom ID from URL (for Fandom wikis)
 * @param {string} url - Fandom wiki URL
 * @returns {string} Fandom ID
 */
function extractFandomId(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.split('.')[0] || url;
    } catch {
        return url;
    }
}

/**
 * Parse YouTube video ID from URL or ID string
 * @param {string} url - YouTube URL or video ID
 * @returns {string} Video ID
 */
function parseYouTubeId(url) {
    // If the URL is already an ID (11 characters, alphanumeric + _ and -)
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
        return url;
    }

    // Parse from various YouTube URL formats
    const regex = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|&v(?:i)?=))([^#&?]*).*/;
    const match = url.match(regex);
    return (match?.length && match[1]) ? match[1] : url;
}

/**
 * Fetch YouTube transcript
 * @param {string} videoUrl - YouTube video URL or ID
 * @param {string} lang - Optional language code (ISO 639-1)
 * @returns {Promise<string>} Video transcript text
 */
async function fetchYouTubeTranscript(videoUrl, lang = '') {
    try {
        const id = parseYouTubeId(String(videoUrl).trim());

        const response = await fetch('/api/search/transcript', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ id, lang }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        const transcript = await response.text();
        console.log(`📺 [RAGBooks] Fetched transcript for video ${id}: ${transcript.length} characters`);
        return transcript;
    } catch (error) {
        console.error('📺 [RAGBooks] YouTube transcript fetch failed:', error);
        throw new Error(`Failed to fetch YouTube transcript: ${error.message}`);
    }
}

/**
 * Fetch files from GitHub repository
 * @param {string} repoUrl - GitHub repository URL
 * @param {string} filter - Optional file filter (glob patterns)
 * @param {string} branch - Optional branch name
 * @returns {Promise<string>} Combined content from matched files
 */
async function fetchGitHubRepo(repoUrl, filter = '', branch = '') {
    try {
        // Parse owner and repo from URL
        const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (!match) {
            throw new Error('Invalid GitHub URL format');
        }

        const [, owner, repo] = match;
        const repoName = repo.replace(/\.git$/, ''); // Remove .git suffix if present

        // If no filter, just get README
        if (!filter || filter.trim() === '') {
            const readmeUrl = `https://api.github.com/repos/${owner}/${repoName}/readme`;
            const response = await fetch(readmeUrl, {
                headers: {
                    'Accept': 'application/vnd.github.v3.raw',
                },
            });

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }

            const content = await response.text();
            console.log(`📦 [RAGBooks] Fetched README from ${owner}/${repoName}: ${content.length} characters`);
            return content;
        }

        // For file filtering, we need to get the tree
        const branchName = branch || 'main'; // Default to main
        const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branchName}?recursive=1`;

        const treeResponse = await fetch(treeUrl);
        if (!treeResponse.ok) {
            // Try 'master' if 'main' doesn't exist
            const masterTreeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/master?recursive=1`;
            const masterResponse = await fetch(masterTreeUrl);
            if (!masterResponse.ok) {
                throw new Error(`Could not fetch repository tree (tried ${branchName} and master)`);
            }
            const treeData = await masterResponse.json();
            return await fetchMatchingFiles(owner, repoName, treeData.tree, filter);
        }

        const treeData = await treeResponse.json();
        return await fetchMatchingFiles(owner, repoName, treeData.tree, filter);
    } catch (error) {
        console.error('📦 [RAGBooks] GitHub fetch failed:', error);
        throw new Error(`Failed to fetch from GitHub: ${error.message}`);
    }
}

/**
 * Fetch matching files from GitHub tree
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Array} tree - GitHub tree object
 * @param {string} filter - File filter patterns
 * @returns {Promise<string>} Combined file contents
 */
async function fetchMatchingFiles(owner, repo, tree, filter) {
    // Simple glob matching
    const patterns = filter.split(',').map(p => p.trim());
    const matchedFiles = tree.filter(item => {
        if (item.type !== 'blob') return false;
        return patterns.some(pattern => {
            // Convert simple glob to regex
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
            return regex.test(item.path);
        });
    });

    if (matchedFiles.length === 0) {
        throw new Error(`No files matched filter: ${filter}`);
    }

    console.log(`📦 [RAGBooks] Found ${matchedFiles.length} matching files`);

    // Fetch content for each file
    const contents = [];
    for (const file of matchedFiles.slice(0, 20)) { // Limit to 20 files
        try {
            const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`, {
                headers: {
                    'Accept': 'application/vnd.github.v3.raw',
                },
            });

            if (response.ok) {
                const content = await response.text();
                contents.push(`\n\n=== ${file.path} ===\n\n${content}`);
            }
        } catch (error) {
            console.warn(`Failed to fetch ${file.path}:`, error);
        }
    }

    const combined = contents.join('\n');
    console.log(`📦 [RAGBooks] Fetched ${contents.length} files: ${combined.length} characters total`);
    return combined;
}

/**
 * Handle vectorization from inline form
 */
async function handleInlineVectorization() {
    const sourceType = $('#ragbooks_source_type_select').val();

    if (!sourceType) {
        toastr.warning('Please select a source type');
        return;
    }

    try {
        let sourceName, sourceConfig;

        switch (sourceType) {
            case 'lorebook':
                sourceName = $('#ragbooks_lorebook_select').val();
                if (!sourceName) {
                    toastr.warning('Please select a lorebook');
                    return;
                }
                sourceConfig = {
                    chunkingStrategy: $('#ragbooks_chunking_strategy').val(),
                    includeDisabled: $('#ragbooks_include_disabled').prop('checked'),
                    chunkSize: parseInt($('#ragbooks_lorebook_chunk_size').val()) || 400,
                    chunkOverlap: parseInt($('#ragbooks_lorebook_chunk_overlap').val()) || 50,
                    // Text cleaning settings
                    cleaningMode: $('#ragbooks_lorebook_cleaning_mode').val() || 'balanced',
                    customPatterns: getCustomPatterns('lorebook'),
                    // Summarization settings
                    summarizeChunks: $('#ragbooks_lorebook_summarize_chunks').is(':checked'),
                    summaryStyle: $('#ragbooks_lorebook_summary_style').val() || 'concise',
                    perChunkSummaryControl: $('#ragbooks_lorebook_per_chunk_summary').is(':checked'),
                    // Metadata extraction settings
                    extractMetadata: $('#ragbooks_lorebook_extract_metadata').is(':checked'),
                    perChunkMetadataControl: $('#ragbooks_lorebook_per_chunk_metadata').is(':checked')
                };
                break;

            case 'character':
                sourceName = $('#ragbooks_character_select').val();
                if (!sourceName) {
                    toastr.warning('Please select a character');
                    return;
                }
                const fields = [];
                $('.ragbooks-char-field:checked').each(function () {
                    fields.push($(this).val());
                });
                if (fields.length === 0) {
                    toastr.warning('Please select at least one field');
                    return;
                }
                sourceConfig = {
                    fields: fields,
                    chunkingStrategy: $('#ragbooks_chunking_strategy').val(),
                    chunkSize: parseInt($('#ragbooks_character_chunk_size').val()) || 400,
                    chunkOverlap: parseInt($('#ragbooks_character_chunk_overlap').val()) || 50,
                    // Text cleaning settings
                    cleaningMode: $('#ragbooks_character_cleaning_mode').val() || 'balanced',
                    customPatterns: getCustomPatterns('character'),
                    // Summarization settings
                    summarizeChunks: $('#ragbooks_character_summarize_chunks').is(':checked'),
                    summaryStyle: $('#ragbooks_character_summary_style').val() || 'concise',
                    perChunkSummaryControl: $('#ragbooks_character_per_chunk_summary').is(':checked'),
                    // Metadata extraction settings
                    extractMetadata: $('#ragbooks_character_extract_metadata').is(':checked'),
                    perChunkMetadataControl: $('#ragbooks_character_per_chunk_metadata').is(':checked')
                };
                break;

            case 'url':
                const urlInput = $('#ragbooks_url_input').val();
                if (!urlInput || !urlInput.trim()) {
                    toastr.warning('Please enter a URL');
                    return;
                }

                sourceName = $('#ragbooks_url_name').val() || extractDomainFromUrl(urlInput);

                toastr.info('Fetching URL...', 'RAGBooks', { timeOut: 0 });
                try {
                    const text = await fetchTextFromUrl(urlInput);
                    toastr.clear();

                    sourceConfig = {
                        text: text,
                        chunkingStrategy: $('#ragbooks_chunking_strategy').val() || 'paragraph',
                        sourceUrl: urlInput,
                        chunkSize: parseInt($('#ragbooks_url_chunk_size').val()) || 400,
                        chunkOverlap: parseInt($('#ragbooks_url_chunk_overlap').val()) || 50,
                        // Text cleaning settings
                        cleaningMode: $('#ragbooks_url_cleaning_mode').val() || 'balanced',
                        customPatterns: getCustomPatterns('url'),
                        // Summarization settings
                        summarizeChunks: $('#ragbooks_url_summarize_chunks').is(':checked'),
                        summaryStyle: $('#ragbooks_url_summary_style').val() || 'concise',
                        perChunkSummaryControl: $('#ragbooks_url_per_chunk_summary').is(':checked'),
                        // Metadata extraction settings
                        extractMetadata: $('#ragbooks_url_extract_metadata').is(':checked'),
                        perChunkMetadataControl: $('#ragbooks_url_per_chunk_metadata').is(':checked')
                    };
                } catch (error) {
                    toastr.clear();
                    toastr.error('Failed to fetch URL: ' + error.message);
                    return;
                }
                break;

            case 'chat':
                // Get actual chat name instead of generic "Current Chat"
                const context = getContext();
                const chatId = context?.chatId;
                if (chatId) {
                    // Parse chat filename to get a readable name
                    // Format is usually: "CharacterName - 2025-01-15@14h30m" or similar
                    sourceName = chatId.replace(/@\d+h\d+m.*$/, '').trim() || chatId;
                } else {
                    sourceName = 'Current Chat';
                }

                // Collect all chat-specific settings from the form
                const messageTypes = [];
                $('.ragbooks-chat-msg-type:checked').each(function() {
                    messageTypes.push($(this).val());
                });

                sourceConfig = {
                    // Core settings
                    sceneMode: $('#ragbooks_scene_mode').val(),
                    chunkingStrategy: $('#ragbooks_chunking_strategy').val(),

                    // Advanced settings
                    chunkSize: parseInt($('#ragbooks_chat_chunk_size').val()) || 400,
                    chunkOverlap: parseInt($('#ragbooks_chat_chunk_overlap').val()) || 50,
                    nameFormat: $('#ragbooks_name_format').val() || 'actual',
                    startMessage: $('#ragbooks_chat_start_msg').val() ? parseInt($('#ragbooks_chat_start_msg').val()) : null,
                    endMessage: $('#ragbooks_chat_end_msg').val() ? parseInt($('#ragbooks_chat_end_msg').val()) : null,

                    // Message type filters
                    includeUser: messageTypes.includes('user'),
                    includeChar: messageTypes.includes('char'),
                    includeSystem: messageTypes.includes('system'),
                    includeNarrator: messageTypes.includes('narrator'),

                    // Text cleaning settings
                    cleaningMode: $('#ragbooks_chat_cleaning_mode').val() || 'basic',
                    customPatterns: getCustomPatterns('chat'),

                    // Summarization
                    summarizeChunks: $('#ragbooks_summarize_chunks').is(':checked'),
                    summaryStyle: $('#ragbooks_summary_style').val() || 'concise',

                    // Recency weighting
                    recencyWeighting: $('#ragbooks_recency_weighting').is(':checked'),
                    recencyDecay: parseFloat($('#ragbooks_recency_decay').val()) || 0.95,

                    // Auto re-vectorization
                    autoRevector: $('#ragbooks_auto_revector').is(':checked'),
                    revectorInterval: $('#ragbooks_revector_interval').val() || '10',

                    // Metadata extraction
                    extractMetadata: $('#ragbooks_extract_metadata').is(':checked')
                };

                // Store config in chat_metadata for persistence
                chat_metadata.ragbooks_vector_config = sourceConfig;
                saveMetadataDebounced();

                console.log('📚 [RAGBooks] Chat vectorization config:', sourceConfig);
                break;

            case 'custom':
                const inputMethod = $('#ragbooks_input_method').val();
                let text;

                switch (inputMethod) {
                    case 'text':
                        text = $('#ragbooks_doc_text').val();
                        if (!text || text.trim().length === 0) {
                            toastr.warning('Please enter document text');
                            return;
                        }
                        sourceName = $('#ragbooks_doc_name').val() || 'Unnamed Document';
                        break;

                    case 'url':
                        const url = $('#ragbooks_doc_url').val();
                        if (!url || !url.trim()) {
                            toastr.warning('Please enter a URL');
                            return;
                        }
                        toastr.info('Fetching URL...', 'RAGBooks', { timeOut: 0 });
                        try {
                            text = await fetchTextFromUrl(url);
                            toastr.clear();
                            sourceName = $('#ragbooks_doc_name').val() || extractDomainFromUrl(url);
                        } catch (error) {
                            toastr.clear();
                            toastr.error('Failed to fetch URL: ' + error.message);
                            return;
                        }
                        break;

                    case 'wiki':
                        const wikiType = $('#ragbooks_wiki_type').val();
                        const wikiUrl = $('#ragbooks_wiki_url').val();
                        const wikiFilter = $('#ragbooks_wiki_filter').val() || '';

                        if (!wikiUrl || !wikiUrl.trim()) {
                            toastr.warning('Please enter a wiki URL');
                            return;
                        }

                        // Check if plugin is available
                        const pluginAvailable = await isWikiPluginAvailable(wikiType);
                        if (!pluginAvailable) {
                            toastr.error(
                                `Wiki scraping requires the Fandom plugin. Click to install: <a href="https://github.com/SillyTavern/SillyTavern-Fandom-Scraper" target="_blank" style="color: white; text-decoration: underline;">SillyTavern-Fandom-Scraper</a>`,
                                'Plugin Not Found',
                                { timeOut: 10000, escapeHtml: false }
                            );
                            return;
                        }

                        toastr.info('Scraping wiki...', 'RAGBooks', { timeOut: 0 });
                        try {
                            text = await scrapeWikiPage(wikiType, wikiUrl, wikiFilter);
                            toastr.clear();
                            sourceName = $('#ragbooks_doc_name').val() || extractDomainFromUrl(wikiUrl);
                        } catch (error) {
                            toastr.clear();
                            toastr.error('Failed to scrape wiki: ' + error.message);
                            return;
                        }
                        break;

                    case 'youtube':
                        const youtubeUrl = $('#ragbooks_youtube_url').val();
                        const youtubeLang = $('#ragbooks_youtube_lang').val() || '';

                        if (!youtubeUrl || !youtubeUrl.trim()) {
                            toastr.warning('Please enter a YouTube URL or video ID');
                            return;
                        }

                        toastr.info('Fetching YouTube transcript...', 'RAGBooks', { timeOut: 0 });
                        try {
                            text = await fetchYouTubeTranscript(youtubeUrl, youtubeLang);
                            toastr.clear();
                            const videoId = parseYouTubeId(youtubeUrl);
                            sourceName = $('#ragbooks_doc_name').val() || `YouTube - ${videoId}`;
                        } catch (error) {
                            toastr.clear();
                            toastr.error('Failed to fetch YouTube transcript: ' + error.message);
                            return;
                        }
                        break;

                    case 'github':
                        const githubUrl = $('#ragbooks_github_url').val();
                        const githubFilter = $('#ragbooks_github_filter').val() || '';
                        const githubBranch = $('#ragbooks_github_branch').val() || '';

                        if (!githubUrl || !githubUrl.trim()) {
                            toastr.warning('Please enter a GitHub repository URL');
                            return;
                        }

                        toastr.info('Fetching from GitHub...', 'RAGBooks', { timeOut: 0 });
                        try {
                            text = await fetchGitHubRepo(githubUrl, githubFilter, githubBranch);
                            toastr.clear();
                            const match = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
                            sourceName = $('#ragbooks_doc_name').val() || (match ? `${match[1]}/${match[2]}` : 'GitHub Repo');
                        } catch (error) {
                            toastr.clear();
                            toastr.error('Failed to fetch from GitHub: ' + error.message);
                            return;
                        }
                        break;

                    case 'file':
                        const fileInput = document.getElementById('ragbooks_doc_file');
                        if (!fileInput.files || fileInput.files.length === 0) {
                            toastr.warning('Please select at least one file');
                            return;
                        }

                        // Handle multiple files
                        const files = Array.from(fileInput.files);
                        const fileContents = [];

                        try {
                            for (const file of files) {
                                const content = await readFileAsText(file);
                                fileContents.push(`\n\n=== ${file.name} ===\n\n${content}`);
                            }
                            text = fileContents.join('\n');
                            sourceName = $('#ragbooks_doc_name').val() ||
                                (files.length === 1 ? files[0].name.replace(/\.[^/.]+$/, '') : `${files.length} Files`);
                        } catch (error) {
                            toastr.error('Failed to read files: ' + error.message);
                            return;
                        }
                        break;
                }

                sourceConfig = {
                    text: text,
                    chunkingStrategy: $('#ragbooks_chunking_strategy').val(),
                    inputMethod: inputMethod,
                    chunkSize: parseInt($('#ragbooks_custom_chunk_size').val()) || 400,
                    chunkOverlap: parseInt($('#ragbooks_custom_chunk_overlap').val()) || 50,
                    // Text cleaning settings
                    cleaningMode: $('#ragbooks_custom_cleaning_mode').val() || 'balanced',
                    customPatterns: getCustomPatterns('custom'),
                    // Summarization settings
                    summarizeChunks: $('#ragbooks_custom_summarize_chunks').is(':checked'),
                    summaryStyle: $('#ragbooks_custom_summary_style').val() || 'concise',
                    perChunkSummaryControl: $('#ragbooks_custom_per_chunk_summary').is(':checked'),
                    // Metadata extraction settings
                    extractMetadata: $('#ragbooks_custom_extract_metadata').is(':checked'),
                    perChunkMetadataControl: $('#ragbooks_custom_per_chunk_metadata').is(':checked')
                };
                break;
        }

        // NOTE: sourceConfig is now ready and contains only JSON-serializable data
        // Previously had circular reference (sourceConfig.config = sourceConfig) here - REMOVED
        // This ensures chat_metadata can be safely serialized without "Converting circular structure to JSON" errors

        // Reset form
        $('#ragbooks_source_type_select').val('');
        $('#ragbooks_inline_config').hide().empty();

        // Show progress modal
        const sourceTypeLabel = sourceType === 'lorebook' ? 'Lorebook' :
                               sourceType === 'character' ? 'Character' :
                               sourceType === 'chat' ? 'Chat History' :
                               sourceType === 'url' ? 'URL' :
                               'Document';
        showProgressModal(`Vectorizing ${sourceTypeLabel}`, sourceName);

        try {
            // Map 'url' to 'custom' since URL content is already fetched and in sourceConfig.text
            const actualSourceType = sourceType === 'url' ? CONTENT_SOURCES.CUSTOM : sourceType;
            const result = await vectorizeContentSource(actualSourceType, sourceName, sourceConfig);

            // Show success
            showProgressSuccess(`Successfully created ${result.chunkCount} chunks`, 2000);
            renderCollections();
        } catch (error) {
            console.error('Vectorization failed:', error);
            showProgressError(error.message);
            // Don't close modal on error - let user read it and click close
        }
    } catch (error) {
        console.error('Vectorization failed:', error);
        toastr.error('Vectorization failed: ' + error.message);
    }
}

/**
 * Cancel inline form
 */
function cancelInlineForm() {
    $('#ragbooks_source_type_select').val('');
    $('#ragbooks_inline_config').hide().empty();
}

// OLD MODAL CODE DELETED - REPLACED WITH INLINE FORMS ABOVE

// ============================================================================
// EXTENSION INITIALIZATION
// ============================================================================

/**
 * Load and apply RAGBooks settings to UI
 */
function loadSettings() {
    ensureRagState();
    const settings = getRAGSettings();

    // Set UI values from settings
    $('#ragbooks_enabled').prop('checked', settings.enabled);
    $('#ragbooks_orange_mode').prop('checked', settings.orangeMode);
    $('#ragbooks_topk').val(settings.topK);
    $('#ragbooks_topk_value').text(settings.topK);
    $('#ragbooks_threshold').val(Math.round(settings.threshold * 100));
    $('#ragbooks_threshold_value').text(settings.threshold.toFixed(2));
    $('#ragbooks_depth').val(settings.injectionDepth);
    $('#ragbooks_depth_value').text(settings.injectionDepth);

    // Advanced Search Features
    $('#ragbooks_summary_search_mode').val(settings.summarySearchMode || 'both');
    $('#ragbooks_enable_importance').prop('checked', settings.enableImportance !== false);

    // Set importance mode (continuous vs tiers) - maps old usePriorityTiers to new mode
    const importanceMode = settings.usePriorityTiers === true ? 'tiers' : 'continuous';
    $('#ragbooks_importance_mode').val(importanceMode);

    // Show/hide display mode based on importance enabled
    $('#ragbooks_importance_display_mode').toggle(settings.enableImportance !== false);

    $('#ragbooks_enable_conditions').prop('checked', settings.enableConditions !== false);
    $('#ragbooks_enable_groups').prop('checked', settings.enableGroups !== false);

    const groupBoost = settings.groupBoostMultiplier || 1.3;
    $('#ragbooks_group_boost_multiplier').val(Math.round(groupBoost * 100));
    $('#ragbooks_group_boost_value').text(groupBoost.toFixed(1) + 'x');

    const contextWindow = settings.contextWindow || 10;
    $('#ragbooks_context_window').val(contextWindow);
    $('#ragbooks_context_window_value').text(contextWindow);

    // Temporal Decay Settings
    const decay = settings.temporalDecay || { enabled: false, mode: 'exponential', halfLife: 50, linearRate: 0.01, minRelevance: 0.3, sceneAware: false };
    $('#ragbooks_enable_temporal_decay').prop('checked', decay.enabled === true);
    $('#ragbooks_decay_settings').toggle(decay.enabled === true);
    $('#ragbooks_decay_mode').val(decay.mode || 'exponential');
    $('#ragbooks_half_life').val(decay.halfLife || 50);
    $('#ragbooks_half_life_value').text(decay.halfLife || 50);
    $('#ragbooks_linear_rate').val(Math.round((decay.linearRate || 0.01) * 100));
    $('#ragbooks_linear_rate_value').text(Math.round((decay.linearRate || 0.01) * 100));
    $('#ragbooks_min_relevance').val(Math.round((decay.minRelevance || 0.3) * 100));
    $('#ragbooks_min_relevance_value').text(Math.round((decay.minRelevance || 0.3) * 100));
    $('#ragbooks_scene_aware_decay').prop('checked', decay.sceneAware === true);

    // Show/hide decay mode settings
    if (decay.mode === 'exponential') {
        $('#ragbooks_half_life_container').show();
        $('#ragbooks_linear_rate_container').hide();
    } else {
        $('#ragbooks_half_life_container').hide();
        $('#ragbooks_linear_rate_container').show();
    }

    // Apply orange mode class to chunk modal
    applyOrangeMode(settings.orangeMode);

    console.log('📚 [RAGBooks] Settings loaded:', settings);
}

/**
 * Apply or remove orange mode styling
 */
function applyOrangeMode(enabled) {
    // Apply to body so CSS variables cascade properly
    if (enabled) {
        $('body').addClass('ragbooks-orange-mode');
        console.log('🍊 [RAGBooks] Orange Mode: ENABLED - body class added');
    } else {
        $('body').removeClass('ragbooks-orange-mode');
        console.log('🎨 [RAGBooks] Orange Mode: DISABLED - using theme colors');
    }
}

/**
 * Check wiki plugin status and update UI
 */
async function checkWikiPluginStatus() {
    const $status = $('#ragbooks_wiki_plugin_status');
    const wikiType = $('#ragbooks_wiki_type').val() || 'fandom';

    $status.html('<span style="color: var(--SmartThemeQuoteColor);">⏳ Checking plugin...</span>');

    try {
        const isAvailable = await isWikiPluginAvailable(wikiType);

        if (isAvailable) {
            $status.html('<span style="color: #4ade80;">✅ Plugin detected and ready!</span>');
        } else {
            $status.html('<span style="color: #f87171;">❌ Plugin not detected - please install it first</span>');
        }
    } catch (error) {
        $status.html('<span style="color: #f87171;">❌ Could not check plugin status</span>');
        console.error('📖 [RAGBooks] Plugin status check failed:', error);
    }
}

// ============================================================================
// SCENE MARKER SYSTEM - Simplified Single Scene Model
// ============================================================================

/**
 * Get all scenes from chat metadata
 * @returns {Array} Array of scene objects: [{start: number, end: number|null}, ...]
 */
function getScenes() {
    if (!chat_metadata.ragbooks_scenes || !Array.isArray(chat_metadata.ragbooks_scenes)) {
        chat_metadata.ragbooks_scenes = [];
    }
    return chat_metadata.ragbooks_scenes;
}

/**
 * Save scenes to chat metadata
 */
function saveScenes() {
    saveMetadataDebounced();
}

/**
 * Get scene that contains a specific message
 * @param {number} messageId - Message ID to check
 * @returns {Object|null} Scene object or null if not in any scene
 */
function getSceneAt(messageId) {
    const scenes = getScenes();
    return scenes.find(scene => {
        if (scene.end === null) {
            // Open scene - check if message is at or after start
            return messageId >= scene.start;
        }
        // Closed scene - check if message is within bounds
        return messageId >= scene.start && messageId <= scene.end;
    }) || null;
}

/**
 * Get currently open scene (scene with end: null)
 * @returns {Object|null} Open scene object or null
 */
function getOpenScene() {
    const scenes = getScenes();
    return scenes.find(scene => scene.end === null) || null;
}

/**
 * Find scene index by start message
 * @param {number} startId - Start message ID
 * @returns {number} Scene index or -1 if not found
 */
function findSceneIndex(startId) {
    const scenes = getScenes();
    return scenes.findIndex(scene => scene.start === startId);
}

/**
 * Delete scene by index
 * @param {number} index - Scene index
 */
function deleteScene(index) {
    const scenes = getScenes();
    if (index >= 0 && index < scenes.length) {
        scenes.splice(index, 1);
        saveScenes();
    }
}

/**
 * Toggle scene start marker
 * @param {number} messageId - Message ID to mark as scene start
 */
async function toggleSceneStart(messageId) {
    const scenes = getScenes();
    const existingScene = getSceneAt(messageId);

    // Check if this message is already a start
    const sceneIndex = findSceneIndex(messageId);
    if (sceneIndex >= 0) {
        // Toggle off - remove this scene
        deleteScene(sceneIndex);
        console.log(`📚 [RAGBooks] Removed scene starting at ${messageId}`);
        updateAllSceneStates();
        return;
    }

    // Check if clicking inside an existing scene
    if (existingScene && existingScene.start !== messageId) {
        const result = confirm(
            `Message ${messageId} is inside scene ${existingScene.start}-${existingScene.end || 'end'}.\n\n` +
            `Split the scene at message ${messageId}?`
        );

        if (result) {
            // Split the scene
            const oldEnd = existingScene.end;
            existingScene.end = messageId - 1;
            scenes.push({
                start: messageId,
                end: oldEnd,
                title: '',           // NEW: Scene title
                summary: '',         // NEW: Short summary for vector search
                summaryVector: true, // NEW: Create separate embedding (default ON)
                keywords: []         // NEW: Scene-specific keywords
            });
            toastr.success(`Split scene at message ${messageId}`);
            console.log(`📚 [RAGBooks] Split scene at ${messageId}`);
        } else {
            return; // User cancelled
        }
    } else {
        // No conflict - create new scene
        // Check if there's an open scene - auto-close it
        const openScene = getOpenScene();
        if (openScene && openScene.start < messageId) {
            openScene.end = messageId - 1;
            console.log(`📚 [RAGBooks] Auto-closed previous scene at ${messageId - 1}`);
        }

        scenes.push({
            start: messageId,
            end: null,
            title: '',           // NEW: Scene title
            summary: '',         // NEW: Short summary for vector search
            summaryVector: true, // NEW: Create separate embedding (default ON)
            keywords: []         // NEW: Scene-specific keywords
        });
        console.log(`📚 [RAGBooks] Created scene starting at ${messageId}`);
    }

    saveScenes();
    updateAllSceneStates();
}

/**
 * Toggle scene end marker
 * @param {number} messageId - Message ID to mark as scene end
 */
async function toggleSceneEnd(messageId) {
    const scenes = getScenes();
    const openScene = getOpenScene();

    if (!openScene) {
        toastr.warning('No open scene to close');
        return;
    }

    // Check if toggling off (clicking same end)
    if (openScene.end === messageId) {
        openScene.end = null;
        console.log(`📚 [RAGBooks] Reopened scene ${openScene.start}`);
        saveScenes();
        updateAllSceneStates();
        return;
    }

    // Check if there are scenes in the way
    const conflictingScenes = scenes.filter(scene =>
        scene !== openScene &&
        scene.start > openScene.start &&
        scene.start <= messageId
    );

    if (conflictingScenes.length > 0) {
        const sceneList = conflictingScenes.map(s => `${s.start}-${s.end || 'end'}`).join(', ');
        const result = confirm(
            `Closing scene ${openScene.start} at message ${messageId} would overlap with:\n` +
            `${sceneList}\n\n` +
            `Merge all scenes into ${openScene.start}-${messageId}?`
        );

        if (result) {
            // Delete conflicting scenes
            conflictingScenes.forEach(conflictScene => {
                const idx = scenes.indexOf(conflictScene);
                if (idx >= 0) scenes.splice(idx, 1);
            });
            toastr.success(`Merged ${conflictingScenes.length} conflicting scenes`);
            console.log(`📚 [RAGBooks] Merged ${conflictingScenes.length} scenes`);
        } else {
            return; // User cancelled
        }
    }

    // Check if this scene has been vectorized
    const sceneIndex = scenes.indexOf(openScene);
    const hasVectorizedChunks = (() => {
        const settings = getRAGSettings();
        const library = settings?.rag?.library;
        if (!library) return false;

        for (const collection of Object.values(library)) {
            const hasChunk = Object.values(collection).some(chunk =>
                chunk.metadata?.sceneIndex === sceneIndex
            );
            if (hasChunk) return true;
        }
        return false;
    })();

    // Close the scene
    const oldEnd = openScene.end;
    openScene.end = messageId;
    console.log(`📚 [RAGBooks] Closed scene ${openScene.start}-${messageId}`);

    // Warn if vectorized and boundaries changed
    if (hasVectorizedChunks && oldEnd !== messageId) {
        toastr.warning('Scene boundaries changed. Re-vectorize chat to update search index.', { timeOut: 5000 });
    }

    saveScenes();
    updateAllSceneStates();
}

/**
 * Clear all scene markers
 */
function clearAllScenes() {
    chat_metadata.ragbooks_scenes = [];
    saveScenes();
    updateAllSceneStates();
    console.log(`📚 [RAGBooks] Cleared all scenes`);
}

/**
 * Attach scene marker buttons to message toolbar
 * @param {jQuery} $message - Message element (jQuery wrapped .mes)
 */
function attachSceneButtons($message) {
    const messageElement = $message[0];
    const messageId = parseInt(messageElement.getAttribute('mesid'));

    if (isNaN(messageId)) {
        console.warn('📚 [RAGBooks] Invalid mesid for message:', messageElement);
        return;
    }

    // Check if already attached
    if (messageElement.hasAttribute('data-ragbooks-buttons-attached')) {
        console.log(`📚 [RAGBooks] Buttons already attached to message ${messageId}`);
        return;
    }
    messageElement.setAttribute('data-ragbooks-buttons-attached', 'true');

    // Find the mes_buttons container
    const mesButtons = messageElement.querySelector('.mes_buttons');
    if (!mesButtons) {
        console.warn(`📚 [RAGBooks] No mes_buttons found in message ${messageId}`, messageElement);
        return;
    }

    console.log(`📚 [RAGBooks] Attaching buttons to message ${messageId}`);

    // Create START button
    const startButton = document.createElement('div');
    startButton.className = 'mes_button ragbooks_scene_start';
    startButton.title = 'Mark scene START';
    startButton.setAttribute('data-i18n', '[title]Mark scene START');
    startButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M9.808 13.692h.884v-3h4.193L13.615 9l1.27-1.692H9.808zM6 19.5V4h12v15.5l-6-2.583z"/></svg>';
    startButton.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleSceneStart(messageId);
    });

    // Create END button
    const endButton = document.createElement('div');
    endButton.className = 'mes_button ragbooks_scene_end';
    endButton.title = 'Mark scene END';
    endButton.setAttribute('data-i18n', '[title]Mark scene END');
    endButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M9.808 13.692h.884v-3h4.193L13.615 9l1.27-1.692H9.808zM6 19.5V4h12v15.5l-6-2.583z"/></svg>';
    endButton.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleSceneEnd(messageId);
    });

    // Insert buttons at the beginning of mes_buttons (before the ... menu)
    const firstButton = mesButtons.querySelector('.mes_button');
    if (firstButton) {
        mesButtons.insertBefore(endButton, firstButton);
        mesButtons.insertBefore(startButton, firstButton);
    } else {
        mesButtons.appendChild(startButton);
        mesButtons.appendChild(endButton);
    }

    // Update initial state
    updateMessageSceneState(messageElement, messageId);
}

/**
 * Update scene button states for a specific message
 */
function updateMessageSceneState(messageElement, messageId) {
    const scenes = getScenes();
    const openScene = getOpenScene();
    const sceneAtMessage = getSceneAt(messageId);

    // Determine message's role in scenes
    const isSceneStart = scenes.some(scene => scene.start === messageId);
    const isSceneEnd = scenes.some(scene => scene.end === messageId);
    const isInsideScene = sceneAtMessage && !isSceneStart && !isSceneEnd;

    // Find the buttons
    const startButton = messageElement.querySelector('.ragbooks_scene_start');
    const endButton = messageElement.querySelector('.ragbooks_scene_end');

    if (startButton) {
        // START button logic:
        // SHOW if: Not inside scene AND not a scene end
        // HIDE if: Is scene end OR inside a scene (would require split)

        if (isSceneEnd || isInsideScene) {
            startButton.style.display = 'none';
        } else {
            startButton.style.display = '';
            startButton.classList.toggle('ragbooks-active', isSceneStart);
        }
    }

    if (endButton) {
        // END button logic:
        // SHOW if: Open scene exists AND message is after start AND not the start itself
        // HIDE if: No open scene OR message is the scene start

        if (openScene && messageId > openScene.start && !isSceneStart) {
            endButton.style.display = '';
            endButton.classList.toggle('ragbooks-active', openScene.end === messageId);
        } else {
            endButton.style.display = 'none';
        }
    }

    // Visual scene indicators
    // Remove existing scene classes
    messageElement.classList.remove('ragbooks-in-scene', 'ragbooks-scene-start', 'ragbooks-scene-end');

    if (sceneAtMessage) {
        // This message is inside a scene
        messageElement.classList.add('ragbooks-in-scene');

        // Mark start and end boundaries
        if (sceneAtMessage.start === messageId) {
            messageElement.classList.add('ragbooks-scene-start');
            console.log(`✅ Added ragbooks-scene-start to message ${messageId}`);
        }
        if (sceneAtMessage.end === messageId) {
            messageElement.classList.add('ragbooks-scene-end');
            console.log(`✅ Added ragbooks-scene-end to message ${messageId}`, messageElement);
            console.log('Element classes:', messageElement.className);
        }
    }
}

/**
 * Attach scene buttons to all messages
 */
function attachAllSceneButtons() {
    const $messages = $('#chat .mes[mesid]');
    console.log(`📚 [RAGBooks] Attaching scene buttons to ${$messages.length} messages`);

    $messages.each(function() {
        attachSceneButtons($(this));
    });
}

/**
 * Update scene states for all messages
 */
function updateAllSceneStates() {
    const $messages = $('#chat .mes[mesid]');

    $messages.each(function() {
        const messageElement = this;
        const messageId = parseInt(messageElement.getAttribute('mesid'));

        if (!isNaN(messageId)) {
            updateMessageSceneState(messageElement, messageId);
        }
    });
}

/**
 * Initialize MutationObserver to watch for new chat messages
 */
let chatObserver = null;

function initChatObserver() {
    // Disconnect existing observer if any
    if (chatObserver) {
        chatObserver.disconnect();
    }

    const chatContainer = document.querySelector('#chat');
    if (!chatContainer) {
        console.warn('📚 [RAGBooks] #chat container not found, cannot initialize observer');
        return;
    }

    chatObserver = new MutationObserver((mutations) => {
        let newMessagesFound = false;

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if the node itself is a message
                    if (node.matches && node.matches('.mes[mesid]')) {
                        console.log(`📚 [RAGBooks] New message detected: mesid=${node.getAttribute('mesid')}`);
                        attachSceneButtons($(node));
                        newMessagesFound = true;
                    }
                    // Or if it contains messages
                    else if (node.querySelectorAll) {
                        const messages = node.querySelectorAll('.mes[mesid]');
                        if (messages.length > 0) {
                            console.log(`📚 [RAGBooks] ${messages.length} new messages found in added node`);
                            messages.forEach(msg => attachSceneButtons($(msg)));
                            newMessagesFound = true;
                        }
                    }
                }
            }
        }

        // Update states once after all mutations processed
        if (newMessagesFound) {
            updateAllSceneStates();
        }
    });

    // Start observing
    chatObserver.observe(chatContainer, {
        childList: true,
        subtree: true
    });

    console.log('📚 [RAGBooks] MutationObserver initialized and watching #chat');

    // Attach to existing messages immediately
    attachAllSceneButtons();
    updateAllSceneStates();
}

// Scene management is now integrated into the Visualizer's Scenes tab
// Standalone modal has been removed

/**
 * Get custom patterns from ragState for a specific source type
 * @param {string} sourceType - lorebook, character, url, chat, or custom
 * @returns {Array} Array of custom pattern objects
 */
function getCustomPatterns(sourceType) {
    const ragState = ensureRagState();
    const customPatterns = ragState.textCleaning?.customPatterns || [];

    // Return all custom patterns (they apply universally)
    return customPatterns.filter(p => p.enabled !== false);
}

jQuery(async function () {
    // Initialize settings synchronously before any async operations
    // This ensures settings structure exists before tests or UI interactions
    ensureRagState();

    console.log('📚 RAGBooks extension initializing...');

    // Load progress indicator CSS
    if (!document.getElementById('ragbooks-progress-indicator-styles')) {
        const progressCSS = document.createElement('link');
        progressCSS.id = 'ragbooks-progress-indicator-styles';
        progressCSS.rel = 'stylesheet';
        progressCSS.type = 'text/css';
        progressCSS.href = `/${extensionFolderPath}/progress-indicator.css`;
        document.head.appendChild(progressCSS);
        console.log('📚 Loaded progress indicator styles');
    }

    // Migrate flat sources to scoped structure (one-time operation)
    // ========================================================================
    // TEXT CLEANING HELPER FUNCTIONS
    // ========================================================================

    /**
     * Open pattern editor modal
     * @param {Object|null} existingPattern - Pattern to edit, or null for new
     * @param {string} sourceType - Source type context
     */
    function openPatternEditor(existingPattern = null, sourceType = 'all') {
        const $modal = $('#ragbooks_pattern_editor_modal');

        // Populate fields
        if (existingPattern) {
            $('#ragbooks_pattern_name').val(existingPattern.name);
            $('#ragbooks_pattern_regex').val(existingPattern.pattern);
            $('#ragbooks_pattern_flags').val(existingPattern.flags || 'g');
            $('#ragbooks_pattern_replacement').val(existingPattern.replacement || '');
            $modal.data('editingIndex', existingPattern.index);
        } else {
            $('#ragbooks_pattern_name').val('');
            $('#ragbooks_pattern_regex').val('');
            $('#ragbooks_pattern_flags').val('g');
            $('#ragbooks_pattern_replacement').val('');
            $modal.removeData('editingIndex');
        }

        // Clear test results
        $('#ragbooks_pattern_test_input').val('');
        $('#ragbooks_pattern_test_output').val('');

        $modal.data('sourceType', sourceType);
        $modal.show();
    }

    /**
     * Save pattern from editor modal
     */
    function saveCleaningPattern() {
        const $modal = $('#ragbooks_pattern_editor_modal');

        const name = $('#ragbooks_pattern_name').val().trim();
        const pattern = $('#ragbooks_pattern_regex').val().trim();
        const flags = $('#ragbooks_pattern_flags').val().trim();
        const replacement = $('#ragbooks_pattern_replacement').val();

        // Validate
        if (!name) {
            toastr.warning('Pattern name is required');
            return;
        }

        if (!pattern) {
            toastr.warning('Regex pattern is required');
            return;
        }

        // Validate regex
        const validation = validatePattern(pattern, flags);
        if (!validation.valid) {
            toastr.error(`Invalid regex: ${validation.error}`);
            return;
        }

        // Ensure ragState structure exists
        ensureRagState();
        if (!ragState.textCleaning) {
            ragState.textCleaning = { customPatterns: [] };
        }
        if (!ragState.textCleaning.customPatterns) {
            ragState.textCleaning.customPatterns = [];
        }

        // Create pattern object
        const newPattern = {
            name: name,
            pattern: pattern,
            flags: flags,
            replacement: replacement,
            enabled: true
        };

        const editingIndex = $modal.data('editingIndex');

        if (editingIndex !== undefined) {
            // Edit existing
            ragState.textCleaning.customPatterns[editingIndex] = newPattern;
            toastr.success('Pattern updated');
        } else {
            // Add new
            ragState.textCleaning.customPatterns.push(newPattern);
            toastr.success('Pattern added');
        }

        saveSettingsDebounced();
        $modal.hide();
    }

    /**
     * Test pattern in the modal
     */
    function testCleaningPattern() {
        const pattern = $('#ragbooks_pattern_regex').val().trim();
        const flags = $('#ragbooks_pattern_flags').val().trim();
        const replacement = $('#ragbooks_pattern_replacement').val();
        const testInput = $('#ragbooks_pattern_test_input').val();

        if (!pattern || !testInput) {
            toastr.warning('Enter both pattern and test input');
            return;
        }

        try {
            const regex = new RegExp(pattern, flags);
            const result = testInput.replace(regex, replacement);
            $('#ragbooks_pattern_test_output').val(result);
            toastr.success('Test completed');
        } catch (error) {
            $('#ragbooks_pattern_test_output').val(`Error: ${error.message}`);
            toastr.error(`Regex error: ${error.message}`);
        }
    }

    /**
     * View all cleaning patterns for a specific mode
     * @param {string} mode - Cleaning mode (none, basic, balanced, aggressive)
     */
    function viewCleaningPatterns(mode) {
        const presetPatterns = CLEANING_PATTERNS[mode] || [];
        ensureRagState();
        const customPatterns = ragState.textCleaning?.customPatterns || [];

        let message = `<strong>Cleaning Mode: ${mode}</strong><br><br>`;

        message += `<strong>Preset Patterns (${presetPatterns.length}):</strong><br>`;
        presetPatterns.forEach((p, i) => {
            message += `${i + 1}. ${p.name}: <code>/${p.pattern}/${p.flags}</code><br>`;
        });

        message += `<br><strong>Custom Patterns (${customPatterns.length}):</strong><br>`;
        if (customPatterns.length === 0) {
            message += '<em>No custom patterns defined</em>';
        } else {
            customPatterns.forEach((p, i) => {
                const status = p.enabled !== false ? '✓' : '✗';
                message += `${status} ${i + 1}. ${p.name}: <code>/${p.pattern}/${p.flags}</code><br>`;
            });
        }

        toastr.info(message, 'Text Cleaning Patterns', { timeOut: 10000, escapeHtml: false });
    }

    const migrationResult = migrateFlatSourcesToScoped();
    if (migrationResult.migrated > 0) {
        console.log(`✅ Migrated ${migrationResult.migrated} collections to scoped storage`);
    }

    // Load settings HTML
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $('#extensions_settings2').append(settingsHtml);

    // Load settings
    loadSettings();

    // Bind global settings controls
    $('#ragbooks_enabled').on('change', function () {
        const ragState = ensureRagState();
        ragState.enabled = $(this).prop('checked');
        saveSettingsDebounced();
        console.log('📚 [RAGBooks] Enabled:', ragState.enabled);
    });

    // Scope filter buttons
    $(document).on('click', '.ragbooks-scope-filter-btn', function() {
        const scope = $(this).data('scope');

        // Skip if it's the recovery button
        if ($(this).attr('id') === 'ragbooks_recover_btn') {
            return;
        }

        const ragState = ensureRagState();
        ragState.scopeFilter = scope;

        // Update button states
        $('.ragbooks-scope-filter-btn').removeClass('active');
        $(this).addClass('active');

        // Re-render collections with filter
        renderCollections();

        console.log('📚 [RAGBooks] Scope filter:', scope);
    });

    // Close dropdown when clicking outside
    $(document).on('click', function(e) {
        if (!$(e.target).closest('.ragbooks-scope-dropdown').length) {
            $('.ragbooks-scope-dropdown-menu').removeClass('show');
        }
    });

    // Recover lost collections button
    $(document).on('click', '#ragbooks_recover_btn', function() {
        console.log('🔧 [RAGBooks] Starting collection recovery...');
        toastr.info('Scanning for lost collections...');

        const result = recoverOrphanedCollections();

        if (result.success) {
            if (result.recovered.length > 0) {
                const message = `Recovered ${result.recovered.length} collection(s):\n` +
                    result.recovered.map(c => `• ${c.name} (${c.chunks} chunks)`).join('\n');
                console.log('✅ [Recovery Success]', message);
                toastr.success(`Recovered ${result.recovered.length} collection(s)! Check console for details.`);

                // Re-render to show recovered collections
                renderCollections();
            } else {
                toastr.info('No lost collections found - all collections are properly registered');
            }

            if (result.skipped.length > 0) {
                const skippedMessage = `Found ${result.skipped.length} orphaned chunk collection(s) without metadata (cannot recover)`;
                console.warn('⚠️ [Recovery Warning]', skippedMessage);
                toastr.warning(skippedMessage);
            }
        } else {
            toastr.error('Recovery failed - found orphaned chunks but missing source metadata');
        }
    });

    $('#ragbooks_orange_mode').on('change', function () {
        const ragState = ensureRagState();
        ragState.orangeMode = $(this).prop('checked');
        applyOrangeMode(ragState.orangeMode);
        saveSettingsDebounced();
        console.log('📚 [RAGBooks] Orange Mode:', ragState.orangeMode);
    });

    $('#ragbooks_topk').on('input', function () {
        const value = $(this).val();
        $('#ragbooks_topk_value').text(value);
        const ragState = ensureRagState();
        ragState.topK = parseInt(value);
        saveSettingsDebounced();
    });

    $('#ragbooks_threshold').on('input', function () {
        const value = $(this).val();
        const displayValue = (value / 100).toFixed(2);
        $('#ragbooks_threshold_value').text(displayValue);
        const ragState = ensureRagState();
        ragState.threshold = parseFloat(displayValue);
        saveSettingsDebounced();
    });

    $('#ragbooks_depth').on('input', function () {
        const value = $(this).val();
        $('#ragbooks_depth_value').text(value);
        const ragState = ensureRagState();
        ragState.injectionDepth = parseInt(value);
        saveSettingsDebounced();
    });

    // Advanced Search Features
    $('#ragbooks_summary_search_mode').on('change', function () {
        const ragState = ensureRagState();
        ragState.summarySearchMode = $(this).val();
        saveSettingsDebounced();
        console.log('📚 [RAGBooks] Summary Search Mode:', ragState.summarySearchMode);
    });

    $('#ragbooks_enable_importance').on('change', function () {
        const ragState = ensureRagState();
        const enabled = $(this).prop('checked');
        ragState.enableImportance = enabled;

        // Show/hide the display mode section
        $('#ragbooks_importance_display_mode').toggle(enabled);

        saveSettingsDebounced();
        console.log('📚 [RAGBooks] Importance Weighting:', ragState.enableImportance);
    });

    $('#ragbooks_importance_mode').on('change', function () {
        const ragState = ensureRagState();
        const mode = $(this).val();

        // Map new mode to old usePriorityTiers for backward compatibility
        ragState.usePriorityTiers = (mode === 'tiers');

        saveSettingsDebounced();
        console.log('📚 [RAGBooks] Importance Display Mode:', mode, '(usePriorityTiers:', ragState.usePriorityTiers, ')');
    });

    $('#ragbooks_enable_conditions').on('change', function () {
        const ragState = ensureRagState();
        ragState.enableConditions = $(this).prop('checked');
        saveSettingsDebounced();
        console.log('📚 [RAGBooks] Conditional Activation:', ragState.enableConditions);
    });

    $('#ragbooks_enable_groups').on('change', function () {
        const ragState = ensureRagState();
        ragState.enableGroups = $(this).prop('checked');
        saveSettingsDebounced();
        console.log('📚 [RAGBooks] Chunk Groups:', ragState.enableGroups);
    });

    $('#ragbooks_group_boost_multiplier').on('input', function () {
        const value = $(this).val();
        const multiplier = (value / 100).toFixed(1);
        $('#ragbooks_group_boost_value').text(multiplier + 'x');
        const ragState = ensureRagState();
        ragState.groupBoostMultiplier = parseFloat(multiplier);
        saveSettingsDebounced();
    });

    $('#ragbooks_context_window').on('input', function () {
        const value = $(this).val();
        $('#ragbooks_context_window_value').text(value);
        const ragState = ensureRagState();
        ragState.contextWindow = parseInt(value);
        saveSettingsDebounced();
    });

    // Temporal Decay toggle and settings visibility
    $('#ragbooks_enable_temporal_decay').on('change', function () {
        const ragState = ensureRagState();
        const enabled = $(this).prop('checked');

        // Initialize temporalDecay if it doesn't exist
        if (!ragState.temporalDecay) {
            ragState.temporalDecay = {
                enabled: false,
                mode: 'exponential',
                halfLife: 50,
                linearRate: 0.01,
                minRelevance: 0.3,
                sceneAware: false
            };
        }

        ragState.temporalDecay.enabled = enabled;
        $('#ragbooks_decay_settings').toggle(enabled);
        saveSettingsDebounced();
        console.log('📚 [RAGBooks] Temporal Decay:', enabled);
    });

    $('#ragbooks_decay_mode').on('change', function () {
        const ragState = ensureRagState();
        const mode = $(this).val();
        if (!ragState.temporalDecay) ragState.temporalDecay = {};
        ragState.temporalDecay.mode = mode;

        // Show/hide appropriate settings
        if (mode === 'exponential') {
            $('#ragbooks_half_life_container').show();
            $('#ragbooks_linear_rate_container').hide();
        } else {
            $('#ragbooks_half_life_container').hide();
            $('#ragbooks_linear_rate_container').show();
        }

        saveSettingsDebounced();
        console.log('📚 [RAGBooks] Decay Mode:', mode);
    });

    $('#ragbooks_half_life').on('input', function () {
        const value = $(this).val();
        $('#ragbooks_half_life_value').text(value);
        const ragState = ensureRagState();
        if (!ragState.temporalDecay) ragState.temporalDecay = {};
        ragState.temporalDecay.halfLife = parseInt(value);
        saveSettingsDebounced();
    });

    $('#ragbooks_linear_rate').on('input', function () {
        const value = $(this).val();
        $('#ragbooks_linear_rate_value').text(value);
        const ragState = ensureRagState();
        if (!ragState.temporalDecay) ragState.temporalDecay = {};
        ragState.temporalDecay.linearRate = parseFloat(value) / 100; // Convert to decimal
        saveSettingsDebounced();
    });

    $('#ragbooks_min_relevance').on('input', function () {
        const value = $(this).val();
        $('#ragbooks_min_relevance_value').text(value);
        const ragState = ensureRagState();
        if (!ragState.temporalDecay) ragState.temporalDecay = {};
        ragState.temporalDecay.minRelevance = parseFloat(value) / 100; // Convert to decimal
        saveSettingsDebounced();
    });

    $('#ragbooks_scene_aware_decay').on('change', function () {
        const ragState = ensureRagState();
        if (!ragState.temporalDecay) ragState.temporalDecay = {};
        ragState.temporalDecay.sceneAware = $(this).prop('checked');
        saveSettingsDebounced();
        console.log('📚 [RAGBooks] Scene-Aware Decay:', ragState.temporalDecay.sceneAware);
    });

    // Bind source type dropdown
    $(document).on('change', '#ragbooks_source_type_select', function () {
        const sourceType = $(this).val();
        handleSourceTypeSelection(sourceType);
    });

    // Bind input method switcher for custom documents
    $(document).on('change', '#ragbooks_input_method', async function () {
        const method = $(this).val();
        // Hide all input containers
        $('#ragbooks_text_input, #ragbooks_url_input, #ragbooks_wiki_input, #ragbooks_youtube_input, #ragbooks_github_input, #ragbooks_file_input').hide();
        // Show selected container
        switch (method) {
            case 'text':
                $('#ragbooks_text_input').show();
                break;
            case 'url':
                $('#ragbooks_url_input').show();
                break;
            case 'wiki':
                $('#ragbooks_wiki_input').show();
                // Check plugin availability when wiki option is shown
                checkWikiPluginStatus();
                break;
            case 'youtube':
                $('#ragbooks_youtube_input').show();
                break;
            case 'github':
                $('#ragbooks_github_input').show();
                break;
            case 'file':
                $('#ragbooks_file_input').show();
                break;
        }
    });

    // Bind wiki type dropdown to re-check plugin when changed
    $(document).on('change', '#ragbooks_wiki_type', function () {
        checkWikiPluginStatus();
    });

    // Bind inline form buttons (delegated since they're dynamic)
    $(document).on('click', '#ragbooks_vectorize_btn', handleInlineVectorization);
    $(document).on('click', '#ragbooks_cancel_btn', cancelInlineForm);

    // ========================================================================
    // TEXT CLEANING EVENT HANDLERS
    // ========================================================================

    // Cleaning mode dropdown change handlers - show/hide custom patterns section
    $(document).on('change', '#ragbooks_lorebook_cleaning_mode, #ragbooks_character_cleaning_mode, #ragbooks_url_cleaning_mode, #ragbooks_chat_cleaning_mode, #ragbooks_custom_cleaning_mode', function() {
        const $select = $(this);
        const mode = $select.val();
        const sourceType = $select.attr('id').replace('ragbooks_', '').replace('_cleaning_mode', '');
        const $patternsSection = $(`#ragbooks_${sourceType}_cleaning_patterns`);

        // Show custom patterns section for non-none modes
        if (mode !== 'none') {
            $patternsSection.show();
        } else {
            $patternsSection.hide();
        }
    });

    // Add Pattern button handlers
    $(document).on('click', '.ragbooks-add-pattern', function() {
        const sourceType = $(this).data('source');
        openPatternEditor(null, sourceType);
    });

    // View Patterns button handlers
    $(document).on('click', '.ragbooks-view-patterns', function() {
        const sourceType = $(this).data('source');
        const mode = $(`#ragbooks_${sourceType}_cleaning_mode`).val();
        viewCleaningPatterns(mode);
    });

    // Pattern editor modal handlers
    $(document).on('click', '#ragbooks_pattern_editor_close, #ragbooks_pattern_cancel', function() {
        $('#ragbooks_pattern_editor_modal').hide();
    });

    $(document).on('click', '#ragbooks_pattern_save', function() {
        saveCleaningPattern();
    });

    $(document).on('click', '#ragbooks_pattern_test', function() {
        testCleaningPattern();
    });

    // ========================================================================
    // FILE UPLOAD HANDLERS - Modern drag & drop functionality
    // ========================================================================

    // Helper function to format file size
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Helper function to get file icon based on extension
    function getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const iconMap = {
            'txt': 'fa-file-lines',
            'md': 'fa-file-lines',
            'json': 'fa-file-code',
            'yaml': 'fa-file-code',
            'yml': 'fa-file-code',
            'html': 'fa-file-code',
            'htm': 'fa-file-code',
            'png': 'fa-file-image',
            'jpg': 'fa-file-image',
            'jpeg': 'fa-file-image',
            'lorebook': 'fa-book'
        };
        return iconMap[ext] || 'fa-file';
    }

    // Helper function to display selected files
    function displayFileList(files, listElementId) {
        const listContainer = $(`#${listElementId}`);
        listContainer.empty();

        Array.from(files).forEach((file, index) => {
            const fileItem = $(`
                <div class="ragbooks-file-item" data-file-index="${index}">
                    <div class="ragbooks-file-info">
                        <i class="fa-solid ${getFileIcon(file.name)} ragbooks-file-icon"></i>
                        <span class="ragbooks-file-name">${file.name}</span>
                        <span class="ragbooks-file-size">(${formatFileSize(file.size)})</span>
                    </div>
                    <button class="ragbooks-file-remove" data-file-index="${index}">
                        <i class="fa-solid fa-xmark"></i> Remove
                    </button>
                </div>
            `);
            listContainer.append(fileItem);
        });
    }

    // Generic file upload button handler
    function setupFileUploadButton(buttonId, inputId, listId) {
        $(document).on('click', `#${buttonId}`, function(e) {
            e.preventDefault();
            $(`#${inputId}`).click();
        });

        $(document).on('change', `#${inputId}`, function() {
            const files = this.files;
            if (files && files.length > 0) {
                displayFileList(files, listId);
            }
        });

        // Remove file handler
        $(document).on('click', `#${listId} .ragbooks-file-remove`, function(e) {
            e.preventDefault();
            e.stopPropagation();
            const fileInput = document.getElementById(inputId);
            const dt = new DataTransfer();
            const files = Array.from(fileInput.files);
            const indexToRemove = parseInt($(this).data('file-index'));

            files.forEach((file, index) => {
                if (index !== indexToRemove) {
                    dt.items.add(file);
                }
            });

            fileInput.files = dt.files;
            displayFileList(fileInput.files, listId);
        });
    }

    // Generic drag-and-drop handler
    function setupDragAndDrop(dropzoneId, inputId, listId) {
        $(document).on('dragover dragenter', `#${dropzoneId}`, function(e) {
            e.preventDefault();
            e.stopPropagation();
            $(this).addClass('dragover');
        });

        $(document).on('dragleave dragend', `#${dropzoneId}`, function(e) {
            e.preventDefault();
            e.stopPropagation();
            $(this).removeClass('dragover');
        });

        $(document).on('drop', `#${dropzoneId}`, function(e) {
            e.preventDefault();
            e.stopPropagation();
            $(this).removeClass('dragover');

            const files = e.originalEvent.dataTransfer.files;
            if (files && files.length > 0) {
                const fileInput = document.getElementById(inputId);
                const dt = new DataTransfer();

                // Add all dropped files
                Array.from(files).forEach(file => {
                    dt.items.add(file);
                });

                fileInput.files = dt.files;
                displayFileList(fileInput.files, listId);
            }
        });

        // Also handle click on dropzone
        $(document).on('click', `#${dropzoneId}`, function(e) {
            e.preventDefault();
            $(`#${inputId}`).click();
        });
    }

    // Setup all file upload handlers
    setupFileUploadButton('ragbooks_lorebook_upload_btn', 'ragbooks_lorebook_file', 'ragbooks_lorebook_file_list');
    setupDragAndDrop('ragbooks_lorebook_dropzone', 'ragbooks_lorebook_file', 'ragbooks_lorebook_file_list');

    setupFileUploadButton('ragbooks_character_upload_btn', 'ragbooks_character_file', 'ragbooks_character_file_list');
    setupDragAndDrop('ragbooks_character_dropzone', 'ragbooks_character_file', 'ragbooks_character_file_list');

    setupFileUploadButton('ragbooks_doc_upload_btn', 'ragbooks_doc_file', 'ragbooks_doc_file_list');
    setupDragAndDrop('ragbooks_doc_dropzone', 'ragbooks_doc_file', 'ragbooks_doc_file_list');

    // ========================================================================
    // CHAT-SPECIFIC SETTINGS HANDLERS (stored in chat_metadata)
    // ========================================================================

    // Helper to get/create chat vector config
    function getChatVectorConfig() {
        if (!chat_metadata.ragbooks_vector_config) {
            chat_metadata.ragbooks_vector_config = {};
        }
        return chat_metadata.ragbooks_vector_config;
    }

    // Scene mode
    $(document).on('change', '#ragbooks_scene_mode', function() {
        const config = getChatVectorConfig();
        config.sceneMode = $(this).val();
        saveMetadataDebounced();
        console.log('📚 [RAGBooks] Chat scene mode:', config.sceneMode);
    });

    // Chunking strategy
    $(document).on('change', '#ragbooks_chunking_strategy', function() {
        const strategy = $(this).val();

        // Toggle chunk size controls visibility (only for chat)
        if ($('#ragbooks_size_controls').length) {
            if (strategy === 'size') {
                $('#ragbooks_size_controls').show();
            } else {
                $('#ragbooks_size_controls').hide();
            }
        }

        const config = getChatVectorConfig();
        config.chunkingStrategy = strategy;
        saveMetadataDebounced();
        console.log('📚 [RAGBooks] Chat chunking strategy:', config.chunkingStrategy);
    });

    // Chunk size slider
    $(document).on('input', '#ragbooks_chat_chunk_size', function() {
        const value = $(this).val();
        $('#ragbooks_chat_chunk_size_value').text(value);
        const config = getChatVectorConfig();
        config.chunkSize = parseInt(value);
        saveMetadataDebounced();
    });

    // Chunk overlap slider
    $(document).on('input', '#ragbooks_chat_chunk_overlap', function() {
        const value = $(this).val();
        $('#ragbooks_chat_chunk_overlap_value').text(value);
        const config = getChatVectorConfig();
        config.chunkOverlap = parseInt(value);
        saveMetadataDebounced();
    });

    // Message range (start/end)
    $(document).on('change', '#ragbooks_chat_start_msg', function() {
        const config = getChatVectorConfig();
        const value = $(this).val();
        config.startMessage = value ? parseInt(value) : null;
        saveMetadataDebounced();
    });

    $(document).on('change', '#ragbooks_chat_end_msg', function() {
        const config = getChatVectorConfig();
        const value = $(this).val();
        config.endMessage = value ? parseInt(value) : null;
        saveMetadataDebounced();
    });

    // Message type filters
    $(document).on('change', '.ragbooks-chat-msg-type', function() {
        const config = getChatVectorConfig();
        const value = $(this).val();
        const isChecked = $(this).is(':checked');

        switch(value) {
            case 'user':
                config.includeUser = isChecked;
                break;
            case 'char':
                config.includeChar = isChecked;
                break;
            case 'system':
                config.includeSystem = isChecked;
                break;
            case 'narrator':
                config.includeNarrator = isChecked;
                break;
        }

        saveMetadataDebounced();
        console.log('📚 [RAGBooks] Message type filters updated:', {
            user: config.includeUser,
            char: config.includeChar,
            system: config.includeSystem,
            narrator: config.includeNarrator
        });
    });

    // Summarize chunks toggle
    $(document).on('change', '#ragbooks_summarize_chunks', function() {
        const config = getChatVectorConfig();
        const isChecked = $(this).is(':checked');
        config.summarizeChunks = isChecked;

        // Show/hide summary settings
        if (isChecked) {
            $('#ragbooks_summary_settings').slideDown(200);
        } else {
            $('#ragbooks_summary_settings').slideUp(200);
        }

        saveMetadataDebounced();
        console.log('📚 [RAGBooks] Summarize chunks:', isChecked);
    });

    // Summary style
    $(document).on('change', '#ragbooks_summary_style', function() {
        const config = getChatVectorConfig();
        config.summaryStyle = $(this).val();
        saveMetadataDebounced();
        console.log('📚 [RAGBooks] Summary style:', config.summaryStyle);
    });

    // Recency weighting toggle
    $(document).on('change', '#ragbooks_recency_weighting', function() {
        const config = getChatVectorConfig();
        const isChecked = $(this).is(':checked');
        config.recencyWeighting = isChecked;

        // Show/hide recency decay slider
        if (isChecked) {
            $('#ragbooks_recency_decay_setting').slideDown(200);
        } else {
            $('#ragbooks_recency_decay_setting').slideUp(200);
        }

        saveMetadataDebounced();
        console.log('📚 [RAGBooks] Recency weighting:', isChecked);
    });

    // Recency decay slider
    $(document).on('input', '#ragbooks_recency_decay', function() {
        const value = $(this).val();
        $('#ragbooks_recency_decay_value').text(value);
        const config = getChatVectorConfig();
        config.recencyDecay = parseFloat(value);
        saveMetadataDebounced();
    });

    // Auto re-vectorize toggle
    $(document).on('change', '#ragbooks_auto_revector', function() {
        const config = getChatVectorConfig();
        const isChecked = $(this).is(':checked');
        config.autoRevector = isChecked;

        // Show/hide interval selector
        if (isChecked) {
            $('#ragbooks_auto_revector_interval').slideDown(200);
        } else {
            $('#ragbooks_auto_revector_interval').slideUp(200);
        }

        saveMetadataDebounced();
        console.log('📚 [RAGBooks] Auto re-vectorize:', isChecked);
    });

    // Re-vectorize interval
    $(document).on('change', '#ragbooks_revector_interval', function() {
        const config = getChatVectorConfig();
        config.revectorInterval = $(this).val();
        saveMetadataDebounced();
        console.log('📚 [RAGBooks] Re-vectorize interval:', config.revectorInterval);
    });

    // Extract metadata toggle
    $(document).on('change', '#ragbooks_extract_metadata', function() {
        const config = getChatVectorConfig();
        config.extractMetadata = $(this).is(':checked');
        saveMetadataDebounced();
        console.log('📚 [RAGBooks] Extract metadata:', config.extractMetadata);
    });

    // =========================================================================
    // GENERIC SOURCE TYPE EVENT HANDLERS (Lorebook, Character, URL, Custom)
    // =========================================================================

    // Summarization toggle for all non-chat sources
    ['lorebook', 'character', 'url', 'custom'].forEach(sourceType => {
        // Summarization toggle
        $(document).on('change', `#ragbooks_${sourceType}_summarize_chunks`, function() {
            const isChecked = $(this).is(':checked');
            if (isChecked) {
                $(`#ragbooks_${sourceType}_summary_settings`).slideDown(200);
            } else {
                $(`#ragbooks_${sourceType}_summary_settings`).slideUp(200);
            }
            console.log(`📚 [RAGBooks] ${sourceType} summarize chunks:`, isChecked);
        });

        // Metadata extraction toggle
        $(document).on('change', `#ragbooks_${sourceType}_extract_metadata`, function() {
            const isChecked = $(this).is(':checked');
            if (isChecked) {
                $(`#ragbooks_${sourceType}_metadata_settings`).slideDown(200);
            } else {
                $(`#ragbooks_${sourceType}_metadata_settings`).slideUp(200);
            }
            console.log(`📚 [RAGBooks] ${sourceType} extract metadata:`, isChecked);
        });
    });

    // Register RAG interceptor for chat generation
    eventSource.on(event_types.GENERATION_STARTED, ragbooksInterceptor);
    console.log('📚 [RAGBooks] Registered generation interceptor');

    // Initialize MutationObserver for chat messages
    initChatObserver();

    // Hook into CHAT_CHANGED to reinitialize on chat switch
    eventSource.on(event_types.CHAT_CHANGED, () => {
        console.log('📚 [RAGBooks] Chat changed - reattaching scene buttons');
        setTimeout(() => {
            attachAllSceneButtons();
        }, 500);
    });

    // Initial render
    renderCollections();

    // Expose debug functions to window for console testing
    window.ragbooks_debug = {
        attachButtons: attachAllSceneButtons,
        updateStates: updateAllSceneStates,
        getScenes: getScenes,
        clearScenes: clearAllScenes,
        toggleStart: toggleSceneStart,
        toggleEnd: toggleSceneEnd,
        checkMessages: () => {
            const $messages = $('#chat .mes[mesid]');
            const withButtons = $('.ragbooks_scene_start, .ragbooks_scene_end').length;
            console.log(`Messages: ${$messages.length}, Scene Buttons: ${withButtons}`);
            console.log('Scenes:', getScenes());
            console.log('First message:', $messages.first()[0]);
            console.log('Buttons in first:', $messages.first().find('.ragbooks_scene_start, .ragbooks_scene_end').length);
            return {
                messageCount: $messages.length,
                buttonCount: withButtons,
                scenes: getScenes(),
                firstMessage: $messages.first()[0]
            };
        }
    };

    console.log('✅ RAGBooks extension initialized');
    console.log('💡 Debug commands: window.ragbooks_debug.checkMessages(), window.ragbooks_debug.attachBookmarks()');
});
