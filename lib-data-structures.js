/**
 * Data Structures Module for SillyTavern UI Extensions
 * Provides efficient data structures for common patterns
 * Pure JavaScript implementation - no external dependencies
 * 
 * @module dataStructures
 */

/**
 * LRU (Least Recently Used) Cache
 * Perfect for caching chat messages, API responses, etc.
 */
class LRUCache {
  /**
   * Create a new LRU Cache
   * 
   * @param {number} capacity - Maximum number of items
   * 
   * @example
   * const cache = new LRUCache(100);
   * cache.set('key1', 'value1');
   */
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  /**
   * Get value from cache
   * 
   * @param {*} key - Cache key
   * @returns {*} Cached value or undefined
   */
  get(key) {
    if (!this.cache.has(key)) {
      return undefined;
    }
    
    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    
    return value;
  }

  /**
   * Set value in cache
   * 
   * @param {*} key - Cache key
   * @param {*} value - Value to cache
   * @returns {LRUCache} this
   */
  set(key, value) {
    // Delete if exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    
    // Add to end
    this.cache.set(key, value);
    
    // Remove oldest if over capacity
    if (this.cache.size > this.capacity) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    return this;
  }

  /**
   * Check if key exists
   * 
   * @param {*} key - Cache key
   * @returns {boolean} True if key exists
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Delete key from cache
   * 
   * @param {*} key - Cache key
   * @returns {boolean} True if key existed
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear all items
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache size
   * 
   * @returns {number} Number of items
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Get all keys
   * 
   * @returns {Array} Array of keys
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all values
   * 
   * @returns {Array} Array of values
   */
  values() {
    return Array.from(this.cache.values());
  }
}

/**
 * Queue (FIFO - First In First Out)
 */
class Queue {
  /**
   * Create a new Queue
   * 
   * @example
   * const queue = new Queue();
   * queue.enqueue('item1');
   */
  constructor() {
    this.items = [];
  }

  /**
   * Add item to end of queue
   * 
   * @param {*} item - Item to add
   * @returns {Queue} this
   */
  enqueue(item) {
    this.items.push(item);
    return this;
  }

  /**
   * Remove and return item from front of queue
   * 
   * @returns {*} First item or undefined
   */
  dequeue() {
    return this.items.shift();
  }

  /**
   * Get first item without removing
   * 
   * @returns {*} First item or undefined
   */
  peek() {
    return this.items[0];
  }

  /**
   * Check if queue is empty
   * 
   * @returns {boolean} True if empty
   */
  isEmpty() {
    return this.items.length === 0;
  }

  /**
   * Get queue size
   * 
   * @returns {number} Number of items
   */
  get size() {
    return this.items.length;
  }

  /**
   * Clear all items
   */
  clear() {
    this.items = [];
  }

  /**
   * Convert to array
   * 
   * @returns {Array} Array of items
   */
  toArray() {
    return [...this.items];
  }
}

/**
 * Priority Queue
 * Items with higher priority are dequeued first
 */
class PriorityQueue {
  /**
   * Create a new Priority Queue
   * 
   * @param {Function} comparator - Comparison function (a, b) => number
   * 
   * @example
   * const pq = new PriorityQueue((a, b) => b.priority - a.priority);
   */
  constructor(comparator = (a, b) => a - b) {
    this.items = [];
    this.comparator = comparator;
  }

  /**
   * Add item to queue
   * 
   * @param {*} item - Item to add
   * @returns {PriorityQueue} this
   */
  enqueue(item) {
    this.items.push(item);
    this.items.sort(this.comparator);
    return this;
  }

  /**
   * Remove and return highest priority item
   * 
   * @returns {*} Highest priority item or undefined
   */
  dequeue() {
    return this.items.shift();
  }

  /**
   * Get highest priority item without removing
   * 
   * @returns {*} Highest priority item or undefined
   */
  peek() {
    return this.items[0];
  }

  /**
   * Check if queue is empty
   * 
   * @returns {boolean} True if empty
   */
  isEmpty() {
    return this.items.length === 0;
  }

  /**
   * Get queue size
   * 
   * @returns {number} Number of items
   */
  get size() {
    return this.items.length;
  }

