/**
 * ============================================================================
 * VECTOR BACKEND INTERFACE
 * ============================================================================
 * Common interface that all vector backends must implement.
 * Keeps backends small, focused, and swappable.
 *
 * @author VectHare
 * @version 2.0.0-alpha
 * ============================================================================
 */

/**
 * Base class for all vector backends.
 * All backends must extend this and implement all methods.
 */
export class VectorBackend {
    /**
     * Initialize the backend with settings
     * @param {object} settings - VectHare settings
     */
    async initialize(settings) {
        throw new Error('Backend must implement initialize()');
    }

    /**
     * Check if backend is available/healthy
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        throw new Error('Backend must implement healthCheck()');
    }

    /**
     * Get saved hashes for a collection
     * @param {string} collectionId
     * @param {object} settings
     * @returns {Promise<number[]>}
     */
    async getSavedHashes(collectionId, settings) {
        throw new Error('Backend must implement getSavedHashes()');
    }

    /**
     * Insert vector items into collection
     * @param {string} collectionId
     * @param {object[]} items - {hash, text, index, vector}
     * @param {object} settings
     * @returns {Promise<void>}
     */
    async insertVectorItems(collectionId, items, settings) {
        throw new Error('Backend must implement insertVectorItems()');
    }

    /**
     * Delete specific items by hash
     * @param {string} collectionId
     * @param {number[]} hashes
     * @param {object} settings
     * @returns {Promise<void>}
     */
    async deleteVectorItems(collectionId, hashes, settings) {
        throw new Error('Backend must implement deleteVectorItems()');
    }

    /**
     * Query collection for similar vectors
     * @param {string} collectionId
     * @param {string} searchText
     * @param {number} topK
     * @param {object} settings
     * @returns {Promise<object[]>}
     */
    async queryCollection(collectionId, searchText, topK, settings) {
        throw new Error('Backend must implement queryCollection()');
    }

    /**
     * Query multiple collections
     * @param {string[]} collectionIds
     * @param {string} searchText
     * @param {number} topK
     * @param {number} threshold
     * @param {object} settings
     * @returns {Promise<object[]>}
     */
    async queryMultipleCollections(collectionIds, searchText, topK, threshold, settings) {
        throw new Error('Backend must implement queryMultipleCollections()');
    }

    /**
     * Purge entire collection
     * @param {string} collectionId
     * @param {object} settings
     * @returns {Promise<void>}
     */
    async purgeVectorIndex(collectionId, settings) {
        throw new Error('Backend must implement purgeVectorIndex()');
    }

    /**
     * Purge file-based collection
     * @param {string} collectionId
     * @param {object} settings
     * @returns {Promise<void>}
     */
    async purgeFileVectorIndex(collectionId, settings) {
        throw new Error('Backend must implement purgeFileVectorIndex()');
    }

    /**
     * Purge all collections
     * @param {object} settings
     * @returns {Promise<void>}
     */
    async purgeAllVectorIndexes(settings) {
        throw new Error('Backend must implement purgeAllVectorIndexes()');
    }
}
