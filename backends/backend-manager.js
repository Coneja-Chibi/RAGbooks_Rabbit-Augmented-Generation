/**
 * ============================================================================
 * BACKEND MANAGER
 * ============================================================================
 * Tiny dispatcher that routes vector operations to the selected backend.
 * Keeps the abstraction layer clean and focused.
 *
 * @author VectHare
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { extension_settings } from '../../../../extensions.js';
import { StandardBackend } from './standard.js';
import { LanceDBBackend } from './lancedb.js';
import { QdrantBackend } from './qdrant.js';
import { MilvusBackend } from './milvus.js';

// Backend registry - add new backends here
const BACKENDS = {
    standard: StandardBackend,
    lancedb: LanceDBBackend,
    qdrant: QdrantBackend,
    milvus: MilvusBackend,
};

// Backend name aliases (server uses 'vectra', we use 'standard')
const BACKEND_ALIASES = {
    vectra: 'standard',
};

/**
 * Normalize backend name (handles aliases like vectra -> standard)
 * @param {string} backendName - Backend name (may be an alias)
 * @returns {string} Normalized backend name
 */
function normalizeBackendName(backendName) {
    if (!backendName) return 'standard';
    const normalized = BACKEND_ALIASES[backendName] || backendName;
    return normalized;
}

// Multi-backend instance cache (allows different backends simultaneously)
const backendInstances = {};
const backendHealthStatus = {};

/**
 * Initialize a specific backend (caches instances for reuse)
 * @param {string} backendName - 'standard', 'lancedb', or 'qdrant'
 * @param {object} settings - VectHare settings
 * @param {boolean} throwOnFail - Whether to throw on health check failure (default: true)
 * @returns {Promise<VectorBackend|null>} The backend instance or null if failed and throwOnFail=false
 */
export async function initializeBackend(backendName, settings, throwOnFail = true) {
    // Normalize backend name (vectra -> standard, etc.)
    const normalizedName = normalizeBackendName(backendName);

    // If already have a healthy instance, return it
    if (backendInstances[normalizedName] && backendHealthStatus[normalizedName]) {
        return backendInstances[normalizedName];
    }

    // Get backend class
    const BackendClass = BACKENDS[normalizedName];
    if (!BackendClass) {
        if (throwOnFail) {
            throw new Error(`Unknown backend: ${backendName} (normalized: ${normalizedName}). Available: ${Object.keys(BACKENDS).join(', ')}`);
        }
        console.warn(`VectHare: Unknown backend: ${backendName}`);
        return null;
    }

    console.log(`VectHare: Initializing ${normalizedName} backend${backendName !== normalizedName ? ` (from alias: ${backendName})` : ''}...`);

    try {
        // Create and initialize new backend
        const backend = new BackendClass();
        await backend.initialize(settings);

        // Health check
        const healthy = await backend.healthCheck();
        if (!healthy) {
            backendHealthStatus[normalizedName] = false;
            if (throwOnFail) {
                throw new Error(`Backend ${normalizedName} failed health check`);
            }
            console.warn(`VectHare: Backend ${normalizedName} failed health check, marking as unavailable`);
            return null;
        }

        // Cache the healthy instance
        backendInstances[normalizedName] = backend;
        backendHealthStatus[normalizedName] = true;

        console.log(`VectHare: Successfully initialized ${normalizedName} backend`);
        return backend;
    } catch (error) {
        backendHealthStatus[normalizedName] = false;
        if (throwOnFail) {
            throw error;
        }
        console.warn(`VectHare: Failed to initialize ${normalizedName} backend:`, error.message);
        return null;
    }
}

/**
 * Get a backend instance for operations
 * Uses the backend specified in settings
 * @param {object} settings - VectHare settings (may include .vector_backend override)
 * @param {string} [preferredBackend] - Optional specific backend to use (overrides settings)
 * @returns {Promise<VectorBackend>}
 */
export async function getBackend(settings, preferredBackend = null) {
    // Priority: explicit parameter > settings.vector_backend > global setting > 'standard'
    const backendName = preferredBackend
        || settings?.vector_backend
        || extension_settings.vecthare?.vector_backend
        || 'standard';

    // Try to get/initialize the requested backend - throw on failure
    const backend = await initializeBackend(backendName, settings, true);

    return backend;
}

/**
 * Get a backend for a specific collection (uses collection's stored backend)
 * @param {string} collectionBackend - The backend the collection was created with
 * @param {object} settings - VectHare settings
 * @returns {Promise<VectorBackend>}
 */
export async function getBackendForCollection(collectionBackend, settings) {
    if (!collectionBackend) {
        throw new Error('Collection backend not specified - this is a bug');
    }
    return getBackend(settings, collectionBackend);
}

/**
 * Check if a specific backend is available/healthy
 * @param {string} backendName - Backend to check
 * @param {object} settings - VectHare settings
 * @returns {Promise<boolean>}
 */
export async function isBackendAvailable(backendName, settings) {
    const normalizedName = normalizeBackendName(backendName);

    // If we already know it's unhealthy, return false without retrying
    if (backendHealthStatus[normalizedName] === false) {
        return false;
    }

    // If we have a healthy instance, return true
    if (backendInstances[normalizedName] && backendHealthStatus[normalizedName]) {
        return true;
    }

    // Try to initialize (don't throw on failure)
    const backend = await initializeBackend(backendName, settings, false);
    return backend !== null;
}

/**
 * Reset backend health status (allows retry after configuration changes)
 * @param {string} [backendName] - Specific backend to reset, or all if omitted
 */
export function resetBackendHealth(backendName = null) {
    if (backendName) {
        const normalizedName = normalizeBackendName(backendName);
        delete backendHealthStatus[normalizedName];
        delete backendInstances[normalizedName];
        console.log(`VectHare: Reset backend health status for ${normalizedName}${backendName !== normalizedName ? ` (alias: ${backendName})` : ''}`);
    } else {
        // Reset all
        for (const name of Object.keys(backendHealthStatus)) {
            delete backendHealthStatus[name];
            delete backendInstances[name];
        }
        console.log('VectHare: Reset backend health status for all backends');
    }
}

/**
 * Get available backend names
 * @returns {string[]}
 */
export function getAvailableBackends() {
    return Object.keys(BACKENDS);
}
