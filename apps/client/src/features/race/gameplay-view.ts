/**
 * The gameplay view.
 *
 * Composes the parallax, platform, player, camera, and HUD systems and runs
 * them in one fixed order: ingest the snapshot, reconcile display objects, move
 * the camera, then update the HUD. The order matters because the camera follows
 * a sprite that must already have been placed, and the HUD reports a state the
 * world has already been drawn from.
 *
 * Two splits matter structurally. `world` is transformed by the camera and
 * `hud` is not, so no HUD object is ever parented under the world. And the
 * two scenery roots, `skyParallax` and `cityParallax`, are siblings of `world`
 * rather than children of it: all three carry the same camera transform, but
 * only `world` is clipped to the letterbox. Scenery
 * may fill the screen; platforms and players may not, because how much course
 * is on screen is the same question as how fair the race is.
 */

import { SkyParticles } from "../render/sky-particles";
import { SecondOrder, snapTo } from "../../lib/second-order";
import { FallTrail, type FallTrailTuning } from "./juice/fall-trail";
import type { StageMotion } from "../render/stage-reactor";
import { Container, Point, Sprite, Texture, type Filter } from "pixi.js";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import { CAMERA, LOGICAL_VIEWPORT, PLAYER_SPRITE_SIZE, type SeatScarf } from "../../lib/constants";
import { createBloomFilter, setBloomStrength } from "../render/filters/city-atmosphere";
import { StageLayers } from "../render/stage-layers";
import type { StagePresentation } from "../render/stage-presentation";
import { contentFitZoom, WorldCamera } from "./camera";
import { PlatformView } from "./platform-view";
import { worldPulseAt } from "../render/world-pulse";
import { MomentumTracker } from "./momentum";
import type { SongTiming } from "../../lib/beat-clock";
import { NAME_TAG_FONT_SIZE, minimumFaceScale, nameTagFacePx, nameTagResolution, nameTagScale } from "./name-tag";
import { PlayerView } from "./player-view";
import type { PredictedState } from "../net/local-simulation";
import { survivalDanger } from "./hud-model";
import { bandRacers, edgeRiseSpeed } from "@floor-fifty/shared/simulation/survival";
import { LAVA_MARKER_FONT, LavaView } from "./lava-view";
import { SizzleGate, isSinking } from "./lava-model";
import { loadedSheetData, type SheetDataProvider, type TextureProvider } from "../render/textures";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import { TrajectoryGuide } from "./trajectory-guide";


/**
 * How long a racer's lava stays after they go out, in ticks: long enough to
 * see them go under and the splash, then it drains. Their edge froze when they
 * went out, and the camera moves on to a racer it would drown (final review I1).
 */
export const LAVA_LINGER_TICKS = 72;

/** Views made so far: each one's sizzle keys are its own, since the mixer never forgets a key. */
let lavaViews = 0;

/** A nameplate's line height, logical units: its 11 px type and its stroke. */
const NAMEPLATE_LINE = 16;

/**
 * The rows at every plate's foot that the art converter replaces with a copy
 * of the row above (`FOOT_ROWS` in packages/asset-contract/tools/generate-city.ts),
 * so a skirt can continue them: they are stretched scenery already.
 */
const EXTRUDED_FOOT_ROWS = 24;

/**
 * The scenery -- the sun, the skylines, the windows, the rooftop props and the
 * parallax they move on -- lives in `features/render/stage-layers.ts`.
 *
 * It was composed here, and the move is what let the layer list grow from five
 * entries to seven without this file also having to know how far away a water
 * tower is. What is left here is what the view draws: the platforms, the
 * racers, the camera and the HUD.
 *
 * `SUN_HORIZON_OFFSET`, `SUN_PARALLAX`, `PARALLAX` and `SKIRT_HEIGHT` went with
 * it.
 */

/**
 * How hard each emissive pass glows, before the beat scales it.
 *
 * The city carries the mood and can afford to be generous; the marks are
 * information a player reads at a glance and glow enough to be found rather
 * than enough to be looked at. `markTolerance` is the one number here that is
 * not taste: `floorPending` is 0.081 from the scarlet seat, so anything at or
 * above that would bloom a racer.
 */
const BLOOM = { city: 1.8, marks: 1.1, markTolerance: 0.05 } as const;

/** The most specks a set piece's weather draws at once. */
const SKY_PARTICLE_LIMIT = 120;
/** A set piece's camera kick settles on the slam kick's starting spring. */
const SET_PIECE_KICK_SPRING = { f: 6, zeta: 0.4, r: 0 } as const;

/** Where a race beat is stamped, as a share of the view's height from the top. */
const BEAT_HEIGHT = 0.34;

