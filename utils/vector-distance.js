/**
 * Vector Distance Module for SillyTavern UI Extensions
 * Provides efficient distance comparison algorithms for vector matrices
 * Pure JavaScript implementation - no external dependencies
 *
 * From: https://github.com/prolix-oc/ST-Helpers
 * @module vectorDistance
 */

/**
 * Jaccard Distance Algorithms
 * Measures dissimilarity between sets/vectors
 */
const Jaccard = {
  /**
   * Calculate Jaccard similarity between two binary vectors
   * Similarity = |A ∩ B| / |A ∪ B|
   *
   * @param {Array<number>} vecA - First vector (binary or continuous)
   * @param {Array<number>} vecB - Second vector (binary or continuous)
   * @param {number} threshold - Threshold for binarization (default: 0)
   * @returns {number} Jaccard similarity (0 to 1)
   */
  similarity(vecA, vecB, threshold = 0) {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have equal length');
    }

    let intersection = 0;
    let union = 0;

    for (let i = 0; i < vecA.length; i++) {
      const a = vecA[i] > threshold ? 1 : 0;
      const b = vecB[i] > threshold ? 1 : 0;

      if (a === 1 || b === 1) {
        union++;
        if (a === 1 && b === 1) {
          intersection++;
        }
      }
    }

    // Handle edge case where both vectors are all zeros
    if (union === 0) return 0;

    return intersection / union;
  },

  /**
   * Calculate Jaccard distance between two vectors
   * Distance = 1 - Similarity
   *
   * @param {Array<number>} vecA - First vector
   * @param {Array<number>} vecB - Second vector
   * @param {number} threshold - Threshold for binarization (default: 0)
   * @returns {number} Jaccard distance (0 to 1)
   */
  distance(vecA, vecB, threshold = 0) {
    return 1 - this.similarity(vecA, vecB, threshold);
  },

  /**
   * Calculate pairwise Jaccard distances between two matrices
   *
   * @param {Array<Array<number>>} matrixA - First matrix (array of vectors)
   * @param {Array<Array<number>>} matrixB - Second matrix (array of vectors)
   * @param {number} threshold - Threshold for binarization (default: 0)
   * @returns {Array<Array<number>>} Distance matrix
   */
  pairwiseDistance(matrixA, matrixB, threshold = 0) {
    const result = [];

    for (let i = 0; i < matrixA.length; i++) {
      const row = [];
      for (let j = 0; j < matrixB.length; j++) {
        row.push(this.distance(matrixA[i], matrixB[j], threshold));
      }
      result.push(row);
    }

    return result;
  },

  /**
   * Find k nearest neighbors using Jaccard distance
   *
   * @param {Array<number>} query - Query vector
   * @param {Array<Array<number>>} vectors - Array of vectors to search
   * @param {number} k - Number of nearest neighbors
   * @param {number} threshold - Threshold for binarization (default: 0)
   * @returns {Array<{index: number, distance: number}>} K nearest neighbors
   */
  kNearest(query, vectors, k, threshold = 0) {
    const distances = vectors.map((vec, idx) => ({
      index: idx,
      distance: this.distance(query, vec, threshold)
    }));

    return distances
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }
};

/**
 * Hamming Distance Algorithms
 * Counts positions where corresponding elements differ
 */
