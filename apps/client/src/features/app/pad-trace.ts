/**
 * The last few things the pad did, logged whenever fullscreen changes.
 *
 * On Safari the pad has knocked the page out of fullscreen and the path was
 * never reproduced. This names it the next time: every fullscreen change
 * logs `[ff:pad]` with the pad's recent events and what each one had focus.
 * Off in production unless `?padtrace` is in the URL.
 */

import { VISUAL_INSPECTION_ENABLED } from "../render/inspection";

export type PadTraceEntry = { at: number; event: string; target?: string };

/**
 * Dev and inspection builds trace; a production build never does, whatever
 * its address says (release readiness D-G8).
 */
export function padTraceEnabled(enabled: boolean = VISUAL_INSPECTION_ENABLED): boolean {
  return enabled;
}

export class PadTrace {
  private readonly entries: PadTraceEntry[] = [];

  constructor(private readonly size = 16) {}

  /** Notes one pad event, with the test id of whatever had focus when it came. */
  record(event: string, at: number = performance.now()): void {
    const target = (document.activeElement as HTMLElement | null)?.dataset?.["testid"];
    this.entries.push(target === undefined ? { at, event } : { at, event, target });
    if (this.entries.length > this.size) this.entries.shift();
  }

  recent(): readonly PadTraceEntry[] {
    return [...this.entries];
  }

  /** Logs the recent events on every fullscreen change; returns the detach. */
  attach(doc: Document = document, log: (...args: unknown[]) => void = console.info): () => void {
    const onChange = (): void =>
      log("[ff:pad]", doc.fullscreenElement == null ? "left fullscreen" : "entered fullscreen", this.recent());
    doc.addEventListener("fullscreenchange", onChange);
    return () => doc.removeEventListener("fullscreenchange", onChange);
  }
}
