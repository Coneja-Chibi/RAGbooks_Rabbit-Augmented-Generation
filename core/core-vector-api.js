/**
 * ============================================================================
 * CORE VECTOR API CLIENT
 * ============================================================================
 * Abstraction layer for vector operations.
 * Routes to different backends: ST's Vectra API, LanceDB, or Qdrant.
 *
 * Functions:
 * - getVectorsRequestBody() - Builds request body for embedding providers
 * - getAdditionalArgs() - Special handling for WebLLM/KoboldCpp
 * - throwIfSourceInvalid() - Validates provider configuration
 * - getSavedHashes() - GET existing hashes from a collection
 * - insertVectorItems() - POST embeddings to backend
 * - queryCollection() - POST query to find similar vectors
 * - queryMultipleCollections() - POST query across multiple collections
 * - deleteVectorItems() - DELETE specific hashes
 * - purgeVectorIndex() - DELETE entire collection
 * - purgeAllVectorIndexes() - DELETE all collections
 * - purgeFileVectorIndex() - DELETE file-specific collection
 *
 * @author Base: Cohee#1207 | VectHare: Backend abstraction
 * ============================================================================
 */

import { getRequestHeaders } from '../../../../../script.js';
import { extension_settings, modules } from '../../../../extensions.js';
import { secret_state } from '../../../../secrets.js';
import { textgen_types, textgenerationwebui_settings } from '../../../../textgen-settings.js';
import { oai_settings } from '../../../../openai.js';
import { isWebLlmSupported } from '../../../shared.js';
import { WebLlmVectorProvider } from '../providers/webllm.js';
import { getBackend } from '../backends/backend-manager.js';
import {
    getProviderConfig,
    getModelField,
    getSecretKey,
    requiresApiKey,
    requiresUrl,
    getUrlProviders
} from './providers.js';
import { applyKeywordBoosts, getOverfetchAmount } from './keyword-boost.js';
import AsyncUtils from '../utils/async-utils.js';
import StringUtils from '../utils/string-utils.js';
import {
    RATE_LIMIT_CALLS,
    RATE_LIMIT_WINDOW_MS,
    API_TIMEOUT_MS,
    RETRY_MAX_ATTEMPTS,
    RETRY_INITIAL_DELAY_MS,
    RETRY_MAX_DELAY_MS,
    RETRY_BACKOFF_MULTIPLIER
} from './constants.js';

// Initialize WebLLM provider
const webllmProvider = new WebLlmVectorProvider();

/**
 * Rate limiter that respects user settings dynamically.
 */
class DynamicRateLimiter {
    constructor() {
        this.timestamps = [];
    }

    /**
     * Executes a function if rate limits allow, or waits until they do.
     * @param {Function} fn Function to execute
     * @param {object} settings Settings containing rate_limit_calls and rate_limit_interval
     * @returns {Promise<any>} Result of the function
     */
    async execute(fn, settings) {
        const maxCalls = settings.rate_limit_calls || 0; // 0 = disabled
        const intervalMs = (settings.rate_limit_interval || 60) * 1000;

        if (maxCalls <= 0) {
            return await fn();
        }

        // Clean up old timestamps
        const now = Date.now();
        this.timestamps = this.timestamps.filter(t => now - t < intervalMs);

        if (this.timestamps.length >= maxCalls) {
            // Calculate wait time
            const oldest = this.timestamps[0];
            const waitTime = (oldest + intervalMs) - now;

            if (waitTime > 0) {
                console.log(`VectHare: Rate limit reached. Waiting ${Math.round(waitTime / 1000)}s...`);
                await AsyncUtils.sleep(waitTime + 100); // Add small buffer
            }
            
            // Recursive call to re-check
            return this.execute(fn, settings);
        }

        // Add timestamp and execute
        this.timestamps.push(Date.now());
        return await fn();
    }
}

// Global rate limiter instance
const dynamicRateLimiter = new DynamicRateLimiter();

