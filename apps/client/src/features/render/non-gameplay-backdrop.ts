/**
 * Screen-owned refracted menu backdrop: a refracted sky plate with the crisp
 * menu city drawn over it (launch polish spec §2.8).
 *
 * The controller keeps GPU, ticker, media-query, display-list, and DOM marker
 * ownership together so a screen transition can release the whole effect with
 * one idempotent call. A rejected shader leaves the source sprite visible.
 *
 * Time comes from the shared `AmbientClock` rather than a counter here, so the
 * menu and the race cannot disagree about what a hidden tab or a long frame
 * costs the optics. The one rule the clock does not answer for the menu is
 * reduced motion, which the menu treats as a still pose it draws while holding
 * its own phase -- see the tick.
 *
 * The menu song moves it too (`MusicPulse`): the lit windows of the hero's
 * building jump on each kick and flicker on the highs, and on the title the
 * camera is struck by the kick, a zoom in that falls straight back, once the
 * intro is home. The building is DOM (`MenuHero.svelte`), so its windows are
 * drawn by `facade-windows.ts` on the clock and glow published from here; the
 * skyline behind it keeps its windows still, so the eye goes to the rooftop.
 */

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { MusicSpectrum } from "../audio";
import { MusicPulse, type SongBeat } from "./music-pulse";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import type { StagePort, ViewRect, ViewportInfo } from "./stage-port";
import { loadedTextures, type TextureProvider } from "./textures";
import { AmbientClock } from "./ambient-clock";
import {
  DAWN_REFRACTION_STILL_SECONDS,
  createDawnRefractionFilter,
  refractionQualityFor,
  setDawnRefractionFrame,
  validateDawnRefractionProgram,
  type DawnRefractionFilter,
} from "./filters/dawn-refraction";
import { VISUAL_INSPECTION_ENABLED } from "./inspection";
import { MENU_TILT, menuParallax, tiltLean, type MenuLayer, type Offset, type Tilt } from "./menu-parallax";
import { type QualityLevel } from "../profile/quality";
import { addRenderPass } from "../platform/render-order";
import { publishMenuWindows } from "./window-breath";
import { createSunShimmerFilter, setSunShimmerTime, type SunShimmerFilter } from "./filters/sun-shimmer";

/**
 * Where the sun is painted in the menu plate, as fractions of the plate: the
 * disc sits at about (514, 332) of 960 x 540 with a 40-pixel radius. The heat
 * reaches a couple of radii past it, taking in the skyline in front.
 */
const MENU_SUN_REGION = { x: 514 / 960, y: 332 / 540, radiusX: 40 / 960, radiusY: 40 / 540 } as const;
import { PULSE_DEPTH } from "./world-pulse";

export type RefractionEnvironment = {
  hidden(): boolean;
  reducedMotion(): boolean;
  onVisibilityChange(listener: () => void): () => void;
  onMotionChange(listener: () => void): () => void;
};

export type NonGameplayBackdropOptions = {
  textures?: TextureProvider;
  quality?: QualityLevel;
  createFilter?: (quality: QualityLevel) => DawnRefractionFilter;
  /** Builds the far city's soft refraction (spec §2.9); injectable for tests. */
  createCityRefraction?: (quality: QualityLevel) => DawnRefractionFilter;
  validateFilter?: (filter: DawnRefractionFilter) => void;
  environment?: RefractionEnvironment;
  /**
   * Opens zoomed in and pulls back to the resting framing (`MENU_INTRO`):
   * the title's first showing, as the racers drop onto the ledge.
   */
  zoomIn?: boolean;
  /** The song as it sounds this frame; absent, the windows rest and the camera is still. */
  music?: () => MusicSpectrum | undefined;
  /** Where the song is in its own beats this frame; absent, its beats are heard. */
  song?: () => SongBeat | undefined;
  /** Whether the kick strikes the camera this frame: the title's, not the lobby's. */
  beatZoom?: () => boolean;
  /**
   * Whether the player has turned the stage effects off: held still this
   * frame as reduced motion holds it, the windows and camera off the beat.
   */
  still?: () => boolean;
};

