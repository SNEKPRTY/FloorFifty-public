import { expect, test, type Browser, type Locator, type Page } from "./support/test";
import { expectInsideViewport, expectMinText, expectTextOnPixelGrid, expectUncovered, expectWholeWords, expectWordedButtons, UI_VIEWS } from "./support/fit";
import { chooseMode, createRoom, enterLobby, expectScreen, finishRace, holdClocks, openTitle, passPhotosensitivity, passSelect, pressLockIn, readyOnly, seedSettings } from "./support/room-driver";
import { SERVER_URL } from "./support/server-fixture";
import { serverUpdatingMessage } from "../../packages/shared/src/common/refusals";
import { expectApart, LONG_NAME } from "./support/layout";
import { walkLocale, type View } from "./support/screens-walk";
import type { LocaleTag } from "../../apps/client/src/features/i18n/locales";
import { ROOM_CODE_ALPHABET } from "../../apps/server/src/rooms/room-code";
import { ROOM_CODE_LENGTH } from "../../packages/shared/src/common/schemas";

/**
 * The UI overhaul's fit checks, one `describe` per screen, each over the ten
 * standalone views (spec, "How it gets checked"). The language is the walk's
 * (`SCREENS_LOCALE`, English if unset), so the same spec runs in es-419 and
 * zh-Hans, the languages the overhaul is judged in. Each screen's task adds
 * its own `describe`; a single view runs with `-g "iphone-se-landscape"`.
 */

/** A fresh player on `view`, in the walk's language, as the first screen they meet after the splash. */
async function openOn(browser: Browser, view: View, locale: LocaleTag = walkLocale()): Promise<Page> {
  const context = await browser.newContext(view.options);
  await seedSettings(context, { locale });
  const page = await context.newPage();
  await openTitle(page);
  return page;
}

/** A box once the panel has finished gliding in: the same twice, a beat apart. */
async function settledBox(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  let last = (await locator.boundingBox())!;
  await expect
    .poll(
      async () => {
        const now = (await locator.boundingBox())!;
        const same = now.y === last.y && now.height === last.height;
        last = now;
        return same;
      },
      { intervals: [250], timeout: 10_000 },
    )
    .toBe(true);
  return last;
}

test.describe("title", () => {
  for (const view of UI_VIEWS) {
    test(`fits ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      const screen = page.locator('[data-screen="title"]');
      await expectWholeWords(page, screen);
      await expectUncovered(page, screen);
      await expectInsideViewport(page, screen);
      await expectMinText(page, screen, 12);
      await expectTextOnPixelGrid(screen);
    });

    test(`every corner and bottom-row button has a word on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      await expectWordedButtons(page, page.locator('[data-screen="title"]'));
      // The three utilities of the bottom row, icon and word, never the icon alone.
      for (const id of ["quick-story", "quick-instructions", "quick-contact"]) {
        expect((await page.getByTestId(id).innerText()).trim(), `${id} shows its word`).not.toBe("");
      }
      expect((await page.getByTestId("title-language").innerText()).trim(), "the language button shows its endonym").not.toBe("");
    });

    test(`the tagline is on screen on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      const tagline = page.getByTestId("menu-tagline");
      await expect(tagline).toBeVisible();
      const box = (await tagline.boundingBox())!;
      const { width, height } = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(await page.locator("[data-bottom-bar]").first().getAttribute("data-bottom-bar")).toBe("none");
    });

    test(`the version is clear of the menu on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      await expectApart(page, '[data-testid="title-version"]', ".ff-title__card");
      await expectApart(page, '[data-testid="title-version"]', '[data-testid="title-language"]');
      await expectApart(page, '[data-testid="title-version"]', '[data-testid="corner-mute"]');
      await expectApart(page, '[data-testid="title-version"]', '[data-testid="menu-wordmark"]');
    });

    test(`the version is readable on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      const look = await page.getByTestId("title-version").evaluate((el) => {
        const style = getComputedStyle(el);
        return { color: style.color, fill: style.backgroundColor, size: parseFloat(style.fontSize), opacity: parseFloat(style.opacity) };
      });
      const channels = (css: string): number[] => (css.match(/[\d.]+/g) ?? []).map(Number);
      const light = (rgb: number[]): number => {
        const [r, g, b] = rgb.slice(0, 3).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const text = channels(look.color);
      const fill = channels(look.fill);
      expect(look.opacity, "the version is not faded").toBe(1);
      expect(fill[3] ?? 1, "the version sits on a solid strip, not on the sky").toBe(1);
      expect(look.size).toBeGreaterThanOrEqual(12);
      const [hi, lo] = [light(text), light(fill)].sort((a, b) => b - a);
      expect((hi! + 0.05) / (lo! + 0.05), "the version reads at 4.5:1").toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const view of UI_VIEWS.filter((entry) => entry.key.endsWith("-portrait") && !entry.key.startsWith("ipad"))) {
    test(`the racers are not under the menu on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      const card = await settledBox(page.locator(".ff-title__card"));
      const racers = page.getByTestId("menu-racer-frame");
      expect(await racers.count()).toBe(4);
      for (let place = 0; place < 4; place += 1) {
        const box = await settledBox(racers.nth(place));
        expect(box.y + box.height, `racer ${place} stands above the menu panel`).toBeLessThanOrEqual(card.y + 1);
      }
    });
  }
});

/** The studio's own screen at launch: SNEKPRTY centred on white, then gone by itself. */
test.describe("studio splash", () => {
  for (const view of UI_VIEWS) {
    test(`shows the logo centred on white, then lets the game's splash begin, on ${view.key}`, async ({ browser }) => {
      const context = await browser.newContext(view.options);
      await seedSettings(context, { locale: walkLocale() });
      const page = await context.newPage();
      // Its three seconds run on the page's clock, held while the screen is measured.
      await page.clock.install();
      await page.goto("/");
      const studio = page.getByTestId("studio-splash");
      await expect(studio).toHaveAttribute("data-loaded", "true", { timeout: 60_000 });
      await page.clock.pauseAt(new Date(Date.now() + 1_000));
      const { width, height } = page.viewportSize()!;
      const bounds = (await studio.boundingBox())!;
      expect(bounds, "it covers the whole window").toMatchObject({ x: 0, y: 0, width, height });
      expect(await studio.evaluate((node) => getComputedStyle(node).backgroundColor), "on white").toBe("rgb(255, 255, 255)");
      const logo = studio.locator('img[alt="SNEKPRTY"]');
      await expect(logo).toBeVisible();
      await expect
        .poll(async () => Number(await logo.evaluate((node) => getComputedStyle(node).opacity)), { message: "the logo is drawn, not left invisible", timeout: 3_000 })
        .toBeGreaterThan(0);
      const mark = (await logo.boundingBox())!;
      // Owner, 2026-11-19: at most 220 px, 55% of the width and 40% of the height.
      expect(mark.width, "the logo is a comfortable mark").toBeLessThanOrEqual(220 + 1);
      expect(mark.width, "no more than 55% of the width").toBeLessThanOrEqual(width * 0.55 + 1);
      expect(mark.height, "and no more than 40% of the height").toBeLessThanOrEqual(height * 0.4 + 1);
      expect(mark.width, "and not tiny").toBeGreaterThanOrEqual(120);
      expect(Math.abs(mark.x + mark.width / 2 - width / 2), "centred across").toBeLessThanOrEqual(1);
      expect(Math.abs(mark.y + mark.height / 2 - height / 2), "and down").toBeLessThanOrEqual(1);
      // By itself, three seconds after the logo came: then the language step or the splash.
      await page.clock.runFor(3_500);
      await page.clock.resume();
      await expect(studio).toHaveCount(0, { timeout: 8_000 });
      await passPhotosensitivity(page);
      await expect(page.getByTestId("splash")).toBeVisible({ timeout: 60_000 });
      await context.close();
    });
  }

  test("only the logo fades: the white stays solid, so nothing of the boot shows through", async ({ browser }) => {
    // The browser specs run with reduced motion; this one needs the fade.
    const context = await browser.newContext({ ...UI_VIEWS[0]!.options, reducedMotion: "no-preference" });
    await seedSettings(context, { locale: walkLocale() });
    const page = await context.newPage();
    await page.goto("/");
    const studio = page.getByTestId("studio-splash");
    await expect(studio).toBeVisible({ timeout: 60_000 });
    const seen: { root: string; logo: string }[] = [];
    for (let sample = 0; sample < 8; sample += 1) {
      if ((await studio.count()) === 0) break;
      seen.push(await page.evaluate(() => {
        const root = document.querySelector('[data-testid="studio-splash"]');
        const mark = root?.querySelector("img");
        return { root: root ? getComputedStyle(root).opacity : "gone", logo: mark ? getComputedStyle(mark).opacity : "gone" };
      }));
      await page.waitForTimeout(150);
    }
    expect(seen.length, "sampled while it was up").toBeGreaterThan(3);
    expect(seen.filter((one) => one.root !== "1" && one.root !== "gone"), "the white is solid from first frame to last").toEqual([]);
    expect(Number(seen[0]!.logo), "the logo starts faint").toBeLessThan(1);
    expect(seen.some((one) => one.logo === "1"), `and then holds fully ${JSON.stringify(seen)}`).toBe(true);
    await context.close();
  });

  test("a key press ends it at once, and a reload shows it again", async ({ browser }) => {
    const context = await browser.newContext(UI_VIEWS[0]!.options);
    await seedSettings(context, { locale: walkLocale() });
    const page = await context.newPage();
    await page.goto("/");
    const studio = page.getByTestId("studio-splash");
    await expect(studio).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Space");
    await expect(studio).toHaveCount(0, { timeout: 2_000 });
    await page.reload();
    await expect(studio).toBeVisible({ timeout: 60_000 });
    await context.close();
  });
});

