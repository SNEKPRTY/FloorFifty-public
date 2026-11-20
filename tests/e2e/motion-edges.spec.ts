import { expect, test, type Locator, type Page } from "./support/test";
import { CLIENT_BOOT_MS, CLIENT_FOLLOWS_MS, SCREEN_SETTLE_MS, createRoom, expectScreen, holdClocks, openClient, openTitle, passSelect, passPhotosensitivity, pressLockIn, readyOnly, seedSettings } from "./support/room-driver";
import { SERVER_URL, waitForServer } from "./support/server-fixture";
import { passStudio } from "./support/studio";

/**
 * The animations audit's gaps, one row each, watched in a real browser
 * (the project's internal notes, "U3a to U3f", step 2).
 * One `describe` per screen group, so the groups merge without touching each other's lines. Each row
 * samples while the motion runs and again once it has settled, in normal motion and in reduced motion
 * (everything lands at once, never "never appears").
 */

/** Every scale the element takes over `ms`, read from the drawn transform, `1` when it has none. */
async function scalesDuring(target: Locator, ms: number, action: () => Promise<void>): Promise<number[]> {
  await target.evaluate((node, span) => {
    const samples: number[] = [];
    (window as unknown as { __scales?: number[] }).__scales = samples;
    const read = (): void => {
      const transform = getComputedStyle(node).transform;
      samples.push(transform === "none" ? 1 : new DOMMatrix(transform).a);
    };
    const timer = window.setInterval(read, 8);
    window.setTimeout(() => window.clearInterval(timer), span);
  }, ms);
  await action();
  await target.page().waitForTimeout(ms + 50);
  return target.page().evaluate(() => (window as unknown as { __scales: number[] }).__scales);
}

const settledTransform = (target: Locator): Promise<string> => target.evaluate((node) => getComputedStyle(node).transform);

async function openSettings(page: Page): Promise<void> {
  await page.getByTestId("title-settings").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();
}

for (const motion of ["no-preference", "reduce"] as const) {
  test.describe(`settings, ${motion} motion`, () => {
    test.use({ reducedMotion: motion });

    for (const row of [
      { name: "a ticked box", id: "settings-mute-unfocused" },
      { name: "a graphics choice", id: "settings-quality-low" },
    ]) {
      test(`${row.name} pulses its row once (scale, then back) and settles`, async ({ page }) => {
        await openTitle(page);
        await openSettings(page);
        const row_ = page.getByTestId(row.id).locator("xpath=ancestor::label");
        const scales = await scalesDuring(row_, 600, () => page.getByTestId(row.id).check({ force: true }));
        if (motion === "no-preference") {
          expect(Math.max(...scales), "it grew while the pulse ran").toBeGreaterThan(1.01);
          expect(Math.max(...scales), "and stayed within one beat of 6%").toBeLessThanOrEqual(1.07);
        } else {
          expect(Math.max(...scales), "reduced motion lands at once").toBeCloseTo(1, 5);
        }
        expect(await settledTransform(row_), "it ends where it began").toBe("none");
      });
    }

    test("picking a language pulses its row and keeps the focus where the player put it", async ({ browser }) => {
      const context = await browser.newContext({ reducedMotion: motion });
      await seedSettings(context, { locale: "en" });
      const page = await context.newPage();
      await openTitle(page);
      await openSettings(page);
      const pick = page.getByTestId("settings-language-es-419");
      const row = pick.locator("xpath=ancestor::label");
      const scales = await scalesDuring(row, 600, async () => {
        await pick.focus();
        await pick.check({ force: true });
      });
      if (motion === "no-preference") expect(Math.max(...scales)).toBeGreaterThan(1.01);
      else expect(Math.max(...scales)).toBeCloseTo(1, 5);
      await expect(pick).toBeFocused();
      expect(await settledTransform(row)).toBe("none");
      await context.close();
    });

    test("a slider is let alone: no pulse while it is moved", async ({ page }) => {
      await openTitle(page);
      await openSettings(page);
      const slider = page.getByTestId("settings-music");
      const row = slider.locator("xpath=ancestor::*[@data-row][1]");
      const scales = await scalesDuring(row, 400, () => slider.fill("0.4"));
      expect(Math.max(...scales)).toBeCloseTo(1, 5);
    });
  });
}

