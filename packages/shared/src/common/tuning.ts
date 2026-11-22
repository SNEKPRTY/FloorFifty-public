/**
 * Gameplay tunables.
 *
 * A tunable is a declaration, not a bare export: it carries a type, an
 * inclusive safe range, and a default. Declaring the bounds as data gives the
 * Editable Content Pipeline a machine-readable source to validate authored
 * values against, and it is why simulation code can take resolved tuning as an
 * argument instead of importing a literal.
 *
 * Anything whose change would invalidate determinism, protocol framing, or room
 * capacity is an invariant and lives in `lib/constants.ts` instead.
 */

export type TunableType = "int" | "float";

export type TunableDeclaration = {
  readonly type: TunableType;
  /** Inclusive lower bound. */
  readonly min: number;
  /** Inclusive upper bound. */
  readonly max: number;
  readonly default: number;
};

/**
 * Starting values are the reference build's own, read from
 * `References/FloorFiftyVerticalSlice`.
 *
 * They transfer directly. An earlier revision of this file claimed they did
 * not, on the grounds that the reference runs Rapier at
 * `pixels_per_meter(550.0)` while this port runs a plain fixed-step integrator
 * in logical units. That is wrong: `bevy_rapier2d` expresses both
 * `RapierConfiguration::gravity` and the `Velocity` component in pixels and
 * converts around the solver, which is why the crate's default gravity is
 * `-9.81 * 100` at the default `pixels_per_meter(100)`. Pixel-space kinematics
 * do not depend on the scale factor, so every velocity below is the
 * reference's literal number.
 *
 * The relationship that decides whether an ascent is possible is:
 *
 *   bounce apex = BOUNCE_VELOCITY^2 / (2 * |GRAVITY|) = 130.78
 *
 * against a floor gap of 128.571. The margin is 2.21 units, or a quarter of a
 * second above each floor, and that near-miss on every single bounce is the
 * game's feel. It also means one bounce cannot reach two floors up, so nothing
 * is stranded.
 *
 * A bounce is not the only way to gain height, and under this margin it is not
 * the main one. Contact with any face of a floor lifts a player, every tick the
 * contact lasts, so a climber presses into a floor's side and rides it. That is
 * how the reference is climbed, which is why nothing here constrains where the
 * generator puts a floor: `tests/shared/level/completability.test.ts` measures the
 * result over a spread of seeds rather than deriving it.
 */
