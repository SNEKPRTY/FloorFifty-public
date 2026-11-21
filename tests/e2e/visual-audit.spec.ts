import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "./support/test";
import { LOCALE_TAGS, type LocaleTag } from "../../apps/client/src/features/i18n/locales";
import { cornerRect, expectSameCorner, expectScreenContract, type Rect } from "./support/contract";
import { evidenceDir } from "./support/evidence";
import { SWEEP, walkFlow, type FlowScreen, type Sweep } from "./support/layout";
import { expectScreen, openTitle, seedSettings } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";
import { enterStory, noteTouch } from "./support/story";

/**
 * The visual audit (2026-10-05): screen-catalogue's walk at every SWEEP size,
 * in every locale, each state held to the screen contract and photographed
 * to `evidence/visual-audit/<locale>/` (or `evidence/$AUDIT_SET/`). 216
 * tests, about an hour at two workers, so it runs only when asked:
 *
 *   FLOOR_FIFTY_VISUAL_AUDIT=1 FLOOR_FIFTY_E2E_REUSE=1 \
 *     pnpm exec playwright test tests/e2e/visual-audit.spec.ts --project=responsive --workers=2
 *
 * A rerun skips each walk whose shots are already there, so a run broken by
 * load picks up where it stopped. Narrow it with `-g "audit ja "`.
 */
test.skip(process.env["FLOOR_FIFTY_VISUAL_AUDIT"] !== "1", "the visual audit runs only with FLOOR_FIFTY_VISUAL_AUDIT=1");

const OUT = evidenceDir(process.env["AUDIT_SET"] ?? "visual-audit");

/**
 * The state name a flow screen is catalogued under. `visitState` names the PNG
 * from it (`state.replaceAll(" ", "-")`), which keeps today's evidence names.
 */
const STATE: Record<FlowScreen, string> = {
  title: "title",
  menu: "menu",
  "ready room": "ready room",
  select: "stage",
  song: "select song",
  reveal: "roulette",
  race: "race",
  results: "results",
};

/** The shell screens whose corner controls must agree (spec §8.2.5). */
const SHELL: ReadonlySet<string> = new Set(["title", "menu", "ready room", "character", "results"]);

test.beforeAll(async () => {
  await waitForServer();
  mkdirSync(OUT, { recursive: true });
});

const prefix = (sweep: Sweep) => `${sweep.factor}-${sweep.width}x${sweep.height}${sweep.touch ? "" : "-mouse"}-`;
function done(sweep: Sweep, locale: LocaleTag, tutorial: boolean): boolean {
  const dir = resolve(OUT, locale);
  if (!existsSync(dir)) return false;
  const mine = readdirSync(dir).filter((f) => f.startsWith(prefix(sweep)));
  return tutorial ? mine.some((f) => f.endsWith("story-paused.png")) : mine.some((f) => f.endsWith("-replay-end.png"));
}
function shooter(sweep: Sweep, locale: LocaleTag) {
  return async (page: Page, state: string): Promise<void> => {
    mkdirSync(resolve(OUT, locale), { recursive: true });
    await page.screenshot({ path: resolve(OUT, locale, `${sweep.factor}-${sweep.width}x${sweep.height}${sweep.touch ? "" : "-mouse"}-${state}.png`) });
  };
}

/** Holds one state to the contract and photographs it. */
async function visitState(page: Page, sweep: Sweep, locale: LocaleTag, state: string, corners?: Map<string, Rect>): Promise<void> {
  await test.step(state, async () => {
    await expectScreenContract(page, { screen: `${locale} ${sweep.factor} ${sweep.width}x${sweep.height} › ${state}`, touch: sweep.touch });
    if (corners !== undefined && SHELL.has(state)) {
      const rect = await cornerRect(page);
      if (rect !== undefined) corners.set(state, rect);
    }
    await shooter(sweep, locale)(page, state.replaceAll(" ", "-"));
  });
}

/**
 * A modal opened from a button that may itself be out of reach at this size
 * (UI audit B3): an unreachable opener is a soft failure, not the end of the walk.
 */
