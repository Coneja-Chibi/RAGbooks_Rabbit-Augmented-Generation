/**
 * RAGBooks Semantic Chunking Module
 *
 * Implements AI-powered semantic chunking using embeddings to detect topic shifts.
 * Uses cosine similarity between consecutive sentences to identify natural boundaries.
 */

/**
 * Split text into sentences
 * @param {string} text - Text to split
 * @returns {string[]} Array of sentences
 */
export function splitIntoSentences(text) {
    if (!text || typeof text !== 'string') return [];

    // Normalize text
    const normalized = text
        .replace(/\r\n/g, '\n')
        .replace(/\s+/g, ' ')
        .trim();

    if (normalized.length === 0) return [];

    // Split on sentence boundaries while preserving common abbreviations
    // This regex handles:
    // - Period followed by space and capital letter
    // - Exclamation/question marks followed by space
    // - Handles common abbreviations (Mr., Dr., etc.)
    const sentences = [];
    const parts = normalized.split(/([.!?]+[\s\n]+)/g);

    let currentSentence = '';
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        if (part.match(/^[.!?]+[\s\n]+$/)) {
            // This is a delimiter - attach it to current sentence
            currentSentence += part.trim();

            // Check if this looks like an abbreviation (very short sentence)
            if (currentSentence.length > 10) {
                sentences.push(currentSentence.trim());
                currentSentence = '';
            }
        } else {
            currentSentence += part;
        }
    }

    // Add remaining text
    if (currentSentence.trim().length > 0) {
        sentences.push(currentSentence.trim());
    }

    return sentences.filter(s => s.length > 0);
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vec1 - First vector
 * @param {number[]} vec2 - Second vector
 * @returns {number} Similarity score (0-1, where 1 is identical)
 */
export function cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0) {
        return 0;
    }

    if (vec1.length !== vec2.length) {
        console.warn('[RAGBooks Semantic] Vector length mismatch:', vec1.length, 'vs', vec2.length);
        return 0;
    }

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (let i = 0; i < vec1.length; i++) {
        dotProduct += vec1[i] * vec2[i];
        magnitude1 += vec1[i] * vec1[i];
        magnitude2 += vec2[i] * vec2[i];
    }

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) {
        return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Get embeddings for text using SillyTavern's vector API
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} Embedding vector
 */
async function getEmbedding(text) {
    try {
        // Call SillyTavern's vector API endpoint
        const response = await fetch('/api/vectors/insert', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                collectionId: 'temp_semantic_chunking',
                items: [{
                    text: text,
                    index: 0
                }],
                preventDuplicates: false
            })
        });

        if (!response.ok) {
            throw new Error(`Embedding API returned ${response.status}`);
        }

        const data = await response.json();

        // The response contains the items with their embeddings
        if (data && data.items && data.items[0] && data.items[0].vector) {
            return data.items[0].vector;
        }

        throw new Error('No embedding vector in response');

    } catch (error) {
        console.error('[RAGBooks Semantic] Failed to get embedding:', error);
        throw error;
    }
}

/**
 * Get embeddings for multiple texts in batch
 * @param {string[]} texts - Array of texts to embed
 * @param {Function} progressCallback - Optional progress callback (current, total)
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
async function getBatchEmbeddings(texts, progressCallback = null) {
    const embeddings = [];

    console.log(`[RAGBooks Semantic] Generating ${texts.length} embeddings for semantic analysis...`);

    for (let i = 0; i < texts.length; i++) {
        try {
            const embedding = await getEmbedding(texts[i]);
            embeddings.push(embedding);

            if (progressCallback) {
                progressCallback(i + 1, texts.length);
            }

            // Small delay to avoid hammering API
            if (i < texts.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } catch (error) {
            console.error(`[RAGBooks Semantic] Failed to embed text ${i + 1}:`, error);
            // Push null for failed embeddings
            embeddings.push(null);
        }
    }

    return embeddings;
}

/**
 * Perform semantic chunking on text using embedding similarity
 * @param {string} text - Text to chunk
 * @param {Object} options - Chunking options
 * @param {number} options.similarityThreshold - Similarity threshold (0-1, lower = more chunks)
 * @param {number} options.minChunkSize - Minimum characters per chunk
 * @param {number} options.maxChunkSize - Maximum characters per chunk
 * @param {Function} options.progressCallback - Optional progress callback
 * @returns {Promise<string[]>} Array of text chunks
 */
