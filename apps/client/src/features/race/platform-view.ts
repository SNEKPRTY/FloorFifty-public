/**
 * Platform rendering.
 *
 * Reconciles sprites against the platform list in a snapshot, addressed by the
 * floor id the server sent, writing only their transform. An endless course's
 * window moves up the climb, so a floor that leaves returns its sprite and bar
 * to a pool, and the next floor to enter takes them. Rebuilding the display
 * list every frame would throw away batching and make a moving floor flicker.
 */

import { Container, Graphics, Sprite } from "pixi.js";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { PlatformSnapshot } from "@floor-fifty/shared/common/protocol";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { FrameSheet, type TextureProvider } from "../render/textures";

/** The platform sheet's frame size, fixed by the art contract. */
const FRAME = { width: 128, height: 32 } as const;

/** `platform_indicators.rs:41`: the bar is a little wider than the platform. */
export const INDICATOR_WIDTH_SCALE = 1.1;
/** `platform_indicators.rs:41`. */
const INDICATOR_HEIGHT_DIVISOR = 6;
/** `platform_indicators.rs:46`: it sits just under the platform. */
const INDICATOR_OFFSET_DIVISOR = 1.5;
/**
 * `platform_indicators.rs:112`: `Color::ORANGE_RED`.
 *
 * The role rather than the reference's literal. Resurrect 64 has no pure
 * orange-red, and an approximated one would be an authored colour -- the single
 * thing the palette contract forbids.
 */
const UNCOLLECTED = roleTint("floorPending");
/**
 * `platform_indicators.rs:109`: `Color::GREEN`.
 *
 * Both states are roles of their own rather than borrowed ones. This bar
 * earlier drew its taken state in `platformTop` -- the colour of the floor face
 * directly above it -- and its pending state in `cityWindow`. Under a high-key
 * sky both were within a couple of dozen of luma of what surrounded them, and
 * the one mark that reports a lap's progress read as a smudge. `roles.ts`
 * records what each swatch now has to clear, and `palette.test.ts` pins it.
 */
const COLLECTED = roleTint("floorTaken");
/**
 * A missed floor below the attention threshold; descent can recover its credit.
 */
const MISSED = roleTint("floorStranded");

/**
 * The compact status mark drawn under the bar, in logical units.
 *
 * A check for a floor this player has taken, a hollow for one they still owe,
 * and a downward arrow for a missed floor the racer can recover.
 */
const MARK = { checkWidth: 7, checkHeight: 5, hollowWidth: 6, hollowHeight: 4, arrowSize: 6, gap: 2 } as const;

/** A platform's art and the progress bar drawn under it. */
/** A silhouetted stage's play layer: black, which the composite's palette lock lands on its darkest swatch. */
export const SILHOUETTE_TINT = 0x000000;

export type PlatformIndicatorState = "uncollected" | "collected" | "missed";

/**
 * A floor's sprite and bar, and the state the bar was last drawn in.
 *
 * `drawn` is undefined while the bar is empty: new, or cleared on its way back
 * to the pool. `apply` runs every frame, and a Graphics that is cleared and
 * redrawn is re-triangulated and its geometry uploaded again, so the bar is
 * redrawn only when its floor changes state.
 */
type PlatformEntry = { sprite: Sprite; indicator: Graphics; drawn: PlatformIndicatorState | undefined };

export class PlatformView {
  readonly root = new Container();
  private readonly indicators = new Container({ label: "platform-indicators" });
  private readonly sprites = new Container({ label: "platform-sprites" });
  /** Vertical swell from the beat, applied to every slab at once. */
  private swellScale = 1;
  private readonly entries = new Map<string, PlatformEntry>();
  /** A floor's sprite and bar, hidden, waiting for the next floor to enter. */
  private readonly pool: PlatformEntry[] = [];
  /** Sprites made since construction; the pool keeps this at a window's worth. */
  created = 0;
  /**
   * The platform cell, cut once.
   *
   * Every floor draws the same image, so one cut is shared by all of them. A
   * cut per floor would cost a texture and a source listener each, and a race
   * that ends and restarts would leave the previous course's behind.
   */
  private readonly frames: FrameSheet;