// ---- Boot and title ----

/**
 * Motion edges (audit 2026-11-19, `animations-audit`): each row is one gap the audit found, driven
 * to the screen, with the change triggered and what the player sees watched from inside the page.
 * One `describe` per screen group, so the groups that move onto the kit merge without touching each
 * other's lines.
 *
 * Nothing here samples at a clock time. A software-rendered container stalls for hundreds of
 * milliseconds a frame, so a row asks what the page did at the moment of the change, from a
 * `MutationObserver` that runs before the first frame: an arriving element is first seen
 * transparent and animating, a leaving one is `inert` while its exit still runs, and a surface that
 * fades by a CSS transition is seen running that transition. Under reduced motion the same row
 * expects the end state at once and no animation at all.
 */

interface Sight {
  opacity: number;
  animating: boolean;
  inert: boolean;
}
interface Watched {
  arrived?: Sight;
  leaving?: Sight;
  transitions: string[];
  /** Svelte's own `introstart` and `outrostart`: the exit really ran, not just an inert flag. */
  events: string[];
  gone: boolean;
}
interface Watch {
  /** The element, found by selector. */
  selector: string;
  /** The ancestor to watch instead, where the selector's own node is not what fades. */
  closest?: string;
}

/** Installs the in-page observer before any script of the page runs. */
async function watch(page: Page, watches: Record<string, Watch>): Promise<void> {
  await page.addInitScript((spec) => {
    const found: Record<string, Watched & { node?: Element }> = {};
    (window as unknown as { __edges: typeof found }).__edges = found;
    const sight = (node: Element): Sight => ({
      opacity: Number(getComputedStyle(node).opacity),
      animating: node.getAnimations({ subtree: false }).length > 0,
      inert: (node as HTMLElement).inert === true,
    });
    const find = (watch: Watch): Element | null => {
      const hit = document.querySelector(watch.selector);
      return hit !== null && watch.closest !== undefined ? hit.closest(watch.closest) : hit;
    };
    const look = (): void => {
      for (const [key, watch] of Object.entries(spec)) {
        const entry = (found[key] ??= { transitions: [], events: [], gone: false });
        const node = entry.node ?? find(watch);
        if (node === null || node === undefined) continue;
        if (entry.node === undefined) {
          entry.node = node;
          entry.arrived = sight(node);
          // Its own transitions only: the event bubbles up from every control inside.
          node.addEventListener("transitionrun", (event) => {
            if (event.target === node) entry.transitions.push((event as TransitionEvent).propertyName);
          });
          for (const name of ["introstart", "outrostart"]) node.addEventListener(name, () => entry.events.push(name));
        }
        if (entry.leaving === undefined && (node as HTMLElement).inert === true) entry.leaving = sight(node);
        if (!node.isConnected) entry.gone = true;
      }
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert", "data-under-page"] });
  }, watches);
}

/** What the page saw of a watched element, once it has settled. */
const edge = (page: Page, key: string): Promise<Watched | undefined> =>
  page.evaluate((name) => {
    const entry = (window as unknown as { __edges: Record<string, Watched & { node?: Element }> }).__edges[name];
    if (entry === undefined) return undefined;
    const { node: _node, ...rest } = entry;
    return rest;
  }, key);

const opacityOf = (page: Page, selector: string): Promise<number> =>
  page.evaluate((s) => Number(getComputedStyle(document.querySelector(s)!).opacity), selector);

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  const still = reducedMotion === "reduce";

  test.describe(`boot and title, motion ${reducedMotion}`, () => {
    test.use({ reducedMotion });

    test("the boot error rises in on the kit's glass and stands centred across and down", async ({ page }) => {
      await watch(page, { error: { selector: '[data-testid="boot-error"]' } });
      await page.context().route((url) => url.href.startsWith(`${SERVER_URL}/content`), (route) => route.abort("connectionrefused"));
      await page.goto("/");
      const panel = page.getByTestId("boot-error");
      await expect(panel).toBeVisible({ timeout: CLIENT_BOOT_MS });

      const seen = await edge(page, "error");
      expect(seen?.arrived?.opacity === 1, still ? "settles at once" : "arrives transparent").toBe(still);
      expect(seen?.arrived?.animating).toBe(!still);
      await expect(panel).toHaveClass(/ff-aquarian-panel/);
      await expect.poll(() => opacityOf(page, '[data-testid="boot-error"]')).toBe(1);

      const box = (await panel.boundingBox())!;
      const view = page.viewportSize()!;
      expect(Math.abs(box.x + box.width / 2 - view.width / 2), "centred across").toBeLessThanOrEqual(1);
      expect(Math.abs(box.y + box.height / 2 - view.height / 2), "and down").toBeLessThanOrEqual(1);
    });

    test("the splash's start line is glass and rises in once the game is ready", async ({ page }) => {
      await seedSettings(page.context(), { locale: "en" });
      await watch(page, { start: { selector: ".ff-splash__start" } });
      await page.goto("/");
      await passPhotosensitivity(page);
      await expect(page.getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: CLIENT_BOOT_MS });
      const seen = await edge(page, "start");
      expect(seen?.arrived?.opacity === 1, still ? "settles at once" : "arrives transparent").toBe(still);
      await expect(page.locator(".ff-splash__start")).toHaveClass(/ff-aquarian-panel/);
    });

    test("the title's panel and version tag rise in, in turn", async ({ page }) => {
      await seedSettings(page.context(), { locale: "en" });
      await watch(page, { card: { selector: ".ff-title__card" }, version: { selector: '[data-testid="title-version"]' } });
      await openTitle(page);
      for (const key of ["card", "version"]) {
        const seen = await edge(page, key);
        expect(seen?.arrived?.opacity === 1, `${key}: ${still ? "settles at once" : "arrives transparent"}`).toBe(still);
        expect(seen?.arrived?.animating, key).toBe(!still);
      }
    });

    test("the Character page cross-fades in and out over the menu instead of cutting", async ({ page }) => {
      await seedSettings(page.context(), { locale: "en" });
      await watch(page, {
        menu: { selector: '[data-testid="title"]' },
        view: { selector: '[data-testid="character-page"]', closest: ".ff-view" },
      });
      await openTitle(page);

      await page.getByTestId("title-character").click();
      await expect(page.getByTestId("character-page")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      const opened = await edge(page, "view");
      expect(opened?.arrived?.opacity === 1, still ? "the page is there at once" : "the page arrives transparent").toBe(still);
      expect(opened?.arrived?.animating).toBe(!still);
      await expect.poll(() => opacityOf(page, '[data-testid="title"]')).toBe(0);
      expect((await edge(page, "menu"))?.transitions.includes("opacity"), "the menu fades, it does not vanish").toBe(!still);

      await page.getByTestId("character-back").click();
      await expect(page.getByTestId("character-page")).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
      const closed = await edge(page, "view");
      if (!still) {
        expect(closed?.leaving?.inert, "the page is inert from its first leaving frame").toBe(true);
        expect(closed?.events, "and its exit runs").toContain("outrostart");
      }
      expect(closed?.gone).toBe(true);
      await expect.poll(() => opacityOf(page, '[data-testid="title"]')).toBe(1);
    });

    test("the language step's picked flag pulses once (the settings picker's own pulse)", async ({ page }) => {
      await page.goto("/");
      const language = page.getByTestId("language-first");
      await expect(page.getByTestId("studio-splash").or(language)).toBeVisible({ timeout: CLIENT_BOOT_MS });
      await passStudio(page);
      await expect(language).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      const flag = language.locator("label[lang='es-419']");
      await flag.evaluate((node) => {
        const seen: string[] = [];
        (window as unknown as { __pulse: string[] }).__pulse = seen;
        new MutationObserver(() => seen.push(getComputedStyle(node).transform)).observe(node, { attributes: true, attributeFilter: ["style"] });
      });
      await flag.click();
      await expect(language.getByTestId("first-language-es-419")).toBeChecked();
      // The pick applies once its face has loaded; the pulse follows it, so wait for it, not a clock.
      const grew = (): Promise<boolean> =>
        page.evaluate(() =>
          (window as unknown as { __pulse: string[] }).__pulse.some((transform) => transform !== "none" && Number(/matrix\(([\d.]+)/.exec(transform)?.[1]) > 1),
        );
      if (still) {
        await expect(language.getByTestId("first-language-es-419")).toBeChecked();
        expect(await grew(), "no pulse under reduced motion").toBe(false);
      } else {
        await expect.poll(grew, { message: "the flag grows once", timeout: CLIENT_FOLLOWS_MS }).toBe(true);
      }
    });

    test("the rotate hint falls out when OK is pressed, on a phone held upright", async ({ browser }) => {
      test.slow();
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion });
      // Every earlier hint is spent, so the race shows the rotate hint.
      await seedSettings(context, { locale: "en", seen: { swipeCoach: true, edgeLine: true, climbHints: true, tutorial: true } });
      const page = await context.newPage();
      await watch(page, { hint: { selector: '[data-testid="rotate-hint"]' } });
      await openClient(page);
      await createRoom(page, "Kite");
      await page.getByTestId("seat-add-cpu").first().click();
      await expect(page.getByTestId("seat-status").filter({ hasText: /^CPU$/ })).toHaveCount(1, { timeout: CLIENT_FOLLOWS_MS });
      await page.getByTestId("ready-toggle").click();
      await passSelect([page]);
      await expectScreen(page, "gameplay");
      const hint = page.getByTestId("rotate-hint");
      await expect(hint).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      expect((await edge(page, "hint"))?.arrived?.opacity === 1, "it arrives like a toast, or at once under reduced motion").toBe(still);

      await hint.getByTestId("rotate-hint-dismiss").click();
      await expect(hint).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
      const seen = await edge(page, "hint");
      expect(seen?.gone).toBe(true);
      if (still) expect(seen?.gone, "gone, no fall to wait for").toBe(true);
      else {
        expect(seen?.leaving?.inert, "inert from its first leaving frame").toBe(true);
        expect(seen?.events, "and its fall ran").toContain("outrostart");
      }
      await context.close();
    });
  });
}

