import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// The full suite runs many jsdom files in parallel; debounced searches and
// lazy pages can exceed the 1 s default wait there while passing alone.
configure({ asyncUtilTimeout: 5_000 })

// jsdom has no layout observer; shared resize controls use the real API in browsers.
globalThis.ResizeObserver ??= class implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(cleanup)
