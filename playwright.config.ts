import { defineConfig, devices } from '@playwright/test';

// Preview port for this project (see README "Ports"): 4411 by default, `PREVIEW_PORT` overrides
// it so a second developer can run the suite alongside.
const PORT = Number(process.env.PREVIEW_PORT ?? 4411);
const ORIGIN = `http://localhost:${PORT}`;
// The site is published under this base (astro.config.mjs). Nothing is served at the bare root,
// so readiness has to probe the base URL; tests prefix their paths with it (tests/e2e/site.spec.ts).
const BASE = '/prd';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Tests run against the production build served by `astro preview`.
    command: `npm run build && npx astro preview --port ${PORT}`,
    url: `${ORIGIN}${BASE}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
