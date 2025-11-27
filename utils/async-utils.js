/**
 * Async Utilities Module for SillyTavern UI Extensions
 * Provides modern async/await helpers for API calls and async operations
 * Pure JavaScript implementation - no external dependencies
 *
 * From: https://github.com/prolix-oc/ST-Helpers
 * @module asyncUtils
 */

/**
 * Async Utilities
 */
const AsyncUtils = {
  /**
   * Sleep/delay for specified milliseconds
   *
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>} Promise that resolves after delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Retry async function with exponential backoff
   *
   * @param {Function} fn - Async function to retry
   * @param {Object} options - Retry options
   * @param {number} options.maxAttempts - Maximum retry attempts (default: 3)
   * @param {number} options.delay - Initial delay in ms (default: 1000)
   * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
   * @param {number} options.backoffFactor - Backoff multiplier (default: 2)
   * @param {Function} options.onRetry - Callback on retry (receives attempt number and error)
   * @param {Function} options.shouldRetry - Function to determine if should retry (receives error)
   * @returns {Promise<*>} Result of successful function call
   */
  async retry(fn, options = {}) {
    const {
      maxAttempts = 3,
      delay = 1000,
      maxDelay = 30000,
      backoffFactor = 2,
      onRetry = null,
      shouldRetry = () => true
    } = options;

    let lastError;
    let currentDelay = delay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts || !shouldRetry(error)) {
          throw error;
        }

        if (onRetry) {
          onRetry(attempt, error);
        }

        await this.sleep(currentDelay);
        currentDelay = Math.min(currentDelay * backoffFactor, maxDelay);
      }
    }

    throw lastError;
  },

  /**
   * Add timeout to promise
   *
   * @param {Promise} promise - Promise to add timeout to
   * @param {number} ms - Timeout in milliseconds
   * @param {string} message - Error message (default: 'Operation timed out')
   * @returns {Promise<*>} Promise that rejects on timeout
   */
  timeout(promise, ms, message = 'Operation timed out') {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(message)), ms)
      )
    ]);
  },

  /**
   * Execute async functions sequentially
   *
   * @param {Array<Function>} fns - Array of async functions
   * @param {*} initialValue - Initial value passed to first function
   * @returns {Promise<*>} Result of last function
   */
  async sequential(fns, initialValue) {
    let result = initialValue;

    for (const fn of fns) {
      result = await fn(result);
    }

    return result;
  },

  /**
   * Execute async functions in parallel with concurrency limit
   *
   * @param {Array<Function>} fns - Array of async functions
   * @param {number} concurrency - Maximum concurrent executions (default: 5)
   * @returns {Promise<Array>} Array of results
   */
  async parallel(fns, concurrency = 5) {
    const results = [];
    const executing = [];

    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i];
      const promise = Promise.resolve().then(() => fn());
      results[i] = promise;

      if (concurrency <= fns.length) {
        const e = promise.then(() =>
          executing.splice(executing.indexOf(e), 1)
        );
        executing.push(e);

        if (executing.length >= concurrency) {
          await Promise.race(executing);
        }
      }
    }

    return Promise.all(results);
  },

  /**
   * Rate limiter - limits number of calls per time period
   *
   * @param {number} maxCalls - Maximum calls per period
   * @param {number} period - Time period in milliseconds
   * @returns {Object} Rate limiter object with execute method
   */
  rateLimiter(maxCalls, period) {
    const queue = [];
    let tokens = maxCalls;

    // Refill tokens periodically
    setInterval(() => {
      tokens = maxCalls;
      while (queue.length > 0 && tokens > 0) {
        const resolve = queue.shift();
        tokens--;
        resolve();
      }
    }, period);

    return {
      async execute(fn) {
        if (tokens > 0) {
          tokens--;
          return fn();
        }

        await new Promise(resolve => queue.push(resolve));
        return fn();
      }
    };
  },

  /**
   * Batch processor - process items in batches
   *
   * @param {Array} items - Items to process
   * @param {Function} processor - Async function to process each batch
   * @param {Object} options - Batch options
   * @param {number} options.batchSize - Items per batch (default: 10)
   * @param {number} options.delay - Delay between batches in ms (default: 0)
   * @param {Function} options.onProgress - Progress callback (receives processed count)
   * @returns {Promise<Array>} Array of results
   */
  async batch(items, processor, options = {}) {
    const {
      batchSize = 10,
      delay = 0,
      onProgress = null
    } = options;

    const results = [];
    let processed = 0;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await processor(batch);
      results.push(...batchResults);

      processed += batch.length;
      if (onProgress) {
        onProgress(processed, items.length);
      }

      if (delay > 0 && i + batchSize < items.length) {
        await this.sleep(delay);
      }
    }

    return results;
  },

  /**
   * Create a cancelable promise
   *
   * @param {Function} executor - Promise executor function
   * @returns {Object} Object with promise and cancel method
   */
  cancelable(executor) {
    let cancelCallback;
    let isCanceled = false;

    const promise = new Promise((resolve, reject) => {
      const onCancel = (callback) => {
        cancelCallback = callback;
      };

      executor(
        (value) => {
          if (!isCanceled) resolve(value);
        },
        (error) => {
          if (!isCanceled) reject(error);
        },
        onCancel
      );
    });

    return {
      promise,
      cancel() {
        isCanceled = true;
        if (cancelCallback) {
          cancelCallback();
        }
      }
    };
  },

  /**
   * Debounce async function
   * Only executes after calls have stopped for specified time
   *
   * @param {Function} fn - Async function to debounce
   * @param {number} wait - Wait time in milliseconds
   * @returns {Function} Debounced function
   */
  debounceAsync(fn, wait) {
    let timeout;
    let pendingPromise;

    return function debounced(...args) {
      clearTimeout(timeout);

      if (!pendingPromise) {
        pendingPromise = new Promise((resolve, reject) => {
          timeout = setTimeout(async () => {
            try {
              const result = await fn.apply(this, args);
              resolve(result);
              pendingPromise = null;
            } catch (error) {
              reject(error);
              pendingPromise = null;
            }
          }, wait);
        });
      }

      return pendingPromise;
    };
  },

  /**
   * Throttle async function
   * Ensures function is called at most once per time period
   *
   * @param {Function} fn - Async function to throttle
   * @param {number} limit - Time limit in milliseconds
   * @returns {Function} Throttled function
   */
  throttleAsync(fn, limit) {
    let inThrottle;
    let lastResult;

    return async function throttled(...args) {
      if (!inThrottle) {
        inThrottle = true;
        lastResult = await fn.apply(this, args);
        setTimeout(() => (inThrottle = false), limit);
      }
      return lastResult;
    };
  },

  /**
   * Async queue for ordered execution
   * Ensures async operations execute in order
   *
   * @returns {Object} Queue object with add method
   */
  queue() {
    let pending = Promise.resolve();

    return {
      add(fn) {
        pending = pending.then(fn, fn);
        return pending;
      }
    };
  },

  /**
   * Memoize async function results
   * Caches results based on arguments
   *
   * @param {Function} fn - Async function to memoize
   * @param {Object} options - Memoization options
   * @param {Function} options.keyGenerator - Function to generate cache key from args
   * @param {number} options.ttl - Time to live in ms (default: no expiration)
   * @returns {Function} Memoized function
   */
  memoize(fn, options = {}) {
    const {
      keyGenerator = (...args) => JSON.stringify(args),
      ttl = null
    } = options;

    const cache = new Map();

    return async function memoized(...args) {
      const key = keyGenerator(...args);

      if (cache.has(key)) {
        const cached = cache.get(key);
        if (!ttl || Date.now() - cached.timestamp < ttl) {
          return cached.value;
        }
        cache.delete(key);
      }

      const result = await fn.apply(this, args);
      cache.set(key, {
        value: result,
        timestamp: Date.now()
      });

      return result;
    };
  },

  /**
   * Poll async function until condition is met
   *
   * @param {Function} fn - Async function to poll
   * @param {Function} condition - Function that returns true when done
   * @param {Object} options - Polling options
   * @param {number} options.interval - Interval between polls in ms (default: 1000)
   * @param {number} options.maxAttempts - Maximum attempts (default: 10)
   * @param {Function} options.onAttempt - Callback on each attempt
   * @returns {Promise<*>} Result when condition is met
   */
  async poll(fn, condition, options = {}) {
    const {
      interval = 1000,
      maxAttempts = 10,
      onAttempt = null
    } = options;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await fn();

      if (onAttempt) {
        onAttempt(attempt, result);
      }

      if (condition(result)) {
        return result;
      }

      if (attempt < maxAttempts) {
        await this.sleep(interval);
      }
    }

    throw new Error('Polling max attempts exceeded');
  },

  /**
   * Map array with async function
   *
   * @param {Array} array - Array to map
   * @param {Function} fn - Async mapper function
   * @param {number} concurrency - Max concurrent operations (default: unlimited)
   * @returns {Promise<Array>} Mapped array
   */
  async map(array, fn, concurrency = Infinity) {
    if (concurrency === Infinity) {
      return Promise.all(array.map(fn));
    }

    const results = [];
    const iterator = array.entries();
    const workers = Array(Math.min(concurrency, array.length))
      .fill(iterator)
      .map(async (iter) => {
        for (const [index, item] of iter) {
          results[index] = await fn(item, index, array);
        }
      });

    await Promise.all(workers);
    return results;
  },

  /**
   * Filter array with async predicate
   *
   * @param {Array} array - Array to filter
   * @param {Function} predicate - Async predicate function
   * @returns {Promise<Array>} Filtered array
   */
  async filter(array, predicate) {
    const results = await Promise.all(array.map(predicate));
    return array.filter((_, index) => results[index]);
  },

  /**
   * Reduce array with async reducer
   *
   * @param {Array} array - Array to reduce
   * @param {Function} reducer - Async reducer function
   * @param {*} initialValue - Initial value
   * @returns {Promise<*>} Reduced value
   */
  async reduce(array, reducer, initialValue) {
    let accumulator = initialValue;

    for (let i = 0; i < array.length; i++) {
      accumulator = await reducer(accumulator, array[i], i, array);
    }

    return accumulator;
  },

  /**
   * Wait for all promises and return results with errors
   * Similar to Promise.allSettled but returns results and errors separately
   *
   * @param {Array<Promise>} promises - Array of promises
   * @returns {Promise<Object>} Object with results and errors arrays
   */
  async allSettled(promises) {
    const settled = await Promise.allSettled(promises);

    const results = [];
    const errors = [];

    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push({ index, value: result.value });
      } else {
        errors.push({ index, error: result.reason });
      }
    });

    return { results, errors };
  },

  /**
   * Wait for first successful promise
   * Unlike Promise.race, continues if promises reject
   *
   * @param {Array<Promise>} promises - Array of promises
   * @returns {Promise<*>} First successful result
   */
  async any(promises) {
    return Promise.any(promises).catch(() => {
      throw new Error('All promises rejected');
    });
  },

  /**
   * Waterfall - pass result of each function to next
   *
   * @param {Array<Function>} fns - Array of async functions
   * @param {*} initialValue - Initial value
   * @returns {Promise<*>} Final result
   */
  async waterfall(fns, initialValue) {
    return this.sequential(fns, initialValue);
  },

  /**
   * Delay function execution
   *
   * @param {Function} fn - Function to delay
   * @param {number} ms - Delay in milliseconds
   * @returns {Promise<*>} Result of function
   */
  async delay(fn, ms) {
    await this.sleep(ms);
    return fn();
  }
};

// Export module
export default AsyncUtils;
