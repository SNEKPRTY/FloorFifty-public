/**
 * The Instructions carousel's six slides, in the order a player is taught
 * them (story-mode spec, "Instructions"): each one demo and one caption.
 * The demo aliases are rows in the `demos` bundle, fetched by URL when the
 * carousel opens and by nothing else.
 */

import * as m from "../../paraglide/messages.js";
import type { ChipKind } from "./control-chip";

export type InstructionsSlide = {
  readonly id: "steer" | "bounce" | "dropFast" | "movingFloors" | "lava" | "race";
  /** The demo clip's alias, and its still's. */
  readonly clip: string;
  readonly still: string;
  /** A slide that names a control reads its control prompt for the hand in use. */
  readonly prompt?: ChipKind;
  /** The words of a slide that names no control. */
  readonly caption?: () => string;
};

export const INSTRUCTION_SLIDES: readonly InstructionsSlide[] = [
  { id: "steer", clip: "demo.steer", still: "demo.steerStill", prompt: "move" },
  { id: "bounce", clip: "demo.bounce", still: "demo.bounceStill", caption: () => m.instructions_caption_bounce() },
  { id: "dropFast", clip: "demo.dropFast", still: "demo.dropFastStill", prompt: "fastFall" },
  { id: "movingFloors", clip: "demo.movingFloors", still: "demo.movingFloorsStill", caption: () => m.instructions_caption_moving() },
  { id: "lava", clip: "demo.lava", still: "demo.lavaStill", caption: () => m.instructions_caption_lava() },
  { id: "race", clip: "demo.race", still: "demo.raceStill", caption: () => m.instructions_caption_race() },
];

/** Where a step lands: never before the first slide or past the last. */
export function slideAfter(index: number, step: -1 | 1, count = INSTRUCTION_SLIDES.length): number {
  return Math.min(count - 1, Math.max(0, index + step));
}