/** The splash: the wordmark, and the start words on a solid strip (spec, "The splash"). */
test.describe("splash", () => {
  for (const view of UI_VIEWS) {
    test(`shows whole start words, 18 px or more, on a solid strip, and no logo, on ${view.key}`, async ({ browser }) => {
      const context = await browser.newContext(view.options);
      await seedSettings(context, { locale: walkLocale() });
      const page = await context.newPage();
      await page.goto("/");
      await passPhotosensitivity(page);
      const ready = page.getByTestId("splash-ready");
      await expect(ready).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
      const splash = page.getByTestId("splash");
      await expect(splash.locator("img")).toHaveCount(0);
      await expectWholeWords(page, splash);
      await expectInsideViewport(page, splash);
      const strip = await ready.evaluate((node) => {
        const style = getComputedStyle(node);
        return { size: Number.parseFloat(style.fontSize), weight: Number.parseInt(style.fontWeight, 10), fill: style.backgroundColor, colour: style.color };
      });
      expect(strip.size).toBeGreaterThanOrEqual(18);
      expect(strip.weight).toBeGreaterThanOrEqual(600);
      expect(strip.colour).toBe("rgb(255, 255, 255)");
      expect(strip.fill, "a solid panel-fill strip").toBe("rgb(46, 34, 47)");
      await context.close();
    });
  }
});

/**
 * A toggle that is on is the filled one (spec, "Toggles"): the chosen radio is
 * drawn white and the others empty, a checkbox that is on is a green switch.
 * Read from the drawn colours, since this is what the player's eye reads.
 */
test.describe("toggles", () => {
  const PANEL_FILL = "rgb(46, 34, 47)"; // #2e222f, Plum Black
  const WHITE = "rgb(255, 255, 255)";
  const GO = "rgb(22, 90, 76)"; // #165a4c, Deep Pine

  async function openSettings(page: Page): Promise<void> {
    await openTitle(page);
    await page.getByTestId("title-settings").click();
    await expect(page.getByTestId("settings-modal")).toBeVisible();
  }
  const fill = (page: Page, testId: string): Promise<string> =>
    page.getByTestId(testId).evaluate((node) => getComputedStyle(node).backgroundColor);

  test("draws the chosen radio filled and the others empty", async ({ page }) => {
    await openSettings(page);
    await page.getByTestId("settings-quality-medium").check({ force: true });
    expect(await fill(page, "settings-quality-medium")).toBe(WHITE);
    expect(await fill(page, "settings-quality-high")).toBe(PANEL_FILL);
    expect(await fill(page, "settings-quality-low")).toBe(PANEL_FILL);
  });

  test("draws a checkbox that is on as a green switch, and off as an empty track", async ({ page }) => {
    await openSettings(page);
    const mute = page.getByTestId("settings-mute");
    if (await mute.isChecked()) await mute.uncheck({ force: true });
    expect(await fill(page, "settings-mute")).toBe(PANEL_FILL);
    await mute.check({ force: true });
    expect(await fill(page, "settings-mute")).toBe(GO);
  });

  test("keeps every toggle's hit area at 44 px", async ({ page }) => {
    await openSettings(page);
    for (const testId of ["settings-mute", "settings-quality-high"]) {
      const row = page.getByTestId(testId).locator("xpath=ancestor::label[1]");
      const box = (await row.boundingBox())!;
      expect(box.height, `${testId}'s row`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${testId}'s row`).toBeGreaterThanOrEqual(44);
    }
  });
});

/**
 * The frame: menus fill the window on iPad sideways and both desktops, with no
 * bar for the tagline to sit in (spec, "Layout by form factor").
 */
test.describe("frame", () => {
  const FRAME_VIEWS = UI_VIEWS.filter((view) => ["ipad-landscape", "desktop-1280x800", "desktop-1440x900"].includes(view.key));

  for (const view of FRAME_VIEWS) {
    test(`the title menu reaches the window's top and bottom quarters on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      const height = page.viewportSize()!.height;
      const frame = (await page.locator("[data-screen-frame]").first().boundingBox())!;
      expect(frame.y, "the frame starts at the window's top").toBeLessThanOrEqual(1);
      expect(frame.y + frame.height, "and ends at its foot").toBeGreaterThanOrEqual(height - 1);
      // The corner buttons are the frame's first row: they sit in the top quarter, not under a bar.
      const corner = (await page.getByTestId("title-language").boundingBox())!;
      expect(corner.y).toBeLessThan(height / 4);
    });

    test(`the settings dialog is centred in the window, not the band on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      await page.getByTestId("title-settings").click();
      const box = (await page.getByTestId("settings-modal").boundingBox())!;
      const { height } = page.viewportSize()!;
      const centre = box.y + box.height / 2;
      expect(Math.abs(centre - height / 2), "the dialog's middle is the window's middle").toBeLessThanOrEqual(height * 0.05);
    });

    test(`the title's tagline is on screen and not in a bar on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      const tagline = page.getByTestId("menu-tagline");
      await expect(tagline).toBeVisible();
      expect(await page.locator("[data-bottom-bar]").first().getAttribute("data-bottom-bar")).toBe("none");
      await expectInsideViewport(page, page.locator('[data-screen="title"]'));
      const box = (await tagline.boundingBox())!;
      const { height } = page.viewportSize()!;
      expect(box.y + box.height, "the tagline is inside the window").toBeLessThanOrEqual(height);
    });
  }
});

/**
 * Dialogs on a phone held sideways, and the SE upright: taller than the
 * screen, they become a sheet with their buttons pinned, so every control is
 * whole and on screen (spec point 3). A first visit, so nothing is seeded.
 */
test.describe("dialogs", () => {
  const DIALOG_VIEWS = UI_VIEWS.filter((view) => (view.key.endsWith("-landscape") && !view.key.startsWith("ipad")) || view.key === "iphone-se-portrait");

  for (const view of DIALOG_VIEWS) {
    test(`the first language step and the photosensitivity warning are whole on ${view.key}`, async ({ browser }) => {
      const context = await browser.newContext(view.options);
      const page = await context.newPage();
      await page.goto("/");

      const language = page.getByTestId("language-first-dialog");
      await expect(language).toBeVisible({ timeout: 20_000 });
      await expectWholeWords(page, language);
      await expectInsideViewport(page, language);
      await expectUncovered(page, language);
      await expect(page.getByTestId("language-first-continue")).toBeInViewport({ ratio: 1 });
      await page.getByTestId("language-first-continue").click();

      const warning = page.getByTestId("photosensitivity-warning");
      await expect(warning).toBeVisible({ timeout: 20_000 });
      await expectInsideViewport(page, warning);
      await expectUncovered(page, warning);
      for (const testId of ["photosensitivity-character-effects", "photosensitivity-stage-effects", "photosensitivity-continue"]) {
        await expect(page.getByTestId(testId), testId).toBeInViewport({ ratio: 1 });
      }
      await context.close();
    });
  }
});

/**
 * The Instructions carousel (story-mode spec, criteria 18 and 20): on every
 * slide the demo, its caption, the dots, Next and Back are all on the screen
 * with nothing scrolled, because the caption is the instruction.
 */
test.describe("instructions", () => {
  for (const view of UI_VIEWS) {
    test(`every slide is whole, with its caption and buttons, on ${view.key}`, async ({ browser }) => {
      const context = await browser.newContext(view.options);
      await seedSettings(context, { locale: walkLocale() });
      const page = await context.newPage();
      await openTitle(page);
      await page.getByTestId("quick-instructions").click();
      const dialog = page.getByTestId("instructions");
      await expect(dialog).toBeVisible();
      for (let slide = 0; slide < 6; slide += 1) {
        await expect(page.getByTestId("instructions-caption"), `slide ${slide + 1} caption`).toBeInViewport({ ratio: 1 });
        for (const id of ["instructions-next", "instructions-back"]) await expect(page.getByTestId(id), `slide ${slide + 1} ${id}`).toBeInViewport({ ratio: 1 });
        await expect(dialog.locator(".ff-pager"), `slide ${slide + 1} dots`).toBeInViewport({ ratio: 1 });
        const demo = page.getByTestId("instructions-frame");
        if ((await demo.count()) > 0) await expect(demo, `slide ${slide + 1} demo`).toBeInViewport({ ratio: 1 });
        await expectWholeWords(page, dialog);
        await expectInsideViewport(page, dialog);
        if (slide < 5) await page.getByTestId("instructions-next").click();
      }
      await context.close();
    });
  }
});

/**
 * Under the shell's zoom (a quarter bigger on a desktop window or an iPad),
 * a sheet fills the window from its top and its Close is on the screen, and a
 * dialog that grows with its contents (the settings) still takes the window's
 * height: a zoomed percentage height once put the rules sheet an eighth of the
 * window below its top (art-acceptance:44), and a fix for it shrank the
 * settings to four fifths of the window.
 */
test.describe("zoomed dialogs", () => {
  const desktop = (width: number, height: number): View => ({ key: `desktop-${width}x${height}`, options: { viewport: { width, height }, deviceScaleFactor: 2 }, host: "standalone", touch: false, phoneLandscape: false });
  const VIEWS: readonly View[] = [
    desktop(1280, 720),
    desktop(1280, 800),
    desktop(1440, 900),
    desktop(985, 624),
    ...UI_VIEWS.filter((view) => view.key === "ipad-portrait"),
  ];

  for (const view of VIEWS) {
    test(`the rules sheet fills the window and its Close is on screen on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      await enterLobby(page);
      await createRoom(page, "Nana");
      await page.getByTestId("ready-rules").click();
      const sheet = page.getByTestId("ready-rules-sheet");
      await expect(sheet).toBeVisible();
      await expectInsideViewport(page, sheet);
      // Zoomed twice (the body, then the dialog): each type step is divided by both, so the words stay whole.
      await expectTextOnPixelGrid(sheet);
      await expect(page.getByTestId("info-sheet-close")).toBeInViewport({ ratio: 1 });
      await page.context().close();
    });
  }

  for (const view of VIEWS.filter((entry) => entry.key === "desktop-1280x720" || entry.key === "desktop-1440x900")) {
    test(`the settings take the window's height on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      await page.getByTestId("title-settings").click();
      const dialog = page.getByTestId("settings-modal");
      await expect(dialog).toBeVisible();
      // The Privacy button at the foot of the list is reached by scrolling; the list's own box, the tabs and the ✕ are still held to the window.
      await expectInsideViewport(page, dialog, { scrolled: true });
      const list = (await page.getByTestId("settings-scroll").boundingBox())!;
      expect(list.y + list.height, "the list's own foot is on screen").toBeLessThanOrEqual(page.viewportSize()!.height + 0.5);
      const height = (await dialog.boundingBox())!.height;
      expect(height, "the settings shrank").toBeGreaterThanOrEqual(0.9 * page.viewportSize()!.height);
      await page.context().close();
    });
  }
});

/**
 * "N more" is a line of its own under a list, never over a row or a button
 * (spec, "The \"+N more\" hint"): settings on the two phones the pill covered
 * most.
 */
test.describe("more", () => {
  const cases = [
    { view: "iphone-se-landscape", opener: "title-settings", dialog: "settings-modal", list: "settings-scroll" },
    { view: "iphone-15-pro-max-landscape", opener: "title-settings", dialog: "settings-modal", list: "settings-scroll" },
  ] as const;

  for (const { view: key, opener, dialog, list } of cases) {
    test(`nothing in ${list} is under the more line on ${key}`, async ({ browser }) => {
      const view = UI_VIEWS.find((candidate) => candidate.key === key)!;
      const page = await openOn(browser, view);
      await page.getByTestId(opener).click();
      await expect(page.getByTestId(dialog)).toBeVisible();
      const scroller = page.getByTestId(list);
      await expectUncovered(page, scroller);
      await expectWholeWords(page, page.getByTestId(dialog));
      // The line is its own: below the list's box, not inside it.
      const more = page.getByTestId("scroll-more");
      if ((await more.count()) > 0) {
        const line = (await more.boundingBox())!;
        const box = (await scroller.boundingBox())!;
        expect(line.y, "the more line starts at the list's foot").toBeGreaterThanOrEqual(box.y + box.height - 8);
      }
    });
  }
});

/**
 * A refusal is one notice at the top, under the corner buttons: it covers no
 * button and no tagline (spec, "Notices and errors"). The share-failed notice
 * needs a whole race and a replay; the screens walk shoots it (screen 41).
 */
/**
 * Review R38: a seat lost in a race lands on the title. Held sideways its
 * notice sits at the foot of the wordmark's column, and it must take nothing
 * from the hero above it: the wordmark stays whole and clear, and the notice
 * reads in a few whole lines, not a word a line.
 */
test.describe("errors: seat lost in a race", () => {
  for (const key of ["iphone-se-landscape", "pixel-7-landscape"]) {
    test(`the title's notice leaves the wordmark whole on ${key}`, async ({ browser }) => {
      const view = UI_VIEWS.find((candidate) => candidate.key === key)!;
      const context = await browser.newContext(view.options);
      await seedSettings(context, { locale: walkLocale() });
      await context.addInitScript(() => {
        const now = Date.now.bind(Date);
        (window as unknown as { __skew: number }).__skew = 0;
        Date.now = () => now() + (window as unknown as { __skew: number }).__skew;
      });
      const page = await context.newPage();
      await openTitle(page);
      await enterLobby(page);
      await createRoom(page, "Nana");
      await page.getByTestId("ready-toggle").click();
      await passSelect([page]);
      await expectScreen(page, "gameplay");
      await context.setOffline(true);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("offline"));
        setTimeout(() => ((window as unknown as { __skew: number }).__skew = 60_000), 500);
      });
      const notice = page.getByTestId("error-view");
      await expect(notice).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("title")).toBeVisible();
      const wordmark = page.locator(".ff-wordmark:visible");
      await expect(wordmark).toHaveCount(1);
      const w = await settledBox(wordmark);
      const n = (await notice.boundingBox())!;
      await page.screenshot({ path: test.info().outputPath("seat-lost-title.png") });
      const viewport = page.viewportSize()!;
      expect(w.y >= 0 && w.y + w.height <= viewport.height, `wordmark ${JSON.stringify(w)} on screen`).toBe(true);
      const apart = n.y + n.height <= w.y + 1 || w.y + w.height <= n.y + 1 || n.x + n.width <= w.x || w.x + w.width <= n.x;
      expect(apart, `notice ${JSON.stringify(n)} against wordmark ${JSON.stringify(w)}`).toBe(true);
      // Whole lines, not a word a line: no taller than half the window. The
      // SE's column is about 170 px beside the menu, so Spanish takes six
      // short lines there; at the old 29% it took seven of one or two words.
      expect(n.height, "notice height").toBeLessThanOrEqual(viewport.height / 2);
      await expectWholeWords(page, notice);
      await expectInsideViewport(page, notice);
      // The tagline it covers goes, rather than a sliver of half-cut words above it.
      await expect(page.getByTestId("menu-tagline")).toBeHidden();
    });
  }
});

