import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'node dist/src/main.js', cwd: '../api', url: 'http://127.0.0.1:3000/api/v1/health/live', reuseExistingServer: true, timeout: 120_000 },
    { command: 'npm run dev -- --host 127.0.0.1', cwd: process.cwd(), url: 'http://127.0.0.1:5173/login', reuseExistingServer: true, timeout: 120_000 },
  ],
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
})
