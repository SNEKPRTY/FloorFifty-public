/**
 * Plays the tutorial for the screens walk (`screens-walk.spec.ts`), by the
 * step the card says it is on.
 *
 * The client has no route that writes into a run, so this plays as a player
 * does, with the keys the card names. What it reads is the card itself: the
 * step number, and the phase the step is in (`TutorialScript`):
 *
 * - frozen: the run stands still under a veil until a fresh press of the
 *   step's own control. The card is photographed here, then the control is
 *   pulsed (pressed and let go) until the veil lifts, because a press only
 *   counts if it goes down after the step's least freeze and a key held from
 *   before it never does.
 * - cleared: the step is done and "Nice." stands for a moment; keys are let go.
 * - active: the run plays, and the step's kind (`content/tutorial.toml`, read
 *   from the content artifact, so a changed course changes the walk) picks
 *   the hands: scripted where a step asks for one control, a sweep where it
 *   asks for a landing.
 *
 * A step is left when the card says the next one, never after a fixed time;
 * the only clock is a generous bound per step, so a step that cannot be
 * cleared is noted and does not hang the walk. The holds are input pacing
 * (a key held for a moment is the input itself), never a wait before a
 * photograph.
 *
 * The landing steps are played blind, because the page cannot read where the
 * racer is: a sweep that holds one way for a spell and then picks again. Run
 * against the shared simulation on the tutorial's seed, it cleared the first
 * five authored steps in every one of forty trials with holds of a quarter to a
 * second (the slowest took 87 s of play; holds of up to two seconds took 163).
 * The last step (`survive`, three floors above where it began, with a slow edge
 * rising under her) is not played unless asked (`throughLast`): a blind sweep
 * may be caught and sent back to the step's start, which is the step's own
 * rule, and the walk only wants its card, so the caller skips on to the end card.
 */

import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { Notes, TUTORIAL_STEPS, evaluateIn, type Surface } from "./screens-walk";

const LEFT = "KeyA";
const RIGHT = "KeyD";
const FAST_FALL = "KeyS";

/** How long one step may take to clear before the walk gives up on it and goes to the end card. */
export const STEP_BUDGET_MS = 5 * 60_000;

/** What the tutorial's card says right now. */
export type TutorialReading = {
  /** The end card is up. */
  done: boolean;
  /** The step number on the card, 1-based; 0 while there is no card. */
  step: number;
  phase: "frozen" | "cleared" | "active";
};

/** The authored steps' kinds, in order (`content/tutorial.toml`), as the content artifact holds them. */
export function authoredStepKinds(): string[] {
  const artifact = JSON.parse(readFileSync("content/generated/content.json", "utf8")) as {
    content: { tutorial: { steps: { kind: string }[] } };
  };
  return artifact.content.tutorial.steps.map((step) => step.kind);
}

/** Reads the card in one round trip, so its parts agree with each other. */
export function readTutorial(game: Surface): Promise<TutorialReading> {
  return evaluateIn(
    game,
    (): TutorialReading => {
      const has = (id: string): boolean => document.querySelector(`[data-testid="${id}"]`) !== null;
      // The first number on the count's line is the step ("Paso 3 de 6", "3/6").
      const count = document.querySelector('[data-testid="tutorial-step"]')?.textContent ?? "";
      return {
        done: has("tutorial-done"),
        step: Number(/\d+/.exec(count)?.[0] ?? 0),
        phase: has("tutorial-freeze") ? "frozen" : has("tutorial-cleared") ? "cleared" : "active",
      };
    },
  );
}

/** The control that lets a frozen step go: the one the step teaches. */
function unlockKey(kind: string | undefined): string {
  if (kind === "fastFall") return FAST_FALL;
  return LEFT;
}

/** The keys the walk holds, so they can all be let go at a step's end. */
class Hands {
  private readonly held = new Set<string>();

  constructor(private readonly page: Page) {}

  async hold(key: string): Promise<void> {
    if (this.held.has(key)) return;
    this.held.add(key);
    await this.page.keyboard.down(key);
  }

  async lift(key: string): Promise<void> {
    if (!this.held.delete(key)) return;
    await this.page.keyboard.up(key);
  }

  async liftAll(): Promise<void> {
    for (const key of [...this.held]) await this.lift(key);
  }

  /** Holds `keys` and nothing else. */
  async only(...keys: string[]): Promise<void> {
    for (const key of [...this.held]) if (!keys.includes(key)) await this.lift(key);
    for (const key of keys) await this.hold(key);
  }
}

/**
 * Lets a frozen step go: pulses its control until the veil lifts. False if it
 * never did within `within` ms. The pulses are input pacing, not a wait.
 */
