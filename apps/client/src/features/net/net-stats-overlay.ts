/**
 * The netcode overlay.
 *
 * A developer's instrument, not a player's HUD: a small block of monospace
 * numbers in the corner, drawn in the DOM so it costs the canvas nothing and
 * can be read in a screenshot. `?netstats` in the address shows it from the
 * start and `F3` toggles it in a race.
 *
 * It reads the diagnostics summary and nothing else. Hiding it detaches the
 * console sink too, so a player who never opens it never pays for a log line.
 */

import type { NetDiagnostics, NetSummary } from "./net-diagnostics";
import { VISUAL_INSPECTION_ENABLED } from "../render/inspection";

/** How often the numbers are rewritten. Faster than this is unreadable anyway. */
const REFRESH_MS = 250;

/**
 * Whether the page asked for the overlay up front. Only a dev or inspection
 * build reads the address (release readiness D-G8); the call site also gates
 * on the build, so a production bundle drops this function entirely.
 */
export function netStatsRequested(
  search: string = globalThis.location?.search ?? "",
  debug: boolean = VISUAL_INSPECTION_ENABLED,
): boolean {
  return debug && new URLSearchParams(search).has("netstats");
}

declare global {
  interface Window {
    /**
     * The live netcode summary, as plain data.
     *
     * Present in every build while a race is mounted. It reads; there is no
     * route from the returned object back into the race.
     */
    __ffNet?: () => NetSummary;
  }
}

/** Publishes `read` as `window.__ffNet` and returns the release. */
export function installNetReader(read: () => NetSummary, target: Window = window): () => void {
  target.__ffNet = read;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (target.__ffNet === read) delete target.__ffNet;
  };
}

const f = (value: number, digits = 1): string => value.toFixed(digits);

/** The summary as the overlay's lines. Exported so a test can read what a developer would. */
export function formatNetSummary(summary: NetSummary): string {
  const { snapshots, clock, buffer, prediction, input, frame, wire } = summary;
  const underrunPct = buffer.frames === 0 ? 0 : (buffer.underruns / buffer.frames) * 100;
  const standDowns = Object.entries(prediction.standDowns)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(", ");
  return [
    `rtt ${f(input.rttMs.p50, 0)}ms p90 ${f(input.rttMs.p90, 0)}  ` +
      `lead ${f(input.leadTicks)}t (target ${f(input.leadTarget)})  slack ${f(input.slackTicks.min)}..${f(input.slackTicks.p90)}t`,
    `snap every ${f(snapshots.intervalMs.p50)}ms p99 ${f(snapshots.intervalMs.p99)}  ` +
      `step ${f(snapshots.tickStep.p50, 0)}t  dup ${snapshots.duplicates} reorder ${snapshots.reordered}`,
    `clock err p99 ${f(clock.errorTicks.p99, 2)}t  skew p99 ${f(clock.skew.p99 * 100)}%  ` +
      `snaps ${clock.snaps}  others ${f(clock.delayTicks)}t behind`,
    `buffer headroom min ${f(buffer.headroomTicks.min)}t p50 ${f(buffer.headroomTicks.p50)}t  ` +
      `underrun ${f(underrunPct)}%`,
    `mispredict p50 ${f(prediction.misprediction.p50, 2)} p99 ${f(prediction.misprediction.p99, 2)} ` +
      `max ${f(prediction.misprediction.lifetimeMax)}  adopts ${prediction.adopts}`,
    `offset p99 ${f(prediction.offset.p99, 2)}  replay ${f(prediction.replayTicks.p50, 0)}t ` +
      `(${f(prediction.replayMs.p99, 2)}ms p99)  rebuild ${f(prediction.rebuildMs.p99, 2)}ms p99`,
    `frame p50 ${f(frame.frameMs.p50)}ms p99 ${f(frame.frameMs.p99)}  draw p99 ${f(frame.drawMs.p99, 2)}ms  ` +
      `long ${frame.longFrames}`,
    `in ${f(wire.bytesPerSecond / 1024, 2)} KiB/s  sent ${input.sent}` +
      (standDowns === "" ? "" : `  stood down: ${standDowns}`),
  ].join("\n");
}

export class NetStatsOverlay {
  private readonly element: HTMLPreElement;
  private visible = false;
  private lastRender = Number.NEGATIVE_INFINITY;

  constructor(
    host: HTMLElement,
    private readonly diagnostics: NetDiagnostics,
    private readonly log: (line: string) => void = (line) => console.info(line),
  ) {
    const element = document.createElement("pre");
    element.dataset["testid"] = "net-stats";
    element.setAttribute("aria-hidden", "true");
    Object.assign(element.style, {
      position: "absolute",
      left: "8px",
      bottom: "8px",
      margin: "0",
      padding: "6px 8px",
      font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
      color: "#e8f1ff",
      background: "rgba(5, 6, 13, 0.78)",
      borderRadius: "4px",
      pointerEvents: "none",
      zIndex: "50",
      whiteSpace: "pre",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    this.element = element;
    host.appendChild(element);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.style.display = visible ? "block" : "none";
    this.diagnostics.setLog(visible ? this.log : undefined);
    this.lastRender = Number.NEGATIVE_INFINITY;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  /** Rewrites the numbers, at most four times a second. Called once per frame. */
  update(now: number = performance.now()): void {
    if (!this.visible || now - this.lastRender < REFRESH_MS) return;
    this.lastRender = now;
    this.element.textContent = formatNetSummary(this.diagnostics.summary());
  }

  destroy(): void {
    this.diagnostics.setLog(undefined);
    this.element.remove();
  }
}
