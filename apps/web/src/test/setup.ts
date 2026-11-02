import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom has no layout observer; shared resize controls use the real API in browsers.
globalThis.ResizeObserver ??= class implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(cleanup)
