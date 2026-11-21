/**
 * Player rendering.
 *
 * Reconciles one sprite and one nameplate per player, addressed by the player
 * id the server sent. Which animation plays is derived from the simulation's
 * own vertical velocity -- authority's for a remote player, the prediction's
 * for the local one -- rather than from anything the client decides.
 *
 * The derivation is written around one fact about this game: a player never
 * rests during a race. Every contact with a floor sets `vy` to
 * `BOUNCE_VELOCITY`, so a racer is permanently airborne, and the only stillness
 * a race contains is the countdown and the moment after a finish. That makes
 * "barely moving vertically" the description of a bounce's apex, not of a
 * landing -- which is why direction of travel is held through the turn and a
 * landing is read as the reversal that a floor, and only a floor, produces.
 *
 * An earlier revision inferred that reversal from how far the sprite had moved
 * between two drawn frames. It played the landing flourish wherever the sprite
 * had drifted to rather than where the contact happened, and a damped follow
 * could manufacture a reversal authority never produced. `vy` reaches the
 * client for everyone now, so the inference is gone rather than kept as a
 * second path.
 */

import { Container, Sprite } from "pixi.js";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { PlayerSnapshot } from "@floor-fifty/shared/common/protocol";
import type { PredictedState } from "../net/local-simulation";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { playerColorTint, roleTint } from "@floor-fifty/asset-contract/roles";
import {
  LOGICAL_VIEWPORT,
  PLAYER_SPRITE_SIZE,
  SEAT_SCARVES,
  type SeatScarf,
} from "../../lib/constants";
import { createOutlineFilter } from "../render/filters/outline";
import { VISUAL_INSPECTION_ENABLED } from "../render/inspection";
import {
  FrameSheet,
  loadedSheetData,
  type SheetAnimation,
  type SheetAnimations,
  type SheetDataProvider,
  type TextureProvider,
} from "../render/textures";
import { NameplateDeclutter } from "./nameplate-declutter";
import { NameTag, NameplateChip, racerZIndex } from "./name-tag";
import { SILHOUETTE_TINT } from "./platform-view";
import { Bark } from "./juice/bark";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import { FONT_UI, fontUiFor } from "../i18n/fonts";
import { activeLocale } from "../i18n/strategy";

/** Frame size and row order, fixed by the art contract. */
const FRAME = { width: 32, height: 32 } as const;

/**
 * Vertical separation between two racers' nameplates, in world units.
 *
 * One line of the face the plates are set in, so two names in adjacent lanes
 * sit clear of each other rather than touching.
 */
const NAMEPLATE_LANE = 11;

const ANIMATION_ROWS = ["idle", "run", "jump", "fall", "land", "wall", "ceiling"] as const;

/**
 * How close a racer must be to a floor's face to read as gripping it.
 *
 * Contact is resolved in the simulation, which pushes a player out until they
 * are flush; a flush player is exactly at the reach, so the test is for being
 * at it rather than inside it, with a pixel of slack for the interpolation the
 * drawn position has been through.
 */
const GRIP_SLACK = 2;
type AnimationName = (typeof ANIMATION_ROWS)[number];
/**
 * What to play when the sheet declares nothing.
 *
 * Frame counts and cycle lengths belong to the art manifest, which
 * `sync-client-assets` carries through to the Pixi bundle as `data.animations`
 * and `SheetDataProvider` reads back. That is the source every drawn frame
 * uses, so retiming a row in the manifest retimes the game.
 *
 * This table is the last resort behind it, not a second copy of it: it is what
 * an unresolvable alias falls back to, and a resolver that went quiet would
 * otherwise freeze every player on frame zero. It is deliberately the art
 * contract's own grid, so the fallback renders a plausible character rather
 * than a still, and a test pins its frame counts to the manifest.
 *
 * The durations are not the manifest's, and nothing pins them. A held pose
 * wants a longer dwell than a frame of a smooth cycle: under a language that
 * cuts between poses with no in-betweens, even timing is what makes pose-to-pose
 * read as deliberate rather than as dropped frames.
 */
export const ANIMATION_FALLBACK: Readonly<Record<string, SheetAnimation>> = {
  idle: { frames: 2, durationMs: 900 },
  run: { frames: 4, durationMs: 400 },
  jump: { frames: 1, durationMs: 200 },
  fall: { frames: 1, durationMs: 200 },
  land: { frames: 2, durationMs: 220 },
  // Held longest of all. A grip is a state a racer is in, not a motion they
  // are performing, and two poses alternating slowly read as holding on where
  // a quicker alternation would read as scrambling.
  wall: { frames: 2, durationMs: 460 },
  ceiling: { frames: 2, durationMs: 460 },
};
/** The cycle length for a row nothing declares at all. */
const DEFAULT_DURATION_MS = 600;
const DEFAULT_FRAMES = 1;

