/**
 * Which moment of the race is on screen.
 *
 * Authority arrives at the broadcast rate and the display draws at its own, so
 * something has to decide what time it is between two snapshots. Taking that
 * time from the newest snapshot is the obvious thing and the wrong one: the
 * answer only changes when a packet lands, so every frame in an interval draws
 * the same moment and the picture steps once per snapshot instead of once per
 * frame. Interpolation cannot help, because it is never asked for a moment
 * between two of them, and network jitter reaches the screen directly, because
 * arrival time *is* render time.
 *
 * So the clock runs on rendered time and authority only steers it. Each
 * snapshot re-anchors where authority should be; between snapshots that anchor
 * free-runs at the same nominal rate, so the error between them stays put
 * unless something real moved it -- a server tick that is not quite 60 Hz, a
 * display that is not quite 60 Hz, a packet that came late. Whatever error does
 * accumulate is bled off by running a few percent fast or slow, which corrects
 * drift within a fraction of a second and is far below what a player can see.
 *
 * What the clock integrates is *authority's* tick. Everyone else is drawn an
 * interpolation delay behind it, so the buffer always has a pair to blend
 * between; the local racer is predicted a lead ahead of it. Both are offsets
 * on this one clock. The delay adapts to the link: it is measured from how
 * late snapshots arrive against the clock, and eased, so a jittery connection
 * draws the others a little further back rather than freezing them each time
 * a snapshot runs late. Because the delay is applied to the drawn moment and
 * never to authority, changing it cannot move the input timeline.
 *
 * An anchor is a tick *at a time*. A snapshot says where authority was when it
 * arrived, and a frame asks where authority is when it runs; between the two,
 * wall time passes, and only wall time can say how much. Taking "now" to be
 * the last frame instead double-counted every gap: a race that waited on
 * loading, a tab brought back, or a stall that queued a burst of snapshots
 * all left the clock half a second off and snapping back and forth. So
 * arrivals are timestamped, and whether to snap is decided once per frame
 * against the freshest anchor rather than on each snapshot of a burst.
 *
 * This produces a time, never a position. What is drawn at that time is the
 * snapshot buffer's business, and the clock has no opinion about it.
 */

import { TICK_MS } from "@floor-fifty/shared/common/constants";
import { INTERPOLATION_DELAY_TICKS, SNAPSHOT_INTERVAL_TICKS } from "../../lib/constants";

/**
 * Rate skew per tick of accumulated error.
 *
 * Paired with the cap below this saturates at two ticks of error, which is the
 * point where drift has grown past what one snapshot interval explains.
 */
const CORRECTION_PER_TICK_OF_ERROR = 0.05;

/**
 * The furthest the rate may stray from nominal.
 *
 * Ten percent closes a tick of error in well under a second while staying under
 * the threshold at which a change of speed reads as one.
 */
const MAX_RATE_SKEW = 0.1;

/**
 * Error past which the clock jumps rather than eases.
 *
 * A fifth of a second is far more than jitter or drift can produce and far less
 * than a restarted race, a resumed tab, or a reconnect, so this separates the
 * error worth correcting smoothly from the kind that is really a new race.
 */
const SNAP_TICKS = 12;

/**
 * The longest the others are ever drawn behind authority: a quarter second.
 * Past that the link is not one a race can be watched on smoothly, and a
 * longer delay would only draw every other racer further into the past.
 */
export const MAX_INTERPOLATION_DELAY_TICKS = 15;

/** Arrivals remembered for the jitter estimate: three seconds of snapshots. */
const ARRIVAL_WINDOW = 60;

/**
 * How fast the delay may change: five percent of elapsed time.
 *
 * Half the rate skew's bound, because this one changes how fast every other
 * racer appears to move, and a race watched in slightly slow motion for a
 * moment is better than one that visibly lurches.
 */
const DELAY_SLEW = 0.05;

/** Headroom kept above the latest arrival the window has seen, in ticks. */
const DELAY_MARGIN_TICKS = 0.5;

/**
 * How long every snapshot must say the clock is ahead before it moves back.
 *
 * A snapshot's tick is a lower bound on the room's: it can only have aged in
 * transit, never run ahead. One far *ahead* of the clock therefore proves the
 * clock behind, and the clock jumps at once. One far *behind* proves nothing
 * by itself -- a long task on the page holds snapshots back and then delivers
 * them stamped as fresh, and snapping to one of those threw a correct clock
 * thirty ticks into the past and stamped the next inputs late. Half a second
 * of every snapshot agreeing is a room that really did move its timeline back.
 */
const BACKWARD_SNAP_AFTER_MS = 500;

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank]!;
}

