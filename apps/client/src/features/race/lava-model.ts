/**
 * Survival's lava, as numbers (lava spec §5).
 *
 * The lava is the local racer's edge drawn: presentation only. Everything a
 * test can check without a renderer lives here, and `lava-view.ts` draws it.
 */

import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";

/** The least a sizzle waits before sounding again. */
export const SIZZLE_INTERVAL_MS = 500;

/** Units an edge may move past the rise in a frame before it reads as a surge: rounding, not a push. */
export const SURGE_SLACK = 0.5;

/**
 * How hot the lava runs, 0 to 1: the racer's banded rise (`edgeRiseSpeed`,
 * units/s) as a share of the cap, so a leader's lava runs hotter (lava band).
 */
export function lavaHeat(rise: number, tuning: Pick<ResolvedTuning, "SURVIVAL_RISE_CAP">): number {
  if (tuning.SURVIVAL_RISE_CAP <= 0) return 0;
  return Math.min(1, Math.max(0, rise / tuning.SURVIVAL_RISE_CAP));
}

/**
 * Whether the push is catching up this frame: the edge moved more than the
 * banded rise (`rise`, units/s) alone would move it.
 */
export function lavaSurging(edgeY: number, previousEdgeY: number, rise: number, deltaSeconds: number): boolean {
  if (deltaSeconds <= 0) return false;
  return edgeY - previousEdgeY > rise * deltaSeconds + SURGE_SLACK;
}

/** A body partly under the surface. Wholly under is out, which is not sinking. */
export function isSinking(y: number, edgeY: number, tuning: Pick<ResolvedTuning, "PLAYER_HEIGHT">): boolean {
  const half = tuning.PLAYER_HEIGHT / 2;
  return y - half < edgeY && y + half >= edgeY;
}

/**
 * The marker's count, in floors from the racer down to the surface, while the
 * surface is below what a player can see; undefined while it is in view.
 * `visibleBottomY` is the logical y at the visible field's bottom.
 */
export function lavaMarkerFloors(
  racerY: number,
  edgeY: number,
  visibleBottomY: number,
  tuning: Pick<ResolvedTuning, "FLOOR_GAP_MAX">,
): number | undefined {
  if (edgeY >= visibleBottomY) return undefined;
  return Math.max(1, Math.ceil((racerY - edgeY) / tuning.FLOOR_GAP_MAX));
}

/** Lets the sizzle sound once per dip, and no more often than `intervalMs`. */
export class SizzleGate {
  private wasSinking = false;
  private lastMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs = SIZZLE_INTERVAL_MS) {}

  /** True when this frame starts a dip the sizzle should sound for. */
  dip(sinking: boolean, nowMs: number): boolean {
    const starts = sinking && !this.wasSinking;
    this.wasSinking = sinking;
    if (!starts || nowMs - this.lastMs < this.intervalMs) return false;
    this.lastMs = nowMs;
    return true;
  }
}