export async function semanticChunkText(text, options = {}) {
    const defaultOptions = {
        similarityThreshold: 0.5,  // Split when similarity drops below this
        minChunkSize: 100,          // Minimum chunk size in characters
        maxChunkSize: 1500,         // Maximum chunk size in characters
        progressCallback: null
    };

    const config = { ...defaultOptions, ...options };

    console.log('[RAGBooks Semantic] Starting semantic chunking...');
    console.log(`  Threshold: ${config.similarityThreshold}`);
    console.log(`  Size range: ${config.minChunkSize}-${config.maxChunkSize} chars`);

    // Step 1: Split into sentences
    const sentences = splitIntoSentences(text);

    if (sentences.length === 0) {
        return [];
    }

    if (sentences.length === 1) {
        return [text];
    }

    console.log(`[RAGBooks Semantic] Split into ${sentences.length} sentences`);

    // Step 2: Get embeddings for all sentences
    const embeddings = await getBatchEmbeddings(sentences, config.progressCallback);

    // Filter out failed embeddings
    const validIndices = embeddings
        .map((emb, idx) => emb !== null ? idx : -1)
        .filter(idx => idx !== -1);

    if (validIndices.length < 2) {
        console.warn('[RAGBooks Semantic] Not enough valid embeddings, falling back to single chunk');
        return [text];
    }

    console.log(`[RAGBooks Semantic] Generated ${validIndices.length}/${sentences.length} embeddings`);

    // Step 3: Calculate similarities between consecutive sentences
    const similarities = [];
    for (let i = 0; i < validIndices.length - 1; i++) {
        const idx1 = validIndices[i];
        const idx2 = validIndices[i + 1];
        const similarity = cosineSimilarity(embeddings[idx1], embeddings[idx2]);
        similarities.push({
            index: idx1,
            nextIndex: idx2,
            similarity: similarity
        });
    }

    // Step 4: Identify split points where similarity drops below threshold
    const splitPoints = [0]; // Always start with first sentence

    for (const sim of similarities) {
        if (sim.similarity < config.similarityThreshold) {
            // Topic shift detected
            splitPoints.push(sim.nextIndex);
            console.log(`[RAGBooks Semantic] Topic shift at sentence ${sim.nextIndex} (similarity: ${sim.similarity.toFixed(3)})`);
        }
    }

    splitPoints.push(sentences.length); // Always end with last sentence

    console.log(`[RAGBooks Semantic] Detected ${splitPoints.length - 1} semantic chunks`);

    // Step 5: Build chunks from split points
    const chunks = [];

    for (let i = 0; i < splitPoints.length - 1; i++) {
        const start = splitPoints[i];
        const end = splitPoints[i + 1];
        const chunkSentences = sentences.slice(start, end);
        let chunkText = chunkSentences.join(' ').trim();

        // Enforce size constraints
        if (chunkText.length > config.maxChunkSize) {
            // Chunk too large - split it further
            const subChunks = splitLargeChunk(chunkText, config.maxChunkSize);
            chunks.push(...subChunks);
        } else if (chunkText.length < config.minChunkSize && chunks.length > 0) {
            // Chunk too small - merge with previous
            chunks[chunks.length - 1] += ' ' + chunkText;
        } else {
            chunks.push(chunkText);
        }
    }

    console.log(`[RAGBooks Semantic] Created ${chunks.length} final chunks`);

    return chunks.filter(chunk => chunk.length > 0);
}

