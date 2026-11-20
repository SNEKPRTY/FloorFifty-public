import { expect, test, type Page } from "./support/test";
import {
  SWEEP,
  expectApart,
  expectControlsFit,
  expectNoDocumentScroll,
  expectReachable,
  expectRowsWhole,
  expectTextSizes,
  walkFlow,
  type FlowScreen,
  type Sweep,
} from "./support/layout";
import { openClient } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

/**
 * Every reference viewport (responsive parity spec §2.1), through every
 * screen, against the layout rules in §4. One test per viewport, so a single
 * size can be run with `-g "390x844"`.
 *
 * Seat one carries a sixteen-character name (Review focus 3) and the room is
 * full (Review focus 5), because those are the layouts that break first.
 *
 * The layout checks are soft (support/layout.ts) and each screen is a
 * `test.step`, so a failure reads "phone-landscape 844x390 › ready room: …"
 * and never hides the screens after it. Getting from one screen to the next
 * stays hard: a flow that cannot reach the results has nothing to report.
 */

/**
 * The ready room's status line keeps clear of the action bar below it,
 * measured on its text: a squeezed row is a zero-height box that overlaps
 * nothing while its text runs onto the buttons (gate round 4, on the Galaxy).
 */
async function expectStatusClear(page: Page): Promise<void> {
  const gap = await page.evaluate(() => {
    const line = document.querySelector<HTMLElement>('[data-testid="race-options-status"]')!;
    const range = document.createRange();
    range.selectNodeContents(line);
    return document.querySelector(".ff-action-bar")!.getBoundingClientRect().top - range.getBoundingClientRect().bottom;
  });
  expect.soft(gap, "the status line runs into the action bar").toBeGreaterThanOrEqual(8);
}

async function checkScreen(page: Page, sweep: Sweep, screen: string, actions: string[]): Promise<void> {
  await test.step(screen, async () => {
    for (const action of actions) await expectReachable(page, action);
    if (screen === "ready room") await expectStatusClear(page);
    await expectControlsFit(page, sweep.touch ? 44 : 0);
    await expectRowsWhole(page);
    await expectTextSizes(page, { label: labelFloor(sweep), input: sweep.touch ? 16 : 0 });
    await expectNoDocumentScroll(page);
  });
}

/**
 * The song's player inside its scene (select spec §7): the cover
 * and the equaliser whole inside the picker, and the cover clear of both
 * arrows. The scene clips, so a cover cut off would pass every other check.
 */
async function checkSongSlide(page: Page): Promise<void> {
  await test.step("song slide", async () => {
    const cut = await page.evaluate(() => {
      const scene = document.querySelector("[data-testid=picker]")!.getBoundingClientRect();
      return ["song-slide-cover", "equaliser"].filter((id) => {
        const box = document.querySelector(`[data-testid=${id}]`)?.getBoundingClientRect();
        return (
          box === undefined ||
          box.width === 0 ||
          box.left < scene.left - 0.5 ||
          box.right > scene.right + 0.5 ||
          box.top < scene.top - 0.5 ||
          box.bottom > scene.bottom + 0.5
        );
      });
    });
    expect.soft(cut, "cut off by the scene, or missing").toEqual([]);
    await expectApart(page, '[data-testid="song-slide-cover"]', '[data-testid="picker-previous"]');
    await expectApart(page, '[data-testid="song-slide-cover"]', '[data-testid="picker-next"]');
  });
}

/**
 * The smallest label a form factor may show. Phones and tablets get the 12 px
 * floor (spec §4.7). Desktop does not change (spec §8), and its seat badges are
 * 11 px today, so desktop is held at that instead: no smaller than it is now.
 */
function labelFloor(sweep: Sweep): number {
  return sweep.factor === "desktop" ? 11 : 12;
}

/** The standings the HUD shows: the standings line upright, the pill on a compact landscape screen, rows elsewhere. */
function rosterTestId(sweep: Sweep): string {
  if (sweep.factor === "phone-portrait") return "hud-standings-line";
  return sweep.width > sweep.height && sweep.height < 340 ? "hud-standings-pill" : "hud-roster";
}

