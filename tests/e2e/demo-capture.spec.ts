import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "./support/test";
import { evidenceDir } from "./support/evidence";
import { SCREEN_SETTLE_MS, chooseMode, createRoom, expectScreen, joinRoom, openClient, openTitle, readyAll, seedSettings, RESULTS_TIMEOUT_MS } from "./support/room-driver";
import { driveRoom, waitForServer } from "./support/server-fixture";
import { DEMO_SLIDE_PLANS, type SlidePlan } from "./support/demo-slides";
import { Mirror } from "./support/demo-mirror";
import { FRAME_CONTROL } from "./support/frame-control";

/**
 * Records the Instructions carousel's demos from the real race scene
 * (story-mode spec, "How the demos are made"). Not a test of the game: it runs
 * by hand (`pnpm demos:capture`), outside the gate's sets, and writes frames to
 * `evidence/demos/<slide>/`, which `pnpm demos:encode` turns into the clips.
 *
 * Stepped frames, not a screen recording. The page's animation clock is taken
 * over once the scene is up: one call draws one frame, a sixtieth of a second
 * on, so a slow software renderer changes how long a recording takes and not
 * what it shows. The simulation steps on that clock, two frames to a tick, and
 * the page says which tick it drew (`__ffRacer().tick`), so what the script
 * presses for a tick is pressed before that tick, never by a guess.
 *
 * It borrows the story screen as the scene: the content the page fetches is
 * rewritten here, so the first chapter is Rooftops on the slide's own course
 * seed with no talk and no goal. Nothing in the game is changed for it.
 */

const SIZE = { width: 960, height: 540 };
/**
 * The part of each frame kept: the play field inside the race's letterbox bars (a twentieth of the height off
 * the top and the bottom, `LETTERBOX_CROP_FRACTION`), cut to 16:9 around its centre, so a clip shows the course
 * and never the bars that frame a race on a wide screen.
 */
const FIELD = { x: 48, y: 27, width: 864, height: 486 } as const;
const FRAME_MS = 1000 / 60;
/** A frame is kept every this many frames: 15 a second, from sixty. */
const KEEP_EVERY = 4;

const OUT = evidenceDir("demos");
const only = process.env["DEMO_SLIDE"];

/** The game's fetched content with its first chapter replaced by the slide's course. */
function courseFor(plan: SlidePlan, body: Record<string, any>): Record<string, any> {
  const story = body["content"]["story"];
  const rooftops = story.chapters.find((chapter: { stage: { id: string } }) => chapter.stage.id === "rooftops");
  const lavaBeats = story.chapters[story.chapters.length - 1].beats;
  story.chapters = [
    {
      ...rooftops,
      id: `demo-${plan.slide}`,
      seed: plan.seed,
      goalFloor: 999,
      beats: plan.lava === undefined ? [] : lavaBeats,
    },
  ];
  return body;
}

async function openScene(page: Page, plan: SlidePlan): Promise<void> {
  await page.route("**/content", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: courseFor(plan, await response.json()) });
  });
  await openTitle(page);
  await page.getByTestId("quick-story").click();
  await expect(page.locator('[data-screen="story"]')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("story-play").click({ timeout: 60_000 });
  await page.getByTestId("story-cutscene-skip").click({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__ffRacer?.().local !== undefined), { timeout: 120_000 }).toBe(true);
  // The story's talk and controls stay out of a recording of the scene.
  await page.addStyleTag({ content: '[data-screen="story"], [data-testid="pause-open"] { visibility: hidden !important; }' });
}

/** The tick the page last drew. */
const tickOf = (page: Page): Promise<number> => page.evaluate(() => window.__ffRacer?.().tick ?? -1);

/** The race demo's racers, the viewer first: short names that read the same in every language. */
const RACE_NAMES = ["Koi", "Sunny", "Moth", "Pip"] as const;

const KEYS = { left: "KeyA", right: "KeyD", fastFall: "KeyS" } as const;

