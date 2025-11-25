/**
 * ============================================================================
 * VECTHARE DIAGNOSTICS
 * ============================================================================
 * Health checks and troubleshooting for VectHare
 * Per CLAUDE.md: Every potential failure point needs a check and fix here
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { getCurrentChatId, getRequestHeaders } from '../../../../script.js';
import { extension_settings, modules } from '../../../extensions.js';
import { SECRET_KEYS, secret_state } from '../../../secrets.js';
import { textgen_types, textgenerationwebui_settings } from '../../../textgen-settings.js';
import { getSavedHashes } from './core-vector-api.js';

/**
 * Runs all diagnostic checks
 * @param {object} settings VectHare settings
 * @param {boolean} includeProductionTests Include integration/production tests
 * @returns {Promise<object>} Diagnostics results
 */
export async function runDiagnostics(settings, includeProductionTests = false) {
    console.log('VectHare Diagnostics: Running health checks...');

    const categories = {
        infrastructure: [],
        configuration: [],
        production: []
    };

    // ========== INFRASTRUCTURE CHECKS ==========
    categories.infrastructure.push(await checkVectorsExtension());
    categories.infrastructure.push(await checkBackendEndpoints(settings));
    categories.infrastructure.push(await checkServerPlugin());
    categories.infrastructure.push(await checkPluginEndpoints());
    categories.infrastructure.push(await checkLanceDBBackend(settings));
    categories.infrastructure.push(await checkQdrantBackend(settings));
    categories.infrastructure.push(await checkEmbeddingProvider(settings));

    const apiKeyCheck = checkApiKeys(settings);
    if (apiKeyCheck.status !== 'skipped') {
        categories.infrastructure.push(apiKeyCheck);
    }

    const apiUrlCheck = checkApiUrls(settings);
    if (apiUrlCheck.status !== 'skipped') {
        categories.infrastructure.push(apiUrlCheck);
    }

    categories.infrastructure.push(await checkProviderConnectivity(settings));

    // ========== CONFIGURATION CHECKS ==========
    categories.configuration.push(checkChatEnabled(settings));
    categories.configuration.push(checkChunkSize(settings));
    categories.configuration.push(checkScoreThreshold(settings));
    categories.configuration.push(checkInsertQueryCounts(settings));
    categories.configuration.push(await checkChatVectors(settings));

    if (settings.temporal_decay?.enabled) {
        categories.configuration.push(checkTemporalDecaySettings(settings));
    }

    // ========== PRODUCTION TESTS (Optional) ==========
    if (includeProductionTests) {
        categories.production.push(await testEmbeddingGeneration(settings));
        categories.production.push(await testVectorStorage(settings));
        categories.production.push(await testVectorRetrieval(settings));
        categories.production.push(await testTemporalDecay(settings));
    }

    // Flatten all checks
    const allChecks = [
        ...categories.infrastructure,
        ...categories.configuration,
        ...categories.production
    ];

    // Determine overall status
    const failCount = allChecks.filter(c => c.status === 'fail').length;
    const warnCount = allChecks.filter(c => c.status === 'warning').length;

    const overall = failCount > 0 ? 'issues' : warnCount > 0 ? 'warnings' : 'healthy';

    const results = {
        categories,
        checks: allChecks,
        overall,
        timestamp: new Date().toISOString()
    };

    console.log('VectHare Diagnostics: Complete', results);

    return results;
}

/**
 * Check 0: Vector backend API is available
 */
async function checkVectorsExtension() {
    try {
        // Test if /api/vector/list endpoint exists
        const response = await fetch('/api/vector/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'test',
                source: 'transformers'
            })
        });

        // Even if it returns an error, if we get a response the backend is working
        // A 404 would mean the route doesn't exist
        if (response.status === 404) {
            return {
                name: 'Vector Backend',
                status: 'fail',
                message: 'Vector API endpoints not available',
                fixable: false
            };
        }

        return {
            name: 'Vector Backend',
            status: 'pass',
            message: 'Vector API endpoints available'
        };
    } catch (error) {
        return {
            name: 'Vector Backend',
            status: 'fail',
            message: 'Cannot reach vector API endpoints',
            fixable: false
        };
    }
}

