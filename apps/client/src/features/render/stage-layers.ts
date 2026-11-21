/**
 * The stage's scenery layers.
 *
 * Everything behind the play field: the stage's layer list (`theme.layers`),
 * drawn back to front, and its sun or moon. It owns two roots -- the sky and
 * the city -- the parallax those layers move on, and the cosmetic motion the
 * stage authors: a horizon lift and an ascent arc that follow the climb, and
 * each layer's own drift.
 *
 * Extracted from `GameplayView` when the file that composed platforms and
 * racers was also the file that knew how far away a water tower was. The view
 * keeps what it draws; this keeps what is behind it.
 *
 * Three rules hold here, and each is a way a scenery layer goes wrong:
 *
 * 1. **Every layer is behind everything playable.** Nothing in this container
 *    is a surface, a lip or a ledge, and nothing is drawn in front of a racer.
 * 2. **A missing texture skips its layer and nothing else.** "Optional" is a
 *    statement about the art: a theme with no middle skyline draws the other
 *    six layers rather than failing.
 * 3. **The composition resets with the race.** The lift eases toward a value
 *    derived from authoritative progress, so a reset or a second lap returns to
 *    the same transforms rather than accumulating an offset.
 *
 * The two roots exist because the two halves are drawn differently (launch
 * polish spec, phase 1). The **sky** -- the sun and the clouds, or a stage's
 * own painted sky plate in their place -- is an optical plate: bounded,
 * refracted and linearly upscaled. The **city** -- every
 * skyline, its windows and the rooftop props -- is crisp: drawn at device
 * resolution with no blur. A filter on a container reaches all of its
 * children, so one shared root could not be both.
 */

import { Container, Rectangle, Sprite, Texture, TilingSprite } from "pixi.js";
import { LOGICAL_VIEWPORT } from "../../lib/constants";
import { loadedTextures, type TextureProvider } from "./textures";
import { hazedTexture } from "./haze";
import type { StageMotion } from "./stage-reactor";
import { windowCodedTexture } from "./window-code";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import {
  citySinkAt,
  type ResolvedLayer,
  type StagePresentation,
} from "./stage-presentation";
import {
  SUN_SHIMMER_REACH,
  createSunShimmerFilter,
  setSunShimmerPadding,
  setSunShimmerTime,
  type SunShimmerFilter,
} from "./filters/sun-shimmer";

/** How the scenery is framed on this canvas; see `StageLayers.update`. */
export type StageFraming = Readonly<{
  /** Device pixels per unit of this container; city layers snap to them. */
  pixelsPerUnit?: number;
  /**
   * The highest a city layer's top may start, in this container's units at
   * the start of the climb. Portrait sets it so the city holds the lower third
   * of the canvas and the sky the rest (launch polish spec 2.5).
   */
  cityTopMin?: number | undefined;
}>;

/** Bakes a hazed copy of a skyline's texture; see `haze.ts`. Injectable for tests. */
export type Hazer = (texture: Texture, amount: number) => Texture | undefined;

/** Bakes window codes into a city plate; see `window-code.ts`. Injectable for tests. */
export type WindowCoder = (texture: Texture) => Texture | undefined;

const codeCityWindows: WindowCoder = (texture) => windowCodedTexture(texture, roleTint("cityWindow"));

/**
 * The sun's drawn size against its 256-pixel plate. About a seventh of the
 * field's width: at full size, with the camera's zoom, it was a wall of light.
 */
const SUN_SCALE = 0.55;

/** How slowly the sun drifts against the camera. Nearly, but not quite, fixed. */
const SUN_PARALLAX = 0.06;

/**
 * How far a city skirt hangs below its strip, in logical units.
 *
 * Generous rather than measured: the backdrop is deliberately unclipped and its
 * visible height depends on the viewport's aspect, so there is no one number to
 * compute. This covers a 9:21 phone with room to spare, and costs one sprite
 * per layer that the GPU clips to the frame anyway.
 */
const SKIRT_HEIGHT = 4000;

/**
 * The share of the camera's vertical motion the city keeps (spec §2.8 item
 * 11). Enough that a bounce still moves the skyline against the platforms, so
 * the depth reads; the arc carries the rest.
 */
export const CITY_CAMERA_COUPLING = 0.15;

export { NEAR_CITY_FACTOR } from "./stage-presentation";