/** The Character page, opened from `opener`: Back and a whole page of tiles in view, nothing scrolls. */
async function checkCharacterPage(page: Page, sweep: Sweep, opener: string): Promise<void> {
  await test.step(`character page from ${opener}`, async () => {
    await page.getByTestId(opener).click();
    await expect(page.getByTestId("character-page")).toBeVisible();
    // The grid sizes its tiles from a width it reads after its first frame.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await expectReachable(page, "character-back");
    // Stacked chips, or the visible page when the packs had to page (780 x 270).
    const tiles = page.locator('[data-testid="tile-stack"] [data-testid="tile"], [data-testid="tile-page"]:not([inert]) [data-testid="tile"]');
    await expect(tiles.first()).toBeVisible();
    await expectReachable(page, "character-pick");
    for (const tile of await tiles.all()) {
      const box = await tile.boundingBox();
      expect.soft(box, "a tile has no box").not.toBeNull();
      if (box === null) continue;
      expect.soft(box.y + box.height, "a tile runs off the foot").toBeLessThanOrEqual(sweep.height + 0.5);
      expect.soft(box.x + box.width, "a tile runs off the side").toBeLessThanOrEqual(sweep.width + 0.5);
    }
    // A tap views and never closes.
    const other = tiles.and(page.locator(':not([data-focused="true"])')).first();
    const name = ((await other.getAttribute("aria-label")) ?? "").split(",")[0]!;
    await other.click();
    await expect(page.getByTestId("character-preview-name")).toHaveText(name);
    await expect(page.getByTestId("character-page")).toBeVisible();
    await expectControlsFit(page, sweep.touch ? 44 : 0);
    await expectTextSizes(page, { label: labelFloor(sweep), input: 0 });
    await expectNoDocumentScroll(page);
    await page.getByTestId("character-back").click();
    await expect(page.getByTestId("character-page")).toHaveCount(0);
  });
}

test.beforeAll(async () => {
  await waitForServer();
});

/** The primary actions each screen must show without scrolling (spec §4.3). */
const ACTIONS: Record<Exclude<FlowScreen, "race">, string[]> = {
  title: ["title-play", "title-character"],
  menu: ["find-race", "create-room"],
  "ready room": ["ready-toggle", "leave-room", "copy-code", "seat-change"],
  select: ["lock-in", "picker-next"],
  song: ["lock-in", "picker-next"],
  // The reveal asks nothing of the player; it is still checked for fit.
  reveal: [],
  results: ["race-again", "return-to-menu"],
};

for (const sweep of SWEEP) {
  test(`${sweep.factor} ${sweep.width}x${sweep.height}`, async ({ browser }) => {
    test.slow();
    await walkFlow(browser, sweep, async (screen, page) => {
      if (screen !== "race") {
        await checkScreen(page, sweep, screen, ACTIONS[screen]);
        if (screen === "song") await checkSongSlide(page);
        if (screen === "title") await checkCharacterPage(page, sweep, "title-character");
        if (screen === "ready room") await checkCharacterPage(page, sweep, "seat-change");
        return;
      }
      await test.step("race", async () => {
        await expectControlsFit(page, sweep.touch ? 44 : 0);
        if (sweep.touch && sweep.factor !== "desktop") {
          const roster = `[data-testid="${rosterTestId(sweep)}"]`;
          await expectApart(page, roster, '[data-testid="touch-left"]');
          await expectApart(page, roster, '[data-testid="touch-fast-fall"]');
        }
      });
    });
  });
}

test("the layout follows a rotation without a reload (Review focus 2)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await openClient(page);
  await expect(page.locator("html")).toHaveAttribute("data-form-factor", "phone-portrait");
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("html")).toHaveAttribute("data-form-factor", "phone-landscape");
  await expectReachable(page, "find-race");
  await expectReachable(page, "create-room");
  await context.close();
});