/**
 * Vertical speed under which a player is not clearly travelling either way,
 * as a fraction of one bounce.
 *
 * A band rather than a point, because interpolation between two authority
 * samples never lands exactly on zero. Crucially it is a *speed*: an earlier
 * rule compared a per-frame distance, which meant the same bounce read
 * differently at 60 Hz and at 144 Hz, and worse on the better monitor.
 */
const REST_SPEED_FRACTION = 0.05;
/** Horizontal speed under which a resting player counts as still. Same idea. */
const MOVING_SPEED_FRACTION = 0.05;
/**
 * How many apex crossings' worth of stillness a rest has to outlast.
 *
 * Every bounce turns over through the rest band and spends real time inside
 * it -- about a fifth of a second under the shipped tuning. A rest is what is
 * left when the stillness lasts several times longer than that, which is a
 * thing only the countdown and a finished race produce.
 */
const REST_DWELL_APEXES = 3;

type Figure = {
  root: Container;
  sprite: Sprite;
  tag: NameTag;
};

/** How bright a story racer's body is on a silhouetted stage, as a share of its colour. */
export const STORY_SILHOUETTE_SHADE = 0.78;

type PlayerDisplay = {
  root: Container;
  sprite: Sprite;
  tag: NameTag;
  /**
   * The same player, drawn one viewport width away across the seam.
   *
   * The course wraps with a period of one viewport width, so a player near an
   * edge really is at two places at once and the arcade wrap is simply drawing
   * both. It is always positioned and always parented; when the player is
   * nowhere near a seam it sits a full width outside the letterbox mask, which
   * costs one culled sprite and saves a threshold nobody has to keep in step
   * with the camera's zoom.
   */
  wrapped: Figure;
  scarf: SeatScarf;
  /** Zero-based seat, which the nameplate shows and the label lane uses. */
  seat: number;
  /** This player's sheet, cut once and owned by the display. */
  frames: FrameSheet;
  /** The sheet's declared rows, when it declares any. */
  animations?: SheetAnimations;
  /** Previous frame's drawn x, in logical coordinates. Run-versus-idle reads it. */
  lastX: number;
  /** The body's own alpha, as a flicker last set it; 1 when none has. */
  bodyAlpha: number;
  /** The body's tint on a silhouetted stage: black, or in the story its racer's own colour in shadow. */
  silhouetteTint: number;
  /** Someone else's racer, drawn dimmed (`RIVAL_BODY_ALPHA`). */
  rival: boolean;
  /** A CPU's mood word, made on its first (CPU banding spec §4). */
  bark?: Bark;
  /**
   * Which way the player was last clearly travelling.
   *
   * Held through the rest band rather than cleared by it, so an apex keeps
   * playing the rise it belongs to instead of reporting a touchdown in open
   * air. Undefined only until a display has seen its first clear motion.
   */
  travel: "rising" | "falling" | undefined;
  /** How long the vertical speed has stayed inside the rest band. */
  stillMs: number;
  /** What is left of the landing flourish. Counts down; zero means not landing. */
  landMs: number;
  /**
   * Pinned to a floor by a held fast fall: the crouch is held, not played.
   *
   * Holding the control on a floor stops the ascent (`applyFastFallOverride`),
   * so the racer sits flush with `vy` pointing down and never moves. Read by
   * travel alone that is a fall; it is a racer crouched on the roof.
   */
  held: boolean;
  animation: AnimationName;
  elapsedMs: number;
  /**
   * The sprite's scale at rest, read once when it was built: the size the
   * reference draws a racer at. A squash multiplies this, never the scale it
   * left last frame, so it cannot compound.
   */
  baseScale: { x: number; y: number };
  /** The juice's squash, set by the director each frame (polish spec §4.1). */
  squash: { x: number; y: number };
  /** The sprite's lean, as its skew in radians; 0 is upright (Wonder spec §4.1). */
  lean: number;
};

/** Leave the fourth seat's full plate height clear, including at phone scale. */
const CHIP_LANE = 5;

/** The standing-idle bob's rate: a racer waiting at the start breathes (race-flow spec §3.3). */
export const IDLE_BOB_HZ = 1.25;

/**
 * Every racer but your own is drawn dimmed and see-through (owner, 2026-10-04:
 * "it's hard to track player"), so in a pack of four the one you steer is the
 * one that reads. The body only: nameplates stay solid, so who is who still
 * reads at a glance. A flicker multiplies with it rather than replacing it.
 */
export const RIVAL_BODY_ALPHA = 0.55;
/** A rival's body, darkened toward grey; white leaves a sprite as drawn. */
export const RIVAL_BODY_TINT = 0xb4b4b4;

/**
 * Whether rivals are drawn undimmed: only while the Help's race demo is recorded (`demo-capture.spec.ts` sets
 * `window.__ffDemoFullColourRivals` before the page loads), and only in a build with the inspection hooks, so a
 * player's game always dims them (Owner, 2026-11-20: "Full-colour rivals, closer view", for the recording only).
 */
