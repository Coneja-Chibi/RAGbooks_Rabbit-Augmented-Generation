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
import { SECRET_KEYS, secret_state } from '../../../../secrets.js';
import { textgen_types, textgenerationwebui_settings } from '../../../../textgen-settings.js';
import { oai_settings } from '../../../../openai.js';
import { isWebLlmSupported } from '../../../shared.js';
import { WebLlmVectorProvider } from '../providers/webllm.js';
import { getBackend } from '../backends/backend-manager.js';

// Initialize WebLLM provider
const webllmProvider = new WebLlmVectorProvider();

// List of providers that require custom API URLs
const vectorApiRequiresUrl = ['llamacpp', 'vllm', 'ollama', 'koboldcpp'];

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
 * Special handling for WebLLM and KoboldCpp which generate embeddings client-side.
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
    }
    return args;
}

/**
 * Creates WebLLM embeddings for a list of items.
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

    const embeddings = await webllmProvider.embedTexts(items, settings.webllm_model);
    const result = /** @type {Record<string, number[]>} */ ({});
    for (let i = 0; i < items.length; i++) {
        result[items[i]] = embeddings[i];
    }
    return result;
}

/**
 * Creates KoboldCpp embeddings for a list of items.
 * @param {string[]} items Items to embed
 * @param {object} settings VectHare settings object
 * @returns {Promise<{embeddings: Record<string, number[]>, model: string}>} Calculated embeddings
 */
async function createKoboldCppEmbeddings(items, settings) {
    const response = await fetch('/api/backends/kobold/embed', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            items: items,
            server: settings.use_alt_endpoint ? settings.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.KOBOLDCPP],
        }),
    });

    if (!response.ok) {
        throw new Error('Failed to get KoboldCpp embeddings');
    }

    const data = await response.json();
    if (!Array.isArray(data.embeddings) || !data.model || data.embeddings.length !== items.length) {
        throw new Error('Invalid response from KoboldCpp embeddings');
    }

    const embeddings = /** @type {Record<string, number[]>} */ ({});
    for (let i = 0; i < data.embeddings.length; i++) {
        if (!Array.isArray(data.embeddings[i]) || data.embeddings[i].length === 0) {
            throw new Error('KoboldCpp returned an empty embedding. Reduce the chunk size and/or size threshold and try again.');
        }

        embeddings[items[i]] = data.embeddings[i];
    }

    return {
        embeddings: embeddings,
        model: data.model,
    };
}

/**
 * Throws an error if the source is invalid (missing API key or URL, or missing module)
 * @param {object} settings VectHare settings object
 */
export function throwIfSourceInvalid(settings) {
    if (settings.source === 'openai' && !secret_state[SECRET_KEYS.OPENAI] ||
        settings.source === 'electronhub' && !secret_state[SECRET_KEYS.ELECTRONHUB] ||
        settings.source === 'openrouter' && !secret_state[SECRET_KEYS.OPENROUTER] ||
        settings.source === 'palm' && !secret_state[SECRET_KEYS.MAKERSUITE] ||
        settings.source === 'vertexai' && !secret_state[SECRET_KEYS.VERTEXAI] && !secret_state[SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT] ||
        settings.source === 'mistral' && !secret_state[SECRET_KEYS.MISTRALAI] ||
        settings.source === 'togetherai' && !secret_state[SECRET_KEYS.TOGETHERAI] ||
        settings.source === 'nomicai' && !secret_state[SECRET_KEYS.NOMICAI] ||
        settings.source === 'cohere' && !secret_state[SECRET_KEYS.COHERE]) {
        throw new Error('VectHare: API key missing', { cause: 'api_key_missing' });
    }

    if (vectorApiRequiresUrl.includes(settings.source) && settings.use_alt_endpoint) {
        if (!settings.alt_endpoint_url) {
            throw new Error('VectHare: API URL missing', { cause: 'api_url_missing' });
        }
    }
    else {
        if (settings.source === 'ollama' && !textgenerationwebui_settings.server_urls[textgen_types.OLLAMA] ||
            settings.source === 'vllm' && !textgenerationwebui_settings.server_urls[textgen_types.VLLM] ||
            settings.source === 'koboldcpp' && !textgenerationwebui_settings.server_urls[textgen_types.KOBOLDCPP] ||
            settings.source === 'llamacpp' && !textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP]) {
            throw new Error('VectHare: API URL missing', { cause: 'api_url_missing' });
        }
    }

    if (settings.source === 'ollama' && !settings.ollama_model || settings.source === 'vllm' && !settings.vllm_model) {
        throw new Error('VectHare: API model missing', { cause: 'api_model_missing' });
    }

    if (settings.source === 'extras' && !modules.includes('embeddings')) {
        throw new Error('VectHare: Embeddings module missing', { cause: 'extras_module_missing' });
    }

    if (settings.source === 'webllm' && (!isWebLlmSupported() || !settings.webllm_model)) {
        throw new Error('VectHare: WebLLM is not supported', { cause: 'webllm_not_supported' });
    }
}

/**
 * Gets the saved hashes for a collection
 * @param {string} collectionId Collection ID
 * @param {object} settings VectHare settings object
 * @returns {Promise<number[]>} Saved hashes
 */
export async function getSavedHashes(collectionId, settings) {
    const backend = await getBackend(settings);
    return await backend.getSavedHashes(collectionId, settings);
}

/**
 * Inserts vector items into a collection
 * @param {string} collectionId - The collection to insert into
 * @param {{ hash: number, text: string }[]} items - The items to insert
 * @param {object} settings VectHare settings object
 * @returns {Promise<void>}
 */
export async function insertVectorItems(collectionId, items, settings) {
    const backend = await getBackend(settings);
    return await backend.insertVectorItems(collectionId, items, settings);
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
 * @param {string} collectionId - The collection to query
 * @param {string} searchText - The text to query
 * @param {number} topK - The number of results to return
 * @param {object} settings VectHare settings object
 * @returns {Promise<{ hashes: number[], metadata: object[]}>} - Hashes and metadata of the results
 */
export async function queryCollection(collectionId, searchText, topK, settings) {
    const backend = await getBackend(settings);
    return await backend.queryCollection(collectionId, searchText, topK, settings);
}

/**
 * Queries multiple collections for a given text.
 * @param {string[]} collectionIds - Collection IDs to query
 * @param {string} searchText - Text to query
 * @param {number} topK - Number of results to return
 * @param {number} threshold - Score threshold
 * @param {object} settings VectHare settings object
 * @returns {Promise<Record<string, { hashes: number[], metadata: object[] }>>} - Results mapped to collection IDs
 */
export async function queryMultipleCollections(collectionIds, searchText, topK, threshold, settings) {
    const backend = await getBackend(settings);
    return await backend.queryMultipleCollections(collectionIds, searchText, topK, threshold, settings);
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