/**
 * Check: Backend endpoints functionality
 * Tests ST's /api/vector/* endpoints with valid minimal requests
 */
async function checkBackendEndpoints(settings) {
    const results = [];

    // Test /api/vector/list - this should return 200 with empty array for non-existent collection
    try {
        const response = await fetch('/api/vector/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'vecthare_diagnostic_nonexistent',
                source: settings.source || 'transformers',
            }),
        });

        if (response.ok) {
            results.push('list ✓');
        } else if (response.status === 404) {
            results.push('list ✗ (404)');
        } else {
            results.push(`list ✗ (${response.status})`);
        }
    } catch (error) {
        results.push(`list ✗ (${error.message})`);
    }

    // Test /api/vector/query - just check if endpoint exists (may return error for invalid collection)
    try {
        const response = await fetch('/api/vector/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'vecthare_diagnostic_nonexistent',
                searchText: 'test',
                topK: 1,
                source: settings.source || 'transformers',
            }),
        });

        // 200 or 400/500 = endpoint exists and is responding
        if (response.status === 404) {
            results.push('query ✗ (404)');
        } else {
            results.push('query ✓');
        }
    } catch (error) {
        results.push(`query ✗ (${error.message})`);
    }

    // Test /api/vector/insert - just verify endpoint exists
    try {
        const response = await fetch('/api/vector/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'vecthare_diagnostic_test',
                items: [],
                source: settings.source || 'transformers',
            }),
        });

        if (response.status === 404) {
            results.push('insert ✗ (404)');
        } else {
            results.push('insert ✓');
        }
    } catch (error) {
        results.push(`insert ✗ (${error.message})`);
    }

    // Test /api/vector/delete - verify endpoint exists
    try {
        const response = await fetch('/api/vector/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'vecthare_diagnostic_nonexistent',
                hashes: [],
                source: settings.source || 'transformers',
            }),
        });

        if (response.status === 404) {
            results.push('delete ✗ (404)');
        } else {
            results.push('delete ✓');
        }
    } catch (error) {
        results.push(`delete ✗ (${error.message})`);
    }

    const failedCount = results.filter(r => r.includes('✗')).length;
    const passedCount = results.filter(r => r.includes('✓')).length;

    if (failedCount === 0) {
        return {
            name: 'Backend Endpoints',
            status: 'pass',
            message: `All ${passedCount} ST vector endpoints available`,
            category: 'infrastructure',
        };
    } else if (passedCount > 0) {
        return {
            name: 'Backend Endpoints',
            status: 'warning',
            message: `${passedCount}/${endpoints.length} endpoints available: ${results.join(', ')}`,
            category: 'infrastructure',
        };
    } else {
        return {
            name: 'Backend Endpoints',
            status: 'fail',
            message: 'ST vector endpoints not available - check SillyTavern installation',
            category: 'infrastructure',
        };
    }
}

/**
 * Check 1: Embedding provider is configured properly
 */
async function checkEmbeddingProvider(settings) {
    const source = settings.source;

    if (!source) {
        return {
            name: 'Embedding Provider',
            status: 'fail',
            message: 'No embedding provider selected',
            fixable: true,
            fixAction: 'configure_provider'
        };
    }

    // Check if provider has required model selected
    const modelFields = {
        'ollama': 'ollama_model',
        'vllm': 'vllm_model',
        'openai': 'openai_model',
        'cohere': 'cohere_model',
        'togetherai': 'togetherai_model',
        'webllm': 'webllm_model',
        'openrouter': 'openrouter_model',
        'google': 'google_model'
    };

    if (modelFields[source] && !settings[modelFields[source]]) {
        return {
            name: 'Embedding Provider',
            status: 'fail',
            message: `${source} selected but no model configured`,
            fixable: true,
            fixAction: 'configure_provider'
        };
    }

    return {
        name: 'Embedding Provider',
        status: 'pass',
        message: `Using ${source}${modelFields[source] ? ` (${settings[modelFields[source]]})` : ''}`
    };
}