  /**
   * Sets the beat swell every slab is drawn with.
   *
   * On the whole layer rather than per platform, because every floor is struck
   * by the same music: staggering them would read as the platforms disagreeing
   * about the tempo. Vertical only -- a slab that widened would change where
   * its edges appear to be, and its edges are what a player is aiming at.
   */
  setSwell(scale: number): void {
    this.swellScale = scale;
  }

  /** The swell the slabs are currently drawn with. */
  get swell(): number {
    return this.swellScale;
  }

  constructor(
    private readonly textures: TextureProvider,
    private readonly tuning: ResolvedTuning,
    // `platformAlias` is the stage's own slab (`StageContent.platformAlias`);
    // Rooftops' where none is given.
    private readonly options: { silhouette?: boolean; platformAlias?: string } = {},
  ) {
    this.root.label = "platforms";
    this.root.addChild(this.indicators, this.sprites);
    this.frames = new FrameSheet(
      this.textures(this.options.platformAlias ?? "world.platform"),
      1,
      1,
      FRAME.width,
      FRAME.height,
    );
  }

  /** A new ascent can warn again even when its first view begins above a miss. */
  resetAscent(): void {
    for (const entry of this.entries.values()) if (entry.drawn === "missed") entry.drawn = undefined;
  }

  get hasMissedFloor(): boolean {
    return [...this.entries.values()].some((entry) => entry.drawn === "missed");
  }

  /**
   * Writes a snapshot's platform positions and collected state onto the display list.
   * Returns true if any platform transitioned to missed on this update.
   */
  apply(
    platforms: readonly PlatformSnapshot[],
    localId: PlayerId | undefined,
    playerYOrOptions?: number | { playerY?: number | undefined; isFinite?: boolean | undefined } | undefined,
    isFiniteCourse = true,
  ): boolean {
    let newlyMissed = false;
    let playerY: number | undefined;
    let isFinite = isFiniteCourse;
    if (typeof playerYOrOptions === "number") {
      playerY = playerYOrOptions;
    } else if (typeof playerYOrOptions === "object" && playerYOrOptions !== null) {
      playerY = playerYOrOptions.playerY;
      isFinite = playerYOrOptions.isFinite ?? true;
    }

    const seen = new Set<string>();
    for (const platform of platforms) seen.add(platform.id);

    // A floor gone from the snapshot -- a new course, or an endless window
    // that moved on -- hands its sprite and bar back to the pool, before the
    // floors that enter take them, so the pool stays at a window's worth.
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      entry.sprite.visible = false;
      entry.indicator.clear();
      entry.drawn = undefined;
      entry.indicator.visible = false;
      this.pool.push(entry);
      this.entries.delete(id);

    }

