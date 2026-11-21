/**
 * The story's things in the world (story mode v2 spec, "Glims", "Lamps", "The
 * lava"): the glims floating over their floors, the lamps standing on theirs,
 * the safe-spot banners and their ring, and the friend's call for help in a
 * dive. Drawn in the scene's story layer, so the camera carries them and they
 * sit over the floors and under the racers.
 *
 * Pixel art in Resurrect 64, drawn from small grids at the racers' own pixel
 * size (32-pixel art at 1.56), so a glim sits beside a racer as one picture.
 * Under reduced motion nothing bobs, twinkles, shakes or grows: a rattle is a
 * blink, a ring shows at its size and fades.
 */

import { Container, Graphics } from "pixi.js";
import { VIEWPORT } from "@floor-fifty/shared/common/constants";
import { floorX, type RaceState } from "@floor-fifty/shared/common/state";
import type { StoryChapter } from "@floor-fifty/shared/content/game-content";
import { RESURRECT64 } from "@floor-fifty/asset-contract/swatches";
import { actorPlayerId } from "./actors";
import type { Director, StoryEvent } from "./director";
import { glimPosition, lampPosition } from "./pickups";

/** One pixel of art, in world units: the racers' sheets are 32 pixels drawn at 1.56. */
export const ART_PIXEL = 1.56;

const swatch = (index: number): number => Number.parseInt(RESURRECT64[index]!.slice(1), 16);

/** The swatches the layer draws with, by name. */
export const STORY_SWATCHES = {
  ink: swatch(0),
  metal: swatch(2),
  metalLight: swatch(6),
  amber: swatch(17),
  gold: swatch(18),
  pale: swatch(28),
  white: swatch(9),
  warm: swatch(23),
  glassShut: swatch(24),
  emberShut: swatch(20),
  teal: swatch(42),
  tealDeep: swatch(40),
  red: swatch(15),
} as const;

type Grid = readonly string[];

/**
 * A glim, as the spec draws it: a baby firefly the size of a coin, a round
 * soft-yellow body with a lighter belly, two dot eyes, and two little
 * see-through wings (drawn apart, half see-through). Eleven by nine.
 */
const GLIM: Grid = [
  "...........",
  "...........",
  "...AAAAA...",
  "..ABBBBBA..",
  ".ABEBBBEBA.",
  ".ABBBBBBBA.",
  ".ABBCCCBBA.",
  "..ABCCCBA..",
  "...AAAAA...",
];
const GLIM_KEY = { A: STORY_SWATCHES.amber, B: STORY_SWATCHES.gold, C: STORY_SWATCHES.pale, E: STORY_SWATCHES.ink };
const GLIM_WINGS: Grid = ["..WW...WW..", "..WWW.WWW..", "...........", "...........", "...........", "...........", "...........", "...........", "..........."];
const GLIM_WINGS_KEY = { W: STORY_SWATCHES.white };

/** A lamp: twelve by sixteen, a cap, a glass, a flame. */
const LAMP: Grid = [
  "....XXXX....",
  "....X..X....",
  "...XXXXXX...",
  "..XMMMMMMX..",
  ".XMLMMMMMMX.",
  ".XGGGGGGGGX.",
  ".XGGGHHGGGX.",
  ".XGGHHHHGGX.",
  ".XGGHFFHGGX.",
  ".XGGHFFHGGX.",
  ".XGGGHHGGGX.",
  ".XGGGGGGGGX.",
  ".XMMMMMMMMX.",
  "..XMMMMMMX..",
  "...XXXXXX...",
];
const LAMP_SHUT = { X: STORY_SWATCHES.ink, M: STORY_SWATCHES.metal, L: STORY_SWATCHES.metalLight, G: STORY_SWATCHES.glassShut, H: STORY_SWATCHES.emberShut, F: STORY_SWATCHES.amber };
const LAMP_OPEN = { X: STORY_SWATCHES.ink, M: STORY_SWATCHES.metal, L: STORY_SWATCHES.metalLight, G: STORY_SWATCHES.warm, H: STORY_SWATCHES.pale, F: STORY_SWATCHES.white };