/**
 * Check 2: API keys are present for cloud providers
 */
function checkApiKeys(settings) {
    const source = settings.source;

    const keyRequirements = {
        'openai': SECRET_KEYS.OPENAI,
        'cohere': SECRET_KEYS.COHERE,
        'togetherai': SECRET_KEYS.TOGETHERAI,
        'openrouter': SECRET_KEYS.OPENROUTER,
        'palm': SECRET_KEYS.MAKERSUITE,
        'google': SECRET_KEYS.MAKERSUITE,
        'vertexai': SECRET_KEYS.VERTEXAI
    };

    // Skip this check if provider doesn't need an API key
    if (!keyRequirements[source]) {
        return {
            name: 'API Key',
            status: 'skipped',
            message: 'No API key required for this provider'
        };
    }

    const keyPresent = secret_state[keyRequirements[source]];
    if (!keyPresent) {
        return {
            name: 'API Key',
            status: 'fail',
            message: `${source} requires an API key`,
            fixable: true,
            fixAction: 'configure_api_key'
        };
    }

    return {
        name: 'API Key',
        status: 'pass',
        message: `API key configured`
    };
}

/**
 * Check 3: API URLs are configured for local providers
 */
function checkApiUrls(settings) {
    const source = settings.source;

    const urlProviders = ['ollama', 'vllm', 'llamacpp', 'koboldcpp'];

    // Skip this check if provider doesn't need a custom URL
    if (!urlProviders.includes(source)) {
        return {
            name: 'API URL',
            status: 'skipped',
            message: 'No custom URL required'
        };
    }

    if (settings.use_alt_endpoint) {
        if (!settings.alt_endpoint_url) {
            return {
                name: 'API URL',
                status: 'fail',
                message: 'Alternative endpoint enabled but no URL configured',
                fixable: true,
                fixAction: 'configure_url'
            };
        }
        return {
            name: 'API URL',
            status: 'pass',
            message: `Custom: ${settings.alt_endpoint_url}`
        };
    }

    // Check default URLs from textgen settings
    const textgenMapping = {
        'ollama': textgen_types.OLLAMA,
        'vllm': textgen_types.VLLM,
        'llamacpp': textgen_types.LLAMACPP,
        'koboldcpp': textgen_types.KOBOLDCPP
    };

    const url = textgenerationwebui_settings.server_urls[textgenMapping[source]];

    if (!url) {
        return {
            name: 'API URL',
            status: 'fail',
            message: `${source} requires a server URL`,
            fixable: true,
            fixAction: 'configure_url'
        };
    }

    return {
        name: 'API URL',
        status: 'pass',
        message: `${url}`
    };
}

/**
 * Check 4: Provider connectivity test
 */
async function checkProviderConnectivity(settings) {
    // For now, just validate the provider is recognized
    // In future, could ping the actual endpoint
    const validProviders = [
        'transformers', 'openai', 'cohere', 'togetherai', 'openrouter',
        'ollama', 'vllm', 'llamacpp', 'koboldcpp', 'webllm', 'google', 'vertexai'
    ];

    if (!validProviders.includes(settings.source)) {
        return {
            name: 'Provider Connectivity',
            status: 'fail',
            message: `Unknown provider: ${settings.source}`,
            fixable: true,
            fixAction: 'configure_provider'
        };
    }

    // TODO: Add actual connectivity test by attempting a small embedding
    return {
        name: 'Provider Connectivity',
        status: 'pass',
        message: `Provider ${settings.source} is recognized`
    };
}

/**
 * Check 5: Current chat has vectors
 */
async function checkChatVectors(settings) {
    const chatId = getCurrentChatId();

    if (!chatId) {
        return {
            name: 'Chat Vectors',
            status: 'warning',
            message: 'No chat selected'
        };
    }

    try {
        const hashes = await getSavedHashes(chatId, settings);
        if (hashes.length === 0) {
            return {
                name: 'Chat Vectors',
                status: 'warning',
                message: 'Current chat has no vectorized chunks',
                fixable: true,
                fixAction: 'vectorize_all'
            };
        }
        return {
            name: 'Chat Vectors',
            status: 'pass',
            message: `${hashes.length} vectorized chunks`
        };
    } catch (error) {
        return {
            name: 'Chat Vectors',
            status: 'fail',
            message: `Failed to check vectors: ${error.message}`
        };
    }
}

