import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const database = resolve(webRoot, '..', 'api', 'prisma', 'web-e2e.db')
const databaseUrl = `file:${database.replaceAll('\\', '/')}`
const apiUrl = 'http://127.0.0.1:3100'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node dist/src/main.js',
      cwd: '../api',
      url: `${apiUrl}/api/v1/health/live`,
      env: {
        PORT: '3100',
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        DISABLE_JOB_WORKER: 'true',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5174',
      cwd: process.cwd(),
      url: 'http://127.0.0.1:5174/login',
      env: { VITE_API_PROXY_TARGET: apiUrl },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
})
