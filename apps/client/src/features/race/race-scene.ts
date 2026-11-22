/**
 * A race, drawn: the scenery, the world, the HUD and the song.
 *
 * Shared by everything that shows a race. Gameplay draws one it follows over
 * the network; the replay draws one it steps itself. Neither owns a rule
 * here -- this draws whatever snapshot it is handed, and the screen decides
 * where that snapshot came from.
 *
 * Built after the screen has loaded the `gameplay` and `audio` bundles
 * (`loadRaceAssets`) and unlocked audio. The stage's song starts at GO
 * (`startSong`), unless the song reveal already started it, and then it
 * plays on.
 * `mountTouchInput` is the other half both screens share: the player's
 * fingers, feeding the screen's own `InputManager`.
 */

import type { SideContactObservation } from "@floor-fifty/shared/simulation/step";
import { roleTint, type RoleName } from "@floor-fifty/asset-contract/roles";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { sheetAliasFor } from "../profile/character-art";
import type { StageContent } from "@floor-fifty/shared/content/game-content";
import { Texture } from "pixi.js";
import { mount, unmount } from "svelte";
import { LOGICAL_VIEWPORT, PLAYER_SPRITE_SIZE } from "../../lib/constants";
import { DisposeBag } from "../../lib/dispose";
import { juiceLiveTuningFor } from "../../lib/juice-flags";
import { raceSong, type MixName, type SongLike } from "../audio";
import { RaceMix } from "../audio/race-mix";
import type { InputAction, InputManager } from "../platform/input";
import type { ScreenContext } from "../screen/screen";
import LoaderOverlay from "../kit/LoaderOverlay.svelte";
import { recoverableError } from "../net/error-view";
import { ErrorView } from "../screen/error-panel.svelte";
import { reducedMotion } from "../kit/motion";
import { feelIsReduced } from "./juice/feel-reduced";
import { MonotonicProgress, Readiness, weighted } from "../profile/progress.svelte";
import { LOADER_Z } from "../render/veil";
import { browserTimers, watchSlow } from "../../lib/load-meter";
import { hudCeiling } from "./hud-ceiling";
import { RaceHudView } from "./race-hud.svelte";
import type { RaceHintKind } from "./race-hints";
import { remeasureViewport } from "../platform/viewport-tracking.svelte";
import type { PredictedState } from "../net/local-simulation";
import { AmbientClock } from "../render/ambient-clock";
import { GameplayBackdrop } from "../render/gameplay-backdrop";
import { songTimings, type SongTiming } from "../audio/song-timings";
import { installJuiceInspection, installRacerInspection } from "../render/inspection";
import { MusicPulse, playingSongBeat } from "../render/music-pulse";
import { effectiveQuality, rebuildOnQuality } from "../render/quality-rebuild";
import { resolveStagePresentation, type StagePresentation } from "../render/stage-presentation";
import { visibleField } from "./camera";
import { GameplayView } from "./gameplay-view";
import { SwipeControls } from "./swipe-controls";
import { TouchControls, prefersTouchControls } from "./touch-controls";
import { loadedTextures } from "../render/textures";
import type { CountLabel } from "./countdown-clock";
import { JuiceDirector, type JuiceFrameResult } from "./juice/juice-director";
import { FeelDirector } from "./juice/feel-director";
import { Haptics, type HapticKind } from "../platform/haptics";
import { WordDirector, racePlace } from "./juice/word-director";
import { StageReactor, intensityAt, slamsInView } from "../render/stage-reactor";
import { SetPieceClock, climbFloor } from "../render/set-piece-clock";
import { SetPieceDirector } from "../render/set-piece-director";
import { plateCeiling } from "../render/flash-ceiling";
import type { PulseFrame } from "../render/music-pulse";
import { WordPool, type WordRoom } from "./juice/word-pool";
import { wordText, type WordSpec } from "./juice/word-text";
import { isEndless } from "@floor-fifty/shared/simulation/endless";
import { playerColorTint } from "@floor-fifty/asset-contract/roles";
import { SIZZLE_CUE, SIZZLE_GAIN, MissedFloorCueTracker, ladderHeight } from "./race-cues";
import { LiveTuning } from "./juice/live-tuning";
import { RespawnFlicker } from "./respawn-flicker";
import { CpuBarks } from "./juice/cpu-barks";

/**
 * Retries a failed load for as long as the player asks to. The asset manager
 * does not remember a failure, so each retry is a real fetch.
 */
async function loadWithRetry(context: ScreenContext, load: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await load();
      return;
    } catch {
      // Its own layer above the liquid veil: a move that covers the screen
      // loads this race under the wipe, and a Try again drawn beneath it would
      // be a blue screen with nothing to press.
      const host = document.createElement("div");
      host.style.cssText = `position: fixed; inset: 0; z-index: ${LOADER_Z};`;
      context.stage.overlay.append(host);
      const view = new ErrorView(host);
      await new Promise<void>((resolve) =>
        view.show(recoverableError("ASSET_LOAD_FAILED", "race-assets"), {
          onRetry: () => {
            view.hide();
            host.remove();
            resolve();
          },
        }),
      );
    }
  }
}

/**
 * Starts decoding the race song and does not wait for it. A whole song decodes
 * in about 20 s on an iPad mini (WebKit, 2026-10-10), and the loader used to
 * hold the race up to 8 s of that, so the screen hung on the blue transition
 * after the count. The race starts on its art; the song plays when its decode
 * lands (`startSong` asks for it at GO, and `playMusic` starts it then). A song
 * that will not decode is not a reason to hold the race either.
 */
function startSongDecode(context: ScreenContext, alias: string): void {
  void context.audio.preload?.(alias)?.catch(() => undefined);
}