export function fullColourRivals(): boolean {
  return VISUAL_INSPECTION_ENABLED && (globalThis as { __ffDemoFullColourRivals?: boolean }).__ffDemoFullColourRivals === true;
}

/** How far a waiting racer is lifted this frame, in whole pixels (0 to 2). */
export function idleBob(elapsedMs: number, reduced: boolean): number {
  if (reduced) return 0;
  // Subtracted from 0 rather than negated, so a level stance is 0, not -0.
  return 0 - Math.round(1 - Math.cos((elapsedMs / 1000) * 2 * Math.PI * IDLE_BOB_HZ));
}

export class PlayerView {
  private reducedMotion = false;
  /** The racer whose pose a slam's hit-stop holds, if any. */
  private frozen: PlayerId | undefined;

  /**
   * Restyles every plate and chip when the language changes mid-race, so a
   * name in the new script draws in a face that has it. One read and one
   * compare a frame; the restyle itself only on a change. The face is loaded
   * before the switch is applied (`applyLocale`), so Pixi rasterises it, not
   * the fallback.
   */
  private followLocaleFace(): void {
    const stack = fontUiFor(activeLocale());
    if (stack === this.fontFamily) return;
    this.fontFamily = stack;
    for (const display of this.displays.values()) {
      display.tag.setFontFamily(stack);
      display.wrapped.tag.setFontFamily(stack);
    }
    for (const chip of this.chips) chip.setFontFamily(stack);
  }

  /** Whether the bob stands still; read from the view's ambient each frame. */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Where the HUD's top band ends, in this view's units, y-down; no CPU's word is drawn above it. */
  setBarkCeiling(y: number): void {
    this.barkCeiling = Number.isFinite(y) ? y : Number.NEGATIVE_INFINITY;
  }

  /** Draws every tag at `scale`, so its face stays legible on a small screen (spec §4.2). */
  setTagScale(scale: number): void {
    const next = Number.isFinite(scale) && scale > 0 ? scale : 1;
    if (next === this.tagScale) return;
    this.tagScale = next;
    // At once, from where the bodies already stand: a tag drawn a frame at
    // the old scale on a phone is a frame of unreadable name.
    for (const display of this.displays.values()) this.placeTags(display);
    for (const chip of this.chips) chip.root.scale.set(next);
  }

  /**
   * Device pixels per world unit, when the tags are drawn at the canvas's resolution:
   * a tag's place is then rounded to a whole device pixel, so its plate and face
   * do not straddle two. Undefined (the tags are in the picture): not rounded.
   */
  setTagPixelGrid(devicePerUnit: number | undefined): void {
    this.tagGrid = devicePerUnit !== undefined && Number.isFinite(devicePerUnit) && devicePerUnit > 0 ? devicePerUnit : undefined;
  }

  private onTagGrid(value: number): number {
    return this.tagGrid === undefined ? value : Math.round(value * this.tagGrid) / this.tagGrid;
  }

  /** Draws every tag's face at `resolution`, one texel to one device pixel (see `nameTagResolution`). */
  setTagResolution(resolution: number): void {
    if (resolution === this.tagResolution) return;
    this.tagResolution = resolution;
    for (const display of this.displays.values()) {
      display.tag.setResolution(resolution);
      display.wrapped.tag.setResolution(resolution);
    }
    for (const chip of this.chips) chip.setResolution(resolution);
  }

  /** Each copy's tag over its racer, in the racer's seat lane, at the tag scale. */
  private placeTags(display: PlayerDisplay): void {
    for (const [tag, at] of [
      [display.tag, display.root],
      [display.wrapped.tag, display.wrapped.root],
    ] as const) {
      tag.root.scale.set(this.tagScale);
      // The lanes keep four overlapping names legible; see NAMEPLATE_LANE.
      tag.root.position.set(
        this.onTagGrid(at.position.x),
        this.onTagGrid(at.position.y - this.tuning.PLAYER_HEIGHT / 2 - 6 - display.seat * NAMEPLATE_LANE * this.tagScale),
      );
    }
  }

  readonly root = new Container();
  /** Racer bodies, ordered by `racerZIndex` so the focused racer is drawn last. */
  readonly bodies = new Container();
  /** Every name tag and cluster chip, above every body (spec §4.3). */
  readonly tags = new Container();
  /** The scale every tag is drawn at; see `setTagScale`. */
  private tagScale = 1;
  /** The resolution every tag's face is drawn at; see `setTagResolution`. */
  private tagResolution: number | undefined;
  private tagGrid: number | undefined;
  /** The HUD's bottom in this view's units, y-down: no bark rises past it (the owner: the HUD covered them). */
  private barkCeiling = Number.NEGATIVE_INFINITY;
  private readonly displays = new Map<PlayerId, PlayerDisplay>();
  /** Folds clustered racers' plates into chips; see `nameplate-declutter.ts`. */
  private readonly declutter = new NameplateDeclutter();
  /** Backed count chips, pooled: shown as needed, hidden when not. */
  private readonly chips: NameplateChip[] = [];
  /** The UI stack the plates are drawn in: the active locale's (languages spec §6.2). */
  private fontFamily = FONT_UI;