/** How long the lift takes to ease to a new value, in seconds. */
export const HORIZON_LIFT_SECONDS = 0.4;

/**
 * How many of a sky plate's edge rows repeat beyond it: two periods of the
 * converter's 4 x 4 stipple in 2-pixel cells, so the repeat keeps its pattern.
 */
const SKY_BAND_ROWS = 16;

type Layer = {
  readonly label: string;
  readonly factor: number;
  /** A strip; or, for a stage's own sky plate, one untiled sprite. */
  readonly sprite: TilingSprite | Sprite;
  readonly sink: number;
  readonly skirt: Sprite | TilingSprite | undefined;
  /** A sky plate's top band, continued upward; see `addSkyPlate`. */
  readonly skirtAbove?: TilingSprite | undefined;
  /**
   * The layer's share of the ascent arc's sink: 1 for the near skyline, which
   * the arc's authored values describe, and in proportion for the others.
   */
  readonly arc: number;
  /** How fast the layer drifts with ambient time; zero holds it still. */
  readonly drift: number;
  readonly plate: "sky" | "city";
};

export class StageLayers {
  /**
   * The sun and the clouds: the optical plate. Rendered only into the bounded
   * backdrop target, where it is refracted. Parented by the backdrop controller.
   */
  readonly skyRoot = new Container();
  /**
   * Every skyline, its windows and the rooftop props, in depth order: the crisp
   * stack. Drawn above the sky plate's output and never refracted.
   */
  readonly cityRoot = new Container();

  private readonly layers: Layer[] = [];
  /** Hazed copies baked at mount. Owned here, unlike the provider's textures. */
  private readonly hazed: Texture[] = [];
  private sun: Sprite | undefined;
  /** The heat shimmer on the sun; owned here, absent where it will not build. */
  private sunShimmer: SunShimmerFilter | undefined;
  private lift = 0;
  /** How far the city has fallen away below the climb; eased like the lift. */
  private sink = 0;
  /** Whether every city plate that was drawn carries window codes. */
  private coded = true;

  constructor(
    private readonly presentation: StagePresentation,
    private readonly textures: TextureProvider = loadedTextures,
    private readonly haze: Hazer = hazedTexture,
    private readonly codeWindows: WindowCoder = codeCityWindows,
  ) {
    this.skyRoot.label = "stage-sky";
    this.cityRoot.label = "stage-city";

    // The list is the depth order (the content compiler enforces it per
    // plate), so it is drawn as written: a sky plate first, the light next so
    // it rises behind the city, then everything else. Ties keep list order, so
    // windows stay in front of the building they belong to. The plate is the
    // first *sky* layer, wherever the city layers fall around it (the schema's
    // rule): led with, so the light never draws under an opaque picture.
    const plate = this.presentation.layers.find((layer) => layer.plate === "sky");
    const leading = plate?.extend === "plate" ? plate : undefined;
    if (leading !== undefined) this.addSkyPlate(leading);
    this.addLight();
    for (const layer of this.presentation.layers) {
      if (layer === leading) continue;
      if (layer.extend === "plate") this.addSkyPlate(layer);
      else this.add(layer);
    }
  }

  /**
   * The sun, or the moon, behind every skyline.
   *
   * A stage's own sky plate is the furthest thing of all, so this follows it.
   * A plate that carries its own sun names no light (the Dawn story chapter's does
   * not). The light comes before the skylines so it rises behind the city
   * rather than glowing in front of it.
   */
  private addLight(): void {
    const { lightAlias } = this.presentation;
    const sunTexture = lightAlias === undefined ? Texture.EMPTY : this.textures(lightAlias);
    if (sunTexture !== Texture.EMPTY && lightAlias !== undefined) {
      const sun = new Sprite(sunTexture);
      sun.label = lightAlias;
      sun.anchor.set(0.5, 0.5);
      sun.scale.set(SUN_SCALE);
      sun.position.set(0, -this.presentation.lightHeight);
      this.skyRoot.addChild(sun);
      this.sun = sun;
      // Heat shimmer is a sun's; a stage whose light is cold (a moon) says so.
      if (this.presentation.lightShimmer) {
        try {
          this.sunShimmer = createSunShimmerFilter();
          sun.filters = [this.sunShimmer];
        } catch {
          // A still sun is a quieter picture, not a broken one.
        }
      }
    }
  }

