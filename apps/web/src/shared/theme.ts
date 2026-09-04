export type ColorTheme = 'light' | 'dark'

export const themeStorageKey = 'bertcrm.theme'

export function getStoredTheme(): ColorTheme {
  try {
    return window.localStorage.getItem(themeStorageKey) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0d1424' : '#f4f6fa')
}

export function storeTheme(theme: ColorTheme) {
  try {
    window.localStorage.setItem(themeStorageKey, theme)
  } catch {
    // The selected theme still applies for this page when storage is unavailable.
  }
}

export function initializeTheme() {
  const theme = getStoredTheme()
  applyTheme(theme)
  return theme
}
