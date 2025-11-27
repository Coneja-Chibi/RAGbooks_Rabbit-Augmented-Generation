/**
 * ============================================================================
 * VECTHARE DIAGNOSTICS - INFRASTRUCTURE
 * ============================================================================
 * Backend, provider, and plugin availability checks
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { getRequestHeaders } from '../../../../../script.js';
import { secret_state } from '../../../../secrets.js';
import { textgen_types, textgenerationwebui_settings } from '../../../../textgen-settings.js';
import {
    EMBEDDING_PROVIDERS,
    getValidProviderIds,
    isValidProvider,
    getProviderConfig,
    getModelField,
    getSecretKey,
    requiresApiKey,
    requiresUrl,
    getUrlProviders
} from '../core/providers.js';

/**
 * Check: ST Vectra backend (standard file-based vector storage)
 * This is the default backend - always available if ST is running
 */
export async function checkVectorsExtension() {
    try {
        const response = await fetch('/api/vector/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId: 'test',
                source: 'transformers'
            })
        });

        if (response.status === 404) {
            return {
                name: 'ST Vectra (Standard)',
                status: 'fail',
                message: 'ST vector API not available - check SillyTavern installation',
                fixable: false,
                category: 'infrastructure'
            };
        }

        return {
            name: 'ST Vectra (Standard)',
            status: 'pass',
            message: 'Standard file-based vector storage ready',
            category: 'infrastructure'
        };
    } catch (error) {
        return {
            name: 'ST Vectra (Standard)',
            status: 'fail',
            message: 'Cannot reach ST vector API',
            fixable: false,
            category: 'infrastructure'
        };
    }
}

/**
 * Check: ST Vector API endpoints
 * Tests all /api/vector/* endpoints comprehensively
 */
export async function checkBackendEndpoints(settings) {
    const results = [];
    const source = settings.source || 'transformers';

    const endpoints = [
        { name: 'list', method: 'POST', url: '/api/vector/list', body: { collectionId: 'vecthare_diag', source } },
        { name: 'query', method: 'POST', url: '/api/vector/query', body: { collectionId: 'vecthare_diag', searchText: 'test', topK: 1, source } },
        { name: 'insert', method: 'POST', url: '/api/vector/insert', body: { collectionId: 'vecthare_diag', items: [], source } },
        { name: 'delete', method: 'POST', url: '/api/vector/delete', body: { collectionId: 'vecthare_diag', hashes: [], source } },
        { name: 'purge', method: 'POST', url: '/api/vector/purge', body: { collectionId: 'vecthare_diag_nonexistent' } },
    ];

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint.url, {
                method: endpoint.method,
                headers: getRequestHeaders(),
                body: JSON.stringify(endpoint.body),
            });

            if (response.status === 404) {
                results.push({ name: endpoint.name, ok: false, status: 404 });
            } else {
                results.push({ name: endpoint.name, ok: true, status: response.status });
            }
        } catch (error) {
            results.push({ name: endpoint.name, ok: false, error: error.message });
        }
    }

    const passed = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);

    const formatResults = results.map(r =>
        `${r.name} ${r.ok ? '✓' : `✗(${r.status || r.error})`}`
    ).join(', ');

    if (failed.length === 0) {
        return {
            name: 'ST Vector Endpoints',
            status: 'pass',
            message: `All ${passed.length} endpoints: ${formatResults}`,
            category: 'infrastructure',
        };
    } else if (passed.length > 0) {
        return {
            name: 'ST Vector Endpoints',
            status: 'warning',
            message: `${passed.length}/${results.length} working: ${formatResults}`,
            category: 'infrastructure',
        };
    } else {
        return {
            name: 'ST Vector Endpoints',
            status: 'fail',
            message: 'No ST vector endpoints available',
            category: 'infrastructure',
        };
    }
}

/**
 * Check: VectHare Server Plugin (similharity)
 * Provides advanced features: LanceDB, Qdrant, collection browser, full metadata
 */
export async function checkServerPlugin() {
    try {
        const response = await fetch('/api/plugins/similharity/health', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            return {
                name: 'VectHare Plugin',
                status: 'warning',
                message: 'Plugin not installed (optional - enables LanceDB, Qdrant, advanced features)',
                fixable: false,
                category: 'infrastructure'
            };
        }

        const data = await response.json();

        if (data.status !== 'ok') {
            return {
                name: 'VectHare Plugin',
                status: 'warning',
                message: `Plugin unhealthy: ${data.status}`,
                category: 'infrastructure'
            };
        }

        const features = data.features?.join(', ') || 'core';
        return {
            name: 'VectHare Plugin',
            status: 'pass',
            message: `v${data.version} - Features: ${features}`,
            category: 'infrastructure'
        };
    } catch (error) {
        return {
            name: 'VectHare Plugin',
            status: 'warning',
            message: 'Plugin not available (standard mode only)',
            category: 'infrastructure'
        };
    }
}

