/**
 * The test-only visual inspection hook.
 *
 * Some of what this pass claims cannot be asserted from the DOM. The overlay's
 * `data-refraction` says a shader was accepted, not which profile the scenery
 * is drawn with; nothing on the page reports the ambient clock, and nothing
 * reports how large the bounded target the scenery is rendered into actually
 * came out. A browser gate that wants those has to be told them, and this is
 * the one seam that tells it.
 *
 * Three rules, and they are what keep a debugging seam from becoming a
 * gameplay one:
 *
 * 1. **Off unless asked for.** `VITE_VISUAL_INSPECTION=1` is set by the e2e
 *    client build alone, and `DEV` covers a developer's own browser. A
 *    production build exposes nothing at all -- the constant folds away and the
 *    installer returns immediately.
 *
 * 2. **It reads, and only reads.** The hook is a function returning numbers,
 *    names and an allocated size. It hands back no reference to the clock, the
 *    backdrop, the snapshot or the room, so there is no route from a returned
 *    value back into the race. It cannot advance anything, cannot mutate
 *    simulation state, and cannot name a winner -- not because it declines to,
 *    but because it holds nothing that could.
 *
 * 3. **The reader is live, not a snapshot.** Each call runs the closure against
 *    the screen as it stands, because the question a capture asks ("is the
 *    clock frozen?") is about a value that changes between calls.
 */

/**
 * Which refraction a screen is actually drawing.
 *
 * `sky-only` is gameplay's: the sky plate is refracted and the city stack is
 * not (launch polish spec, phase 1). It replaced `gameplay`, which described
 * a pass over the whole scenery. `sky+city` adds the city's own soft
 * refraction (spec §2.9): every background layer refracted and blurred.
 */
export type RefractionProfileName = "menu" | "sky-only" | "sky+city" | "plain";

/** How the city stack's textures are sampled; `null` where no city is drawn. */
export type CitySampling = "nearest" | "linear" | null;

/**
 * One reading of the presentation.
 *
 * Deliberately all primitives. Every field here can be compared, logged and
 * photographed; none of them can be written through.
 */
export type VisualInspection = Readonly<{
  /** The resolved stage presentation's profile, or `legacy` without content. */
  profile: "legacy" | "aquarian";
  /** The menu's whole-screen pass, the scenery's bounded pass, or neither. */
  refraction: RefractionProfileName;
  /**
   * How the city is sampled. `nearest` is the contract: a city texture that
   * came through linear would soften the skyline the split exists to keep crisp.
   */
  citySampling: CitySampling;
  /** The ambient clock's time in seconds: the phase the optics are drawn at. */
  clockSeconds: number;
  /**
   * The bounded target, or `null` where the scenery is drawn unbounded.
   *
   * `null` rather than a zeroed box: a renderer that could not create the
   * target draws the scenery directly, and reporting `0 x 0` there would read
   * as a real allocation of nothing.
   */
  target: Readonly<{
    /** The active shaded area, in target pixels. */
    width: number;
    height: number;
    /**
     * What the allocator reserves for that area, in pixels.
     *
     * Separate from the area because the two are different numbers -- a pooled
     * texture rounds up to a power of two per axis -- and each has its own cap.
     * A probe that saw only the area would call an unbounded allocation
     * bounded.
     */
    pooled: number;
  }> | null;
}>;

/** The race's held intent, as the e2e pad journey reads it. Primitives only. */
export type InputInspection = Readonly<{ left: boolean; right: boolean; fastFall: boolean }>;

/**
 * The two counts the phase 2 gate's leak checks compare: a race or a quality
 * switch must hand both back to where they started.
 * Installed for the app's whole life, not by a screen, because the title --
 * where the before and after are read -- holds neither.
 */
export type LeakCounters = Readonly<{
  /** Every display object under the stage root, the root itself excluded. */
  displayObjects: number;
  /**
   * Every display object under the world container, the race's particle pool
   * among them. Counted apart: the composite that draws the world is not a
   * child of the stage root, so `displayObjects` never sees it.
   */
  worldObjects: number;
  /** Audio source nodes still sounding: the music slot plus the cues. */
  audioSources: number;
  /** Cues sounding: the effects and announcer lines, which end by themselves (the title's call is two). */
  cues: number;
  /** Song previews sounding: the one playing plus any fading out. */
  previewSources: number;
  /** Whether the music slot holds a track: the menu theme, a race song, or the song's opening. */
  music: boolean;
  /** Transition veil canvases alive: one at most, made on the first liquid edge (race-flow spec §7.2). */
  veilCanvases: number;
  /** WebGL contexts the veil holds: one at most. */
  glContexts: number;
  /** Replay simulations alive: none once every viewer has closed (race-options spec §10.1). */
  replaySimulations: number;
  /** Timeouts not yet fired and intervals not yet cleared (release readiness §9.3). */
  timers: number;
  /** Listeners on `window` and `document` (release readiness §9.3). */
  listeners: number;
}>;

/** The recursive child count under `root`, which is not itself counted. */
export function countDisplayObjects(root: { readonly children: readonly unknown[] }): number {
  let count = 0;
  for (const child of root.children) {
    count += 1 + countDisplayObjects(child as { readonly children: readonly unknown[] });
  }
  return count;
}

