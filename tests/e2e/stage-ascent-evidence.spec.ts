// tests/e2e/stage-ascent-evidence.spec.ts
/**
 * The stage-ascent evidence: every stage at each of its four phrases on
 * desktop, and one race frame per stage on each other form factor.
 *
 * One player, so the roulette can only land on that player's pick and the
 * stage is the one asked for. Like the Aquarian batch, it asserts only that a
 * capture is a real screen with pixels in it; whether it is right is the
 * review record's question (docs/art/stage-ascent-review.md).
 */
import { expect, test, type Page } from "./support/test";
import { driveRoom, waitForServer } from "./support/server-fixture";
import { evidenceDir } from "./support/evidence";
import { chooseMode, createRoom, expectCanvasHasPixels, expectScreen, openClients, passSelect, pickStage, readyOnly } from "./support/room-driver";

/** Which set this run is: "before" for the baseline, "after" for the result. */
const SET = "after";
const SHOTS = evidenceDir(`stage-ascent/${SET}`);
const STAGES = ["rooftops", "snow-shrine", "sunken-dome"] as const;

/** Every stage authors the same phrase floors (content/stages/*.toml). */
const PHRASES: readonly (readonly [string, number, number])[] = [
  ["teach", 1, 5],
  ["combine", 6, 11],
  ["recover", 12, 15],
  ["finish", 16, 19],
];

test.beforeAll(async () => {
  await waitForServer();
});

async function shownFloor(page: Page): Promise<number | undefined> {
  const text = await page.getByTestId("hud-floors").textContent().catch(() => null);
  const digits = /\d+/.exec(text ?? "");
  return digits === null ? undefined : Number(digits[0]);
}

async function capture(page: Page, name: string): Promise<void> {
  await expectCanvasHasPixels(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Into a race on `stage`: Ready, pick it, lock in, and lock in the song. */
async function raceOn(page: Page, stage: string): Promise<string> {
  const code = await createRoom(page, "Kite");
  // Rooms open on Survival (catalog order, 2026-10-13); this climbs the 20-floor race.
  await chooseMode(page, "floors-20");
  await readyOnly([page]);
  await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });
  await pickStage(page, stage);
  await passSelect([page]);
  await expectScreen(page, "gameplay", 30_000);
  return code;
}

for (const stage of STAGES) {
  test(`${stage}: the four phrases`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one phrase set, on the largest viewport");
    test.slow();
    const [host] = await openClients(browser, 1);
    try {
      const code = await raceOn(host!, stage);
      for (const [phrase, low, high] of PHRASES) {
        for (let step = 0; ; step += 1) {
          if (step > 600) throw new Error(`never reached the ${phrase} band`);
          const shown = await shownFloor(host!);
          if (shown !== undefined && shown > high) throw new Error(`passed the ${phrase} band; the HUD shows ${shown}`);
          if (shown !== undefined && shown >= low) {
            await capture(host!, `${stage}-${phrase}`);
            break;
          }
          const near = shown !== undefined && shown >= low - 4;
          const result = await driveRoom(code, { ticks: near ? 4 : 60 });
          // The countdown happens on the stage now (race-flow spec §3); only a finished race is past the band.
          if (result.phase !== "racing" && result.phase !== "countdown") throw new Error(`the race finished before the ${phrase} band`);
        }
      }
    } finally {
      await host!.context().close().catch(() => undefined);
    }
  });

  test(`${stage}: a race frame on this form factor`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "desktop has the phrase set");
    test.slow();
    const [host] = await openClients(browser, 1);
    try {
      await raceOn(host!, stage);
      await host!.waitForTimeout(4000);
      await capture(host!, `${stage}-${testInfo.project.name}`);
    } finally {
      await host!.context().close().catch(() => undefined);
    }
  });
}