/**
 * Helper to batch array into chunks
 * @template T
 * @param {T[]} array
 * @param {number} size
 * @returns {T[][]}
 */
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// Retry configuration for transient failures (matches AsyncUtils.retry signature)
const RETRY_CONFIG = {
    maxAttempts: RETRY_MAX_ATTEMPTS,
    delay: RETRY_INITIAL_DELAY_MS,
    maxDelay: RETRY_MAX_DELAY_MS,
    backoffFactor: RETRY_BACKOFF_MULTIPLIER,
    shouldRetry: (error) => {
        // Retry on network errors and rate limits
        const message = error?.message?.toLowerCase() || '';
        const isRetryable =
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('429') ||
            message.includes('rate limit') ||
            message.includes('too many requests') ||
            message.includes('502') ||
            message.includes('503') ||
            message.includes('504');
        return isRetryable;
    }
};

/**
 * Strips HTML and Markdown formatting from text before embedding.
 * Uses StringUtils from ST-Helpers for consistent text cleaning.
 * @param {string} text - Text to clean
 * @returns {string} Cleaned text
 */
function stripFormatting(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }
    // Strip HTML first, then Markdown
    let cleaned = StringUtils.stripHtml(text, true);
    cleaned = StringUtils.stripMarkdown(cleaned);
    return cleaned.trim();
}

/**
 * Gets common body parameters for vector requests.
 * @param {object} args Additional arguments
 * @param {object} settings VectHare settings object
 * @returns {object} Request body
 */
export function getVectorsRequestBody(args = {}, settings) {
    const body = Object.assign({}, args);
    switch (settings.source) {
        case 'extras':
            body.extrasUrl = extension_settings.apiUrl;
            body.extrasKey = extension_settings.apiKey;
            break;
        case 'electronhub':
            body.model = settings.electronhub_model;
            break;
        case 'openrouter':
            body.model = settings.openrouter_model;
            break;
        case 'togetherai':
            body.model = settings.togetherai_model;
            break;
        case 'openai':
            body.model = settings.openai_model;
            break;
        case 'cohere':
            body.model = settings.cohere_model;
            break;
        case 'ollama':
            body.model = settings.ollama_model;
            body.apiUrl = settings.use_alt_endpoint ? settings.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.OLLAMA];
            body.keep = !!settings.ollama_keep;
            break;
        case 'llamacpp':
            body.apiUrl = settings.use_alt_endpoint ? settings.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP];
            break;
        case 'vllm':
            body.apiUrl = settings.use_alt_endpoint ? settings.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.VLLM];
            body.model = settings.vllm_model;
            break;
        case 'bananabread':
            body.apiUrl = settings.use_alt_endpoint ? settings.alt_endpoint_url : 'http://localhost:8008';
            // Use extension settings for API key (custom keys aren't returned by ST's readSecretState)
            if (settings.bananabread_api_key) {
                body.apiKey = settings.bananabread_api_key;
            }
            break;
        case 'webllm':
            body.model = settings.webllm_model;
            break;
        case 'palm':
            body.model = settings.google_model;
            body.api = 'makersuite';
            break;
        case 'vertexai':
            body.model = settings.google_model;
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
 * Gets additional arguments for vector requests.
 * Special handling for WebLLM, KoboldCpp, and BananaBread which generate embeddings client-side.
 * @param {string[]} items Items to embed
 * @param {object} settings VectHare settings object
 * @returns {Promise<object>} Additional arguments
 */
export async function getAdditionalArgs(items, settings) {
    const args = {};
    switch (settings.source) {
        case 'webllm':
            args.embeddings = await createWebLlmEmbeddings(items, settings);
            break;
        case 'koboldcpp': {
            const { embeddings, model } = await createKoboldCppEmbeddings(items, settings);
            args.embeddings = embeddings;
            args.model = model;
            break;
        }
        case 'bananabread': {
            const { embeddings, model } = await createBananaBreadEmbeddings(items, settings);
            args.embeddings = embeddings;
            args.model = model;
            break;
        }
    }
    return args;
}

/**
 * Creates WebLLM embeddings for a list of items.
 * Wrapped with retry and timeout for robustness.
 * @param {string[]} items Items to embed
 * @param {object} settings VectHare settings object
 * @returns {Promise<Record<string, number[]>>} Calculated embeddings
 */