  /** Vertical speed, in logical units per second, that counts as travelling. */
  private readonly restSpeed: number;
  /** Horizontal speed, in logical units per second, that counts as moving. */
  private readonly movingSpeed: number;
  /** How long stillness has to last before it is a rest and not an apex. */
  private readonly restDwellMs: number;

  constructor(
    private readonly textures: TextureProvider,
    private readonly tuning: ResolvedTuning,
    private readonly localPlayerId: () => PlayerId | undefined,
    private readonly sheetData: SheetDataProvider = loadedSheetData,
    private readonly options: {
      silhouette?: boolean;
      sheetAliasFor?: (characterId: string, colour: SeatScarf) => string;
    } = {},
  ) {
    this.root.label = "players";
    this.bodies.label = "bodies";
    this.tags.label = "nameplates";
    this.bodies.sortableChildren = true;
    this.tags.sortableChildren = true;
    this.root.addChild(this.bodies, this.tags);
    this.restSpeed = tuning.BOUNCE_VELOCITY * REST_SPEED_FRACTION;
    this.movingSpeed = tuning.MAX_MOVE_SPEED * MOVING_SPEED_FRACTION;
    // A bounce crosses the rest band in `2 * restSpeed / |GRAVITY|` seconds on
    // its way over the top, so the dwell is derived from the same tuning the
    // server steps with rather than guessed. Retune gravity and this follows.
    this.restDwellMs =
      ((2000 * this.restSpeed) / Math.abs(tuning.GRAVITY)) * REST_DWELL_APEXES;
  }

