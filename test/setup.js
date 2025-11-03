// Jest setup for coder-workspace plugin tests

// Use modern fake timers where needed
jest.spyOn(global, 'setTimeout');

// Ensure window and document exist (jsdom environment)
if (typeof window === 'undefined') {
  // eslint-disable-next-line no-undef
  global.window = {};
}
if (typeof document === 'undefined') {
  // Minimal document stub for tests that create elements
  // eslint-disable-next-line no-undef
  global.document = {
    createElement: () => ({
      tagName: 'div',
      style: {},
      appendChild: () => {},
      remove: () => {},
      setAttribute: () => {},
      addEventListener: () => {},
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
    querySelector: () => null,
  };
}

// Provide a basic alert fallback so tests don’t crash
if (typeof window.alert !== 'function') {
  // eslint-disable-next-line no-alert
  window.alert = () => {};
}

// Provide a basic localStorage stub if not present
if (!('localStorage' in window)) {
  const store = new Map();
  // eslint-disable-next-line no-undef
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  window.localStorage = global.localStorage;
}

// Provide fetch stub if needed
if (typeof fetch !== 'function') {
  // eslint-disable-next-line no-undef
  global.fetch = jest.fn();
}
