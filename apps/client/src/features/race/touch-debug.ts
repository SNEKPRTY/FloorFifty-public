/**
 * Touch diagnostics, for the iPad's slam swipe inside Ruken (2026-10-10).
 *
 * Off unless the page is opened with `?touchdebug` or the build sets
 * `VITE_TOUCH_DEBUG`. Inside Ruken the game's address has no query of its own,
 * so a test build sets the flag. Then a small panel over the game, which ignores
 * touches, shows every pointer and touch event the game receives (including
 * the browser cancelling one), each finger's stroke summary when it lifts, and
 * every action the swipe controls emit.
 *
 * The slam is a downward flick: `SWIPE.flickPx` within `SWIPE.flickMs`. So a
 * stroke reports how many moves arrived, the largest gap between them, and the
 * fastest drop seen inside that window: if moves arrive late or in big jumps,
 * the flick is never recognised even though the finger moved far enough.
 */

import { CLIENT_BUILD } from "../../lib/build-facts";
import { SWIPE } from "./swipe-tracker";

export function readTouchDebug(search: string, buildFlag: string | undefined): boolean {
  if (new URLSearchParams(search).has("touchdebug")) return true;
  return buildFlag !== undefined && buildFlag !== "" && buildFlag !== "0";
}

export type StrokeSummary = {
  id: number;
  moves: number;
  durationMs: number;
  largestGapMs: number;
  bestDropPx: number;
};

type Stroke = { startT: number; lastT: number; moves: number; largestGapMs: number; bestDropPx: number; samples: { y: number; t: number }[] };

/** Per-finger bookkeeping, with no DOM in it. */
export class StrokeLog {
  private readonly strokes = new Map<number, Stroke>();

  down(id: number, y: number, t: number): void {
    this.strokes.set(id, { startT: t, lastT: t, moves: 0, largestGapMs: 0, bestDropPx: 0, samples: [{ y, t }] });
  }

  move(id: number, y: number, t: number): void {
    const stroke = this.strokes.get(id);
    if (stroke === undefined) return;
    stroke.moves += 1;
    stroke.largestGapMs = Math.max(stroke.largestGapMs, t - stroke.lastT);
    stroke.lastT = t;
    this.measure(stroke, y, t);
  }

  private measure(stroke: Stroke, y: number, t: number): void {
    stroke.samples.push({ y, t });
    stroke.samples = stroke.samples.filter((sample) => t - sample.t <= SWIPE.flickMs);
    const highest = Math.min(...stroke.samples.map((sample) => sample.y));
    stroke.bestDropPx = Math.max(stroke.bestDropPx, y - highest);
  }

  /** A coalesced sample inside a move event: it counts toward the drop, not toward the moves. */
  sample(id: number, y: number, t: number): void {
    const stroke = this.strokes.get(id);
    if (stroke === undefined) return;
    stroke.largestGapMs = Math.max(stroke.largestGapMs, t - stroke.lastT);
    stroke.lastT = t;
    this.measure(stroke, y, t);
  }

  up(id: number, t: number): StrokeSummary | undefined {
    return this.end(id, t);
  }

  cancel(id: number, t: number): StrokeSummary | undefined {
    return this.end(id, t);
  }

  private end(id: number, t: number): StrokeSummary | undefined {
    const stroke = this.strokes.get(id);
    if (stroke === undefined) return undefined;
    this.strokes.delete(id);
    return {
      id,
      moves: stroke.moves,
      durationMs: Math.round(t - stroke.startT),
      largestGapMs: Math.round(Math.max(stroke.largestGapMs, t - stroke.lastT)),
      bestDropPx: Math.round(stroke.bestDropPx),
    };
  }
}

type TouchDebug = { note(line: string): void };

/** The panel, as `startTouchDebug` returns it: `text` and `stop` are for its tests. */
export type TouchDebugPanel = TouchDebug & { text(): string; stop(): void };

/** The page's touch diagnostics, or undefined when they are off. */
export const touchDebug: TouchDebug | undefined = (() => {
  if (typeof window === "undefined") return undefined;
  const flag = (import.meta.env as Record<string, string | undefined>)["VITE_TOUCH_DEBUG"];
  if (!readTouchDebug(window.location.search, flag)) return undefined;
  // The flag's value is shown too, so a test build can carry a label (`VITE_TOUCH_DEBUG=ab12cd3`)
  // that proves on the device which build is running.
  return startTouchDebug(window, `${CLIENT_BUILD.buildId} ${flag ?? "?touchdebug"}`);
})();

type Sample = { clientY: number; timeStamp: number };
type TouchPoint = { identifier: number; clientY: number };

/**
 * WebKit may batch several finger positions into one pointermove; the extra ones are only in
 * `getCoalescedEvents()` (where the browser has it). Without them the move event alone stands.
 */
function samplesOf(event: PointerEvent): Sample[] {
  const coalesced = (event as Partial<Pick<PointerEvent, "getCoalescedEvents">>).getCoalescedEvents?.() ?? [];
  return coalesced.length > 0 ? coalesced : [event];
}

