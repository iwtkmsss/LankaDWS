import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const faviconPath = fileURLToPath(new URL('./public/favicon.svg', import.meta.url))
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url))

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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '')
  const demoMode = mode !== 'production'
    && env.NODE_ENV !== 'production'
    && env.VITE_DEMO_MODE === 'true'
  const demoPassword = env.DEMO_SEED_PASSWORD?.trim() ?? ''
  if (demoMode && !demoPassword) {
    throw new Error('DEMO_SEED_PASSWORD is required when VITE_DEMO_MODE=true')
  }
  return {
    envDir: workspaceRoot,
    define: {
      __LANKADWS_DEMO_MODE__: JSON.stringify(demoMode),
      __LANKADWS_DEMO_PASSWORD__: JSON.stringify(demoMode ? demoPassword : ''),
    },
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
          target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  }
})