export class GameplayView {
  /** Transformed by the camera, and clipped to the letterbox. */
  readonly world = new Container();
  /** The racers' name tags, over the picture at the canvas's resolution; see `attachTagLayer`. */
  readonly tagLayer = new Container({ label: "name-tag-layer" });
  private tagLayerAttached = false;
  /**
   * The racer juice's dust (polish spec §4.1): over the floors and the racers,
   * inside the world, so it moves with the camera and is palette-locked.
   */
  readonly dustLayer = new Container({ label: "juice" });
  /** The wrap streak's ghosts, behind the racers so a racer always reads over its own afterimage. */
  readonly streakLayer = new Container({ label: "juice-streak" });
  /** The racers' pop-up words (Wonder spec §5.1): over everything in the world, carried by the camera. */
  readonly wordLayer = new Container({ label: "juice-word-layer" });
  /**
   * The race beats' stamps (Wonder spec §5.1): in the middle of the view, a
   * sibling over `world` so the camera and its kick never move them.
   */
  readonly beatLayer = new Container({ label: "juice-beat-layer" });
  /**
   * Survival's lava marker (lava spec §5): screen space, a sibling over
   * `world` like `beatLayer`, so it sits on the visible field's bottom
   * whatever the camera does.
   */
  readonly lavaLayer = new Container({ label: "lava-layer" });
  /**
   * The feel layer's field-space marks (A/V polish plan): the fast-fall's
   * speed lines and the lava spill. A sibling over `world`, under the beat
   * stamps, so the camera's follow and shake never move them.
   */
  readonly feelLayer = new Container({ label: "juice-feel-layer" });
  /**
   * Over the whole screen, the letterbox bars included (`StagePort.front`):
   * the impact flash, which must reach every edge of a phone or tablet
   * rather than stop at the play field. Same units as
   * `feelLayer`.
   */
  readonly frontLayer = new Container({ label: "juice-front-layer" });
  /**
   * Transformed by the camera, and deliberately not clipped.
   *
   * Belongs to the stage's backdrop layer, so it draws past the letterbox and
   * a tall phone shows scenery where it would otherwise show bars. These are
   * the roots of the scenery composition rather than containers this view
   * fills: the layers, their parallax and the cosmetic lift are `StageLayers`'
   * business, and this view only positions the roots.
   *
   * Two roots because the sky is refracted and the city is not; the backdrop
   * controller draws them through different chains. This is the sky: the sun
   * and the clouds.
   */
  readonly skyParallax: Container;
  /** The city: every skyline, its windows and the rooftop props. Crisp. */
  readonly cityParallax: Container;
  /**
   * The race HUD is not here.
   *
   * It was a Pixi layer in this view until the smooth HUD moved to the DOM,
   * where it can set real type at CSS resolution instead of Silkscreen on an
   * eight-pixel grid. Exactly one HUD is mounted, by the screen, and this view
   * no longer draws one at all -- a second would be worse than either.
   */

  readonly camera = new WorldCamera();

  /**
   * The city glow this climb has earned, as a strength.
   *
   * Computed here because this is where the song and the momentum are, and read
   * by the screen, which passes it to the backdrop controller. The scenery's
   * bloom lives with the scenery's chain now; the view no longer holds a filter
   * it does not own.
   */
  private cityGlowStrength: number = BLOOM.city;

  /** The scenery composition. Its roots are `skyParallax` and `cityParallax`. */
  private readonly stageLayers: StageLayers;
  /**
   * The local racer's share of the ascent, as of the last snapshot.
   *
   * Held rather than derived at draw time because the scenery's lift is applied
   * inside the camera write, which happens between snapshots -- and a lift that
   * read a value from the *next* snapshot would move before the racer did.
   */
  private climbProgress = 0;
  /** Ambient time and the motion preference, from the screen's clock. */
  private ambientSeconds = 0;
  private reducedMotion = false;
  private readonly platforms: PlatformView;
  private readonly players: PlayerView;
  private localId: PlayerId | undefined;
  private focus: PlayerId | undefined;
  private cutToFocus = false;
  private lastLocalX = 0;
  private song: SongTiming | undefined;
  /** The song's own beat as it sounds this frame; undefined keeps the grid off the tick. */
  private songBeat: number | undefined;
  /**
   * How far this climb has got, as an intensity the world is drawn at.
   *
   * Read off `progress`, which the snapshot already carries and a reset already
   * clears: it is the ascent, not a second thing to keep in step with it.
   */
  private readonly momentum = new MomentumTracker();
  /**
   * A second bloom, over the world rather than the backdrop.
   *
   * The floor marks are drawn in the world container and the city is drawn in
   * the backdrop, so one pass cannot reach both. This one is keyed on the two
   * mark colours and runs at a tighter tolerance: `floorPending` sits 0.081
   * from the scarlet racer in unit RGB, which is inside the tolerance the city
   * uses, and at that setting one seat of four would glow and no other would.
   */
  private worldBloom: Filter | undefined;
  /** The camera's musical breath, kept apart from the camera's own transform. */
  private pulseOffsetY = 0;
  /** The slam's camera kick, in whole logical units downward (polish spec §4.2). */
  private kickOffsetY = 0;
  /** Survival's lava, or undefined on a finite course (lava spec §5); the tutorial draws one for its last step. */
  private readonly lavaView: LavaView | undefined;
  /** The tutorial's lava is driven by `setTutorialEdge`, not by the snapshot's edge or the race clock. */
  private readonly tutorialLava: boolean;
  private tutorialEdge: { y: number; rise: number } | undefined;
  /** Whether any floor transitioned to missed on this update. */
  private missedTransition = false;
  /** Parabolic bounce apex guidance layer. */
  readonly trajectoryGuide = new TrajectoryGuide();
  private trajectoryGuideEnabled = true;
  private isTutorial = false;
  /** Lets the sizzle sound once per dip (lava spec §5). */

