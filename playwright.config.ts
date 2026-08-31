import { defineConfig, devices } from '@playwright/test';

// Preview port for this project (see README "Ports"). Nobody else uses 4411.
const PORT = 4411;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Tests run against the production build served by `astro preview`.
    command: 'npm run build && npm run preview',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
