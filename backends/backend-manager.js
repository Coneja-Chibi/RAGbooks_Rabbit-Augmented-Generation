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

// Backend registry - add new backends here
const BACKENDS = {
    standard: StandardBackend,
    lancedb: LanceDBBackend,
    qdrant: QdrantBackend,
};

// Singleton instance
let currentBackend = null;
let currentBackendName = null;

/**
 * Initialize or switch to a backend
 * @param {string} backendName - 'standard', 'lancedb', or 'qdrant'
 * @param {object} settings - VectHare settings
 * @returns {Promise<void>}
 */
export async function initializeBackend(backendName, settings) {
    // If already using this backend, skip
    if (currentBackend && currentBackendName === backendName) {
        return;
    }

    // Get backend class
    const BackendClass = BACKENDS[backendName];
    if (!BackendClass) {
        throw new Error(`Unknown backend: ${backendName}. Available: ${Object.keys(BACKENDS).join(', ')}`);
    }

    console.log(`VectHare: Initializing ${backendName} backend...`);

    // Create and initialize new backend
    const backend = new BackendClass();
    await backend.initialize(settings);

    // Health check
    const healthy = await backend.healthCheck();
    if (!healthy) {
        throw new Error(`Backend ${backendName} failed health check`);
    }

    // Switch to new backend
    currentBackend = backend;
    currentBackendName = backendName;

    console.log(`VectHare: Successfully switched to ${backendName} backend`);
}

/**
 * Get the current active backend
 * Auto-initializes to 'standard' if not initialized
 * @param {object} settings - VectHare settings
 * @returns {Promise<VectorBackend>}
 */
export async function getBackend(settings) {
    if (!currentBackend) {
        const backendName = extension_settings.vecthare?.vector_backend || 'standard';
        await initializeBackend(backendName, settings);
    }
    return currentBackend;
}

/**
 * Get available backend names
 * @returns {string[]}
 */
export function getAvailableBackends() {
    return Object.keys(BACKENDS);
}