/**
 * Check: VectHare Plugin API Endpoints
 * Tests all plugin-provided endpoints for advanced functionality
 */
export async function checkPluginEndpoints() {
    const results = [];
    const testSource = 'transformers';

    // First check if plugin is available
    try {
        const healthResponse = await fetch('/api/plugins/similharity/health', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!healthResponse.ok) {
            return {
                name: 'Plugin API Endpoints',
                status: 'skipped',
                message: 'Plugin not installed - endpoints not available',
                category: 'infrastructure'
            };
        }
        results.push({ name: 'health', ok: true });
    } catch (error) {
        return {
            name: 'Plugin API Endpoints',
            status: 'skipped',
            message: 'Plugin not available',
            category: 'infrastructure'
        };
    }

    // Test each plugin endpoint (unified API)
    const pluginEndpoints = [
        { name: 'collections', method: 'GET', url: `/api/plugins/similharity/collections` },
        { name: 'sources', method: 'GET', url: '/api/plugins/similharity/sources' },
        { name: 'chunks/list', method: 'POST', url: '/api/plugins/similharity/chunks/list',
          body: { backend: 'vectra', collectionId: 'vecthare_diag', source: testSource, limit: 1 } },
        { name: 'chunks/query', method: 'POST', url: '/api/plugins/similharity/chunks/query',
          body: { backend: 'vectra', collectionId: 'vecthare_diag', searchText: 'test', topK: 1, source: testSource } },
        { name: 'backend/health', method: 'GET', url: '/api/plugins/similharity/backend/health/vectra' },
    ];

    for (const ep of pluginEndpoints) {
        try {
            const opts = {
                method: ep.method,
                headers: getRequestHeaders(),
            };
            if (ep.body) opts.body = JSON.stringify(ep.body);

            const response = await fetch(ep.url, opts);
            results.push({ name: ep.name, ok: response.status !== 404, status: response.status });
        } catch (error) {
            results.push({ name: ep.name, ok: false, error: error.message });
        }
    }

    const passed = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);
    const summary = results.map(r => `${r.name}${r.ok ? '✓' : '✗'}`).join(', ');

    if (failed.length === 0) {
        return {
            name: 'Plugin API Endpoints',
            status: 'pass',
            message: `${passed.length} endpoints: ${summary}`,
            category: 'infrastructure'
        };
    } else if (passed.length > 0) {
        return {
            name: 'Plugin API Endpoints',
            status: 'warning',
            message: `${passed.length}/${results.length}: ${summary}`,
            category: 'infrastructure'
        };
    } else {
        return {
            name: 'Plugin API Endpoints',
            status: 'fail',
            message: `All failed: ${summary}`,
            category: 'infrastructure'
        };
    }
}

/**
 * Check: LanceDB Backend (disk-based, scalable vector storage)
 * Requires VectHare plugin with vectordb package
 */
export async function checkLanceDBBackend(settings) {
    const backendName = 'LanceDB (Scalable)';

    if (settings.vector_backend !== 'lancedb') {
        return {
            name: backendName,
            status: 'skipped',
            message: `Not selected (using: ${settings.vector_backend || 'standard'})`,
            category: 'infrastructure'
        };
    }

    try {
        const healthResponse = await fetch('/api/plugins/similharity/backend/health/lancedb', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!healthResponse.ok) {
            return {
                name: backendName,
                status: 'fail',
                message: 'LanceDB plugin not installed. Run: cd plugins/similharity && npm install vectordb',
                category: 'infrastructure',
                fixable: true,
                fixAction: 'install_lancedb'
            };
        }

        const healthData = await healthResponse.json();

        if (healthData.healthy) {
            return {
                name: backendName,
                status: 'pass',
                message: 'LanceDB ready - disk-based vector storage active',
                category: 'infrastructure'
            };
        } else {
            return {
                name: backendName,
                status: 'warning',
                message: `LanceDB not initialized: ${healthData.message || 'Run "Vectorize All" to create tables'}`,
                category: 'infrastructure'
            };
        }
    } catch (error) {
        return {
            name: backendName,
            status: 'fail',
            message: `LanceDB unavailable: ${error.message}`,
            category: 'infrastructure'
        };
    }
}

/**
 * Check: Qdrant Backend (production-grade vector search)
 * Supports local Docker or Qdrant Cloud
 */
