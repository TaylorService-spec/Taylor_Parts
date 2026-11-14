// Playwright config for the Parts browser network test (e2e/partsNetworkGraph.spec.mjs). TEST INFRASTRUCTURE.
// Not part of `npm test` and not a required CI check: it needs a running governed stack (see e2e/README.md).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /partsNetworkGraph\.spec\.mjs$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: [["list"]],
  outputDir: "./e2e-output/playwright",
  use: {
    headless: true,
    ...(process.env.EOS_NET_BROWSER_CHANNEL ? { channel: process.env.EOS_NET_BROWSER_CHANNEL } : {}),
  },
});