test.describe("notices", () => {
  for (const key of ["iphone-se-portrait", "iphone-se-landscape"]) {
    test(`a join failure's notice covers nothing on ${key}`, async ({ browser }) => {
      const view = UI_VIEWS.find((candidate) => candidate.key === key)!;
      const page = await openOn(browser, view);
      await enterLobby(page);
      await page.getByTestId("name-input").fill("Kite");
      await page.getByTestId("code-input").fill("AB");
      await page.getByTestId("code-input").press("Enter");
      const notice = page.getByTestId("menu-status");
      await expect(notice).toBeVisible();
      await expect(notice).toHaveAttribute("data-tone", "problem");
      await expectWholeWords(page, notice);
      await expectInsideViewport(page, notice);
      await expectUncovered(page, page.locator("body"));
      // Under the corner row, not on it.
      const corners = (await page.locator("[data-corner-controls]").boundingBox())!;
      const box = (await notice.boundingBox())!;
      expect(box.y, "below the corner buttons").toBeGreaterThanOrEqual(corners.y + corners.height);
    });
  }
});

/**
 * The ready room (spec, "Ready room"): one column held upright, two columns
 * sideways and on desktop, every word whole, the longest name whole, the room
 * code labelled and inside the panel, Ready green and Leave room red. One
 * player, long-named and the host, makes the widest seat there is.
 */