/**
 * Loads what a race draws and plays, behind the loader (§3.1.5): one bar over
 * the loads, weighted by what each costs, from their real progress. A failed
 * load offers a real retry rather than leaving a blank screen. The loader
 * lives for one attempt: it covers the screen, so a failure panel shown while
 * it stood was drawn beneath it, and a retry starts a fresh bar.
 *
 * Given the stage's song, its decode starts here too (song select usually
 * started it already), but the race is never held for it: see
 * `startSongDecode`.
 *
 * Given the stage, its own bundle of layer art loads too (select spec §6.5).
 * A race with no stage chosen draws the fallback skylines, which live in
 * Rooftops' bundle. Given the song's group (`song-<id>`), the mixer maps it
 * as well, since a song's track is in its own group rather than in `audio`.
 * A bundle already loaded costs nothing.
 */
export async function loadRaceAssets(
  context: ScreenContext,
  label: string,
  options: { songAlias?: string | undefined; songGroup?: string | undefined; stageId?: string | undefined } = {},
): Promise<void> {
  const at = weighted([0.3, 0.15, 0.15, 0.1, 0.3]);
  const stageBundle = `stage-${options.stageId ?? "rooftops"}` as const;
  await loadWithRetry(context, async () => {
    const progress = new MonotonicProgress();
    const slow = new Readiness();
    const loader = mount(LoaderOverlay, { target: context.stage.overlay, props: { progress, label, slow, layer: LOADER_Z } });
    // Slow is not failing: past eight seconds the loader says so.
    const stopSlow = watchSlow(context.loads?.timers ?? browserTimers, () => (slow.ready = true));
    let loaded = false;
    try {
      await context.assets.loadBundle("gameplay", (fraction) => progress.report(at(0, fraction)));
      // Every character's sheet; normally already loaded behind the ready room.
      await context.assets.loadBundle("shell", (fraction) => progress.report(at(1, fraction)));
      await context.assets.loadBundle(stageBundle, (fraction) => progress.report(at(2, fraction)));
      // The audio bundle is empty until a track is authored; awaiting it
      // here keeps that arrival from changing this screen.
      await context.assets.loadBundle("audio", (fraction) => progress.report(at(3, fraction)));
      await context.audio.load("audio");
      if (options.songGroup !== undefined) await context.audio.load(options.songGroup);
      if (options.songAlias !== undefined) startSongDecode(context, options.songAlias);
      progress.report(1);
      loaded = true;
    } finally {
      stopSlow();
      // Loaded under a wipe, the loader outlives it: gone before the veil
      // clears, it would leave a frame of flat blue. A failure takes it down
      // at once, so the Try again panel is not drawn beneath it.
      if (loaded && context.veilCleared !== undefined) void context.veilCleared().then(() => unmount(loader));
      else void unmount(loader);
    }
  });
}

/**
 * The same bundles, loaded quietly: no loader and no retry panel. The select
 * phase's loading step uses it behind the reveal, where a panel would outlive
 * the Lobby and sit over the race. A failure rejects; the race's own
 * `loadRaceAssets` then retries with its loader up (select spec §5.1).
 *
 * Given the room's song, its group is mapped and its decode started, not
 * waited on (spec §6.5; see `startSongDecode`).
 */
export async function preloadRaceAssets(context: ScreenContext, stageId: string | undefined, songId?: string | undefined): Promise<void> {
  await context.assets.loadBundle("gameplay");
  await context.assets.loadBundle("shell");
  await context.assets.loadBundle(`stage-${stageId ?? "rooftops"}`);
  await context.assets.loadBundle("audio");
  const song = raceSong(context.content.current(), songId);
  if (song === undefined) return;
  await context.audio.load(`song-${song.id}`);
  startSongDecode(context, song.audioAlias);
}

/** The on-screen touch controls a race mounted, while it has them. */
export type TouchInput = { readonly isMounted: boolean; release(): void };

/**
 * Mounts the touch controls, where a finger is the primary input; `undefined`
 * elsewhere, since a desktop player must not lose a third of the screen to
 * buttons they cannot use.
 *
 * Swipe is the touch default and buttons the option (D6, spec §3.1.3). A
 * change in settings swaps one for the other mid-race, releasing whatever the
 * old one held first.
 */
export function mountTouchInput(context: ScreenContext, input: InputManager): TouchInput | undefined {
  if (!prefersTouchControls()) return undefined;
  let mounted: { readonly isMounted: boolean; unmount(): void } | undefined;
  const mountFor = (mode: "swipe" | "buttons"): void => {
    mounted?.unmount();
    const onInput = (action: InputAction, active: boolean): void => input.set(action, active, "touch");
    const controls = mode === "buttons" ? new TouchControls(onInput) : new SwipeControls(onInput);
    controls.mount(context.stage.overlay);
    mounted = controls;
  };
  let mode = context.settings.value.input.touchMode;
  mountFor(mode);
  const release = context.settings.subscribe((next) => {
    if (next.input.touchMode === mode) return;
    mode = next.input.touchMode;
    mountFor(mode);
  });
  // The controls hang off the viewport's foot, so they are only as right
  // as its last measurement. A WebView's bottom bar can settle while the
  // race loads and say nothing; this re-reads it as the screen appears.
  const stopRemeasure = remeasureViewport();
  return {
    get isMounted() {
      return mounted?.isMounted === true;
    },
    release() {
      stopRemeasure();
      release();
      mounted?.unmount();
      mounted = undefined;
    },
  };
}

/** What the HUD needs from the screen that owns the race. */
export type RaceHudOptions = ConstructorParameters<typeof RaceHudView>[1];

/** Infinite's stage arc repeats every this many floors (Wonder spec §6.5). */
const WONDER_PASS_FLOORS = 50;

