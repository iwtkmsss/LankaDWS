import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const faviconPath = fileURLToPath(new URL('./public/favicon.svg', import.meta.url))

function faviconVersionPlugin() {
  return {
    name: 'favicon-version',
    transformIndexHtml(html: string) {
      const version = createHash('sha256')
        .update(readFileSync(faviconPath))
        .digest('hex')
        .slice(0, 12)

      return html.replace('/favicon.svg', `/favicon.svg?v=${version}`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), faviconVersionPlugin()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