test.describe("ready room", () => {
  const GREEN = "rgb(22, 90, 76)"; // #165a4c, Deep Pine (--ff-go)
  const RED = "rgb(174, 35, 52)"; // #ae2334, Cranberry (--ff-stop)

  /** The language with the longest text, and the one with the widest script, beside English. */
  const LOCALES: readonly LocaleTag[] = ["en", "es-419", "zh-Hans"];

  async function openRoom(browser: Browser, view: View, locale: LocaleTag): Promise<Page> {
    const page = await openOn(browser, view, locale);
    await enterLobby(page);
    await createRoom(page, LONG_NAME);
    await expect(page.getByTestId("ready-room")).toBeVisible();
    return page;
  }

  // The host picks 20 or 50 floors in the ready room on a phone held sideways (a walk could not).
  for (const view of UI_VIEWS.filter((candidate) => candidate.key.startsWith("iphone-se"))) {
    for (const mode of ["floors-20", "floors-50"]) {
      test(`the ${mode} choice can be pressed on ${view.key}`, async ({ browser }) => {
        test.setTimeout(240_000);
        const page = await openRoom(browser, view, "en");
        // The walk fills the room with CPUs before it picks a mode.
        for (let seats = 1; seats <= 3; seats += 1) {
          await page.getByTestId("seat-add-cpu").first().click();
          await expect(page.getByTestId("seat-remove-cpu")).toHaveCount(seats);
        }
        const choice = page.getByTestId(`mode-${mode}`);
        await expectUncovered(page, choice);
        await chooseMode(page, mode);
        await page.context().close();
      });
    }
  }

  // A common laptop window: the four seats at the desktop's zoom must fit beside
  // the settings, not run under them.
  const LAPTOP: View = { key: "desktop-1280x720", options: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 }, host: "standalone", touch: false, phoneLandscape: false };
  // The host's race options at 1280 x 720 (a laptop once drew them under the seat list):
  // the point at the centre of each button is the button's own.
  test(`the host's mode and clock buttons take the press on ${LAPTOP.key}`, async ({ browser }) => {
    const page = await openRoom(browser, LAPTOP, "en");
    for (const id of ["mode-floors-20", "clock-60"]) {
      const hit = await page.getByTestId(id).evaluate((el) => {
        const box = el.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return top !== null && el.contains(top);
      });
      expect(hit, `${id} is not under anything`).toBe(true);
    }
  });

  for (const locale of LOCALES) {
  for (const view of [...UI_VIEWS, LAPTOP]) {
    test(`the ready room's words are whole and nothing is covered on ${view.key} in ${locale}`, async ({ browser }) => {
      const page = await openRoom(browser, view, locale);
      const room = page.getByTestId("ready-room");
      await expectWholeWords(page, room);
      await expectUncovered(page, room);
      await expectInsideViewport(page, room);
    });

    test(`the player's own name is whole, even the longest, on ${view.key} in ${locale}`, async ({ browser }) => {
      const page = await openRoom(browser, view, locale);
      const name = page.getByTestId("seat-name").first();
      await expect(name).toHaveText(LONG_NAME);
      const cut = await name.locator(".ff-namepill__name").evaluate((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === "ellipsis");
      expect(cut, "the name is not cut").toBe(false);
    });

    test(`the room code is labelled and starts inside the panel on ${view.key} in ${locale}`, async ({ browser }) => {
      const page = await openRoom(browser, view, locale);
      const row = page.locator(".ff-room-code");
      await expect(row.locator(".ff-aq-label")).toBeVisible();
      await expect(row).toContainText(/\S+\s+[A-Z0-9]{4,}/);
      // The room's code is random, and its letters differ in width: the row is
      // measured with the widest code there can be, all of it the alphabet's widest
      // letter (server `room-code.ts`), so a wide code cannot pass by luck.
      await page.getByTestId("room-code").evaluate((code, [alphabet, length]) => {
        const width = (text: string) => {
          code.textContent = text;
          return code.getBoundingClientRect().width;
        };
        const widest = [...alphabet].reduce((best, letter) => (width(letter) > width(best) ? letter : best));
        code.textContent = widest.repeat(length);
      }, [ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH] as const);
      const code = (await page.getByTestId("room-code").boundingBox())!;
      const panel = (await page.locator(".ff-ready__chip").boundingBox())!;
      const label = (await row.locator(".ff-aq-label").boundingBox())!;
      expect(label.x, "the row starts inside the panel's left edge").toBeGreaterThanOrEqual(panel.x);
      expect(code.x + code.width, "and ends inside the panel").toBeLessThanOrEqual(panel.x + panel.width);
      // Copy and Mute share the corner row: neither is cut, covered or off the screen.
      const corners = page.locator("[data-corner-controls]");
      await expectWholeWords(page, corners);
      await expectUncovered(page, corners);
      await expectInsideViewport(page, corners);
    });

    test(`Ready is green and Leave room is red, and both are on screen on ${view.key} in ${locale}`, async ({ browser }) => {
      const page = await openRoom(browser, view, locale);
      for (const [id, colour] of [["ready-toggle", GREEN], ["leave-room", RED]] as const) {
        const button = page.getByTestId(id);
        await expectInsideViewport(page, button);
        await expect(button).toHaveCSS("background-color", colour);
      }
    });

    test(`one layout per form factor: no character card beside the seats on ${view.key} in ${locale}`, async ({ browser }) => {
      const page = await openRoom(browser, view, locale);
      await expect(page.getByTestId("character-showcase")).toHaveCount(0);
      const factor = await page.locator("html").getAttribute("data-form-factor");
      const upright = factor === "phone-portrait" || factor === "tablet-portrait";
      await expect(page.getByTestId("ready-room")).toHaveAttribute("data-arrangement", upright ? "stack" : "split");
      const seats = (await page.getByTestId("seats").boundingBox())!;
      const bar = (await page.getByTestId("ready-actions").boundingBox())!;
      if (upright) expect(bar.y, "Ready and Leave are under the seats").toBeGreaterThanOrEqual(seats.y + seats.height - 1);
      else expect(bar.x, "Ready and Leave are in the right column").toBeGreaterThanOrEqual(seats.x + seats.width - 1);
    });
  }
  }
});

/**
 * Settings: one column upright, two columns sideways and on tablets and
 * desktops, using the window rather than a narrow box in its middle.
 */
test.describe("settings", () => {
  for (const view of UI_VIEWS) {
    for (const tab of ["settings", "controls"] as const) {
      test(`settings, ${tab} tab: words whole, nothing covered, every row reachable on ${view.key}`, async ({ browser }) => {
        const page = await openOn(browser, view);
        await page.getByTestId("title-settings").click();
        const dialog = page.getByTestId("settings-modal");
        await expect(dialog).toBeVisible();
        if (tab === "controls") await page.getByTestId("settings-tab-controls").click();
        await expectWholeWords(page, dialog);
        const scroller = page.getByTestId("settings-scroll");
        await expectUncovered(page, scroller);
        await expectInsideViewport(page, page.getByRole("tablist"));
        // The list scrolls under the tabs: its last row is reached by scrolling, then it is whole on screen.
        await scroller.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
        await expectInsideViewport(page, scroller.locator("[data-row]").last());
      });
    }

    test(`the privacy note is the last thing in Settings, opens over the window, and keeps Tab inside on ${view.key}`, async ({ browser }) => {
      const page = await openOn(browser, view);
      await page.getByTestId("title-settings").click();
      await expect(page.getByTestId("settings-modal")).toBeVisible();
      const scroller = page.getByTestId("settings-scroll");
      await scroller.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
      const button = page.getByTestId("settings-privacy-open");
      // Scrolled to the foot, nothing is below: the "more" line is gone, whatever the screen's zoom.
      await expect(page.getByTestId("scroll-more"), "no 'more' line at the foot of the list").toHaveCount(0);
      // Below every other row, whatever the number of columns.
      const lowest = await scroller.evaluate((node, privacy) => {
        const rows = [...node.querySelectorAll<HTMLElement>("[data-row]")].filter((row) => !row.contains(privacy));
        return Math.max(...rows.map((row) => row.getBoundingClientRect().bottom));
      }, await button.elementHandle());
      expect((await button.boundingBox())!.y, "Privacy sits below every other setting").toBeGreaterThanOrEqual(lowest - 1);
      await expectInsideViewport(page, button);

      await button.click();
      const sheet = page.getByTestId("settings-privacy-open-sheet");
      await expect(sheet).toBeVisible();
      await expectInsideViewport(page, sheet);
      await expect(page.getByTestId("info-sheet-close")).toBeInViewport({ ratio: 1 });
      // Tab goes round the sheet's own controls and never out to Settings behind it.
      for (let press = 0; press < 5; press += 1) {
        await page.keyboard.press("Tab");
        expect(await sheet.evaluate((node) => node.contains(document.activeElement)), `focus stays in the note after Tab ${press + 1}`).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(button).toBeFocused();
    });

    if (["ipad-portrait", "ipad-landscape", "desktop-1280x800", "desktop-1440x900"].includes(view.key)) {
      test(`settings uses the window on ${view.key}`, async ({ browser }) => {
        const page = await openOn(browser, view);
        await page.getByTestId("title-settings").click();
        const box = (await page.getByTestId("settings-modal").boundingBox())!;
        expect(box.width, "the dialog is at least 60% of the window's width").toBeGreaterThanOrEqual(page.viewportSize()!.width * 0.6);
        // iPad upright draws the phone-upright layout (one column); sideways and desktop draw two.
        const columns = await page.locator('[data-testid="settings-scroll"] [role="tabpanel"]').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
        expect(columns, "columns").toBe(view.key === "ipad-portrait" ? 1 : 2);
      });
    }
  }
});

/**
 * A first visit: the language step names every language beside its flag, and
 * both first screens sit on the world, not an empty dark field.
 */
test.describe("first visit", () => {
  for (const view of UI_VIEWS) {
    test(`first language and the warning sit on the world, whole, on ${view.key}`, async ({ browser }) => {
      const context = await browser.newContext(view.options);
      const page = await context.newPage();
      await page.goto("/");

      const language = page.getByTestId("language-first-dialog");
      await expect(language).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => page.evaluate(() => window.__ffBackdrop?.().drawn ?? false), { message: "the menu world is drawn behind the language step" }).toBe(true);
      for (const tag of ["en", "es-419", "pt-BR", "ja", "ko", "zh-Hans"]) {
        const tile = page.getByTestId(`first-language-${tag}`).locator("xpath=ancestor::label");
        expect((await tile.innerText()).trim(), `${tag} is named beside its flag`).not.toBe("");
      }
      await expectWholeWords(page, language);
      await expectInsideViewport(page, language);
      await expectUncovered(page, language);
      await expect(page.getByTestId("language-first-continue")).toBeInViewport({ ratio: 1 });
      await page.getByTestId("language-first-continue").click();

      const warning = page.getByTestId("photosensitivity-warning");
      await expect(warning).toBeVisible({ timeout: 20_000 });
      expect(await page.evaluate(() => window.__ffBackdrop?.().drawn ?? false), "and behind the warning").toBe(true);
      await expectWholeWords(page, warning);
      await expectInsideViewport(page, warning);
      await expectUncovered(page, warning);
      await expect(page.getByTestId("photosensitivity-continue")).toBeInViewport({ ratio: 1 });
      await context.close();
    });
  }
});

/** Contact (named links). */
test.describe("contact", () => {
  for (const view of UI_VIEWS) {
    for (const { opener, dialog } of [
      { opener: "quick-contact", dialog: "contact-modal" },
    ] as const) {
      test(`${dialog}: words whole, nothing covered on ${view.key}`, async ({ browser }) => {
        const page = await openOn(browser, view);
        await page.getByTestId(opener).click();
        const modal = page.getByTestId(dialog);
        await expect(modal).toBeVisible();
        await expectWholeWords(page, modal);
        await expectUncovered(page, modal);
        if (dialog === "contact-modal") await expectInsideViewport(page, modal);
      });
    }
  }
});

/**
 * The lobby on a first visit, and the match gate it raises (story-mode spec, "The first-match gate"):
 * the gate reads in lines of more than one word, Show me how is the one green, Play story is blue, the
 * name and code fields show their whole text, and nothing covers the gate's Skip.
 */