  private readonly sizzle = new SizzleGate();
  /** The key of the dip this frame starts, which the sizzle sounds under; undefined on any other frame. */
  private dipKey: string | undefined;
  /** Survival's danger to the local racer this frame, before reduced motion; see `survivalDanger`. */
  private danger = 0;
  /** This view's own, so its keys never meet another view's. */
  private readonly lavaId = ++lavaViews;
  private dips = 0;
  /**
   * The sizzle gate's clock: summed frame time. Not the ambient clock, which
   * reduced motion pins still, and sound is not motion (final review I2).
   */
  private lavaClockMs = 0;
  /** Where the local racer last stood, for the splash when they go under. */
  private lastLavaX = 0;
  /** Device pixels per logical unit on the backdrop layer; see `setPixelDensity`. */
  private pixelDensity = 1;
  /** Css px per logical unit before the camera's zoom; see `setCssPerUnit`. */
  private cssPerUnit = 1;
  /** The canvas's framing; see `setFraming`. */
  private framing: { portrait: boolean; scenery: { y: number; height: number } } | undefined;
  /** The moving zoom on a phone held upright: as close as the course allows. */
  private readonly phonePortraitZoom: number;
  /** The trauma shake this frame, in world units (A/V polish plan, G2). */
  private shakeX = 0;
  private shakeY = 0;
  /** How far the camera leads a fast fall, in world units; negative is below. */
  private lookAhead = 0;
  /** How far into a fast fall the local racer is, 0 to 1; see `fallShare`. */
  private fallShare = 0;
  /** The trail's counts and strengths, from the juice tuning; none until told. */
  private fallTuning: FallTrailTuning = { lines: 0, alpha: 0, afterimages: 0, afterimageAlpha: 0 };
  /** The feel layer's clock, for the speed lines: summed frame time. */
  private feelClockMs = 0;
  /** The fast-fall's speed lines and afterimages. */
  private readonly fallTrail: FallTrail;
  /** The impact flash: one flat sprite over the whole field, shown for a frame or two. */
  private readonly impact = new Sprite(Texture.WHITE);

  constructor(
    presentation: StagePresentation,
    textures: TextureProvider,
    tuning: ResolvedTuning,
    localPlayerId: () => PlayerId | undefined,
    sheetData: SheetDataProvider = loadedSheetData,
    options: {
      sheetAliasFor?: (characterId: string, colour: SeatScarf) => string;
      /**
       * The tutorial: its last step has an edge of its own on a finite course, drawn with
       * the race's lava (`setTutorialEdge`). A race never sets this.
       */
      tutorialEdge?: boolean;
    } = {},
  ) {
    this.world.label = "gameplay-world";
    // Built first, because the scenery's root is what the backdrop controller
    // renders and the screen reads it off this view immediately afterwards.
    this.stageLayers = new StageLayers(presentation, textures);
    this.skyParallax = this.stageLayers.skyRoot;
    this.cityParallax = this.stageLayers.cityRoot;

    this.platforms = new PlatformView(textures, tuning, {
      silhouette: presentation.silhouette,
      platformAlias: presentation.platformAlias,
    });
    this.phonePortraitZoom = contentFitZoom(tuning);
    this.worldBloom = createBloomFilter({
      keys: [roleTint("floorTaken"), roleTint("floorPending")],
      strength: BLOOM.marks,
      tolerance: BLOOM.markTolerance,
    });
    this.players = new PlayerView(textures, tuning, localPlayerId, sheetData, {
      silhouette: presentation.silhouette,
      ...(options.sheetAliasFor === undefined ? {} : { sheetAliasFor: options.sheetAliasFor }),
    });

    // The timer is added last so it draws over the platforms it passes. Not a
    // HUD -- that is the DOM's now, mounted by the screen.
    // On the platform layer alone rather than the whole world: the marks live
    // there, and a pass over the players as well would spend its neighbourhood
    // search on four sprites it is keyed to ignore.
    this.platforms.root.filters = this.worldBloom === undefined ? [] : [this.worldBloom];
    this.world.addChild(this.platforms.root, this.trajectoryGuide.root, this.streakLayer, this.players.root, this.dustLayer, this.wordLayer);

    // Survival's lava covers the bodies and leaves the tags on top, so a
    // rival under it reads as a silhouette with a name (lava spec L4).
    this.tutorialLava = options.tutorialEdge === true;
    if (tuning.RACE_TIME_LIMIT_TICKS > 0 || this.tutorialLava) {
      const lava = new LavaView(tuning);
      this.players.root.addChildAt(lava.root, this.players.root.getChildIndex(this.players.bodies) + 1);
      this.lavaLayer.addChild(lava.marker);
      this.feelLayer.addChild(lava.spill);
      this.lavaView = lava;
    }
    this.beatLayer.position.set(LOGICAL_VIEWPORT.width / 2, Math.round(LOGICAL_VIEWPORT.height * BEAT_HEIGHT));

    // The lines and the flash in the finish's highlight, which is off every
    // seat colour and dust swatch, as the sparks are.
    const highlight = roleTint("finishBurst");
    this.fallTrail = new FallTrail(this.feelLayer, this.streakLayer, { size: PLAYER_SPRITE_SIZE, feet: tuning.PLAYER_HEIGHT / 2 }, highlight);
    // Past the field on every side, so a portrait field's extra height and
    // the shake never show an edge.
    this.impact.label = "impact-flash";
    this.impact.tint = highlight;
    this.impact.position.set(-LOGICAL_VIEWPORT.width, -LOGICAL_VIEWPORT.height);
    this.impact.width = LOGICAL_VIEWPORT.width * 3;
    this.impact.height = LOGICAL_VIEWPORT.height * 4;
    this.impact.alpha = 0;
    this.impact.visible = false;
    this.frontLayer.addChild(this.impact);
  }

  /** The trauma shake for this frame, in world units (A/V polish plan, G2). */
  setShake(x: number, y: number): void {
    this.shakeX = x;
    this.shakeY = y;
  }

  /** The zoom's punch, a share of the zoom (G5). */
  setPunch(share: number): void {
    this.camera.setPunch(share);
  }

  /** How far the camera leads the local racer's fast fall, in world units (G5). */
  setLookAhead(units: number): void {
    this.lookAhead = units;
  }

  /** The impact flash's alpha; 0 hides it (G3). */
  setImpact(alpha: number): void {
    this.impact.alpha = alpha;
    this.impact.visible = alpha > 0;
  }

  /** How far into a fast fall the local racer is, which the trail draws with `tuning` (G4). */
  setFall(share: number, tuning: FallTrailTuning): void {
    this.fallShare = share;
    this.fallTuning = tuning;
  }

  /** The impact flash as drawn, for tests. */
  get impactAlpha(): number {
    return this.impact.visible ? this.impact.alpha : 0;
  }

