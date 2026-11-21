/**
 * Every locale on three viewports at 200% (languages spec §6.4, §8.1): no
 * control or label is clipped, nothing sits outside its parent, no two
 * targets overlap. Each run saves its captures under docs/i18n/screens/ for
 * the reviewers. Phone landscape is added for the ready room's action bar,
 * the tightest measured fit in the game (phase 5 plan, Review Focus 4).
 */

import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "./support/test";
import { LOCALE_TAGS, type LocaleTag } from "../../apps/client/src/features/i18n/locales";
import { evidenceDir } from "./support/evidence";
import { walkFlow, type FlowScreen, type Sweep, type WalkOptions } from "./support/layout";
import { expectScreen, finishRace, openTitle, passSplash, seedSettings, type ClientShape } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

type Viewport = { name: string; sweep: Sweep } & Pick<WalkOptions, "deviceScaleFactor" | "rootFontScale">;

/*
 * Each sweep names the form factor the client classifies it as. At 200% a
 * desktop's CSS viewport is a phone held sideways and a tablet's a phone
 * held upright, so the client lays them out as those: the zoomed layouts are
 * the ones this suite holds the translations to.
 */
const VIEWPORTS: readonly Viewport[] = [
  // 1280 × 800 at 200%: a CSS viewport of 640 × 400 at DPR 2.
  { name: "desktop", sweep: { width: 640, height: 400, factor: "phone-landscape", touch: false }, deviceScaleFactor: 2 },
  // 820 × 1180 at 200%: 410 × 590 at DPR 2.
  { name: "tablet-portrait", sweep: { width: 410, height: 590, factor: "phone-portrait", touch: true }, deviceScaleFactor: 2 },
  // A phone does not reflow on pinch zoom: 200% is the large-text setting.
  { name: "phone-portrait", sweep: { width: 390, height: 844, factor: "phone-portrait", touch: true }, rootFontScale: 2 },
];

/** A viewport as the room driver opens its clients. */
const shapeOf = (viewport: Viewport): ClientShape => ({
  context: {
    viewport: { width: viewport.sweep.width, height: viewport.sweep.height },
    hasTouch: viewport.sweep.touch,
    isMobile: viewport.sweep.touch,
    ...(viewport.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: viewport.deviceScaleFactor }),
  },
  ...(viewport.rootFontScale === undefined ? {} : { rootFontScale: viewport.rootFontScale }),
});

const SHOTS = evidenceDir("i18n");
const TARGETS = "button, a[href], [role=tab], [role=radio], input, select";
const LABELS = `${TARGETS}, label, .ff-aq-label, .ff-chip, h1, h2, h3`;

/**
 * What the checks measure: copy a player can see and reach. Shared by both
 * checks, in the page.
 *
 * - Only elements whose text has a letter: a glyph like ‹ overhanging its
 *   box is not cut-off copy.
 * - Not visually hidden (screen-reader-only text is 1 px by design).
 * - Not the wordmark: the brand, set tight on purpose and never translated.
 * - Not a name (`*__name`): a typed or authored name may ellipsise; the
 *   spec allows it, and the full name stays in the DOM.
 * - Reachable: a target under a dialog or the pause overlay is not one a tap
 *   can hit, so it cannot collide with anything.
 */
const PROBE = `
  window.__ffCopy = {
    shown(el) {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (box.width <= 1 || box.height <= 1) return false;
      if (style.visibility === "hidden" || style.display === "none") return false;
      return !/inset\\(50%\\)/.test(style.clipPath);
    },
    copy(el) {
      if (el.closest("[data-testid$=wordmark], .ff-wordmark")) return false;
      if ([...el.classList].some((name) => name.endsWith("__name"))) return false;
      return /\\p{L}/u.test(el.textContent || "");
    },
    reachable(el) {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && (hit === el || el.contains(hit));
    },
    name(el) {
      return el.tagName.toLowerCase() + "[" + (el.getAttribute("data-testid") || "") + "] \\"" + (el.textContent || "").trim().slice(0, 40) + "\\"";
    },
  };
`;