test.describe("lobby", () => {
  const GREEN = "rgb(22, 90, 76)"; // #165a4c, Deep Pine (--ff-go)
  const BLUE = "rgb(77, 101, 180)"; // #4d65b4, Cornflower Blue (--ff-plain)
  const LATIN: readonly LocaleTag[] = ["en", "es-419"];
  const SMALL: View = { key: "desktop-360x640", options: { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 }, host: "standalone", touch: false, phoneLandscape: false };
  const GATE_BUTTONS = ["match-gate-show", "match-gate-story", "match-gate-skip"] as const;

  /** The lobby of a player who has not been shown how. */
  async function openLobby(browser: Browser, view: View, locale: LocaleTag = walkLocale()): Promise<Page> {
    const context = await browser.newContext(view.options);
    await seedSettings(context, { locale, seen: { tutorial: false } });
    const page = await context.newPage();
    await openTitle(page);
    await page.getByTestId("title-play").click();
    await expect(page.locator('[data-screen="lobby"]')).toBeVisible();
    return page;
  }

  /** The lobby with the gate up: Find a race pressed by a player never shown how. */
  async function openGate(browser: Browser, view: View, locale: LocaleTag = walkLocale()): Promise<Page> {
    const page = await openLobby(browser, view, locale);
    await page.getByTestId("name-input").fill("Nana");
    await page.getByTestId("find-race").click();
    await expect(page.getByTestId("match-gate")).toBeVisible();
    return page;
  }

  for (const view of [...UI_VIEWS, SMALL]) {
    test(`the gate's words are whole and nothing is covered on ${view.key}`, async ({ browser }) => {
      const page = await openGate(browser, view);
      const gate = page.getByTestId("match-gate");
      await expectWholeWords(page, gate);
      await expectUncovered(page, gate);
      await expectInsideViewport(page, gate);
      for (const id of GATE_BUTTONS) await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 1 });
    });

    test(`the gate's Show me how is the one green and Play story is blue on ${view.key}`, async ({ browser }) => {
      const page = await openGate(browser, view);
      await expect(page.getByTestId("match-gate-show")).toHaveCSS("background-color", GREEN);
      await expect(page.getByTestId("match-gate-story")).toHaveCSS("background-color", BLUE);
    });

    for (const locale of LATIN) {
      test(`the gate reads in lines of more than one word on ${view.key} in ${locale}`, async ({ browser }) => {
        const page = await openGate(browser, view, locale);
        const lines = await page.locator('[data-testid="match-gate"] p').first().evaluate((p) => {
          const node = p.firstChild!;
          const text = node.textContent ?? "";
          const range = document.createRange();
          const rows: number[] = [];
          const words: number[] = [];
          for (const match of text.matchAll(/\S+/g)) {
            range.setStart(node, match.index ?? 0);
            range.setEnd(node, (match.index ?? 0) + match[0].length);
            const top = Math.round(range.getClientRects()[0]!.top);
            const at = rows.indexOf(top);
            if (at === -1) { rows.push(top); words.push(1); } else words[at]! += 1;
          }
          return words;
        });
        expect(Math.min(...lines), `words on each line: ${lines.join(", ")}`).toBeGreaterThanOrEqual(2);
      });
    }

    test(`the name and code fields show their whole text on ${view.key}`, async ({ browser }) => {
      const page = await openLobby(browser, view);
      for (const id of ["name-input", "code-input"]) {
        const fit = await page.getByTestId(id).evaluate((input: HTMLInputElement) => {
          const style = getComputedStyle(input);
          const probe = document.createElement("canvas").getContext("2d")!;
          probe.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return { room, shown: probe.measureText(input.value || input.placeholder).width, scroll: input.scrollWidth - input.clientWidth };
        });
        expect(fit.shown, `${id}'s text in ${fit.room}px`).toBeLessThanOrEqual(fit.room + 1);
        expect(fit.scroll, `${id} scrolls sideways`).toBeLessThanOrEqual(1);
      }
    });
  }

  test("Skip takes the press on 360 x 640", async ({ browser }) => {
    const page = await openGate(browser, SMALL);
    await page.getByTestId("match-gate-skip").click({ timeout: 5_000 });
    await expect(page.getByTestId("match-gate")).toHaveCount(0);
  });
});

/**
 * Errors (spec, "Notices and errors"). A draining server answers a matchmake
 * request 503 with the words in `error` and the origin-echoing CORS headers the
 * real server sends (a wildcard origin is refused for a request made with
 * credentials, which reads as "unreachable").
 */
test.describe("errors", () => {
  test("a server that is updating says so, not 'check your connection'", async ({ browser }) => {
    const view = UI_VIEWS.find((candidate) => candidate.key === "iphone-se-portrait")!;
    const page = await openOn(browser, view, "en");
    await enterLobby(page);
    await page.context().route((url) => url.href.startsWith(`${SERVER_URL}/matchmake/`), (route) => {
      const cors = {
        "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "*",
      };
      return route.request().method() === "OPTIONS"
        ? route.fulfill({ status: 204, headers: cors })
        : route.fulfill({ status: 503, headers: cors, contentType: "application/json", body: JSON.stringify({ code: 503, error: serverUpdatingMessage() }) });
    });
    await page.getByTestId("name-input").fill("Nana");
    await page.getByTestId("create-room").click();
    const notice = page.getByTestId("menu-status");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(/updating/i);
    await expect(notice).not.toHaveText(/connection/i);
    await expectWholeWords(page, notice);
    await expectInsideViewport(page, notice);
    await expectUncovered(page, page.locator('[data-screen="lobby"]'));
  });
});

test.describe("errors: seat lost", () => {
  for (const key of ["pixel-7-portrait", "iphone-15-pro-max-portrait", "iphone-se-portrait"]) {
    test(`a lost seat's notice is clear of the wordmark on ${key}`, async ({ browser }) => {
      const view = UI_VIEWS.find((candidate) => candidate.key === key)!;
      const context = await browser.newContext(view.options);
      await seedSettings(context, { locale: "en" });
      // The reconnect grace is 30 s of the clock: jump the clock past it instead of waiting it out.
      await context.addInitScript(() => {
        const now = Date.now.bind(Date);
        (window as unknown as { __skew: number }).__skew = 0;
        Date.now = () => now() + (window as unknown as { __skew: number }).__skew;
      });
      const page = await context.newPage();
      await openTitle(page);
      await enterLobby(page);
      await createRoom(page, "Nana");
      await context.setOffline(true);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("offline"));
        setTimeout(() => ((window as unknown as { __skew: number }).__skew = 60_000), 500);
      });
      const notice = page.getByTestId("error-view").or(page.getByTestId("menu-status")).first();
      await expect(notice).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: test.info().outputPath("seat-lost.png") });
      const wordmark = page.locator(".ff-wordmark:visible");
      await expect(wordmark).toHaveCount(1);
      const w = (await wordmark.boundingBox())!;
      const n = (await notice.boundingBox())!;
      const apart = n.y + n.height <= w.y + 1 || w.y + w.height <= n.y + 1 || n.x + n.width <= w.x || w.x + w.width <= n.x;
      expect(apart, `notice ${JSON.stringify(n)} against wordmark ${JSON.stringify(w)}`).toBe(true);
      await expectWholeWords(page, notice);
      await expectInsideViewport(page, notice);
      await expectUncovered(page, page.locator('[data-screen="lobby"]'));
    });
  }
});

/**
 * The seat is lost in a race and the player lands on the title with the
 * notice up: the wordmark is whole and above the menu card, and the building's
 * dark edges are not drawn alone when its art is not there (the network is
 * gone when the title comes back).
 */