  /** The impact flash's logical bounds, for coverage tests. */
  get impactBounds(): { x: number; y: number; width: number; height: number } {
    return {
      x: this.impact.position.x,
      y: this.impact.position.y,
      width: this.impact.width,
      height: this.impact.height,
    };
  }

  /**
   * Reports ambient time and the motion preference, once per frame.
   *
   * Called before `applySnapshot` so the scenery's lift is computed from this
   * frame's clock rather than the previous frame's, and so the two effects that
   * share the clock -- the cloud drift and the reduced-motion freeze -- cannot
   * be a frame apart.
   */
  /**
   * Draws the camera to another racer (the finish's winner, race-flow spec
   * §5.2): a glide, through the camera's own damping, or a cut under reduced
   * motion. The camera follows height only; it never follows sideways.
   */
  focusOn(playerId: PlayerId | undefined, cut: boolean): void {
    this.focus = playerId;
    this.cutToFocus = cut;
  }

  /** A racer's squash for the next snapshot, from the juice (polish spec §4.1). */
  setSquash(playerId: PlayerId, x: number, y: number): void {
    this.players.setSquash(playerId, x, y);
  }

  /** A racer's lean, as its sprite's skew in radians (Wonder spec §4.1). */
  setLean(playerId: PlayerId, radians: number): void {
    this.players.setLean(playerId, radians);
  }

  /** The slam's camera kick, in whole logical units downward; 0 is rest. */
  setKick(units: number): void {
    this.kickOffsetY = units;
  }

  /** The slam's hit-stop: the local racer's pose and the camera follow hold, positions never do (D-P5). */
  setHitStop(frozen: boolean): void {
    this.camera.setFrozen(frozen);
    const local = this.localId;
    if (local !== undefined) this.players.setHitStop(local, frozen);
  }

  /** A racer's current frame, for the wrap streak's ghost. */
  textureOf(playerId: PlayerId): Texture | undefined {
    return this.players.displayFor(playerId)?.sprite.texture;
  }

  /**
   * Where the HUD's top band ends, in the field's logical units: the CPUs'
   * words keep below it. Taken through the camera as last drawn.
   */
  setHudCeiling(fieldY: number): void {
    const scale = this.world.scale.y || 1;
    this.players.setBarkCeiling((fieldY - this.world.y) / scale - this.players.root.y);
  }

  /** Pops a CPU's mood word over it (CPU banding spec §4). */
  showBark(playerId: PlayerId, text: string, colour: SeatColour): void {
    this.players.showBark(playerId, text, colour);
  }

  /** Dims a racer's body, as the respawn flicker does (race-flow spec §5.1). */
  setBodyAlpha(playerId: PlayerId, alpha: number): void {
    this.players.setBodyAlpha(playerId, alpha);
  }

  /** The stage's answer to the song and the race, for the next frame's layers (Wonder spec §6.2–6.3). */
  setStageMotion(motion: StageMotion | undefined): void {
    this.motion = motion;
  }

  /** The stage motion the layers were last handed. Exposed so a test can assert without a renderer. */
  get stageMotion(): StageMotion | undefined {
    return this.motion;
  }

  private motion: StageMotion | undefined;

  /** A set piece's weather (Wonder spec §6.4): over the scenery, behind the play layer, in screen units. */
  readonly skyParticles = new SkyParticles(Texture.WHITE, () => SKY_PARTICLE_LIMIT);

  /** A set piece's camera kick (a lightning flash), on its own spring, summed with the slam's. */
  addSetPieceKick(units: number): void {
    this.setPieceKick.lift(units);
  }

  private readonly setPieceKick = new SecondOrder(SET_PIECE_KICK_SPRING);

  setAmbient(seconds: number, reducedMotion: boolean): void {
    this.ambientSeconds = seconds;
    this.reducedMotion = reducedMotion;
    this.players.setReducedMotion(reducedMotion);
  }

  setTrajectoryGuide(enabled: boolean): void {
    this.trajectoryGuideEnabled = enabled;
  }

  setTutorial(isTutorial: boolean): void {
    this.isTutorial = isTutorial;
  }

  /**
   * The tutorial's edge this frame: its height and how fast it is rising, or
   * undefined off its last step, which hides the lava. Read only by a view
   * built with the `tutorialEdge` option.
   */
  setTutorialEdge(edge: { y: number; rise: number } | undefined): void {
    this.tutorialEdge = edge;
  }


  /**
   * How many device pixels one logical unit covers on the backdrop layer.
   *
   * Told by the screen each frame (the letterbox scale times the renderer's
   * resolution), so the crisp city can be placed on whole device pixels. It is
   * presentation only: nothing here moves the world or a racer.
   */
  setPixelDensity(devicePixelsPerUnit: number): void {
    if (Number.isFinite(devicePixelsPerUnit) && devicePixelsPerUnit > 0) {
      this.pixelDensity = devicePixelsPerUnit;
    }
  }

  /**
   * Css px per logical unit, as the letterbox laid the canvas out (`StageHandle.cellSize`).
   * Told each frame by the screen; name tags scale from it so their face stays
   * at least `NAME_TAG_MIN_CSS_PX` on screen (spec §4.2).
   */
  setCssPerUnit(cssPerUnit: number): void {
    if (Number.isFinite(cssPerUnit) && cssPerUnit > 0) this.cssPerUnit = cssPerUnit;
  }

