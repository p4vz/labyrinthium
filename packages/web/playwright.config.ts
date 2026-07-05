import { defineConfig } from '@playwright/test';

const PORT = 8321;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Use the environment's pre-installed Chromium instead of downloading one.
    launchOptions: process.env.PLAYWRIGHT_BROWSERS_PATH
      ? { executablePath: `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` }
      : {},
  },
  webServer: {
    // The server serves the built web app from packages/web/dist.
    command: `PORT=${PORT} LABYRINTHIUM_DB=:memory: node ../server/dist/index.js`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