  /**
   * The stage's own full-frame sky, first in the sky root.
   *
   * One picture at the frame's width. Not wider: it is a composition, not a
   * strip, and at twice the width the frame showed only its middle quarter --
   * the sun's glow, zoomed. It does not tile or drift; it moves on the sky's
   * factor, so it stays behind everything and is refracted with the rest of
   * the sky.
   *
   * Its top and bottom bands are repeated outward, because a tall phone sees
   * far more sky than a 3:2 plate holds. Repeated rather than stretched like a
   * skyline's last row: the plate is stippled, and one stippled row stretched
   * is a field of vertical streaks. The top of the source is flat violet and
   * its foot flat fog, so a band of either repeats cleanly.
   */
  private addSkyPlate(layer: ResolvedLayer): void {
    const { alias } = layer;
    const texture = this.textures(alias);
    if (texture === Texture.EMPTY) return;
    const plate = new Sprite(texture);
    plate.label = alias;
    // Bottom-anchored like the strips, so its skirt hangs from its position.
    plate.anchor.set(0.5, 1);
    plate.width = LOGICAL_VIEWPORT.width;
    plate.height = plate.width * (texture.height / texture.width);
    this.skyRoot.addChild(plate);
    const skirt = this.buildSkyBand(alias, texture, plate.width, "below");
    const skirtAbove = this.buildSkyBand(alias, texture, plate.width, "above");
    this.layers.push({
      label: alias,
      factor: layer.depth,
      sprite: plate,
      sink: layer.sink,
      skirt,
      skirtAbove,
      arc: 0,
      drift: 0,
      plate: "sky",
    });
  }

  /** A sky plate's edge band, repeated outward from that edge at the plate's scale. */
  private buildSkyBand(
    alias: string,
    texture: Texture,
    width: number,
    edge: "above" | "below",
  ): TilingSprite | undefined {
    if (texture.source === undefined) return undefined;
    const rows = Math.min(SKY_BAND_ROWS, texture.frame.height);
    const band = new Texture({
      source: texture.source,
      frame: new Rectangle(
        texture.frame.x,
        edge === "above" ? texture.frame.y : texture.frame.y + texture.frame.height - rows,
        texture.frame.width,
        rows,
      ),
    });
    const skirt = new TilingSprite({ texture: band, width, height: SKIRT_HEIGHT });
    skirt.label = edge === "above" ? `${alias}.skirtAbove` : `${alias}.skirt`;
    const scale = width / texture.frame.width;
    skirt.tileScale.set(scale, scale);
    // Above stands on the plate's top edge; below hangs from its foot. The
    // pattern is anchored at the edge it continues, so the seam lines up.
    skirt.anchor.set(0.5, edge === "above" ? 1 : 0);
    if (edge === "above") skirt.tilePosition.y = SKIRT_HEIGHT;
    this.skyRoot.addChild(skirt);
    return skirt;
  }

  private add(layer: ResolvedLayer): void {
    const provided = this.textures(layer.alias);
    // A layer whose art did not arrive is skipped, and only that layer: the
    // alternative is a blank frame where the scenery should be, which reads as
    // a broken build rather than as a stage with less to look at.
    if (provided === Texture.EMPTY) return;

    // A skyline is hazed toward the sky by its authored amount, baked once
    // here. Where nothing is authored, or the pixels cannot be read, the art is
    // drawn as it arrived.
    const amount = layer.haze;
    const hazed = amount > 0 ? this.haze(provided, amount) : undefined;
    if (hazed !== undefined) this.hazed.push(hazed);
    let texture = hazed ?? provided;

    // Every city plate is window-coded, so each lit window can keep its own
    // brightness as it scrolls (`window-code.ts`). A plate with no windows
    // simply comes back unchanged. One that cannot be read leaves the whole
    // city on the positional fallback, because the shader reads one flag.
    if (layer.plate === "city") {
      const coded = this.codeWindows(texture);
      if (coded === undefined) {
        this.coded = false;
      } else {
        this.hazed.push(coded);
        texture = coded;
      }
    }

    // The city is the crisp stack: nearest, whatever the texture arrived as.
    // Set on the source, which the strip and its skirt share.
    if (layer.plate === "city") texture.source.scaleMode = "nearest";

    // As tall as the art it stands for; a tiled layer runs on below it.
    const tiling = layer.extend === "tile";
    const sprite = new TilingSprite({
      texture,
      width: LOGICAL_VIEWPORT.width * 2,
      height: tiling ? provided.height + SKIRT_HEIGHT : provided.height,
    });
    sprite.label = layer.alias;
    sprite.anchor.set(0.5, 1);
    const root = layer.plate === "sky" ? this.skyRoot : this.cityRoot;
    root.addChild(sprite);

    // Added after its strip, which is only safe because the skirt hangs below
    // the strip's bottom edge and the two never overlap.
    const skirt =
      layer.extend === "skirt" ? this.buildSkirt(root, layer.alias, texture) : undefined;

    this.layers.push({
      label: layer.alias,
      factor: layer.depth,
      sprite,
      sink: tiling ? layer.sink + SKIRT_HEIGHT : layer.sink,
      skirt,
      drift: layer.drift,
      arc: layer.arc,
      plate: layer.plate,
    });
  }