  /**
   * The letterbox's orientation and the canvas measured in logical units.
   *
   * Portrait moves where the camera holds the racer (spec 2.5, D3) and sinks
   * the city into the lower third of the canvas; `fieldHeight` is the
   * letterbox's field (D-R1), which the camera anchors against. Told by the
   * screen each frame from the stage's viewport, so a turned phone re-frames
   * on the next draw.
   */
  setFraming(
    portrait: boolean,
    scenery: { y: number; height: number },
    fieldHeight: number,
    phonePortrait = false,
    visible?: { top: number; bottom: number },
  ): void {
    this.framing = { portrait, scenery };
    // The whole canvas, bars and all, in every orientation, with a field's
    // height to spare on each side for the shake.
    const top = Math.min(-LOGICAL_VIEWPORT.height, scenery.y - LOGICAL_VIEWPORT.height);
    const bottom = Math.max(LOGICAL_VIEWPORT.height * 3, scenery.y + scenery.height + LOGICAL_VIEWPORT.height);
    this.impact.position.set(-LOGICAL_VIEWPORT.width, top);
    this.impact.width = LOGICAL_VIEWPORT.width * 3;
    this.impact.height = bottom - top;
    // A phone held upright fits the course into ~400 px, so it closes in as
    // far as the empty band beside the course allows (`contentFitZoom`).
    this.camera.setField(portrait, fieldHeight, phonePortrait ? this.phonePortraitZoom : undefined);
    // The lava's marker sits on what a player can see, not on the field (review I1).
    if (visible !== undefined) this.camera.setVisible(visible.top, visible.bottom);
  }

  /**
   * In portrait, the lower third of the canvas expressed in the scenery root's
   * own units at the start of the climb; undefined in landscape.
   */
  private cityTopMin(transform: { scale: number; y: number }): number | undefined {
    if (this.framing?.portrait !== true) return undefined;
    const { y, height } = this.framing.scenery;
    const lowerThird = y + (height * 2) / 3;
    // The root's y with the camera at the start: the anchor alone.
    const rootAtStart = transform.y - this.camera.y * transform.scale;
    return (lowerThird - rootAtStart) / transform.scale;
  }

  /**
   * The glow the city should be drawn at this frame.
   *
   * Read by the screen and handed to the backdrop controller. It is a number
   * rather than a filter because the filter is no longer this view's to hold,
   * and because a view that returned a filter would be handing out something it
   * could destroy out from under its caller.
   */
  get cityGlow(): number {
    return this.cityGlowStrength;
  }

  /**
   * The stage's song, for the beat the world moves on.
   *
   * Set when a race mounts and cleared when none is playing, which is a still
   * world rather than a broken one: with no song there is no reason to pulse,
   * and the absence of one is not a failure to find it.
   */
  setSong(song: SongTiming | undefined): void {
    this.song = song;
  }

  /**
   * Where the song is in its own beats as it sounds, this frame
   * (`playingSongBeat`), for the world to breathe to what the player hears.
   * Undefined where nothing audible says: the world keeps the grid off the
   * tick.
   */
  setSongBeat(beat: number | undefined): void {
    this.songBeat = beat;
  }

  /**
   * Moves every layer that breathes, from one number off the authoritative tick.
   *
   * Applied here rather than inside each view so the three read from the same
   * clock at the same instant. A platform swelling on one frame and a window
   * brightening on the next would be two rhythms rather than one.
   */
  private applyPulse(tick: number, deltaMs: number): void {
    // Advanced first and unconditionally: the music's filter follows the climb
    // whether or not the world is allowed to move.
    const intensity = this.momentum.advance(deltaMs);
    // Reduced motion stills the camera's breath and the platforms' swell. The
    // glow keeps the strength it was built with; light is not motion.
    if (this.reducedMotion) {
      this.platforms.setSwell(1);
      this.pulseOffsetY = 0;
      return;
    }
    const pulse = worldPulseAt(tick, this.song, this.songBeat);
    if (pulse === undefined) {
      // A song that stops mid-swell must not leave the slabs thickened.
      this.platforms.setSwell(1);
      this.pulseOffsetY = 0;
      return;
    }

    // Momentum scales how much of the pulse is applied rather than replacing
    // it. A climb that got further breathes harder; the rhythm it breathes to
    // is the same one at every height.
    const depth = this.momentum.pulseScale;
    this.platforms.setSwell(1 + (pulse.platformScale - 1) * depth);
    // Recorded rather than applied. The scenery's glow lives on the scenery's
    // chain, which the backdrop controller owns, so the screen hands it this
    // number on the frame it hands it the time -- and a race with no song keeps
    // the strength the filter was built with rather than being dimmed to zero.
    this.cityGlowStrength = BLOOM.city * pulse.windowGlow * depth;
    // The marks breathe with the city, so the collected floors below a player
    // and the lit windows behind them are on the same beat.
    if (this.worldBloom !== undefined) {
      setBloomStrength(this.worldBloom, BLOOM.marks * pulse.windowGlow * depth);
    }
    this.pulseOffsetY = pulse.cameraBreath * depth;
    void intensity;
  }

  /** Whether the city's lit windows carry codes; see `window-code.ts`. */
  /**
   * Where the scenery starts stretching, in canvas pixels: the lowest skirted
   * skyline's foot, raised by the rows the art converter extrudes at every
   * plate's foot (`FOOT_ROWS` in generate-city.ts), which are one row repeated
   * too. Undefined when no skyline skirts.
   */
  skirtLine(): number | undefined {
    const foot = this.stageLayers.skirtFoot;
    if (foot === undefined) return undefined;
    return this.stageLayers.cityRoot.toGlobal(new Point(0, foot - EXTRUDED_FOOT_ROWS)).y;
  }

  get windowsCoded(): boolean {
    return this.stageLayers.windowsCoded;
  }

  /** How the city stack's textures are sampled, for the inspection hook. */
  get citySampling(): "nearest" | "linear" {
    return this.stageLayers.citySampling;
  }

  /** The beat swell the platforms are drawn with, for motion assertions. */
  get platformSwell(): number {
    return this.platforms.swell;
  }

