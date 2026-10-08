import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock ResizeObserver for React Flow
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock DOMMatrix for reactflow
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class {
    constructor() {}
    multiply() { return this; }
    inverse() { return this; }
    transformPoint() { return { x: 0, y: 0 }; }
  };
}

// Mock matchMedia for components that use it
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}