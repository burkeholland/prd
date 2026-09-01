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
  // CI retries so one flaky axe timeout does not block a deploy; locally we want to see the flake.
  retries: process.env.CI ? 2 : 0,
  // In CI `github` annotates failing tests on the run and on PR diffs and `html` writes the
  // playwright-report/ that deploy.yml attaches to a failed run; locally the list is enough.
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
  },
  // `chromium` always. `webkit` and `firefox` only with PW_ENGINES=all (e.g.
  // `$env:PW_ENGINES = 'all'; npx playwright test --project=webkit`), so a plain `npx playwright test`
  // stays Chromium-only and as fast as today until CI turns the other engines on. Desktop Safari's
  // descriptor defaults to deviceScaleFactor 2, which changes the responsive-image pick and every
  // pixel measurement; pin it to 1 so the three engines see the same page.
  // Clipboard permissions live on the chromium project: WebKit rejects `clipboard-write` and Firefox
  // `clipboard-read`, and a rejected permission fails every test in the file that requests it.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
    ...(process.env.PW_ENGINES === 'all'
      ? [
          { name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 } },
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        ]
      : []),
  ],
  webServer: {
    // Tests run against the production build served by `astro preview`. With PLAYWRIGHT_PREBUILT set
    // (deploy.yml) the existing dist/ is served without rebuilding: CI tests the artifact it deploys.
    command: process.env.PLAYWRIGHT_PREBUILT
      ? `npx astro preview --port ${PORT}`
      : `npm run build && npx astro preview --port ${PORT}`,
    url: `${ORIGIN}${BASE}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
