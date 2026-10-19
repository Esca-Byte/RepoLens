import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined' && typeof window.localStorage?.clear === 'function') {
    window.localStorage.clear();
  }
});

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() { /* jsdom has no layout engine; observing is intentionally inert. */ }
    unobserve() { /* no-op */ }
    disconnect() { /* no-op */ }
  };
}

if (typeof window !== 'undefined' && typeof window.localStorage?.getItem !== 'function') {
  const values = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
}