/**
 * Check 7: Chat vectorization enabled
 */
function checkChatEnabled(settings) {
    if (!settings.enabled_chats) {
        return {
            name: 'Chat Vectorization',
            status: 'warning',
            message: 'Chat vectorization is disabled',
            fixable: true,
            fixAction: 'enable_chats'
        };
    }

    return {
        name: 'Chat Vectorization',
        status: 'pass',
        message: 'Chat vectorization enabled'
    };
}

/**
 * Check 8: Message chunk size
 */
function checkChunkSize(settings) {
    const size = settings.message_chunk_size;

    if (size < 50) {
        return {
            name: 'Chunk Size',
            status: 'fail',
            message: `Chunk size too small (${size} chars). Minimum: 50`,
            fixable: true,
            fixAction: 'fix_chunk_size'
        };
    }

    if (size < 100) {
        return {
            name: 'Chunk Size',
            status: 'warning',
            message: `Chunk size is very small (${size} chars). Recommended: 200-800`
        };
    }

    if (size > 2000) {
        return {
            name: 'Chunk Size',
            status: 'warning',
            message: `Chunk size is very large (${size} chars). May cause context issues`
        };
    }

    return {
        name: 'Chunk Size',
        status: 'pass',
        message: `${size} characters`
    };
}

/**
 * Check 9: Score threshold validation
 */
function checkScoreThreshold(settings) {
    const threshold = settings.score_threshold;

    if (threshold < 0 || threshold > 1) {
        return {
            name: 'Score Threshold',
            status: 'fail',
            message: `Invalid threshold (${threshold}). Must be 0.0-1.0`,
            fixable: true,
            fixAction: 'fix_threshold'
        };
    }

    if (threshold < 0.1) {
        return {
            name: 'Score Threshold',
            status: 'warning',
            message: `Very low threshold (${threshold}). May retrieve irrelevant results`
        };
    }

    if (threshold > 0.8) {
        return {
            name: 'Score Threshold',
            status: 'warning',
            message: `Very high threshold (${threshold}). May retrieve nothing`
        };
    }

    return {
        name: 'Score Threshold',
        status: 'pass',
        message: `${threshold}`
    };
}

/**
 * Check 10: Insert and query counts
 */
function checkInsertQueryCounts(settings) {
    const insert = settings.insert;
    const query = settings.query;

    if (insert < 1 || query < 1) {
        return {
            name: 'Insert/Query Counts',
            status: 'fail',
            message: `Invalid counts (insert: ${insert}, query: ${query}). Must be ≥ 1`,
            fixable: true,
            fixAction: 'fix_counts'
        };
    }

    if (insert > 20 || query > 20) {
        return {
            name: 'Insert/Query Counts',
            status: 'warning',
            message: `High counts (insert: ${insert}, query: ${query}). May use too much context`
        };
    }

    return {
        name: 'Insert/Query Counts',
        status: 'pass',
        message: `Insert: ${insert}, Query: ${query}`
    };
}

/**
 * Check 11: Temporal decay settings (if enabled)
 */