export async function letGo(page: Page, game: Surface, kind: string | undefined, within = 20_000): Promise<boolean> {
  const key = unlockKey(kind);
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    const reading = await readTutorial(game);
    if (reading.done || reading.phase !== "frozen") return true;
    await page.keyboard.down(key);
    await page.waitForTimeout(150);
    await page.keyboard.up(key);
    await page.waitForTimeout(150);
  }
  return false;
}

/** Where the sweep is heading and until when. */
type Sweep = { key: string; until: number };

/** A small seeded generator, so a walk's sweeps repeat from run to run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** One bounded stretch of play for an active step; the caller reads the card again after it. */
async function playSlice(page: Page, hands: Hands, kind: string | undefined, sweep: Sweep, random: () => number): Promise<void> {
  switch (kind) {
    case "move":
      // Both directions, as the step asks for: left, then right.
      await hands.only(LEFT);
      await page.waitForTimeout(350);
      await hands.only(RIGHT);
      await page.waitForTimeout(350);
      await hands.liftAll();
      return;
    case "fastFall":
      // Held in the air; a landing lets go of it, so it is pressed again each stretch.
      await hands.only(FAST_FALL);
      await page.waitForTimeout(400);
      await hands.liftAll();
      await page.waitForTimeout(600);
      return;
    default: {
      // A landing, found by sweeping: hold one way for a spell, then pick again. The
      // world wraps at its edges, so a sweep passes under every floor.
      if (Date.now() >= sweep.until) {
        sweep.key = random() < 0.5 ? LEFT : RIGHT;
        sweep.until = Date.now() + 250 + random() * 750;
      }
      await hands.only(sweep.key);
      await page.waitForTimeout(200);
    }
  }
}

/** What `playTutorial` reached. */
export type TutorialOutcome = "done" | "last-step" | "stuck";

/** How `playTutorial` plays. */
export type TutorialPlay = {
  /**
   * Plays the last step too, letting go of it and sweeping, until the end card.
   * By default the walk stops at its frozen card: "last-step".
   */
  throughLast?: boolean;
};

/**
 * Plays from wherever the tutorial is, photographing each step's card as it
 * comes up frozen (`tutorial-step-<n>`), until the end card, the last step's
 * card (not played; see the file's note) or a step that will not clear.
 *
 * `photographed` is the steps already shot, so a step the caller took itself
 * is not taken twice. `kinds` is the authored steps' kinds.
 */
export async function playTutorial(
  walk: { page: Page; game: Surface; notes: Notes; shoot: (screen: string) => Promise<void> },
  kinds: readonly string[],
  photographed: readonly number[] = [],
  play: TutorialPlay = {},
): Promise<TutorialOutcome> {
  const { page, game, notes, shoot } = walk;
  const hands = new Hands(page);
  const shot = new Set(photographed);
  const random = seeded(4);
  const sweep: Sweep = { key: LEFT, until: 0 };
  let step = 0;
  let enteredAt = Date.now();

  try {
    for (;;) {
      const reading = await readTutorial(game);
      if (reading.done) return "done";
      if (reading.step !== step) {
        // A new step starts with every key up, so a held key is never mistaken for a press.
        await hands.liftAll();
        step = reading.step;
        enteredAt = Date.now();
      }
      const kind = kinds[step - 1];

      if (reading.phase === "cleared") {
        await hands.liftAll();
        await page.waitForTimeout(100);
        continue;
      }

      if (reading.phase === "frozen") {
        await hands.liftAll();
        if (step > 0 && !shot.has(step)) {
          shot.add(step);
          if (step <= TUTORIAL_STEPS) await shoot(`tutorial-step-${step}`);
          else notes.add(`the tutorial has a step ${step}, past the ${TUTORIAL_STEPS} the walk's catalogue names; not photographed`);
          // Its card was taken at its freeze; the clock for the step starts when it is let go.
          enteredAt = Date.now();
        }
        if (step >= kinds.length && step > 0 && play.throughLast !== true) return "last-step";
        if (!(await letGo(page, game, kind, 5_000))) await hands.liftAll();
        continue;
      }

      if (Date.now() - enteredAt > STEP_BUDGET_MS) {
        notes.add(`tutorial step ${step} (${kind ?? "unknown"}) was not cleared within ${STEP_BUDGET_MS / 60_000} min of play; skipped on to the end card`);
        return "stuck";
      }
      await playSlice(page, hands, kind, sweep, random);
    }
  } finally {
    await hands.liftAll().catch(() => undefined);
  }
}
