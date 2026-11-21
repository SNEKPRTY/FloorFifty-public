/**
 * Talk at the pace of the climb: one line at a time, and never behind it.
 *
 * A line stands `max(2.5 s, 60 ms a character)`. The next waits for it, but
 * lines of an older beat that have not been shown when a newer beat fires are
 * dropped, so the words always belong to where the player is. The exception
 * is a beat that teaches a move: its lines are the reason for the move, so
 * they wait their turn and are never dropped. The clock is the
 * run's own (it stops while paused), injected so a test steps it by hand.
 */

export const MIN_LINE_MS = 2500;
export const MS_PER_CHARACTER = 60;

/** The longest a line from before the goal stays once the chapter is done. */
export const FINISH_CUT_MS = 1200;

export const lineHoldMs = (text: string): number => Math.max(MIN_LINE_MS, MS_PER_CHARACTER * text.length);

export type TalkLine = { readonly speaker: string | undefined; readonly text: string };

export class StoryTalk<Line extends TalkLine = TalkLine> {
  private current: { line: Line; until: number } | undefined;
  private queue: { line: Line; keep: boolean }[] = [];

  /**
   * A beat fired: its lines replace anything still waiting, except the waiting
   * lines of a beat that teaches (`teaches`), which stay ahead of the new ones.
   */
  say(lines: readonly Line[], teaches = false): void {
    this.queue = [...this.queue.filter((entry) => entry.keep), ...lines.map((line) => ({ line, keep: teaches }))];
  }

  /** The line to show at `nowMs`, advancing past one whose time is up. */
  update(nowMs: number): Line | undefined {
    if (this.current !== undefined && nowMs >= this.current.until) this.current = undefined;
    if (this.current === undefined) {
      const next = this.queue.shift()?.line;
      if (next !== undefined) this.current = { line: next, until: nowMs + lineHoldMs(next.text) };
    }
    return this.current?.line;
  }

  /**
   * The chapter is done: every line still waiting is dropped, so the results
   * follow the goal's own words (said after this), never a stretch of old
   * talk (review R8). The line showing ends in at most `FINISH_CUT_MS`.
   */
  finish(nowMs: number): void {
    this.queue = [];
    if (this.current !== undefined) this.current = { ...this.current, until: Math.min(this.current.until, nowMs + FINISH_CUT_MS) };
  }

  /** Nothing showing and nothing waiting. */
  get idle(): boolean {
    return this.current === undefined && this.queue.length === 0;
  }

  clear(): void {
    this.current = undefined;
    this.queue = [];
  }
}