  /** How open this climb has earned the music, in hertz. Read by the screen, which owns the mix. */
  get musicCutoffHz(): number {
    return this.momentum.musicCutoffHz;
  }

  /** Observes the local racer's share of the ascent from a snapshot. */
  observeProgress(progress: number): void {
    this.momentum.observe(progress);
  }

  /**
   * Applies one interpolated snapshot.
   *
   * `deltaMs` advances animation and camera damping only. Every position on
   * screen came from this snapshot, except the local player's, which may be
   * carried forward by `predicted` so their own controls feel immediate.
   *
   * The camera follows that same predicted position rather than the delayed
   * one: a camera tracking authority while the sprite leads it would leave the
   * player sliding around inside the frame.
   *
   * `predictedFloors` moves the moving floors to that same predicted moment.
   * The local racer is drawn there and lands there, so the floors under it
   * have to be there too; drawn from the delayed sample, a floor moving at two
   * hundred units a second sat well clear of the racer standing on it. Only a
   * floor's position moves: which floors are collected is authority's, from
   * the sample, and never predicted.
   */
  applySnapshot(
    snapshot: RoomSnapshot,
    localPlayerId?: PlayerId,
    deltaMs = 16.67,
    predicted?: PredictedState,
    predictedFloors?: ReadonlyMap<string, number>,
  ): void {
    this.localId = localPlayerId ?? this.localId;

    const floors =
      predictedFloors === undefined || predictedFloors.size === 0
        ? snapshot.platforms
        : snapshot.platforms.map((platform) => {
            const x = predictedFloors.get(platform.id);
            return x === undefined ? platform : { ...platform, x };
          });
    const authority = snapshot.players.find((player) => player.id === this.localId);
    const local = predicted ?? authority;
    const isFiniteCourse = snapshot.tuning.RACE_TIME_LIMIT_TICKS === 0 && snapshot.modeId !== "infinite";
    this.missedTransition = this.platforms.apply(floors, this.localId, {
      playerY: local?.y,
      isFinite: isFiniteCourse,
    });
    this.players.apply(
      snapshot.players,
      deltaMs,
      this.localId,
      predicted,
      snapshot.platforms,
      floors,
    );

    const showGuide =
      Boolean(this.isTutorial) ||
      (this.trajectoryGuideEnabled && !this.reducedMotion);
    if (local !== undefined) {
      this.trajectoryGuide.update({
        x: local.x,
        y: local.y,
        vx: local.vx,
        vy: local.vy,
        gravity: snapshot.tuning.GRAVITY,
        visible: showGuide,
      });
    } else {
      this.trajectoryGuide.clear();
    }


    if (authority !== undefined) {
      this.momentum.observe(authority.progress);
      // Authority's number, kept for the scenery's lift. Never derived here:
      // how far up a climb is is the server's answer, and the lift is a
      // presentation of it rather than a second opinion about it.
      this.climbProgress = authority.progress;
    }
    // Measured as a speed rather than a per-frame delta, so the camera behaves
    // the same at 60 Hz and at 120 Hz.
    const speed =
      local === undefined || deltaMs <= 0
        ? 0
        : (Math.abs(local.x - this.lastLocalX) * 1000) / deltaMs;
    const moving = local !== undefined && speed >= CAMERA.stationarySpeed;
    if (local !== undefined) this.lastLocalX = local.x;

    // The finish draws the camera to the winner (race-flow spec §5.2): a
    // glide through the camera's own damping, or a cut under reduced motion.
    const focused = this.focus === undefined ? undefined : snapshot.players.find((player) => player.id === this.focus);
    if (focused !== undefined && this.cutToFocus) {
      this.camera.cutTo(focused.y);
      this.cutToFocus = false;
    }
    const target = focused ?? local;
    if (!this.followSurvival(snapshot, focused === undefined, predicted, local?.y, moving, deltaMs)) {
      // A fast fall's look-ahead leads the local racer only; the winner is watched, not led.
      const lead = focused === undefined ? this.lookAhead : 0;
      this.camera.update(
        target === undefined ? { moving } : { moving, targetY: target.y, lead },
        deltaMs / 1000,
      );
    }
    // Before the camera is applied, so the breath rides the transform rather
    // than fighting it. The camera's own damping is a decision about following
    // a racer; the breath is a decision about the music, and mixing them into
    // one number would make either impossible to tune.
    this.applyPulse(snapshot.tick, deltaMs);
    this.applyCamera(deltaMs);
    this.applyLava(snapshot, predicted, deltaMs);
    this.applyFallTrail(local, deltaMs);
    // Tags keep a legible face whatever the zoom (spec §4.2). From the camera
    // just applied, so it is this frame's scale, read by the next apply.
    this.placeTagLayer();
    const zoom = this.world.scale.x;
    this.players.setTagScale(nameTagScale(this.cssPerUnit, zoom));
    // pixelDensity is device px per unit; over css px per unit it is the canvas's pixel ratio.
    const pixelRatio = this.pixelDensity / this.cssPerUnit;
    this.players.setTagResolution(nameTagResolution(nameTagFacePx(this.cssPerUnit), pixelRatio, NAME_TAG_FONT_SIZE));
    this.players.setTagPixelGrid(this.tagLayerAttached ? this.pixelDensity * zoom : undefined);
  }

  /**
   * Puts the name tags on a layer of the letterbox, outside the composite.
   *
   * The composite is 960 units wide at resolution 1 and is nearest-upscaled, so
   * a 12 px face drawn into it was resampled into 8 rows whatever its texture
   * resolution. The layer carries the world's own transform, so the tags'
   * coordinates stay the world's, but it is drawn at the canvas's resolution.
   */
  attachTagLayer(host: Container): void {
    host.addChild(this.tagLayer);
    this.tagLayer.addChild(this.players.tags);
    this.tagLayerAttached = true;
  }