async function createWebLlmEmbeddings(items, settings) {
    if (items.length === 0) {
        return /** @type {Record<string, number[]>} */ ({});
    }

    if (!isWebLlmSupported()) {
        throw new Error('VectHare: WebLLM is not supported', { cause: 'webllm_not_supported' });
    }

    // Clean text before embedding
    const cleanedItems = items.map(item => stripFormatting(item) || item);

    return await AsyncUtils.retry(async () => {
        const embedPromise = webllmProvider.embedTexts(cleanedItems, settings.webllm_model);
        const embeddings = await AsyncUtils.timeout(embedPromise, API_TIMEOUT_MS * 2, 'WebLLM embedding request timed out');

        const result = /** @type {Record<string, number[]>} */ ({});
        for (let i = 0; i < items.length; i++) {
            // Map back to original items for hash consistency
            result[items[i]] = embeddings[i];
        }
        return result;
    }, {
        ...RETRY_CONFIG,
        onRetry: (attempt, error) => {
            console.warn(`VectHare: WebLLM embedding retry ${attempt} - ${error.message}`);
        }
    });
}

/**
 * Creates KoboldCpp embeddings for a list of items.
 * Wrapped with retry, timeout, and rate limiting for robustness.
 * @param {string[]} items Items to embed
 * @param {object} settings VectHare settings object
 * @returns {Promise<{embeddings: Record<string, number[]>, model: string}>} Calculated embeddings
 */
async function createKoboldCppEmbeddings(items, settings) {
    // Clean text before embedding (strip HTML/Markdown)
    const cleanedItems = items.map(item => stripFormatting(item) || item);

    return await dynamicRateLimiter.execute(async () => {
        return await AsyncUtils.retry(async () => {
            const serverUrl = settings.use_alt_endpoint ? settings.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.KOBOLDCPP];
            if (!serverUrl) {
                throw new Error('KoboldCpp URL not found');
            }

            const cleanUrl = serverUrl.replace(/\/$/, '');
            const fetchPromise = fetch(`${cleanUrl}/v1/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    input: cleanedItems,
                    model: settings.koboldcpp_model || 'koboldcpp',
                }),
            });

            const response = await AsyncUtils.timeout(fetchPromise, API_TIMEOUT_MS, 'KoboldCpp embedding request timed out');

            if (!response.ok) {
                // Try legacy endpoint if v1 fails (fallback)
                if (response.status === 404) {
                    console.warn('VectHare: KoboldCpp /v1/embeddings not found, trying legacy endpoint...');
                    // Fallthrough to retry or handle legacy?
                    // Better to throw specific error so we can potentially retry with legacy logic if we wanted, 
                    // but for now let's stick to the directive of using OpenAI compatible endpoint.
                }
                throw new Error(`Failed to get KoboldCpp embeddings: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            
            // OpenAI format: { data: [{ embedding: [], index: 0, ... }, ...], model: "..." }
            if (!data.data || !Array.isArray(data.data) || data.data.length !== cleanedItems.length) {
                 throw new Error('Invalid response from KoboldCpp embeddings (OpenAI format)');
            }

            const embeddings = /** @type {Record<string, number[]>} */ ({});
            
            // Sort by index to ensure order matches items
            data.data.sort((a, b) => a.index - b.index);

            for (let i = 0; i < data.data.length; i++) {
                const embedding = data.data[i].embedding;
                if (!Array.isArray(embedding) || embedding.length === 0) {
                    throw new Error('KoboldCpp returned an empty embedding.');
                }
                // Map back to original items (not cleaned) for hash consistency
                embeddings[items[i]] = embedding;
            }

            return {
                embeddings: embeddings,
                model: data.model || 'koboldcpp',
            };
        }, {
            ...RETRY_CONFIG,
            onRetry: (attempt, error) => {
                console.warn(`VectHare: KoboldCpp embedding retry ${attempt} - ${error.message}`);
            }
        });
    }, settings);
}

/**
 * Creates BananaBread embeddings for a list of items.
 * Wrapped with retry, timeout, and rate limiting for robustness.
 * @param {string[]} items Items to embed
 * @param {object} settings VectHare settings object
 * @returns {Promise<{embeddings: number[][], model: string}>} Calculated embeddings as array (index-aligned with input items)
 */