test.describe("errors: seat lost on the title", () => {
  for (const key of ["iphone-se-portrait", "pixel-7-portrait"]) {
    test(`the wordmark is clear of the notice and the menu on ${key}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const view = UI_VIEWS.find((candidate) => candidate.key === key)!;
      const context = await browser.newContext(view.options);
      await seedSettings(context, { locale: "es-419" });
      await context.addInitScript(() => {
        const now = Date.now.bind(Date);
        (window as unknown as { __skew: number }).__skew = 0;
        Date.now = () => now() + (window as unknown as { __skew: number }).__skew;
      });
      const page = await context.newPage();
      await openTitle(page);
      await enterLobby(page);
      await createRoom(page, "Nana");
      await page.getByTestId("ready-toggle").click();
      await passSelect([page]);
      await expectScreen(page, "gameplay");
      await context.setOffline(true);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("offline"));
        setTimeout(() => ((window as unknown as { __skew: number }).__skew = 60_000), 500);
      });
      await expect(page.getByTestId("error-view")).toBeVisible({ timeout: 60_000 });
      await expectScreen(page, "title");
      const notice = (await page.getByTestId("error-view").boundingBox())!;
      const wordmark = (await page.getByTestId("menu-wordmark").boundingBox())!;
      const card = (await page.locator(".ff-title__card").boundingBox())!;
      expect(wordmark.y, "the wordmark starts under the notice").toBeGreaterThanOrEqual(notice.y + notice.height - 1);
      expect(wordmark.y + wordmark.height - 12, "and ends above the menu card").toBeLessThanOrEqual(card.y);
      // No art, no edges: the facade's dark return is transparent until its picture has arrived.
      const edges = await page.getByTestId("menu-facade").evaluate((el) => {
        const style = getComputedStyle(el);
        return { art: el.getAttribute("data-art"), left: style.borderLeftColor, right: style.borderRightColor };
      });
      if (edges.art === "loading") {
        expect(edges.right).toBe("rgba(0, 0, 0, 0)");
        expect(edges.left).not.toBe("rgb(46, 34, 47)");
      }
    });
  }
});

/** The lobby in Spanish, the longest of the languages with spaces: no word is broken on the small phone upright. */
test("the lobby's buttons wrap at spaces, not inside words, in es-419 on the small iPhone", async ({ browser }) => {
  const view = UI_VIEWS.find((candidate) => candidate.key === "iphone-se-portrait")!;
  const page = await openOn(browser, view, "es-419");
  await page.getByTestId("title-play").click();
  await expect(page.locator('[data-screen="lobby"]')).toBeVisible();
  await expectWholeWords(page, page.locator('[data-screen="lobby"]'));
  const hyphenated = await page.getByTestId("find-race").evaluate((el) => getComputedStyle(el).hyphens);
  expect(hyphenated).toBe("manual");
});

test.describe("select", () => {
  const LOCALES: readonly LocaleTag[] = ["en", "es-419", "zh-Hans"];

  /** A solo racer on the stage step, the room's clock held so the step stays. */
  async function onStageStep(browser: Browser, view: View, locale: LocaleTag): Promise<Page> {
    const page = await openOn(browser, view, locale);
    await enterLobby(page);
    await createRoom(page, "Kite");
    await holdClocks(page, ["stage"]);
    await readyOnly([page]);
    await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 30_000 });
    return page;
  }

  for (const locale of LOCALES) {
    for (const view of UI_VIEWS) {
      test(`select: words whole (no Con-firmar), the picture fills its column, the arrows inside it and the middle clear on ${view.key} in ${locale}`, async ({ browser }) => {
        const page = await onStageStep(browser, view, locale);
        const screen = page.getByTestId("select-screen");
        await expectWholeWords(page, screen);
        await expectInsideViewport(page, screen);
        await expect(page.getByTestId("select-heading")).toBeVisible();
        const boxes = await page.evaluate(() => {
          const rect = (id: string) => document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
          const picker = rect("picker");
          const scene = document.querySelector(".ff-frame__scene")!.getBoundingClientRect();
          const slide = rect("stage-slide");
          const arrows = ["picker-previous", "picker-next"].map((id) => rect(id));
          return { picker, scene, slide, arrows };
        });
        // The picture is the scene's whole column, and the arrows leave at least half of it clear between them.
        expect(boxes.slide.width, "the picture fills its scene column").toBeGreaterThanOrEqual(boxes.scene.width - 1);
        const [previous, next] = boxes.arrows as [DOMRect, DOMRect];
        expect(next.left - previous.right, "the middle of the picture is clear of the arrows").toBeGreaterThanOrEqual(boxes.slide.width / 2);
        for (const arrow of boxes.arrows) {
          expect(arrow.left, "an arrow is inside the picture's left edge").toBeGreaterThanOrEqual(boxes.slide.left - 0.5);
          expect(arrow.right, "an arrow is inside the picture's right edge").toBeLessThanOrEqual(boxes.slide.right + 0.5);
          expect(arrow.top).toBeGreaterThanOrEqual(boxes.slide.top - 0.5);
          expect(arrow.bottom).toBeLessThanOrEqual(boxes.slide.bottom + 0.5);
        }
      });
    }
  }

  test("the song card's name is on one line on the SE sideways", async ({ browser }) => {
    const view = UI_VIEWS.find((candidate) => candidate.key === "iphone-se-landscape")!;
    const page = await onStageStep(browser, view, "en");
    await holdClocks(page, ["stage", "song"]);
    await pressLockIn(page);
    await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "song", { timeout: 30_000 });
    await expect(page.getByTestId("select-headline")).toHaveText("Moving On");
    const lines = await page.getByTestId("select-headline").evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
    });
    expect(lines, "one line box").toBe(1);
    await expect(page.getByTestId("select-heading")).toHaveText("Pick a song");
  });
});

/**
 * The corner row (Back, the language, Mute) keeps every button inside its own
 * row, and so inside the screen's gutter, on the narrowest phone in every
 * language: one-line "Volver" once pushed "Silenciar" past the row's edge, 5 px
 * from the screen's.
 */
test.describe("the corner row", () => {
  const OPENERS = [
    { name: "lobby", open: async (page: Page) => { await page.getByTestId("title-play").click(); await expect(page.locator('[data-screen="lobby"]')).toBeVisible(); } },
    { name: "character page", open: async (page: Page) => { await page.getByTestId("title-character").click(); await expect(page.getByTestId("character-page")).toBeVisible(); } },
  ] as const;
  for (const locale of ["en", "es-419", "pt-BR", "ja", "ko", "zh-Hans"] as const satisfies readonly LocaleTag[]) {
    for (const { name, open } of OPENERS) {
      test(`corner buttons stay inside their row on the ${name} on the small iPhone in ${locale}`, async ({ browser }) => {
        const view = UI_VIEWS.find((candidate) => candidate.key === "iphone-se-portrait")!;
        const page = await openOn(browser, view, locale);
        await open(page);
        const faults = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>("[data-corner-controls]")].filter((row) => row.getClientRects().length > 0);
          return rows.flatMap((row) => {
            const frame = row.getBoundingClientRect();
            return [...row.querySelectorAll<HTMLElement>("button")]
              .filter((button) => button.getClientRects().length > 0)
              .flatMap((button) => {
                const box = button.getBoundingClientRect();
                const name = button.getAttribute("data-testid") ?? button.textContent?.trim() ?? "button";
                return box.right > frame.right + 0.5 || box.left < frame.left - 0.5 || box.right > window.innerWidth - 12 + 0.5
                  ? [`${name}: ${Math.round(box.left)} to ${Math.round(box.right)} against the row ${Math.round(frame.left)} to ${Math.round(frame.right)} (window ${window.innerWidth})`]
                  : [];
              });
          });
        });
        expect(faults, `a corner button left its row:\n  ${faults.join("\n  ")}`).toEqual([]);
      });
    }
  }
});

test.describe("character", () => {
  for (const locale of ["en", "es-419", "zh-Hans"] as const satisfies readonly LocaleTag[]) {
    for (const view of UI_VIEWS) {
      test(`character: the first open tile whole, several tiles to a page on the SE upright, words whole on ${view.key} in ${locale}`, async ({ browser }) => {
        const page = await openOn(browser, view, locale);
        await enterLobby(page);
        await createRoom(page, "Kite");
        await page.getByTestId("seat-change").click();
        const character = page.getByTestId("character-page");
        await expect(character).toBeVisible();
        await expectWholeWords(page, character);
        // The grid may page, so its far pages sit outside the window by design: the name, the colours and the tile in hand do not.
        for (const id of ["character-preview-name", "colour-row"]) await expectInsideViewport(page, character.getByTestId(id));
        const own = character.locator("[data-testid=tile][data-state=open]").first();
        await expectInsideViewport(page, own);
        if (view.key === "iphone-se-portrait") {
          const shown = await character.locator("[data-testid=tile]").evaluateAll((nodes) =>
            nodes.filter((node) => node.closest("[inert]") === null).length,
          );
          expect(shown, "more than one character on the page, not a strip of one").toBeGreaterThanOrEqual(2);
        }
      });
    }
  }
});

/**
 * Results (spec, "Results"): one list on every view, three whole labels, no
 * seed, the longest name whole. The host's name is the longest there is.
 */
test.describe("results", () => {
  const VIEWS = ["iphone-se-landscape", "iphone-se-portrait", "ipad-portrait", "desktop-1280x800"] as const;
  for (const key of VIEWS) {
    test(`results: every row on screen, words whole, the longest name whole on ${key}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const view = UI_VIEWS.find((candidate) => candidate.key === key)!;
      const { pages } = await finishRace(browser, { hostName: LONG_NAME, seats: 4, context: view.options, settings: { locale: walkLocale() } });
      const page = pages[0]!;
      const list = page.getByTestId("results-list");
      await expect(list).toBeVisible();
      await expectWholeWords(page, page.getByTestId("game-end"));
      await expectUncovered(page, page.getByTestId("game-end"));
      await expect(page.getByTestId("results-seed")).toHaveCount(0);
      // The winner line is drawn, not hidden behind the list.
      await expectUncovered(page, page.getByTestId("winner"));
      await expect(page.getByTestId("result-name").first()).toContainText(LONG_NAME);
      for (const id of ["race-again", "watch-replay", "return-to-menu"]) await expectInsideViewport(page, page.getByTestId(id));
      // The last button stays inside the panel that holds it.
      const panel = (await page.locator(".ff-results__panel").boundingBox())!;
      const last = (await page.getByTestId("return-to-menu").boundingBox())!;
      expect(last.y + last.height, "the last button is inside the panel").toBeLessThanOrEqual(panel.y + panel.height + 0.5);
      // One list: no row is drawn as a podium card.
      const rows = await page.getByTestId("result-row").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
      expect(new Set(rows.map(Math.round)).size, "every row is as wide as the others").toBe(1);
    });
  }
});