  /** Lays the tag layer over the world: the world's transform, on whole device pixels. */
  private placeTagLayer(): void {
    if (!this.tagLayerAttached) return;
    const scale = this.world.scale.x;
    const snap = (value: number): number => Math.round(value * this.pixelDensity) / this.pixelDensity;
    this.tagLayer.scale.set(scale);
    this.tagLayer.position.set(
      snap(this.world.x + this.players.root.x * scale),
      snap(this.world.y + this.players.root.y * scale),
    );
  }

  /**
   * Survival's camera (lava spec §4), or false when the ordinary follow applies.
   *
   * A live racer is followed as in any race: the lava shows the edge, so the
   * camera no longer has to be it. The danger closes the zoom in a little
   * (never under reduced motion). Once the racer is out, the camera watches
   * the highest racer still standing. A finish's focus overrides all of it.
   */
  private followSurvival(
    snapshot: RoomSnapshot,
    unfocused: boolean,
    predicted: PredictedState | undefined,
    localY: number | undefined,
    moving: boolean,
    deltaMs: number,
  ): boolean {
    const endless = snapshot.tuning.RACE_TIME_LIMIT_TICKS > 0;
    const self = snapshot.players.find((player) => player.id === this.localId);
    if (!endless || !unfocused || self === undefined) {
      this.danger = 0;
      this.camera.setDanger(0);
      return false;
    }
    if (self.outAtTick === undefined) {
      const edge = predicted?.floorEdgeY ?? self.floorEdgeY;
      this.danger = survivalDanger(localY ?? self.y, edge, snapshot.tuning);
      this.camera.setDanger(this.reducedMotion ? 0 : this.danger);
      return false;
    }
    this.danger = 0;
    const leader = snapshot.players
      .filter((player) => player.outAtTick === undefined && player.status !== "dns")
      .sort((a, b) => b.y - a.y)[0];
    this.camera.setDanger(0);
    this.camera.update(leader === undefined ? { moving } : { moving, targetY: leader.y }, deltaMs / 1000);
    return true;
  }

  /** The fast-fall's trail, drawn after the camera so the lines fill this frame's view (G4). */
  private applyFallTrail(local: { readonly x: number; readonly y: number; readonly facingRight: boolean } | undefined, deltaMs: number): void {
    this.feelClockMs += Math.max(0, deltaMs);
    const texture = this.localId === undefined ? undefined : this.textureOf(this.localId);
    const top = this.framing?.portrait ? this.framing.scenery.y : 0;
    const bottom = this.framing?.portrait
      ? this.framing.scenery.y + this.framing.scenery.height
      : this.camera.visibleBottom();
    this.fallTrail.update({
      nowMs: this.feelClockMs,
      share: this.fallShare,
      racer: local === undefined || texture === undefined ? undefined : { x: local.x, y: local.y, texture, facingRight: local.facingRight },
      field: { width: LOGICAL_VIEWPORT.width, top, bottom },
      tuning: this.fallTuning,
    });
  }

  /** Survival's lava (lava spec §5): the local racer's edge, drawn after the camera so it reads this frame's view. */
  private applyLava(snapshot: RoomSnapshot, predicted: PredictedState | undefined, deltaMs: number): void {
    this.dipKey = undefined;
    const lava = this.lavaView;
    if (lava === undefined) return;
    this.lavaClockMs += Math.max(0, deltaMs);
    const self = snapshot.players.find((player) => player.id === this.localId);
    const elapsed = snapshot.tick - (snapshot.raceStartedAtTick ?? snapshot.tick);
    const drained = self?.outAtTick !== undefined && elapsed - self.outAtTick >= LAVA_LINGER_TICKS;
    const edgeY = this.tutorialLava
      ? this.tutorialEdge?.y
      : self === undefined || drained
        ? undefined
        : (predicted?.floorEdgeY ?? self.floorEdgeY);
    const alive = self !== undefined && self.outAtTick === undefined && self.status !== "dns";
    const racer = alive ? { x: predicted?.x ?? self.x, y: predicted?.y ?? self.y } : undefined;
    if (racer !== undefined) this.lastLavaX = racer.x;
    const half = LOGICAL_VIEWPORT.width / 2 / this.camera.transform().scale;
    const bottom = this.camera.visibleBottom();
    // Kept legible however small the letterbox draws it, as the name tags are (final review I4).
    const markerScale = minimumFaceScale(this.cssPerUnit, LAVA_MARKER_FONT);
    lava.marker.scale.set(markerScale);
    lava.update({
      edgeY,
      racer,
      // The local racer's own banded rise, as the simulation moves their edge (lava band): none while
      // the edge waits for their first input or rests from it (first-race spec §2).
      rise: this.tutorialLava
        ? (this.tutorialEdge?.rise ?? 0)
        : self === undefined
          ? 0
          : edgeRiseSpeed(elapsed, self, bandRacers(snapshot.players), snapshot.tuning),
      deltaMs,
      reducedMotion: this.reducedMotion,
      viewLeft: -half,
      viewRight: half,
      viewBottomY: this.camera.logicalYAtScreen(bottom),
      markerAt: { x: LOGICAL_VIEWPORT.width / 2, y: bottom - 22 * markerScale },
    });
    const canvas = this.framing?.scenery;
    lava.updateSpill({
      surface: edgeY === undefined ? undefined : this.camera.logicalToScreen({ x: 0, y: edgeY }).y,
      visibleTop: this.camera.visibleTop(),
      visibleBottom: bottom,
      canvasTop: canvas?.y ?? 0,
      canvasBottom: canvas === undefined ? this.camera.visibleBottom() : canvas.y + canvas.height,
      left: -LOGICAL_VIEWPORT.width,
      right: LOGICAL_VIEWPORT.width * 2,
    });
    const sinking = racer !== undefined && edgeY !== undefined && isSinking(racer.y, edgeY, snapshot.tuning);
    if (this.sizzle.dip(sinking, this.lavaClockMs)) this.dipKey = `lava:${this.lavaId}:${++this.dips}`;
  }

