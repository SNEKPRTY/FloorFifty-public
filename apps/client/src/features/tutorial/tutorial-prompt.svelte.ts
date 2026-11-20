/**
 * The tutorial's prompt, mounted once and updated in place.
 *
 * The screen is plain TypeScript and owns no runes, so the prompt's state
 * lives here, as the race HUD's does in `race-hud.svelte.ts`: the screen
 * reports the step index and whether it is done, and the component reads them
 * through getters. The wording follows the player's hand on its own, since
 * the component reads the app's `inputMethod` directly.
 */

import type { TutorialContent } from "@floor-fifty/shared/content/game-content";
import type { TutorialPhase, TutorialStepKind } from "@floor-fifty/shared/level/tutorial";
import { mount, unmount } from "svelte";
import TutorialPrompt from "./TutorialPrompt.svelte";
import type { GlyphAction } from "../i18n/glyphs";
import { GLYPH_MARKER, promptWordsFromText, type PromptWords } from "../race/prompt-words";

export { GLYPH_MARKER, promptWordsFromText, type PromptWords };
import { tutorialPrompt } from "../i18n/content";
import type { InputMethod } from "../platform/input-method.svelte";
import type { SettingsStore } from "../profile/store/settings.svelte";

/** The pad control a step teaches, where one names it; the rest are about timing. */
export const GLYPH_FOR_STEP: Partial<Record<TutorialStepKind, GlyphAction>> = {
  move: "move",
  fastFall: "fastFall",
};

/**
 * The step's prompt for the controls in the player's hand, in their
 * language: on touch, the swipe wording or, where the step has one, the
 * on-screen buttons' wording. On a pad the glyph goes where the prompt
 * names it, or after it.
 */
export function promptWords(
  step: Pick<TutorialContent["steps"][number], "kind" | "prompt">,
  method: InputMethod,
  touchMode: "swipe" | "buttons",
  glyph: string | undefined,
): PromptWords {
  const { prompt } = step;
  const buttons = method === "touch" && touchMode === "buttons" && prompt.buttons !== undefined;
  const chosen = buttons ? "buttons" : method;
  const authored = buttons ? prompt.buttons! : prompt[method];
  return promptWordsFromText(tutorialPrompt(step.kind, chosen, authored, GLYPH_MARKER), glyph);
}

/**
 * `phase` is the step's pacing: `frozen` while the run waits for the player,
 * `cleared` in the beat after they did it.
 */
export type TutorialPromptModel = {
  readonly index: number;
  readonly phase: TutorialPhase;
  readonly done: boolean;
  /**
   * The lava caught her on the last step: its card says so, in place of the
   * step's words, from the catch until she lets the restarted step go.
   */
  readonly caught: boolean;
  /** The pause panel is up: the card is not drawn under it. */
  readonly paused: boolean;
  /** Where the racer and its nameplate are drawn, in viewport pixels: the card hangs clear of it. */
  readonly racer: Readonly<{ left: number; top: number; right: number; bottom: number }> | undefined;
};

export type TutorialPromptOptions = {
  steps: TutorialContent["steps"];
  /** Where the tutorial was opened, which decides what the done card offers. */
  origin: "MainMenu" | "Lobby";
  /** Which touch controls are on, which decides a touch prompt's wording. */
  settings: SettingsStore;
  onSkip: () => void;
  onRaceNow: () => void;
  onBackToTitle: () => void;
};

export class TutorialPromptView {
  private model = $state<TutorialPromptModel>({ index: 0, phase: "frozen", done: false, caught: false, paused: false, racer: undefined });
  private readonly app: Record<string, unknown>;

  constructor(target: HTMLElement, options: TutorialPromptOptions) {
    const view = this;
    this.app = mount(TutorialPrompt, {
      target,
      props: {
        get model() {
          return view.model;
        },
        ...options,
      },
    });
  }

  /** Reports the current step; a no-op when nothing changed, so it may run every frame. */
  update(index: number, phase: TutorialPhase, done: boolean, caught = false): void {
    const { model } = this;
    if (index === model.index && phase === model.phase && done === model.done && caught === model.caught) return;
    this.model = { ...model, index, phase, done, caught };
  }

  /** Hides the card while the pause panel shows. */
  setPaused(paused: boolean): void {
    if (paused !== this.model.paused) this.model = { ...this.model, paused };
  }

  /**
   * Tells the card where the racer is (viewport pixels; undefined clears it),
   * so it can hang under it when it would cover it. Rounded, so it may run
   * every frame without a change that cannot be seen.
   */
  keepClearOf(racer: { left: number; top: number; right: number; bottom: number } | undefined): void {
    const next = racer === undefined ? undefined : { left: Math.round(racer.left), top: Math.round(racer.top), right: Math.round(racer.right), bottom: Math.round(racer.bottom) };
    const last = this.model.racer;
    const same =
      next === last || (next !== undefined && last !== undefined && next.left === last.left && next.top === last.top && next.right === last.right && next.bottom === last.bottom);
    if (!same) this.model = { ...this.model, racer: next };
  }

  destroy(): void {
    void unmount(this.app);
  }
}
