/**
 * ============================================================================
 * VECTHARE DIAGNOSTICS - INDEX
 * ============================================================================
 * Main entry point for diagnostics system
 * Per CLAUDE.md: Every potential failure point needs a check and fix here
 *
 * @author Coneja Chibi
 * @version 2.0.0-alpha
 * ============================================================================
 */

import {
    checkVectorsExtension,
    checkBackendEndpoints,
    checkServerPlugin,
    checkPluginEndpoints,
    checkLanceDBBackend,
    checkQdrantBackend,
    checkEmbeddingProvider,
    checkApiKeys,
    checkApiUrls,
    checkProviderConnectivity
} from './infrastructure.js';

import {
    checkChatEnabled,
    checkChunkSize,
    checkScoreThreshold,
    checkInsertQueryCounts,
    checkChatVectors,
    checkTemporalDecaySettings,
    checkTemporallyBlindChunks,
    checkConditionalActivationModule,
    checkCollectionIdFormat
} from './configuration.js';

import {
    testEmbeddingGeneration,
    testVectorStorage,
    testVectorRetrieval,
    testTemporalDecay,
    testTemporallyBlindChunks,
    testChunkServerSync,
    testDuplicateHashes,
    fixOrphanedMetadata,
    fixDuplicateHashes
} from './production-tests.js';

import { testConditionalActivation } from './activation-tests.js';

import { runVisualizerTests } from './visualizer-tests.js';
import { cleanupTestCollections } from '../core/collection-loader.js';

/**
 * Runs all diagnostic checks
 * @param {object} settings VectHare settings
 * @param {boolean} includeProductionTests Include integration/production tests
 * @returns {Promise<object>} Diagnostics results
 */
export async function runDiagnostics(settings, includeProductionTests = false) {
    console.log('VectHare Diagnostics: Running health checks...');

    // Auto-clean any ghost test collections from the registry
    const testCollectionsCleaned = cleanupTestCollections();
    if (testCollectionsCleaned > 0) {
        console.log(`VectHare Diagnostics: Cleaned ${testCollectionsCleaned} ghost test collections from registry`);
    }

    const categories = {
        infrastructure: [],
        configuration: [],
        visualizer: [],
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

    // Temporal decay is now per-collection, always report status
    categories.configuration.push(checkTemporalDecaySettings(settings));
    categories.configuration.push(await checkTemporallyBlindChunks(settings));

    // Conditional activation checks
    categories.configuration.push(checkConditionalActivationModule());

    // Collection ID format check (UUID-based multitenancy)
    categories.configuration.push(checkCollectionIdFormat());

    // ========== VISUALIZER CHECKS ==========
    // Fast checks always run, slow (API) checks only with production tests
    const visualizerResults = await runVisualizerTests(settings, includeProductionTests);
    categories.visualizer.push(...visualizerResults);

    // ========== PRODUCTION TESTS (Optional) ==========
    if (includeProductionTests) {
        categories.production.push(await testEmbeddingGeneration(settings));
        categories.production.push(await testVectorStorage(settings));
        categories.production.push(await testVectorRetrieval(settings));
        categories.production.push(await testTemporalDecay(settings));
        categories.production.push(await testTemporallyBlindChunks(settings));
        categories.production.push(await testChunkServerSync(settings));
        categories.production.push(await testDuplicateHashes(settings));
        // Conditional activation returns an array of individual test results
        const activationResults = await testConditionalActivation();
        categories.production.push(...activationResults);
    }

    // Flatten all checks
    const allChecks = [
        ...categories.infrastructure,
        ...categories.configuration,
        ...categories.visualizer,
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

        case '[PROD] Chunk-Server Sync':
            return 'Click "Fix Now" to clean orphaned local metadata entries that no longer have corresponding vectors on the server.';

        case '[PROD] Duplicate Hash Check':
            return 'Click "Fix Now" to remove duplicate entries. Then re-vectorize the chat to restore clean data. Duplicates usually happen from the native ST vectors extension.';

        default:
            return 'Check the console for more details.';
    }
}

/**
 * Execute a fix action for a diagnostic check
 * @param {object} check Diagnostic check result with fixAction
 * @returns {Promise<object>} Fix result
 */
export async function executeFixAction(check) {
    if (!check.fixable || !check.fixAction) {
        return { success: false, message: 'No fix available for this check' };
    }

    switch (check.fixAction) {
        case 'cleanOrphanedMetadata':
            if (check.data?.orphanedHashes) {
                return await fixOrphanedMetadata(check.data.orphanedHashes);
            }
            return { success: false, message: 'No orphaned hashes found in check data' };

        case 'removeDuplicateHashes':
            if (check.data?.duplicates && check.data?.collectionId) {
                // Need settings for the fix function - get from VectHare
                const { getVectHareSettings } = await import('../ui/ui-settings.js');
                const settings = getVectHareSettings();
                return await fixDuplicateHashes(check.data.duplicates, check.data.collectionId, settings);
            }
            return { success: false, message: 'No duplicate data found in check' };

        default:
            return { success: false, message: `Unknown fix action: ${check.fixAction}` };
    }
}
