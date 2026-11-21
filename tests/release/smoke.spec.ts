/**
 * The release smoke (release readiness §9.2, as Amendment R amends it).
 *
 * Runs against a deployed environment's plain production build, not the
 * inspection build the e2e suite drives:
 *   - `FF_SMOKE_API` (required): the API, whose probes are checked;
 *   - `FF_SMOKE_URL` (optional): the standalone client. Staging sets it;
 *     production has no standalone client (Amendment R, D-R2), so it runs the
 *     API checks alone.
 *
 * A production build has no test driver, so the client half stops at a race
 * starting and a reload during it, rather than at results; the e2e suite and
 * the drills' bots cover a finished race.
 */

import { expect, test, type Page, type Request } from "@playwright/test";
import { expectScreen, passPhotosensitivity, passSplash } from "../e2e/support/room-driver";

const API = process.env["FF_SMOKE_API"] ?? "";
const CLIENT = process.env["FF_SMOKE_URL"];

/**
 * Everything before the title, the menu song aside, which streams behind the
 * splash (Amendment R.4). 50 MiB (50 x 1024 x 1024 bytes), raised from 8 MiB
 * by the owner for 1.0.0 (2026-10-16).
 */
const FIRST_LOAD_BUDGET_BYTES = 50 * 1024 * 1024;

/**
 * Until the splash is shown: its fonts and its art are in and the boot loader
 * has gone. The spec's 5 s, plus the 8 s the smoke spends answering a first
 * visit's language and warning. Overridable for a slow machine; the measured
 * time is always recorded.
 */
const SPLASH_BUDGET_MS = Number(process.env["FF_SMOKE_SPLASH_MS"] ?? 5_000 + 8_000);

/**
 * Until the splash asks for its tap: the menu, the shell's pictures and the
 * whole menu song (about 10 MB, played from memory) have arrived, with no
 * timer that gives up (Owner, 2026-10-10: waiting screens may be long). The
 * budget is unchanged: on a release runner's link those bytes take a second or
 * two. Overridable for a slow machine; the measured time is always recorded.
 */
const INTERACTIVE_BUDGET_MS = Number(process.env["FF_SMOKE_INTERACTIVE_MS"] ?? 5_000 + 8_000);

test.describe("the API (release readiness §9.2)", () => {
  test.skip(API === "", "FF_SMOKE_API names the API to smoke");

  test("is ready, and says which build it is", async ({ request }) => {
    const ready = await request.get(`${API}/ready`);
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toEqual({ ready: true });

    const health = await request.get(`${API}/health`);
    const facts = (await health.json()) as Record<string, unknown>;
    expect(facts).toMatchObject({ ok: true, draining: false });
    for (const key of ["buildId", "protocolVersion", "rulesetRevision", "contentRevision"]) expect(facts).toHaveProperty(key);
    expect(health.headers()["cache-control"]).toBe("no-store");
  });

  test("serves content with an ETag", async ({ request }) => {
    const content = await request.get(`${API}/content`);
    expect(content.status()).toBe(200);
    expect(content.headers()["etag"]).toBeTruthy();
  });

  // Appendix B's exploit rows: nothing private answers in production.
  test("mounts no test driver and no debug telemetry", async ({ request }) => {
    expect((await request.get(`${API}/__test__/drive`)).status()).toBe(404);
    expect((await request.get(`${API}/debug/telemetry`)).status()).toBe(404);
  });

  test("names a security contact", async ({ request }) => {
    const text = await (await request.get(`${API}/.well-known/security.txt`)).text();
    expect(text).toMatch(/^Contact: \S+/m);
  });
});

test.describe("the standalone client (release readiness §9.2)", () => {
  test.skip(CLIENT === undefined, "FF_SMOKE_URL names a standalone client");

  /** Records what a clean page must never produce. */
  const watch = async (page: Page) => {
    const consoleMessages: string[] = [];
    const failed: string[] = [];
    page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
    page.on("requestfailed", (request: Request) => {
      const reason = request.failure()?.errorText ?? "unknown error";
      // Audio teardown and reload cancel local blob reads. Keep real network
      // failures, broken blobs and non-media cancellations visible.
      if (request.url().startsWith("blob:") && request.resourceType() === "media" && reason === "net::ERR_ABORTED") return;
      failed.push(`${request.url()} (${reason})`);
    });
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`),
      );
    });
    return {
      consoleMessages,
      failed,
      csp: () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp),
    };
  };

  test("loads cold, starts a race, survives a reload, and says nothing", async ({ page, context }) => {
    test.setTimeout(150_000);
    const seen = await watch(page);
    let transferred = 0;
    let titleReached = false;
    page.on("response", async (response) => {
      if (titleReached || /main-menu/.test(response.url())) return;
      const sizes = await response.request().sizes().catch(() => undefined);
      transferred += sizes?.responseBodySize ?? 0;
    });

    const started = Date.now();
    await page.goto(CLIENT!);
    // A cold first visit asks the language, then shows the photosensitivity
    // warning, before the splash (splash.ts `warn`). A player answers both;
    // so does the smoke, and the clock keeps running through them.
    await passPhotosensitivity(page);
    // The splash shows once its own fonts and art are in: the quick milestone.
    await expect(page.getByTestId("splash")).toHaveClass(/ff-splash--shown/, { timeout: 20_000 });
    const splashMs = Date.now() - started;
    test.info().annotations.push({ type: "splash shown ms", description: String(splashMs) });
    expect(splashMs, "the splash shows within the budget").toBeLessThan(SPLASH_BUDGET_MS);
    // Interactive is the splash asking for its tap: everything before the title has loaded.
    await expect(page.getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    const interactiveMs = Date.now() - started;
    test.info().annotations.push({ type: "interactive ms", description: String(interactiveMs) });
    expect(interactiveMs, "interactive within the budget").toBeLessThan(INTERACTIVE_BUDGET_MS);
    await passSplash(page);
    await expectScreen(page, "title");
    titleReached = true;
    test.info().annotations.push({ type: "first-load bytes", description: String(transferred) });
    expect(transferred, "first load, the menu song aside").toBeLessThan(FIRST_LOAD_BUDGET_BYTES);

    // The client is the build the API runs.
    const health = (await (await page.request.get(`${API}/health`)).json()) as { buildId: string };
    const bundles = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map((script) => script.src),
    );
    const bundleText = (await Promise.all(bundles.map(async (src) => (await page.request.get(src)).text()))).join("\n");
    expect(bundleText, "the bundle carries the API's build id").toContain(health.buildId);

    await page.getByTestId("title-play").click();
    await expectScreen(page, "lobby");
    // A fresh profile has not been shown how: the first press that starts a match is asked once, and Skip carries on with it.
    await page.getByTestId("name-input").fill("Smoke");
    await page.getByTestId("create-room").click();
    await page.getByTestId("match-gate-skip").click();
    await expect(page.getByTestId("room-code")).not.toBeEmpty({ timeout: 30_000 });
    await page.getByTestId("ready-toggle").click();
    await expectScreen(page, "gameplay");

    await page.reload();
    await passSplash(page);
    await expect(page.locator('[data-screen="gameplay"], [data-screen="title"], [data-screen="lobby"]')).toBeVisible({
      timeout: 30_000,
    });

    expect(await context.cookies(), "no cookies").toEqual([]);
    expect(await seen.csp(), "no CSP violations").toEqual([]);
    expect(seen.failed, "no failed requests").toEqual([]);
    expect(seen.consoleMessages, "no console output").toEqual([]);
  });
});
