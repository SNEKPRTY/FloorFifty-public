/**
 * The quality setting.
 *
 * The scenery is two chains now (launch polish spec, phase 1): the **sky
 * plate**, which is refracted, and the **city stack**, which is crisp. Each is
 * resolved here, and each ends at its own palette lock -- everything above a
 * lock produces the off-palette blends it exists to fold back into the 64
 * swatches, so the lock is always last.
 *
 * Quality degrades the city first: the atmosphere drops at `low`. The sky and
 * the locks stay on at every level -- they are cheap, and they are the art
 * direction rather than embellishment on it. Bloom is no longer in either
 * chain: it was a blur, and the city is not blurred.
 *
 * A part may be absent. A renderer that cannot compile a program must still
 * draw the game, so a missing pass drops out of the chain rather than throwing
 * out of the mount.
 */

import type { Filter } from "pixi.js";

export type QualityLevel = "high" | "medium" | "low";

export type SkyFilterParts = {
  /** The dithered sky, painted wherever the plate drew nothing. */
  sky: Filter | undefined;
  /**
   * The sky's refraction.
   *
   * Present at every level when it is present, including `low`: that level's
   * variant is the static diffusion, which is this same pass with its warp at
   * zero, not a different pass. Absent when its program would not compile, or
   * when there is no bounded target to run it in.
   */
  refraction: Filter | undefined;
  paletteLock: Filter | undefined;
};

export type CityFilterParts = {
  /** Window twinkle and the beat's glow. No blur term. */
  city: Filter | undefined;
  /**
   * The city's own refraction (spec §2.9): the sky's soft optics on its own
   * target, blur included, so every background layer has the glow. Kept at
   * every level, like the sky's refraction; absent where it will not compile.
   */
  refraction?: Filter | undefined;
  /** The city's own lock instance; one live filter cannot serve two targets. */
  paletteLock: Filter | undefined;
};

/** The sky plate's chain: sky, then refraction, then the lock. */
export function resolveSkyFilters(_level: QualityLevel, parts: SkyFilterParts): Filter[] {
  return [parts.sky, parts.refraction, parts.paletteLock].filter(
    (filter): filter is Filter => filter !== undefined,
  );
}

/** The city stack's chain: the atmosphere above `low`, the refraction, then the city's lock. */
export function resolveCityFilters(level: QualityLevel, parts: CityFilterParts): Filter[] {
  const chain =
    level === "low"
      ? [parts.refraction, parts.paletteLock]
      : [parts.city, parts.refraction, parts.paletteLock];
  return chain.filter((filter): filter is Filter => filter !== undefined);
}

/**
 * The level every project runs at until a measurement says otherwise.
 *
 * `high` is the default because the whole chain is bounded to 518,400 pixels by
 * the composite target, which is what makes running everything affordable on a
 * phone in the first place. `tests/e2e/frame-budget.spec.ts` is what moves it:
 * a project that misses the budget at `high` gets its level stepped down here,
 * and the review records which and why.
 *
 * It is now the default for the player's graphics setting
 * (`features/profile/settings.ts`, launch polish §3.1.2), which each screen's backdrop
 * follows live through `rebuildOnQuality`.
 */
export const QUALITY_LEVEL: QualityLevel = "high";
