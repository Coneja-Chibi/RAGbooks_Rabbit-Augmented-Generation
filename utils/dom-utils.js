/**
 * DOM Utilities Module for SillyTavern UI Extensions
 * Provides browser-safe DOM manipulation without jQuery
 * Pure JavaScript implementation - no external dependencies
 *
 * From: https://github.com/prolix-oc/ST-Helpers
 * @module domUtils
 */

/**
 * DOM Manipulation Utilities
 */
const DOMUtils = {
  /**
   * Safely create an element with attributes and content
   * Prevents XSS by escaping text content
   *
   * @param {string} tag - HTML tag name
   * @param {Object} options - Element options
   * @param {Object} options.attrs - Attributes to set
   * @param {string} options.text - Text content (will be escaped)
   * @param {string} options.html - HTML content (use with caution)
   * @param {Array<HTMLElement>} options.children - Child elements
   * @param {Object} options.style - CSS styles
   * @param {Object} options.data - Data attributes
   * @returns {HTMLElement} Created element
   */
  createElement(tag, options = {}) {
    const element = document.createElement(tag);
    const { attrs = {}, text, html, children = [], style = {}, data = {} } = options;

    // Set attributes
    Object.entries(attrs).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        element.setAttribute(key, value);
      }
    });

    // Set styles
    Object.entries(style).forEach(([key, value]) => {
      element.style[key] = value;
    });

    // Set data attributes
    Object.entries(data).forEach(([key, value]) => {
      element.dataset[key] = value;
    });

    // Set content (text is safer, html can be dangerous)
    if (text !== undefined) {
      element.textContent = text;
    } else if (html !== undefined) {
      element.innerHTML = html;
    }

    // Append children
    children.forEach(child => {
      if (child instanceof HTMLElement) {
        element.appendChild(child);
      }
    });

    return element;
  },

  /**
   * Query selector with optional context
   *
   * @param {string} selector - CSS selector
   * @param {HTMLElement} context - Context element (default: document)
   * @returns {HTMLElement|null} Found element
   */
  query(selector, context = document) {
    return context.querySelector(selector);
  },

  /**
   * Query selector all with optional context, returns array
   *
   * @param {string} selector - CSS selector
   * @param {HTMLElement} context - Context element (default: document)
   * @returns {Array<HTMLElement>} Array of found elements
   */
  queryAll(selector, context = document) {
    return Array.from(context.querySelectorAll(selector));
  },

  /**
   * Add event listener with event delegation support
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {string} event - Event name
   * @param {Function|string} handlerOrSelector - Handler function or delegate selector
   * @param {Function} delegateHandler - Handler for delegation
   * @returns {Function} Cleanup function to remove listener
   */
  on(target, event, handlerOrSelector, delegateHandler) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (!element) {
      console.warn('DOMUtils.on: Target element not found');
      return () => {};
    }

    // Event delegation
    if (typeof handlerOrSelector === 'string') {
      const selector = handlerOrSelector;
      const handler = delegateHandler;

      const delegatedHandler = (e) => {
        const targetElement = e.target.closest(selector);
        if (targetElement && element.contains(targetElement)) {
          handler.call(targetElement, e);
        }
      };

      element.addEventListener(event, delegatedHandler);
      return () => element.removeEventListener(event, delegatedHandler);
    }

    // Direct event listener
    const handler = handlerOrSelector;
    element.addEventListener(event, handler);
    return () => element.removeEventListener(event, handler);
  },

  /**
   * Add event listener that fires only once
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @returns {Function} Cleanup function
   */
  once(target, event, handler) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (!element) {
      console.warn('DOMUtils.once: Target element not found');
      return () => {};
    }

    const onceHandler = (e) => {
      handler(e);
      element.removeEventListener(event, onceHandler);
    };

    element.addEventListener(event, onceHandler);
    return () => element.removeEventListener(event, onceHandler);
  },

  /**
   * Debounce function execution
   * Delays execution until after wait time has elapsed since last call
   *
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in milliseconds
   * @param {boolean} immediate - Execute on leading edge (default: false)
   * @returns {Function} Debounced function
   */
  debounce(func, wait, immediate = false) {
    let timeout;

    return function executedFunction(...args) {
      const context = this;

      const later = () => {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };

      const callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);

      if (callNow) func.apply(context, args);
    };
  },

  /**
   * Throttle function execution
   * Ensures function is called at most once per specified time period
   *
   * @param {Function} func - Function to throttle
   * @param {number} limit - Time limit in milliseconds
   * @returns {Function} Throttled function
   */
  throttle(func, limit) {
    let inThrottle;

    return function executedFunction(...args) {
      const context = this;

      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  /**
   * Add CSS class(es) to element
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {...string} classes - Class names to add
   * @returns {HTMLElement|null} Target element
   */
  addClass(target, ...classes) {
    const element = typeof target === 'string' ? this.query(target) : target;
    if (element) {
      element.classList.add(...classes);
    }
    return element;
  },

  /**
   * Remove CSS class(es) from element
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {...string} classes - Class names to remove
   * @returns {HTMLElement|null} Target element
   */
  removeClass(target, ...classes) {
    const element = typeof target === 'string' ? this.query(target) : target;
    if (element) {
      element.classList.remove(...classes);
    }
    return element;
  },

  /**
   * Toggle CSS class(es) on element
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {string} className - Class name to toggle
   * @param {boolean} force - Force add (true) or remove (false)
   * @returns {boolean} True if class is now present
   */
  toggleClass(target, className, force) {
    const element = typeof target === 'string' ? this.query(target) : target;
    if (element) {
      return element.classList.toggle(className, force);
    }
    return false;
  },

  /**
   * Check if element has CSS class
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {string} className - Class name to check
   * @returns {boolean} True if element has class
   */
  hasClass(target, className) {
    const element = typeof target === 'string' ? this.query(target) : target;
    return element ? element.classList.contains(className) : false;
  },

  /**
   * Smooth scroll to element or position
   *
   * @param {Object} options - Scroll options
   * @param {HTMLElement|string} options.target - Target element or selector
   * @param {number} options.top - Scroll to Y position
   * @param {number} options.left - Scroll to X position
   * @param {string} options.behavior - Scroll behavior: 'smooth' or 'auto' (default: 'smooth')
   * @param {number} options.offset - Offset from target (default: 0)
   * @param {HTMLElement} options.container - Scroll container (default: window)
   */
  scrollTo(options = {}) {
    const {
      target,
      top,
      left,
      behavior = 'smooth',
      offset = 0,
      container = window
    } = options;

    if (target) {
      const element = typeof target === 'string' ? this.query(target) : target;
      if (element) {
        const rect = element.getBoundingClientRect();

        if (container === window) {
          // For window scrolling, add viewport position to page offset
          const scrollTop = window.pageYOffset;
          container.scrollTo({
            top: scrollTop + rect.top + offset,
            behavior
          });
        } else {
          // For non-window containers, calculate position relative to container
          // getBoundingClientRect() is relative to viewport, so we need to:
          // 1. Get the container's viewport position
          // 2. Calculate the element's position relative to container
          // 3. Add the container's current scroll position
          const containerRect = container.getBoundingClientRect();
          const relativeTop = rect.top - containerRect.top;
          const targetScrollTop = container.scrollTop + relativeTop + offset;

          container.scrollTo({
            top: targetScrollTop,
            behavior
          });
        }
      }
    } else {
      container.scrollTo({
        top: top !== undefined ? top : container.scrollY,
        left: left !== undefined ? left : container.scrollX,
        behavior
      });
    }
  },

  /**
   * Check if element is visible in viewport
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {Object} options - Visibility options
   * @param {number} options.threshold - Visibility threshold 0-1 (default: 0)
   * @param {string} options.rootMargin - Root margin (default: '0px')
   * @returns {Promise<boolean>} Promise resolving to visibility state
   */
  isVisible(target, options = {}) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (!element) {
      return Promise.resolve(false);
    }

    const { threshold = 0, rootMargin = '0px' } = options;

    // Fallback for browsers without IntersectionObserver
    if (!('IntersectionObserver' in window)) {
      const rect = element.getBoundingClientRect();
      return Promise.resolve(
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth
      );
    }

    return new Promise((resolve) => {
      const observer = new IntersectionObserver(
        (entries) => {
          resolve(entries[0].isIntersecting);
          observer.disconnect();
        },
        { threshold, rootMargin }
      );

      observer.observe(element);
    });
  },

  /**
   * Observe element visibility changes
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {Function} callback - Callback function (receives isVisible boolean)
   * @param {Object} options - Observer options
   * @returns {Object} Observer object with disconnect method
   */
  observeVisibility(target, callback, options = {}) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (!element || !('IntersectionObserver' in window)) {
      return { disconnect: () => {} };
    }

    const { threshold = 0, rootMargin = '0px' } = options;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => callback(entry.isIntersecting));
      },
      { threshold, rootMargin }
    );

    observer.observe(element);
    return observer;
  },

  /**
   * Get element's position and dimensions
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @returns {DOMRect|null} Element rectangle
   */
  getRect(target) {
    const element = typeof target === 'string' ? this.query(target) : target;
    return element ? element.getBoundingClientRect() : null;
  },

  /**
   * Get element's offset position relative to document
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @returns {Object|null} Object with top and left properties
   */
  getOffset(target) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (!element) return null;

    const rect = element.getBoundingClientRect();
    return {
      top: rect.top + window.pageYOffset,
      left: rect.left + window.pageXOffset
    };
  },

  /**
   * Set inline styles on element
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {Object} styles - Style properties
   * @returns {HTMLElement|null} Target element
   */
  setStyle(target, styles) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (element) {
      Object.entries(styles).forEach(([key, value]) => {
        element.style[key] = value;
      });
    }

    return element;
  },

  /**
   * Get computed style value
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {string} property - CSS property name
   * @returns {string} Computed style value
   */
  getStyle(target, property) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (!element) return '';

    return window.getComputedStyle(element)[property];
  },

  /**
   * Show element (remove display: none)
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {string} display - Display value (default: 'block')
   * @returns {HTMLElement|null} Target element
   */
  show(target, display = 'block') {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (element) {
      element.style.display = display;
    }

    return element;
  },

  /**
   * Hide element (set display: none)
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @returns {HTMLElement|null} Target element
   */
  hide(target) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (element) {
      element.style.display = 'none';
    }

    return element;
  },

  /**
   * Toggle element visibility
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {string} display - Display value when showing (default: 'block')
   * @returns {boolean} True if now visible
   */
  toggle(target, display = 'block') {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (!element) return false;

    const isHidden = window.getComputedStyle(element).display === 'none';
    element.style.display = isHidden ? display : 'none';

    return isHidden;
  },

  /**
   * Remove element from DOM
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @returns {HTMLElement|null} Removed element
   */
  remove(target) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (element && element.parentNode) {
      element.parentNode.removeChild(element);
    }

    return element;
  },

  /**
   * Empty element (remove all children)
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @returns {HTMLElement|null} Target element
   */
  empty(target) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (element) {
      while (element.firstChild) {
        element.removeChild(element.firstChild);
      }
    }

    return element;
  },

  /**
   * Get or set element attribute
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {string|Object} attr - Attribute name or object of attributes
   * @param {string} value - Attribute value (if attr is string)
   * @returns {string|null|HTMLElement} Attribute value or element
   */
  attr(target, attr, value) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (!element) return null;

    // Get attribute
    if (typeof attr === 'string' && value === undefined) {
      return element.getAttribute(attr);
    }

    // Set single attribute
    if (typeof attr === 'string') {
      element.setAttribute(attr, value);
      return element;
    }

    // Set multiple attributes
    if (typeof attr === 'object') {
      Object.entries(attr).forEach(([key, val]) => {
        element.setAttribute(key, val);
      });
      return element;
    }

    return null;
  },

  /**
   * Remove attribute from element
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {string} attr - Attribute name
   * @returns {HTMLElement|null} Target element
   */
  removeAttr(target, attr) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (element) {
      element.removeAttribute(attr);
    }

    return element;
  },

  /**
   * Wait for DOM to be ready
   *
   * @param {Function} callback - Callback function
   */
  ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback);
    } else {
      callback();
    }
  },

  /**
   * Create a simple cache for query results
   *
   * @returns {Object} Cache object with get and clear methods
   */
  createQueryCache() {
    const cache = new Map();

    return {
      get(selector, context = document) {
        const key = `${selector}:${context}`;

        if (!cache.has(key)) {
          const element = context.querySelector(selector);
          if (element) {
            cache.set(key, element);
          }
        }

        return cache.get(key) || null;
      },

      clear() {
        cache.clear();
      }
    };
  },

  /**
   * Get distance from element to viewport edges
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @returns {Object|null} Object with distances to all viewport edges
   */
  getDistanceToViewport(target) {
    const element = typeof target === 'string' ? this.query(target) : target;

    if (!element) return null;

    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    return {
      top: rect.top,
      right: viewportWidth - rect.right,
      bottom: viewportHeight - rect.bottom,
      left: rect.left
    };
  },

  /**
   * Get distance between two elements
   *
   * @param {HTMLElement|string} element1 - First element or selector
   * @param {HTMLElement|string} element2 - Second element or selector
   * @returns {Object|null} Object with horizontal and vertical distances
   */
  getDistanceBetween(element1, element2) {
    const elem1 = typeof element1 === 'string' ? this.query(element1) : element1;
    const elem2 = typeof element2 === 'string' ? this.query(element2) : element2;

    if (!elem1 || !elem2) return null;

    const rect1 = elem1.getBoundingClientRect();
    const rect2 = elem2.getBoundingClientRect();

    // Calculate horizontal distance (negative if overlapping)
    let horizontal;
    if (rect1.right < rect2.left) {
      horizontal = rect2.left - rect1.right;
    } else if (rect2.right < rect1.left) {
      horizontal = rect1.left - rect2.right;
    } else {
      horizontal = 0; // Overlapping horizontally
    }

    // Calculate vertical distance (negative if overlapping)
    let vertical;
    if (rect1.bottom < rect2.top) {
      vertical = rect2.top - rect1.bottom;
    } else if (rect2.bottom < rect1.top) {
      vertical = rect1.top - rect2.bottom;
    } else {
      vertical = 0; // Overlapping vertically
    }

    return {
      horizontal,
      vertical,
      diagonal: Math.sqrt(horizontal * horizontal + vertical * vertical)
    };
  },

  /**
   * Log detailed element measurements to console
   *
   * @param {HTMLElement|string} target - Target element or selector
   * @param {string} label - Optional label for the log entry
   * @returns {Object|null} Measurement data object
   */
  logElementMeasurements(target, label = 'Element') {
    const element = typeof target === 'string' ? DOMUtils.query(target) : target;

    if (!element) {
      console.warn(`DOMUtils.logElementMeasurements: Element not found`);
      return null;
    }

    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);
    const viewportDistance = DOMUtils.getDistanceToViewport(element);

    const measurements = {
      selector: typeof target === 'string' ? target : element.tagName,
      dimensions: {
        width: rect.width,
        height: rect.height,
        computedWidth: computed.width,
        computedHeight: computed.height
      },
      position: {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        x: rect.x,
        y: rect.y
      },
      distanceToViewport: viewportDistance,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      padding: {
        top: computed.paddingTop,
        right: computed.paddingRight,
        bottom: computed.paddingBottom,
        left: computed.paddingLeft
      },
      margin: {
        top: computed.marginTop,
        right: computed.marginRight,
        bottom: computed.marginBottom,
        left: computed.marginLeft
      }
    };

    console.group(`${label} Measurements`);
    console.log('Element:', element);
    console.log('Dimensions:', measurements.dimensions);
    console.log('Position:', measurements.position);
    console.log('Distance to Viewport Edges:', measurements.distanceToViewport);
    console.log('Viewport Size:', measurements.viewport);
    console.log('Padding:', measurements.padding);
    console.log('Margin:', measurements.margin);
    console.groupEnd();

    return measurements;
  }
};

// Export individual functions for convenience
export const {
  createElement,
  query,
  queryAll,
  on,
  once,
  debounce,
  throttle,
  addClass,
  removeClass,
  toggleClass,
  hasClass,
  scrollTo,
  isVisible,
  observeVisibility,
  getRect,
  getOffset,
  setStyle,
  getStyle,
  show,
  hide,
  toggle,
  remove,
  empty,
  attr,
  removeAttr,
  ready,
  createQueryCache,
  getDistanceToViewport,
  getDistanceBetween,
  logElementMeasurements
} = DOMUtils;

// Export module
export default DOMUtils;
