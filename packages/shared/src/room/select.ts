/**
 * The select phase (stage, song and character select spec §5.1).
 *
 * Between the ready room and the countdown, the room walks these steps in
 * order. A pick step collects each seat's focus until everyone has locked in
 * or the clock runs out; its reveal shows the roulette landing; loading waits
 * for every seat to load the chosen content, or 10 s. The song steps follow
 * the stage's (plan 2b.3).
 */

import type { PlayerId } from "../common/ids";

export type SelectStep = "stage" | "stageReveal" | "song" | "songReveal" | "loading";
export type PickKind = "stage" | "song";

export const STEP_ORDER: readonly SelectStep[] = ["stage", "stageReveal", "song", "songReveal", "loading"];
export const PICK_STEP: Readonly<Record<PickKind, SelectStep>> = { stage: "stage", song: "song" };
export const REVEAL_STEP: Readonly<Record<PickKind, SelectStep>> = { stage: "stageReveal", song: "songReveal" };

/** A stage pick's seed (stage seeds spec §2): drawn at the reveal, the stage's authored one, or entered. */
export type SeedChoice = "random" | "classic" | number;
export const SEED_MIN = 0;
export const SEED_MAX = 999_999;
export const SEED_DIGITS = 6;

export function isSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= SEED_MIN && value <= SEED_MAX;
}

/** "#048213": the code a player reads out and enters. */
export function formatSeed(seed: number): string {
  return `#${String(seed).padStart(SEED_DIGITS, "0")}`;
}

/** The schema's string for a choice: the two words, or the number's digits. */
export function seedChoiceToWire(choice: SeedChoice): string {
  return typeof choice === "number" ? String(choice) : choice;
}

/** A schema string back into a choice. Anything unreadable is Random, the default. */
export function seedChoiceFromWire(wire: string): SeedChoice {
  if (wire === "random" || wire === "classic") return wire;
  if (!/^\d{1,6}$/.test(wire)) return "random";
  return Number(wire);
}

/** A seat's focus, whether it has locked in, and its seed choice (the stage step's; carried, unused, by the song's). */
export type SelectPick = { focus: string; locked: boolean; seed: SeedChoice };
export type SelectResult = {
  id: string;
  pickedBy: PlayerId;
  /** A stage's: the seed raced, and whether it is the stage's authored one. */
  seed?: number;
  classic?: boolean;
};

export type SelectState = {
  step: SelectStep;
  endsAtTick: number;
  picks: Record<PlayerId, SelectPick>;
  stage?: SelectResult;
  song?: SelectResult;
  loaded: PlayerId[];
};

export type SelectSnapshot = {
  step: SelectStep;
  endsAtTick: number;
  picks: Readonly<Record<string, SelectPick>>;
  stage?: SelectResult;
  song?: SelectResult;
  loaded: readonly string[];
};

/** The pick kind a step collects, or undefined for a reveal or loading. */
export function pickKindOf(step: SelectStep): PickKind | undefined {
  return (Object.keys(PICK_STEP) as PickKind[]).find((kind) => PICK_STEP[kind] === step);
}

/** The step after `step`, or undefined after loading (the countdown follows). */
export function nextStep(step: SelectStep): SelectStep | undefined {
  return STEP_ORDER[STEP_ORDER.indexOf(step) + 1];
}
