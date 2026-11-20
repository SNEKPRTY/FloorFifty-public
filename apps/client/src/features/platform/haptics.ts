/**
 * Haptics (A/V polish plan, G1): a controller's rumble, or a phone's buzz.
 *
 * Feel is the half of feedback a screen and a speaker cannot give: a slam is
 * felt in the hands as well as seen. Where it goes:
 *
 * - A connected pad with an actuator (the W3C `vibrationActuator`, Chrome and
 *   Edge today) gets a `dual-rumble`: the heavy motor for weight, the light
 *   one for snap. The first such pad, if there are several.
 * - Otherwise a touch screen with `navigator.vibrate` (Android; iOS Safari has
 *   none) gets a short buzz -- but never for a landing, which comes more than
 *   once a second and would turn the phone into a hum.
 * - Otherwise nothing, and nothing fails.
 *
 * The player's `input.rumble` setting turns it all off. Haptics are not
 * motion, so reduced motion leaves them alone. Nothing here reads into the
 * race: like the juice, it only answers what is already drawn.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";

export type HapticKind = "land" | "slam" | "fall" | "lap" | "finish" | "win";

/** A pad's dual-rumble per kind: milliseconds, and each motor's strength from 0 to 1. */
export const PAD_EFFECTS: Readonly<Record<HapticKind, { readonly duration: number; readonly strong: number; readonly weak: number }>> = {
  land: { duration: 24, strong: 0, weak: 0.16 },
  slam: { duration: 90, strong: 0.6, weak: 0.4 },
  fall: { duration: 180, strong: 0.45, weak: 0.65 },
  lap: { duration: 110, strong: 0.3, weak: 0.55 },
  finish: { duration: 220, strong: 0.55, weak: 0.55 },
  win: { duration: 420, strong: 1, weak: 0.8 },
};

/** A phone's buzz per kind, in `navigator.vibrate`'s terms; none for a landing. */
export const PHONE_PATTERNS: Readonly<Record<HapticKind, number | readonly number[] | undefined>> = {
  land: undefined,
  slam: 18,
  fall: 45,
  lap: [20, 50, 20],
  finish: 35,
  win: [40, 60, 90],
};

/** What a frame of the juice answered, as much as haptics reads. */
export type HapticFrame = {
  readonly moments: readonly { readonly kind: string; readonly playerId: PlayerId }[];
  readonly reached: readonly RaceEvent[];
};

/**
 * The pulses one frame earns, in order. Only the local racer's moments and
 * events: a rival's slam is seen, not felt. A slam replaces the landing under
 * it, as its sound does.
 */
export function hapticsFor(frame: HapticFrame, localId: PlayerId | undefined): HapticKind[] {
  if (localId === undefined) return [];
  const kinds: HapticKind[] = [];
  const mine = frame.moments.filter((moment) => moment.playerId === localId);
  if (mine.some((moment) => moment.kind === "slam")) kinds.push("slam");
  else if (mine.some((moment) => moment.kind === "bounce")) kinds.push("land");
  for (const event of frame.reached) {
    if (event.type === "lapCompleted" && event.playerId === localId) kinds.push("lap");
    else if ((event.type === "playerReset" || event.type === "playerOut") && event.playerId === localId) kinds.push("fall");
    else if (event.type === "raceFinished") kinds.push(event.winnerId === localId ? "win" : "finish");
  }
  return kinds;
}

type Actuator = {
  playEffect(type: "dual-rumble", params: { duration: number; strongMagnitude: number; weakMagnitude: number; startDelay: number }): Promise<unknown>;
};
type PadLike = { readonly connected: boolean; readonly index: number; readonly vibrationActuator?: Actuator | null };

export type HapticsOptions = {
  /** The player's `input.rumble` setting, read at the moment of use. */
  readonly enabled: () => boolean;
  readonly getGamepads?: () => readonly (PadLike | null)[];
  /** `navigator.vibrate`, where the browser has it. */
  readonly vibrate?: (pattern: number | number[]) => boolean;
  /** Whether this is a touch screen, which a phone's buzz is for. */
  readonly touch: () => boolean;
};

export class Haptics {
  constructor(private readonly options: HapticsOptions) {}

  pulse(kind: HapticKind): void {
    if (!this.options.enabled()) return;
    const pad = this.pad();
    if (pad !== undefined) {
      const effect = PAD_EFFECTS[kind];
      // Feel is never worth an error, and this runs inside the race's frame:
      // an engine may refuse at once (no such effect) or mid-flight (the pad
      // unplugged), and either is swallowed.
      try {
        void pad.vibrationActuator!
          .playEffect("dual-rumble", { duration: effect.duration, strongMagnitude: effect.strong, weakMagnitude: effect.weak, startDelay: 0 })
          ?.catch(() => undefined);
      } catch {
        // Refused at once.
      }
      return;
    }
    // A connected pad without an actuator still means the phone is not in hand.
    if (this.connectedPads().length > 0) return;
    const pattern = PHONE_PATTERNS[kind];
    if (pattern === undefined || this.options.vibrate === undefined || !this.options.touch()) return;
    try {
      this.options.vibrate(typeof pattern === "number" ? pattern : [...pattern]);
    } catch {
      // A browser that blocks it outside a gesture says so by throwing on some engines.
    }
  }

  private connectedPads(): PadLike[] {
    try {
      return (this.options.getGamepads?.() ?? []).filter((pad): pad is PadLike => pad !== null && pad.connected);
    } catch {
      return [];
    }
  }

  /** The pad to rumble: the first connected one whose actuator can play an effect. */
  private pad(): PadLike | undefined {
    return this.connectedPads().find((pad) => typeof pad.vibrationActuator?.playEffect === "function");
  }
}