/** A safe spot's banner: a post and a flag. */
const BANNER: Grid = ["XTTTT", "XTTT.", "XTT..", "X....", "X....", "X....", "X...."];
const BANNER_KEY = { X: STORY_SWATCHES.ink, T: STORY_SWATCHES.teal };
const BANNER_SAVED = { X: STORY_SWATCHES.ink, T: STORY_SWATCHES.pale };

/** A call for help over a stuck friend. */
const HELP: Grid = [".RR.", ".RR.", ".RR.", ".RR.", "....", ".RR.", ".RR."];
const HELP_KEY = { R: STORY_SWATCHES.red };

/** Draws `grid` into `g`, centred on x, its bottom on y, at `pixel` units a cell. */
export function drawGrid(g: Graphics, grid: Grid, key: Readonly<Record<string, number>>, pixel = ART_PIXEL): Graphics {
  const width = grid[0]!.length;
  const height = grid.length;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const colour = key[grid[row]![column]!];
      if (colour === undefined) continue;
      g.rect((column - width / 2) * pixel, (row - height) * pixel, pixel, pixel).fill(colour);
    }
  }
  return g;
}

/** An x on the course, brought into the viewport's wrap. */
const wrapped = (x: number): number => ((((x + VIEWPORT.width / 2) % VIEWPORT.width) + VIEWPORT.width) % VIEWPORT.width) - VIEWPORT.width / 2;

type Ring = { readonly g: Graphics; readonly x: number; readonly y: number; readonly startMs: number; readonly colour: number; readonly size: number };

/** How long a ring lasts, and how big it grows, in ms and world units. */
const RING_MS = 620;
const LAMP_RATTLE_MS = 220;
const FLAME_STEP_MS = 140;

/** How much larger than its art pixels a lamp is drawn, and how far its foot sinks into the floor's lip, in world units. */
const LAMP_SCALE = 1.8;
const LAMP_SINK = 6;

/** How much larger than its art pixels a glim is drawn. */
const GLIM_SCALE = 1.6;

export class StoryLayer {
  private readonly glims: { readonly root: Container; readonly halo: Graphics; readonly sparkle: Graphics; readonly wings: Graphics }[];
  private readonly lamps = new Map<number, { readonly root: Container; readonly shut: Graphics; readonly open: Graphics; readonly glow: Graphics; rattledAtMs: number }>();
  private readonly banners = new Map<number, { readonly root: Container; readonly idle: Graphics; readonly saved: Graphics }>();
  private readonly help: Container;
  private readonly rings: Ring[] = [];
  private readonly ringRoot = new Container({ label: "story-rings" });
  private nowMs = 0;