  /**
   * Writes a snapshot's players onto the display list.
   *
   * `deltaMs` advances animation only; it never advances a position. Every
   * remote player is drawn exactly where the snapshot puts them.
   *
   * `predicted` is the one exception, and it is a picture rather than a
   * claim: the local player's own sprite leads authority so their controls feel
   * attached to it. `LocalSimulation` owns that lead and bounds it; here it is
   * simply the state to draw from.
   *
   * `localFloors` are the floors at the predicted racer's own moment, and the
   * local racer's grip is judged against them: judged against the sample's
   * floors, a racer riding a moving floor would read as off it.
   */
  apply(
    players: readonly PlayerSnapshot[],
    deltaMs: number,
    localPlayerId?: PlayerId,
    predicted?: PredictedState,
    floors: readonly { x: number; y: number }[] = [],
    localFloors: readonly { x: number; y: number }[] = floors,
  ): void {
    this.followLocaleFace();
    const seen = new Set<PlayerId>();

    const focus = localPlayerId ?? this.localPlayerId();
    players.forEach((player, index) => {
      seen.add(player.id);
      const display = this.displays.get(player.id) ?? this.create(player, index);

      const drawn =
        predicted !== undefined && player.id === localPlayerId ? predicted : player;
      display.root.position.set(drawn.x, -drawn.y);
      // Always the far side, so the copy approaches the seam the player is
      // approaching rather than receding from it.
      const seamOffset = drawn.x >= 0 ? -LOGICAL_VIEWPORT.width : LOGICAL_VIEWPORT.width;
      display.wrapped.root.position.set(drawn.x + seamOffset, -drawn.y);
      // A disconnected player is still on the course; showing them faded says
      // so without moving them or removing their nameplate.
      display.root.alpha = player.status === "connected" ? 1 : 0.4;
      display.rival = this.dimRivals && focus !== undefined && player.id !== focus;
      this.paintBody(display);

      // Vertical state is authority's, or the prediction's for the local
      // player. It used to be inferred from how far the sprite had moved
      // between two frames, which meant the flourish played wherever the
      // sprite had drifted to rather than where the contact happened -- and a
      // damped follow could invent a reversal that never occurred.
      const vy = drawn.vy;
      // A speed, not a per-frame distance. What a pose means must not depend
      // on how often the screen asks.
      const horizontalSpeed =
        deltaMs > 0 ? (Math.abs(drawn.x - display.lastX) * 1000) / deltaMs : 0;

      if (Math.abs(vy) > this.restSpeed) {
        const travel = vy > 0 ? "rising" : "falling";
        // Every floor contact sets `vy` to `BOUNCE_VELOCITY`
        // (`simulation/collision.ts`), so in this game a landing *is* the
        // moment a descent turns into an ascent, and nothing else produces
        // one. An apex is the opposite turn and cannot be mistaken for it.
        if (travel === "rising" && display.travel === "falling") {
          display.landMs = this.durationFor("land", display.animations);
        }
        display.travel = travel;
        display.stillMs = 0;
      } else {
        display.stillMs += deltaMs;
      }
      // A slam's hit-stop holds the pose -- the animation, its frame and the
      // flourish's clock -- while the position above carries on (D-P5).
      const posed = this.frozen === player.id;
      if (!posed) display.landMs = Math.max(0, display.landMs - deltaMs);

      // `land` wins while its flourish lasts, then a sustained rest, then the
      // direction of travel.
      // Which face, if any, this racer is currently held against.
      //
      // Derived here rather than sent: the simulation already resolved the
      // contact -- that is why they are flush against the floor at all -- and
      // the geometry that produced it is on the wire as the floor positions.
      // Re-deriving it costs a handful of comparisons and keeps the protocol
      // out of the business of describing poses.
      const against = drawn === predicted ? localFloors : floors;
      const grip = this.gripOf(drawn.x, drawn.y, against);
      display.held =
        grip === undefined && vy < -this.restSpeed && this.standsOn(drawn.x, drawn.y, against);

      const resting = display.stillMs >= this.restDwellMs;
      const next: AnimationName =
        display.landMs > 0 || display.held
          ? "land"
          : grip ?? (resting
            ? horizontalSpeed > this.movingSpeed
              ? "run"
              : "idle"
            : display.travel === "rising"
              ? "jump"
              : "fall");
      if (next !== display.animation && !posed) {
        display.animation = next;
        display.elapsedMs = 0;
        this.stand(display.sprite, next);
        this.stand(display.wrapped.sprite, next);
      }
      display.lastX = drawn.x;

      if (!posed) display.elapsedMs += deltaMs;
      this.drawFrame(display);

      // A racer waiting at the start breathes (race-flow spec §3.3), from the
      // stance it stands in, so the bob never accumulates.
      const standY = display.animation === "ceiling" ? -this.tuning.PLAYER_HEIGHT / 2 : this.tuning.PLAYER_HEIGHT / 2;
      const bob = player.awaitingInput ? idleBob(display.elapsedMs, this.reducedMotion) : 0;
      display.sprite.y = standY + bob;
      display.wrapped.sprite.y = standY + bob;

      // Facing comes from the same place the position does: the wire for a
      // remote player, so everyone watching mirrors them the same way, and the
      // prediction for the local one. Reading it off the snapshot for everybody
      // left your own sprite facing the way you used to be going for as long as
      // the position had already led -- a turn that slid before it faced.
      //
      // The squash rides on the same line: the sprite is anchored at its feet
      // (see `stand`), so a squash leaves the face it landed on where it is.
      display.sprite.scale.set(
        (drawn.facingRight ? 1 : -1) * display.baseScale.x * display.squash.x,
        display.baseScale.y * display.squash.y,
      );


      // The copy is synced from the drawn sprite rather than derived a second
      // time. Two derivations would eventually disagree, and the disagreement
      // would only ever be visible at the seam -- the one place a player is
      // already braced for something to look wrong.
      display.wrapped.root.alpha = display.root.alpha;
      display.wrapped.sprite.texture = display.sprite.texture;
      display.wrapped.sprite.scale.set(display.sprite.scale.x, display.sprite.scale.y);
      // The lean skews the sprite alone: its name tag is a sibling and stays upright.
      display.sprite.skew.x = display.lean;
      display.wrapped.sprite.skew.x = display.lean;
      const z = racerZIndex(player.id, focus, display.seat);
      display.root.zIndex = z;
      display.wrapped.root.zIndex = z;
      for (const tag of [display.tag, display.wrapped.tag]) {
        tag.setName(player.name);
        tag.setFocus(player.id === focus);
        tag.root.zIndex = z;
        tag.root.alpha = display.root.alpha;
      }
      this.placeTags(display);
      if (display.bark !== undefined) {
        display.bark.advance(deltaMs, this.reducedMotion, this.tagScale);
        // Over the nameplate, clear of its lane, and never under the HUD.
        const over = display.tag.root.position.y - 4 * this.tagScale;
        display.bark.root.position.set(display.tag.root.position.x, Math.max(over, Math.ceil(this.barkCeiling + display.bark.root.height)));
        display.bark.root.zIndex = display.tag.root.zIndex + 1;
      }
    });

    for (const [id, display] of this.displays) {
      if (seen.has(id)) continue;
      this.release(display);
      this.displays.delete(id);
    }

    this.destack(deltaMs, focus);
  }

