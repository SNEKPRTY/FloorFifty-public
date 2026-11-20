import { test as base } from "@playwright/test";

export * from "@playwright/test";

// Playwright owns fixture-created contexts, but browser.newContext() clients
// otherwise survive until the worker exits. Close them after hooks/artifacts.
export const test = base.extend<{ closeManualContexts: void }>({
  closeManualContexts: [
    async ({ browser }, use) => {
      try {
        await use();
      } finally {
        await Promise.all(browser.contexts().map((context) => context.close()));
      }
    },
    { auto: true },
  ],
});
