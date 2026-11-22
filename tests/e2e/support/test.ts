import { test as base, type BrowserContext } from "@playwright/test";

export * from "@playwright/test";

/**
 * Every client the specs open has been shown how, as a returning player has: a first Find a race, Create or
 * Join is otherwise stopped by the match gate (story-mode spec, "The first-match gate"), and almost no spec
 * is about that. Settings a spec stores itself win (`seen: { tutorial: false }` is how the gate's own
 * specs and the walk's first visit ask for a first visit).
 */
const SHOWN_HOW = (): void => {
  const key = "floor-fifty.settings.v1";
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
  } catch {
    stored = {};
  }
  const seen = { tutorial: true, ...(stored["seen"] as object | undefined) };
  window.localStorage.setItem(key, JSON.stringify({ ...stored, version: 2, seen }));
};

const shownHow = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(SHOWN_HOW);
};

// Playwright owns fixture-created contexts, but browser.newContext() clients
// otherwise survive until the worker exits. Close them after hooks/artifacts.
export const test = base.extend<{ closeManualContexts: void }>({
  context: async ({ context }, use) => {
    await shownHow(context);
    await use(context);
  },
  closeManualContexts: [
    async ({ browser }, use) => {
      const open = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const context = await open(options);
        await shownHow(context);
        return context;
      };
      try {
        await use();
      } finally {
        browser.newContext = open;
        await Promise.all(browser.contexts().map((context) => context.close()));
      }
    },
    { auto: true },
  ],
});