  /**
   * Folds the plates of racers drawn on top of each other into one chip.
   *
   * Measured from where each racer was just drawn, so the local player's
   * predicted lead counts. The local plate always stays; the others hide, and
   * a chip counting the whole cluster sits above the top seat lane.
   */
  private destack(deltaMs: number, localId: PlayerId | undefined): void {
    const sites = [...this.displays].map(([id, display]) => ({
      id,
      x: display.root.position.x,
      y: -display.root.position.y,
    }));
    const { hidden, chips } = this.clusterChips ? this.declutter.update(sites, localId, deltaMs) : { hidden: new Set<PlayerId>(), chips: [] };

    for (const [id, display] of this.displays) {
      display.tag.root.visible = !hidden.has(id);
      display.wrapped.tag.root.visible = display.tag.root.visible;
    }

    while (this.chips.length < chips.length) this.chips.push(this.createChip());
    this.chips.forEach((chip, index) => {
      const cluster = chips[index];
      chip.root.visible = cluster !== undefined;
      if (cluster === undefined) return;
      chip.setCount(cluster.count);
      chip.root.scale.set(this.tagScale);
      chip.root.position.set(
        this.onTagGrid(cluster.x),
        this.onTagGrid(-cluster.y - this.tuning.PLAYER_HEIGHT / 2 - 6 - CHIP_LANE * NAMEPLATE_LANE * this.tagScale),
      );
    });
  }

  private createChip(): NameplateChip {
    const chip = new NameplateChip();
    chip.setFontFamily(this.fontFamily);
    if (this.tagResolution !== undefined) chip.setResolution(this.tagResolution);
    this.tags.addChild(chip.root);
    return chip;
  }

  /** Selects the sheet cell for the display's current animation and elapsed time. */
  private drawFrame(display: PlayerDisplay): void {
    const row = ANIMATION_ROWS.indexOf(display.animation);
    const frames = this.framesFor(display.animation, display.animations);
    const durationMs = this.durationFor(display.animation, display.animations);
    // A held crouch rests on its last frame: the two landing poses alternating
    // under a racer who is not moving would read as a shiver.
    const column = display.held
      ? frames - 1
      : Math.floor((display.elapsedMs / (durationMs / frames)) % frames);

    display.sprite.texture = display.frames.frame(column, row);
  }

  /**
   * Builds one drawable copy of a player into `root`.
   *
   * A player is drawn twice -- once where they are and once across the seam --
   * and the two are the same picture, so they are built by the same function
   * rather than by a constructor and a copy of it that could drift from it.
   */
  private figure(
    player: PlayerSnapshot,
    frames: FrameSheet,
    root: Container,
    seat: number,
  ): Figure {
    const sprite = new Sprite(frames.frame(0, 0));
    this.stand(sprite, "idle");

    // On the sprite, never on the container that holds it.
    //
    // A filter on the container outlines everything inside it, and the
    // container also holds the nameplate -- so the racer got a rectangular
    // border around its name instead of a border around itself. The filter
    // needs padding too: it writes outline into the transparent pixels just
    // outside the silhouette, and without room to do that the border is
    // clipped away on exactly the edges it is drawn for.
    sprite.filters = [
      createOutlineFilter({
        outlineColor: roleTint("outline"),
        // The warm end of the sky, because that is where the light in this
        // world comes from: a rim in the overhead blue would be a second light
        // source the scene does not have.
        // In the story, on a silhouetted stage, each racer's rim is its own colour, so the three are told apart (review R11).
        rimColor: this.colourRims && this.options.silhouette === true ? playerColorTint(player.colour) : roleTint("skyLow"),
        // The story's rim is a full line, not a glint: it is how Frog, Oni and you are told apart at dawn (review 2, R3).
        thickness: this.colourRims && this.options.silhouette === true ? 2 : 1,
        rimStrength: this.colourRims && this.options.silhouette === true ? 1 : 0.9,
      }),
    ];
    // Drawn at the reference's own player size: square, as `player.rs:48`
    // draws it, and smaller than the collider. Stood on the collider's floor
    // rather than centred in it (see `stand`), so the feet meet the platform.
    sprite.width = PLAYER_SPRITE_SIZE;
    sprite.height = PLAYER_SPRITE_SIZE;
    // The body only, on both copies: the nameplate stays readable.
    if (this.options.silhouette === true) sprite.tint = this.silhouetteTintOf(player.colour);
    root.addChild(sprite);

    const tag = new NameTag(seat, player.colour);
    tag.setFontFamily(this.fontFamily);
    if (this.tagResolution !== undefined) tag.setResolution(this.tagResolution);
    tag.setName(player.name);
    tag.setSeatShown(this.seatNumbers);
    this.tags.addChild(tag.root);
    return { root, sprite, tag };
  }

