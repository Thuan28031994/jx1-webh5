import { defineConfig } from '@playwright/test';

/*
 * Playwright normally tests ../game (the packaged Android/OTA output),
 * NOT unbuilt web/src TypeScript. This distinction is intentional.
 *
 * Patch 02: set VLI_PATCH02_TEST=1 after building with
 *   npm run android:sync -- --out patch02-test-out
 * to test a dedicated, freshly generated static build, preserving the
 * deployed ../game tree and all untracked Patch 01 media.
 */
const patch02 = process.env.VLI_PATCH02_TEST === '1';
const port = patch02 ? 8937 : 8917;
const staticRoot = patch02 ? '../patch02-test-out' : '../game';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  webServer: {
    command: 'node scripts/serve-static.mjs ' + staticRoot + ' ' + port,
    port,
    // Never accidentally reuse a running older app for Patch 02.
    reuseExistingServer: !patch02 && !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:' + port,
    viewport: { width: 1280, height: 800 },
  },
});
