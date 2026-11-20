import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as m from "../../apps/client/src/paraglide/messages.js";
import { expect, test, type Page } from "./support/test";
import { evidenceDir } from "./support/evidence";
import { SWEEP, expectControlsFit, expectNoDocumentScroll, type Sweep } from "./support/layout";
import { createRoom, expectScreen } from "./support/room-driver";
import { noteTouch, openTutorial } from "./support/tutorial";
import { authoredStepKinds, letGo, playTutorial } from "./support/tutorial-walk";
import { Notes, type View } from "./support/screens-walk";

/**
 * The tutorial at every reference viewport (launch polish §3.1.4): the card
 * stays on screen, clear of the HUD and the touch controls, in each of its
 * phases, and the done card fits. The primary size per form factor also
 * writes `evidence/tutorial/<form factor>-<shot>.png`.
 *
 * Per viewport only the first two steps are played: later steps need a climb,
 * and the client has no route that writes into a run. The card's worst case is
 * instead its longest authored prompt, set into the first step's card for the
 * measure. The last step (Survival's lava) is played through once, below, at
 * one desktop size; where "OUT!" and its card sit on every view is looked at
 * on the Owner's Mac (the first-race plan's Task 19).
 */

const OUT = evidenceDir("tutorial");

/** The primary sizes, named as `screen-catalogue.spec.ts` names them. */
const SHOTS: Record<string, string> = {
  "390x844": "phone-portrait",
  "844x390": "phone-landscape",
  "1280x720": "desktop",
  "820x1180": "tablet-portrait",
};

/** The longest prompt `content/tutorial.toml` authors. */
const authoredTutorial = JSON.parse(readFileSync("content/generated/content.json", "utf8")).content.tutorial;
const LONGEST_PROMPT = authoredTutorial.steps.flatMap((step: { prompt: Record<string, string> }) => Object.values(step.prompt))
  .map((text: string) => text.replaceAll("{glyph}", "Bottom button / Right trigger"))
  .sort((a: string, b: string) => b.length - a.length)[0] as string;

const CARD = 'section:has([data-testid="tutorial-step"])';

/** What the card must never cover, where the layout draws it. */
const KEEP_CLEAR = [
  "[data-hud-metrics]",
  '[data-testid="hud-roster"]',
  '[data-testid="pause-open"]',
  '[data-testid="hud-restart"]',
  '[data-testid="touch-controls"]',
  '[data-testid="swipe-coach"]',
];

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

async function expectCardFits(page: Page, sweep: Sweep, label: string): Promise<void> {
  const card = await page.locator(CARD).boundingBox();
  expect(card, `${label}: no card`).not.toBeNull();
  if (card === null) return;
  expect.soft(card.x, `${label}: card off the left`).toBeGreaterThanOrEqual(0);
  expect.soft(card.y, `${label}: card off the top`).toBeGreaterThanOrEqual(0);
  expect.soft(card.x + card.width, `${label}: card off the right`).toBeLessThanOrEqual(sweep.width + 0.5);
  expect.soft(card.y + card.height, `${label}: card off the bottom`).toBeLessThanOrEqual(sweep.height + 0.5);
  for (const selector of KEEP_CLEAR) {
    const other = page.locator(selector).first();
    if (!(await other.isVisible().catch(() => false))) continue;
    const box = await other.boundingBox();
    if (box === null) continue;
    expect.soft(overlaps(card, box), `${label}: card covers ${selector}`).toBe(false);
  }
  await expectControlsFit(page, sweep.touch ? 44 : 0);
  await expectNoDocumentScroll(page);
}