const Hamming = {
  /**
   * Calculate Hamming distance between two vectors
   * Counts the number of positions at which elements are different
   *
   * @param {Array<number>} vecA - First vector
   * @param {Array<number>} vecB - Second vector
   * @param {number} tolerance - Tolerance for floating point comparison (default: 1e-10)
   * @returns {number} Hamming distance (count of differences)
   */
  distance(vecA, vecB, tolerance = 1e-10) {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have equal length');
    }

    let distance = 0;

    for (let i = 0; i < vecA.length; i++) {
      if (Math.abs(vecA[i] - vecB[i]) > tolerance) {
        distance++;
      }
    }

    return distance;
  },

  /**
   * Calculate normalized Hamming distance (0 to 1)
   *
   * @param {Array<number>} vecA - First vector
   * @param {Array<number>} vecB - Second vector
   * @param {number} tolerance - Tolerance for floating point comparison (default: 1e-10)
   * @returns {number} Normalized Hamming distance (0 to 1)
   */
  normalizedDistance(vecA, vecB, tolerance = 1e-10) {
    if (vecA.length === 0) return 0;
    return this.distance(vecA, vecB, tolerance) / vecA.length;
  },

  /**
   * Calculate pairwise Hamming distances between two matrices
   *
   * @param {Array<Array<number>>} matrixA - First matrix (array of vectors)
   * @param {Array<Array<number>>} matrixB - Second matrix (array of vectors)
   * @param {boolean} normalized - Whether to normalize distances (default: false)
   * @param {number} tolerance - Tolerance for floating point comparison (default: 1e-10)
   * @returns {Array<Array<number>>} Distance matrix
   */
  pairwiseDistance(matrixA, matrixB, normalized = false, tolerance = 1e-10) {
    const result = [];
    const distFunc = normalized ? this.normalizedDistance : this.distance;

    for (let i = 0; i < matrixA.length; i++) {
      const row = [];
      for (let j = 0; j < matrixB.length; j++) {
        row.push(distFunc.call(this, matrixA[i], matrixB[j], tolerance));
      }
      result.push(row);
    }

    return result;
  },

  /**
   * Find k nearest neighbors using Hamming distance
   *
   * @param {Array<number>} query - Query vector
   * @param {Array<Array<number>>} vectors - Array of vectors to search
   * @param {number} k - Number of nearest neighbors
   * @param {boolean} normalized - Whether to normalize distances (default: false)
   * @param {number} tolerance - Tolerance for floating point comparison (default: 1e-10)
   * @returns {Array<{index: number, distance: number}>} K nearest neighbors
   */
  kNearest(query, vectors, k, normalized = false, tolerance = 1e-10) {
    const distFunc = normalized ? this.normalizedDistance : this.distance;

    const distances = vectors.map((vec, idx) => ({
      index: idx,
      distance: distFunc.call(this, query, vec, tolerance)
    }));

    return distances
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }
};

/**
 * Cosine Similarity/Distance Algorithms
 * Measures the cosine of the angle between vectors
 */
