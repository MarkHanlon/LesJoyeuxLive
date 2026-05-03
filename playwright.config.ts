import { defineConfig, devices } from '@playwright/test';

/**
 * Run the app locally before testing:
 *   1. vercel env pull .env.local   (requires Vercel CLI: npm i -g vercel)
 *   2. npx playwright install chromium
 *   3. npx playwright test
 *
 * Or test against the live site:
 *   BASE_URL=https://your-app.vercel.app TEST_USER=YourName npx playwright test
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const useLocalServer = !process.env.BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Start the local full-stack server automatically when no BASE_URL is set
  ...(useLocalServer && {
    webServer: {
      command: 'vercel dev --listen 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  }),
});