export const TUNABLES = {
  /**
   * Floors in one ascent, including the fixed starting floor. Declaring the
   * range up to one hundred now is what later lets a Timed Climb mode request
   * a taller course without touching the generator.
   */
  COURSE_FLOOR_COUNT: { type: "int", min: 20, max: 100, default: 20 },

  FLOOR_WIDTH: { type: "int", min: 64, max: 256, default: 120 },
  FLOOR_HEIGHT: { type: "int", min: 8, max: 64, default: 20 },

  /**
   * Player collision box.
   *
   * The reference collides with a ball of radius `PLAYER_SIZE / 1.7 = 29.36`
   * (`player.rs:57`), so the box is the ball's diameter. It is squarer than the
   * 48 x 64 art sheet on purpose: the climb's geometry depends on how far a
   * contact reaches, not on how the character is drawn.
   *
   * The reference scores with a separate, narrower foot sensor, so it is
   * possible there to clip a corner, be launched, and not collect the floor.
   * This port uses one box for both, which makes collecting a little more
   * generous than the reference and bouncing exactly as generous.
   */
  PLAYER_WIDTH: { type: "int", min: 16, max: 96, default: 59 },
  PLAYER_HEIGHT: { type: "int", min: 16, max: 128, default: 59 },

  /** `gameplay_state.rs:26`. */
  GRAVITY: { type: "float", min: -1200, max: -100, default: -275 },

  /** `player.rs:64` `jump_force`. Applied on contact with any face. */
  BOUNCE_VELOCITY: { type: "float", min: 100, max: 1200, default: 268.2 },
  /**
   * Horizontal speed, applied outright rather than approached.
   *
   * `player.rs:63` `movement_speed`.
   */
  MAX_MOVE_SPEED: { type: "float", min: 50, max: 900, default: 356 },
  /** `player.rs:136`: the reference's `-jump_force * 5.0`. */
  FAST_FALL_VELOCITY: { type: "float", min: -2000, max: -100, default: -1341 },

  /**
   * Vertical spacing between floors.
   *
   * `platforms.rs:88`: `window.height / 4.2`, uniform. Min and max are equal
   * because the reference does not vary it; they stay separate declarations so
   * a later mode can.
   */
  FLOOR_GAP_MIN: { type: "float", min: 40, max: 200, default: 540 / 4.2 },
  FLOOR_GAP_MAX: { type: "float", min: 40, max: 320, default: 540 / 4.2 },


  /**
   * Speed range for a moving floor, drawn per floor.
   *
   * `platforms.rs:124`: `gen_range(100.0..200.0)`. The bound is half-open, as
   * the reference's is.
   */
  MOVING_FLOOR_SPEED_MIN: { type: "float", min: 0, max: 400, default: 100 },
  MOVING_FLOOR_SPEED_MAX: { type: "float", min: 0, max: 400, default: 200 },

  /** `player.rs:147` death at `y < -400` against `platforms.rs:61`'s start floor at -135. */
  DEATH_LINE_MARGIN: { type: "int", min: 100, max: 800, default: 265 },

  /**
   * Ticks a racer rests at the spawn after a non-final lap (race-flow spec
   * §4.1): the city eases back down beneath a "LAP n" banner. 0 holds nothing.
   */
  LAP_HOLD_TICKS: { type: "int", min: 0, max: 120, default: 48 },

  /**
   * How much of a moving floor's travel a racer standing on it is carried
   * (race-flow spec §4.2). 1 rides it; 0 is the reference, where it slides out.
   */
  MOVING_FLOOR_CARRY: { type: "float", min: 0, max: 1, default: 1 },

  /**
   * Ticks an endless race runs before the clock ends it (race-options spec
   * §5.2). 0 is no limit, which is every finite mode; the content validator
   * ties a positive value to `course = "endless"`, and the simulation reads
   * it as the one sign that a course has no top (`simulation/endless.ts`).
   */
  RACE_TIME_LIMIT_TICKS: { type: "int", min: 0, max: 36_000, default: 0 },

  /**
   * Survival's rising edge (survival spec §3). Each racer's edge is the bottom
   * of a fixed logical view `SURVIVAL_VIEW_HEIGHT` tall. It rests for
   * `SURVIVAL_GRACE_TICKS` after the racer's first input or
   * `SURVIVAL_START_WAIT_TICKS`, whichever comes first, then rises at
   * `SURVIVAL_RISE_START` units/s, `SURVIVAL_RISE_STEP` faster every
   * `SURVIVAL_RISE_STEP_TICKS`, up to `SURVIVAL_RISE_CAP`; a racer above
   * `SURVIVAL_PUSH_AT` of the view pushes it up, at most `SURVIVAL_PUSH_SPEED`
   * faster than the rise. Read only on an endless course.
   */
  // 480 × 0.55 = 264 units (about two floors): how far below a racer's best floor the push aims (lava spec §3).
  SURVIVAL_VIEW_HEIGHT: { type: "float", min: 300, max: 1200, default: 480 },
  SURVIVAL_GRACE_TICKS: { type: "int", min: 0, max: 1800, default: 180 },
  /**
   * How long a racer's edge stands still waiting for that racer's first input
   * (first-race spec §2): from GO until their first press, or this many ticks,
   * whichever comes first; the `SURVIVAL_GRACE_TICKS` rest then runs from there.
   * The cap stops one idle player holding up a race. 0 is no wait, the rule
   * before the spec. The default is the shipped value (10 s), so base tuning
   * equals the declarations.
   */
  SURVIVAL_START_WAIT_TICKS: { type: "int", min: 0, max: 3600, default: 600 },
  SURVIVAL_RISE_START: { type: "float", min: 0, max: 400, default: 55 },
  SURVIVAL_RISE_STEP: { type: "float", min: 0, max: 200, default: 20 },
  SURVIVAL_RISE_STEP_TICKS: { type: "int", min: 60, max: 3600, default: 1800 },
  SURVIVAL_RISE_CAP: { type: "float", min: 0, max: 400, default: 150 },
  SURVIVAL_PUSH_AT: { type: "float", min: 0.3, max: 0.9, default: 0.55 },
  /**
   * The most the push adds to the edge's rise, in units/s (lava spec §3). The
   * push closes on its target at this speed instead of jumping there, so a new
   * best floor reads as the lava surging up, not the picture lurching.
   */
  SURVIVAL_PUSH_SPEED: { type: "float", min: 50, max: 1200, default: 300 },
  /**
   * The lava's rubber band, toward the leader as the CPUs band (lava band).
   * The leader's rise is scaled up by `SURVIVAL_BAND_AHEAD_STEP` for each floor
   * they lead second place by, to `SURVIVAL_BAND_AHEAD_MAX`; everyone else's is
   * scaled down by `SURVIVAL_BAND_BEHIND_STEP` for each floor they trail the
   * leader by, to `SURVIVAL_BAND_BEHIND_MIN`. The banded rise still stops at
   * `SURVIVAL_RISE_CAP`.
   */
  SURVIVAL_BAND_AHEAD_STEP: { type: "float", min: 0, max: 1, default: 0.1 },
  SURVIVAL_BAND_AHEAD_MAX: { type: "float", min: 1, max: 3, default: 1.5 },
  SURVIVAL_BAND_BEHIND_STEP: { type: "float", min: 0, max: 1, default: 0.05 },
  SURVIVAL_BAND_BEHIND_MIN: { type: "float", min: 0.1, max: 1, default: 0.7 },

  /**
   * The cut story mode's own edge. Nothing reads these any more; they stay
   * so the ruleset revision and the room's tuning schema do not change.
   */
  TUTORIAL_EDGE_RISE: { type: "float", min: 5, max: 200, default: 30 },
  TUTORIAL_EDGE_START_BELOW: { type: "float", min: 60, max: 600, default: 240 },

  /**
   * The ramp (race-options spec §5.1). Above `DEMAND_RAMP_FROM_FLOOR`, in
   * bands of `DEMAND_RAMP_BAND_FLOORS`, more floors move and they move
   * faster, each up to a cap. The floor of 50 on the first key is what keeps
   * every 50-floor course out of it: only an endless course climbs that high.
   */
  DEMAND_RAMP_FROM_FLOOR: { type: "int", min: 50, max: 1000, default: 50 },
  DEMAND_RAMP_BAND_FLOORS: { type: "int", min: 1, max: 100, default: 10 },
  /** Added to the moving share (0.5 below the ramp) per band. */
  MOVING_SHARE_STEP: { type: "float", min: 0, max: 0.5, default: 0.05 },
  MOVING_SHARE_MAX: { type: "float", min: 0.5, max: 1, default: 0.8 },
  /** Added to both ends of the speed range per band. */
  MOVING_SPEED_STEP: { type: "float", min: 0, max: 100, default: 10 },
  MOVING_FLOOR_SPEED_CAP: { type: "float", min: 0, max: 400, default: 300 },
} as const satisfies Record<string, TunableDeclaration>;