  /**
   * Clear all items
   */
  clear() {
    this.items = [];
  }
}

/**
 * Circular/Ring Buffer
 * Fixed-size buffer that overwrites oldest data when full
 */
class CircularBuffer {
  /**
   * Create a new Circular Buffer
   * 
   * @param {number} capacity - Maximum number of items
   * 
   * @example
   * const buffer = new CircularBuffer(5);
   * buffer.push('item1');
   */
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Add item to buffer
   * 
   * @param {*} item - Item to add
   * @returns {*} Overwritten item or undefined
   */
  push(item) {
    const overwritten = this.isFull() ? this.buffer[this.tail] : undefined;
    
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    
    if (this.isFull()) {
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.count++;
    }
    
    return overwritten;
  }

  /**
   * Get item at index (0 = oldest)
   * 
   * @param {number} index - Index to get
   * @returns {*} Item at index or undefined
   */
  get(index) {
    if (index < 0 || index >= this.count) {
      return undefined;
    }
    
    const actualIndex = (this.head + index) % this.capacity;
    return this.buffer[actualIndex];
  }

  /**
   * Get most recent item
   * 
   * @returns {*} Most recent item or undefined
   */
  peek() {
    if (this.isEmpty()) {
      return undefined;
    }
    
    const index = (this.tail - 1 + this.capacity) % this.capacity;
    return this.buffer[index];
  }

  /**
   * Check if buffer is full
   * 
   * @returns {boolean} True if full
   */
  isFull() {
    return this.count === this.capacity;
  }

  /**
   * Check if buffer is empty
   * 
   * @returns {boolean} True if empty
   */
  isEmpty() {
    return this.count === 0;
  }

  /**
   * Get buffer size
   * 
   * @returns {number} Number of items
   */
  get size() {
    return this.count;
  }

  /**
   * Clear all items
   */
  clear() {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Convert to array (oldest to newest)
   * 
   * @returns {Array} Array of items
   */
  toArray() {
    const result = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.get(i));
    }
    return result;
  }
}

/**
 * Trie (Prefix Tree)
 * Efficient for autocomplete and prefix matching
 */
class Trie {
  /**
   * Create a new Trie
   * 
   * @example
   * const trie = new Trie();
   * trie.insert('hello');
   */
  constructor() {
    this.root = {};
  }

  /**
   * Insert a word into the trie
   * 
   * @param {string} word - Word to insert
   * @returns {Trie} this
   */
  insert(word) {
    let node = this.root;
    
    for (const char of word) {
      if (!node[char]) {
        node[char] = {};
      }
      node = node[char];
    }
    
    node.isEndOfWord = true;
    return this;
  }

  /**
   * Search for exact word
   * 
   * @param {string} word - Word to search
   * @returns {boolean} True if word exists
   */
  search(word) {
    let node = this.root;
    
    for (const char of word) {
      if (!node[char]) {
        return false;
      }
      node = node[char];
    }
    
    return node.isEndOfWord === true;
  }

  /**
   * Check if any word starts with prefix
   * 
   * @param {string} prefix - Prefix to check
   * @returns {boolean} True if prefix exists
   */
  startsWith(prefix) {
    let node = this.root;
    
    for (const char of prefix) {
      if (!node[char]) {
        return false;
      }
      node = node[char];
    }
    
    return true;
  }

  /**
   * Get all words with given prefix
   * 
   * @param {string} prefix - Prefix to search
   * @returns {Array<string>} Array of matching words
   */
  getAllWithPrefix(prefix) {
    let node = this.root;
    
    // Navigate to prefix node
    for (const char of prefix) {
      if (!node[char]) {
        return [];
      }
      node = node[char];
    }
    
    // Collect all words from this node
    const results = [];
    this._collectWords(node, prefix, results);
    return results;
  }

  /**
   * Helper to collect all words from a node
   * 
   * @private
   */
  _collectWords(node, prefix, results) {
    if (node.isEndOfWord) {
      results.push(prefix);
    }
    
    for (const char in node) {
      if (char !== 'isEndOfWord') {
        this._collectWords(node[char], prefix + char, results);
      }
    }
  }