async function visitModal(page: Page, sweep: Sweep, locale: LocaleTag, opener: string, modal: string, state: string): Promise<void> {
  const opened = await page
    .getByTestId(opener)
    .click({ timeout: 5_000 })
    .then(() => true, () => false);
  expect.soft(opened, `${state}: ${opener} cannot be pressed at ${sweep.width}x${sweep.height}`).toBe(true);
  if (!opened) return;
  await expect(page.getByTestId(modal)).toBeVisible();
  await visitState(page, sweep, locale, state);
  await page.getByTestId(modal).getByTestId("modal-close").click();
  await expect(page.getByTestId(modal)).toBeHidden();
}

for (const locale of LOCALE_TAGS) for (const sweep of SWEEP) {
  const size = `${sweep.width}x${sweep.height}`;

  test(`audit ${locale} ${sweep.factor} ${size}`, async ({ browser }) => {
    test.skip(done(sweep, locale, false), "already shot");
    test.setTimeout(480_000);
    const corners = new Map<string, Rect>();
    await walkFlow(browser, sweep, async (screen, page) => {
      // Off the ground, so the race shows a drawn course and a racer in the air.
      if (screen === "race") await page.waitForTimeout(4000);
      await visitState(page, sweep, locale, STATE[screen], corners);

      if (screen === "title") {
        await visitModal(page, sweep, locale, "title-settings", "settings-modal", "settings");
        await visitModal(page, sweep, locale, "quick-contact", "contact-modal", "contact");
      }
      if (screen === "ready room") {
        await page.getByTestId("seat-change").click();
        await page.getByTestId("character-page").waitFor();
        // The tiles' portraits load on demand.
        await page.waitForFunction(() => [...document.images].every((image) => image.complete));
        await visitState(page, sweep, locale, "character", corners);
        await page.getByTestId("character-back").click();
      }
      if (screen === "race") {
        // The pause overlay; the race runs on underneath it.
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("pause-resume")).toBeVisible();
        await visitState(page, sweep, locale, "pause");
        await page.getByTestId("pause-resume").click();
        await expect(page.getByTestId("pause-resume")).toBeHidden();
      }
      if (screen === "results") {
        await expect(page.getByTestId("watch-replay")).toBeEnabled({ timeout: 15_000 });
        await page.getByTestId("watch-replay").click();
        await expectScreen(page, "replay");
        await page.waitForTimeout(4000);
        await visitState(page, sweep, locale, "replay");
        // Idle: from Task 5 the bar hides after 2.5 s without input.
        await page.waitForTimeout(3000);
        await visitState(page, sweep, locale, "replay idle");
        // To the end card at 2x, as replay.spec.ts watches it.
        await page.keyboard.press("s");
        await expect(page.getByTestId("replay-watch-again")).toBeVisible({ timeout: 90_000 });
        await visitState(page, sweep, locale, "replay end");
      }
    }, { settings: { locale } });
    await test.step("corner controls agree", () => expectSameCorner(corners));
  });

  test(`audit story ${locale} ${sweep.factor} ${size}`, async ({ browser }) => {
    test.skip(done(sweep, locale, true), "already shot");
    test.slow();
    const page = await openStory(browser, sweep, locale);
    try {
      await noteTouch(page, sweep);
      await visitState(page, sweep, locale, "story line");

      await page.keyboard.press("Escape");
      await expect(page.getByTestId("pause-resume")).toBeVisible();
      await visitState(page, sweep, locale, "story paused");
      await page.getByTestId("pause-resume").click();
    } finally {
      await page.context().close();
    }
  });
}

async function openStory(browser: import("@playwright/test").Browser, sweep: Sweep, locale: LocaleTag): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: sweep.width, height: sweep.height },
    hasTouch: sweep.touch,
    isMobile: sweep.touch && sweep.factor !== "desktop",
    reducedMotion: "reduce",
  });
  await seedSettings(context, { locale });
  const page = await context.newPage();
  await openTitle(page);
  await page.evaluate(() => document.fonts.ready);
  await enterStory(page);
  return page;
}