const Cosine = {
  /**
   * Calculate dot product of two vectors
   *
   * @param {Array<number>} vecA - First vector
   * @param {Array<number>} vecB - Second vector
   * @returns {number} Dot product
   * @private
   */
  _dotProduct(vecA, vecB) {
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      sum += vecA[i] * vecB[i];
    }
    return sum;
  },

  /**
   * Calculate magnitude (L2 norm) of a vector
   *
   * @param {Array<number>} vec - Vector
   * @returns {number} Magnitude
   * @private
   */
  _magnitude(vec) {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) {
      sum += vec[i] * vec[i];
    }
    return Math.sqrt(sum);
  },

  /**
   * Calculate cosine similarity between two vectors
   * Similarity = (A · B) / (||A|| × ||B||)
   *
   * @param {Array<number>} vecA - First vector
   * @param {Array<number>} vecB - Second vector
   * @returns {number} Cosine similarity (-1 to 1)
   */
  similarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have equal length');
    }

    const dotProd = this._dotProduct(vecA, vecB);
    const magA = this._magnitude(vecA);
    const magB = this._magnitude(vecB);

    // Handle zero vectors
    if (magA === 0 || magB === 0) {
      return 0;
    }

    return dotProd / (magA * magB);
  },

  /**
   * Calculate cosine distance between two vectors
   * Distance = 1 - Similarity
   *
   * @param {Array<number>} vecA - First vector
   * @param {Array<number>} vecB - Second vector
   * @returns {number} Cosine distance (0 to 2)
   */
  distance(vecA, vecB) {
    return 1 - this.similarity(vecA, vecB);
  },

  /**
   * Calculate angular distance in radians
   *
   * @param {Array<number>} vecA - First vector
   * @param {Array<number>} vecB - Second vector
   * @returns {number} Angular distance in radians (0 to π)
   */
  angularDistance(vecA, vecB) {
    const sim = this.similarity(vecA, vecB);
    // Clamp to [-1, 1] to handle floating point errors
    const clampedSim = Math.max(-1, Math.min(1, sim));
    return Math.acos(clampedSim);
  },

  /**
   * Calculate pairwise cosine distances between two matrices
   *
   * @param {Array<Array<number>>} matrixA - First matrix (array of vectors)
   * @param {Array<Array<number>>} matrixB - Second matrix (array of vectors)
   * @returns {Array<Array<number>>} Distance matrix
   */
  pairwiseDistance(matrixA, matrixB) {
    const result = [];

    for (let i = 0; i < matrixA.length; i++) {
      const row = [];
      for (let j = 0; j < matrixB.length; j++) {
        row.push(this.distance(matrixA[i], matrixB[j]));
      }
      result.push(row);
    }

    return result;
  },

  /**
   * Calculate pairwise cosine similarities between two matrices
   *
   * @param {Array<Array<number>>} matrixA - First matrix (array of vectors)
   * @param {Array<Array<number>>} matrixB - Second matrix (array of vectors)
   * @returns {Array<Array<number>>} Similarity matrix
   */
  pairwiseSimilarity(matrixA, matrixB) {
    const result = [];

    for (let i = 0; i < matrixA.length; i++) {
      const row = [];
      for (let j = 0; j < matrixB.length; j++) {
        row.push(this.similarity(matrixA[i], matrixB[j]));
      }
      result.push(row);
    }

    return result;
  },

  /**
   * Find k nearest neighbors using cosine distance
   *
   * @param {Array<number>} query - Query vector
   * @param {Array<Array<number>>} vectors - Array of vectors to search
   * @param {number} k - Number of nearest neighbors
   * @returns {Array<{index: number, distance: number, similarity: number}>} K nearest neighbors
   */
  kNearest(query, vectors, k) {
    const distances = vectors.map((vec, idx) => {
      const sim = this.similarity(query, vec);
      return {
        index: idx,
        distance: 1 - sim,
        similarity: sim
      };
    });

    return distances
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  },

  /**
   * Optimized batch similarity calculation with precomputed magnitudes
   * Useful when comparing one query against many vectors
   *
   * @param {Array<number>} query - Query vector
   * @param {Array<Array<number>>} vectors - Array of vectors
   * @returns {Array<number>} Array of similarities
   */
  batchSimilarity(query, vectors) {
    const queryMag = this._magnitude(query);

    if (queryMag === 0) {
      return vectors.map(() => 0);
    }

    return vectors.map(vec => {
      const dotProd = this._dotProduct(query, vec);
      const vecMag = this._magnitude(vec);

      if (vecMag === 0) return 0;

      return dotProd / (queryMag * vecMag);
    });
  }
};

/**
 * Document Search and Ranking
 * High-level API for semantic search with automatic scoring and sorting
 */