export async function checkQdrantBackend(settings) {
    const isCloud = settings.qdrant_use_cloud;
    const backendName = isCloud ? 'Qdrant (Cloud)' : 'Qdrant (Local)';

    if (settings.vector_backend !== 'qdrant') {
        return {
            name: 'Qdrant (Production)',
            status: 'skipped',
            message: `Not selected (using: ${settings.vector_backend || 'standard'})`,
            category: 'infrastructure'
        };
    }

    // Check configuration
    if (isCloud) {
        if (!settings.qdrant_url) {
            return {
                name: backendName,
                status: 'fail',
                message: 'Qdrant Cloud URL not configured',
                fixable: true,
                fixAction: 'configure_qdrant',
                category: 'infrastructure'
            };
        }
        if (!settings.qdrant_api_key) {
            return {
                name: backendName,
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
                name: backendName,
                status: 'fail',
                message: 'Qdrant local host/port not configured (default: localhost:6333)',
                fixable: true,
                fixAction: 'configure_qdrant',
                category: 'infrastructure'
            };
        }
    }

    try {
        const healthResponse = await fetch('/api/plugins/similharity/backend/health/qdrant', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!healthResponse.ok) {
            return {
                name: backendName,
                status: 'fail',
                message: 'Qdrant plugin not installed. Run: cd plugins/similharity && npm install @qdrant/js-client-rest',
                category: 'infrastructure',
                fixable: true,
                fixAction: 'install_qdrant'
            };
        }

        const healthData = await healthResponse.json();

        if (healthData.healthy) {
            const target = isCloud ? settings.qdrant_url : `${settings.qdrant_host}:${settings.qdrant_port}`;
            return {
                name: backendName,
                status: 'pass',
                message: `Connected to ${target}`,
                category: 'infrastructure'
            };
        } else {
            const error = healthData.message || 'Connection failed';
            return {
                name: backendName,
                status: 'fail',
                message: `Qdrant error: ${error}`,
                fixable: true,
                fixAction: 'configure_qdrant',
                category: 'infrastructure'
            };
        }
    } catch (error) {
        return {
            name: backendName,
            status: 'fail',
            message: `Qdrant unavailable: ${error.message}`,
            category: 'infrastructure'
        };
    }
}

/**
 * Check: Embedding provider is configured properly
 */
export async function checkEmbeddingProvider(settings) {
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

    const config = getProviderConfig(source);
    if (!config) {
        return {
            name: 'Embedding Provider',
            status: 'fail',
            message: `Unknown provider: ${source}`,
            fixable: true,
            fixAction: 'configure_provider'
        };
    }

    const modelField = getModelField(source);
    if (config.requiresModel && modelField && !settings[modelField]) {
        return {
            name: 'Embedding Provider',
            status: 'fail',
            message: `${config.name} selected but no model configured`,
            fixable: true,
            fixAction: 'configure_provider'
        };
    }

    const modelInfo = modelField && settings[modelField] ? ` (${settings[modelField]})` : '';
    return {
        name: 'Embedding Provider',
        status: 'pass',
        message: `Using ${config.name}${modelInfo}`
    };
}

/**
 * Check: API keys are present for cloud providers
 */
export function checkApiKeys(settings) {
    const source = settings.source;

    if (!requiresApiKey(source)) {
        return {
            name: 'API Key',
            status: 'skipped',
            message: 'No API key required for this provider'
        };
    }

    const secretKey = getSecretKey(source);
    const keyPresent = secretKey && secret_state[secretKey];

    if (!keyPresent) {
        const config = getProviderConfig(source);
        return {
            name: 'API Key',
            status: 'fail',
            message: `${config?.name || source} requires an API key`,
            fixable: true,
            fixAction: 'configure_api_key'
        };
    }

    return {
        name: 'API Key',
        status: 'pass',
        message: 'API key configured'
    };
}

/**
 * Check: API URLs are configured for local providers
 */
export function checkApiUrls(settings) {
    const source = settings.source;

    if (!requiresUrl(source)) {
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

    const textgenMapping = {
        'ollama': textgen_types.OLLAMA,
        'vllm': textgen_types.VLLM,
        'llamacpp': textgen_types.LLAMACPP,
        'koboldcpp': textgen_types.KOBOLDCPP
    };

    const config = getProviderConfig(source);
    const url = textgenMapping[source] ? textgenerationwebui_settings.server_urls[textgenMapping[source]] : null;

    if (!url) {
        return {
            name: 'API URL',
            status: 'fail',
            message: `${config?.name || source} requires a server URL`,
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
 * Check: Provider connectivity test
 */
export async function checkProviderConnectivity(settings) {
    if (!isValidProvider(settings.source)) {
        return {
            name: 'Provider Connectivity',
            status: 'fail',
            message: `Unknown provider: ${settings.source}`,
            fixable: true,
            fixAction: 'configure_provider'
        };
    }

    const config = getProviderConfig(settings.source);
    return {
        name: 'Provider Connectivity',
        status: 'pass',
        message: `Provider ${config.name} is recognized`
    };
}