  /**
   * On the frame the local racer first dips into the lava, the sizzle's key:
   * unique to this view and this dip, because the mixer never forgets a key
   * (lava spec §5). Undefined on every other frame.
   */
  get lavaDip(): string | undefined {
    return this.dipKey;
  }

  /**
   * Survival's danger to the local racer, 0 to 1, as the camera would take it
   * before reduced motion stills it: the mix hears it either way.
   */
  get survivalDanger(): number {
    return this.danger;
  }

  /** The lava, for tests and inspection; undefined on a finite course. */
  get lava(): LavaView | undefined {
    return this.lavaView;
  }

  /** The lava's splash where the local racer went under (lava spec §5). */
  lavaSplash(): void {
    this.lavaView?.splash(this.lastLavaX);
  }

  /**
   * Writes the camera transform onto both transformed layers.
   *
   * The clipped world and both unclipped scenery roots move together, or the
   * scenery would drift against the platforms standing in front of it -- and
   * the city would drift against the sky behind it.
   */
  private applyCamera(deltaMs: number): void {
    const transform = this.camera.transform();
    this.world.scale.set(transform.scale);
    // The kick moves the whole picture, scenery with it, as the breath does,
    // and so does the trauma shake.
    const offsetY = this.pulseOffsetY + this.kickOffsetY + snapTo(this.setPieceKick.update(deltaMs / 1_000, 0), 1) + this.shakeY;
    const offsetX = this.shakeX;
    this.world.position.set(transform.x + offsetX, transform.y + offsetY);
    for (const parallax of [this.skyParallax, this.cityParallax]) {
      parallax.scale.set(transform.scale);
      parallax.position.set(transform.x + offsetX, transform.y + offsetY);
    }
    // The city is nearest-sampled, so its root starts on a whole device pixel;
    // the layers inside it are snapped by `StageLayers` at the zoomed density.
    // Within half a device pixel of the world, which no eye can separate.
    const snap = (value: number): number =>
      Math.round(value * this.pixelDensity) / this.pixelDensity;
    this.cityParallax.position.set(snap(this.cityParallax.x), snap(this.cityParallax.y));

    // The layers move against the camera from here, and that is what gives the
    // skyline its depth. The composition is told the climb as well as the
    // camera, because it also carries the cosmetic lift -- which is a change to
    // how the scenery is framed, never to where a player is.
    this.stageLayers.update(
      this.camera.y,
      this.climbProgress,
      this.ambientSeconds,
      deltaMs,
      this.reducedMotion,
      { pixelsPerUnit: this.pixelDensity * transform.scale, cityTopMin: this.cityTopMin(transform) },
      this.motion,
    );
  }

  /**
   * The local racer and its nameplate, in the field's logical units, for UI
   * that must keep clear of them. Undefined before the racer is drawn.
   *
   * Worked out from the sprite's own box and the nameplate's lane through the
   * camera's transform, rather than with `getBounds`, which would walk on up
   * into the composite the world is drawn into, and would measure the
   * nameplate's text. The tag is taken as the body's width and a line of
   * its 11 px type at the tag's scale: near enough for keeping a card clear, with the margin
   * the card adds.
   */
  localRacerBounds(): { x: number; y: number; width: number; height: number } | undefined {
    const display = this.localId === undefined ? undefined : this.players.displayFor(this.localId);
    if (display === undefined) return undefined;
    const { sprite, tag, root } = display;
    const width = Math.abs(sprite.width);
    const height = Math.abs(sprite.height);
    const left = sprite.x - sprite.anchor.x * width;
    const bottom = sprite.y - sprite.anchor.y * height + height;
    // The tag lives on its own layer in the players' coordinates, so its top
    // is taken relative to the racer, at the scale it is drawn at.
    const tagTop = tag.root.y - root.y - NAMEPLATE_LINE * tag.root.scale.y;
    const top = Math.min(sprite.y - sprite.anchor.y * height, tagTop);
    const scale = this.world.scale.x;
    const originX = this.world.x + (this.players.root.x + root.x) * scale;
    const originY = this.world.y + (this.players.root.y + root.y) * scale;
    return { x: originX + left * scale, y: originY + top * scale, width: width * scale, height: (bottom - top) * scale };
  }

  get platformCount(): number {
    return this.platforms.count;
  }

  get playerCount(): number {
    return this.players.count;
  }

  get hasMissedFloor(): boolean {
    return this.platforms.hasMissedFloor;
  }

  get newlyMissed(): boolean {
    return this.missedTransition;
  }

  resetAscent(): void {
    this.missedTransition = false;
    this.platforms.resetAscent();
  }

  destroy(): void {
    // The beat layer lives in the stage's world beside this view's, so it goes with it.
    this.beatLayer.destroy({ children: true });
    this.fallTrail.destroy();
    this.feelLayer.destroy({ children: true });
    this.tagLayer.destroy({ children: true });
    this.lavaView?.destroy();
    this.frontLayer.destroy({ children: true });
    this.lavaLayer.destroy({ children: true });
    this.platforms.destroy();
    this.players.destroy();
    this.trajectoryGuide.destroy();
    this.world.destroy({ children: true });

    // The scenery root, its layers and the textures derived from them go
    // together, through the class that made them.
    this.stageLayers.destroy();
    // Only the world-space glow is this view's to release. The scenery's sky,
    // city bloom and refraction belong to the backdrop controller, and
    // releasing them here would be releasing something this view never owned.
    this.worldBloom?.destroy();
    this.worldBloom = undefined;
  }
}