/** Copy cut by its own box (where that box clips), and reachable controls outside their parent. */
async function expectNothingClipped(page: Page, where: string): Promise<void> {
  await page.evaluate(PROBE);
  const found = await page.evaluate(
    ({ labels, targets }) => {
      const probe = (window as unknown as { __ffCopy: Record<string, (el: Element) => unknown> }).__ffCopy;
      const clipped = [...document.querySelectorAll(labels)]
        .filter((el) => probe["shown"]!(el) && probe["copy"]!(el))
        .filter((el) => {
          // Overflow that stays visible spills past the box but cuts nothing;
          // only an axis that clips can hide copy.
          const style = getComputedStyle(el);
          const cutsX = style.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1;
          const cutsY = style.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 1;
          return cutsX || cutsY;
        })
        .map((el) => probe["name"]!(el) as string);
      const outside = [...document.querySelectorAll(targets)]
        .filter((el) => probe["shown"]!(el) && probe["reachable"]!(el))
        .filter((el) => {
          // The parent that draws a box: a `display: contents` wrapper (the HUD's cells held upright) has none, and measures as 0 by 0.
          let holder = el.parentElement;
          while (holder !== null && getComputedStyle(holder).display === "contents") holder = holder.parentElement;
          const parent = holder?.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          return parent !== undefined && (box.right > parent.right + 1 || box.left < parent.left - 1);
        })
        .map((el) => probe["name"]!(el) as string);
      return { clipped, outside };
    },
    { labels: LABELS, targets: TARGETS },
  );
  expect.soft(found.clipped, `${where}: clipped`).toEqual([]);
  expect.soft(found.outside, `${where}: outside its parent`).toEqual([]);
}

/** No two reachable targets overlap, unless one holds the other (a label and its radio). */
async function expectTargetsApart(page: Page, where: string): Promise<void> {
  await page.evaluate(PROBE);
  const overlaps = await page.evaluate((targets) => {
    const probe = (window as unknown as { __ffCopy: Record<string, (el: Element) => unknown> }).__ffCopy;
    const shown = [...document.querySelectorAll(targets)].filter((el) => probe["shown"]!(el) && probe["reachable"]!(el));
    const pairs: string[] = [];
    for (let i = 0; i < shown.length; i += 1) {
      for (let j = i + 1; j < shown.length; j += 1) {
        const a = shown[i]!;
        const b = shown[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        // A slider drawn as a thin line keeps a finger-high box (the replay's
        // position bar): it may lie under another target, so long as it takes
        // no press where they overlap.
        const slider = [a, b].find((el) => el.matches("input[type=range]"));
        if (slider !== undefined && overlapX > 1 && overlapY > 1) {
          const left = Math.max(ra.left, rb.left);
          const top = Math.max(ra.top, rb.top);
          const points = [0.1, 0.5, 0.9].flatMap((fx) => [0.1, 0.5, 0.9].map((fy) => [left + overlapX * fx, top + overlapY * fy] as const));
          if (points.every(([x, y]) => !slider.contains(document.elementFromPoint(x, y)))) continue;
        }
        if (overlapX > 1 && overlapY > 1) pairs.push(`${a.getAttribute("data-testid") ?? a.tagName} × ${b.getAttribute("data-testid") ?? b.tagName}`);
      }
    }
    return pairs;
  }, TARGETS);
  expect.soft(overlaps, `${where}: overlapping targets`).toEqual([]);
}

async function capture(page: Page, locale: LocaleTag, viewport: string, surface: string): Promise<void> {
  await mkdir(`${SHOTS}/${locale}`, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${locale}/${viewport}-${surface}.png` });
}

/** The dialog's content no wider than the dialog: nothing to scroll to sideways. */
async function expectNoSidewaysScroll(page: Page, where: string): Promise<void> {
  const overflow = await page.getByTestId("language-first-dialog").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect.soft(overflow, `${where}: scrolls sideways`).toBeLessThanOrEqual(1);
}

// The first visit's language step comes before any language is chosen, so it
// is checked once a viewport rather than once a locale: in English, then in
// the face with the most to fit after a flag is picked there. A phone held
// upright at its own text size is added: the large flags' row is widest there
// against the dialog.
const LANGUAGE_STEP_VIEWPORTS: readonly Viewport[] = [
  ...VIEWPORTS,
  { name: "phone-portrait-1x", sweep: { width: 390, height: 844, factor: "phone-portrait", touch: true } },
  { name: "phone-portrait-small", sweep: { width: 360, height: 740, factor: "phone-portrait", touch: true } },
];
for (const viewport of LANGUAGE_STEP_VIEWPORTS) {
  test(`the first visit's language step fits on ${viewport.name}, before and after a pick`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: viewport.sweep.width, height: viewport.sweep.height },
      hasTouch: viewport.sweep.touch,
      isMobile: viewport.sweep.touch,
      reducedMotion: "reduce",
      locale: "en-US",
      ...(viewport.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: viewport.deviceScaleFactor }),
    });
    if (viewport.rootFontScale !== undefined) {
      await context.addInitScript((scale) => {
        document.addEventListener("DOMContentLoaded", () => {
          document.documentElement.style.fontSize = `${100 * scale}%`;
        });
      }, viewport.rootFontScale);
    }
    const page = await context.newPage();
    try {
      await page.goto("/");
      const step = page.getByTestId("language-first");
      await expect(step).toBeVisible({ timeout: 20_000 });
      await expectNothingClipped(page, `${viewport.name} language step`);
      await expectTargetsApart(page, `${viewport.name} language step`);
      await expectNoSidewaysScroll(page, `${viewport.name} language step`);
      await capture(page, "en", viewport.name, "language-step");
      await step.getByTestId("first-language-ja").check();
      await expect(page.locator("html")).toHaveAttribute("lang", "ja");
      await expectNothingClipped(page, `${viewport.name} language step, ja`);
      await expectTargetsApart(page, `${viewport.name} language step, ja`);
      await expectNoSidewaysScroll(page, `${viewport.name} language step, ja`);
      await capture(page, "ja", viewport.name, "language-step");
    } finally {
      await context.close();
    }
  });
}