  /**
   * Delete a word from the trie
   * 
   * @param {string} word - Word to delete
   * @returns {boolean} True if word was deleted
   */
  delete(word) {
    return this._deleteHelper(this.root, word, 0);
  }

  /**
   * Helper for deletion
   * 
   * @private
   */
  _deleteHelper(node, word, index) {
    if (index === word.length) {
      if (!node.isEndOfWord) {
        return false;
      }
      node.isEndOfWord = false;
      return Object.keys(node).length === 0;
    }
    
    const char = word[index];
    if (!node[char]) {
      return false;
    }
    
    const shouldDeleteChild = this._deleteHelper(node[char], word, index + 1);
    
    if (shouldDeleteChild) {
      delete node[char];
      return Object.keys(node).length === 0 && !node.isEndOfWord;
    }
    
    return false;
  }
}

/**
 * Bloom Filter
 * Space-efficient probabilistic data structure for membership testing
 */
class BloomFilter {
  /**
   * Create a new Bloom Filter
   * 
   * @param {number} size - Size of bit array
   * @param {number} hashCount - Number of hash functions
   * 
   * @example
   * const filter = new BloomFilter(1000, 3);
   * filter.add('item1');
   */
  constructor(size = 1000, hashCount = 3) {
    this.size = size;
    this.hashCount = hashCount;
    this.bits = new Array(size).fill(false);
  }

  /**
   * Generate hash values for item
   * 
   * @private
   * @param {string} item - Item to hash
   * @returns {Array<number>} Array of hash values
   */
  _hash(item) {
    const hashes = [];
    const str = String(item);
    
    for (let i = 0; i < this.hashCount; i++) {
      let hash = 0;
      for (let j = 0; j < str.length; j++) {
        hash = ((hash << 5) - hash + str.charCodeAt(j) + i * 31) | 0;
      }
      hashes.push(Math.abs(hash) % this.size);
    }
    
    return hashes;
  }

  /**
   * Add item to filter
   * 
   * @param {*} item - Item to add
   * @returns {BloomFilter} this
   */
  add(item) {
    const hashes = this._hash(item);
    hashes.forEach(hash => {
      this.bits[hash] = true;
    });
    return this;
  }

  /**
   * Check if item might exist
   * False positives are possible, false negatives are not
   * 
   * @param {*} item - Item to check
   * @returns {boolean} True if item might exist
   */
  has(item) {
    const hashes = this._hash(item);
    return hashes.every(hash => this.bits[hash]);
  }

  /**
   * Clear all items
   */
  clear() {
    this.bits.fill(false);
  }
}

/**
 * Bidirectional Map
 * Map that allows lookup in both directions
 */
class BiMap {
  /**
   * Create a new Bidirectional Map
   * 
   * @example
   * const bimap = new BiMap();
   * bimap.set('key', 'value');
   */
  constructor() {
    this.forward = new Map();
    this.reverse = new Map();
  }

  /**
   * Set key-value pair
   * 
   * @param {*} key - Key
   * @param {*} value - Value
   * @returns {BiMap} this
   */
  set(key, value) {
    // Remove old mappings if they exist
    if (this.forward.has(key)) {
      this.reverse.delete(this.forward.get(key));
    }
    if (this.reverse.has(value)) {
      this.forward.delete(this.reverse.get(value));
    }
    
    this.forward.set(key, value);
    this.reverse.set(value, key);
    return this;
  }

  /**
   * Get value by key
   * 
   * @param {*} key - Key
   * @returns {*} Value or undefined
   */
  get(key) {
    return this.forward.get(key);
  }

  /**
   * Get key by value
   * 
   * @param {*} value - Value
   * @returns {*} Key or undefined
   */
  getKey(value) {
    return this.reverse.get(value);
  }

  /**
   * Check if key exists
   * 
   * @param {*} key - Key
   * @returns {boolean} True if key exists
   */
  has(key) {
    return this.forward.has(key);
  }

  /**
   * Check if value exists
   * 
   * @param {*} value - Value
   * @returns {boolean} True if value exists
   */
  hasValue(value) {
    return this.reverse.has(value);
  }

  /**
   * Delete by key
   * 
   * @param {*} key - Key
   * @returns {boolean} True if deleted
   */
  delete(key) {
    if (!this.forward.has(key)) {
      return false;
    }
    
    const value = this.forward.get(key);
    this.forward.delete(key);
    this.reverse.delete(value);
    return true;
  }