  constructor(
    private readonly root: Container,
    private readonly chapter: StoryChapter,
  ) {
    // The glims: a halo behind, the light, and a twinkle beside it.
    this.glims = (chapter.glims ?? []).map(() => {
      const holder = new Container({ label: "story-glim" });
      const halo = new Graphics();
      halo.circle(0, -4 * ART_PIXEL, 9 * ART_PIXEL).fill({ color: STORY_SWATCHES.warm, alpha: 0.28 });
      const wings = drawGrid(new Graphics(), GLIM_WINGS, GLIM_WINGS_KEY);
      wings.alpha = 0.6;
      const light = drawGrid(new Graphics(), GLIM, GLIM_KEY);
      const sparkle = new Graphics();
      sparkle.rect(-ART_PIXEL / 2, -3 * ART_PIXEL, ART_PIXEL, 3 * ART_PIXEL).fill(STORY_SWATCHES.white);
      sparkle.rect(-1.5 * ART_PIXEL, -2 * ART_PIXEL, 3 * ART_PIXEL, ART_PIXEL).fill(STORY_SWATCHES.white);
      sparkle.position.set(5 * ART_PIXEL, -8 * ART_PIXEL);
      holder.addChild(halo, wings, light, sparkle);
      // Drawn larger than its pixels so a glim reads at a glance on a phone, where the world is small.
      holder.scale.set(GLIM_SCALE);
      root.addChild(holder);
      return { root: holder, halo, sparkle, wings };
    });
    for (const floor of chapter.lamps ?? []) {
      const holder = new Container({ label: "story-lamp" });
      const glow = new Graphics();
      glow.circle(0, -8 * ART_PIXEL, 22 * ART_PIXEL).fill({ color: STORY_SWATCHES.warm, alpha: 0.22 });
      glow.visible = false;
      const shut = drawGrid(new Graphics(), LAMP, LAMP_SHUT);
      const open = drawGrid(new Graphics(), LAMP, LAMP_OPEN);
      open.visible = false;
      holder.addChild(glow, shut, open);
      // As tall as a racer's legs, so it reads beside one (review R12).
      holder.scale.set(LAMP_SCALE);
      root.addChild(holder);
      this.lamps.set(floor, { root: holder, shut, open, glow, rattledAtMs: Number.NEGATIVE_INFINITY });
    }
    const safe = new Set(chapter.phases.flatMap((phase) => phase.safeSpots ?? []));
    for (const floor of safe) {
      const holder = new Container({ label: "story-safe-spot" });
      const idle = drawGrid(new Graphics(), BANNER, BANNER_KEY);
      const saved = drawGrid(new Graphics(), BANNER, BANNER_SAVED);
      saved.visible = false;
      holder.addChild(idle, saved);
      root.addChild(holder);
      this.banners.set(floor, { root: holder, idle, saved });
    }
    this.help = new Container({ label: "story-help" });
    this.help.addChild(drawGrid(new Graphics(), HELP, HELP_KEY, ART_PIXEL * 1.5));
    this.help.visible = false;
    root.addChild(this.help, this.ringRoot);
  }