/**
 * Split a chunk that exceeds max size
 * @param {string} text - Text to split
 * @param {number} maxSize - Maximum chunk size
 * @returns {string[]} Array of sub-chunks
 */
function splitLargeChunk(text, maxSize) {
    const chunks = [];
    const sentences = splitIntoSentences(text);

    let currentChunk = '';
    for (const sentence of sentences) {
        if ((currentChunk + ' ' + sentence).length > maxSize && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

/**
 * Improved sliding window chunking with sentence-aware boundaries
 * @param {string} text - Text to chunk
 * @param {Object} options - Chunking options
 * @param {number} options.windowSize - Window size in characters
 * @param {number} options.overlapPercent - Overlap as percentage (0-50)
 * @param {boolean} options.sentenceAware - Respect sentence boundaries
 * @returns {string[]} Array of text chunks
 */
export function slidingWindowChunk(text, options = {}) {
    const defaultOptions = {
        windowSize: 500,
        overlapPercent: 20,  // 20% overlap by default
        sentenceAware: true   // Don't split mid-sentence
    };

    const config = { ...defaultOptions, ...options };

    if (!text || text.length === 0) return [];
    if (text.length <= config.windowSize) return [text];

    const overlapChars = Math.floor(config.windowSize * (config.overlapPercent / 100));
    const chunks = [];

    if (config.sentenceAware) {
        // Split into sentences first
        const sentences = splitIntoSentences(text);

        let currentChunk = '';
        let chunkStartIdx = 0;

        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;

            if (potentialChunk.length >= config.windowSize && currentChunk.length > 0) {
                // Current chunk is full - save it
                chunks.push(currentChunk.trim());

                // Calculate overlap point (go back to include some previous sentences)
                let overlapText = '';
                let overlapIdx = i - 1;

                while (overlapIdx >= chunkStartIdx && overlapText.length < overlapChars) {
                    overlapText = sentences[overlapIdx] + ' ' + overlapText;
                    overlapIdx--;
                }

                currentChunk = overlapText.trim() + ' ' + sentence;
                chunkStartIdx = overlapIdx + 1;
            } else {
                currentChunk = potentialChunk;
            }
        }

        // Add final chunk
        if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk.trim());
        }
    } else {
        // Simple character-based sliding window
        let position = 0;

        while (position < text.length) {
            const end = Math.min(position + config.windowSize, text.length);
            const chunk = text.substring(position, end).trim();

            if (chunk.length > 0) {
                chunks.push(chunk);
            }

            position += config.windowSize - overlapChars;
        }
    }

    console.log(`[RAGBooks Sliding Window] Created ${chunks.length} chunks (${config.windowSize} chars, ${config.overlapPercent}% overlap)`);

    return chunks;
}

/**
 * Validate semantic chunking options
 * @param {Object} options - Options to validate
 * @returns {Object} {valid: boolean, errors: string[]}
 */
export function validateSemanticOptions(options) {
    const errors = [];

    if (options.similarityThreshold !== undefined) {
        if (typeof options.similarityThreshold !== 'number') {
            errors.push('Similarity threshold must be a number');
        } else if (options.similarityThreshold < 0 || options.similarityThreshold > 1) {
            errors.push('Similarity threshold must be between 0 and 1');
        }
    }

    if (options.minChunkSize !== undefined) {
        if (typeof options.minChunkSize !== 'number' || options.minChunkSize < 1) {
            errors.push('Minimum chunk size must be a positive number');
        }
    }

    if (options.maxChunkSize !== undefined) {
        if (typeof options.maxChunkSize !== 'number' || options.maxChunkSize < 1) {
            errors.push('Maximum chunk size must be a positive number');
        }
    }

    if (options.minChunkSize && options.maxChunkSize && options.minChunkSize > options.maxChunkSize) {
        errors.push('Minimum chunk size cannot be larger than maximum chunk size');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