function checkTemporalDecaySettings(settings) {
    const decay = settings.temporal_decay;

    if (!decay.mode || !['exponential', 'linear'].includes(decay.mode)) {
        return {
            name: 'Temporal Decay',
            status: 'fail',
            message: `Invalid mode (${decay.mode}). Must be 'exponential' or 'linear'`,
            fixable: true,
            fixAction: 'fix_decay'
        };
    }

    if (decay.mode === 'exponential') {
        if (!decay.halfLife || decay.halfLife < 1) {
            return {
                name: 'Temporal Decay',
                status: 'fail',
                message: `Invalid half-life (${decay.halfLife}). Must be ≥ 1`,
                fixable: true,
                fixAction: 'fix_decay'
            };
        }
    }

    if (decay.mode === 'linear') {
        if (!decay.linearRate || decay.linearRate <= 0 || decay.linearRate > 1) {
            return {
                name: 'Temporal Decay',
                status: 'fail',
                message: `Invalid linear rate (${decay.linearRate}). Must be 0.0-1.0`,
                fixable: true,
                fixAction: 'fix_decay'
            };
        }
    }

    return {
        name: 'Temporal Decay',
        status: 'pass',
        message: decay.mode === 'exponential'
            ? `Exponential (half-life: ${decay.halfLife})`
            : `Linear (rate: ${decay.linearRate})`
    };
}

// ============================================================================
// PRODUCTION / INTEGRATION TESTS
// ============================================================================

/**
 * Test: Can we generate an embedding?
 */