/**
 * Select, a room walked from the ready room to the song's reveal. The select screen is one
 * `ViewSwitch`: each step is a view that arrives transparent and animating, and the one it replaces
 * is `inert` while its exit really runs (Svelte's `outrostart`), so a press lands on the new step at
 * once. The first step arrives by the same fade, from the ready room that left a frame before (the
 * audit's "arrives with a cut"). Under reduced motion every view is seen whole, with no animation.
 *
 * What the page saw is read from a `MutationObserver` installed before the page's scripts, so
 * nothing here samples at a clock time (a software-rendered container stalls hundreds of ms a frame).
 */
interface ViewSight {
  /** As the view was inserted. */
  arrived: { opacity: number; animating: boolean; inert: boolean };
  /** As its fade-in started (Svelte's `introstart`): absent when there was no fade. */
  fading?: { opacity: number; animating: boolean; inert: boolean };
  leaving?: { opacity: number; animating: boolean; inert: boolean };
  events: string[];
  gone: boolean;
}

async function watchSelectViews(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: Record<string, ViewSight & { node: Element }> = {};
    (window as unknown as { __views: typeof seen }).__views = seen;
    const sight = (node: Element) => ({
      opacity: Number(getComputedStyle(node).opacity),
      animating: node.getAnimations({ subtree: false }).length > 0,
      inert: (node as HTMLElement).inert === true,
    });
    const look = (): void => {
      for (const node of document.querySelectorAll(".ff-select__steps > .ff-view")) {
        const key = (node as HTMLElement).dataset["view"] ?? "?";
        let entry = seen[key];
        if (entry === undefined || entry.node !== node) {
          entry = seen[key] = { node, arrived: sight(node), events: [], gone: false };
          node.addEventListener("introstart", () => {
            entry!.events.push("introstart");
            // A microtask on: Svelte starts the animation right after it announces it.
            queueMicrotask(() => (entry!.fading = sight(node)));
          });
          node.addEventListener("outrostart", () => entry!.events.push("outrostart"));
        }
        if (entry.leaving === undefined && (node as HTMLElement).inert) entry.leaving = sight(node);
      }
      for (const entry of Object.values(seen)) if (!entry.node.isConnected) entry.gone = true;
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert"] });
  });
}