/** The replay (spec, "Replay"): nothing covered, Save and Share as icons alone. */
test.describe("replay", () => {
  for (const key of ["iphone-se-landscape", "iphone-se-portrait", "ipad-portrait"] as const) {
    test(`replay: nothing covered, Save video and Share video are icons alone on ${key}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const view = UI_VIEWS.find((candidate) => candidate.key === key)!;
      const { pages } = await finishRace(browser, { context: view.options, settings: { locale: walkLocale() } });
      const page = pages[0]!;
      await expect(page.getByTestId("watch-replay")).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId("watch-replay").click();
      await expect(page.getByTestId("replay-controls")).toBeVisible();
      for (const id of ["replay-save-video", "replay-share-video"]) {
        const button = page.getByTestId(id);
        await expect(button).toBeVisible();
        // Icons alone (Owner, 2026-11-19): the name is the label, never visible text.
        expect(((await button.textContent()) ?? "").trim(), `${id} shows no words`).toBe("");
        expect(await button.getAttribute("aria-label"), `${id} is named`).toBeTruthy();
        await expectInsideViewport(page, button);
      }
      // The followed racer's name is the one text the bar may cut (`data-truncatable`), so the check is on the buttons Task 27 owns.
      await expectWholeWords(page, page.getByTestId("replay-video"));
      // Each button takes a press: nothing lies over it.
      for (const id of ["replay-save-video", "replay-share-video"]) await expectUncovered(page, page.getByTestId(id));
      // A share's answer sits clear of the buttons it came from, and of the bar.
      await page.getByTestId("replay-share-video").click();
      const answer = page.getByTestId("replay-share-note").or(page.getByTestId("replay-share-status").filter({ hasText: /\S/ })).first();
      // A browser that cannot share may say nothing; when it does speak, it covers no button.
      if (await answer.waitFor({ timeout: 5_000 }).then(() => true, () => false)) {
        for (const id of ["replay-save-video", "replay-share-video"]) await expectUncovered(page, page.getByTestId(id));
        await expectInsideViewport(page, answer);
      }
    });
  }
});

type Box = { left: number; top: number; right: number; bottom: number };

/** A solo racer in a race of `mode` on `view`, as a player is when the HUD first shows. */
async function intoRace(
  browser: Browser,
  view: View,
  locale: LocaleTag,
  options: { mode?: string; name?: string; cpus?: number } = {},
): Promise<Page> {
  const context = await browser.newContext(view.options);
  await seedSettings(context, { locale });
  const page = await context.newPage();
  await openTitle(page);
  await enterLobby(page);
  await createRoom(page, options.name ?? "Nana");
  if (options.mode !== undefined) await chooseMode(page, options.mode);
  for (let added = 1; added <= (options.cpus ?? 0); added += 1) {
    await page.getByTestId("seat-add-cpu").first().click();
    await expect(page.getByTestId("seat-status").filter({ hasText: /^CPU$/ })).toHaveCount(added);
  }
  await page.getByTestId("ready-toggle").click();
  await passSelect([page]);
  await expectScreen(page, "gameplay");
  await expect(page.getByTestId("race-hud")).toBeVisible();
  return page;
}

/** What each element in `selector` covers now, by its test id or class, in viewport pixels. */
const boxesOf = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((nodes) =>
    nodes
      .map((node) => ({ name: node.getAttribute("data-testid") ?? node.className.toString(), rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .map(({ name, rect }) => ({ name, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })),
  );

const overlaps = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const SE_BOTH_WAYS = UI_VIEWS.filter((view) => view.key.startsWith("iphone-se"));

test.describe("hud", () => {
  for (const locale of ["es-419", "zh-Hans"] as const) {
    for (const view of SE_BOTH_WAYS) {
      test(`every chip on one line and whole on ${view.key} in ${locale}`, async ({ browser }) => {
        test.setTimeout(240_000);
        const page = await intoRace(browser, view, locale, { mode: "floors-20" });
        const hud = page.getByTestId("race-hud");
        await expectWholeWords(page, hud);
        await expectMinText(page, hud, 12);
        const squeezed = await page.locator('[data-testid="race-hud"] .ff-hud__chip').evaluateAll((chips) =>
          chips
            .filter((chip) => chip.scrollWidth > chip.clientWidth + 1 || [...chip.querySelectorAll("span")].some(
              (value) => value.getBoundingClientRect().height > parseFloat(getComputedStyle(value).fontSize) * 1.8,
            ))
            .map((chip) => (chip.textContent ?? "").trim()),
        );
        expect(squeezed, "chips squeezed").toEqual([]);
        // No chip lies on another.
        const chips = await boxesOf(page, '[data-testid="race-hud"] .ff-hud__chip, [data-testid="pause-open"]');
        for (const [index, chip] of chips.entries())
          for (const other of chips.slice(index + 1)) expect(overlaps(chip, other), `${chip.name} over ${other.name}`).toBe(false);
      });
    }
  }
});

/** The HUD's type, on the pixel face's 12 px grid. */
test.describe("hud type", () => {
  // The pixel face draws only on 12 px steps (expectTextOnPixelGrid): label and value at 12, the floors numeral at 24.
  const SIZES = [
    // Upright on a 320 px phone the three equal tiles are under 100 px wide, so their numbers drop to the label size together.
    { keys: ["iphone-se-portrait"], label: 12, value: 12, hero: 12 },
    // Wider upright phones fit the 24 px numbers: "50 / 50" needs 84 px of a tile (measured on Pixel 7: 84 of 89).
    { keys: ["pixel-7-portrait", "iphone-15-pro-max-portrait"], label: 12, value: 12, hero: 24 },
    { keys: ["iphone-se-landscape"], label: 12, value: 12, hero: 24 },
    // The race HUD is outside the shell's zoom, so a big screen takes the grid's next step for Floors.
    { keys: ["ipad-portrait", "desktop-1280x800"], label: 12, value: 12, hero: 36 },
  ] as const;
  for (const { keys, label, value, hero } of SIZES) {
    for (const key of keys) {
      test(`the HUD's label, value and hero are ${label}, ${value} and ${hero} px on ${key}`, async ({ browser }) => {
        test.setTimeout(240_000);
        const view = UI_VIEWS.find((candidate) => candidate.key === key)!;
        const page = await intoRace(browser, view, "en", { mode: "floors-20" });
        const sizes = await page.evaluate(() => {
          const px = (selector: string) => {
            const node = document.querySelector(`[data-testid="race-hud"] ${selector}`);
            return node === null ? undefined : parseFloat(getComputedStyle(node).fontSize);
          };
          return {
            label: px(".ff-hud__label"),
            hero: px(".ff-hud__value--large:not(.ff-hud__value--timer)"),
            value: px(".ff-hud__value:not(.ff-hud__value--large)"),
          };
        });
        expect(sizes.label, "a chip's label").toBe(label);
        expect(sizes.hero, "the hero number").toBe(hero);
        if (sizes.value !== undefined) expect(sizes.value, "a chip's value").toBe(value);
        const viewport = view.options.viewport!;
        // The chips hold their numbers on one line, apart and on screen, at rest and
        // with the clock in its urgent size (Infinite's last ten seconds, 0:09.9).
        const expectChipsFit = async (when: string) => {
          const squeezed = await page.locator('[data-testid="race-hud"] .ff-hud__chip').evaluateAll((chips) =>
            chips
              .filter((chip) => chip.scrollWidth > chip.clientWidth + 1 || [...chip.querySelectorAll("span")].some(
                (node) => node.getBoundingClientRect().height > parseFloat(getComputedStyle(node).fontSize) * 1.8,
              ))
              .map((chip) => (chip.textContent ?? "").trim()),
          );
          expect(squeezed, `chips squeezed ${when}`).toEqual([]);
          const chips = await boxesOf(page, '[data-testid="race-hud"] .ff-hud__chip, [data-testid="pause-open"]');
          for (const [index, chip] of chips.entries())
            for (const other of chips.slice(index + 1)) expect(overlaps(chip, other), `${chip.name} over ${other.name} ${when}`).toBe(false);
          for (const chip of chips) {
            expect(chip.right, `${chip.name} ends on screen ${when}`).toBeLessThanOrEqual(viewport.width);
            expect(chip.left, `${chip.name} starts on screen ${when}`).toBeGreaterThanOrEqual(0);
          }
        };
        await expectChipsFit("at rest");
        const clockSizes = await page.evaluate(() => {
          const clock = document.querySelector<HTMLElement>('[data-testid="hud-timer"], [data-testid="hud-clock"]')!;
          const rest = parseFloat(getComputedStyle(clock).fontSize);
          clock.classList.add("ff-hud__value--urgent");
          clock.textContent = "0:09.9";
          return { rest, urgent: parseFloat(getComputedStyle(clock).fontSize) };
        });
        // On a wide upright phone the clock already rests at 24 and the next grid step (36 px, about 96 px of
        // digits) does not fit an 89 px tile, so there the urgent clock holds 24 (reported on #217).
        const holdsTheStep = key === "pixel-7-portrait" || key === "iphone-15-pro-max-portrait";
        if (holdsTheStep) expect(clockSizes.urgent, "the urgent clock is no smaller").toBeGreaterThanOrEqual(clockSizes.rest);
        else expect(clockSizes.urgent, "the urgent clock is larger").toBeGreaterThan(clockSizes.rest);
        await expectChipsFit("with the urgent clock");
      });
    }
  }
});