/** A snap, with what the clock saw when it made it, for the anomaly log. */
export type ClockSnap = {
  /** Ticks the clock moved: positive when it had fallen behind authority. */
  jump: number;
  /** Ticks the frame that snapped covered. */
  frameTicks: number;
  /** How long before the frame the anchor it snapped to had arrived, in ms. */
  anchorAgeMs: number;
  /** The anchor's tick. */
  anchorTick: number;
};

export class RenderClock {
  /** Where authority is, on this clock, as of the last frame. Fractional. */
  private authority: number | undefined;
  /** When the last frame ran, on this clock's time source. */
  private lastAdvanceAt = 0;
  /** The newest snapshot's tick and when it arrived: authority, free-running from there. */
  private anchorTick = 0;
  private anchorAt = 0;
  /** The newest tick observed, so a republished snapshot cannot drag the anchor back. */
  private newest = Number.NEGATIVE_INFINITY;
  /** The rate adjustment the last `advance` applied, for diagnostics. */
  private skew = 0;
  /** The last snap, until read: how far it moved the clock and what it saw. */
  private snapped: ClockSnap | undefined;
  /** How far behind authority the room is drawn, and where that is heading. */
  private delay = INTERPOLATION_DELAY_TICKS;
  private delayTarget = INTERPOLATION_DELAY_TICKS;
  /** How far ahead of the clock recent snapshots arrived, in ticks. Negative is late. */
  private readonly arrivals: number[] = [];
  /** Time as the sum of frame deltas, when no time source was given. */
  private virtualTime = 0;
  /** When the clock first ran too far ahead of its anchor, while it still is. */
  private aheadSince: number | undefined;

  /**
   * `now` is the wall clock in milliseconds, `performance.now` in a browser.
   * Without one, time is the sum of the deltas `advance` is given, which is
   * exact for a test that says what time it is by drawing frames.
   */
  constructor(private readonly now?: () => number) {}

  private time(): number {
    return this.now?.() ?? this.virtualTime;
  }

  /** Where the anchor says authority is at time `at`. */
  private anchorAtTime(at: number): number {
    return this.anchorTick + (at - this.anchorAt) / TICK_MS;
  }

  /**
   * Adopts the newest authority tick, re-anchoring the clock against it.
   *
   * It never moves the clock itself. A burst of snapshots queued behind a
   * stall arrives in one go, oldest first, and a clock that jumped to each
   * would snap back to a stale one before snapping forward again; the frame
   * that follows decides against the freshest.
   *
   * A snapshot at or behind the newest already observed changes nothing: the
   * transport republishes a tick when an event batch follows its patch, and
   * re-anchoring on it would pull the clock back by however long it had run.
   * One far behind is a restarted race, and is adopted.
   */
  observe(authorityTick: number, receivedAt?: number): void {
    // When it arrived, which is not always when it is read: a snapshot picked
    // up after the page spent most of a second building a screen is that old
    // already, and anchoring it at "now" started the race that far behind.
    const at = receivedAt ?? this.time();
    if (this.authority === undefined) {
      this.authority = authorityTick;
      this.lastAdvanceAt = at;
      this.anchorTick = authorityTick;
      this.anchorAt = at;
      this.newest = authorityTick;
      return;
    }
    const restarted = authorityTick < this.newest - SNAP_TICKS;
    if (authorityTick <= this.newest && !restarted) return;
    this.newest = authorityTick;

    // How early this arrived against where the clock itself has authority now.
    const clockNow = this.authority + (at - this.lastAdvanceAt) / TICK_MS;
    if (Math.abs(authorityTick - clockNow) <= SNAP_TICKS) {
      this.recordArrival(authorityTick - clockNow);
    }
    this.anchorTick = authorityTick;
    this.anchorAt = at;
  }

  /**
   * One arrival, measured against the clock's own steady estimate.
   *
   * The drawn moment runs `delay` behind that estimate and a snapshot covers
   * the next `SNAPSHOT_INTERVAL_TICKS`, so the buffer runs dry just before
   * the next arrival whenever one arrives later than the delay allows for.
   * The delay is set to cover the late tail of the window -- the spread below
   * its median -- and never less than the fixed delay a perfect link needs.
   */
  private recordArrival(earlyTicks: number): void {
    this.arrivals.push(earlyTicks);
    if (this.arrivals.length > ARRIVAL_WINDOW) this.arrivals.shift();
    const sorted = [...this.arrivals].sort((a, b) => a - b);
    const lateTail = percentile(sorted, 0.5) - percentile(sorted, 0.05);
    const needed = SNAPSHOT_INTERVAL_TICKS + lateTail + DELAY_MARGIN_TICKS;
    this.delayTarget = Math.min(
      MAX_INTERPOLATION_DELAY_TICKS,
      Math.max(INTERPOLATION_DELAY_TICKS, needed),
    );
  }