export type TunableName = keyof typeof TUNABLES;

/** A complete, validated set of gameplay values. */
export type ResolvedTuning = { readonly [K in TunableName]: number };

/** Raised when an override falls outside the declaration it belongs to. */
export class TuningRangeError extends Error {
  constructor(
    readonly tunable: TunableName,
    readonly value: number,
    declaration: TunableDeclaration,
  ) {
    super(
      `${tunable} must be ${declaration.type === "int" ? "an integer" : "a number"} ` +
        `within [${declaration.min}, ${declaration.max}], received ${value}`,
    );
    this.name = "TuningRangeError";
  }
}

/**
 * Produces a complete tuning set: declared defaults with `overrides` applied.
 *
 * Every override is bounds-checked here, so no consumer downstream has to
 * repeat the check, and an out-of-range authored value fails at resolution
 * rather than as strange physics twenty floors into a race.
 */
export function resolveTuning(overrides?: Partial<ResolvedTuning>): ResolvedTuning {
  const resolved: Record<string, number> = {};

  for (const [name, declaration] of Object.entries(TUNABLES)) {
    const override = overrides?.[name as TunableName];
    if (override === undefined) {
      resolved[name] = declaration.default;
      continue;
    }
    if (!Number.isFinite(override) || override < declaration.min || override > declaration.max) {
      throw new TuningRangeError(name as TunableName, override, declaration);
    }
    if (declaration.type === "int" && !Number.isInteger(override)) {
      throw new TuningRangeError(name as TunableName, override, declaration);
    }
    resolved[name] = override;
  }

  // An unrecognised key is a typo or a stale authored value, never a silent
  // no-op: the content pipeline depends on that being loud.
  for (const name of Object.keys(overrides ?? {})) {
    if (!(name in TUNABLES)) {
      throw new Error(`unknown tunable: ${name}`);
    }
  }

  return resolved as ResolvedTuning;
}