    for (const platform of platforms) {
      const entry = this.entries.get(platform.id) ?? this.create(platform.id);
      // The beat swell thickens a slab downward, never upward.
      const grown = this.tuning.FLOOR_HEIGHT * this.swellScale;
      const sink = (grown - this.tuning.FLOOR_HEIGHT) / 2;
      entry.sprite.height = grown;
      entry.sprite.position.set(platform.x, -platform.y + sink);

      // The indicator is the local player's own progress, so it is read
      // against this client's id rather than broadcast per recipient. An
      // undefined id — before the first join resolves — reads as uncollected.
      const collected = localId !== undefined && platform.collectedBy.includes(localId);
      const missed = !collected && localId !== undefined && isFinite && playerY !== undefined && playerY - platform.y > this.tuning.FLOOR_GAP_MAX;
      const state: PlatformIndicatorState = collected ? "collected" : missed ? "missed" : "uncollected";
      if (missed && entry.drawn !== "missed") newlyMissed = true;

      if (entry.drawn !== state) this.drawIndicator(entry, state);
      // Logical y points up and the world container draws it negated, so
      // subtracting before the flip puts the bar below the platform.
      entry.indicator.position.set(
        platform.x,
        -(platform.y - this.tuning.FLOOR_HEIGHT / INDICATOR_OFFSET_DIVISOR),
      );
    }
    return newlyMissed;
  }

  /** Draws a floor's bar and its mark in one state. */
  private drawIndicator(entry: PlatformEntry, state: PlatformIndicatorState): void {
    entry.drawn = state;
    const width = this.tuning.FLOOR_WIDTH * INDICATOR_WIDTH_SCALE;
    const height = this.tuning.FLOOR_HEIGHT / INDICATOR_HEIGHT_DIVISOR;
    const fillTint = state === "collected" ? COLLECTED : state === "missed" ? MISSED : UNCOLLECTED;
    entry.indicator
      .clear()
      .rect(-width / 2, -height / 2, width, height)
      .fill(fillTint);

    // The slab is always usable; the recovery arrow conveys the missed credit.
    entry.sprite.tint = this.options.silhouette === true ? SILHOUETTE_TINT : 0xffffff;

    // The second channel, under the bar and still outside the slab.
    const markTop = height / 2 + MARK.gap;
    if (state === "collected") {
      entry.indicator
        .moveTo(-MARK.checkWidth / 2, markTop + MARK.checkHeight / 2)
        .lineTo(-1, markTop + MARK.checkHeight)
        .lineTo(MARK.checkWidth / 2, markTop)
        .stroke({ width: 1, color: COLLECTED });
    } else if (state === "missed") {
      const half = MARK.arrowSize / 2;
      entry.indicator
        .moveTo(0, markTop)
        .lineTo(0, markTop + MARK.arrowSize)
        .moveTo(-half, markTop + half)
        .lineTo(0, markTop + MARK.arrowSize)
        .lineTo(half, markTop + half)
        .stroke({ width: 1, color: MISSED });
    } else {
      // Hollow, and nothing inside it: an unfilled shape is legible as "not
      // yet" at a size where a filled one would be a smudge of the same
      // colour as the bar above it.
      entry.indicator
        .rect(-MARK.hollowWidth / 2, markTop, MARK.hollowWidth, MARK.hollowHeight)
        .stroke({ width: 1, color: UNCOLLECTED });
    }
  }

  private create(id: string): PlatformEntry {
    const pooled = this.pool.pop();
    if (pooled !== undefined) {
      // Re-added to their batch layers, indicator first under sprite.
      this.indicators.addChild(pooled.indicator);
      this.sprites.addChild(pooled.sprite);
      pooled.indicator.label = `${id}-indicator`;
      pooled.indicator.visible = true;
      pooled.sprite.label = id;
      pooled.sprite.visible = true;
      this.entries.set(id, pooled);
      return pooled;
    }
    this.created += 1;
    // Indicators and sprites live in separate containers to avoid breaking
    // the WebGL batcher between every platform's indicator and slab.
    const indicator = new Graphics();
    indicator.label = `${id}-indicator`;
    indicator.cullable = true;
    this.indicators.addChild(indicator);

    const sprite = new Sprite(this.frames.frame(0, 0));
    sprite.label = id;
    sprite.cullable = true;
    sprite.anchor.set(0.5);
    // The art is drawn at the sheet's frame size and scaled to the collision
    // box, so the sprite a player aims at is the box the server resolves.
    sprite.width = this.tuning.FLOOR_WIDTH;
    sprite.height = this.tuning.FLOOR_HEIGHT;
    // The floor only: its marker carries meaning, so it keeps its colour.
    if (this.options.silhouette === true) sprite.tint = SILHOUETTE_TINT;
    this.sprites.addChild(sprite);


    const entry: PlatformEntry = { sprite, indicator, drawn: undefined };
    this.entries.set(id, entry);
    return entry;
  }

  get count(): number {
    return this.entries.size;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.frames.destroy();
    this.entries.clear();
    this.pool.length = 0;
  }
}