declare global {
  interface Window {
    /** Installed only where visual inspection is enabled. See this module. */
    __ffInspect?: () => VisualInspection;
    /** Installed by a race only where visual inspection is enabled. */
    __ffInput?: () => InputInspection;
    /** Installed at boot only where visual inspection is enabled. */
    __ffCounts?: () => LeakCounters;
    /** Installed by a race only where visual inspection is enabled. */
    __ffJuice?: () => JuiceInspection;
    /** Installed while a menu screen holds the world behind it, only where visual inspection is enabled. */
    __ffBackdrop?: () => BackdropInspection;
    /** Installed by a race only where visual inspection is enabled. */
    __ffRacer?: () => RacerInspection;
  }
}

/**
 * The race's juice, for the frame-budget gate (polish spec §10.1): the live
 * particle count, and a switch that slams every racer on a short cadence so
 * the budget can be read with the pool full.
 */
export type JuiceInspection = Readonly<{
  liveParticles: number;
  stress: (on: boolean) => void;
  /** Pop-up words on screen now (Wonder spec §5). */
  liveWords: number;
  /** Starts the stage's set piece at a floor now; false if it has none there (Wonder spec §6.4). */
  setPiece: (floor: number) => boolean;
  /** Every word at its largest, in this language, at the beat size: the widest, in logical units (Wonder spec §8). */
  widestWord: () => number;
}>;

/** Whether the menu's world is being drawn behind the screen in front (the first-visit steps sit on it). */
export type BackdropInspection = Readonly<{ drawn: boolean }>;

/**
 * Where the local racer is drawn, nameplate included, in viewport pixels, or
 * `undefined` before it is on screen: what a fit check needs to see that
 * nothing laid over the race covers the player. And the tick drawn.
 */
export type RacerInspection = Readonly<{
  local: Readonly<{ left: number; top: number; right: number; bottom: number }> | undefined;
  /** The simulation tick of the snapshot last drawn: what a recording that steps the clock waits on (`demo-capture.spec.ts`). */
  tick: number;
}>;

type HookName = "__ffInspect" | "__ffInput" | "__ffCounts" | "__ffJuice" | "__ffBackdrop" | "__ffRacer";

/**
 * Whether this build may expose the inspection hook.
 *
 * Exported because more than one place asks the question -- the quality
 * override the menu backdrop reads wants the same answer -- and a second copy
 * of the expression is a second thing to get wrong.
 */
export const VISUAL_INSPECTION_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_VISUAL_INSPECTION === "1";

/**
 * Publishes `read` as `window.__ffInspect`, and returns the release.
 *
 * The release is idempotent and guarded: it clears the hook only while it is
 * still the one that was installed. A screen's teardown is not ordered against
 * the next screen's mount, so a stale release that deleted the live reader
 * would leave the hook missing exactly when a capture wanted it.
 *
 * `enabled` is an override for the gate, not a second gate: production passes
 * nothing and gets the constant above. It exists so the disabled path -- which
 * no test can otherwise reach, since a test build has `DEV` on -- is assertable.
 */
export function installVisualInspection(
  read: () => VisualInspection,
  options: { enabled?: boolean; target?: Window } = {},
): () => void {
  return installHook("__ffInspect", read, options);
}

/**
 * Publishes the race's held intent as `window.__ffInput`, under the same
 * three rules as the visual hook: off unless asked for, read-only, live.
 */
export function installInputInspection(
  read: () => InputInspection,
  options: { enabled?: boolean; target?: Window } = {},
): () => void {
  return installHook("__ffInput", read, options);
}

/** Publishes the leak counters as `window.__ffCounts`, under the same rules. */
export function installLeakCounters(
  read: () => LeakCounters,
  options: { enabled?: boolean; target?: Window } = {},
): () => void {
  return installHook("__ffCounts", read, options);
}

/** Publishes the race's juice as `window.__ffJuice`, under the same rules. */
export function installJuiceInspection(
  read: () => JuiceInspection,
  options: { enabled?: boolean; target?: Window } = {},
): () => void {
  return installHook("__ffJuice", read, options);
}

/** Publishes whether the menu backdrop is drawn as `window.__ffBackdrop`, under the same rules. */
export function installBackdropInspection(
  read: () => BackdropInspection,
  options: { enabled?: boolean; target?: Window } = {},
): () => void {
  return installHook("__ffBackdrop", read, options);
}

/** Publishes where the local racer is drawn as `window.__ffRacer`, under the same rules. */
export function installRacerInspection(
  read: () => RacerInspection,
  options: { enabled?: boolean; target?: Window } = {},
): () => void {
  return installHook("__ffRacer", read, options);
}

/** The one gated install and guarded release every hook shares. */
function installHook<K extends HookName>(
  name: K,
  read: NonNullable<Window[K]>,
  options: { enabled?: boolean; target?: Window },
): () => void {
  const host = options.target ?? window;

  if ((options.enabled ?? VISUAL_INSPECTION_ENABLED) === false) {
    return () => {};
  }

  host[name] = read;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (host[name] === read) delete host[name];
  };
}