const browserEnvironment = (): RefractionEnvironment => ({
  hidden: () => document.visibilityState === "hidden",
  reducedMotion: () =>
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  onVisibilityChange(listener) {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
  onMotionChange(listener) {
    const query = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (query === undefined) return () => {};
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  },
});

/**
 * An inspection-only test pattern for measuring the refraction's warp.
 *
 * `?refraction-probe=vertical` or `=horizontal` replaces the menu plate with
 * 1-logical-unit white lines on black at a 32-unit pitch, centred in each cell
 * (at 16 + 32k), in one axis. One axis per capture, because the diffusion and
 * the warp together reach further than half a pitch, and a crossing line would
 * pollute the other axis's centroid. Behind the same gate as the quality
 * override, so a production build can never show it.
 */
export type RefractionProbe = "vertical" | "horizontal";

export const REFRACTION_PROBE_PITCH = 32;

export function refractionProbeFor(
  search: string,
  allowInspectionOverride: boolean,
): RefractionProbe | undefined {
  if (!allowInspectionOverride) return undefined;
  const value = new URLSearchParams(search).get("refraction-probe");
  return value === "vertical" || value === "horizontal" ? value : undefined;
}

function createProbeTexture(probe: RefractionProbe, width: number, height: number): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return Texture.WHITE;
  context.fillStyle = "#000000";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  const half = REFRACTION_PROBE_PITCH / 2;
  if (probe === "vertical") {
    for (let x = half; x < width; x += REFRACTION_PROBE_PITCH) context.fillRect(x, 0, 1, height);
  } else {
    for (let y = half; y < height; y += REFRACTION_PROBE_PITCH) context.fillRect(0, y, width, 1);
  }
  const texture = Texture.from(canvas);
  // One texel per logical unit, and nearest, so the line is exactly one unit
  // wide wherever the composite puts it.
  texture.source.scaleMode = "nearest";
  return texture;
}

const restoreDataset = (element: HTMLElement, key: string, value: string | undefined): void => {
  if (value === undefined) delete element.dataset[key];
  else element.dataset[key] = value;
};

/** How much larger than the frame each layered plate is drawn: room to slide. */
const MENU_OVERSCAN = 1.05;

/**
 * The camera's pull back on the title's first showing, timed to the racers'
 * drop (`MenuHero`): from `from` times the resting framing to it, easing in
 * and out -- gathering speed, then settling -- and home at `seconds`, the
 * moment the last racer touches the ledge (300 ms wait, three 120 ms
 * staggers, 60% of a 520 ms fall). Never past the resting framing, so the
 * overscanned plates never uncover an edge.
 */
export const MENU_INTRO = { from: 1.3, seconds: 0.972 } as const;

/**
 * What the menu song does to it. `windowKick` and `windowSpike` are window
 * glow added at a full kick and a full spike of the highs, over the race's
 * resting glow -- a kick climbs a window two steps of its ramp, a hat about
 * one. `zoom` is how far a full kick -- a heavy beat -- pushes the camera in:
 * a jolt the eye reads as the beat, too small for the overscan to show an
 * edge. An ordinary beat is about a fifth of it (`MusicPulse`), a nudge.
 */
export const MENU_MUSIC_PULSE = { windowKick: 3.2, windowSpike: 1.4, zoom: 0.045 } as const;

/** Before the song's own beat is heard. Nothing moves on a beat that is only run on. */
const MENU_BEAT_SECONDS = 0.5;

/** When the intro is over, in seconds. */
const MENU_INTRO_END = MENU_INTRO.seconds;