  /**
   * Delete by value
   * 
   * @param {*} value - Value
   * @returns {boolean} True if deleted
   */
  deleteValue(value) {
    if (!this.reverse.has(value)) {
      return false;
    }
    
    const key = this.reverse.get(value);
    this.reverse.delete(value);
    this.forward.delete(key);
    return true;
  }

  /**
   * Clear all mappings
   */
  clear() {
    this.forward.clear();
    this.reverse.clear();
  }

  /**
   * Get number of mappings
   * 
   * @returns {number} Number of mappings
   */
  get size() {
    return this.forward.size;
  }

  /**
   * Get all keys
   * 
   * @returns {Array} Array of keys
   */
  keys() {
    return Array.from(this.forward.keys());
  }

  /**
   * Get all values
   * 
   * @returns {Array} Array of values
   */
  values() {
    return Array.from(this.forward.values());
  }
}

/**
 * Set Operations Utility
 */
const SetOps = {
  /**
   * Union of two sets
   * 
   * @param {Set} setA - First set
   * @param {Set} setB - Second set
   * @returns {Set} Union set
   * 
   * @example
   * const union = SetOps.union(new Set([1, 2]), new Set([2, 3]));
   * // Set([1, 2, 3])
   */
  union(setA, setB) {
    return new Set([...setA, ...setB]);
  },

  /**
   * Intersection of two sets
   * 
   * @param {Set} setA - First set
   * @param {Set} setB - Second set
   * @returns {Set} Intersection set
   * 
   * @example
   * const intersection = SetOps.intersection(new Set([1, 2]), new Set([2, 3]));
   * // Set([2])
   */
  intersection(setA, setB) {
    return new Set([...setA].filter(x => setB.has(x)));
  },

  /**
   * Difference of two sets (A - B)
   * 
   * @param {Set} setA - First set
   * @param {Set} setB - Second set
   * @returns {Set} Difference set
   * 
   * @example
   * const diff = SetOps.difference(new Set([1, 2]), new Set([2, 3]));
   * // Set([1])
   */
  difference(setA, setB) {
    return new Set([...setA].filter(x => !setB.has(x)));
  },

  /**
   * Symmetric difference of two sets
   * 
   * @param {Set} setA - First set
   * @param {Set} setB - Second set
   * @returns {Set} Symmetric difference set
   * 
   * @example
   * const symDiff = SetOps.symmetricDifference(new Set([1, 2]), new Set([2, 3]));
   * // Set([1, 3])
   */
  symmetricDifference(setA, setB) {
    const diff1 = this.difference(setA, setB);
    const diff2 = this.difference(setB, setA);
    return this.union(diff1, diff2);
  },

  /**
   * Check if setA is subset of setB
   * 
   * @param {Set} setA - Potential subset
   * @param {Set} setB - Potential superset
   * @returns {boolean} True if setA is subset of setB
   * 
   * @example
   * SetOps.isSubset(new Set([1]), new Set([1, 2])); // true
   */
  isSubset(setA, setB) {
    return [...setA].every(x => setB.has(x));
  },

  /**
   * Check if setA is superset of setB
   * 
   * @param {Set} setA - Potential superset
   * @param {Set} setB - Potential subset
   * @returns {boolean} True if setA is superset of setB
   * 
   * @example
   * SetOps.isSuperset(new Set([1, 2]), new Set([1])); // true
   */
  isSuperset(setA, setB) {
    return this.isSubset(setB, setA);
  },

  /**
   * Check if two sets are disjoint (no common elements)
   * 
   * @param {Set} setA - First set
   * @param {Set} setB - Second set
   * @returns {boolean} True if sets are disjoint
   * 
   * @example
   * SetOps.isDisjoint(new Set([1, 2]), new Set([3, 4])); // true
   */
  isDisjoint(setA, setB) {
    return this.intersection(setA, setB).size === 0;
  }
};

// Export all data structures
export {
  LRUCache,
  Queue,
  PriorityQueue,
  CircularBuffer,
  Trie,
  BloomFilter,
  BiMap,
  SetOps
};