const viewSight = (page: Page, view: string): Promise<ViewSight | undefined> =>
  page.evaluate((key) => {
    const entry = (window as unknown as { __views: Record<string, ViewSight & { node?: Element }> }).__views[key];
    if (entry === undefined) return undefined;
    const { node: _node, ...rest } = entry;
    return rest;
  }, view);

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  const still = reducedMotion === "reduce";

  test.describe(`select steps, motion ${reducedMotion}`, () => {
    test.use({ reducedMotion });

    /** A view that arrived: fading in (transparent, animating) in full motion; whole, with nothing animating, in reduced. */
    const expectFade = (view: ViewSight, name: string): void => {
      if (still) {
        expect(view.arrived.opacity, `${name} arrives whole`).toBe(1);
        expect(view.fading?.animating ?? false, `${name} has no fade running`).toBe(false);
        return;
      }
      expect(view.fading?.opacity, `${name} starts transparent`).toBeLessThan(1);
      expect(view.fading?.animating, `${name} is animating`).toBe(true);
    };
    /** A view that left: inert while its exit ran, in full motion; simply gone, in reduced. */
    const expectExit = (view: ViewSight, name: string): void => {
      if (still) return; // its exit has no length: it is gone at once, which the poll for "gone" checks
      expect(view.leaving?.inert, `${name} is inert from its first leaving frame`).toBe(true);
      expect(view.events, `${name}'s exit really ran`).toContain("outrostart");
    };

    test.beforeAll(async () => {
      await waitForServer();
    });

    test("each step fades in over the one it replaces, which cannot catch a press while it leaves", async ({ page }) => {
      test.slow();
      await watchSelectViews(page);
      await openClient(page);
      const code = await createRoom(page, "Alpha");
      expect(code).toBeTruthy();
      await holdClocks(page, ["stage", "song"]);
      await readyOnly([page]);
      await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: SCREEN_SETTLE_MS });

      // The first step is the lobby's own switch's to fade in (its view is the select screen), not this one's.
      expect(await viewSight(page, "stage"), "the stage step is on screen").toBeDefined();

      await pressLockIn(page);
      await expect(page.getByTestId("roulette"), "the stage's reveal").toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      const reveal = (await viewSight(page, "stageReveal"))!;
      expectFade(reveal, "the stage's reveal");
      expectExit((await viewSight(page, "stage"))!, "the stage step");
      await expect.poll(async () => (await viewSight(page, "stage"))?.gone, { timeout: 5_000 }).toBe(true);

      await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "song", { timeout: CLIENT_FOLLOWS_MS });
      const song = (await viewSight(page, "song"))!;
      expectFade(song, "the song step");

      await pressLockIn(page);
      await expect(page.getByTestId("select-screen"), "the song's reveal").not.toHaveAttribute("data-step", "song", { timeout: CLIENT_FOLLOWS_MS });
      await expect.poll(async () => (await viewSight(page, "song"))?.gone, { timeout: 5_000 }).toBe(true);
      expectExit((await viewSight(page, "song"))!, "the song step");
      // Whole again once settled, and only one view left.
      await expect.poll(() => page.locator(".ff-select__steps > .ff-view").count(), { timeout: 5_000 }).toBe(1);
      expect(await opacityOf(page, ".ff-select__steps > .ff-view")).toBe(1);
    });
  });
}