/** The intro's zoom at `seconds` in: a cubic ease-in-out. */
export function menuIntroZoom(seconds: number): number {
  const t = Math.min(1, Math.max(0, seconds / MENU_INTRO.seconds));
  const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  return 1 + (MENU_INTRO.from - 1) * (1 - eased);
}

export class NonGameplayBackdrop {
  readonly filtered: boolean;

  /**
   * The optical time the refraction is drawn at, in seconds.
   *
   * Read off the ambient clock rather than counted here: the clock owns the
   * clamp on a long frame and the rule that a resume costs nothing, and a
   * second counter would be a second answer to those questions.
   */
  get elapsedSeconds(): number {
    return this.clock.seconds;
  }

  private readonly sprite: Sprite;
  /** Heat over the painted sun; absent for the probe or where it will not build. */
  private sunShimmer: SunShimmerFilter | undefined;
  private readonly filter: DawnRefractionFilter | undefined;
  private readonly clock = new AmbientClock();
  private readonly removeVisibilityListener: () => void;
  private readonly removeMotionListener: () => void;
  private readonly previousRefraction: string | undefined;
  private readonly previousQuality: string | undefined;
  /** The painted sky plate, refracted; the controller's first layer. */
  private readonly skyGroup = new Container();
  /**
   * The canvas past the field: sky above it, the near city's base below.
   *
   * The layers live in the clipped `ui` and cover only the field, which on a
   * portrait phone is a quarter of the screen. Without this the panel sat on
   * the flat field colour instead of over the city. Unclipped, in `backdrop`,
   * and refitted on every layout.
   */
  private readonly fill = new Graphics();
  private readonly removeViewportListener: () => void;
  /** The far city, softly refracted, and the near city, crisp (spec §2.9). */
  private farSprite: Sprite | undefined;
  /** Whether the hero's building's windows breathe; not at `low`, as the race drops the pass. */
  private readonly windowsBreathe: boolean;
  private nearSprite: Sprite | undefined;
  private cityRefraction: DawnRefractionFilter | undefined;
  /** Where the pointer is, in [-1, 1] from the centre; undefined without one. */
  private pointer: Offset | undefined;
  /**
   * The device's tilt as a pointer, smoothed, on a phone or tablet: the
   * gyroscope stands in for the cursor. Undefined without a sensor.
   */
  private tilt: Offset | undefined;
  private readonly removePointerListeners: () => void;
  /** The inspection probe's generated plate, owned here; absent in play. */
  private readonly probeTexture: Texture | undefined;
  private entryElapsedSeconds = 0;
  /** Time into the intro zoom; at its length when there is none. */
  private introSeconds: number = MENU_INTRO_END;
  /** The zoom the plates were last placed at, so the intro's last frame lands. */
  private introZoom = 1;
  /** The camera's kick this frame: how far past the framing the beat has it. */
  private beatZoom = 0;
  private destroyed = false;
  /**
   * The canvas, in logical units, while the form factor is portrait; undefined
   * in landscape. Set, the plates cover it rather than the 960 x 540 frame.
   */
  private cover: ViewRect | undefined;
  /** The offsets last placed, so a relayout can re-place without a tick. */
  private lastOffsets: Record<MenuLayer, Offset> = menuParallax(0, undefined, true);