/** Floors, Time and Lap are one width, with one gap between every tile and the menu (Owner, 2026-11-18 22:22Z: "equal spacing, just shrink it to fit"). */
test.describe("hud even", () => {
  for (const [key, locale] of [["iphone-se-portrait", "es-419"], ["iphone-se-portrait", "en"], ["pixel-7-portrait", "en"], ["iphone-15-pro-max-portrait", "en"], ["ipad-portrait", "en"]] as const) {
    test(`Floors, Time and Lap are one width on ${key} in ${locale}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const view = UI_VIEWS.find((candidate) => candidate.key === key)!;
      const page = await intoRace(browser, view, locale, { mode: "floors-20" });
      const boxes = await boxesOf(page, '[data-testid="hud-floors"], [data-testid="hud-restart"], [data-testid="hud-lap"], [data-testid="pause-open"]');
      const tile = (name: string): Box => {
        const box = boxes.find((candidate) => candidate.name === name);
        if (box === undefined) throw new Error(`${name} is not drawn`);
        return box;
      };
      const [floors, time, lap, menu] = [tile("hud-floors"), tile("hud-restart"), tile("hud-lap"), tile("pause-open")];
      const width = (box: Box) => box.right - box.left;
      expect(Math.abs(width(floors) - width(time)), "Floors and Time widths").toBeLessThanOrEqual(1);
      expect(Math.abs(width(time) - width(lap)), "Time and Lap widths").toBeLessThanOrEqual(1);
      const gaps = [time.left - floors.right, lap.left - time.right, menu.left - lap.right];
      expect(Math.max(...gaps) - Math.min(...gaps), `the gaps ${gaps.map((gap) => Math.round(gap * 10) / 10).join(", ")}`).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("hud standings", () => {
  for (const view of SE_BOTH_WAYS) {
    test(`the longest name is whole in the standings on ${view.key}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const page = await intoRace(browser, view, "en", { mode: "floors-20", name: LONG_NAME, cpus: 1 });
      const standings = page.locator('[data-testid="hud-standings-line"], [data-testid="hud-standings-pill"], [data-testid="hud-roster"]');
      await expect(standings.first()).toBeVisible();
      // Whatever form the standings take here, the line, the pill or the rows sit inside the screen and cut nothing.
      for (const box of await boxesOf(page, '[data-testid="hud-standings-line"], [data-testid="hud-standings-pill"], [data-testid="hud-roster"]')) {
        expect(box.left, `${box.name} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${box.name} ends on screen`).toBeLessThanOrEqual(view.options.viewport!.width);
      }
      const cut = await page.locator('[data-testid="hud-standings-line"], [data-testid="hud-standings-pill"], [data-testid="hud-row"] .ff-hud__name').evaluateAll((nodes) =>
        nodes.filter((node) => node.scrollWidth > node.clientWidth + 1 || getComputedStyle(node).textOverflow === "ellipsis").map((node) => (node.textContent ?? "").trim()),
      );
      expect(cut, "names cut").toEqual([]);
      const rows = await page.getByTestId("hud-row").locator(".ff-hud__name").allTextContents();
      if (rows.length > 0) expect(rows.join(" ")).toContain(LONG_NAME);
    });
  }
});

test.describe("race overlays", () => {
  const START_VIEWS = UI_VIEWS.filter((view) => ["iphone-se-landscape", "ipad-portrait", "ipad-landscape"].includes(view.key));

  for (const view of START_VIEWS) {
    test(`the start prompt is clear of the coach on ${view.key}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const page = await intoRace(browser, view, "es-419", { mode: "infinite" });
      await expect(page.getByTestId("swipe-coach")).toBeVisible();
      await expect(page.getByTestId("start-prompt")).toBeVisible();
      const [coach] = await boxesOf(page, '[data-testid="swipe-coach"]');
      const [prompt] = await boxesOf(page, '[data-testid="start-prompt"]');
      expect(overlaps(coach!, prompt!), "the start prompt lies over the coach").toBe(false);
    });
  }

  /** The local racer and its nameplate, once the scene has drawn it. */
  const racerBox = async (page: Page): Promise<Box> => {
    let box: Box | undefined;
    await expect
      .poll(async () => (box = await page.evaluate(() => window.__ffRacer?.().local)), { message: "the racer is drawn", timeout: 20_000 })
      .toBeDefined();
    return box!;
  };

  for (const view of SE_BOTH_WAYS) {
    test(`reconnecting covers no chip and no coach on ${view.key}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const page = await intoRace(browser, view, "es-419", { mode: "floors-20" });
      await expect(page.getByTestId("swipe-coach")).toBeVisible();
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(page.getByTestId("connection-state")).toBeVisible({ timeout: 30_000 });
      const [notice] = await boxesOf(page, '[data-testid="connection-state"]');
      const under = await boxesOf(page, '[data-testid="race-hud"] .ff-hud__chip, [data-testid="pause-open"], [data-testid="swipe-coach"]');
      expect(under.length, "chips and the coach are in view").toBeGreaterThan(2);
      for (const other of under) expect(overlaps(notice!, other), `the notice lies over ${other.name}`).toBe(false);
    });

    // Two lines in English. Spanish and Portuguese say the same three things
    // whole ("down", "to restart") in about a third more letters, which takes a
    // third line on the narrowest phone: meaning beats the line count.
    for (const [locale, maxLines] of [["en", 2], ["es-419", 3], ["pt-BR", 3]] as const) {
      test(`the swipe coach is at most ${maxLines} lines and clear of the racer on ${view.key} in ${locale}`, async ({ browser }) => {
        test.setTimeout(240_000);
        const page = await intoRace(browser, view, locale, { mode: "floors-20" });
        await expect(page.getByTestId("swipe-coach")).toBeVisible();
        const lines = await page.locator('[data-testid="swipe-coach"] p').evaluate((node) => {
          const style = getComputedStyle(node);
          return Math.round(node.getBoundingClientRect().height / parseFloat(style.lineHeight));
        });
        expect(lines, "the coach's lines").toBeLessThanOrEqual(maxLines);
        const racer = await racerBox(page);
        // The coach finds its place a frame after the racer is first drawn.
        await expect
          .poll(async () => overlaps((await boxesOf(page, '[data-testid="swipe-coach"]'))[0]!, racer), {
            message: `the coach lies over the racer ${JSON.stringify(racer)}`,
          })
          .toBe(false);
      });
    }

    test(`the countdown is clear of the player's nameplate on ${view.key}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext(view.options);
      await seedSettings(context, { locale: "es-419" });
      const page = await context.newPage();
      await openTitle(page);
      await enterLobby(page);
      await createRoom(page, "Nana");
      await chooseMode(page, "floors-20");
      await page.getByTestId("ready-toggle").click();
      await passSelect([page]);
      await expect(page.getByTestId("race-count")).toBeVisible({ timeout: 30_000 });
      const racer = await racerBox(page);
      const digit = await page.getByTestId("race-count").evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
      expect(overlaps(digit, racer), `the digit ${JSON.stringify(digit)} lies over the racer ${JSON.stringify(racer)}`).toBe(false);
      // The coach drops under the racer on a phone sideways: the digit keeps clear of it too.
      for (const coach of await boxesOf(page, '[data-testid="swipe-coach"]')) {
        expect(overlaps(digit, coach), `the digit ${JSON.stringify(digit)} lies under the coach ${JSON.stringify(coach)}`).toBe(false);
      }
    });
  }
});

/** The story, entered from the title. */
async function intoStory(browser: Browser, view: View, locale: LocaleTag): Promise<Page> {
  const context = await browser.newContext(view.options);
  await seedSettings(context, { locale });
  const page = await context.newPage();
  await openTitle(page);
  await page.getByTestId("quick-story").click();
  await expectScreen(page, "story");
  await page.getByTestId("story-play").click({ timeout: 30_000 });
  await page.getByTestId("story-cutscene-skip").click({ timeout: 30_000 });
  await expect(page.getByTestId("story-line").or(page.getByTestId("story-chip")).first()).toBeVisible();
  const coach = page.getByTestId("swipe-coach-dismiss");
  if (await coach.isVisible().catch(() => false)) await coach.click();
  return page;
}

test.describe("pause", () => {
  const PAUSE_VIEWS = UI_VIEWS.filter((view) => ["iphone-se-portrait", "iphone-se-landscape", "desktop-1280x800"].includes(view.key));

  for (const view of PAUSE_VIEWS) {
    test(`pause and story: words whole, nothing covered on ${view.key}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const race = await intoRace(browser, view, "es-419", { mode: "floors-20" });
      await race.getByTestId("pause-open").click();
      const overlay = race.getByTestId("pause-overlay");
      await expect(overlay).toBeVisible();
      await expectWholeWords(race, overlay);
      await expectUncovered(race, overlay);
      await expectInsideViewport(race, overlay);
      await expectMinText(race, overlay, 12);

      const story = await intoStory(browser, view, "es-419");
      await story.keyboard.press("Escape");
      const paused = story.getByTestId("pause-overlay");
      await expect(paused).toBeVisible();
      await expect(story.getByTestId("story-line").or(story.getByTestId("story-chip")), "the words are not drawn under the pause panel").toHaveCount(0);
      await expectWholeWords(story, paused);
      await expectUncovered(story, paused);
      await expectInsideViewport(story, paused);
      // Start again and Leave stand apart from the menu, under a line.
      const group = (await story.getByTestId("pause-exit-group").boundingBox())!;
      const resume = (await story.getByTestId("pause-resume").boundingBox())!;
      expect(group.y, "the exit group is below the menu").toBeGreaterThan(resume.y + resume.height);
    });
  }

  test("the story words read in lines of more than one word on the iphone-se-portrait", async ({ browser }) => {
    test.setTimeout(240_000);
    const view = UI_VIEWS.find((candidate) => candidate.key === "iphone-se-portrait")!;
    const page = await intoStory(browser, view, "es-419");
    const lines = await page.getByTestId("story-line").or(page.getByTestId("story-chip")).first().evaluate((node) => {
      const words: number[] = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
        const value = text.textContent ?? "";
        for (const match of value.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(text, match.index!);
          range.setEnd(text, match.index! + match[0].length);
          words.push(Math.round(range.getBoundingClientRect().top));
        }
      }
      const perLine = new Map<number, number>();
      for (const top of words) perLine.set(top, (perLine.get(top) ?? 0) + 1);
      return [...perLine.values()];
    });
    expect(lines.length, "the words' lines").toBeLessThanOrEqual(4);
    expect(Math.min(...lines), "a line holds a single word").toBeGreaterThan(1);
  });
});