  /**
   * Continues a city strip below its own bottom edge.
   *
   * The strips are fixed-height sprites, and on a tall viewport the backdrop is
   * taller than any of them: the strip simply ran out, and the sky filter --
   * which paints wherever nothing has been drawn -- filled the gap with a band
   * of dithered sky under the skyline. On a 16:9 desktop it never showed, so it
   * shipped.
   *
   * Tiling the strip vertically is not the fix: it would repeat the rooftops
   * partway down and put a second skyline in the middle of a building. Instead
   * this stretches the strip's *last row* downward. That is seamless by
   * construction, because every tower's edges run straight down from the
   * midpoint of the art -- the bottom row and the middle row have the same
   * columns of body, alley and outline, so the alleys between towers continue
   * as alleys rather than being filled in.
   *
   * Which is also why `generate-rooftop-details.ts` is required to run every
   * tower to the plate's last row: a skirt over art that stopped short would
   * stretch an empty row.
   */
  private buildSkirt(root: Container, alias: string, texture: Texture): Sprite | undefined {
    if (texture === Texture.EMPTY || texture.source === undefined) return undefined;

    const lastRow = new Texture({
      source: texture.source,
      frame: new Rectangle(0, texture.frame.y + texture.frame.height - 1, texture.frame.width, 1),
    });

    const skirt = new Sprite(lastRow);
    skirt.label = `${alias}.skirt`;
    // Top-anchored, so it hangs from wherever the strip's bottom edge is.
    skirt.anchor.set(0.5, 0);
    skirt.width = LOGICAL_VIEWPORT.width * 2;
    skirt.height = SKIRT_HEIGHT;
    root.addChild(skirt);
    return skirt;
  }

  /** Whether the city's windows carry codes the atmosphere shader can read. */
  get windowsCoded(): boolean {
    return this.coded && this.layers.some((layer) => layer.plate === "city");
  }

  /** The layers actually drawn, in depth order. For lifecycle assertions. */
  get labels(): readonly string[] {
    return this.layers.map((layer) => layer.label);
  }

  /**
   * How the city's textures are sampled: `nearest` only if every city layer
   * and skirt is. One linear texture is enough to soften a skyline, so the
   * answer is the worst case rather than the common one.
   */
  get citySampling(): "nearest" | "linear" {
    // Strips are tiling sprites and skirts are sprites; both carry a texture.
    const drawn = this.cityRoot.children.filter(
      (child): child is Sprite | TilingSprite =>
        child instanceof Sprite || child instanceof TilingSprite,
    );
    return drawn.every((sprite) => sprite.texture.source.scaleMode === "nearest")
      ? "nearest"
      : "linear";
  }

  /** The parallax factor of each drawn layer, in the same order. */
  get factors(): readonly number[] {
    return this.layers.map((layer) => layer.factor);
  }

  /** How far each layer's set-piece sweeps have carried it, in units (Wonder spec §6.4). */
  private readonly sweeps = new Map<string, number>();

  /** Adds a sweep's distance this frame to what it has carried a layer, and returns the total. */
  private swept(label: string, speed: number, deltaMs: number): number {
    const carried = (this.sweeps.get(label) ?? 0) + (speed * deltaMs) / 1_000;
    if (carried !== 0) this.sweeps.set(label, carried);
    return carried;
  }

