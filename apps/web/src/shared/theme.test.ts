import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme, getStoredTheme, initializeTheme, storeTheme, themeStorageKey } from './theme'

afterEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('color theme', () => {
  it('uses light as the default and restores a stored dark theme', () => {
    expect(initializeTheme()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    window.localStorage.setItem(themeStorageKey, 'dark')

    expect(getStoredTheme()).toBe('dark')
    expect(initializeTheme()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('persists and applies the selected theme', () => {
    storeTheme('dark')
    applyTheme('dark')

    expect(window.localStorage.getItem(themeStorageKey)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