  private create(player: PlayerSnapshot, index: number): PlayerDisplay {
    const scarf = player.colour;
    const root = new Container();
    root.label = player.id;

    const alias = this.options.sheetAliasFor?.(player.characterId, scarf) ?? `ninja.${scarf}`;
    const animations = this.sheetData(alias);
    // The grid is cut to the longest row the sheet declares, so a retimed or
    // re-drawn animation needs no edit here.
    const columns = Math.max(
      DEFAULT_FRAMES,
      ...ANIMATION_ROWS.map((name) => this.framesFor(name, animations)),
    );
    const frames = new FrameSheet(
      this.textures(alias),
      columns,
      ANIMATION_ROWS.length,
      FRAME.width,
      FRAME.height,
    );
    const near = this.figure(player, frames, root, index);
    const wrapped = this.figure(player, frames, new Container(), index);
    wrapped.root.label = `${player.id}-wrapped`;

    this.bodies.addChild(root, wrapped.root);
    const display: PlayerDisplay = {
      root,
      sprite: near.sprite,
      tag: near.tag,
      wrapped,
      scarf,
      seat: index,
      frames,
      ...(animations === undefined ? {} : { animations }),
      lastX: player.x,
      bodyAlpha: 1,
      silhouetteTint: this.silhouetteTintOf(player.colour),
      rival: false,
      // A display is born with no direction of travel: the pose for its first
      // frame comes from that frame's own `vy`, and there is no earlier one to
      // read a reversal against.
      travel: undefined,
      stillMs: this.restDwellMs,
      landMs: 0,
      held: false,
      animation: "idle",
      elapsedMs: 0,
      baseScale: { x: Math.abs(near.sprite.scale.x), y: Math.abs(near.sprite.scale.y) },
      squash: { x: 1, y: 1 },
      lean: 0,
    };
    this.displays.set(player.id, display);
    return display;
  }

  /** Holds a racer's pose for the slam's hit-stop, or releases it. Only ever the local racer (D-P5). */
  setHitStop(id: PlayerId, frozen: boolean): void {
    if (frozen) this.frozen = id;
    else if (this.frozen === id) this.frozen = undefined;
  }

  /** Sets a racer's squash for the next `apply`. A racer not drawn is ignored. */
  setSquash(id: PlayerId, x: number, y: number): void {
    const display = this.displays.get(id);
    if (display !== undefined) display.squash = { x, y };
  }

  /** Sets a racer's lean for the next `apply`: drawing only, never the hitbox. A racer not drawn is ignored. */
  setLean(id: PlayerId, radians: number): void {
    const display = this.displays.get(id);
    if (display !== undefined) display.lean = radians;
  }

  /** The animation a player's sprite is currently playing. */
  animationOf(id: PlayerId): AnimationName | undefined {
    return this.displays.get(id)?.animation;
  }

  /**
   * The manifest's cycle length for one animation.
   *
   * `animations` is the sheet's own table when a display has one; without it
   * the first scarf's sheet is consulted, which is what lets a test ask before
   * any player has been drawn.
   */
  durationFor(animation: AnimationName, animations = this.defaultAnimations()): number {
    return (
      animations?.[animation]?.durationMs ?? ANIMATION_FALLBACK[animation]?.durationMs ?? DEFAULT_DURATION_MS
    );
  }

  /** The manifest's frame count for one animation. */
  framesFor(animation: AnimationName, animations = this.defaultAnimations()): number {
    return animations?.[animation]?.frames ?? ANIMATION_FALLBACK[animation]?.frames ?? DEFAULT_FRAMES;
  }

  private defaultAnimations(): SheetAnimations | undefined {
    return this.sheetData(`ninja.${SEAT_SCARVES[0]}`);
  }

  /** The display objects for a player, for assertions and for the camera. */
  /** A CPU's mood word over its nameplate (CPU banding spec §4); placed and aged by `apply`. */
  showBark(playerId: PlayerId, text: string, colour: SeatColour): void {
    const display = this.displayFor(playerId);
    if (display === undefined) return;
    if (display.bark === undefined) {
      display.bark = new Bark();
      this.tags.addChild(display.bark.root);
    }
    display.bark.show(text, colour, this.fontFamily);
  }

  /** The body only: a flicker dims the racer and leaves its nameplate solid. */
  /** Whether the other racers are dimmed as rivals: yes in a race, no in the story, where they are friends at your side. */
  setDimRivals(on: boolean): void {
    this.dimRivals = on;
  }

  /** Whether the tags carry seat numbers: off in the story, where they read as places. */
  setSeatNumbers(on: boolean): void {
    this.seatNumbers = on;
    for (const display of this.displays.values()) for (const tag of [display.tag, display.wrapped.tag]) tag.setSeatShown(on);
  }

  private seatNumbers = true;

  /** Whether a silhouetted body's rim is its racer's colour (the story) rather than the sky's. Set before the racers are drawn. */
  setColourRims(on: boolean): void {
    this.colourRims = on;
  }

  private colourRims = false;

  /**
   * A silhouetted body: black in a race; in the story (colour rims on), its
   * racer's colour at `STORY_SILHOUETTE_SHADE` of its brightness, so each of
   * the three still reads against the dawn sky and reads as itself.
   */
  private silhouetteTintOf(colour: PlayerSnapshot["colour"]): number {
    if (!this.colourRims) return SILHOUETTE_TINT;
    const tint = playerColorTint(colour);
    const shade = (shift: number) => Math.round(((tint >> shift) & 0xff) * STORY_SILHOUETTE_SHADE) << shift;
    return shade(16) | shade(8) | shade(0);
  }

