/**
 * RAGBooks Test Fixtures
 *
 * WHY: Provides a standardized test database with all features configured
 * for reliable production testing. Ships with the extension.
 *
 * Contains:
 * - Chunks with embeddings (384-dim vectors)
 * - Chunks with keywords and custom weights
 * - Chunks with importance values
 * - Chunks with conditions
 * - Chunks with groups
 * - Chunks with dual-vector summaries
 * - Parent-child relationships
 */

// Pre-computed embeddings for consistent testing
// These are normalized 384-dimensional vectors
const EMBEDDING_DRAGON = new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1) * 0.1);
const EMBEDDING_CASTLE = new Array(384).fill(0).map((_, i) => Math.cos(i * 0.1) * 0.1);
const EMBEDDING_COMBAT = new Array(384).fill(0).map((_, i) => Math.sin(i * 0.15) * 0.1);
const EMBEDDING_MAGIC = new Array(384).fill(0).map((_, i) => Math.cos(i * 0.15) * 0.1);
const EMBEDDING_SUMMARY_1 = new Array(384).fill(0).map((_, i) => Math.sin(i * 0.12) * 0.1);
const EMBEDDING_SUMMARY_2 = new Array(384).fill(0).map((_, i) => Math.cos(i * 0.12) * 0.1);

/**
 * Test collection with all RAGBooks features
 */
