/**
 * ============================================================================
 * VECTHARE DIAGNOSTICS - INDEX
 * ============================================================================
 * Main entry point for diagnostics system
 * Every potential failure point needs a check and fix here
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
    checkQdrantDimensionMatch,
    checkEmbeddingProvider,
    checkApiKeys,
    checkApiUrls,
    checkProviderConnectivity,
    checkWebLlmExtension,
    checkBananaBreadConnection
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
    checkCollectionIdFormat,
    checkHashCollisionRate,
    checkChatMetadataIntegrity,
    checkConditionRuleValidity,
    checkCollectionRegistryStatus,
    checkChunkGroupsModule,
    checkChunkGroupsValidity,
    checkChunkGroupMemberIntegrity,
    checkPromptContextConfig,
    checkPNGExportCapability
} from './configuration.js';

import {
    testEmbeddingGeneration,
    testVectorStorage,
    testVectorRetrieval,
    testVectorDimensions,
    testTemporalDecay,
    testTemporallyBlindChunks,
    testChunkServerSync,
    testDuplicateHashes,
    testPluginEmbeddingGeneration,
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
    categories.infrastructure.push(await checkQdrantDimensionMatch(settings));
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

    // WebLLM-specific check (only if WebLLM is selected)
    const webllmCheck = checkWebLlmExtension(settings);
    if (webllmCheck.status !== 'skipped') {
        categories.infrastructure.push(webllmCheck);
    }

    // BananaBread check (only if BananaBread is selected)
    const bananabreadCheck = await checkBananaBreadConnection(settings);
    if (bananabreadCheck.status !== 'skipped') {
        categories.infrastructure.push(bananabreadCheck);
    }

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

    // Hash collision rate (informational - collisions are intentional deduplication)
    categories.configuration.push(await checkHashCollisionRate(settings));

    // Chat metadata integrity (UUID-based collection tracking)
    categories.configuration.push(checkChatMetadataIntegrity());

    // Condition rule validity (validates chunk condition rules)
    categories.configuration.push(await checkConditionRuleValidity(settings));

    // Collection registry status (verifies collections are discoverable)
    categories.configuration.push(await checkCollectionRegistryStatus(settings));

    // Chunk groups module and validity checks
    categories.configuration.push(await checkChunkGroupsModule());
    categories.configuration.push(await checkChunkGroupsValidity(settings));
    categories.configuration.push(await checkChunkGroupMemberIntegrity(settings));

    // Prompt context configuration
    categories.configuration.push(await checkPromptContextConfig(settings));

    // PNG export capability
    categories.configuration.push(checkPNGExportCapability());

    // ========== VISUALIZER CHECKS ==========
    // Fast checks always run, slow (API) checks only with production tests
    const visualizerResults = await runVisualizerTests(settings, includeProductionTests);
    categories.visualizer.push(...visualizerResults);

    // ========== PRODUCTION TESTS (Optional) ==========
    if (includeProductionTests) {
        categories.production.push(await testEmbeddingGeneration(settings));
        categories.production.push(await testVectorStorage(settings));
        categories.production.push(await testVectorRetrieval(settings));
        categories.production.push(await testVectorDimensions(settings));
        categories.production.push(await testTemporalDecay(settings));
        categories.production.push(await testTemporallyBlindChunks(settings));
        categories.production.push(await testChunkServerSync(settings));
        categories.production.push(await testDuplicateHashes(settings));
        // Plugin-specific embedding generation test (LanceDB/Qdrant)
        categories.production.push(await testPluginEmbeddingGeneration(settings));
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
            return 'Configure Qdrant settings in VectHare panel. For local: set host/port (default localhost:6333). Start Qdrant: docker run -p 6333:6333 qdrant/qdrant. Note: Qdrant Cloud may have connectivity issues - local instance recommended.';

        case '[PROD] Chunk-Server Sync':
            return 'Click "Fix Now" to clean orphaned local metadata entries that no longer have corresponding vectors on the server.';

        case '[PROD] Duplicate Hash Check':
            return 'Click "Fix Now" to remove duplicate entries. Then re-vectorize the chat to restore clean data. Duplicates usually happen from the native ST vectors extension.';

        case 'Chat Metadata Integrity':
            return 'Start a new chat or send a message to generate a valid chat UUID. If this persists, the chat file may be corrupted.';

        case 'Condition Rule Validity':
            return 'Open the Chunk Editor and review the condition rules on affected chunks. Remove invalid operators or fix malformed values.';

        case 'Chunk Groups Module':
            return 'The chunk groups module failed to load. Try refreshing the page. If this persists, check console for import errors.';

        case 'Chunk Groups Validity':
            return 'Some groups have invalid configuration. Open the Groups tab in the Chunk Visualizer and review the affected groups.';

        case 'Group Member Integrity':
            return 'Click "Fix Now" to remove group members that reference deleted chunks. This can happen after purging or deleting vectors.';

        case 'WebLLM Extension':
            return 'Install the WebLLM extension from Extensions > Download Extensions, then paste: https://github.com/SillyTavern/Extension-WebLLM. Requires Chrome 113+ or Edge 113+ for WebGPU support.';

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

        case 'cleanOrphanedGroupMembers':
            return await fixOrphanedGroupMembers();

        case 'install_webllm':
        case 'update_webllm': {
            // Open the third-party extension menu with WebLLM URL
            const { openThirdPartyExtensionMenu } = await import('../../../../extensions.js');
            openThirdPartyExtensionMenu('https://github.com/SillyTavern/Extension-WebLLM');
            return { success: true, message: 'Opening extension installer...' };
        }

        default:
            return { success: false, message: `Unknown fix action: ${check.fixAction}` };
    }
}

/**
 * Removes orphaned group members that reference non-existent chunks.
 * @returns {Promise<object>} Fix result
 */
async function fixOrphanedGroupMembers() {
    try {
        const { getCollectionMeta, saveCollectionMeta } = await import('../core/collection-metadata.js');
        const { getCollectionRegistry } = await import('../core/collection-loader.js');
        const { getSavedHashes } = await import('../core/core-vector-api.js');
        const { getVectHareSettings } = await import('../ui/ui-settings.js');

        const settings = getVectHareSettings();
        const registry = getCollectionRegistry();
        let totalCleaned = 0;
        let collectionsFixed = 0;

        for (const registryKey of registry) {
            let collectionId = registryKey;
            if (registryKey.includes(':')) {
                collectionId = registryKey.substring(registryKey.indexOf(':') + 1);
            }

            const meta = getCollectionMeta(collectionId);
            const groups = meta?.groups || [];

            if (groups.length === 0) continue;

            // Get actual chunk hashes
            let existingHashes;
            try {
                existingHashes = new Set((await getSavedHashes(collectionId, settings)).map(h => String(h)));
            } catch {
                continue;
            }

            let collectionModified = false;
            for (const group of groups) {
                const originalLength = group.members?.length || 0;
                group.members = (group.members || []).filter(hash => existingHashes.has(String(hash)));
                const removed = originalLength - group.members.length;
                if (removed > 0) {
                    totalCleaned += removed;
                    collectionModified = true;
                }
            }

            if (collectionModified) {
                saveCollectionMeta(collectionId, meta);
                collectionsFixed++;
            }
        }

        if (totalCleaned > 0) {
            return {
                success: true,
                message: `Removed ${totalCleaned} orphaned member(s) from ${collectionsFixed} collection(s)`
            };
        }

        return { success: true, message: 'No orphaned members found to clean' };
    } catch (error) {
        return { success: false, message: `Fix failed: ${error.message}` };
    }
}