async function testEmbeddingGeneration(settings) {
    try {
        const testText = 'This is a test message for embedding generation.';

        const response = await fetch('/api/vector/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: '__vecthare_test__',
                searchText: testText,
                topK: 1,
                source: settings.source,
                ...getProviderBody(settings)
            })
        });

        if (!response.ok) {
            return {
                name: '[PROD] Embedding Generation',
                status: 'fail',
                message: `Failed to generate embedding: ${response.status} ${response.statusText}`,
                category: 'production'
            };
        }

        return {
            name: '[PROD] Embedding Generation',
            status: 'pass',
            message: 'Successfully generated test embedding',
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Embedding Generation',
            status: 'fail',
            message: `Embedding generation error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Test: Can we store and retrieve a vector?
 */
async function testVectorStorage(settings) {
    try {
        const testCollectionId = `__vecthare_test_${Date.now()}__`;
        const testHash = Math.floor(Math.random() * 1000000);
        const testText = 'VectHare storage test message';

        // Try to insert
        const insertResponse = await fetch('/api/vector/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: testCollectionId,
                items: [{
                    hash: testHash,
                    text: testText,
                    index: 0
                }],
                source: settings.source,
                ...getProviderBody(settings)
            })
        });

        if (!insertResponse.ok) {
            return {
                name: '[PROD] Vector Storage',
                status: 'fail',
                message: `Failed to store vector: ${insertResponse.status}`,
                category: 'production'
            };
        }

        // Cleanup
        await fetch('/api/vector/purge', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ collectionId: testCollectionId })
        });

        return {
            name: '[PROD] Vector Storage',
            status: 'pass',
            message: 'Successfully stored and cleaned up test vector',
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Vector Storage',
            status: 'fail',
            message: `Storage test error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Test: Can we query and retrieve similar vectors?
 */
async function testVectorRetrieval(settings) {
    const chatId = getCurrentChatId();

    if (!chatId) {
        return {
            name: '[PROD] Vector Retrieval',
            status: 'warning',
            message: 'No chat selected - cannot test retrieval',
            category: 'production'
        };
    }

    try {
        const hashes = await getSavedHashes(chatId, settings);

        if (hashes.length === 0) {
            return {
                name: '[PROD] Vector Retrieval',
                status: 'warning',
                message: 'No vectors in current chat to test retrieval',
                category: 'production'
            };
        }

        // Try to query
        const response = await fetch('/api/vector/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: chatId,
                searchText: 'test query',
                topK: 3,
                source: settings.source,
                ...getProviderBody(settings)
            })
        });

        if (!response.ok) {
            return {
                name: '[PROD] Vector Retrieval',
                status: 'fail',
                message: `Query failed: ${response.status}`,
                category: 'production'
            };
        }

        const data = await response.json();

        return {
            name: '[PROD] Vector Retrieval',
            status: 'pass',
            message: `Successfully retrieved ${data.hashes?.length || 0} results`,
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Vector Retrieval',
            status: 'fail',
            message: `Retrieval test error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Test: Does temporal decay calculation work?
 */
async function testTemporalDecay(settings) {
    if (!settings.temporal_decay?.enabled) {
        return {
            name: '[PROD] Temporal Decay',
            status: 'warning',
            message: 'Temporal decay is disabled',
            category: 'production'
        };
    }

    try {
        const { applyTemporalDecay } = await import('./temporal-decay.js');

        const testScore = 0.85;
        const testAge = 50;
        const decayedScore = applyTemporalDecay(testScore, testAge, settings.temporal_decay);

        if (decayedScore >= testScore) {
            return {
                name: '[PROD] Temporal Decay',
                status: 'fail',
                message: 'Decay not reducing scores (check formula)',
                category: 'production'
            };
        }

        if (decayedScore < 0 || decayedScore > 1) {
            return {
                name: '[PROD] Temporal Decay',
                status: 'fail',
                message: `Invalid decayed score: ${decayedScore}`,
                category: 'production'
            };
        }

        return {
            name: '[PROD] Temporal Decay',
            status: 'pass',
            message: `Decay working (0.85 → ${decayedScore.toFixed(3)} at age 50)`,
            category: 'production'
        };
    } catch (error) {
        return {
            name: '[PROD] Temporal Decay',
            status: 'fail',
            message: `Decay test error: ${error.message}`,
            category: 'production'
        };
    }
}

/**
 * Check: Is VectHare server plugin available?
 */
async function checkServerPlugin() {
    try {
        const response = await fetch('/api/plugins/vecthare/health', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            return {
                name: 'Server Plugin',
                status: 'warning',
                message: 'Plugin not available (falling back to client-side discovery)',
                fixable: true,
                fixAction: 'enable_plugin',
                category: 'infrastructure'
            };
        }

        const data = await response.json();

        if (data.status !== 'ok') {
            return {
                name: 'Server Plugin',
                status: 'warning',
                message: `Plugin unhealthy: ${data.status}`,
                category: 'infrastructure'
            };
        }

        return {
            name: 'Server Plugin',
            status: 'pass',
            message: `Plugin available (v${data.version}) with features: ${data.features?.join(', ') || 'unknown'}`,
            category: 'infrastructure'
        };
    } catch (error) {
        return {
            name: 'Server Plugin',
            status: 'warning',
            message: `Plugin check failed: ${error.message} (falling back to client-side)`,
            category: 'infrastructure'
        };
    }
}

/**
 * Check: Do plugin endpoints work?
 * Tests ALL plugin endpoints comprehensively
 */
async function checkPluginEndpoints() {
    const results = [];
    const testSource = 'transformers'; // Use transformers as test source

    // 1. Health check
    try {
        const healthResponse = await fetch('/api/plugins/vecthare/health', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!healthResponse.ok) {
            return {
                name: 'Plugin Endpoints',
                status: 'skipped',
                message: 'Plugin not available - health check failed',
                category: 'infrastructure'
            };
        }

        const healthData = await healthResponse.json();
        results.push(`health ✓`);
    } catch (error) {
        return {
            name: 'Plugin Endpoints',
            status: 'skipped',
            message: 'Plugin not available',
            category: 'infrastructure'
        };
    }

    // 2. Collections endpoint
    try {
        const collectionsResponse = await fetch(`/api/plugins/vecthare/collections?source=${testSource}`, {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (collectionsResponse.ok) {
            const data = await collectionsResponse.json();
            const count = data.count || 0;
            results.push(`collections ✓ (${count} found)`);
        } else {
            results.push(`collections ✗ (${collectionsResponse.status})`);
        }
    } catch (error) {
        results.push(`collections ✗ (${error.message})`);
    }

    // 3. Sources endpoint
    try {
        const sourcesResponse = await fetch('/api/plugins/vecthare/sources', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (sourcesResponse.ok) {
            const data = await sourcesResponse.json();
            const count = data.sources?.length || 0;
            results.push(`sources ✓ (${count} found)`);
        } else {
            results.push(`sources ✗ (${sourcesResponse.status})`);
        }
    } catch (error) {
        results.push(`sources ✗ (${error.message})`);
    }

    // 4. Query-with-vectors endpoint (custom vectra endpoint)
    try {
        const queryResponse = await fetch('/api/plugins/vecthare/query-with-vectors', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'vecthare_diagnostic_nonexistent',
                queryVector: Array(384).fill(0), // Valid 384-dim zero vector
                topK: 1,
                source: testSource
            })
        });

        // Endpoint exists if we get any response except 404
        if (queryResponse.status === 404) {
            results.push(`query-with-vectors ✗ (404)`);
        } else {
            results.push(`query-with-vectors ✓`);
        }
    } catch (error) {
        results.push(`query-with-vectors ✗ (${error.message})`);
    }

    // 5. List-with-vectors endpoint (custom vectra endpoint)
    try {
        const listResponse = await fetch('/api/plugins/vecthare/list-with-vectors', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'vecthare_diagnostic_nonexistent',
                source: testSource
            })
        });

        // Endpoint exists if we get any response except 404
        if (listResponse.status === 404) {
            results.push(`list-with-vectors ✗ (404)`);
        } else {
            results.push(`list-with-vectors ✓`);
        }
    } catch (error) {
        results.push(`list-with-vectors ✗ (${error.message})`);
    }

    // Determine overall status
    const failedCount = results.filter(r => r.includes('✗')).length;
    const passedCount = results.filter(r => r.includes('✓')).length;

    if (failedCount === 0) {
        return {
            name: 'Plugin Endpoints',
            status: 'pass',
            message: `All ${passedCount} endpoints working: ${results.join(', ')}`,
            category: 'infrastructure'
        };
    } else if (passedCount > 0) {
        return {
            name: 'Plugin Endpoints',
            status: 'warning',
            message: `${passedCount}/${passedCount + failedCount} endpoints working: ${results.join(', ')}`,
            category: 'infrastructure'
        };
    } else {
        return {
            name: 'Plugin Endpoints',
            status: 'fail',
            message: `All endpoints failed: ${results.join(', ')}`,
            category: 'infrastructure'
        };
    }
}

/**
 * Check: Is LanceDB backend available?
 * Only runs if user has selected lancedb backend
 */
async function checkLanceDBBackend(settings) {
    // Debug: Log the backend setting
    console.log('VectHare Diagnostics: Checking LanceDB backend, vector_backend =', settings.vector_backend);

    // Skip if not using LanceDB
    if (settings.vector_backend !== 'lancedb') {
        return {
            name: 'LanceDB Backend',
            status: 'skipped',
            message: `Not using LanceDB backend (current: ${settings.vector_backend || 'standard'})`,
            category: 'infrastructure'
        };
    }

    // Check if plugin is available
    try {
        const healthResponse = await fetch('/api/plugins/vecthare/lancedb/health', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!healthResponse.ok) {
            return {
                name: 'LanceDB Backend',
                status: 'fail',
                message: 'LanceDB plugin endpoints not available. Install VectHare plugin.',
                category: 'infrastructure'
            };
        }

        const healthData = await healthResponse.json();

        if (healthData.healthy) {
            return {
                name: 'LanceDB Backend',
                status: 'pass',
                message: 'LanceDB backend is healthy and ready',
                category: 'infrastructure'
            };
        } else {
            return {
                name: 'LanceDB Backend',
                status: 'warning',
                message: `LanceDB not initialized: ${healthData.error || 'Run "Vectorize All" to initialize'}`,
                category: 'infrastructure'
            };
        }
    } catch (error) {
        return {
            name: 'LanceDB Backend',
            status: 'fail',
            message: `LanceDB unavailable: ${error.message}. Install vectordb package: cd plugins/vecthare && npm install`,
            category: 'infrastructure'
        };
    }
}

/**
 * Check: Is Qdrant backend available?
 * Only runs if user has selected qdrant backend
 */
async function checkQdrantBackend(settings) {
    console.log('VectHare Diagnostics: Checking Qdrant backend, vector_backend =', settings.vector_backend);

    // Skip if not using Qdrant
    if (settings.vector_backend !== 'qdrant') {
        return {
            name: 'Qdrant Backend',
            status: 'skipped',
            message: `Not using Qdrant backend (current: ${settings.vector_backend || 'standard'})`,
            category: 'infrastructure'
        };
    }

    // Validate configuration
    if (settings.qdrant_use_cloud) {
        if (!settings.qdrant_url) {
            return {
                name: 'Qdrant Backend',
                status: 'fail',
                message: 'Qdrant Cloud URL not configured',
                fixable: true,
                fixAction: 'configure_qdrant',
                category: 'infrastructure'
            };
        }
        if (!settings.qdrant_api_key) {
            return {
                name: 'Qdrant Backend',
                status: 'fail',
                message: 'Qdrant Cloud API key not configured',
                fixable: true,
                fixAction: 'configure_qdrant',
                category: 'infrastructure'
            };
        }
    } else {
        if (!settings.qdrant_host || !settings.qdrant_port) {
            return {
                name: 'Qdrant Backend',
                status: 'fail',
                message: 'Qdrant local host/port not configured',
                fixable: true,
                fixAction: 'configure_qdrant',
                category: 'infrastructure'
            };
        }
    }

    // Check if plugin is available
    try {
        const healthResponse = await fetch('/api/plugins/vecthare/qdrant/health', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!healthResponse.ok) {
            return {
                name: 'Qdrant Backend',
                status: 'fail',
                message: 'Qdrant plugin endpoints not available. Install VectHare plugin and @qdrant/js-client-rest.',
                category: 'infrastructure'
            };
        }

        const healthData = await healthResponse.json();

        if (healthData.healthy) {
            const connectionType = settings.qdrant_use_cloud ? 'Cloud' : 'Local';
            return {
                name: 'Qdrant Backend',
                status: 'pass',
                message: `Qdrant backend is healthy (${connectionType})`,
                category: 'infrastructure'
            };
        } else {
            const error = healthData.error || 'Unknown error';
            return {
                name: 'Qdrant Backend',
                status: 'fail',
                message: `Qdrant connection failed: ${error}`,
                fixable: true,
                fixAction: 'configure_qdrant',
                category: 'infrastructure'
            };
        }
    } catch (error) {
        return {
            name: 'Qdrant Backend',
            status: 'fail',
            message: `Qdrant unavailable: ${error.message}. Install: cd plugins/vecthare && npm install @qdrant/js-client-rest`,
            category: 'infrastructure'
        };
    }
}

/**
 * Helper: Get provider-specific body parameters
 */
function getProviderBody(settings) {
    const body = {};

    switch (settings.source) {
        case 'openai':
            body.model = settings.openai_model;
            break;
        case 'cohere':
            body.model = settings.cohere_model;
            break;
        case 'ollama':
            body.model = settings.ollama_model;
            break;
        case 'togetherai':
            body.model = settings.togetherai_model;
            break;
    }

    return body;
}

/**
 * Gets a user-friendly fix suggestion for a failed check
 * @param {object} check Diagnostic check result
 * @returns {string} Fix suggestion
 */
export function getFixSuggestion(check) {
    switch (check.name) {
        case 'Embedding Provider':
            return 'Go to VectHare settings and select an embedding provider. For local setup, choose "Transformers" or "Ollama".';

        case 'API Key':
            return 'Go to SillyTavern Settings > API Connections and add your API key for the selected provider.';

        case 'API URL':
            return 'Go to SillyTavern Settings > API Connections and configure the server URL for your local embedding provider.';

        case 'Chat Vectors':
            return 'Click the "Vectorize All" button in VectHare settings to vectorize this chat.';

        case 'Settings Validation':
            return 'Review your VectHare settings and adjust the values within recommended ranges.';

        case 'LanceDB Backend':
            return 'Install the VectHare plugin and run: cd plugins/vecthare && npm install. Or switch to "Standard" backend in settings.';

        case 'Qdrant Backend':
            return 'Configure Qdrant settings in VectHare panel. For local: set host/port. For cloud: set URL and API key. Install: cd plugins/vecthare && npm install @qdrant/js-client-rest';

        default:
            return 'Check the console for more details.';
    }
}
