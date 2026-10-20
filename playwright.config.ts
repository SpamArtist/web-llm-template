import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.WEB_PORT ?? 4173}`;
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND;

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  // See contracts/checks.md before enabling the browser suite.
  webServer: webServerCommand ? {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  } : undefined,
});
