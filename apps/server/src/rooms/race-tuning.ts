/**
 * A race's seed and tuning: the stage's frozen seed, and tuning resolved in
 * three layers, base, then the stage's courseTuning, then the mode's
 * (race-options spec §3.2). Pure, so the order is testable without a room.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { resolveTuning, type ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import type { GameContent } from "@floor-fifty/shared/content/game-content";

export function raceTuning(
  content: GameContent["content"],
  stageId: string,
  modeId: string,
  clockSeconds?: number,
): { seed: number; tuning: ResolvedTuning } {
  const stage = content.stages.find((entry) => entry.id === stageId);
  if (stage?.course === undefined) throw new Error(`stage ${stageId} has no frozen course`);
  const mode = content.modes.find((entry) => entry.id === modeId);
  // Survival's chosen clock is the last layer, and only a clock the mode offers (survival spec §5).
  const clock =
    clockSeconds !== undefined && mode?.clocks?.includes(clockSeconds) === true
      ? { RACE_TIME_LIMIT_TICKS: clockSeconds * TICK_HZ }
      : {};
  return {
    seed: stage.course.seed,
    tuning: resolveTuning({ ...content.baseTuning, ...stage.courseTuning, ...mode?.tuning, ...clock }),
  };
}
