import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "./support/test";
import { evidenceDir } from "./support/evidence";
import { SWEEP, expectControlsFit, expectNoDocumentScroll, type Sweep } from "./support/layout";
import { enterStory, noteTouch, openStory, storyWords } from "./support/story";
import { openTitle } from "./support/room-driver";
import { BRIEF, FRAME_CONTROL, stepUntil } from "./support/frame-control";

/**
 * The story at every reference viewport (story-mode spec, criteria 7 and 8): its words stay on screen, clear
 * of the HUD and the touch controls, and the page never scrolls. The primary size per form factor also writes
 * `evidence/story/<form factor>-<shot>.png`. The caught-by-lava loop is played once below, on a chapter set
 * to the lava alone.
 */

const OUT = evidenceDir("story");

/** The primary sizes, named as `screen-catalogue.spec.ts` names them. */
const SHOTS: Record<string, string> = {
  "390x844": "phone-portrait",
  "844x390": "phone-landscape",
  "1280x720": "desktop",
  "820x1180": "tablet-portrait",
};

/** What the words must never cover, where the layout draws it. */
const KEEP_CLEAR = [
  "[data-hud-metrics]",
  '[data-testid="hud-roster"]',
  '[data-testid="pause-open"]',
  '[data-testid="hud-restart"]',
  '[data-testid="touch-controls"]',
  '[data-testid="swipe-coach"]',
];

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

async function expectWordsFit(page: Page, sweep: Sweep, label: string): Promise<void> {
  const words = await storyWords(page).boundingBox();
  expect(words, `${label}: no words`).not.toBeNull();
  if (words === null) return;
  expect.soft(words.x, `${label}: off the left`).toBeGreaterThanOrEqual(0);
  expect.soft(words.y, `${label}: off the top`).toBeGreaterThanOrEqual(0);
  expect.soft(words.x + words.width, `${label}: off the right`).toBeLessThanOrEqual(sweep.width + 0.5);
  expect.soft(words.y + words.height, `${label}: off the bottom`).toBeLessThanOrEqual(sweep.height + 0.5);
  for (const selector of KEEP_CLEAR) {
    const other = page.locator(selector).first();
    if (!(await other.isVisible().catch(() => false))) continue;
    const box = await other.boundingBox();
    if (box === null) continue;
    expect.soft(overlaps(words, box), `${label}: covers ${selector}`).toBe(false);
  }
  await expectControlsFit(page, sweep.touch ? 44 : 0);
  await expectNoDocumentScroll(page);
}

for (const sweep of SWEEP) {
  const size = `${sweep.width}x${sweep.height}`;
  const name = SHOTS[size];

  test(`story ${sweep.factor} ${size}`, async ({ browser }) => {
    test.slow();
    if (name !== undefined) mkdirSync(OUT, { recursive: true });
    const shoot = async (page: Page, shot: string): Promise<void> => {
      if (name !== undefined) await page.screenshot({ path: resolve(OUT, `${name}-${shot}.png`) });
    };
    const page = await openStory(browser, sweep);
    try {
      await noteTouch(page, sweep);
      await expectWordsFit(page, sweep, "the first words");
      await shoot(page, "line");

      await page.keyboard.press("Escape");
      await expect(page.getByTestId("pause-resume")).toBeVisible();
      await expect(storyWords(page), "nothing is drawn under the pause panel").toHaveCount(0);
      await shoot(page, "paused");
      await page.getByTestId("pause-resume").click();
      await expect(page.getByTestId("pause-resume")).toBeHidden();
    } finally {
      await page.context().close();
    }
  });
}

/** The story with one chapter, the lava's from its first tick, that no idle racer ends: only being caught and starting again happen. */
test("story 1280x720: the lava catches an idle racer and the chapter starts again, never ending the story", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(FRAME_CONTROL);
  await context.route("**/content", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { content: { story: { chapters: Record<string, unknown>[] } } };
    const story = body.content.story;
    // The snow chapter, whose lava chases the player, with the lava under an idle racer from the first tick:
    // an idle racer never leaves its floor, so it is caught, and no climb ends the chapter.
    type Phase = Record<string, unknown>;
    const snow = story.chapters[3]! as { startFloor: number; phases: Phase[] };
    const phases = snow.phases.map((phase, index) =>
      index === 0 ? { ...phase, lava: { under: "player", startBelow: 40, rise: 32, grace: 0 }, safeSpots: (phase["safeSpots"] as number[] | undefined) ?? [snow.startFloor] } : phase,
    );
    story.chapters = [{ ...snow, phases }];
    await route.fulfill({ response, json: body });
  });
  const page = await context.newPage();
  try {
    await openTitle(page);
    await enterStory(page);
    // On stepped frames: a software-drawn browser plays the lava's minutes at a tenth of real time.
    const banner = page.getByTestId("out-banner");
    expect(await stepUntil(page, async () => (await banner.count()) > 0, 6_000, BRIEF.batch, BRIEF.frameMs), "the lava catches the idle racer").toBe(true);
    expect(await stepUntil(page, async () => (await banner.count()) === 0, 600), "and the chapter starts again").toBe(true);
    await expect(page.getByTestId("story-results")).toHaveCount(0);
    await expect(page.locator('[data-screen="story"]')).toBeVisible();
  } finally {
    await context.close();
  }
});