export const TEST_COLLECTION = {
    // ==================== BASIC CHUNK ====================
    'test_chunk_basic': {
        hash: 'test_chunk_basic',
        text: 'The ancient dragon Vermithrax guards the mountain pass. Its scales shimmer with an iridescent blue color, and its breath can melt steel.',
        name: 'Dragon Description',
        section: 'Creatures',
        keywords: ['dragon', 'vermithrax', 'mountain', 'scales', 'breath'],
        embedding: EMBEDDING_DRAGON,
        importance: 100,
        disabled: false,
        isSummaryChunk: false,
        parentHash: null,
        metadata: {
            source: 'test-fixtures',
            created: Date.now()
        }
    },

    // ==================== HIGH IMPORTANCE CHUNK ====================
    'test_chunk_important': {
        hash: 'test_chunk_important',
        text: 'CRITICAL LORE: The Dragon Crown is the only artifact that can control Vermithrax. It was forged by the ancient dwarves and hidden in the Deepvault.',
        name: 'Dragon Crown Lore',
        section: 'Artifacts',
        keywords: ['dragon', 'crown', 'artifact', 'dwarves', 'deepvault', 'vermithrax'],
        embedding: EMBEDDING_CASTLE,
        importance: 180, // High importance
        disabled: false,
        isSummaryChunk: false,
        parentHash: null,
        customWeights: {
            'crown': 150,
            'artifact': 120
        },
        metadata: {
            source: 'test-fixtures',
            created: Date.now()
        }
    },

    // ==================== LOW IMPORTANCE CHUNK ====================
    'test_chunk_low_importance': {
        hash: 'test_chunk_low_importance',
        text: 'The tavern serves a variety of drinks including ale, mead, and wine. The barkeep is named Gordo.',
        name: 'Tavern Details',
        section: 'Locations',
        keywords: ['tavern', 'drinks', 'ale', 'mead', 'gordo'],
        embedding: EMBEDDING_MAGIC,
        importance: 30, // Low importance
        disabled: false,
        isSummaryChunk: false,
        parentHash: null,
        metadata: {
            source: 'test-fixtures',
            created: Date.now()
        }
    },

    // ==================== CHUNK WITH CONDITIONS ====================
    'test_chunk_conditional': {
        hash: 'test_chunk_conditional',
        text: 'When angered, Vermithrax enters a berserker rage. Its attacks become more powerful but less accurate. This state lasts for 3 turns.',
        name: 'Dragon Combat Behavior',
        section: 'Combat',
        keywords: ['dragon', 'vermithrax', 'rage', 'berserker', 'combat', 'attack'],
        embedding: EMBEDDING_COMBAT,
        importance: 140,
        disabled: false,
        isSummaryChunk: false,
        parentHash: null,
        conditions: {
            enabled: true,
            rules: [
                {
                    type: 'keyword',
                    value: 'fight',
                    operator: 'contains'
                },
                {
                    type: 'keyword',
                    value: 'battle',
                    operator: 'contains'
                }
            ],
            logic: 'OR'
        },
        metadata: {
            source: 'test-fixtures',
            created: Date.now()
        }
    },

    // ==================== CHUNK IN GROUP ====================
    'test_chunk_grouped_1': {
        hash: 'test_chunk_grouped_1',
        text: 'The Castle Ironhold stands atop the Northern Cliffs. Its walls are 30 feet thick and reinforced with dwarven steel.',
        name: 'Castle Description',
        section: 'Locations',
        keywords: ['castle', 'ironhold', 'cliffs', 'walls', 'dwarven'],
        embedding: EMBEDDING_CASTLE,
        importance: 100,
        disabled: false,
        isSummaryChunk: false,
        parentHash: null,
        chunkGroup: {
            name: 'Castle Ironhold',
            groupKeywords: ['castle', 'ironhold', 'fortress'],
            required: false
        },
        metadata: {
            source: 'test-fixtures',
            created: Date.now()
        }
    },

    'test_chunk_grouped_2': {
        hash: 'test_chunk_grouped_2',
        text: 'Castle Ironhold houses the Royal Armory, containing weapons from the First War. The legendary Sword of Dawn is kept here under heavy guard.',
        name: 'Castle Armory',
        section: 'Locations',
        keywords: ['castle', 'ironhold', 'armory', 'weapons', 'sword', 'dawn'],
        embedding: EMBEDDING_CASTLE,
        importance: 120,
        disabled: false,
        isSummaryChunk: false,
        parentHash: null,
        chunkGroup: {
            name: 'Castle Ironhold',
            groupKeywords: ['castle', 'ironhold', 'fortress'],
            required: false
        },
        metadata: {
            source: 'test-fixtures',
            created: Date.now()
        }
    },

    // ==================== CHUNK WITH DUAL-VECTOR (PARENT) ====================
    'test_chunk_dualvector_parent': {
        hash: 'test_chunk_dualvector_parent',
        text: 'The Grand Library of Arcanum contains over 10,000 tomes on magical theory, spell construction, and planar studies. The head librarian, Sage Meridia, has catalogued every book personally. The library is protected by enchantments that prevent unauthorized copying and alert guards to any theft attempts. Rare books are kept in the Restricted Section, accessible only to senior mages.',
        name: 'Grand Library',
        section: 'Locations',
        keywords: ['library', 'arcanum', 'magic', 'tomes', 'meridia', 'spells'],
        embedding: EMBEDDING_MAGIC,
        importance: 110,
        disabled: false,
        isSummaryChunk: false,
        parentHash: null,
        summaryVector: true, // Opt-in to dual-vector
        summaryVectors: [
            'Grand Library of Arcanum: 10,000 magical tomes, guarded by enchantments, Sage Meridia is head librarian.',
            'Magical library with restricted section for senior mages only.'
        ],
        metadata: {
            source: 'test-fixtures',
            created: Date.now(),
            enableSummary: true,
            summaryStyle: 'concise'
        }
    },

    // ==================== DUAL-VECTOR SUMMARY CHUNK 1 ====================
    'test_chunk_dualvector_summary_1': {
        hash: 'test_chunk_dualvector_summary_1',
        text: 'Grand Library of Arcanum: 10,000 magical tomes, guarded by enchantments, Sage Meridia is head librarian.',
        name: 'Grand Library (Summary)',
        section: 'Locations',
        keywords: ['library', 'arcanum', 'magic', 'tomes', 'meridia'],
        embedding: EMBEDDING_SUMMARY_1,
        importance: 110,
        disabled: false,
        isSummaryChunk: true,
        parentHash: 'test_chunk_dualvector_parent',
        chunkLinks: [
            {
                targetHash: 'test_chunk_dualvector_parent',
                mode: 'force',
                isSummaryFor: 'test_chunk_dualvector_parent'
            }
        ],
        metadata: {
            source: 'test-fixtures',
            created: Date.now(),
            summaryIndex: 0
        }
    },

    // ==================== DUAL-VECTOR SUMMARY CHUNK 2 ====================
    'test_chunk_dualvector_summary_2': {
        hash: 'test_chunk_dualvector_summary_2',
        text: 'Magical library with restricted section for senior mages only.',
        name: 'Grand Library (Summary 2)',
        section: 'Locations',
        keywords: ['library', 'magic', 'restricted', 'mages'],
        embedding: EMBEDDING_SUMMARY_2,
        importance: 110,
        disabled: false,
        isSummaryChunk: true,
        parentHash: 'test_chunk_dualvector_parent',
        chunkLinks: [
            {
                targetHash: 'test_chunk_dualvector_parent',
                mode: 'force',
                isSummaryFor: 'test_chunk_dualvector_parent'
            }
        ],
        metadata: {
            source: 'test-fixtures',
            created: Date.now(),
            summaryIndex: 1
        }
    },

    // ==================== DISABLED CHUNK ====================
    'test_chunk_disabled': {
        hash: 'test_chunk_disabled',
        text: 'This chunk is disabled and should not appear in search results.',
        name: 'Disabled Chunk',
        section: 'Test',
        keywords: ['disabled', 'test'],
        embedding: EMBEDDING_DRAGON,
        importance: 100,
        disabled: true, // Disabled
        isSummaryChunk: false,
        parentHash: null,
        metadata: {
            source: 'test-fixtures',
            created: Date.now()
        }
    },

    // ==================== CHUNK WITH REGEX KEYWORD ====================
    'test_chunk_regex': {
        hash: 'test_chunk_regex',
        text: 'The wizard can cast fireball, firebolt, and firewall spells. All fire-based magic is enhanced in volcanic regions.',
        name: 'Fire Magic',
        section: 'Magic',
        keywords: ['wizard', 'fire.*', 'magic', 'volcanic'], // fire.* is regex
        embedding: EMBEDDING_MAGIC,
        importance: 100,
        disabled: false,
        isSummaryChunk: false,
        parentHash: null,
        metadata: {
            source: 'test-fixtures',
            created: Date.now()
        }
    }
};