/**
 * Sets up a context the way every recording is: GPU-like renderer name, no scene text, stepped frames. The
 * race keeps its scene text: its name tags carry only the racers' names and seat numbers, which read the same
 * in every language, and a tag with its text taken out is an empty plate.
 */
async function recordingContext(browser: import("@playwright/test").Browser, options: { sceneText?: boolean } = {}) {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
  await seedSettings(context, { seen: { tutorial: true }, profile: { lastCharacter: "ninja", lastColour: "scarlet" } } as never);
  await context.addInitScript(() => {
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const getParameter = proto.getParameter;
      proto.getParameter = function (this: WebGLRenderingContext, parameter: number) {
        return parameter === 0x9246 ? "ANGLE (Demo capture, Vulkan 1.3)" : getParameter.call(this, parameter);
      };
    }
  });
  // With scene text kept, only the racers' names and numbers are drawn: a call-out ("NICE!") is a word in one language.
  await context.addInitScript((keep: string | null) => {
    const allowed = keep === null ? undefined : new RegExp(keep);
    for (const proto of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
      const fill = proto.fillText;
      const stroke = proto.strokeText;
      proto.fillText = function (this: CanvasRenderingContext2D, text: string, ...rest: [number, number, number?]) {
        if (allowed?.test(String(text))) fill.call(this, text, ...rest);
      };
      proto.strokeText = function (this: CanvasRenderingContext2D, text: string, ...rest: [number, number, number?]) {
        if (allowed?.test(String(text))) stroke.call(this, text, ...rest);
      };
    }
  }, options.sceneText === true ? `^(${RACE_NAMES.join("|")}|[\\d\\s×+•.]*)$` : null);
  await context.addInitScript(FRAME_CONTROL);
  return context;
}

/**
 * The race clip's closer view: the clip's own size, so the racers draw at their size in the game, nearly twice
 * as large as in the whole field scaled down (Owner, 2026-11-20: "Full-colour rivals, closer view").
 */
const CLOSE_VIEW = { width: 480, height: 270 } as const;
/** Where the viewer's racer sits in the closer view, across and down: the others climb behind, below it. */
const CLOSE_VIEW_ANCHOR = { x: 0.5, y: 0.3 } as const;
/** How far the view moves toward the racer each frame: a camera that follows smoothly, never a jump. */
const CLOSE_VIEW_EASE = 0.12;

/**
 * The closer view's corner this frame: eased from the last one toward the viewer's racer (`__ffRacer().local`,
 * nameplate included), and kept inside the play field. The first frame starts on the racer.
 */
function closeView(
  last: { x: number; y: number } | undefined,
  racer: { left: number; top: number; right: number; bottom: number } | undefined,
): { x: number; y: number } {
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  const centre = racer === undefined ? { x: FIELD.x + FIELD.width / 2, y: FIELD.y + FIELD.height / 2 } : { x: (racer.left + racer.right) / 2, y: (racer.top + racer.bottom) / 2 };
  const target = {
    x: clamp(centre.x - CLOSE_VIEW.width * CLOSE_VIEW_ANCHOR.x, FIELD.x, FIELD.x + FIELD.width - CLOSE_VIEW.width),
    y: clamp(centre.y - CLOSE_VIEW.height * CLOSE_VIEW_ANCHOR.y, FIELD.y, FIELD.y + FIELD.height - CLOSE_VIEW.height),
  };
  if (last === undefined) return { x: Math.round(target.x), y: Math.round(target.y) };
  return { x: Math.round(last.x + (target.x - last.x) * CLOSE_VIEW_EASE), y: Math.round(last.y + (target.y - last.y) * CLOSE_VIEW_EASE) };
}

/**
 * Slide 6: four racers on the real server, raced to the top by the test driver, then the replay of that race
 * drawn on stepped frames from the start, where all four are in one picture: the replay re-simulates the same
 * race, deterministically.
 */