async function createBananaBreadEmbeddings(items, settings) {
    // Clean text before embedding (strip HTML/Markdown & Handle mixed types: strings vs objects)
    const cleanedItems = items.map(item => {
        // 1. Handle primitive strings
        if (typeof item === 'string') {
            return stripFormatting(item) || item;
        }

        // 2. Handle objects: Extract known text fields (e.g., item.text, item.content)
        if (item && typeof item === 'object') {
            const textValue = item.text || item.content || '';
            return stripFormatting(textValue) || textValue;
        }

        // 3. Fallback for unexpected types
        return '';
    }).filter(t => t.length > 0); // Remove empty strings to prevent 422s on empty payloads

    return await dynamicRateLimiter.execute(async () => {
        return await AsyncUtils.retry(async () => {
            const serverUrl = settings.use_alt_endpoint ? settings.alt_endpoint_url : 'http://localhost:8008';
            const cleanUrl = serverUrl.replace(/\/$/, '');

            const headers = {
                'Content-Type': 'application/json',
            };

            // Use extension settings for API key (custom keys aren't returned by ST's readSecretState)
            if (settings.bananabread_api_key) {
                headers['Authorization'] = `Bearer ${settings.bananabread_api_key}`;
            }

            const fetchPromise = fetch(`${cleanUrl}/v1/embeddings`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    input: cleanedItems,
                    model: settings.bananabread_model || 'bananabread',
                }),
            });

            const response = await AsyncUtils.timeout(fetchPromise, API_TIMEOUT_MS, 'BananaBread embedding request timed out');

            if (!response.ok) {
                throw new Error(`Failed to get BananaBread embeddings: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            // OpenAI format: { data: [{ embedding: [], index: 0, ... }, ...], model: "..." }
            if (!data.data || !Array.isArray(data.data) || data.data.length !== cleanedItems.length) {
                throw new Error(`Invalid response from BananaBread embeddings (OpenAI format): expected ${cleanedItems.length} embeddings, got ${data.data?.length || 0}`);
            }

            // Sort by index to ensure order matches input items
            data.data.sort((a, b) => a.index - b.index);

            // Build array of embeddings aligned with input order
            const embeddings = /** @type {number[][]} */ ([]);
            for (let i = 0; i < data.data.length; i++) {
                const embedding = data.data[i].embedding;
                if (!Array.isArray(embedding) || embedding.length === 0) {
                    throw new Error(`BananaBread returned an empty or invalid embedding at index ${i}.`);
                }
                embeddings.push(embedding);
            }

            return {
                embeddings: embeddings,
                model: data.model || 'bananabread',
            };
        }, {
            ...RETRY_CONFIG,
            onRetry: (attempt, error) => {
                console.warn(`VectHare: BananaBread embedding retry ${attempt} - ${error.message}`);
            }
        });
    }, settings);
}

/**
 * Throws an error if the source is invalid (missing API key or URL, or missing module)
 * @param {object} settings VectHare settings object
 */
export function throwIfSourceInvalid(settings) {
    const source = settings.source;
    const config = getProviderConfig(source);

    if (!config) {
        throw new Error(`VectHare: Unknown provider ${source}`, { cause: 'unknown_provider' });
    }

    // Check API key requirement
    if (requiresApiKey(source)) {
        const secretKey = getSecretKey(source);
        if (secretKey && !secret_state[secretKey]) {
            throw new Error('VectHare: API key missing', { cause: 'api_key_missing' });
        }
    }

    // Check URL requirement
    if (requiresUrl(source)) {
        if (settings.use_alt_endpoint) {
            if (!settings.alt_endpoint_url) {
                throw new Error('VectHare: API URL missing', { cause: 'api_url_missing' });
            }
        } else {
            // Check textgen settings for local providers
            const textgenMapping = {
                'ollama': textgen_types.OLLAMA,
                'vllm': textgen_types.VLLM,
                'koboldcpp': textgen_types.KOBOLDCPP,
                'llamacpp': textgen_types.LLAMACPP
            };

            if (textgenMapping[source] && !textgenerationwebui_settings.server_urls[textgenMapping[source]]) {
                throw new Error('VectHare: API URL missing', { cause: 'api_url_missing' });
            }
        }
    }

    // Check model requirement
    if (config.requiresModel) {
        const modelField = getModelField(source);
        if (modelField && !settings[modelField]) {
            throw new Error('VectHare: API model missing', { cause: 'api_model_missing' });
        }
    }

    // Special case: extras requires embeddings module
    if (source === 'extras' && !modules.includes('embeddings')) {
        throw new Error('VectHare: Embeddings module missing', { cause: 'extras_module_missing' });
    }

    // Special case: WebLLM requires browser support
    if (source === 'webllm' && !isWebLlmSupported()) {
        throw new Error('VectHare: WebLLM is not supported', { cause: 'webllm_not_supported' });
    }
}

/**
 * Gets the saved hashes for a collection
 * @param {string} collectionId Collection ID
 * @param {object} settings VectHare settings object
 * @param {boolean} includeMetadata If true, returns {hashes: [], metadata: []} instead of just hashes
 * @returns {Promise<number[]|{hashes: number[], metadata: object[]}>} Saved hashes or full data
 */
export async function getSavedHashes(collectionId, settings, includeMetadata = false) {
    const backend = await getBackend(settings);
    const hashes = await backend.getSavedHashes(collectionId, settings);

    if (!includeMetadata) {
        return hashes;
    }

    // Use unified chunks API to get full metadata (works with all backends)
    try {
        const backendName = settings.vector_backend || 'standard';
        const response = await fetch('/api/plugins/similharity/chunks/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                backend: backendName === 'standard' ? 'vectra' : backendName,
                collectionId: collectionId,
                source: settings.source || 'transformers',
                model: settings.model || '',
                limit: 10000
            })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.items) {
                return {
                    hashes: hashes,
                    metadata: data.items.map(item => item.metadata || item)
                };
            }
        }
    } catch (error) {
        console.warn('VectHare: Failed to get full metadata from chunks API, returning hashes only', error);
    }

    // Fallback: return hashes as array (old format)
    return hashes;
}

/**
 * Inserts vector items into a collection
 * Handles batching and rate limiting.
 * For client-side embedding sources (webllm, koboldcpp, bananabread), generates embeddings first.
 * @param {string} collectionId - The collection to insert into
 * @param {{ hash: number, text: string }[]} items - The items to insert
 * @param {object} settings VectHare settings object
 * @returns {Promise<void>}
 */
export async function insertVectorItems(collectionId, items, settings) {
    const backend = await getBackend(settings);

    // Sources that require client-side embedding generation
    const clientSideEmbeddingSources = ['webllm', 'koboldcpp', 'bananabread'];

    // If source requires client-side embeddings, generate them and attach to items
    if (clientSideEmbeddingSources.includes(settings.source)) {
        console.log(`VectHare: Generating client-side embeddings for ${settings.source}...`);
        // Extract text strings - getAdditionalArgs expects string[], not objects
        const textStrings = items.map(item => item.text || item);
        const additionalArgs = await getAdditionalArgs(textStrings, settings);

        if (additionalArgs.embeddings && additionalArgs.embeddings.length === items.length) {
            // Attach embeddings to items as .vector property
            for (let i = 0; i < items.length; i++) {
                items[i].vector = additionalArgs.embeddings[i];
            }
            console.log(`VectHare: Attached ${items.length} embeddings to items`);
        } else {
            throw new Error(`VectHare: Failed to generate embeddings for ${settings.source} - got ${additionalArgs.embeddings?.length || 0} embeddings for ${items.length} items`);
        }
    }

    // If rate limiting is enabled, batch execution
    if (settings.rate_limit_calls > 0) {
        // Use a reasonable batch size for the APIs (e.g. 10 items per request)
        // This ensures we don't send too many items in one go, but also don't span too many requests
        const BATCH_SIZE = 10;
        const batches = chunkArray(items, BATCH_SIZE);

        console.log(`VectHare: Processing ${items.length} items in ${batches.length} batches with rate limit (Max ${settings.rate_limit_calls} calls / ${settings.rate_limit_interval}s)`);

        for (let i = 0; i < batches.length; i++) {
            await dynamicRateLimiter.execute(async () => {
                await AsyncUtils.retry(async () => {
                    await backend.insertVectorItems(collectionId, batches[i], settings);
                }, RETRY_CONFIG);
            }, settings);
            
            // Optional: UI update for progress could go here if we passed a callback
        }
    } else {
        // No rate limit - execute all at once (backend handles it)
        return await backend.insertVectorItems(collectionId, items, settings);
    }
}

/**
 * Deletes vector items from a collection
 * @param {string} collectionId - The collection to delete from
 * @param {number[]} hashes - The hashes of the items to delete
 * @param {object} settings VectHare settings object
 * @returns {Promise<void>}
 */
export async function deleteVectorItems(collectionId, hashes, settings) {
    const backend = await getBackend(settings);
    return await backend.deleteVectorItems(collectionId, hashes, settings);
}

/**
 * Queries a single collection for similar vectors
 * Applies keyword boost system: overfetch → boost → trim
 * For client-side embedding sources (webllm, koboldcpp, bananabread), generates query embedding first.
 * @param {string} collectionId - The collection to query
 * @param {string} searchText - The text to query
 * @param {number} topK - The number of results to return
 * @param {object} settings VectHare settings object
 * @returns {Promise<{ hashes: number[], metadata: object[]}>} - Hashes and metadata of the results
 */
export async function queryCollection(collectionId, searchText, topK, settings) {
    const backend = await getBackend(settings);

    // Sources that require client-side embedding generation
    const clientSideEmbeddingSources = ['webllm', 'koboldcpp', 'bananabread'];
    let queryVector = null;

    // If source requires client-side embeddings, generate query vector
    if (clientSideEmbeddingSources.includes(settings.source)) {
        const queryItem = [{ text: searchText, hash: 0 }];
        const additionalArgs = await getAdditionalArgs(queryItem, settings);
        if (additionalArgs.embeddings && additionalArgs.embeddings.length > 0) {
            queryVector = additionalArgs.embeddings[0];
        } else {
            throw new Error(`VectHare: Failed to generate query embedding for ${settings.source}`);
        }
    }

    // Overfetch to allow keyword-boosted chunks to surface
    const overfetchAmount = getOverfetchAmount(topK);
    const rawResults = await backend.queryCollection(collectionId, searchText, overfetchAmount, settings, queryVector);

    // Convert to format expected by keyword boost
    const resultsForBoost = rawResults.metadata.map((meta, idx) => ({
        hash: rawResults.hashes[idx],
        score: meta.score || 0,
        metadata: meta,
        text: meta.text || ''
    }));

    // Apply keyword boosts and trim to requested topK
    const boostedResults = applyKeywordBoosts(resultsForBoost, searchText, topK);

    // Convert back to expected format
    return {
        hashes: boostedResults.map(r => r.hash),
        metadata: boostedResults.map(r => ({
            ...r.metadata,
            score: r.score,
            originalScore: r.originalScore,
            keywordBoost: r.keywordBoost,
            matchedKeywords: r.matchedKeywords,
            matchedKeywordsWithWeights: r.matchedKeywordsWithWeights,
            keywordBoosted: r.keywordBoosted
        }))
    };
}

/**
 * Queries multiple collections for a given text.
 * For client-side embedding sources, generates query embedding once and reuses for all collections.
 * @param {string[]} collectionIds - Collection IDs to query
 * @param {string} searchText - Text to query
 * @param {number} topK - Number of results to return
 * @param {number} threshold - Score threshold
 * @param {object} settings VectHare settings object
 * @returns {Promise<Record<string, { hashes: number[], metadata: object[] }>>} - Results mapped to collection IDs
 */
export async function queryMultipleCollections(collectionIds, searchText, topK, threshold, settings) {
    const backend = await getBackend(settings);

    // Sources that require client-side embedding generation
    const clientSideEmbeddingSources = ['webllm', 'koboldcpp', 'bananabread'];
    let queryVector = null;

    // Generate query vector once for all collections (efficiency)
    if (clientSideEmbeddingSources.includes(settings.source)) {
        const queryItem = [{ text: searchText, hash: 0 }];
        const additionalArgs = await getAdditionalArgs(queryItem, settings);
        if (additionalArgs.embeddings && additionalArgs.embeddings.length > 0) {
            queryVector = additionalArgs.embeddings[0];
        } else {
            throw new Error(`VectHare: Failed to generate query embedding for ${settings.source}`);
        }
    }

    return await backend.queryMultipleCollections(collectionIds, searchText, topK, threshold, settings, queryVector);
}

/**
 * Queries multiple collections with conditional activation filtering.
 * Collections that don't meet their activation conditions are skipped.
 *
 * @param {string[]} collectionIds - Collection IDs to potentially query
 * @param {string} searchText - Text to query
 * @param {number} topK - Number of results to return
 * @param {number} threshold - Score threshold
 * @param {object} settings - VectHare settings object
 * @param {object} context - Search context (from buildSearchContext)
 * @returns {Promise<Record<string, { hashes: number[], metadata: object[] }>>} - Results mapped to collection IDs
 */
export async function queryActiveCollections(collectionIds, searchText, topK, threshold, settings, context) {
    // Lazy import to avoid circular dependency
    const { filterActiveCollections } = await import('./collection-metadata.js');

    // Filter collections based on their activation conditions
    const activeCollectionIds = await filterActiveCollections(collectionIds, context);

    if (activeCollectionIds.length === 0) {
        console.log('VectHare: No collections passed activation conditions');
        return {};
    }

    // Query only the active collections
    const backend = await getBackend(settings);
    return await backend.queryMultipleCollections(activeCollectionIds, searchText, topK, threshold, settings);
}

/**
 * Purges the vector index for a collection.
 * @param {string} collectionId Collection ID to purge
 * @param {object} settings VectHare settings object
 * @returns {Promise<boolean>} True if deleted, false if not
 */
export async function purgeVectorIndex(collectionId, settings) {
    try {
        const backend = await getBackend(settings);
        await backend.purgeVectorIndex(collectionId, settings);
        console.log(`VectHare: Purged vector index for collection ${collectionId}`);
        return true;
    } catch (error) {
        console.error('VectHare: Failed to purge', error);
        return false;
    }
}

/**
 * Purges the vector index for a file.
 * @param {string} collectionId File collection ID to purge
 * @param {object} settings VectHare settings object
 * @returns {Promise<void>}
 */
export async function purgeFileVectorIndex(collectionId, settings) {
    try {
        console.log(`VectHare: Purging file vector index for collection ${collectionId}`);
        const backend = await getBackend(settings);
        await backend.purgeFileVectorIndex(collectionId, settings);
        console.log(`VectHare: Purged vector index for collection ${collectionId}`);
    } catch (error) {
        console.error('VectHare: Failed to purge file', error);
    }
}

/**
 * Purges all vector indexes.
 * @param {object} settings VectHare settings object
 * @returns {Promise<void>}
 */
export async function purgeAllVectorIndexes(settings) {
    try {
        const backend = await getBackend(settings);
        await backend.purgeAllVectorIndexes(settings);
        console.log('VectHare: Purged all vector indexes');
        toastr.success('All vector indexes purged', 'Purge successful');
    } catch (error) {
        console.error('VectHare: Failed to purge all', error);
        toastr.error('Failed to purge all vector indexes', 'Purge failed');
    }
}

/**
 * Update chunk text (triggers re-embedding)
 * @param {string} collectionId - Collection ID
 * @param {number} hash - Chunk hash
 * @param {string} newText - New text content
 * @param {object} settings - VectHare settings
 */
export async function updateChunkText(collectionId, hash, newText, settings) {
    const backend = await getBackend(settings);
    return await backend.updateChunkText(collectionId, hash, newText, settings);
}

/**
 * Update chunk metadata (no re-embedding)
 * @param {string} collectionId - Collection ID
 * @param {number} hash - Chunk hash
 * @param {object} metadata - Metadata to update (keywords, enabled, etc.)
 * @param {object} settings - VectHare settings
 */
export async function updateChunkMetadata(collectionId, hash, metadata, settings) {
    const backend = await getBackend(settings);
    return await backend.updateChunkMetadata(collectionId, hash, metadata, settings);
}