  /**
   * Positions every layer for a camera at `cameraY`.
   *
   * `progress` is authority's, read off the snapshot and never derived here.
   * `timeSeconds` comes from the ambient clock, so the drift stops while a tab
   * is hidden and freezes under reduced motion along with everything else.
   *
   * `framing.pixelsPerUnit` is how many device pixels one of this container's
   * units covers. City layers are rounded to whole device pixels at it, because
   * a nearest-sampled strip at a fractional offset repeats or drops a texel row
   * wherever the rounding falls. The sky is not rounded: it is soft by design,
   * and its drift is meant to be continuous.
   *
   * `framing.cityTopMin` sinks the whole city, by one shift, until no layer's
   * top starts above it at the start of the climb. Measured at the start rather
   * than per frame, so the city still falls away with parallax as the camera
   * climbs instead of being pinned to the line.
   */
  update(
    cameraY: number,
    progress: number,
    timeSeconds: number,
    deltaMs: number,
    reducedMotion: boolean,
    framing: StageFraming = {},
    motion?: StageMotion,
  ): void {
    const pixelsPerUnit = framing.pixelsPerUnit ?? 1;
    // The stage's answer to the song and the race (Wonder spec §6.2–6.3): the
    // bob scaled by depth, the jolt on the nearest strips only, the surge and
    // a set piece's sweep added to a drifting layer's offset, never its speed.
    const nearest = this.layers.reduce((most, layer) => (layer.plate === "city" ? Math.max(most, layer.factor) : most), 0);
    const framingSink = this.framingSink(framing.cityTopMin);
    const snap = (value: number): number =>
      pixelsPerUnit > 0 ? Math.round(value * pixelsPerUnit) / pixelsPerUnit : value;
    this.advanceLift(progress, deltaMs, reducedMotion);

    for (const layer of this.layers) {
      // `sink` keeps a roofline where it was while the building bodies below it
      // grew. The sprites are bottom-anchored, so a taller strip would
      // otherwise have pushed the rooftops up rather than extended the city
      // down -- which is the opposite of the point.
      if (layer.plate === "city") {
        // The ascent arc, not the camera, decides where the city stands (spec
        // §2.8 item 11). The root follows the camera, so this undoes that,
        // keeps a small share of it so a bounce still reads as depth, and lets
        // the arc drop each layer in proportion to how near it is. Under the
        // camera alone the city had left the frame by the second phrase.
        layer.sprite.position.y =
          -cameraY + cameraY * layer.factor * CITY_CAMERA_COUPLING + layer.sink + this.sink * layer.arc + framingSink;
      } else {
        layer.sprite.position.y = -cameraY * (1 - layer.factor) + layer.sink;
        // A sky plate stands its foot down with the city on a tall portrait
        // canvas. Left behind, its flat foot band repeats down the gap the
        // city's sink opens -- a plain strip between horizon and skyline (Snow
        // Shrine's white one). Lowered by the same one shift, its horizon stays
        // on the skylines as it does on a landscape screen.
        if (!(layer.sprite instanceof TilingSprite)) layer.sprite.position.y += framingSink;
      }
      // The lift moves the whole composition and never the camera or the world:
      // it is a change to the scenery's framing, not to where a player is.
      layer.sprite.position.y += this.lift;
      if (motion !== undefined && layer.plate === "city" && nearest > 0) {
        layer.sprite.position.y += Math.round((motion.bob * layer.factor) / nearest);
        if (layer.factor === nearest) layer.sprite.position.y += Math.round(motion.jolt);
      }
      // A stage's own sky plate is one untiled picture: it only rises and
      // falls, and its skirts go with it.
      if (!(layer.sprite instanceof TilingSprite)) {
        if (layer.skirt !== undefined) layer.skirt.position.y = layer.sprite.position.y;
        if (layer.skirtAbove !== undefined) {
          layer.skirtAbove.position.y = layer.sprite.position.y - layer.sprite.height;
        }
        continue;
      }
      layer.sprite.tilePosition.x = cameraY * layer.factor * 0.2;
      if (layer.drift > 0) {
        // A tiled wrap, so the drift is seamless: the texture repeats rather
        // than running out, and the offset is monotonic in ambient time, which
        // is what stops a clock that only ever goes forward from crawling
        // backwards when it is clamped.
        layer.sprite.tilePosition.x += timeSeconds * layer.drift;
        if (motion !== undefined) layer.sprite.tilePosition.x += motion.surge * layer.drift;
      }
      // A sweep's distance is kept once it ends, so the layer never jumps back.
      layer.sprite.tilePosition.x += this.swept(layer.sprite.label, motion?.swarm?.get(layer.sprite.label) ?? 0, deltaMs);
      // Snapped after the drift, so a drifting city layer (Snow Shrine's near
      // snow) lands on whole device pixels like every other crisp strip.
      if (layer.plate === "city") {
        layer.sprite.position.y = snap(layer.sprite.position.y);
        layer.sprite.tilePosition.x = snap(layer.sprite.tilePosition.x);
      }

      // The skirt hangs from the strip's bottom edge, which is exactly where a
      // bottom-anchored sprite's position sits.
      if (layer.skirt !== undefined) {
        layer.skirt.position.y = layer.sprite.position.y;
      }
    }

    if (this.sun !== undefined) {
      this.sun.position.y = -this.presentation.lightHeight - cameraY * (1 - SUN_PARALLAX) + this.lift;
    }
    // Ambient time, which holds still under reduced motion, so the shimmer does.
    if (this.sunShimmer !== undefined && this.sun !== undefined) {
      setSunShimmerTime(this.sunShimmer, timeSeconds);
      // The heat wisps reach out past the disc, so the pass is padded for them
      // at the size the sun is drawn now: the camera's zoom changes it.
      const width = this.sun.getBounds().width;
      setSunShimmerPadding(this.sunShimmer, Math.ceil(width * ((SUN_SHIMMER_REACH - 1) / 2 + 0.05)));
    }
  }