export class RaceScene {
  readonly view: GameplayView;
  /**
   * The stage's cosmetic presentation, resolved once at entry.
   *
   * Held rather than re-read. The content port can replace its artifact at any
   * time -- a rebuild, a notification, a snapshot naming a newer revision -- and
   * a race must not change its scenery halfway up. Freezing this object is what
   * makes that a property rather than a promise.
   */
  readonly presentation: StagePresentation;
  readonly song: SongLike | undefined;
  /** The race song's beat grid, by alias, for keeping time to it while it plays. */
  private readonly songTimings: ReadonlyMap<string, SongTiming> | undefined;
  /** Owns the bounded scenery target and its filter chain; replaced on a quality change. */
  private currentBackdrop: GameplayBackdrop | undefined;
  /**
   * The one clock the scenery's ambient effects run on.
   *
   * Separate from `RenderClock`, which tracks authority and decides what moment
   * the world is drawn at. This one counts watched seconds and knows about
   * hidden tabs and reduced motion, which authority has no opinion about.
   */
  private readonly ambient = new AmbientClock();
  /**
   * The race's song as heard, for the scenery: its kick and its highs. Beside
   * the authored beat rather than instead of it -- that one is the tick's and
   * moves the platforms and the camera; this one only lights the backdrop.
   */
  private readonly musicPulse = new MusicPulse(0.5);
  /**
   * The one race HUD.
   *
   * Owned here rather than by the view, because it is DOM: it mounts into the
   * overlay at CSS resolution, and the view draws the world. The scene is the
   * only thing that has both the sampled snapshot and the layout.
   */
  private readonly hud: RaceHudView;
  private songStarted = false;
  private presentationMs = 0;
  private readonly flicker = new RespawnFlicker();
  /** The CPUs' mood words (CPU banding spec §4). */
  private readonly barks = new CpuBarks();
  /** The racer juice's tuning: held for the race, or live under `?dev=juice` (polish spec §4.1). */
  private readonly juiceTuning: LiveTuning;
  /** Squash and dust for every racer; the kick, hit-stop and pop for the local one (polish spec §4). */
  private readonly juice: JuiceDirector;
  /** What the juice answered on the last drawn frame. */
  private lastJuice: JuiceFrameResult | undefined;
  /** The view's and the hands' answer to it: shake, punch, flash, trail, rumble. */
  private readonly feel: FeelDirector;
  /** The mix's snapshot: the pause's muffle and the last floor's held breath. */
  private readonly raceMix = new RaceMix();
  private mixName: MixName = "race";
  /** "LAST FLOOR!" started on the frame just drawn. */
  private saidLastFloor = false;
  /** Survival's danger as last told to the mix. */
  private heardDanger = 0;
  /** The ladder's height in floors as last drawn, which pitches a bounce. */
  private floorCount = 20;
  /** The pop-up words' rules and their texts (Wonder spec §5). */
  private readonly words: WordDirector;
  private readonly wordPool: WordPool;
  /** The HUD's top band's bottom in field units, which no word or bark goes above; re-measured a few times a second. */
  private hudCeiling = 0;
  private hudCeilingAtMs = Number.NEGATIVE_INFINITY;
  /** The stage's answer to the song and the race (Wonder spec §6.2–6.3). */
  private readonly reactor: StageReactor;
  /** This frame of the song, as heard; undefined under reduced motion. */
  private pulse: PulseFrame | undefined;
  /** The stage's set pieces: when they play, and how (Wonder spec §6.4–6.5). */
  private readonly setPieceClock: SetPieceClock;
  private readonly setPieces: SetPieceDirector;
  private setPieceChange: { started?: ReturnType<SetPieceClock["force"]>; ended?: ReturnType<SetPieceClock["force"]> } = {};
  private readonly missedTracker = new MissedFloorCueTracker();
  private ascentCourse: string | undefined;
  private ascentEventTick = -1;
  private readonly bag = new DisposeBag();