  /** The moment being drawn, without advancing to the next one. */
  current(): number | undefined {
    return this.authority === undefined ? undefined : this.authority - this.delay;
  }

  /** How far the clock's authority trails its anchor, in ticks. Zero before a race. */
  get error(): number {
    return this.authority === undefined
      ? 0
      : this.anchorAtTime(this.lastAdvanceAt) - this.authority;
  }

  /** The fractional rate adjustment the last frame ran at. */
  get rateSkew(): number {
    return this.skew;
  }

  /** How far behind authority everyone else is drawn, in ticks. */
  get interpolationDelay(): number {
    return this.delay;
  }

  /**
   * How far the clock last jumped rather than eased, once; undefined if it has
   * not since the last read. A snap mid-race is a hitch on screen, so it is
   * counted, but nothing decides anything from it.
   */
  takeSnap(): ClockSnap | undefined {
    const snapped = this.snapped;
    this.snapped = undefined;
    return snapped;
  }

  /**
   * Where authority is now, on this same clock.
   *
   * An estimate of the room's own tick, carried on a rate this clock has
   * already matched to authority's real one. The prediction reads this rather
   * than counting rendered frames itself. A count of frames is a second opinion
   * about what time it is, and the two diverge for as long as a race lasts:
   * a room does not deliver exactly sixty ticks a second and a display does not
   * always draw sixty frames, so the difference is a lead that grows until
   * something bounds it. There is one clock, and authority steers it.
   */
  authorityTick(): number | undefined {
    return this.authority;
  }

  /**
   * Advances to this frame and returns the moment to draw.
   *
   * With a time source the frame's length is read from it; `deltaMs` is the
   * length otherwise. Undefined until the first snapshot, because before one
   * there is no race to be at a moment of.
   */
  advance(deltaMs: number): number | undefined {
    if (this.authority === undefined) return undefined;
    if (this.now === undefined) this.virtualTime += deltaMs;
    const at = this.time();
    const ticks = Math.max(0, at - this.lastAdvanceAt) / TICK_MS;

    // Where this frame would put authority at the nominal rate, against where
    // the freshest anchor puts it at the same instant. Both have moved by the
    // frame, so neither gets a head start over the other.
    const projected = this.authority + ticks;
    const behind = this.anchorAtTime(at) - projected;
    this.lastAdvanceAt = at;

    if (behind < -SNAP_TICKS) {
      this.aheadSince ??= at;
    } else {
      this.aheadSince = undefined;
    }
    const believedAhead =
      this.aheadSince !== undefined && at - this.aheadSince >= BACKWARD_SNAP_AFTER_MS;

    if (behind < -SNAP_TICKS && !believedAhead) {
      // Probably a late delivery: run on at the nominal rate and wait for the
      // next snapshot to say whether the clock really is ahead.
      this.skew = 0;
      this.authority = projected;
    } else if (Math.abs(behind) > SNAP_TICKS) {
      // Too far to ease: a resumed tab, a stall, a new race. Land exactly
      // where the freshest anchor says authority is now.
      this.aheadSince = undefined;
      const target = this.anchorAtTime(at);
      this.snapped = {
        jump: target - this.authority,
        frameTicks: ticks,
        anchorAgeMs: at - this.anchorAt,
        anchorTick: this.anchorTick,
      };
      this.authority = target;
      this.skew = 0;
      // Whatever the window measured belonged to the time before the jump.
      this.arrivals.length = 0;
    } else {
      const skew = clamp(behind * CORRECTION_PER_TICK_OF_ERROR, MAX_RATE_SKEW);
      this.skew = skew;
      // The correction closes the error and never passes it: a long frame at a
      // skewed rate would otherwise overshoot by a tenth of the frame.
      const correction = Math.min(Math.abs(behind), Math.abs(ticks * skew));
      this.authority = projected + Math.sign(behind) * correction;
    }

    const step = ticks * DELAY_SLEW;
    this.delay += Math.max(-step, Math.min(step, this.delayTarget - this.delay));
    return this.current();
  }

  /** Forgets the race, as leaving the screen does. */
  clear(): void {
    this.authority = undefined;
    this.lastAdvanceAt = 0;
    this.anchorTick = 0;
    this.anchorAt = 0;
    this.newest = Number.NEGATIVE_INFINITY;
    this.skew = 0;
    this.snapped = undefined;
    this.delay = INTERPOLATION_DELAY_TICKS;
    this.delayTarget = INTERPOLATION_DELAY_TICKS;
    this.arrivals.length = 0;
    this.virtualTime = 0;
    this.aheadSince = undefined;
  }
}