  /** Whether racers drawn together fold their tags into one "×N" chip: yes in a race, no in the story, where a count reads like a score. */
  setClusterChips(on: boolean): void {
    this.clusterChips = on;
  }

  private clusterChips = true;

  private dimRivals = true;

  setBodyAlpha(playerId: PlayerId, alpha: number): void {
    const display = this.displayFor(playerId);
    if (display === undefined) return;
    display.bodyAlpha = alpha;
    this.paintBody(display);
  }

  /** The body's alpha and tint, on both copies: its flicker, dimmed for a rival. */
  private paintBody(display: PlayerDisplay): void {
    const dimmed = display.rival && !fullColourRivals();
    const alpha = display.bodyAlpha * (dimmed ? RIVAL_BODY_ALPHA : 1);
    const tint = this.options.silhouette === true ? display.silhouetteTint : dimmed ? RIVAL_BODY_TINT : 0xffffff;
    for (const sprite of [display.sprite, display.wrapped.sprite]) {
      sprite.alpha = alpha;
      sprite.tint = tint;
    }
  }

  displayFor(id: PlayerId): PlayerDisplay | undefined {
    return this.displays.get(id);
  }

  get count(): number {
    return this.displays.size;
  }

  /** Tears down one display and the sheet it owns, in that order. */
  /**
   * Whether a racer is pinned under a floor or against its side.
   *
   * Ceiling wins a tie. A player rising into the underside of a floor and
   * steering sideways is touching both faces at once, and of the two the one
   * that explains why they are not going anywhere is the ceiling.
   */
  private gripOf(
    x: number,
    y: number,
    floors: readonly { x: number; y: number }[],
  ): "wall" | "ceiling" | undefined {
    const reachX = (this.tuning.FLOOR_WIDTH + this.tuning.PLAYER_WIDTH) / 2;
    const reachY = (this.tuning.FLOOR_HEIGHT + this.tuning.PLAYER_HEIGHT) / 2;
    let wall: "wall" | undefined;

    for (const floor of floors) {
      const dx = Math.abs(x - floor.x);
      const dy = Math.abs(y - floor.y);
      if (dx > reachX + GRIP_SLACK || dy > reachY + GRIP_SLACK) continue;

      // Under the floor, roughly beneath its span: a ceiling.
      if (y < floor.y && dx < reachX - GRIP_SLACK && dy >= reachY - GRIP_SLACK) {
        return "ceiling";
      }
      // Beside it, at a height where the body overlaps its face: a wall.
      if (dx >= reachX - GRIP_SLACK && dy < reachY - GRIP_SLACK) wall = "wall";
    }
    return wall;
  }

  /**
   * Whether a racer is sitting flush on top of a floor, within its span.
   *
   * The same reach as `gripOf`, measured on the other face.
   */
  private standsOn(x: number, y: number, floors: readonly { x: number; y: number }[]): boolean {
    const reachX = (this.tuning.FLOOR_WIDTH + this.tuning.PLAYER_WIDTH) / 2;
    const reachY = (this.tuning.FLOOR_HEIGHT + this.tuning.PLAYER_HEIGHT) / 2;
    return floors.some(
      (floor) =>
        y > floor.y &&
        Math.abs(x - floor.x) < reachX - GRIP_SLACK &&
        Math.abs(y - floor.y - reachY) <= GRIP_SLACK,
    );
  }

  /**
   * Stands a sprite on the bottom of the collider, or hangs it from the top.
   *
   * The sprite is smaller than the collision ball, so centring it -- as the
   * reference does -- left the feet four and a half units above the floor the
   * ball was resting on: every racer looked like it was hovering. The sheet
   * stands its poses on the frame's last row, so anchoring that row to the
   * ball's bottom puts the feet on the platform. A ceiling grip is the mirror:
   * its hands are on the frame's first row and meet the underside of a floor.
   */
  private stand(sprite: Sprite, animation: AnimationName): void {
    const hang = animation === "ceiling";
    const half = this.tuning.PLAYER_HEIGHT / 2;
    sprite.anchor.set(0.5, hang ? 0 : 1);
    sprite.y = hang ? -half : half;
  }

  private release(display: PlayerDisplay): void {
    display.bark?.root.destroy();
    display.tag.root.destroy({ children: true });
    display.wrapped.tag.root.destroy({ children: true });
    // The sprite goes first: destroying its frames while it still references
    // one would leave a live sprite pointing at a destroyed texture.
    display.root.destroy({ children: true });
    display.wrapped.root.destroy({ children: true });
    display.frames.destroy();
  }

  destroy(): void {
    for (const display of this.displays.values()) display.frames.destroy();
    this.root.destroy({ children: true });
    this.displays.clear();
  }
}