  constructor(
    private readonly context: ScreenContext,
    private readonly options: {
      /** The room's own numbers, for presentation sizing and the local visual lead. */
      tuning: ResolvedTuning;
      localPlayerId: () => PlayerId | undefined;
      /**
       * The stage to draw and the song to play, chosen by the caller: a race
       * passes the catalog's first. Undefined draws the
       * legacy scenery, and plays nothing.
       */
      stage: StageContent | undefined;
      song: SongLike | undefined;
      hud?: RaceHudOptions;
      /**
       * Put before the juice's own sound keys: a replay's `replay:{playthrough}:`,
       * so a replayed slam or wrap sounds though the live race played it.
       */
      cueKeyPrefix?: () => string;
    },
  ) {

    // The stage's own song, from content, rather than an alias spelled here.
    //
    // A hardcoded `music.theme` is what this used to ask for, and it outlived
    // the asset it named: the authored track is `music.chromeInTheRain` and the
    // screen went quiet without anything failing, because an alias the bundle
    // does not carry is a no-op. Reading the alias off the stage is also what
    // lets a second stage bring its own track without touching this file.
    // It starts at GO (`startSong`), not here: the scene is built as the
    // countdown begins. A song the reveal started is already playing by then,
    // and plays on under the count; otherwise the count is heard over the
    // stage's bed alone (race-flow spec §3.3).
    this.song = options.song;
    this.songTimings = options.song === undefined ? undefined : songTimings([options.song]);
    // The manager outlives the scene, so a track left running would play
    // under the results and the menu after it.
    this.bag.add(() => context.audio.stop());
    // Nor may a pause's muffle, a held breath or the lava's rumble.
    this.bag.add(() => {
      context.audio.setMix?.("race");
      context.audio.setDanger?.(0);
    });
    this.bag.add(() => this.flicker.clear());
    this.juiceTuning = new LiveTuning(context.content, juiceLiveTuningFor(window.location.search, import.meta.env.DEV));
    this.bag.add(() => this.juiceTuning.destroy());

    // Resolved once, here, and never again, from the stage the caller chose.
    //
    // Before the view, because the view builds its scenery from it. A content
    // refresh can replace the artifact at any time, so the race reads this once
    // and holds it: nothing downstream can reach a newer stage.
    const presentation = resolveStagePresentation(options.stage);
    this.presentation = presentation;

    // Each racer's body, in their seat's colour. Read once with the stage, for
    // the same reason: a refresh mid-race must not redress anyone.
    const content = context.content.current()?.content;
    const view = new GameplayView(presentation, loadedTextures, options.tuning, options.localPlayerId, undefined, {
      sheetAliasFor: (characterId, colour) => sheetAliasFor(content, characterId, colour),
    });
    this.view = view;
    // The same song the mixer plays drives the world's pulse, and the view
    // reads its tempo rather than its sound: with no song catalogued the world
    // simply does not breathe. Set after the view exists, not when the track
    // starts -- the track starts earlier, and setting it then reached nothing.
    view.setSong(this.song);
    view.setTrajectoryGuide(context.settings.value.display.trajectoryGuide);

    // The field is the letterbox's flat backdrop colour, and it is opaque over
    // the whole canvas. The sky pass paints where nothing has been drawn, so
    // with the field visible there is nothing left for it to paint and the
    // dither never appears. A race hides it and the sky becomes the
    // background; every other screen keeps it.
    context.stage.field.visible = false;
    this.bag.add(() => {
      context.stage.field.visible = true;
    });

    // The racer juice (polish spec §4), drawn through the view. The stage's
    // dust is its own override in `juice.toml`, or the palette's dust role.
    const stageId = options.stage?.id;
    this.juice = new JuiceDirector({
      view,
      juice: () => this.juiceTuning.juice(),
      reduced: reducedMotion,
      // Read every frame, so the Settings checkbox takes hold mid-race.
      off: () => !context.settings.value.display.characterEffects,
      texture: Texture.WHITE,
      tuning: { ...options.tuning, PLAYER_SPRITE_SIZE },
      // Racer cues ride the effects bus, the HUD's pop the UI bus; each is
      // keyed, so the mixer plays it once however often it is asked.
      cue: (alias, key, sound) => context.audio.cue(alias, { bus: alias.startsWith("ui.") ? "ui" : "effects", eventId: key, ...sound }),
      floorCount: () => this.floorCount,
      ...(options.cueKeyPrefix === undefined ? {} : { keyPrefix: options.cueKeyPrefix }),
      dustTints: () => {
        const role = (stageId === undefined ? undefined : this.juiceTuning.juice()?.palette.stages[stageId]?.dust) ?? "dust";
        return [roleTint(role as RoleName)];
      },
    });
    this.bag.add(() => this.juice.destroy());
    // The feel layer (A/V polish plan): the shake, the punch, the flash, the
    // fast-fall's trail and lead, the panel's pulse, and the hands. A replay
    // is watched, not played, so it never rumbles.
    const haptics =
      options.hud?.replay === true
        ? undefined
        : new Haptics({
            enabled: () => context.settings.value.input.rumble,
            getGamepads: () => navigator.getGamepads?.() ?? [],
            ...(typeof navigator.vibrate === "function" ? { vibrate: (pattern: number | number[]) => navigator.vibrate(pattern) } : {}),
            touch: prefersTouchControls,
          });
    this.feel = new FeelDirector({
      view: {
        setShake: (x, y) => view.setShake(x, y),
        setPunch: (share) => view.setPunch(share),
        setLookAhead: (units) => view.setLookAhead(units),
        setImpact: (alpha) => view.setImpact(alpha),
        setFall: (share, tuning) => view.setFall(share, tuning),
        setAberration: (extra) => context.stage.setPanelAberration?.(extra),
      },
      feel: () => this.juiceTuning.juice()?.feel,
      fastFall: Math.abs(options.tuning.FAST_FALL_VELOCITY),
      // The device's setting, and the Character effects checkbox (audit S8).
      reduced: feelIsReduced({
        reducedMotion,
        characterEffects: () => context.settings.value.display.characterEffects,
      }),
      ...(haptics === undefined ? {} : { haptic: (kind: HapticKind) => haptics.pulse(kind) }),
    });
    this.bag.add(() => context.stage.setPanelAberration?.(0));
    this.words = new WordDirector(() => this.juiceTuning.juice()?.words, options.cueKeyPrefix);
    this.wordPool = new WordPool(
      { world: view.wordLayer, beat: view.beatLayer },
      () => this.juiceTuning.juice()?.words,
      () => this.juiceTuning.juice()?.springs.word,
    );
    this.bag.add(() => this.wordPool.destroy());
    this.reactor = new StageReactor(() => this.juiceTuning.juice()?.springs.jolt);
    // Where the player is drawn, for the fit checks of what lies over the race; test builds only.
    this.bag.add(installRacerInspection(() => ({ local: this.localRacerRect(), tick: this.drawnTick })));
    // The frame-budget gate's reader and stress switch; test builds only.
    this.bag.add(
      installJuiceInspection(() => ({
        liveParticles: this.juice.liveParticles,
        stress: (on: boolean) => this.juice.setStress(on),
        liveWords: this.wordPool.live,
        setPiece: (floor: number) => this.forceSetPiece(floor),
        widestWord: () => this.widestWord(),
      })),
    );

    // The controller takes the bounded scenery target for the sky and builds
    // its chain over it: sky, refraction, palette lock. The sky root is the
    // target's source and is deliberately never added to the stage -- a source
    // that is also in the display tree is drawn twice, once at device
    // resolution, which is the cost the bound exists to avoid. The city root is
    // parented by the controller above the target's output and drawn crisp,
    // through its atmosphere and a lock of its own.
    //
    // It also owns putting the backdrop layer back. The palette lock it borrows
    // is the app's single instance, and an instance may not serve two targets,
    // so it moves rather than being copied.
    //
    // It follows the player's graphics quality live (§3.1.2): a change destroys
    // this build and makes the next, which is told the rectangle as it lands.
    //
    // The city's refraction measures its warp against the canvas in logical
    // units, so it is told the rectangle now and again on every layout.
    const fitGlass = (): void =>
      this.currentBackdrop?.setViewport(context.stage.viewport.sceneryLogical, context.stage.cellSize * context.stage.pixelRatio);
    const skyPlate = presentation.layers.find((layer) => layer.plate === "sky" && layer.extend === "plate");
    const flashCeiling = skyPlate === undefined ? undefined : plateCeiling(loadedTextures(skyPlate.alias));
    this.setPieceClock = new SetPieceClock(presentation.setPieces);
    this.setPieces = new SetPieceDirector({
      backdrop: () => this.currentBackdrop,
      particles: view.skyParticles,
      kick: (units) => view.addSetPieceKick(units),
      quality: () => effectiveQuality(context.settings.value.display.quality),
      reduced: reducedMotion,
      off: () => !context.settings.value.display.stageEffects,
    });
    this.bag.add(() => this.setPieces.destroy());
    context.stage.world.addChildAt(view.skyParticles.root, 0);
    this.bag.add(() => view.skyParticles.destroy());
    const backdrop = rebuildOnQuality(
      context.settings,
      (quality) =>
        new GameplayBackdrop(
          context.stage,
          { sky: view.skyParallax, city: view.cityParallax, windowsCoded: view.windowsCoded },
          { quality: effectiveQuality(quality), presentation },
        ),
      (built) => {
        this.currentBackdrop = built;
        fitGlass();
        // The sky plate's brightest colour holds every sky flash under it (Wonder spec §6.6).
        if (flashCeiling !== undefined) built.setFlashCeiling(flashCeiling);
        // A rebuilt backdrop takes the set piece's mood, and at `low` nothing else.
        this.setPieces?.reapply();
      },
    );
    this.bag.add(() => {
      backdrop.dispose();
      this.currentBackdrop = undefined;
    });
    this.bag.add(context.stage.onViewportChange(fitGlass));
    // The line where the scenery starts stretching is reported every frame;
    // on exit it is let go, so no other screen inherits the bar.
    this.bag.add(() => context.stage.setSkirtLine?.(undefined));
    // A race and a replay keep the 16:9 field; the menus after
    // them have the whole window back.
    context.stage.setBandMode?.("field");
    this.bag.add(() => context.stage.setBandMode?.("menu"));

    // The ambient clock's two uncomfortable cases, wired once. A hidden tab
    // resumes without catch-up and reduced motion freezes at the still pose;
    // both are decisions about watched time, which is why they live on the
    // clock rather than being re-derived per effect.
    const readHidden = (): boolean => document.visibilityState === "hidden";
    const onVisibility = (): void => this.ambient.setHidden(readHidden());
    const onMotion = (): void => this.ambient.setReducedMotion(reducedMotion());
    this.ambient.setHidden(readHidden());
    this.ambient.setReducedMotion(reducedMotion());
    document.addEventListener("visibilitychange", onVisibility);
    const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    motionQuery?.addEventListener("change", onMotion);
    this.bag.add(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery?.removeEventListener("change", onMotion);
    });
    context.stage.world.addChild(view.world);
    context.stage.world.addChild(view.beatLayer, view.lavaLayer);
    (context.stage.effects ?? context.stage.world).addChild(view.feelLayer);
    // Over the picture at the canvas's resolution, so the pixel face is not resampled by the composite.
    if (context.stage.effects !== undefined) view.attachTagLayer(context.stage.effects);
    (context.stage.front ?? context.stage.effects ?? context.stage.world).addChild(view.frontLayer);
    // No HUD layer added here. The Pixi one is retired: the DOM HUD mounts into
    // the overlay below, and a drawn one left in `ui` would be a second HUD
    // under the first.
    this.bag.add(() => view.destroy());