test("records the race demo", async ({ browser }) => {
  test.skip(only !== undefined && only !== "race", `DEMO_SLIDE=${only}`);
  test.setTimeout(30 * 60_000);
  await waitForServer();
  const viewerContext = await recordingContext(browser, { sceneText: true });
  // The rivals at full colour, for this recording only: in a game they are dimmed behind the player's own racer
  // (Owner, 2026-11-20: "Full-colour rivals, closer view"). The switch exists only in a build with test hooks.
  await viewerContext.addInitScript(() => {
    (globalThis as { __ffDemoFullColourRivals?: boolean }).__ffDemoFullColourRivals = true;
  });
  const viewer = await viewerContext.newPage();
  await openClient(viewer);
  const others = [];
  for (let index = 0; index < 3; index += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openClient(page);
    others.push(page);
  }
  const pages = [viewer, ...others];
  const code = await createRoom(viewer, RACE_NAMES[0]);
  for (const [index, page] of others.entries()) await joinRoom(page, code, RACE_NAMES[index + 1]!);
  await chooseMode(viewer, "floors-20");
  await readyAll(pages);
  for (const page of pages) await expectScreen(page, "gameplay");
  // The driver steers every seat alike, so four racers started together climb as one sprite. Each one sets off
  // a moment after the one before (Koi first), and the four climb as a chain the replay shows in one picture.
  let phase = (await driveRoom(code, { ticks: 0, playerIds: [] })).phase;
  for (let tick = 0; phase !== "racing" && tick < 60 * 10; tick += 1) phase = (await driveRoom(code, { ticks: 1, playerIds: [] })).phase;
  expect(phase, "the race starts").toBe("racing");
  const ids = (await driveRoom(code, { ticks: 0 })).progress.map((player) => player.id);
  const STAGGER_TICKS = Number(process.env["DEMO_RACE_STAGGER"] ?? 10);
  for (let count = 1; count < ids.length; count += 1) await driveRoom(code, { ticks: STAGGER_TICKS, playerIds: ids.slice(0, count) });
  const outcome = await driveRoom(code, { ticks: 60 * 240 });
  expect(outcome.phase, "the driver finishes the race").toBe("finished");
  for (const page of pages) await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
  await expect(viewer.getByTestId("watch-replay")).toBeEnabled({ timeout: SCREEN_SETTLE_MS });
  await viewer.getByTestId("watch-replay").click();
  await expectScreen(viewer, "replay");
  // Only the canvas is recorded: every piece of the replay's page (its controls, video buttons, hint and HUD) is hidden.
  await viewer.addStyleTag({ content: '[data-screen="replay"], [data-screen="replay"] *, [data-hud-metrics], [data-testid="hud-roster"], .ff-hud { visibility: hidden !important; }' });
  await viewer.evaluate(() => (window as unknown as { __capture: { start(): void } }).__capture.start());
  await viewer.waitForTimeout(1500);
  const step = (frames: number): Promise<void> =>
    viewer.evaluate(([count, ms]) => (window as unknown as { __capture: { step(c: number, m: number): void } }).__capture.step(count as number, ms as number), [frames, FRAME_MS]);
  await step(2);
  // The moment the race starts, when the four leave the same floor together and are all in one picture.
  const seekTo = Number(process.env["DEMO_RACE_FROM"] ?? 3);
  await viewer.getByTestId("replay-progress").evaluate((input, to) => {
    (input as HTMLInputElement).value = String(to);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, seekTo);
  // The seek steps toward the moment a few frames at a time; play on until it is there.
  for (let frame = 0; frame < 3000; frame += 60) {
    await step(60);
    const text = (await viewer.getByTestId("replay-progress").getAttribute("aria-valuetext")) ?? "";
    const [minutes, seconds] = text.split(" of ")[0]!.split(":").map(Number);
    if (minutes !== undefined && seconds !== undefined && minutes * 60 + seconds >= seekTo) break;
  }
  const dir = resolve(OUT, "race");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let kept = 0;
  let view: { x: number; y: number } | undefined;
  // Four seconds, as long as the other slides' clips may run.
  for (let frame = 0; frame < 240; frame += 1) {
    await step(1);
    view = closeView(view, await viewer.evaluate(() => window.__ffRacer?.().local));
    if (frame % KEEP_EVERY === 0) {
      await viewer.screenshot({ path: resolve(dir, `${String(kept).padStart(4, "0")}.png`), clip: { ...view, ...CLOSE_VIEW } });
      kept += 1;
    }
  }
  expect(kept, "frames kept").toBeGreaterThan(30);
});

for (const plan of DEMO_SLIDE_PLANS) {
  test(`records the ${plan.slide} demo`, async ({ browser }) => {
    test.skip(only !== undefined && only !== plan.slide, `DEMO_SLIDE=${only}`);
    test.setTimeout(30 * 60_000);
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
    await seedSettings(context, { seen: { tutorial: true }, profile: { lastCharacter: "ninja", lastColour: "scarlet" } } as never);
    // A GPU-less browser names itself, and the client then draws a frame a second at half density. The
    // recording steps its own frames, so it asks to be drawn as a GPU's would be.
    await context.addInitScript(() => {
      for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const getParameter = proto.getParameter;
        proto.getParameter = function (this: WebGLRenderingContext, parameter: number) {
          return parameter === 0x9246 ? "ANGLE (Demo capture, Vulkan 1.3)" : getParameter.call(this, parameter);
        };
      }
    });
    // No word is drawn into the scene: the racer's name tag would say "You" in one language only. (Page
    // text is HTML; only the scene's own text goes through a canvas, and it is drawn once, early.)
    await context.addInitScript(() => {
      for (const proto of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
        proto.fillText = () => undefined;
        proto.strokeText = () => undefined;
      }
    });
    await context.addInitScript(FRAME_CONTROL);
    const page = await context.newPage();
    const dir = resolve(OUT, plan.slide);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    await openScene(page, plan);
    await page.evaluate(() => (window as unknown as { __capture: { start(): void } }).__capture.start());
    const step = (frames: number): Promise<void> =>
      page.evaluate(([count, ms]) => (window as unknown as { __capture: { step(c: number, m: number): void } }).__capture.step(count as number, ms as number), [frames, FRAME_MS]);
    // One real frame lets the callbacks queued before the takeover fall into the queue.
    await page.waitForTimeout(1500);
    await step(2);

    const held = new Set<string>();
    const press = async (want: ReadonlySet<keyof typeof KEYS>): Promise<void> => {
      for (const [name, key] of Object.entries(KEYS)) {
        const should = want.has(name as keyof typeof KEYS);
        if (should && !held.has(key)) {
          held.add(key);
          await page.keyboard.down(key);
        } else if (!should && held.has(key)) {
          held.delete(key);
          await page.keyboard.up(key);
        }
      }
    };

    // The page is on tick `startTick`; the mirror is brought to the same tick, with nothing pressed, as the page's run was.
    const startTick = await tickOf(page);
    const mirror = new Mirror(plan.seed, plan.lava === undefined ? [] : []);
    for (let tick = 0; tick < startTick; tick += 1) mirror.step([]);
    const take = plan.take(mirror);
    console.log(`${plan.slide}: ${take.inputs.length} ticks pressed, frames from ${take.from} to ${take.to}`);
    let kept = 0;
    for (let index = 0; index < take.to; index += 1) {
      const tick = (await tickOf(page)) - startTick;
      expect(tick, "the page keeps pace with the mirror").toBe(index);
      await press(new Set(take.inputs[index] ?? []));
      await step(1);
      if (index >= take.from && (index - take.from) % KEEP_EVERY === 0) {
        await page.screenshot({ path: resolve(dir, `${String(kept).padStart(4, "0")}.png`), clip: FIELD });
        kept += 1;
      }
    }
    await press(new Set());
    expect(kept, "frames kept").toBeGreaterThan(30);
    await context.close();
  });
}
