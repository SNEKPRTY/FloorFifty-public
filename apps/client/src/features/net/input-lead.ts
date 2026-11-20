/**
 * How far ahead of the room this client predicts.
 *
 * A frame is stamped with the tick the client predicts it on, and the room
 * holds it until then. For that to line the two sides up, the frame has to
 * *arrive* before the room reaches its tick -- so the client has to be ahead
 * of the room by the time a frame spends getting there, plus enough margin that
 * jitter does not make it late. Too little lead and frames arrive after their
 * tick and are applied late, which is a misprediction. Too much and the racer
 * responds a little further from where the others are drawn, for nothing.
 *
 * The room measures the lead for us. Each ping carries the tick the client was
 * predicting when it sent it, and the pong says how early that was against the
 * room's own clock. Subtracting that slack from the lead the ping was sent
 * with gives the lead that would have arrived exactly on time; the target is
 * the median of those plus a margin that grows with how much they spread.
 *
 * It is an offset on the one clock, not a second one. `RenderClock` still says
 * what time authority is; this only says how far past authority to predict,
 * and it moves only when the room says the link has changed.
 */

import { TICK_MS } from "@floor-fifty/shared/common/constants";

/** A lead a typical home connection needs, until the first pong says otherwise. */
export const INITIAL_LEAD_TICKS = 4;

/**
 * Half a second. The room refuses frames a second ahead; past half of that
 * the link is not one this race can be played on as if local, and leading
 * further only makes every other racer look more behind.
 */
export const MAX_LEAD_TICKS = 30;

/** Probes remembered: five seconds of them at four a second. */
const WINDOW = 20;

/**
 * The least margin, in ticks: two.
 *
 * A probe measures the predicted tick at an arbitrary instant, but a frame for
 * tick `P` goes out on the rendered frame where the predicted tick first
 * reaches `P` -- up to a tick later in the prediction's own time, so up to a
 * tick less early than a probe sent then. And the room takes a frame as on
 * time only if it arrives before it steps that tick, which with the room part
 * way through a tick needs up to one more. Two covers both with no jitter at
 * all; the spread of the probes is added for the jitter.
 */
const MIN_MARGIN_TICKS = 2;
const MAX_MARGIN_TICKS = 8;

/**
 * How fast the lead may change: a tenth of elapsed time, either way.
 *
 * The prediction cannot step backward, so a shorter lead is reached by running
 * it ten percent slow; a longer one by running it ten percent fast rather than
 * leaping, because a leap of several ticks draws the racer bursting forward.
 * Ten percent is the bound `RenderClock` holds its own rate to, well under
 * what reads as a change of speed.
 */
const MAX_SLEW = 0.1;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank]!;
}

/**
 * The lead a known round trip needs, before any slack has been measured.
 *
 * A client's view of authority trails the room by the downstream half of the
 * trip and its frames take the upstream half to arrive, so the round trip in
 * ticks is the lead that lands a frame exactly on time; the margin is the
 * floor a measured lead would add, and one more for jitter nobody has
 * measured yet.
 */
export function leadForRoundTrip(roundTripMs: number | undefined): number {
  if (roundTripMs === undefined || !Number.isFinite(roundTripMs) || roundTripMs < 0) {
    return INITIAL_LEAD_TICKS;
  }
  return clamp(roundTripMs / TICK_MS + MIN_MARGIN_TICKS + 1, 0, MAX_LEAD_TICKS);
}

export class InputLead {
  private current: number;
  private wanted: number;
  private heard = false;

  constructor(initialTicks = INITIAL_LEAD_TICKS) {
    this.current = clamp(initialTicks, 0, MAX_LEAD_TICKS);
    this.wanted = this.current;
  }
  /** The lead each recent probe would have needed to arrive exactly on time. */
  private readonly needed: number[] = [];

  /** The lead to predict at, in ticks. */
  get ticks(): number {
    return this.current;
  }

  /** Where the lead is heading. */
  get target(): number {
    return this.wanted;
  }

  /**
   * One pong: the lead its ping was sent with, and how early it arrived.
   *
   * The first answer is adopted at once when it asks for more lead -- a race
   * that starts short runs every early input late until the lead catches up --
   * and every later change eases.
   */
  observe(leadAtSend: number, slackTicks: number): void {
    if (!Number.isFinite(leadAtSend) || !Number.isFinite(slackTicks)) return;
    this.needed.push(leadAtSend - slackTicks);
    if (this.needed.length > WINDOW) this.needed.shift();

    const sorted = [...this.needed].sort((a, b) => a - b);
    const spread = percentile(sorted, 0.9) - percentile(sorted, 0.1);
    const margin = clamp(MIN_MARGIN_TICKS + spread, MIN_MARGIN_TICKS, MAX_MARGIN_TICKS);
    this.wanted = clamp(percentile(sorted, 0.5) + margin, 0, MAX_LEAD_TICKS);

    if (!this.heard) {
      this.heard = true;
      if (this.wanted > this.current) this.current = this.wanted;
    }
  }

  /** Moves the lead toward its target for one rendered frame, at the slew bound. */
  advance(deltaMs: number): void {
    const step = (deltaMs / TICK_MS) * MAX_SLEW;
    const gap = this.wanted - this.current;
    this.current += Math.max(-step, Math.min(step, gap));
  }
}
