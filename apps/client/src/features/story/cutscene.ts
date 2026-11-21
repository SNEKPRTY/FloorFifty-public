/**
 * The cutscene player's model (story mode v2 spec, "The cutscene player"):
 * which panel and line are up, how much of the line has typed, and whether
 * it is over. Pure and driven from outside -- a clock steps it, presses move
 * it -- so a test runs it in Node with no picture and no timers.
 *
 * - A line types at 40 characters a second; `ui.tick` sounds every third.
 * - The first press finishes the line; the next goes on. Nothing advances by itself.
 * - One skip ends the cutscene.
 * - Under reduced motion a line shows whole at once.
 * - A panel's move (its pan or push) runs over the time its lines take to
 *   type and be read, and holds at its end after that.
 */

import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type { StoryPanelMove } from "@floor-fifty/shared/content/game-content";

export const TYPE_PER_SECOND = 40;
export const TICK_EVERY = 3;
/** The read time a panel's move allows each line, past its typing. */
export const READ_MS = 1800;

export type CutsceneSource = { readonly panels: readonly { readonly lines: readonly { readonly text: string }[] }[] };

export class CutscenePlayer {
  private panelIndex = 0;
  private lineIndex = 0;
  private typed = 0;
  private panelElapsedMs = 0;
  private over = false;
  private skippedIt = false;

  constructor(
    private readonly source: CutsceneSource,
    private readonly reduced: boolean,
  ) {
    if (source.panels.length === 0 || source.panels.every((panel) => panel.lines.length === 0)) this.over = true;
    else this.skipEmptyPanels();
  }

  get panel(): number {
    return this.panelIndex;
  }

  get line(): number {
    return this.lineIndex;
  }

  /** The line up now, whole. */
  get text(): string {
    return this.source.panels[this.panelIndex]?.lines[this.lineIndex]?.text ?? "";
  }

  /** How many characters of the line show. */
  get shown(): number {
    return this.reduced ? this.text.length : Math.min(this.text.length, Math.floor(this.typed));
  }

  /** The line is all there, and the next press goes on. */
  get whole(): boolean {
    return this.shown >= this.text.length;
  }

  get done(): boolean {
    return this.over;
  }

  /** Whether it ended by a skip rather than by its last line. */
  get skipped(): boolean {
    return this.skippedIt;
  }

  /** How far through its move the panel is, 0 to 1 (0 under reduced motion: the panel holds still). */
  get moveShare(): number {
    if (this.reduced) return 0;
    const lines = this.source.panels[this.panelIndex]?.lines ?? [];
    const spanMs = lines.reduce((sum, line) => sum + (line.text.length / TYPE_PER_SECOND) * 1000 + READ_MS, 0);
    return spanMs <= 0 ? 1 : Math.min(1, this.panelElapsedMs / spanMs);
  }

  /** Steps the clock; returns how many `ui.tick`s are due (one each third character typed). */
  advance(ms: number): number {
    if (this.over || ms <= 0) return 0;
    this.panelElapsedMs += ms;
    if (this.reduced || this.whole) return 0;
    const before = Math.floor(this.typed);
    this.typed = Math.min(this.text.length, this.typed + (ms / 1000) * TYPE_PER_SECOND);
    const after = Math.floor(this.typed);
    return Math.floor(after / TICK_EVERY) - Math.floor(before / TICK_EVERY);
  }

  /** A press: finishes the line, or goes on to the next (and past the last, ends). */
  press(): void {
    if (this.over) return;
    if (!this.whole) {
      this.typed = this.text.length;
      return;
    }
    this.typed = 0;
    const lines = this.source.panels[this.panelIndex]!.lines;
    if (this.lineIndex + 1 < lines.length) {
      this.lineIndex += 1;
      return;
    }
    this.panelIndex += 1;
    this.lineIndex = 0;
    this.panelElapsedMs = 0;
    this.skipEmptyPanels();
  }

  skip(): void {
    if (this.over) return;
    this.over = true;
    this.skippedIt = true;
  }

  private skipEmptyPanels(): void {
    while (this.panelIndex < this.source.panels.length && this.source.panels[this.panelIndex]!.lines.length === 0) this.panelIndex += 1;
    if (this.panelIndex >= this.source.panels.length) {
      this.over = true;
      this.panelIndex = this.source.panels.length - 1;
    }
  }
}

/** A cutscene's line as the player shows it: in the player's language, with its speaker's name, colour and portrait. */
export type CutsceneLineView = {
  readonly speaker?: string | undefined;
  readonly colour?: SeatColour | undefined;
  readonly portrait?: string | undefined;
  readonly text: string;
};

/** A panel as the player shows it: its picture's address (undefined when it has none), its move, and its lines. */
export type CutscenePanelView = {
  readonly src: string | undefined;
  readonly move: StoryPanelMove;
  readonly glims: boolean;
  readonly lines: readonly CutsceneLineView[];
};