export function startTouchDebug(win: Window, buildId: string): TouchDebugPanel {
  const pre = win.document.createElement("pre");
  pre.setAttribute("data-testid", "touch-debug");
  Object.assign(pre.style, {
    position: "fixed",
    left: "0",
    top: "0",
    maxWidth: "60vw",
    maxHeight: "45vh",
    overflow: "hidden",
    margin: "0",
    padding: "4px",
    font: "11px/1.3 monospace",
    color: "#7CFC7C",
    background: "rgba(0,0,0,0.6)",
    pointerEvents: "none",
    zIndex: "2147483647",
    whiteSpace: "pre-wrap",
  });
  const lines: string[] = [];
  const started = win.performance.now();
  const note = (line: string): void => {
    lines.push(`[${((win.performance.now() - started) / 1000).toFixed(2)}s] ${line}`);
    if (lines.length > 40) lines.shift();
    pre.textContent = lines.join("\n");
    console.info(`[touch] ${line}`);
  };
  const attach = (): void => {
    win.document.body.append(pre);
  };
  if (win.document.body === null) win.addEventListener("DOMContentLoaded", attach, { once: true });
  else attach();

  // Each finger is followed twice: by its pointer events (what the swipe uses) and by its touch
  // events. If WebKit cancels the pointer but the touch events keep coming, the touch line still
  // shows how far the finger really dropped.
  const strokes = new StrokeLog();
  const touchStrokes = new StrokeLog();
  const pointerSamples = new Map<number, number>();
  const summary = (s: StrokeSummary | undefined): string =>
    s === undefined
      ? ""
      : ` moves=${s.moves} dur=${s.durationMs}ms maxGap=${s.largestGapMs}ms bestDrop${SWIPE.flickMs}ms=${s.bestDropPx}px (need ${SWIPE.flickPx})`;
  const where = (event: PointerEvent): string => `#${event.pointerId} ${event.pointerType} y=${Math.round(event.clientY)}`;
  const ended = (event: PointerEvent, s: StrokeSummary | undefined): string => {
    const samples = pointerSamples.get(event.pointerId) ?? 0;
    pointerSamples.delete(event.pointerId);
    if (s === undefined) return "";
    return ` moves=${s.moves} samples=${samples}${summary(s).replace(` moves=${s.moves}`, "")}`;
  };

  const listeners: [string, EventListener, AddEventListenerOptions][] = [];
  const on = <E extends Event>(type: string, listener: (event: E) => void, options: AddEventListenerOptions): void => {
    listeners.push([type, listener as EventListener, options]);
    win.addEventListener(type, listener as EventListener, options);
  };

  // Capture phase on the window, so every event is seen before the game's own handlers.
  const capture = { capture: true };
  on<PointerEvent>("pointerdown", (e) => {
    strokes.down(e.pointerId, e.clientY, e.timeStamp);
    pointerSamples.set(e.pointerId, 0);
    note(`pointerdown ${where(e)}`);
  }, capture);
  on<PointerEvent>("pointermove", (e) => {
    const samples = samplesOf(e);
    pointerSamples.set(e.pointerId, (pointerSamples.get(e.pointerId) ?? 0) + samples.length);
    // The stroke counts one move per event, but measures the drop over every coalesced sample.
    for (const [index, sample] of samples.entries()) {
      if (index === 0) strokes.move(e.pointerId, sample.clientY, sample.timeStamp);
      else strokes.sample(e.pointerId, sample.clientY, sample.timeStamp);
    }
  }, capture);
  on<PointerEvent>("pointerup", (e) => note(`pointerup ${where(e)}${ended(e, strokes.up(e.pointerId, e.timeStamp))}`), capture);
  on<PointerEvent>("pointercancel", (e) => note(`POINTERCANCEL ${where(e)}${ended(e, strokes.cancel(e.pointerId, e.timeStamp))}`), capture);
  on<PointerEvent>("lostpointercapture", (e) => note(`lostpointercapture #${e.pointerId}`), capture);

  const passiveCapture = { capture: true, passive: true };
  const changed = (e: TouchEvent): TouchPoint[] => Array.from(e.changedTouches as ArrayLike<TouchPoint>);
  on<TouchEvent>("touchstart", (e) => {
    for (const t of changed(e)) touchStrokes.down(t.identifier, t.clientY, e.timeStamp);
    note(`touchstart touches=${e.touches.length} cancelable=${e.cancelable}`);
  }, passiveCapture);
  on<TouchEvent>("touchmove", (e) => {
    for (const t of changed(e)) touchStrokes.move(t.identifier, t.clientY, e.timeStamp);
  }, passiveCapture);
  for (const type of ["touchend", "touchcancel"] as const) {
    on<TouchEvent>(type, (e) => {
      for (const t of changed(e)) {
        const label = type === "touchcancel" ? "TOUCHCANCEL" : type;
        note(`${label} #${t.identifier}${summary(touchStrokes.up(t.identifier, e.timeStamp))}`);
      }
    }, passiveCapture);
  }
  on("resize", () => note(`resize ${win.innerWidth}x${win.innerHeight}`), {});
  on("blur", () => note("window blur"), {});
  on("focus", () => note("window focus"), {});
  const visibility = (): void => note(`visibility ${win.document.visibilityState}`);
  win.document.addEventListener("visibilitychange", visibility);
  note(`touch debug on, build ${buildId}: ${win.navigator.userAgent} maxTouchPoints=${win.navigator.maxTouchPoints}`);
  return {
    note,
    text: () => pre.textContent ?? "",
    stop: () => {
      for (const [type, listener, options] of listeners) win.removeEventListener(type, listener, options);
      win.document.removeEventListener("visibilitychange", visibility);
      pre.remove();
    },
  };
}