  constructor(
    private readonly stage: StagePort,
    options: NonGameplayBackdropOptions = {},
  ) {
    const textures = options.textures ?? loadedTextures;
    const base = options.environment ?? browserEnvironment();
    // Stage effects off reads as reduced motion everywhere below.
    const still = options.still;
    const environment: RefractionEnvironment =
      still === undefined
        ? base
        : {
            hidden: () => base.hidden(),
            reducedMotion: () => base.reducedMotion() || still(),
            onVisibilityChange: (listener) => base.onVisibilityChange(listener),
            onMotionChange: (listener) => base.onMotionChange(listener),
          };
    const quality =
      options.quality ??
      refractionQualityFor(window.location.search, VISUAL_INSPECTION_ENABLED);

    if (options.zoomIn === true && !environment.reducedMotion()) this.introSeconds = 0;
    this.windowsBreathe = quality !== "low";
    this.previousRefraction = stage.overlay.dataset["refraction"];
    this.previousQuality = stage.overlay.dataset["refractionQuality"];

    const probe = refractionProbeFor(window.location.search, VISUAL_INSPECTION_ENABLED);
    this.probeTexture =
      probe === undefined
        ? undefined
        : createProbeTexture(probe, stage.screenWidth, stage.screenHeight);
    // The Aquarian board's menu, layered as the race draws its stage (spec
    // §2.8 item 1, §2.9): the original painted menu plate as the sky -- its
    // big cloud banks and sun waving under the full menu refraction, the look
    // the user asked to keep -- with a softly refracted far city and a crisp
    // near city standing over it, sliding against each other. Where the city
    // layers are missing, the plate is drawn alone, as the menu always was.
    // The inspection probe always gets the bare plate.
    const plate = textures("menu.backdrop");
    const cityFar = textures("menu.cityFar");
    const cityNear = textures("menu.cityNear");
    const layered = probe === undefined && plate !== Texture.EMPTY && cityNear !== Texture.EMPTY;

    this.skyGroup.label = "non-gameplay-backdrop";
    this.sprite = new Sprite(this.probeTexture ?? plate);
    this.sprite.label = "non-gameplay-sky";
    this.skyGroup.addChild(this.sprite);
    if (probe === undefined && plate !== Texture.EMPTY) {
      try {
        // No padding: the plate is overscanned, so nothing past its edge shows.
        this.sunShimmer = createSunShimmerFilter({ region: MENU_SUN_REGION, padding: 0 });
        this.sprite.filters = [this.sunShimmer];
      } catch {
        // A still sun is a quieter menu, not a broken one.
      }
    }
    stage.ui.addChildAt(this.skyGroup, 0);

    if (layered) {
      if (cityFar !== Texture.EMPTY) {
        this.farSprite = this.cityLayer(cityFar, "non-gameplay-city-far");
        stage.ui.addChildAt(this.farSprite, 1);
      }
      // Its windows hold still: the ones that breathe are the hero's building's.
      this.nearSprite = this.cityLayer(cityNear, "non-gameplay-city");
      stage.ui.addChildAt(this.nearSprite, this.farSprite === undefined ? 1 : 2);
      if (this.farSprite !== undefined) {
        this.cityRefraction = this.buildCityRefraction(options, quality);
        if (this.cityRefraction !== undefined) this.farSprite.filters = [this.cityRefraction];
      }
    }
    this.fill.label = "non-gameplay-fill";
    stage.backdrop.addChild(this.fill);
    const relayout = (viewport: ViewportInfo): void => {
      this.fitFill(viewport.sceneryLogical);
      // Portrait covers the whole canvas (responsive parity spec §5.1). The
      // field on a portrait phone is a strip a quarter of the screen tall, and
      // fitting the plate to it is what left flat bands above and below.
      this.cover =
        viewport.formFactor === "phone-portrait" || viewport.formFactor === "tablet-portrait"
          ? viewport.sceneryLogical
          : undefined;
      this.reparent();
      this.place(this.lastOffsets);
    };
    relayout(stage.viewport);
    this.removeViewportListener = stage.onViewportChange(relayout);

    let acceptedFilter: DawnRefractionFilter | undefined;
    try {
      // The full menu profile: the painted clouds wave at the strength the
      // accepted menu was judged at.
      const profile = "menu";
      const candidate =
        options.createFilter?.(quality) ?? createDawnRefractionFilter(quality, profile);
      try {
        const validate =
          options.validateFilter ??
          ((filter: DawnRefractionFilter) => {
            if (stage.webgl !== undefined) validateDawnRefractionProgram(stage.webgl, filter);
          });
        validate(candidate);
        acceptedFilter = candidate;
      } catch (error) {
        candidate.destroy();
        throw error;
      }
    } catch {
      // Static source art is the deliberate, readable fallback.
    }

    this.filter = acceptedFilter;
    this.filtered = acceptedFilter !== undefined;
    if (acceptedFilter !== undefined) {
      this.skyGroup.filters = [acceptedFilter];
      stage.overlay.dataset["refraction"] = "active";
      stage.overlay.dataset["refractionQuality"] = quality;
    } else {
      stage.overlay.dataset["refraction"] = "fallback";
      delete stage.overlay.dataset["refractionQuality"];
    }

    const pulse = new MusicPulse(MENU_BEAT_SECONDS);
    let heard = { kick: 0, spike: 0, beats: 0 };
    /** The beat count when the intro came home; the camera kicks on the ones after. */
    let beatsAtHome: number | undefined;
    const applyFrame = (): void => {
      // Reduced motion holds every layer where it is: the parallax is not
      // re-applied and the optics' clock does not move, so turning the
      // preference on mid-menu stops the scene rather than snapping it home.
      if (!environment.reducedMotion()) {
        if (layered) this.place(menuParallax(this.elapsedSeconds, this.pointer ?? this.tilt, false));
        else if (this.introZoom !== this.cameraZoom()) this.place(this.lastOffsets);
      }
      if (this.windowsBreathe) {
        publishMenuWindows({
          seconds: this.elapsedSeconds,
          glow:
            PULSE_DEPTH.windowRest +
            heard.kick * MENU_MUSIC_PULSE.windowKick +
            heard.spike * MENU_MUSIC_PULSE.windowSpike,
        });
      }
      const optics = [this.filter, this.cityRefraction].filter((filter) => filter !== undefined);
      if (environment.reducedMotion()) {
        this.entryElapsedSeconds = 0.6;
        // Turned on mid-intro, or mid-kick: the camera is simply home.
        if (this.introSeconds < MENU_INTRO_END || this.beatZoom !== 0) {
          this.introSeconds = MENU_INTRO_END;
          this.beatZoom = 0;
          this.place(this.lastOffsets);
        }
        for (const filter of optics) setDawnRefractionFrame(filter, DAWN_REFRACTION_STILL_SECONDS, 1);
        this.followBand(DAWN_REFRACTION_STILL_SECONDS, 1);
        if (this.sunShimmer !== undefined) setSunShimmerTime(this.sunShimmer, DAWN_REFRACTION_STILL_SECONDS);
        return;
      }
      const intensity = 0.85 + Math.min(0.15, (this.entryElapsedSeconds / 0.6) * 0.15);
      for (const filter of optics) setDawnRefractionFrame(filter, this.elapsedSeconds, intensity);
      this.followBand(this.elapsedSeconds, intensity);
      if (this.sunShimmer !== undefined) setSunShimmerTime(this.sunShimmer, this.elapsedSeconds);
    };

    const tick = (): void => {
      // Nothing moves while the player is not looking, and the entrance must
      // not finish itself off screen either: a menu whose ease completed while
      // hidden would appear already eased, which is a different entrance from
      // the one that was authored.
      if (environment.hidden()) return;
      // The still pose is held rather than entered here: the clock is not
      // advanced, so the phase the menu resumes from is the one it paused at,
      // rather than the ambient still.
      if (environment.reducedMotion()) {
        heard = { kick: 0, spike: 0, beats: heard.beats };
        applyFrame();
        return;
      }
      const deltaMs = stage.app?.ticker.deltaMS ?? 0;
      heard = pulse.update(deltaMs / 1_000, options.music?.(), options.song?.());
      // Only once the intro's pull back is home: the transition has the camera
      // until then, and a kick over it would muddy the drop. From there, every
      // beat -- but only beats heard after it, so the tail of one that landed
      // mid-intro does not pop in the moment the camera is free.
      if (this.introSeconds >= MENU_INTRO_END) beatsAtHome ??= heard.beats;
      const kicked = beatsAtHome !== undefined && heard.beats > beatsAtHome;
      this.beatZoom = kicked && options.beatZoom?.() === true ? heard.kick * MENU_MUSIC_PULSE.zoom : 0;
      this.entryElapsedSeconds = Math.min(0.6, this.entryElapsedSeconds + deltaMs / 1_000);
      this.introSeconds = Math.min(MENU_INTRO_END, this.introSeconds + deltaMs / 1_000);
      // `low` draws the static diffusion, whose phase is pinned at zero, so the
      // clock is left untouched rather than advanced to a value nothing reads.
      if (quality !== "low") this.clock.advance(deltaMs);
      applyFrame();
    };

    const onVisibilityChange = (): void => {
      // The clock owns what a resume costs: it discards the first delta after
      // one, so a minute spent hidden cannot arrive as a minute of optic time.
      this.clock.setHidden(environment.hidden());
    };
    const onMotionChange = (): void => {
      if (environment.reducedMotion()) this.entryElapsedSeconds = 0.6;
      applyFrame();
    };

    // The pointer the near layers lean toward; dropped when it leaves, so a
    // stale position never steers the scene.
    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      this.pointer = {
        x: Math.max(-1, Math.min(1, (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1)),
        y: Math.max(-1, Math.min(1, (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1)),
      };
    };
    const onPointerGone = (): void => {
      this.pointer = undefined;
    };
    if (layered) {
      window.addEventListener("pointermove", onPointerMove);
      document.documentElement.addEventListener("pointerleave", onPointerGone);
      window.addEventListener("blur", onPointerGone);
    }

    // A phone or tablet has no cursor, so its tilt leans the layers instead,
    // measured from the angle it was held at when the menu opened, and that
    // rest drifting slowly after the grip. iOS asks the player first, and only
    // from a gesture: the first tap on the menu asks, once. (Adding the same
    // listener again on a grant is a no-op.)
    let rest: Tilt | undefined;
    const onOrientation = (event: DeviceOrientationEvent): void => {
      if (event.beta === null || event.gamma === null) return;
      const reading = { beta: event.beta, gamma: event.gamma };
      rest =
        rest === undefined
          ? reading
          : {
              beta: rest.beta + (reading.beta - rest.beta) * MENU_TILT.recentre,
              gamma: rest.gamma + (reading.gamma - rest.gamma) * MENU_TILT.recentre,
            };
      const lean = tiltLean(reading, rest, screen.orientation?.angle ?? 0);
      const from = this.tilt ?? { x: 0, y: 0 };
      this.tilt = {
        x: from.x + (lean.x - from.x) * MENU_TILT.smoothing,
        y: from.y + (lean.y - from.y) * MENU_TILT.smoothing,
      };
    };
    const orientationEvents = layered && typeof DeviceOrientationEvent !== "undefined";
    const permission = (
      orientationEvents
        ? (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<PermissionState> })
            .requestPermission
        : undefined
    )?.bind(DeviceOrientationEvent);
    const askForTilt = (): void => {
      window.removeEventListener("touchend", askForTilt);
      void permission?.()
        .then((state) => {
          if (state === "granted" && !this.destroyed) window.addEventListener("deviceorientation", onOrientation);
        })
        .catch(() => undefined);
    };
    // Listened for from the start: where the browser has the permission call
    // but grants without asking (Chromium), the tilt works before any tap, and
    // where it does ask (iOS), nothing arrives until the player allows it.
    if (orientationEvents) {
      window.addEventListener("deviceorientation", onOrientation);
      if (permission !== undefined) window.addEventListener("touchend", askForTilt);
    }

    this.removePointerListeners = () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerGone);
      window.removeEventListener("blur", onPointerGone);
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("touchend", askForTilt);
    };

    this.clock.setHidden(environment.hidden());
    this.removeVisibilityListener = environment.onVisibilityChange(onVisibilityChange);
    this.removeMotionListener = environment.onMotionChange(onMotionChange);
    const ticker = stage.app?.ticker;
    this.removeTicker = ticker !== undefined ? addRenderPass(ticker as any, "gameplayDraw", tick) : () => {};
    applyFrame();
  }

  private readonly removeTicker: () => void;

  /**
   * Keeps the scene bloom off the sky refraction's caustic band.
   *
   * The band lifts the pale sky to the sun's white, and the bloom would flare
   * it (`scene-bloom.ts`). Only the sky's own refraction draws the band -- the
   * far city runs the gameplay profile over a strip -- so there is no band to
   * follow when that pass did not survive.
   */
  private followBand(timeSeconds: number, intensity: number): void {
    this.stage.setBloomBand?.(this.filter === undefined ? undefined : { timeSeconds, intensity });
  }

  /** A city plate: nearest-sampled, overscanned so sliding never shows its edge. */
  private cityLayer(texture: Texture, label: string): Sprite {
    texture.source.scaleMode = "nearest";
    const sprite = new Sprite(texture);
    sprite.label = label;
    return sprite;
  }

  /**
   * Positions every layer for `offsets`.
   *
   * Each plate is drawn a little larger than the frame and bottom-anchored at
   * its centre, so a layer slid by its offset never uncovers its own edge. The
   * cities land on whole logical units -- the menu draws in the 960 x 540
   * composite at one pixel per unit -- so their nearest-sampled edges stay
   * sharp as they move.
   */
  private fitFill(scenery: ViewRect): void {
    const split = this.stage.screenHeight / 2;
    this.fill
      .clear()
      .rect(scenery.x, scenery.y, scenery.width, split - scenery.y)
      .fill(roleTint("skyHigh"))
      .rect(scenery.x, split, scenery.width, scenery.y + scenery.height - split)
      .fill(roleTint("cityNear"));
  }

  /**
   * Moves the plates to the layer their framing needs.
   *
   * Landscape draws them in `ui`, inside the field's clip, at indices 0-2 as
   * they always were. Portrait covers the canvas, which the clip would cut back
   * to the field strip, so they move to the unclipped `backdrop`, directly
   * above the fill and in the same order. A no-op when they are already there.
   */
  private reparent(): void {
    const plates = [this.skyGroup, this.farSprite, this.nearSprite].filter(
      (plate): plate is Container => plate !== undefined,
    );
    const host = this.cover === undefined ? this.stage.ui : this.stage.backdrop;
    if (plates.every((plate) => plate.parent === host)) return;
    const base = this.cover === undefined ? 0 : host.children.indexOf(this.fill) + 1;
    plates.forEach((plate, index) => host.addChildAt(plate, base + index));
  }

  private place(offsets: Record<MenuLayer, Offset>): void {
    this.lastOffsets = offsets;
    const { screenWidth: width, screenHeight: height } = this.stage;
    // The intro zoom and the kick scale every plate about the middle of what it covers.
    const zoom = this.cameraZoom();
    this.introZoom = zoom;
    const centre =
      this.cover === undefined
        ? { x: width / 2, y: height / 2 }
        : { x: this.cover.x + this.cover.width / 2, y: this.cover.y + this.cover.height / 2 };
    const zoomed = (x: number, y: number): [number, number] => [
      centre.x + (x - centre.x) * zoom,
      centre.y + (y - centre.y) * zoom,
    ];
    const layers: [Sprite | undefined, MenuLayer, boolean][] = [
      [this.sprite, "sky", false],
      [this.farSprite, "far", true],
      [this.nearSprite, "near", true],
    ];
    for (const [sprite, layer, snap] of layers) {
      if (sprite === undefined) continue;
      const overscan = this.nearSprite === undefined ? 1 : MENU_OVERSCAN;
      sprite.anchor.set(0.5, 1);
      if (this.cover !== undefined) {
        const texture = sprite.texture;
        const coverScale = Math.max(this.cover.width / texture.width, this.cover.height / texture.height) * overscan;
        // The sky covers the canvas. The cities keep the plate's aspect and are
        // fitted to the width, so they stand in the lower part of the screen
        // instead of being stretched up it.
        const scale = layer === "sky" ? coverScale : (this.cover.width / texture.width) * overscan;
        sprite.scale.set(scale * zoom);
        const [x, y] = zoomed(
          this.cover.x + this.cover.width / 2 + offsets[layer].x,
          this.cover.y + this.cover.height + offsets[layer].y,
        );
        sprite.position.set(snap ? Math.round(x) : x, snap ? Math.round(y) : y);
        continue;
      }
      sprite.width = width * overscan * zoom;
      sprite.height = height * overscan * zoom;
      const [x, y] = zoomed(width / 2 + offsets[layer].x, height + offsets[layer].y);
      sprite.position.set(snap ? Math.round(x) : x, snap ? Math.round(y) : y);
    }
  }

  /** The camera's zoom this frame: the intro's pull back, struck by the kick. */
  private cameraZoom(): number {
    return menuIntroZoom(this.introSeconds) * (1 + this.beatZoom);
  }

  /** A layer's bounds in logical units. For tests; nothing in play reads it. */
  layerBounds(layer: MenuLayer): { left: number; right: number; top: number; bottom: number } {
    const sprite = layer === "sky" ? this.sprite : layer === "far" ? this.farSprite : this.nearSprite;
    if (sprite === undefined) throw new Error(`no ${layer} layer`);
    return {
      left: sprite.x - sprite.width / 2,
      right: sprite.x + sprite.width / 2,
      top: sprite.y - sprite.height,
      bottom: sprite.y,
    };
  }

  /** The far city's soft refraction, validated; lost alone if it will not compile. */
  private buildCityRefraction(options: NonGameplayBackdropOptions, quality: QualityLevel): DawnRefractionFilter | undefined {
    let candidate: DawnRefractionFilter | undefined;
    try {
      candidate = options.createCityRefraction?.(quality) ?? createDawnRefractionFilter(quality, "gameplay");
      const validate =
        options.validateFilter ??
        ((filter: DawnRefractionFilter) => {
          if (this.stage.webgl !== undefined) validateDawnRefractionProgram(this.stage.webgl, filter);
        });
      validate(candidate);
      return candidate;
    } catch {
      candidate?.destroy();
      return undefined;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.removeTicker();
    this.removeVisibilityListener();
    this.removeMotionListener();
    this.removePointerListeners();
    this.removeViewportListener();
    this.stage.setBloomBand?.(undefined);
    this.stage.backdrop.removeChild(this.fill);
    this.fill.destroy();
    this.skyGroup.filters = [];
    this.filter?.destroy();
    this.sprite.filters = [];
    this.sunShimmer?.destroy();
    this.sunShimmer = undefined;
    for (const sprite of [this.farSprite, this.nearSprite]) {
      if (sprite === undefined) continue;
      sprite.filters = [];
      // From whichever layer the framing left it on.
      sprite.parent?.removeChild(sprite);
      sprite.destroy();
    }
    this.cityRefraction?.destroy();
    this.cityRefraction = undefined;
    publishMenuWindows(undefined);
    this.farSprite = undefined;
    this.nearSprite = undefined;
    this.skyGroup.parent?.removeChild(this.skyGroup);
    this.skyGroup.destroy({ children: true });
    if (this.probeTexture !== Texture.WHITE) this.probeTexture?.destroy(true);
    restoreDataset(this.stage.overlay, "refraction", this.previousRefraction);
    restoreDataset(this.stage.overlay, "refractionQuality", this.previousQuality);
  }
}