const DocumentSearch = {
  /**
   * Detect if vectors appear to be binary (contain only 0s and 1s)
   *
   * @param {Array<number>} vec - Vector to check
   * @returns {boolean} True if binary
   * @private
   */
  _isBinaryVector(vec) {
    return vec.every(v => v === 0 || v === 1);
  },

  /**
   * Detect if vectors appear to be binary quantized (contain only discrete values)
   * Checks if all values are integers
   *
   * @param {Array<number>} vec - Vector to check
   * @returns {boolean} True if quantized
   * @private
   */
  _isQuantizedVector(vec) {
    return vec.every(v => Number.isInteger(v));
  },

  /**
   * Analyze vector characteristics for algorithm compatibility
   *
   * @param {Array<number>} vec - Vector to analyze
   * @returns {{isBinary: boolean, isQuantized: boolean, hasContinuous: boolean, range: {min: number, max: number}}}
   * @private
   */
  _analyzeVector(vec) {
    const isBinary = this._isBinaryVector(vec);
    const isQuantized = this._isQuantizedVector(vec);
    const min = Math.min(...vec);
    const max = Math.max(...vec);

    return {
      isBinary,
      isQuantized,
      hasContinuous: !isQuantized,
      range: { min, max }
    };
  },

  /**
   * Get compatibility warnings for algorithm and vector type
   *
   * @param {string} algorithm - Algorithm name ('jaccard', 'hamming', 'cosine')
   * @param {Object} vectorAnalysis - Result from _analyzeVector
   * @returns {string|null} Warning message or null if compatible
   * @private
   */
  _getCompatibilityWarning(algorithm, vectorAnalysis) {
    const algoLower = algorithm.toLowerCase();

    if (algoLower === 'jaccard') {
      if (!vectorAnalysis.isBinary && !vectorAnalysis.isQuantized) {
        return 'WARNING: Jaccard distance works best with binary vectors. Continuous values will be thresholded, which may reduce accuracy. Consider using Cosine similarity instead.';
      }
    } else if (algoLower === 'hamming') {
      if (vectorAnalysis.hasContinuous) {
        return 'WARNING: Hamming distance is designed for discrete/binary vectors. Continuous values may produce inaccurate results. Consider using Cosine similarity for continuous embeddings.';
      }
    } else if (algoLower === 'cosine') {
      if (vectorAnalysis.isBinary) {
        return 'NOTE: Cosine similarity works with binary vectors, but Jaccard distance may be more appropriate for pure binary/set-based comparisons.';
      }
    }

    return null;
  },

  /**
   * Search and rank documents based on query similarity
   *
   * ALGORITHM GUIDELINES:
   * - Jaccard: Best for BINARY vectors (0s and 1s only). Measures set overlap.
   *   Use for: binary features, tags, categorical presence/absence
   *   ⚠️ Will threshold continuous values, losing precision
   *
   * - Hamming: Best for BINARY or QUANTIZED vectors. Counts exact position differences.
   *   Use for: binary codes, hashes, discrete categorical data
   *   ⚠️ Not suitable for continuous embeddings (e.g., from neural networks)
   *
   * - Cosine: Best for CONTINUOUS vectors. Measures directional similarity.
   *   Use for: neural network embeddings, word2vec, sentence transformers, etc.
   *   ✓ Most common choice for semantic search with modern embeddings
   *
   * @param {Object} params - Search parameters
   * @param {Array<number>} params.message - Query embedding vector
   * @param {Array<Object>} params.documents - Array of document objects
   * @param {string} params.documents[].documentText - Text content of document
   * @param {Array<number>} params.documents[].embeddingArray - Embedding vector for document
   * @param {string} params.algorithm - Algorithm to use: 'jaccard', 'hamming', or 'cosine'
   * @param {number} [params.top_k] - Optional: return only top k results (omit for all results)
   * @param {number} [params.threshold] - Optional: threshold for Jaccard binarization (default: 0)
   * @param {boolean} [params.normalized] - Optional: use normalized Hamming distance (default: true)
   * @param {boolean} [params.suppressWarnings] - Optional: suppress compatibility warnings (default: false)
   * @returns {Object} Search results with metadata
   * @returns {Array<{resultText: string, score: number}>} results.results - Sorted results (higher score = better match)
   * @returns {string} results.algorithm - Algorithm used
   * @returns {string|null} results.warning - Compatibility warning if applicable
   * @returns {number} results.totalDocuments - Total number of documents searched
   * @returns {number} results.returnedDocuments - Number of documents returned
   */
  search(params) {
    const {
      message,
      documents,
      algorithm,
      top_k,
      threshold = 0,
      normalized = true,
      suppressWarnings = false
    } = params;

    // Validation
    if (!message || !Array.isArray(message) || message.length === 0) {
      throw new Error('Invalid message: must be a non-empty array of numbers');
    }

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      throw new Error('Invalid documents: must be a non-empty array');
    }

    if (!algorithm || typeof algorithm !== 'string') {
      throw new Error('Invalid algorithm: must be a string ("jaccard", "hamming", or "cosine")');
    }

    const algoLower = algorithm.toLowerCase();
    const validAlgorithms = ['jaccard', 'hamming', 'cosine'];

    if (!validAlgorithms.includes(algoLower)) {
      throw new Error(`Invalid algorithm: "${algorithm}". Must be one of: ${validAlgorithms.join(', ')}`);
    }

    // Validate documents structure
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      if (!doc.documentText || typeof doc.documentText !== 'string') {
        throw new Error(`Document at index ${i} missing valid documentText`);
      }
      if (!doc.embeddingArray || !Array.isArray(doc.embeddingArray) || doc.embeddingArray.length === 0) {
        throw new Error(`Document at index ${i} missing valid embeddingArray`);
      }
      if (doc.embeddingArray.length !== message.length) {
        throw new Error(`Document at index ${i} has embedding length ${doc.embeddingArray.length}, but query has length ${message.length}`);
      }
    }

    // Analyze vector compatibility
    const queryAnalysis = this._analyzeVector(message);
    const warning = suppressWarnings ? null : this._getCompatibilityWarning(algoLower, queryAnalysis);

    // Calculate scores based on algorithm
    let scoredResults = [];

    if (algoLower === 'jaccard') {
      // Jaccard uses similarity (higher = better), so we use it directly as score
      scoredResults = documents.map(doc => {
        const similarity = Jaccard.similarity(message, doc.embeddingArray, threshold);
        return {
          resultText: doc.documentText,
          score: similarity
        };
      });
    } else if (algoLower === 'hamming') {
      // Hamming is a distance (lower = better), so convert to similarity score
      // Score = 1 - normalized_distance (so higher score = better match)
      scoredResults = documents.map(doc => {
        const distance = normalized
          ? Hamming.normalizedDistance(message, doc.embeddingArray)
          : Hamming.distance(message, doc.embeddingArray);

        // For normalized: distance is 0-1, so score = 1 - distance
        // For raw: normalize first, then invert
        const score = normalized
          ? (1 - distance)
          : (1 - (distance / message.length));

        return {
          resultText: doc.documentText,
          score: Math.max(0, score) // Ensure non-negative
        };
      });
    } else if (algoLower === 'cosine') {
      // Cosine similarity (higher = better), use directly as score
      // Normalize to 0-1 range by converting from [-1, 1] to [0, 1]
      scoredResults = documents.map(doc => {
        const similarity = Cosine.similarity(message, doc.embeddingArray);
        // Normalize from [-1, 1] to [0, 1]: (similarity + 1) / 2
        // But for most embeddings, similarity is already in [0, 1] range
        // So we'll keep it as-is for semantic meaning
        return {
          resultText: doc.documentText,
          score: similarity
        };
      });
    }

    // Sort by score (descending - higher scores first)
    scoredResults.sort((a, b) => b.score - a.score);

    // Apply top_k if specified
    const returnedResults = top_k !== undefined && top_k > 0
      ? scoredResults.slice(0, top_k)
      : scoredResults;

    return {
      results: returnedResults,
      algorithm: algoLower,
      warning: warning,
      totalDocuments: documents.length,
      returnedDocuments: returnedResults.length
    };
  }
};

