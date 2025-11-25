/**
 * ============================================================================
 * STANDARD BACKEND (ST's Vectra API)
 * ============================================================================
 * Wrapper around ST's existing vector API (/api/vector/*).
 * Uses ST's backend (Vectra) - compatible with all ST features.
 *
 * This is the default backend - no setup required.
 *
 * @author VectHare
 * @version 2.0.0-alpha
 * ============================================================================
 */

import { getRequestHeaders } from '../../../../../script.js';
import { VectorBackend } from './backend-interface.js';
import {
    getVectorsRequestBody,
    getAdditionalArgs,
    throwIfSourceInvalid
} from '../core-vector-api.js';

export class StandardBackend extends VectorBackend {
    constructor() {
        super();
        this.pluginAvailable = false;
    }

    async initialize(settings) {
        // Check if VectHare plugin is available
        try {
            const response = await fetch('/api/plugins/vecthare/health');
            this.pluginAvailable = response.ok;

            if (this.pluginAvailable) {
                console.log('VectHare: Using Standard backend with plugin (full metadata support)');
            } else {
                console.log('VectHare: Using Standard backend (ST Vectra API, basic metadata only)');
            }
        } catch (e) {
            console.log('VectHare: Using Standard backend (ST Vectra API, basic metadata only)');
            this.pluginAvailable = false;
        }
    }

    async healthCheck() {
        // ST backend is always available
        return true;
    }

    async getSavedHashes(collectionId, settings) {
        const args = await getAdditionalArgs([], settings);
        const response = await fetch('/api/vector/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(args, settings),
                collectionId: collectionId,
                source: settings.source,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to get saved hashes: ${response.statusText}`);
        }

        return await response.json();
    }

    async insertVectorItems(collectionId, items, settings) {
        throwIfSourceInvalid(settings);

        // Use plugin endpoint if available (stores FULL metadata)
        if (this.pluginAvailable) {
            try {
                const response = await fetch('/api/plugins/vecthare/vectra/insert', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        collectionId: collectionId,
                        items: items,
                        source: settings.source,
                    }),
                });

                if (response.ok) {
                    return; // Success with full metadata
                }
            } catch (e) {
                console.warn('VectHare: Plugin endpoint failed, falling back to ST API');
            }
        }

        // Fallback to ST's endpoint (basic metadata only: hash, text, index)
        const args = await getAdditionalArgs(items.map(x => x.text), settings);
        const response = await fetch('/api/vector/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(args, settings),
                collectionId: collectionId,
                items: items,
                source: settings.source,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to insert vectors: ${response.statusText}`);
        }
    }

    async deleteVectorItems(collectionId, hashes, settings) {
        const args = await getAdditionalArgs([], settings);
        const response = await fetch('/api/vector/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(args, settings),
                collectionId: collectionId,
                hashes: hashes,
                source: settings.source,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to delete vectors: ${response.statusText}`);
        }
    }

    async queryCollection(collectionId, searchText, topK, settings) {
        throwIfSourceInvalid(settings);

        const args = await getAdditionalArgs([searchText], settings);
        const response = await fetch('/api/vector/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(args, settings),
                collectionId: collectionId,
                searchText: searchText,
                topK: topK,
                source: settings.source,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to query collection: ${response.statusText}`);
        }

        return await response.json();
    }

    async queryMultipleCollections(collectionIds, searchText, topK, threshold, settings) {
        throwIfSourceInvalid(settings);

        const args = await getAdditionalArgs([searchText], settings);
        const response = await fetch('/api/vector/query-multi', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(args, settings),
                collectionIds: collectionIds,
                searchText: searchText,
                topK: topK,
                threshold: threshold,
                source: settings.source,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to query multiple collections: ${response.statusText}`);
        }

        return await response.json();
    }

    async purgeVectorIndex(collectionId, settings) {
        const args = await getAdditionalArgs([], settings);
        const response = await fetch('/api/vector/purge', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(args, settings),
                collectionId: collectionId,
                source: settings.source,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to purge collection: ${response.statusText}`);
        }
    }

    async purgeFileVectorIndex(collectionId, settings) {
        const args = await getAdditionalArgs([], settings);
        const response = await fetch('/api/vector/purge-file', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(args, settings),
                collectionId: collectionId,
                source: settings.source,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to purge file collection: ${response.statusText}`);
        }
    }

    async purgeAllVectorIndexes(settings) {
        const args = await getAdditionalArgs([], settings);
        const response = await fetch('/api/vector/purge-all', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                ...getVectorsRequestBody(args, settings),
                source: settings.source,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to purge all collections: ${response.statusText}`);
        }
    }
}