    // Mounted once per race and updated in place. It reads the stage's own
    // published layout for its placement, so a rotation moves the HUD with the
    // field rather than against it -- and the letterbox and the HUD cannot
    // disagree about where the visible play area is.
    const hud = new RaceHudView(context.stage, options.hud);
    this.hud = hud;
    hud.setRacerRect(() => this.localRacerRect());
    this.bag.add(() => hud.destroy());
  }

  /** The scenery's current build, which a quality change replaces. */
  get backdrop(): GameplayBackdrop | undefined {
    return this.currentBackdrop;
  }

  /**
   * Where the local racer and its nameplate are drawn, in viewport pixels,
   * for DOM that must keep clear of them. The overlay lines up with the
   * field, whose logical width is the viewport's, so one scale maps both.
   */
  localRacerRect(): { left: number; top: number; right: number; bottom: number } | undefined {
    const bounds = this.view.localRacerBounds();
    const frame = this.context.stage.overlay.getBoundingClientRect();
    if (bounds === undefined || frame.width === 0) return undefined;
    const scale = frame.width / LOGICAL_VIEWPORT.width;
    return {
      left: frame.left + bounds.x * scale,
      top: frame.top + bounds.y * scale,
      right: frame.left + (bounds.x + bounds.width) * scale,
      bottom: frame.top + (bounds.y + bounds.height) * scale,
    };
  }

  /** The tick of the snapshot last drawn, for the visual inspection. */
  private drawnTick = 0;

  /** Watched seconds on the ambient clock, for the visual inspection. */
  get ambientSeconds(): number {
    return this.ambient.seconds;
  }

  /** The local racer's predicted resets: they flicker at once (race-flow spec §5.1). */
  noteResets(events: readonly RaceEvent[]): void {
    this.flicker.note(events, this.presentationMs);
    // Before the frame that draws the respawn, so its rise is not a landing.
    this.juice.notePredictedResets(events);
  }

  /**
   * The room's batch: each reset flickers, and each event the juice answers
   * plays, when the drawn moment reaches it.
   */
  noteRoomResets(events: readonly RaceEvent[]): void {
    this.flicker.noteAt(events);
    this.juice.noteRoomEvents(events);
  }

  /**
   * Events the juice answers, from a run with no room: the replay's own
   * world is its authority (polish spec §4.1).
   */
  noteRoomEvents(events: readonly RaceEvent[]): void {
    this.juice.noteRoomEvents(events);
  }

  /** Puts the camera on the finish's winner: a glide, or a cut under reduced motion. */
  focusOn(playerId: PlayerId, cut: boolean): void {
    this.view.focusOn(playerId, cut);
  }

  /** Lines for the race's polite region (race-flow spec §6). */
  announce(lines: readonly string[]): void {
    this.hud.announce(lines);
  }

  /** The hint in the HUD's toast slot, or none (`features/race/race-hints.ts`). */
  setHint(kind: RaceHintKind | undefined): void {
    this.hud.setHint(kind);
  }

  /**
   * The race song, from GO (race-flow spec §3.3). Idempotent. A song the
   * reveal started is left where it is rather than started over.
   */
  startSong(): void {
    if (this.songStarted || this.song === undefined) return;
    this.songStarted = true;
    if (this.context.audio.isLooping?.(this.song.audioAlias) === true) return;
    this.context.audio.play(this.song.audioAlias);
  }

  /** The countdown over the stage this frame, or nothing between counts. */
  setCount(label: CountLabel | undefined): void {
    this.hud.setCount(label);
  }

  /**
   * The pop-up words for this frame (Wonder spec §5): what the juice answered
   * and the room reached, named by the director and drawn by the pool, with
   * their stings and the announcer's lines, and the race beats read out.
   */
  private sayWords(sample: RoomSnapshot, localId: PlayerId | undefined, predicted: PredictedState | undefined, deltaMs: number): void {
    const juice = this.lastJuice;
    const tuning = this.juiceTuning.juice();
    if (juice === undefined || tuning === undefined) return;
    if (juice.restarted) {
      this.words.clear();
      this.wordPool.clear();
    }
    const local = localId === undefined ? undefined : sample.players.find((player) => player.id === localId);
    const racing = sample.phase === "racing" || sample.phase === "finished";
    const place =
      local === undefined || !racing
        ? undefined
        : racePlace({ players: sample.players, standings: sample.standings, endless: isEndless(sample.tuning) }, local.id);
    const said = this.words.frame({
      nowMs: this.presentationMs,
      tick: sample.tick,
      localId,
      juice,
      localPlace: place,
      localStatus: local === undefined ? undefined : local.finishedAtTick === undefined ? "racing" : "finished",
      localLap: local?.lap ?? 1,
      lapCount: sample.lapCount,
      localFloors: local === undefined ? 0 : Math.round(local.progress * sample.floorCount),
      goalFloors: isEndless(sample.tuning) ? undefined : sample.floorCount,
      stress: this.juice.stressed,
      cpus: new Set(sample.players.filter((player) => player.cpu).map((player) => player.id)),
    });
    const positionOf = (id: PlayerId) => {
      const player = sample.players.find((each) => each.id === id);
      if (player === undefined) return undefined;
      return predicted !== undefined && id === localId ? predicted : player;
    };
    this.saidLastFloor = said.started.some((word) => word.kind === "lastFloor");
    // With character effects off the words are named, sound and are read
    // out as ever, and none is drawn; any on screen go at once.
    const drawn = this.context.settings.value.display.characterEffects;
    if (!drawn) this.wordPool.clear();
    for (const word of drawn ? said.started : []) {
      const racer = word.playerId === undefined ? undefined : sample.players.find((player) => player.id === word.playerId);
      this.wordPool.show(word, racer === undefined ? roleTint("finishBurst") : playerColorTint(racer.colour), reducedMotion());
    }
    for (const cue of said.cues) {
      this.context.audio.cue(cue.alias, {
        bus: cue.bus,
        eventId: cue.key,
        ...(cue.gain === undefined ? {} : { gain: cue.gain }),
        ...(cue.rate === undefined ? {} : { rate: cue.rate }),
        ...(cue.delayMs === undefined ? {} : { delayMs: cue.delayMs }),
      });
    }
    if (said.announce.length > 0) this.announce(said.announce.map((word) => wordText(word, tuning.words)));
    if (drawn) this.wordPool.update(deltaMs / 1_000, this.presentationMs, reducedMotion(), positionOf, new Set(this.words.live.map((word) => word.key)), this.wordRoom());
  }

  /**
   * The bottom of the HUD's top band in field units, which the words and the
   * barks keep under. The overlay lines up with the field, whose logical width
   * is the viewport's, so one scale maps the HUD's CSS px. Measured four times
   * a second, never every frame: a read of its layout after its text changed
   * would force one.
   */
  private measureHudCeiling(): void {
    if (this.presentationMs - this.hudCeilingAtMs < 250) return;
    this.hudCeilingAtMs = this.presentationMs;
    const overlay = this.context.stage.overlay;
    const width = overlay.getBoundingClientRect().width;
    this.hudCeiling = width > 0 ? hudCeiling(overlay) / (width / LOGICAL_VIEWPORT.width) : 0;
  }

  /** Where the words have room: the world's transform into the field, the beat's stamp, the HUD's ceiling and the field's width. */
  private wordRoom(): WordRoom {
    const world = this.view.world;
    return {
      toField: { x: world.x, y: world.y, scale: world.scale.x },
      beatAt: { x: this.view.beatLayer.x, y: this.view.beatLayer.y },
      ceiling: this.hudCeiling,
      width: LOGICAL_VIEWPORT.width,
    };
  }

  /**
   * The stage's answer this frame (Wonder spec §6.2–6.3): the beat's bob and
   * the kick's surge, a slam's jolt and flash, a streak's glow, all growing
   * with the climb, read from the camera's height as a share of the race's.
   * Infinite climbs in passes of fifty floors.
   */
  private reactStage(sample: RoomSnapshot, localId: PlayerId | undefined, deltaMs: number): void {
    const gap = this.options.tuning.FLOOR_GAP_MIN;
    const cameraY = this.view.camera.y;
    const endless = isEndless(sample.tuning);
    // A rewind starts the stage's story over with the juice's.
    if (this.lastJuice?.restarted === true) {
      this.setPieceClock.reset();
      this.setPieces.destroy();
    }
    // How far up the race the followed racer is, by authority, not the camera:
    // the camera glides back down after a lap, and read from it the arc would
    // run ahead at every lap boundary. Laps already climbed count.
    const followed = sample.players.find((player) => player.id === localId);
    const ladder = ladderHeight(sample);
    const climbed = endless
      ? Math.max(0, cameraY / gap)
      : climbFloor(followed?.lap ?? 1, ladder, (followed?.progress ?? 0) * ladder * gap, gap);
    const intensity = endless
      ? intensityAt(climbed % WONDER_PASS_FLOORS, WONDER_PASS_FLOORS)
      : intensityAt(climbed, ladder * sample.lapCount);
    // The streak holds the glow until that racer's reset, not just while its word shows.
    const streak = localId === undefined ? 0 : this.words.streakOf(localId);
    const motion = this.reactor.update({
      dtSeconds: deltaMs / 1_000,
      pulse: this.pulse,
      intensity,
      // Only the slams on screen: a rival a hundred floors below shakes nothing the viewer sees.
      slams: slamsInView(this.lastJuice?.moments ?? [], cameraY, LOGICAL_VIEWPORT.height / 2),
      streak,
      reduced: reducedMotion(),
      low: effectiveQuality(this.context.settings.value.display.quality) === "low",
      off: !this.context.settings.value.display.stageEffects,
    });
    const raceFloors = endless ? undefined : ladder * sample.lapCount;
    const change = this.setPieceClock.update(this.presentationMs, climbed, raceFloors);
    const forced = this.setPieceChange;
    this.setPieceChange = {};
    const pieces = this.setPieces.update(this.presentationMs, {
      started: forced.started ?? change.started,
      ended: forced.ended ?? change.ended,
    });
    this.view.skyParticles.update(this.presentationMs, deltaMs / 1_000);
    this.view.setStageMotion(pieces.swarm.size === 0 ? motion : { ...motion, swarm: pieces.swarm });
    this.currentBackdrop?.setStageLift(this.reactor.glowLift, this.reactor.windowFlash);
  }

  /** Every word at its largest (×99 GREAT!, LAP 3!, the fourth place), at the beat size: the widest. */
  widestWord(): number {
    const tuning = this.juiceTuning.juice();
    if (tuning === undefined) return 0;
    const largest: WordSpec[] = [
      { kind: "slam" },
      { kind: "streak", count: 99 },
      { kind: "skip" },
      { kind: "pass" },
      { kind: "lead" },
      { kind: "lap", lap: 3 },
      { kind: "finalAscent" },
      { kind: "lastFloor" },
      { kind: "place", place: 4 },
      { kind: "whoops" },
      { kind: "back" },
    ];
    return this.wordPool.widest(largest.map((word) => wordText(word, tuning.words)));
  }

  /**
   * Starts the stage's set piece at `floor` now, ending any that holds: the
   * frame-budget gate's hook (`__ffJuice`). False if the stage has none there.
   */
  forceSetPiece(floor: number): boolean {
    const ended = this.setPieceClock.active;
    const started = this.setPieceClock.force(floor, this.presentationMs);
    if (started === undefined) return false;
    this.setPieceChange = { started, ...(ended === undefined ? {} : { ended }) };
    return true;
  }

  /** The pause overlay opened or closed: the race is heard through it muffled. */
  setPaused(paused: boolean): void {
    this.raceMix.setPaused(paused);
    this.applyMix(this.raceMix.frame({ nowMs: this.presentationMs, lastFloor: false, release: false }));
  }

  /**
   * The mix this frame (see `RaceMix`): the breath "LAST FLOOR!" holds and
   * the finish, a reset or an out lets go, and Survival's danger.
   */
  private mixFrame(localId: PlayerId | undefined): void {
    const juice = this.lastJuice;
    if (juice?.restarted === true) this.raceMix.reset();
    const release =
      juice?.reached.some(
        (event) =>
          event.type === "raceFinished" ||
          ((event.type === "playerReset" || event.type === "playerOut") && event.playerId === localId),
      ) === true;
    this.applyMix(this.raceMix.frame({ nowMs: this.presentationMs, lastFloor: this.saidLastFloor, release }));
    // Told only when it moves, so a race with no lava never touches the graph.
    const danger = this.view.survivalDanger;
    if (Math.abs(danger - this.heardDanger) >= 0.01 || (danger === 0 && this.heardDanger !== 0)) {
      this.heardDanger = danger;
      this.context.audio.setDanger?.(danger);
    }
  }

  private applyMix(name: MixName): void {
    if (name === this.mixName) return;
    this.mixName = name;
    this.context.audio.setMix?.(name);
  }

  /** The local racer slammed on the last drawn frame: its landing's cue gives way (Wonder spec §3.2). */
  get localSlammed(): boolean {
    return this.lastJuice?.localSlammed === true;
  }

  /** What the juice answered on the last drawn frame. */
  get juiceFrame(): JuiceFrameResult | undefined {
    return this.lastJuice;
  }

  /**
   * Draws one frame of `sample`.
   *
   * `deltaMs` is the ticker's capped delta and drives animation only. The local
   * player is drawn from `predicted` when there is one, and everyone else from
   * the sample. `localLanding` says the local racer's predicted landing is
   * about to sound, so the bounce under it stays quiet.
   */
  draw(
    sample: RoomSnapshot,
    deltaMs: number,
    predicted?: PredictedState,
    floors?: ReadonlyMap<string, number>,
    clockTick?: number,
    localLanding = false,
    sideContacts: readonly SideContactObservation[] = [],
  ): void {
    const localId = this.options.localPlayerId();
    this.drawnTick = sample.tick;
    this.floorCount = ladderHeight(sample);
    // Presentation time: what the HUD's pulses and a flicker run on. It slows
    // with the finish's time scale, which arrives in `deltaMs`.
    this.presentationMs += deltaMs;

    // Ambient time, from the one clock that knows about hidden tabs and reduced
    // motion. Both the twinkle and the refraction read the value it returns, so
    // they cannot drift apart, and neither can run ahead of watched time.
    const seconds = this.ambient.advance(deltaMs);
    this.currentBackdrop?.update(seconds);
    // Where the race song is, in its own beats, while it plays at full speed:
    // what the scenery and the world keep time to.
    const songBeat = this.songTimings === undefined ? undefined : playingSongBeat(this.context.audio, this.songTimings);
    // Reduced motion rests the heard pulse, as it stills the authored one.
    this.pulse = reducedMotion()
      ? undefined
      : this.musicPulse.update(deltaMs / 1_000, this.context.audio.musicSpectrum?.(), songBeat);
    this.currentBackdrop?.setMusic(this.pulse);

    this.view.setSongBeat(songBeat?.beat);

    // The climb raises the horizon. `progress` is authority's, read off the
    // snapshot and never derived here.
    const local = sample.players.find((player) => player.id === localId);
    this.currentBackdrop?.setProgress(local?.progress ?? 0);

    this.view.setAmbient(seconds, reducedMotion());
    this.view.setTrajectoryGuide(this.context.settings.value.display.trajectoryGuide);
    const stage = this.context.stage;

    this.view.setPixelDensity(stage.cellSize * stage.pixelRatio);
    this.view.setCssPerUnit(stage.cellSize);
    this.view.setFraming(
      stage.viewport.portrait,
      stage.viewport.sceneryLogical,
      stage.viewport.fieldLogical.height,
      stage.viewport.formFactor === "phone-portrait",
      visibleField(stage.viewport),
    );
    // The juice hears this frame before the view draws it, so a squash it
    // starts is on the sprite this frame rather than the next. It reads what is
    // drawn: the prediction for the local racer, the sample for the rest.
    this.lastJuice = this.juice.frame({
      tick: sample.tick,
      nowMs: this.presentationMs,
      localId,
      localLanding,
      sideContacts,
      racers: sample.players.map((player) => {
        const drawn = predicted !== undefined && player.id === localId ? predicted : player;
        return { id: player.id, x: drawn.x, y: drawn.y, vx: drawn.vx, vy: drawn.vy, colour: player.colour, facingRight: drawn.facingRight };
      }),
      sampled: new Map(sample.players.map((player) => [player.id, { x: player.x, y: player.y, holdUntilTick: player.holdUntilTick }])),
    });
    // The feel layer reads what the juice answered and the local racer's fall,
    // before the view applies the snapshot, so the camera leads this frame.
    if (this.lastJuice.restarted === true) this.feel.restart();
    const drawnLocal = localId === undefined ? undefined : (predicted ?? sample.players.find((player) => player.id === localId));
    this.feel.frame({
      nowMs: this.presentationMs,
      localId,
      local: drawnLocal === undefined ? undefined : { y: drawnLocal.y, vy: drawnLocal.vy },
      onScreen: (y) => this.view.camera.showsY(y),
      moments: this.lastJuice.moments,
      reached: this.lastJuice.reached,
    });
    this.measureHudCeiling();
    this.view.setHudCeiling(this.hudCeiling);
    this.saidLastFloor = false;
    this.sayWords(sample, localId, predicted, deltaMs);
    this.mixFrame(localId);
    this.reactStage(sample, localId, deltaMs);
    this.hud.setFloorsPop(this.juice.hudPops, this.juiceTuning.juice()?.collect.hudPop.scale, this.juiceTuning.juice()?.springs.hudPop);
    const localLap = sample.players.find((player) => player.id === localId)?.lap;
    const ascentCourse = `${sample.round}:${sample.courseRevision}:${localId}:${localLap}`;
    if (ascentCourse !== this.ascentCourse || this.lastJuice.restarted) {
      this.ascentCourse = ascentCourse;
      this.ascentEventTick = -1;
      this.missedTracker.resetAscent();
      this.view.resetAscent();
    }
    for (const event of sample.events) {
      if ((event.type === "playerReset" || event.type === "lapCompleted") && event.playerId === localId && event.tick > this.ascentEventTick) {
        this.ascentEventTick = event.tick;
        this.missedTracker.resetAscent();
        this.view.resetAscent();
      }
    }
    this.view.applySnapshot(sample, localId, deltaMs, predicted, floors);
    this.hud.setRecoveryHint(this.view.hasMissedFloor);
    // One recovery cue per ascent, even if descent and ascent cross the threshold repeatedly.
    const missedSound = this.missedTracker.observe(this.view.newlyMissed);
    if (missedSound !== undefined) {
      this.context.audio.cue(missedSound.alias, {
        bus: missedSound.bus,
        ...(missedSound.gain === undefined ? {} : { gain: missedSound.gain }),
        eventId: `${this.options.cueKeyPrefix?.() ?? ""}${missedSound.eventId}`,
      });
    }
    // Survival's lava (lava spec §5): a sizzle as the local racer dips in, and
    // a splash where they went under.
    const dip = this.view.lavaDip;
    if (dip !== undefined) {
      this.context.audio.cue(SIZZLE_CUE, { bus: "effects", gain: SIZZLE_GAIN, eventId: `${this.options.cueKeyPrefix?.() ?? ""}${dip}` });
    }
    if (this.lastJuice?.reached.some((event) => event.type === "playerOut" && event.playerId === localId) === true) {
      this.view.lavaSplash();
    }
    // Over the racer, and in the standings, where it shows wherever the CPU is on the course.
    for (const bark of this.barks.update(sample)) {
      this.view.showBark(bark.id, bark.text, bark.colour);
      this.hud.bark(bark.id, bark.text, this.presentationMs);
    }
    const reduced = reducedMotion();
    this.flicker.reach(sample.tick, this.presentationMs);
    for (const player of sample.players) {
      this.view.setBodyAlpha(player.id, this.flicker.alpha(player.id, this.presentationMs, reduced));
    }
    // Where the scenery starts stretching, for a phone held upright to cover
    // (`LetterboxFrame.setSkirtLine`). Read after the snapshot moved the city.
    stage.setSkirtLine?.(this.view.skirtLine());
    // The same sample the world was drawn from, and never the prediction: a HUD
    // that counted a predicted floor would report progress the server has not
    // agreed to, and would have to take it back a round trip later.
    this.hud.update(sample, localId, this.presentationMs, clockTick);
    // Read after the snapshot, because the pulse is computed from it. The scene
    // glow belongs to the scenery chain, which the controller owns, so it is
    // handed over rather than set here.
    this.currentBackdrop?.setGlow(this.view.cityGlow);

    // The track opens up with the climb. The view owns the intensity because it
    // draws from it too, and the mix follows rather than tracking it a second
    // time -- two things easing toward the same target on their own clocks
    // would drift apart and read as the picture and the sound disagreeing.
    this.context.audio.setMusicCutoff(this.view.musicCutoffHz);
  }

  /** Releases everything the constructor made, most recent first. */
  destroy(): void {
    this.bag.dispose();
  }
}
