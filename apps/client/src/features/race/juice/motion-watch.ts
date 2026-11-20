/**
 * The three moments the client derives from what it draws (polish spec §4.1).
 *
 * A bounce is the drawn `vy` turning from falling to rising, outside the same
 * rest band `PlayerView` reads its landing flourish from. `floorLanded` cannot
 * stand in for it: it fires only when a floor is first credited, so an
 * ordinary bounce emits no event at all.
 *
 * A slam is a bounce whose fall had reached a share of the fast-fall speed. A
 * wrap is the drawn `x` jumping across the seam between two frames, the same
 * test `SnapshotBuffer.blend` uses.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import { LOGICAL_VIEWPORT } from "../../../lib/constants";

export type DrawnRacer = { readonly id: PlayerId; readonly x: number; readonly y: number; readonly vy: number };

export type JuiceMoment = {
  readonly kind: "bounce" | "slam" | "wrap";
  readonly playerId: PlayerId;
  readonly x: number;
  readonly y: number;
  /** For a wrap, the x the racer left; otherwise `x`. */
  readonly fromX: number;
  /** Racer, kind and tick: the de-duplication key (polish spec §8.4). */
  readonly key: string;
};

/** A drawn jump wider than half the course is a wrap, as `SnapshotBuffer.blend` decides. */
const WRAP_JUMP = LOGICAL_VIEWPORT.width / 2;

type Track = { travel: "rising" | "falling" | undefined; fallPeak: number; x: number };

export class MotionWatch {
  private readonly tracks = new Map<PlayerId, Track>();

  /** `restSpeed`: the dead band either side of zero, where a racer is neither rising nor falling. */
  constructor(private readonly restSpeed: number) {}

  /** The moments this frame shows. `slamSpeed` is a positive speed: the fall a slam needs. */
  observe(racers: readonly DrawnRacer[], tick: number, slamSpeed: number): JuiceMoment[] {
    const moments: JuiceMoment[] = [];
    for (const racer of racers) {
      const track = this.tracks.get(racer.id);
      if (track === undefined) {
        this.tracks.set(racer.id, { travel: this.travelOf(racer.vy), fallPeak: Math.max(0, -racer.vy), x: racer.x });
        continue;
      }

      if (Math.abs(racer.x - track.x) > WRAP_JUMP) {
        moments.push({ kind: "wrap", playerId: racer.id, x: racer.x, y: racer.y, fromX: track.x, key: `${racer.id}:wrap:${tick}` });
      }
      track.x = racer.x;

      const travel = this.travelOf(racer.vy);
      if (travel === undefined) continue;
      if (travel === "falling") track.fallPeak = Math.max(track.fallPeak, -racer.vy);
      if (travel === "rising" && track.travel === "falling") {
        const kind = track.fallPeak >= slamSpeed ? "slam" : "bounce";
        moments.push({ kind, playerId: racer.id, x: racer.x, y: racer.y, fromX: racer.x, key: `${racer.id}:${kind}:${tick}` });
      }
      if (travel === "rising") track.fallPeak = 0;
      track.travel = travel;
    }
    return moments;
  }

  forget(id: PlayerId): void {
    this.tracks.delete(id);
  }

  /** Forgets every racer: a timeline that jumped (a replay's rewind or seek). */
  clear(): void {
    this.tracks.clear();
  }

  private travelOf(vy: number): Track["travel"] {
    if (Math.abs(vy) <= this.restSpeed) return undefined;
    return vy > 0 ? "rising" : "falling";
  }
}
