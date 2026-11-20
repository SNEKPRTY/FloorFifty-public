import { z } from "zod";
import { ROLES } from "@floor-fifty/asset-contract/roles";

export const JUICE_PARTICLE_LIMIT_MAX = 512;
export const JUICE_STEP_MS_MAX = 500;
/**
 * The longest hit-stop an author may write. A freeze longer than the input
 * rule's 120 ms would hold the picture of an input (polish spec §3).
 */
export const JUICE_HIT_STOP_MS_MAX = 120;

const roleName = z.enum(Object.keys(ROLES) as [string, ...string[]]);

/**
 * A spring's constants (Wonder spec §4.2): `f` how fast it answers in hertz,
 * `zeta` how much it wobbles (below 1 overshoots), `r` how it starts.
 */
const spring = z
  .object({
    f: z.number().min(0.1).max(20),
    zeta: z.number().min(0).max(2),
    r: z.number().min(-4).max(4),
  })
  .strict();

/** A squash is a knock on the squash spring: x grows by `amount`, y shrinks by it. */
const squash = z.object({ amount: z.number().min(0).max(0.6) }).strict();

const dust = z
  .object({
    count: z.number().int().min(0).max(64),
    spread: z.number().min(0).max(240),
    rise: z.number().min(0).max(240),
    lifeMs: z.number().int().min(16).max(2_000),
    ring: z.boolean().optional(),
    /** Sparks thrown with the dust: smaller, faster, shorter-lived (Wonder spec §4.3). */
    sparks: z.number().int().min(0).max(32).optional(),
  })
  .strict();

/** The pop-up words (Wonder spec §5): their size, motion, caps and timing. */
const words = z
  .object({
    lifeMs: z.number().int().min(200).max(5_000),
    popScale: z.number().min(1).max(2.5),
    riseUnits: z.number().min(0).max(160),
    size: z.number().min(8).max(160),
    beatSize: z.number().min(8).max(160),
    rivalScale: z.number().min(0.2).max(1),
    rivalAlpha: z.number().min(0.2).max(1),
    skewDeg: z.number().min(0).max(20),
    outline: z.number().min(0).max(16),
    localCap: z.number().int().min(1).max(4),
    beatCap: z.number().int().min(1).max(4),
    repeatGapMs: z.number().int().min(0).max(5_000),
    backWithinMs: z.number().int().min(0).max(5_000),
    streakFrom: z.number().int().min(2).max(20),
    niceFrom: z.number().int().min(2).max(50),
    greatFrom: z.number().int().min(2).max(99),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.streakFrom > value.niceFrom || value.niceFrom > value.greatFrom) {
      context.addIssue({ code: "custom", message: "streakFrom <= niceFrom <= greatFrom", path: ["niceFrom"] });
    }
  });

/**
 * The feel layer (A/V polish plan, 2026-10-04): trauma shake, the zoom punch,
 * impact frames, the fast-fall's speed lines and afterimages, the camera's
 * look-ahead and the LCD panel's aberration pulse. Defaulted whole, so a tree
 * that predates it still builds.
 */
export const FEEL_DEFAULTS = {
  shake: { maxUnits: 6, decayPerSecond: 1.6, hz: 18, slam: 0.35, fall: 0.5, finish: 0.6, rivalSlam: 0.12 },
  punch: { slam: 0.02, finish: 0.045, spring: { f: 3, zeta: 0.55, r: 0 } },
  impact: { ms: 50, alpha: 0.45, slam: 0.2, gapMs: 400 },
  fall: { from: 0.75, lines: 14, alpha: 0.5, afterimages: 3, afterimageAlpha: 0.35 },
  lookAhead: { seconds: 0.12, maxUnits: 80 },
  aberration: { peak: 1.2, ms: 140 },
} as const;

const share = z.number().min(0).max(1);
const feel = z
  .object({
    shake: z
      .object({
        maxUnits: z.number().min(0).max(24),
        decayPerSecond: z.number().min(0.1).max(10),
        hz: z.number().min(1).max(60),
        slam: share,
        fall: share,
        finish: share,
        rivalSlam: share,
      })
      .strict(),
    punch: z.object({ slam: z.number().min(0).max(0.1), finish: z.number().min(0).max(0.1), spring }).strict(),
    impact: z
      .object({
        ms: z.number().int().min(0).max(JUICE_HIT_STOP_MS_MAX),
        alpha: share,
        // A slam's own flash, softer than the finish's: slams come often.
        slam: share,
        // Never more than three flashes a second (WCAG 2.3.1).
        gapMs: z.number().int().min(334).max(5_000),
      })
      .strict(),
    fall: z
      .object({
        from: share,
        lines: z.number().int().min(0).max(48),
        alpha: share,
        afterimages: z.number().int().min(0).max(6),
        afterimageAlpha: share,
      })
      .strict(),
    lookAhead: z.object({ seconds: z.number().min(0).max(0.5), maxUnits: z.number().min(0).max(240) }).strict(),
    aberration: z.object({ peak: z.number().min(0).max(4), ms: z.number().int().min(0).max(JUICE_STEP_MS_MAX) }).strict(),
  })
  .strict();

/**
 * Racer juice (polish spec §4.1): presentation only, so it moves
 * `contentRevision` and never `rulesetRevision`.
 *
 * The ranges are generous enough to tune by feel and tight enough that a typo
 * cannot freeze a race or flood the particle pool.
 */
export const juiceSchema = z
  .object({
    limits: z.object({ particles: z.number().int().min(1).max(JUICE_PARTICLE_LIMIT_MAX) }).strict(),
    springs: z
      .object({ squash: spring, lean: spring, kick: spring, word: spring, jolt: spring, hudPop: spring })
      .strict(),
    lean: z
      .object({
        maxDeg: z.number().min(0).max(30),
        fullSpeed: z.number().min(1).max(2_000),
        stepDeg: z.number().min(0.5).max(10),
      })
      .strict(),
    bounce: z.object({ squash, dust }).strict(),
    slam: z
      .object({
        threshold: z.number().min(0).max(1),
        squash,
        dust,
        cameraKick: z
          .object({ units: z.number().int().min(0).max(24), ms: z.number().int().min(0).max(JUICE_STEP_MS_MAX) })
          .strict(),
        hitStopMs: z.number().int().min(0).max(JUICE_HIT_STOP_MS_MAX),
      })
      .strict(),
    collect: z.object({ hudPop: z.object({ scale: z.number().min(1).max(1.3) }).strict(), dust }).strict(),
    wrap: z
      .object({
        streak: z.object({ frames: z.number().int().min(0).max(8) }).strict(),
        sparks: z.number().int().min(0).max(32),
      })
      .strict(),
    burst: z.object({ spawn: z.object({ dust }).strict(), finish: z.object({ dust }).strict() }).strict(),
    words,
    palette: z
      .object({ stages: z.record(z.string(), z.object({ dust: roleName }).strict()).default({}) })
      .strict()
      .default({ stages: {} }),
    feel: feel.default(FEEL_DEFAULTS),
  })
  .strict();

export type AuthoredJuice = z.infer<typeof juiceSchema>;