  /** One frame: where everything stands, and the moments of this frame's ticks. */
  frame(input: { readonly state: RaceState; readonly director: Director; readonly events: readonly StoryEvent[]; readonly deltaMs: number; readonly reduced: boolean }): void {
    const { state, director, reduced } = input;
    this.nowMs += input.deltaMs;
    const seconds = this.nowMs / 1000;
    for (const event of input.events) this.answer(event, state);

    (this.chapter.glims ?? []).forEach((spot, index) => {
      const glim = this.glims[index]!;
      glim.root.visible = !director.pickups.taken.has(index);
      if (!glim.root.visible) return;
      const at = glimPosition(state, spot);
      // A slow bob and a breathing halo, each glim on its own beat.
      const bob = reduced ? 0 : Math.round(Math.sin(seconds * 2.4 + index * 1.7) * 2) * ART_PIXEL;
      glim.root.position.set(wrapped(at.x), -(at.y + 4.5 * ART_PIXEL * GLIM_SCALE) + bob);
      glim.halo.alpha = reduced ? 1 : 0.75 + 0.25 * Math.sin(seconds * 3.1 + index);
      glim.sparkle.visible = !reduced && Math.sin(seconds * 1.9 + index * 2.3) > 0.82;
      // The wings flutter: a beat on, a beat faint.
      glim.wings.alpha = reduced ? 0.6 : Math.floor(seconds * 10 + index) % 2 === 0 ? 0.7 : 0.35;
    });

    for (const [floor, lamp] of this.lamps) {
      const at = lampPosition(state, floor);
      const open = director.pickups.open.has(floor);
      lamp.shut.visible = !open;
      lamp.open.visible = open;
      lamp.glow.visible = open;
      const since = this.nowMs - lamp.rattledAtMs;
      const rattling = since < LAMP_RATTLE_MS;
      // A rattle shakes the shut lamp two pixels; under reduced motion it blinks instead.
      const shake = rattling && !reduced ? (Math.floor(since / 40) % 2 === 0 ? 2 : -2) : 0;
      lamp.shut.alpha = rattling && reduced && Math.floor(since / 70) % 2 === 0 ? 0.45 : 1;
      // Its foot a little into the floor's drawn lip, so it stands on it rather than over it.
      lamp.root.position.set(wrapped(at.x) + shake, -at.y + LAMP_SINK);
      // A shut lamp's ember breathes, so it reads as something inside to let out.
      if (!open) lamp.shut.tint = reduced || Math.floor(this.nowMs / FLAME_STEP_MS) % 5 !== 0 ? 0xffffff : 0xffe0c0;
      if (open && !reduced) lamp.glow.alpha = 0.85 + 0.15 * Math.sin(seconds * 4);
    }

    const phaseSpots = new Set(director.phase.safeSpots ?? []);
    for (const [floor, banner] of this.banners) {
      banner.root.visible = phaseSpots.has(floor);
      if (!banner.root.visible) continue;
      const top = director.floorTopY(floor);
      // At the floor's right end, clear of a racer landing in its middle.
      const x = wrapped(floorX(state, state.course.floors[floor]!) + state.tuning.FLOOR_WIDTH / 2 - 4 * ART_PIXEL);
      banner.root.position.set(x, -top);
      const saved = director.savedFloor === floor;
      banner.idle.visible = !saved;
      banner.saved.visible = saved;
    }

    // The friend to go down to calls for help, over their head.
    const objective = director.objective;
    this.help.visible = objective.kind === "rescue";
    if (objective.kind === "rescue") {
      const racer = state.players[actorPlayerId(objective.actor)];
      if (racer !== undefined) {
        const bob = reduced ? 0 : Math.round(Math.sin(seconds * 6) * 1.5) * ART_PIXEL;
        this.help.position.set(wrapped(racer.x), -(racer.y + state.tuning.PLAYER_HEIGHT / 2 + 26) + bob);
        this.help.visible = reduced || Math.sin(seconds * 6) > -0.6;
      }
    }

    for (let index = this.rings.length - 1; index >= 0; index -= 1) {
      const ring = this.rings[index]!;
      const share = (this.nowMs - ring.startMs) / RING_MS;
      if (share >= 1) {
        ring.g.destroy();
        this.rings.splice(index, 1);
        continue;
      }
      const eased = 1 - (1 - share) ** 3;
      const radius = reduced ? ring.size : 8 + (ring.size - 8) * eased;
      ring.g.clear().circle(0, 0, radius).stroke({ width: ART_PIXEL * 2, color: ring.colour, alpha: 1 - share });
    }
  }

  private answer(event: StoryEvent, state: RaceState): void {
    if (event.kind === "lampRattle") {
      const lamp = this.lamps.get(event.floor);
      if (lamp !== undefined) lamp.rattledAtMs = this.nowMs;
      return;
    }
    if (event.kind === "safeSpot") {
      this.ring(event.at.x, event.at.y - state.tuning.PLAYER_HEIGHT / 2, STORY_SWATCHES.teal, 64);
      return;
    }
    if (event.kind === "lampOpen") this.ring(event.at.x, event.at.y + 12, STORY_SWATCHES.pale, 80);
    if (event.kind === "rescue") this.ring(event.at.x, event.at.y, STORY_SWATCHES.gold, 96);
  }

  private ring(x: number, y: number, colour: number, size: number): void {
    const g = new Graphics();
    g.position.set(wrapped(x), -y);
    this.ringRoot.addChild(g);
    this.rings.push({ g, x, y, startMs: this.nowMs, colour, size });
  }

  /** Rings and blinks under way: for the sound-off test. */
  get liveRings(): number {
    return this.rings.length;
  }

  destroy(): void {
    this.root.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.rings.length = 0;
  }
}
