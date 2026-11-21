import type { CDPSession, Frame, Page } from "@playwright/test";
import type { Press } from "./demo-slides";

/**
 * Plays a story chapter to its goal by a player's own controls, on stepped frames (the context must carry
 * `FRAME_CONTROL`): the story bot inside the page (`window.__ffStory`, an inspection build) says what to
 * press each tick, the spec presses it with the hands given, the page is stepped one tick at a time, and
 * the chapter is over when its results are up. A program at a skilled player's pace: it proves the chapter
 * can be finished with those controls, not that a first-time player knows what to do (that is the walk).
 */

/** How one tick's presses reach the page. */
export type Hands = (press: ReadonlySet<Press>) => Promise<void>;

const FRAME_MS = 1000 / 60;
const KEYS: Record<Press, string> = { left: "KeyA", right: "KeyD", fastFall: "KeyS" };

/** Held keys. */
export function keyHands(page: Page): Hands {
  const held = new Set<Press>();
  return async (want) => {
    for (const name of Object.keys(KEYS) as Press[]) {
      if (want.has(name) && !held.has(name)) {
        held.add(name);
        await page.keyboard.down(KEYS[name]);
      } else if (!want.has(name) && held.has(name)) {
        held.delete(name);
        await page.keyboard.up(KEYS[name]);
      }
    }
  };
}

/** The fake pad's left stick for steering and its A for the fast fall (`FakePad.install` first). */
export function padHands(page: Page): Hands {
  return (want) =>
    page.evaluate((press) => {
      const pad = (window as unknown as { __ffPad: { axes: number[]; buttons: number[]; timestamp: number } }).__ffPad;
      pad.axes[0] = press.includes("left") ? -0.9 : press.includes("right") ? 0.9 : 0;
      pad.buttons[0] = press.includes("fastFall") ? 1 : 0;
      pad.timestamp = performance.now();
    }, [...want]);
}

/** A finger on the screen: a drag left or right of where it came down (swipe steering), held until the next change. */
export function swipeHands(session: CDPSession, at: { x: number; y: number }): Hands {
  let side: "left" | "right" | undefined;
  return async (want) => {
    const next = want.has("left") ? "left" : want.has("right") ? "right" : undefined;
    if (next === side) return;
    if (side !== undefined) await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    side = next;
    if (next === undefined) return;
    const point = { x: at.x, y: at.y, id: 1 };
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, x: at.x + (next === "left" ? -80 : 80) }] });
  };
}

/** The on-screen left and right buttons, pressed and held. */
export function buttonHands(session: CDPSession, page: Page): Hands {
  let side: "left" | "right" | undefined;
  return async (want) => {
    const next = want.has("left") ? "left" : want.has("right") ? "right" : undefined;
    if (next === side) return;
    if (side !== undefined) await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    side = next;
    if (next === undefined) return;
    const box = (await page.getByTestId(`touch-${next}`).boundingBox())!;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
  };
}

/** The game's document: the page, or the Ruken host's frame. */
type Game = Page | Frame;

const step = (page: Game, frames: number): Promise<void> =>
  page.evaluate(([count, ms]) => (window as unknown as { __capture: { step(c: number, m: number): void } }).__capture.step(count as number, ms as number), [frames, FRAME_MS]);

export type StoryHook = {
  step: string | undefined;
  chapter: number | undefined;
  tick: number;
  lamps: number;
  lava?: { under: "player" | "actor"; onScreen: boolean; phaseTicks: number };
  want: { left: boolean; right: boolean; fastFall: boolean };
};

const story = (page: Game): Promise<StoryHook | undefined> =>
  page.evaluate(() => {
    const now = (window as unknown as { __ffStory?: () => StoryHook & { drive?: unknown } }).__ffStory?.();
    // The hook's switch is a function, which does not cross into the spec.
    return now === undefined ? undefined : { ...now, drive: undefined };
  });

/** Puts the page's own story bot at the controls, inside the tick, so a run plays the same ticks each time. */
export async function driveInPage(page: Game): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __ffStory?: () => { drive(on: boolean): boolean } }).__ffStory?.().drive(true) ?? false);
}

/** The frame clock taken over: from here the page moves only when `step` says. */
export async function takeFrames(page: Game): Promise<void> {
  await page.evaluate(() => (window as unknown as { __capture: { start(): void } }).__capture.start());
  // One real frame lets the callbacks queued before the takeover fall into the queue.
  await page.waitForTimeout(1500);
  await step(page, 2);
}

/**
 * From a chapter's climb on screen (frames taken over) to its results, or until `until` holds of the
 * story's state. Returns the ticks played.
 */
export async function playChapter(
  page: Game,
  hands: Hands,
  limitTicks = 6_000,
  until?: (now: StoryHook) => boolean,
  log?: (line: string) => void,
  each?: (now: StoryHook) => Promise<void>,
): Promise<number> {
  let played = 0;
  const startedAt = Date.now();
  try {
    for (; played < limitTicks; played += 1) {
      const now = await story(page);
      // Every 600 frames, where the chapter is: a walk that runs out of time says how far it got.
      if (log !== undefined && played % 600 === 0) log(`frame ${played} after ${Math.round((Date.now() - startedAt) / 1000)} s: ${JSON.stringify(now)}`);
      if (now?.step === "results" || (now !== undefined && until?.(now) === true)) return played;
      if (now !== undefined) await each?.(now);
      const press = new Set<Press>();
      if (now?.want.left) press.add("left");
      if (now?.want.right) press.add("right");
      if (now?.want.fastFall) press.add("fastFall");
      await hands(press);
      await step(page, 1);
    }
  } finally {
    await hands(new Set());
  }
  return played;
}

/** From the open story's first chapter climb to its first chapter stored as done. Returns the ticks played. */
export async function playChapterOne(page: Game, hands: Hands, limitTicks = 2_400): Promise<number> {
  await takeFrames(page);
  return playChapter(page, hands, limitTicks);
}

/** Steps `frames` frames on the taken-over clock. */
export const stepFrames = step;