/**
 * Collection metadata for test collection
 */
export const TEST_COLLECTION_METADATA = {
    'ragbooks_test_collection': {
        name: 'RAGBooks Test Collection',
        alwaysActive: true,
        keywords: [],
        scope: 'global',
        description: 'Test fixtures for RAGBooks production testing',
        created: Date.now(),
        chunkCount: Object.keys(TEST_COLLECTION).length
    }
};

/**
 * Test queries with expected results
 */
export const TEST_QUERIES = [
    {
        query: 'Tell me about the dragon',
        expectedChunks: ['test_chunk_basic', 'test_chunk_important', 'test_chunk_conditional'],
        description: 'Basic keyword search for dragon'
    },
    {
        query: 'What is in Castle Ironhold?',
        expectedChunks: ['test_chunk_grouped_1', 'test_chunk_grouped_2'],
        description: 'Group-related search'
    },
    {
        query: 'Where can I find magical books?',
        expectedChunks: ['test_chunk_dualvector_parent'],
        description: 'Dual-vector search - should return parent when summary matches'
    },
    {
        query: 'combat tactics',
        expectedChunks: ['test_chunk_conditional'],
        description: 'Conditional activation search'
    },
    {
        query: 'crown artifact',
        expectedChunks: ['test_chunk_important'],
        description: 'High importance chunk with custom keyword weights'
    }
];

/**
 * Get the test collection
 */
export function getTestCollection() {
    return JSON.parse(JSON.stringify(TEST_COLLECTION));
}

/**
 * Get test collection metadata
 */
export function getTestCollectionMetadata() {
    return JSON.parse(JSON.stringify(TEST_COLLECTION_METADATA));
}

/**
 * Get test queries
 */
export function getTestQueries() {
    return JSON.parse(JSON.stringify(TEST_QUERIES));
}

/**
 * Validate test collection integrity
 */
export function validateTestCollection() {
    const errors = [];
    const collection = TEST_COLLECTION;

    // Check all chunks
    for (const [hash, chunk] of Object.entries(collection)) {
        // Hash matches key
        if (chunk.hash !== hash) {
            errors.push(`Chunk ${hash}: hash mismatch (${chunk.hash})`);
        }

        // Has required fields
        if (!chunk.text) errors.push(`Chunk ${hash}: missing text`);
        if (!chunk.embedding) errors.push(`Chunk ${hash}: missing embedding`);
        if (!chunk.keywords) errors.push(`Chunk ${hash}: missing keywords`);

        // Embedding dimension
        if (chunk.embedding && chunk.embedding.length !== 384) {
            errors.push(`Chunk ${hash}: embedding dimension ${chunk.embedding.length} != 384`);
        }

        // Summary chunk has parent
        if (chunk.isSummaryChunk && !chunk.parentHash) {
            errors.push(`Chunk ${hash}: summary chunk missing parentHash`);
        }

        // Parent exists for summary chunks
        if (chunk.isSummaryChunk && chunk.parentHash && !collection[chunk.parentHash]) {
            errors.push(`Chunk ${hash}: parent ${chunk.parentHash} not found`);
        }

        // Importance in range
        if (chunk.importance < 0 || chunk.importance > 200) {
            errors.push(`Chunk ${hash}: importance ${chunk.importance} out of range`);
        }

        // Conditions have required fields
        if (chunk.conditions?.enabled) {
            for (const rule of chunk.conditions.rules || []) {
                if (!rule.type || !rule.value) {
                    errors.push(`Chunk ${hash}: condition rule missing type or value`);
                }
            }
        }
    }

    // Check parent-child relationships
    const summaryChunks = Object.values(collection).filter(c => c.isSummaryChunk);
    const parentChunks = Object.values(collection).filter(c => c.summaryVector && !c.isSummaryChunk);

    for (const parent of parentChunks) {
        const children = summaryChunks.filter(s => s.parentHash === parent.hash);
        if (parent.summaryVectors && children.length !== parent.summaryVectors.length) {
            errors.push(`Parent ${parent.hash}: has ${parent.summaryVectors.length} summaryVectors but ${children.length} summary chunks`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        stats: {
            totalChunks: Object.keys(collection).length,
            summaryChunks: summaryChunks.length,
            parentChunks: parentChunks.length,
            groupedChunks: Object.values(collection).filter(c => c.chunkGroup).length,
            conditionalChunks: Object.values(collection).filter(c => c.conditions?.enabled).length,
            disabledChunks: Object.values(collection).filter(c => c.disabled).length
        }
    };
}

export default {
    TEST_COLLECTION,
    TEST_COLLECTION_METADATA,
    TEST_QUERIES,
    getTestCollection,
    getTestCollectionMetadata,
    getTestQueries,
    validateTestCollection
};
