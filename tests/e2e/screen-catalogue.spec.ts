import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "./support/test";
import { cornerRect, expectSameCorner, expectScreenContract, type Rect } from "./support/contract";
import { evidenceDir } from "./support/evidence";
import { SWEEP, walkFlow, type FlowScreen, type Sweep } from "./support/layout";
import { expectScreen } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";
import { noteTouch, openTutorial } from "./support/tutorial";

/**
 * The screen catalogue (UI layout system spec §8.1): every screen and every
 * state it can be in, at every reference viewport, each held to the screen
 * contract (§8.2). The primary size per form factor also writes
 * `evidence/responsive/<form factor>-<state>.png` (support/evidence.ts;
 * `tools/promote-evidence responsive` copies approved shots into
 * `docs/art/screenshots/`). This spec replaces `responsive-evidence.spec.ts`,
 * whose shots it keeps by name.
 *
 * A new screen joins by being visited here, and inherits every check.
 * Getting from one state to the next stays hard (a flow that cannot reach
 * Results has nothing to report); the checks themselves are soft.
 *
 * Not visited: the error panel. Nothing in the e2e rig can raise it today.
 */

const OUT = evidenceDir("responsive");

/** Sizes that write evidence, named by form factor (and 900x600 as `desktop-short`). */
const SHOTS: Record<string, string> = {
  "390x844": "phone-portrait",
  "844x390": "phone-landscape",
  "1280x720": "desktop",
  "900x600": "desktop-short",
  "820x1180": "tablet-portrait",
};

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

function shooter(sweep: Sweep) {
  const name = SHOTS[`${sweep.width}x${sweep.height}`];
  return async (page: Page, state: string): Promise<void> => {
    if (name !== undefined) await page.screenshot({ path: resolve(OUT, `${name}-${state}.png`) });
  };
}

/** Holds one state to the contract and photographs it. */
async function visitState(page: Page, sweep: Sweep, state: string, corners?: Map<string, Rect>): Promise<void> {
  await test.step(state, async () => {
    await expectScreenContract(page, { screen: `${sweep.factor} ${sweep.width}x${sweep.height} › ${state}`, touch: sweep.touch });
    if (corners !== undefined && SHELL.has(state)) {
      const rect = await cornerRect(page);
      if (rect !== undefined) corners.set(state, rect);
    }
    await shooter(sweep)(page, state.replaceAll(" ", "-"));
  });
}

/**
 * A modal opened from a button that may itself be out of reach at this size
 * (UI audit B3): an unreachable opener is a soft failure, not the end of the walk.
 */
async function visitModal(page: Page, sweep: Sweep, opener: string, modal: string, state: string): Promise<void> {
  const opened = await page
    .getByTestId(opener)
    .click({ timeout: 5_000 })
    .then(() => true, () => false);
  expect.soft(opened, `${state}: ${opener} cannot be pressed at ${sweep.width}x${sweep.height}`).toBe(true);
  if (!opened) return;
  await expect(page.getByTestId(modal)).toBeVisible();
  await visitState(page, sweep, state);
  await page.getByTestId(modal).getByTestId("modal-close").click();
  await expect(page.getByTestId(modal)).toBeHidden();
}

for (const sweep of SWEEP) {
  const size = `${sweep.width}x${sweep.height}`;

  test(`catalogue ${sweep.factor} ${size}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const corners = new Map<string, Rect>();
    await walkFlow(browser, sweep, async (screen, page) => {
      // Off the ground, so the race shows a drawn course and a racer in the air.
      if (screen === "race") await page.waitForTimeout(4000);
      await visitState(page, sweep, STATE[screen], corners);

      if (screen === "title") {
        await visitModal(page, sweep, "title-settings", "settings-modal", "settings");
        await visitModal(page, sweep, "quick-contact", "contact-modal", "contact");
      }
      if (screen === "ready room") {
        await page.getByTestId("seat-change").click();
        await page.getByTestId("character-page").waitFor();
        // The tiles' portraits load on demand.
        await page.waitForFunction(() => [...document.images].every((image) => image.complete));
        await visitState(page, sweep, "character", corners);
        await page.getByTestId("character-back").click();
      }
      if (screen === "race") {
        // The pause overlay; the race runs on underneath it.
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("pause-resume")).toBeVisible();
        await visitState(page, sweep, "pause");
        await page.getByTestId("pause-resume").click();
        await expect(page.getByTestId("pause-resume")).toBeHidden();
      }
      if (screen === "results") {
        await expect(page.getByTestId("watch-replay")).toBeEnabled({ timeout: 15_000 });
        await page.getByTestId("watch-replay").click();
        await expectScreen(page, "replay");
        await page.waitForTimeout(4000);
        await visitState(page, sweep, "replay");
        // Idle: from Task 5 the bar hides after 2.5 s without input.
        await page.waitForTimeout(3000);
        await visitState(page, sweep, "replay idle");
        // To the end card at 2x, as replay.spec.ts watches it.
        await page.keyboard.press("s");
        await expect(page.getByTestId("replay-watch-again")).toBeVisible({ timeout: 90_000 });
        await visitState(page, sweep, "replay end");
      }
    });
    await test.step("corner controls agree", () => expectSameCorner(corners));
  });

  test(`catalogue tutorial ${sweep.factor} ${size}`, async ({ browser }) => {
    test.slow();
    const page = await openTutorial(browser, sweep);
    try {
      // Played: the veil lifts. Pressed once the step has frozen, as
      // tutorial-evidence.spec.ts does; pressed at once, the veil stayed up.
      await expect(page.getByTestId("tutorial-freeze")).toBeVisible();
      await page.waitForTimeout(500);
      await page.keyboard.down("KeyA");
      await expect(page.getByTestId("tutorial-freeze")).toBeHidden();
      await page.waitForTimeout(250);
      await page.keyboard.up("KeyA");
      await noteTouch(page, sweep);
      await visitState(page, sweep, "tutorial playing");

      await page.keyboard.press("Escape");
      await expect(page.getByTestId("pause-resume")).toBeVisible();
      await visitState(page, sweep, "tutorial paused");
      await page.getByTestId("pause-resume").click();

      await page.getByTestId("tutorial-skip").click();
      await expect(page.getByTestId("tutorial-done")).toBeVisible();
      await visitState(page, sweep, "tutorial done");
    } finally {
      await page.context().close();
    }
  });
}