  /**
   * Eases the lift toward the value the climb has earned.
   *
   * Smoothstepped rather than linear, so the horizon does not start and stop
   * moving abruptly at the ends of the race. Under reduced motion the desired
   * value is applied immediately: an eased offset is exactly the ambient
   * animation the preference is asking to be spared.
   */
  private advanceLift(progress: number, deltaMs: number, reducedMotion: boolean): void {
    const t = Math.min(1, Math.max(0, progress));
    const desired = this.presentation.horizonLift * t * t * (3 - 2 * t);
    // The arc is keyed to the same progress and eased by the same rule, so a
    // floor landed moves the lift and the city together.
    const desiredSink = citySinkAt(this.presentation, t);

    if (reducedMotion) {
      this.lift = desired;
      this.sink = desiredSink;
      return;
    }

    const step = Math.min(1, Math.max(0, deltaMs) / (HORIZON_LIFT_SECONDS * 1_000));
    this.lift += (desired - this.lift) * step;
    this.sink += (desiredSink - this.sink) * step;
  }

  /** The one shift that puts every city layer's starting top below `cityTopMin`. */
  private framingSink(cityTopMin: number | undefined): number {
    if (cityTopMin === undefined) return 0;
    let highest = Number.POSITIVE_INFINITY;
    for (const layer of this.layers) {
      if (layer.plate !== "city") continue;
      // Where the strip's top sits with the camera at the start and no lift.
      highest = Math.min(highest, layer.sink - layer.sprite.height);
    }
    return Number.isFinite(highest) ? Math.max(0, cityTopMin - highest) : 0;
  }

  /**
   * The lowest foot of any skirted skyline, in this container's units; undefined
   * when none skirts. Below it every skyline on screen is its skirt -- its last
   * row stretched down -- so it is where the stretched scenery starts.
   */
  get skirtFoot(): number | undefined {
    let foot: number | undefined;
    for (const layer of this.layers) {
      if (layer.plate !== "city" || layer.skirt === undefined) continue;
      const y = layer.sprite.position.y;
      foot = foot === undefined ? y : Math.max(foot, y);
    }
    return foot;
  }

  /** How far the city has sunk, in logical units. Exposed for assertions. */
  get citySink(): number {
    return this.sink;
  }

  /** The current lift, in logical units. Exposed for assertions. */
  get horizonLift(): number {
    return this.lift;
  }

  /**
   * Releases only what this class made.
   *
   * The textures are the provider's, and the skirts are textures derived from
   * them -- both go with the display objects rather than being destroyed
   * individually, which is what keeps a re-mount from tearing down art the next
   * race still needs.
   */
  destroy(): void {
    this.layers.length = 0;
    this.sunShimmer?.destroy();
    this.sunShimmer = undefined;
    this.skyRoot.destroy({ children: true });
    this.cityRoot.destroy({ children: true });
    // The hazed copies are this class's own, so they go with it.
    for (const texture of this.hazed) texture.destroy(true);
    this.hazed.length = 0;
  }
}