/**
 * Utility functions for vector operations
 */
const Utils = {
  /**
   * Validate that input is a valid vector (1D array of numbers)
   *
   * @param {*} vec - Input to validate
   * @returns {boolean} True if valid vector
   */
  isValidVector(vec) {
    return Array.isArray(vec) &&
           vec.length > 0 &&
           vec.every(x => typeof x === 'number' && !isNaN(x));
  },

  /**
   * Validate that input is a valid matrix (2D array of numbers)
   *
   * @param {*} matrix - Input to validate
   * @returns {boolean} True if valid matrix
   */
  isValidMatrix(matrix) {
    if (!Array.isArray(matrix) || matrix.length === 0) {
      return false;
    }

    const firstLen = matrix[0].length;
    return matrix.every(row =>
      this.isValidVector(row) && row.length === firstLen
    );
  },

  /**
   * Normalize a vector to unit length (L2 normalization)
   *
   * @param {Array<number>} vec - Vector to normalize
   * @returns {Array<number>} Normalized vector
   */
  normalize(vec) {
    let sumSquares = 0;
    for (let i = 0; i < vec.length; i++) {
      sumSquares += vec[i] * vec[i];
    }

    const magnitude = Math.sqrt(sumSquares);

    if (magnitude === 0) {
      return vec.slice(); // Return copy of zero vector
    }

    return vec.map(x => x / magnitude);
  },

  /**
   * Find indices of top k values in an array
   *
   * @param {Array<number>} arr - Array of numbers
   * @param {number} k - Number of top values
   * @param {boolean} descending - Sort descending (default: true)
   * @returns {Array<{index: number, value: number}>} Top k values with indices
   */
  topK(arr, k, descending = true) {
    const indexed = arr.map((value, index) => ({ index, value }));
    const sorted = indexed.sort((a, b) =>
      descending ? b.value - a.value : a.value - b.value
    );
    return sorted.slice(0, k);
  }
};

// Export all modules
export {
  Jaccard,
  Hamming,
  Cosine,
  DocumentSearch,
  Utils
};

// Default export for convenience
export default {
  Jaccard,
  Hamming,
  Cosine,
  DocumentSearch,
  Utils
};