for (const sweep of SWEEP) {
  const size = `${sweep.width}x${sweep.height}`;
  const name = SHOTS[size];

  test(`tutorial ${sweep.factor} ${size}`, async ({ browser }) => {
    test.slow();
    if (name !== undefined) mkdirSync(OUT, { recursive: true });
    const shoot = async (page: Page, shot: string): Promise<void> => {
      if (name !== undefined) await page.screenshot({ path: resolve(OUT, `${name}-${shot}.png`) });
    };
    const page = await openTutorial(browser, sweep);
    try {
      await expect(page.getByTestId("tutorial-practice")).toHaveText("Climb practice");
      // Frozen: the veil is up and the world holds still.
      await expect(page.getByTestId("tutorial-freeze")).toBeVisible();
      // The veil covers the whole screen, not only the letterbox...
      const veil = await page.getByTestId("tutorial-freeze").evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right - innerWidth, bottom: box.bottom - innerHeight };
      });
      expect.soft(veil, "the veil misses the screen's edges").toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
      // ...and never takes a finger: across the swipe surface, a touch lands
      // on the surface (or a HUD control over it), never on the veil.
      if (sweep.touch) {
        const hits = await page.evaluate(() => {
          const surface = document.querySelector('[data-testid="swipe-surface"]');
          if (surface === null) return ["no swipe surface"];
          const box = surface.getBoundingClientRect();
          const hits: string[] = [];
          for (const fx of [0.2, 0.5, 0.8]) {
            for (const fy of [0.25, 0.5, 0.75]) {
              const under = document.elementFromPoint(box.left + box.width * fx, box.top + box.height * fy);
              hits.push(under?.closest("[data-testid]")?.getAttribute("data-testid") ?? "nothing");
            }
          }
          return hits;
        });
        expect.soft(hits, "a touch over the veil lands on the veil").not.toContain("tutorial-freeze");
        expect.soft(hits, "no touch reaches the swipe surface").toContain("swipe-surface");
      }
      await page.waitForTimeout(500);
      await expectCardFits(page, sweep, "frozen");
      await shoot(page, "1-frozen");

      // The longest prompt, measured in the same card.
      const original = await page.getByTestId("tutorial-prompt").evaluate((node, text) => {
        const before = node.firstChild?.textContent ?? "";
        if (node.firstChild !== null) node.firstChild.textContent = text;
        return before;
      }, LONGEST_PROMPT);
      await expectCardFits(page, sweep, "longest prompt");
      await shoot(page, "longest-prompt");
      await page.getByTestId("tutorial-prompt").evaluate((node, text) => {
        if (node.firstChild !== null) node.firstChild.textContent = text;
      }, original);

      // Let go, then played: the veil lifts.
      await page.keyboard.down("KeyA");
      await expect(page.getByTestId("tutorial-freeze")).toBeHidden();
      await page.waitForTimeout(250);
      await page.keyboard.up("KeyA");
      await noteTouch(page, sweep);
      await expectCardFits(page, sweep, "playing");
      await shoot(page, "1-playing");

      // Done: the card says so for a moment.
      await page.keyboard.down("KeyD");
      await expect(page.getByTestId("tutorial-cleared")).toBeVisible();
      await page.keyboard.up("KeyD");
      await noteTouch(page, sweep);
      await expectCardFits(page, sweep, "cleared");
      await shoot(page, "1-cleared");

      // The next step opens frozen again.
      // "2/5" in the touch toast, "2 of 5" on the card: the count is the authored steps'.
      const total = authoredTutorial.steps.length;
      await expect(page.getByTestId("tutorial-step")).toContainText(
        new RegExp(`(${m.tutorial_step_toast({ step: 2, total })}|${m.tutorial_step_of({ step: 2, total })})`),
      );
      await expect(page.getByTestId("tutorial-freeze")).toBeVisible();
      await noteTouch(page, sweep);
      await expectCardFits(page, sweep, "second step");
      await shoot(page, "2-frozen");

      await expect(page.getByTestId("tutorial-prompt")).toContainText("land on top for floor credit");
      // Paused over the tutorial.
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("pause-resume")).toBeVisible();
      await expectControlsFit(page, sweep.touch ? 44 : 0);
      await shoot(page, "paused");
      await page.getByTestId("pause-resume").click();

      // Skipped to the done card.
      await page.getByTestId("tutorial-skip").click();
      const done = page.getByTestId("tutorial-done");
      await expect(done).toBeVisible();
      const box = await done.boundingBox();
      expect(box).not.toBeNull();
      if (box !== null) {
        expect.soft(box.y, "done card off the top").toBeGreaterThanOrEqual(0);
        expect.soft(box.y + box.height, "done card off the bottom").toBeLessThanOrEqual(sweep.height + 0.5);
      }
      await expect(page.getByTestId("tutorial-race-now")).toBeInViewport();
      await expectControlsFit(page, sweep.touch ? 44 : 0);
      await shoot(page, "done");
      // This path uses real authored steps and Skip, not injected prompt text.
      await page.getByTestId("tutorial-race-now").click();
      await expectScreen(page, "lobby");
      await createRoom(page, "Practice racer");
      // The Owner's own rules line ("14. A"); read from the catalogue, so a rewording changes one place.
      await page.getByTestId("ready-rules").click();
      await expect(page.getByTestId("mode-tagline")).toHaveText(m.ready_mode_survival_tagline());
      await page.getByTestId("info-sheet-close").click();
      await shoot(page, "survival-ready-after-skip");
    } finally {
      await page.context().close();
    }
  });
}

/**
 * The last step in a real browser (first-race spec §1): the tutorial played to
 * it by the walk's blind player, then the lava catches an idle racer, the card
 * says so and the step starts again, and a played-through step ends on the end
 * card. Words from the compiled catalogue: this spec holds no English.
 */
test("tutorial last step 1280x720: the lava catches an idle racer, the step starts again, and a climb ends it", async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const desktop = SWEEP.find((entry) => entry.width === 1280 && entry.height === 720)!;
  const page = await openTutorial(browser, desktop);
  const kinds = authoredStepKinds();
  const notes = new Notes({ key: "tutorial-evidence" } as View, "last step");
  const shoot = async (shot: string): Promise<void> => {
    await page.screenshot({ path: resolve(OUT, `desktop-${shot}.png`) });
  };
  try {
    // Steps one to four, played; the last one is left frozen.
    const reached = await playTutorial({ page, game: page, notes, shoot: async () => {} }, kinds, [1, 2, 3, 4]);
    expect(reached).toBe("last-step");
    await expect(page.getByTestId("tutorial-prompt")).toContainText(m.content_tutorial_survive_keyboard());
    await expect(page.getByTestId("tutorial-freeze")).toBeVisible();
    await shoot("5-survive-frozen");

    // One steer lets it go; then no input: the edge catches her (a slow page takes its time).
    expect(await letGo(page, page, "survive")).toBe(true);
    await expect(page.getByTestId("out-banner")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("tutorial-prompt")).toContainText(m.tutorial_caught());
    await shoot("6-survive-caught");

    // OUT! goes, the step stands frozen again with the try-again words, and the tutorial is not over.
    await expect(page.getByTestId("out-banner")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("tutorial-freeze")).toBeVisible();
    await expect(page.getByTestId("tutorial-prompt")).toContainText(m.tutorial_caught());
    await expect(page.getByTestId("tutorial-done")).toHaveCount(0);

    // Played through, with as many tries as it takes: it ends on the end card.
    const finished = await playTutorial({ page, game: page, notes, shoot: async () => {} }, kinds, [1, 2, 3, 4, 5], { throughLast: true });
    expect(finished, notes.all.join("; ")).toBe("done");
    await expect(page.getByTestId("tutorial-done")).toBeVisible();
  } finally {
    await page.context().close();
  }
});
