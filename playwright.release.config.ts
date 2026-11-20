import { defineConfig, devices } from "@playwright/test";

/**
 * The release smoke (`tests/release/smoke.spec.ts`) against a deployed
 * environment. No local servers: `FF_SMOKE_API` and `FF_SMOKE_URL` name what
 * to smoke. One worker, so a solo room is all it opens.
 */
export default defineConfig({
  testDir: "tests/release",
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-smoke" }]],
  use: {
    ...devices["Desktop Chrome"],
    channel: "chromium",
    // A cold load: no cache from an earlier run.
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
});