for (const locale of LOCALE_TAGS) {
  for (const viewport of VIEWPORTS) {
    test(`${locale} on ${viewport.name}: the room flow fits`, async ({ browser }) => {
      test.slow();
      await walkFlow(
        browser,
        viewport.sweep,
        async (screen: FlowScreen, page) => {
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          const where = `${locale} ${viewport.name} ${screen}`;
          await expectNothingClipped(page, where);
          await expectTargetsApart(page, where);
          await capture(page, locale, viewport.name, screen.replaceAll(" ", "-"));
        },
        {
          settings: { locale },
          ...(viewport.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: viewport.deviceScaleFactor }),
          ...(viewport.rootFontScale === undefined ? {} : { rootFontScale: viewport.rootFontScale }),
        },
      );
    });

    test(`${locale} on ${viewport.name}: the photosensitivity warning, error panel, settings, story and pause fit`, async ({ browser }) => {
      test.slow();
      const context = await browser.newContext({
        viewport: { width: viewport.sweep.width, height: viewport.sweep.height },
        hasTouch: viewport.sweep.touch,
        isMobile: viewport.sweep.touch,
        reducedMotion: "reduce",
        ...(viewport.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: viewport.deviceScaleFactor }),
      });
      await seedSettings(context, { locale, input: { touchMode: "buttons" }, seen: { swipeCoach: true } });
      if (viewport.rootFontScale !== undefined) {
        await context.addInitScript((scale) => {
          document.addEventListener("DOMContentLoaded", () => {
            document.documentElement.style.fontSize = `${100 * scale}%`;
          });
        }, viewport.rootFontScale);
      }
      // A stale seat: the splash's resume fails, and the title shows that the last room has closed.
      await context.addInitScript(() =>
        window.sessionStorage.setItem(
          "floor-fifty.session",
          JSON.stringify({ roomCode: "ZZZZZZ", playerId: "gone", reconnectionToken: "stale" }),
        ),
      );
      const page = await context.newPage();
      try {
        const where = (surface: string) => `${locale} ${viewport.name} ${surface}`;
        await page.goto("/");
        await expect(page.getByTestId("photosensitivity-warning")).toBeVisible({ timeout: 20_000 });
        await expectNothingClipped(page, where("photosensitivity warning"));
        await expectTargetsApart(page, where("photosensitivity warning"));
        await capture(page, locale, viewport.name, "photosensitivity");
        await passSplash(page);
        await expectScreen(page, "title");
        await expect(page.getByTestId("error-view")).toBeVisible();
        await expectNothingClipped(page, where("error panel"));
        await capture(page, locale, viewport.name, "error-panel");
        await page.getByTestId("error-dismiss").click();

        await page.getByTestId("title-settings").click();
        await expect(page.getByTestId("settings-modal")).toBeVisible();
        await expectNothingClipped(page, where("settings"));
        await expectTargetsApart(page, where("settings"));
        await capture(page, locale, viewport.name, "settings");
        await page.keyboard.press("Escape");

        // The flag beside Mute, and the six flags it opens.
        await expect(page.getByTestId("title-language").locator(`svg[data-flag]`)).toBeVisible();
        await page.getByTestId("title-language").click();
        await expect(page.getByTestId("language-modal")).toBeVisible();
        await expectNothingClipped(page, where("language"));
        await expectTargetsApart(page, where("language"));
        await capture(page, locale, viewport.name, "language");
        await page.keyboard.press("Escape");

        await page.getByTestId("quick-story").click();
        await expectScreen(page, "story");
        await expect(page.getByTestId("story-hub")).toBeVisible({ timeout: 20_000 });
        await expectNothingClipped(page, where("story hub"));
        await capture(page, locale, viewport.name, "story-hub");
        await page.getByTestId("story-play").click();
        await expect(page.getByTestId("story-cutscene")).toBeVisible({ timeout: 30_000 });
        await expectNothingClipped(page, where("story cutscene"));
        await page.getByTestId("story-cutscene-skip").click();
        await expect(page.getByTestId("story-line").or(page.getByTestId("story-chip")).first()).toBeVisible({ timeout: 20_000 });
        await expectNothingClipped(page, where("story"));
        await capture(page, locale, viewport.name, "story-words");

        await page.getByTestId("pause-open").click();
        await expect(page.getByTestId("pause-overlay")).toBeVisible();
        await expectNothingClipped(page, where("pause"));
        await expectTargetsApart(page, where("pause"));
        await capture(page, locale, viewport.name, "pause");
      } finally {
        await context.close();
      }
    });
    test(`${locale} on ${viewport.name}: the Coming soon sheet fits`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: viewport.sweep.width, height: viewport.sweep.height },
        hasTouch: viewport.sweep.touch,
        isMobile: viewport.sweep.touch,
        reducedMotion: "reduce",
        ...(viewport.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: viewport.deviceScaleFactor }),
      });
      await seedSettings(context, { locale, seen: { swipeCoach: true } });
      if (viewport.rootFontScale !== undefined) {
        await context.addInitScript((scale) => {
          document.addEventListener("DOMContentLoaded", () => {
            document.documentElement.style.fontSize = `${100 * scale}%`;
          });
        }, viewport.rootFontScale);
      }
      const page = await context.newPage();
      try {
        await openTitle(page);
        await page.getByTestId("title-character").click();
        // Penguin, a DLC tile, may sit on a later page of the grid: page until it is shown.
        const penguin = page.getByTestId("character-page").locator('[data-testid=tile][data-id="penguin"]');
        for (let turn = 0; turn < 4; turn += 1) {
          if (await penguin.click({ timeout: 1_000, trial: true }).then(() => true, () => false)) break;
          await page.getByTestId("page-next").click();
        }
        await penguin.click();
        await page.getByTestId("character-coming-soon").click();
        const sheet = page.getByTestId("coming-soon");
        await expect(sheet).toBeInViewport();
        await expect(sheet.getByTestId("modal-close")).toBeInViewport({ ratio: 1 });
        const where = `${locale} ${viewport.name} coming soon`;
        await expectNothingClipped(page, where);
        await expectTargetsApart(page, where);
        await capture(page, locale, viewport.name, "coming-soon");
      } finally {
        await context.close();
      }
    });

      test(`${locale} on ${viewport.name}: the unlock banner over a first race's results fits`, async ({ browser }) => {
      test.setTimeout(180_000);
      // A fresh profile's first finished race grants Crash Mode.
      const { pages } = await finishRace(browser, { seats: 1, settings: { locale }, ...shapeOf(viewport) });
      const viewer = pages[0]!;
      try {
        const banner = viewer.getByTestId("unlock-banner");
        await expect(banner).toHaveAttribute("data-kind", "song", { timeout: 10_000 });
        const plate = banner.locator(".ff-unlock-banner__plate");
        await expect(plate).toBeInViewport({ ratio: 1 });
        // The headline is held to its plate here, beyond the shared probe's
        // checks: uncut, and inside it.
        const headline = await banner.locator(".ff-unlock-banner__headline").evaluate((el) => {
          const box = el.getBoundingClientRect();
          const plateBox = el.closest(".ff-unlock-banner__plate")!.getBoundingClientRect();
          return {
            cut: el.scrollWidth > el.clientWidth + 1,
            outside: box.left < plateBox.left - 1 || box.right > plateBox.right + 1,
          };
        });
        expect.soft(headline, `${locale} ${viewport.name} unlock banner headline`).toEqual({ cut: false, outside: false });
        await expectNothingClipped(viewer, `${locale} ${viewport.name} unlock banner`);
        await capture(viewer, locale, viewport.name, "unlock-banner");
      } finally {
        for (const page of pages) await page.context().close().catch(() => undefined);
      }
    });

    test(`${locale} on ${viewport.name}: an Infinite race's results, its replay and the replay's end card fit`, async ({ browser }) => {
      test.setTimeout(180_000);
      const { pages } = await finishRace(browser, { modeId: "infinite", settings: { locale }, ...shapeOf(viewport) });
      const viewer = pages[0]!;
      const where = (surface: string) => `${locale} ${viewport.name} ${surface}`;
      try {
        await expect(viewer.locator("html")).toHaveAttribute("lang", locale);
        await expect(viewer.getByTestId("watch-replay")).toBeEnabled({ timeout: 15_000 });
        await expectNothingClipped(viewer, where("infinite results"));
        await expectTargetsApart(viewer, where("infinite results"));
        await capture(viewer, locale, viewport.name, "results-infinite");

        await viewer.getByTestId("watch-replay").click();
        await expectScreen(viewer, "replay");
        await expectNothingClipped(viewer, where("replay"));
        await expectTargetsApart(viewer, where("replay"));
        await capture(viewer, locale, viewport.name, "replay");

        await viewer.getByTestId("replay-progress").focus();
        await viewer.keyboard.press("End");
        await expect(viewer.getByTestId("replay-watch-again")).toBeVisible({ timeout: 15_000 });
        await expectNothingClipped(viewer, where("replay end"));
        await capture(viewer, locale, viewport.name, "replay-end");
      } finally {
        for (const page of pages) await page.context().close().catch(() => undefined);
      }
    });
  }

  test(`${locale} on a phone held sideways: the ready room's action bar stays one row`, async ({ browser }) => {
    test.slow();
    await walkFlow(
      browser,
      { width: 844, height: 390, factor: "phone-landscape", touch: true },
      async (screen, page) => {
        if (screen !== "ready room") return;
        const tops = await page
          .getByTestId("ready-actions")
          .locator("button")
          .evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
        expect(new Set(tops).size, "one row").toBe(1);
        await expectNothingClipped(page, `${locale} phone-landscape ready room`);
        await capture(page, locale, "phone-landscape", "ready-room");
      },
      { settings: { locale } },
    );
  });
}
