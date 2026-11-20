/**
 * `pnpm assets:racers [character-id]`.
 *
 * Cuts one generated sprite sheet into the four seats' 128x224 sheets. With no
 * argument it cuts the ninja from `racer-sheet.png` and `racer-climbs.png`,
 * with a portrait crop per seat; with an ID it cuts that character from
 * `racer-sheet-<id>.png` and `racer-climbs-<id>.png` and writes
 * `<id>-<seat>.png` alone, since those characters' busts are drawn separately.
 *
 * **One generation, four recolours.** Seat identity is the only difference
 * between the racers, so the poses are drawn once and the colour is swapped.
 * Four independent generations would give four different silhouettes for what
 * is mechanically the same character, and the art brief requires the alpha
 * silhouette to be identical across seats.
 *
 * **Why the poses are cut rather than laid out.** The generator is asked for a
 * 4x5 grid and it obliges approximately: the cells are the right count in the
 * right order, but a pose sits wherever it sits inside its cell and is drawn at
 * whatever size suits it. So each cell is searched for its own ink, and each
 * pose is scaled to spend the same share of its frame.
 *
 * Per pose rather than one shared factor, which is the opposite of what seems
 * right and is what the asset contract requires. A racer's size on screen is
 * fixed by `PLAYER_SPRITE_SIZE`; what the art controls is how much of its frame
 * it spends, so a pose drawn small inside a generous frame draws small at every
 * scale. A shared factor preserved the generator's own proportions and left the
 * landing crouch at 21 pixels of 32, which `character-scale.test.ts` refuses --
 * and it refuses it for a reason measured on the previous sheet.
 *
 * **Colour comes from the palette, not the generation.** Five roles: the
 * outline, the seat's main and shadow tones, the hands, and the eyes. They are
 * picked by where a pixel sits in luma and saturation rather than by matching
 * the generator's reds, so the same cut works whatever hue it returns.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { PLAYER_COLORS, type PlayerColorName } from "../src/roles";
import { swatchRgb, type SwatchIndex } from "../src/swatches";
import { powderFinishFrames } from "./powder";
import { quantizeToColours } from "./source-raster";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
/** The character being cut: the ninja unless an ID is named. */
const CHARACTER = process.argv[2] ?? "ninja";
/** Sources carry the ID except the ninja's, which predate named characters. */
const SUFFIX = CHARACTER === "ninja" ? "" : `-${CHARACTER}`;
const SOURCE = resolve(PACKAGE_ROOT, "assets", "source", `racer-sheet${SUFFIX}.png`);
/**
 * The climbing poses, drawn separately.
 *
 * A second sheet rather than a wider first one: the ten poses were generated,
 * reviewed and cut before these existed, and regenerating that sheet to append
 * two rows would have redrawn all ten. Two sources, one character, because both
 * prompts describe the same one and both are cut by the same code.
 */
const CLIMB_SOURCE = resolve(PACKAGE_ROOT, "assets", "source", `racer-climbs${SUFFIX}.png`);
const OUT = resolve(PACKAGE_ROOT, "assets", "production");

const FRAME = 32;
const COLUMNS = 4;
const ROWS = 5;
const CLIMB_ROWS = 2;

/** The chroma key the sheet is drawn on, and how far a pixel may stray. */
const KEY = [255, 0, 255] as const;
const KEY_TOLERANCE = 120;

/**
 * Ink height every pose is scaled to, in frame pixels.
 *
 * Twenty-eight of thirty-two is 87.5%, comfortably inside the 80-100% band the
 * asset contract holds every pose to, with two pixels of air above and the
 * floor below so a pose never touches its own frame edge.
 */
const INK_HEIGHT = 28;

/**
 * The characters whose poses are fitted to the frame's width as well as to
 * `INK_HEIGHT`. The Penguin is all belly: its crouch at `INK_HEIGHT` is wider
 * than a frame and would be cut off at both edges, so a pose of its that would
 * overflow draws a little shorter instead -- but never under `MIN_INK_HEIGHT`,
 * the asset contract's 80% floor, so a pose spread wider than that allows (the
 * fall, flippers out) loses its tips rather than its size. Opt-in rather than for everyone,
 * because Kitsune's tail already reaches its frame edge in the approved cut,
 * and fitting it would redraw art the owner signed off.
 */
const FIT_WIDTH: ReadonlySet<string> = new Set(["penguin"]);
/** 80% of a frame, rounded up: the shortest pose `character-scale.test.ts` accepts. */
const MIN_INK_HEIGHT = Math.ceil(FRAME * 0.8);

/** The scale that brings a pose to `INK_HEIGHT`, or to the frame's width where the character fits it. */
function poseScale(box: { left: number; right: number; top: number; bottom: number }): number {
  const byHeight = INK_HEIGHT / (box.bottom - box.top + 1);
  if (!FIT_WIDTH.has(CHARACTER)) return byHeight;
  const byWidth = (FRAME - 2) / (box.right - box.left + 1);
  return Math.min(byHeight, Math.max(byWidth, MIN_INK_HEIGHT / (box.bottom - box.top + 1)));
}

/**
 * Where each animation's frames live in the generated grid.
 *
 * The sheet's own row order, and the animation lengths the manifest declares.
 * Cells past an animation's length are empty in the source and stay
 * transparent here.
 */
const ANIMATIONS = [
  { name: "idle", row: 0, frames: 2 },
  { name: "run", row: 1, frames: 4 },
  { name: "jump", row: 2, frames: 1 },
  { name: "fall", row: 3, frames: 1 },
  { name: "land", row: 4, frames: 2 },
] as const;

/**
 * The climbing rows, cut from the second sheet and appended after the first
 * five.
 *
 * Two frames each, held long. Contact with a wall or a ceiling is a state a
 * player is in rather than a motion they are performing, and two stark poses
 * alternating slowly say "gripping" where a smooth cycle would say "walking up
 * a wall". The row order here is the row order the renderer indexes by, so
 * these must stay last.
 */
const CLIMB_ANIMATIONS = [
  { name: "wall", row: 0, frames: 2 },
  { name: "ceiling", row: 1, frames: 2 },
] as const;

/**
 * The seat palettes: a main tone and the shadow that sits under it.
 *
 * Each shadow was chosen by measuring the palette for the swatch roughly 38 of
 * luma below its seat and within 30 degrees of its hue, so every seat is lit
 * the same way rather than four ways that happen to look similar.
 */
const SEATS: Record<PlayerColorName, { main: SwatchIndex; shadow: SwatchIndex }> = {
  scarlet: { main: PLAYER_COLORS.scarlet, shadow: 19 as SwatchIndex },
  cyan: { main: PLAYER_COLORS.cyan, shadow: 46 as SwatchIndex },
  gold: { main: PLAYER_COLORS.gold, shadow: 20 as SwatchIndex },
  violet: { main: PLAYER_COLORS.violet, shadow: 50 as SwatchIndex },
};

/** Roles that are the same on every seat. */
const OUTLINE = 0 as SwatchIndex;
const HANDS = 4 as SwatchIndex;
const EYES = 9 as SwatchIndex;

type Rgb = readonly [number, number, number];
type Box = { left: number; top: number; right: number; bottom: number };

const isKey = (r: number, g: number, b: number): boolean =>
  Math.abs(r - KEY[0]) + Math.abs(g - KEY[1]) + Math.abs(b - KEY[2]) < KEY_TOLERANCE;

const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

const saturation = (r: number, g: number, b: number): number => {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
};

/**
 * Which of the five roles a source pixel belongs to.
 *
 * By position in luma and saturation rather than by hue, so the cut does not
 * depend on the generator having returned the red it was asked for.
 */
function classify(r: number, g: number, b: number, seat: { main: SwatchIndex; shadow: SwatchIndex }): SwatchIndex {
  const level = luma(r, g, b);
  const sat = saturation(r, g, b);

  // Thresholds measured off the sheet rather than assumed. Its clusters are:
  // an outline at luma 0, the suit at luma 80 at 0.97 saturation, a shaded
  // suit around 40-70, pale hands near luma 200 at middling saturation, and
  // near-white eyes above 220. An earlier version guessed the suit sat above
  // luma 100; it sits at 80, so every lit surface was being called shadow and
  // every shaded one outline, and the racer came out a dark blob.
  if (level < 45) return OUTLINE;
  if (sat < 0.15) return level > 180 ? EYES : OUTLINE;
  if (sat < 0.5) return level > 120 ? HANDS : seat.shadow;
  return level >= 72 ? seat.main : seat.shadow;
}

/**
 * Where each of `count` poses in a row band sits horizontally, as column spans.
 *
 * The generator is asked for equal cells and does not honour them: a pose can
 * sit across a cell boundary, and slicing at the boundary clips it. Poses are
 * instead the runs of ink columns, merged across their narrowest gaps until
 * `count` remain. Only the characters after the ninja are cut this way; the
 * ninja's sheets were cut in fixed cells and must not move.
 */
function poseSpans(png: PNG, band: { top: number; bottom: number }, count: number): { left: number; width: number }[] {
  const runs: { left: number; right: number }[] = [];
  for (let x = 0; x < png.width; x += 1) {
    let ink = 0;
    for (let y = band.top; y <= band.bottom; y += 1) {
      const i = (y * png.width + x) * 4;
      if (!isKey(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!)) ink += 1;
    }
    if (ink === 0) continue;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.right === x - 1) last.right = x;
    else runs.push({ left: x, right: x });
  }
  // Merge across the narrowest gap until only `count` poses remain.
  while (runs.length > count) {
    let narrowest = 0;
    for (let index = 1; index < runs.length - 1; index += 1) {
      if (runs[index + 1]!.left - runs[index]!.right < runs[narrowest + 1]!.left - runs[narrowest]!.right) narrowest = index;
    }
    runs[narrowest]!.right = runs[narrowest + 1]!.right;
    runs.splice(narrowest + 1, 1);
  }
  return runs.map((run) => ({ left: run.left, width: run.right - run.left + 1 }));
}

/** The tightest box of non-key pixels inside a cell, or nothing. */
function inkBox(png: PNG, cellX: number, cellY: number, cellW: number, cellH: number): Box | undefined {
  let box: Box | undefined;
  for (let y = cellY; y < cellY + cellH; y += 1) {
    for (let x = cellX; x < cellX + cellW; x += 1) {
      const i = (y * png.width + x) * 4;
      if (isKey(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!)) continue;
      box =
        box === undefined
          ? { left: x, top: y, right: x, bottom: y }
          : {
              left: Math.min(box.left, x),
              top: Math.min(box.top, y),
              right: Math.max(box.right, x),
              bottom: Math.max(box.bottom, y),
            };
    }
  }
  return box;
}

/**
 * Draws one pose into a frame, scaled by `scale` and stood on the frame's floor.
 *
 * The floor is the frame's last row, and a hanging pose hangs from its first.
 * The client stands a racer's sprite on the bottom of its collider, so any
 * empty rows under the feet draw as air between the racer and the platform --
 * which is what two rows of margin here used to do.
 *
 * Nearest-neighbour by area vote: each destination pixel takes the role most of
 * its source pixels carry, which keeps an outline an outline instead of
 * averaging it into the fill beside it.
 */
function drawPose(
  source: PNG,
  box: Box,
  sheet: PNG,
  frameX: number,
  frameY: number,
  scale: number,
  seat: { main: SwatchIndex; shadow: SwatchIndex },
  hang = false,
): void {
  const width = Math.max(1, Math.round((box.right - box.left + 1) * scale));
  const height = Math.max(1, Math.round((box.bottom - box.top + 1) * scale));
  const offsetX = Math.round((FRAME - width) / 2);
  // Stood on a common floor rather than centred: a landing crouch is shorter
  // than an idle, and centring both would sink the crouch into the platform.
  // A ceiling grip is the mirror case: its hands, not its feet, meet a floor.
  const offsetY = hang ? 0 : FRAME - height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Relative spans first, then offset once. Adding `box.left` before
      // taking the max added it twice, and every destination pixel sampled a
      // window that started inside its pose and ran off across the sheet --
      // which is why a frame came out as one flat colour.
      const boxWidth = box.right - box.left + 1;
      const boxHeight = box.bottom - box.top + 1;
      const rx0 = Math.floor((x / width) * boxWidth);
      const rx1 = Math.max(rx0 + 1, Math.floor(((x + 1) / width) * boxWidth));
      const ry0 = Math.floor((y / height) * boxHeight);
      const ry1 = Math.max(ry0 + 1, Math.floor(((y + 1) / height) * boxHeight));

      const sx0 = box.left + rx0;
      const sx1 = Math.min(box.right + 1, box.left + rx1);
      const sy0 = box.top + ry0;
      const sy1 = Math.min(box.bottom + 1, box.top + ry1);

      const votes = new Map<number, number>();
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const i = (sy * source.width + sx) * 4;
          const [r, g, b] = [source.data[i]!, source.data[i + 1]!, source.data[i + 2]!];
          if (isKey(r, g, b)) continue;
          const role = classify(r, g, b, seat);
          votes.set(role, (votes.get(role) ?? 0) + 1);
        }
      }
      if (votes.size === 0) continue;

      // An outline wins any tie it is part of: a one-pixel border that loses a
      // vote to the fill beside it leaves a hole in the silhouette.
      const ranked = [...votes.entries()].sort(
        (a, b) => b[1] - a[1] || (a[0] === OUTLINE ? -1 : 1),
      );
      const [role] = ranked[0]!;
      const [cr, cg, cb] = swatchRgb(role as SwatchIndex) as unknown as Rgb;

      const to = ((frameY + offsetY + y) * sheet.width + frameX + offsetX + x) * 4;
      sheet.data[to] = cr;
      sheet.data[to + 1] = cg;
      sheet.data[to + 2] = cb;
      sheet.data[to + 3] = 255;
    }
  }
}

/**
 * The vertical band each row of poses actually occupies.
 *
 * Found rather than assumed. The generator is asked for five even rows and
 * returns five rows of poses that are roughly even, which is not the same
 * thing: on this sheet the bands are 36-200, 242-415, 445-618, 657-812 and
 * 844-985 against fifths of 0-203, 204-408 and so on. Two of the five straddle
 * a boundary, so slicing at fifths cut poses in half and mixed two rows into
 * one frame.
 */
function rowBands(png: PNG): { top: number; bottom: number }[] {
  const bands: { top: number; bottom: number }[] = [];
  let start: number | undefined;

  for (let y = 0; y < png.height; y += 1) {
    let ink = 0;
    for (let x = 0; x < png.width; x += 1) {
      const i = (y * png.width + x) * 4;
      if (!isKey(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!)) ink += 1;
    }
    // A handful of stray pixels is encoder fringe, not a row of characters.
    const drawn = ink > 3;
    if (drawn && start === undefined) start = y;
    else if (!drawn && start !== undefined) {
      bands.push({ top: start, bottom: y - 1 });
      start = undefined;
    }
  }
  if (start !== undefined) bands.push({ top: start, bottom: png.height - 1 });
  return bands;
}

/**
 * Smallest region each role is allowed to form, in pixels.
 *
 * The same idea as the plates' 2x2 open, at a scale where a 2x2 open would be
 * vandalism: a 32-pixel character's eye slit and fingers are one and two
 * pixels, and an open would delete precisely those. So the rule is applied per
 * role rather than uniformly, and what it targets is measured rather than
 * guessed.
 *
 * On the first cut the shadow tone formed 102 regions of two pixels or fewer
 * out of 150 -- scattered specks left by sampling an illustration down to 32
 * pixels, not shading anybody placed. The suit was 40 of 89. Those two get the
 * real cleanup.
 *
 * The outline only loses true orphans: a border is thin by nature, and a run
 * of two along a shoulder is the drawing rather than an artefact. Eyes and
 * hands are exempt entirely -- nine of the twenty white regions are two pixels
 * or fewer, because that is simply how large an eye is here.
 */
const MIN_REGION = new Map<SwatchIndex, number>([
  [OUTLINE, 2],
  [HANDS, 1],
  [EYES, 1],
]);

/**
 * The characters whose sheets take the powdery finish (`powder.ts`), the same
 * pass the stages carry (owner, 2026-10-01: "all assets").
 *
 * Per frame, and with the face kept. Run plain, the 2x2 open and close delete
 * every eye on every sheet and the frog's mouth with them -- the ninja's slit
 * closes into one black band -- because at 32 pixels those are one- and
 * two-pixel features, the very size the finish removes. So the eyes and the
 * outline drawn inside the figure (the eye slit, the mouth, the visor) are put
 * back as they were, and the silhouette, the suit and its shading take the
 * finish. A character can opt out here, with its reason beside it.
 */
const POWDERED: ReadonlySet<string> = new Set(["ninja", "frog", "diver", "robo", "kitsune", "penguin", "oni", "witch", "knight"]);

/** The powdery finish on a cut sheet, re-locked to its five roles. */
function powder(sheet: PNG, seat: { main: SwatchIndex; shadow: SwatchIndex }): PNG {
  const eyes = swatchRgb(EYES);
  const outline = swatchRgb(OUTLINE);
  const opaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < sheet.width && y < sheet.height && sheet.data[(y * sheet.width + x) * 4 + 3] !== 0;
  const is = (rgb: readonly number[], r: number, g: number, b: number): boolean => rgb[0] === r && rgb[1] === g && rgb[2] === b;
  const finished = powderFinishFrames(sheet, FRAME, (r, g, b, x, y) => {
    if (is(eyes, r, g, b)) return true;
    // Inside the figure, not on its edge: an edge is the silhouette, which the
    // finish is meant to simplify. A frame's own border counts as its edge.
    const inFrame = (nx: number, ny: number): boolean =>
      Math.floor(nx / FRAME) === Math.floor(x / FRAME) && Math.floor(ny / FRAME) === Math.floor(y / FRAME) && opaque(nx, ny);
    return is(outline, r, g, b) && inFrame(x - 1, y) && inFrame(x + 1, y) && inFrame(x, y - 1) && inFrame(x, y + 1);
  });
  quantizeToColours(
    finished,
    [OUTLINE, seat.main, seat.shadow, HANDS, EYES].map((role) => swatchRgb(role)),
  );
  return finished;
}

/** Absorbs regions below their role's minimum into whichever neighbour surrounds them most. */
function tidy(png: PNG, seat: { main: SwatchIndex; shadow: SwatchIndex }): void {
  const minimum = new Map(MIN_REGION);
  minimum.set(seat.main, 3);
  minimum.set(seat.shadow, 3);

  const rgbKey = (swatch: SwatchIndex): string => swatchRgb(swatch).join(",");
  const floorFor = new Map([...minimum].map(([swatch, min]) => [rgbKey(swatch), min]));

  const at = (x: number, y: number): string | undefined => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return undefined;
    const i = (y * png.width + x) * 4;
    if (png.data[i + 3] === 0) return undefined;
    return `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
  };

  const seen = new Set<number>();
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const key = y * png.width + x;
      const self = at(x, y);
      if (seen.has(key) || self === undefined) continue;

      const region: number[] = [];
      const stack: [number, number][] = [[x, y]];
      const border = new Map<string, number>();
      seen.add(key);

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        region.push(cy * png.width + cx);
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as [number, number][]) {
          const neighbour = at(nx, ny);
          if (neighbour === undefined) continue;
          if (neighbour === self) {
            const nk = ny * png.width + nx;
            if (seen.has(nk)) continue;
            seen.add(nk);
            stack.push([nx, ny]);
            continue;
          }
          border.set(neighbour, (border.get(neighbour) ?? 0) + 1);
        }
      }

      if (region.length >= (floorFor.get(self) ?? 1)) continue;
      const winner = [...border.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (winner === undefined) continue;
      const [r, g, b] = winner.split(",").map(Number) as [number, number, number];
      for (const index of region) {
        const i = index * 4;
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
      }
    }
  }
}

/**
 * A portrait, cut from the sheet's own idle pose.
 *
 * The brief asks for four 32-pixel crops of the approved idle art, and cutting
 * them from the sheet rather than generating them is what keeps the face in the
 * lobby the same face that runs: the portraits shipped before this were the
 * previous character entirely, still on-palette and still passing every check,
 * because nothing tied one to the other.
 *
 * The crop is the head and shoulders -- the top three fifths of the pose --
 * scaled to fill the frame, so a portrait reads at roster size where a whole
 * body would not.
 */
function portraitFrom(sheet: PNG): PNG {
  let top = FRAME;
  let bottom = -1;
  let left = FRAME;
  let right = -1;

  for (let y = 0; y < FRAME; y += 1) {
    for (let x = 0; x < FRAME; x += 1) {
      if (sheet.data[(y * sheet.width + x) * 4 + 3] === 0) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }

  const out = new PNG({ width: FRAME, height: FRAME });
  out.data.fill(0);
  if (bottom < 0) return out;

  const height = Math.max(1, Math.round((bottom - top + 1) * 0.6));
  const width = right - left + 1;
  const scale = Math.min(FRAME / width, FRAME / height);
  const drawnW = Math.max(1, Math.round(width * scale));
  const drawnH = Math.max(1, Math.round(height * scale));
  const offsetX = Math.round((FRAME - drawnW) / 2);

  for (let y = 0; y < drawnH; y += 1) {
    for (let x = 0; x < drawnW; x += 1) {
      const sx = left + Math.min(width - 1, Math.floor((x / drawnW) * width));
      const sy = top + Math.min(height - 1, Math.floor((y / drawnH) * height));
      const from = (sy * sheet.width + sx) * 4;
      if (sheet.data[from + 3] === 0) continue;
      const to = ((y + FRAME - drawnH) * FRAME + x + offsetX) * 4;
      out.data[to] = sheet.data[from]!;
      out.data[to + 1] = sheet.data[from + 1]!;
      out.data[to + 2] = sheet.data[from + 2]!;
      out.data[to + 3] = 255;
    }
  }
  return out;
}

function main(): void {
  const source = PNG.sync.read(readFileSync(SOURCE));
  const cellW = Math.floor(source.width / COLUMNS);
  const bands = rowBands(source);

  if (bands.length !== ROWS) {
    throw new Error(
      `expected ${ROWS} rows of poses in the source sheet, found ${bands.length}: ` +
        `${bands.map((band) => `${band.top}-${band.bottom}`).join(", ")}`,
    );
  }

  const climbSource = PNG.sync.read(readFileSync(CLIMB_SOURCE));
  const climbCellW = Math.floor(climbSource.width / COLUMNS);
  const climbBands = rowBands(climbSource);

  if (climbBands.length !== CLIMB_ROWS) {
    throw new Error(
      `expected ${CLIMB_ROWS} rows of climbing poses, found ${climbBands.length}`,
    );
  }

  // One scale for every pose, taken from the tallest, so the character is the
  // same size in every frame.
  const cellOf = (animation: (typeof ANIMATIONS)[number], frame: number): Box | undefined => {
    const band = bands[animation.row]!;
    if (CHARACTER !== "ninja") {
      const span = poseSpans(source, band, animation.frames)[frame];
      return span === undefined ? undefined : inkBox(source, span.left, band.top, span.width, band.bottom - band.top + 1);
    }
    return inkBox(source, frame * cellW, band.top, cellW, band.bottom - band.top + 1);
  };

  const climbCellOf = (
    animation: (typeof CLIMB_ANIMATIONS)[number],
    frame: number,
  ): Box | undefined => {
    const band = climbBands[animation.row]!;
    if (CHARACTER !== "ninja") {
      const span = poseSpans(climbSource, band, animation.frames)[frame];
      return span === undefined
        ? undefined
        : inkBox(climbSource, span.left, band.top, span.width, band.bottom - band.top + 1);
    }
    return inkBox(
      climbSource,
      frame * climbCellW,
      band.top,
      climbCellW,
      band.bottom - band.top + 1,
    );
  };

  process.stdout.write("cutting racer sheets:\n");

  for (const [name, seat] of Object.entries(SEATS) as [PlayerColorName, typeof SEATS.scarlet][]) {
    let sheet = new PNG({ width: FRAME * COLUMNS, height: FRAME * (ROWS + CLIMB_ROWS) });
    sheet.data.fill(0);

    for (const animation of ANIMATIONS) {
      for (let frame = 0; frame < animation.frames; frame += 1) {
        const box = cellOf(animation, frame);
        if (box === undefined) continue;
        // Each pose to the same share of its frame; see `INK_HEIGHT`.
        const scale = poseScale(box);
        drawPose(source, box, sheet, frame * FRAME, animation.row * FRAME, scale, seat);
      }
    }

    for (const animation of CLIMB_ANIMATIONS) {
      for (let frame = 0; frame < animation.frames; frame += 1) {
        const box = climbCellOf(animation, frame);
        if (box === undefined) continue;
        const scale = poseScale(box);
        drawPose(
          climbSource,
          box,
          sheet,
          frame * FRAME,
          (ROWS + animation.row) * FRAME,
          scale,
          seat,
          animation.name === "ceiling",
        );
      }
    }

    tidy(sheet, seat);
    if (POWDERED.has(CHARACTER)) sheet = powder(sheet, seat);
    writeFileSync(resolve(OUT, `${CHARACTER}-${name}.png`), PNG.sync.write(sheet));
    if (CHARACTER !== "ninja") {
      process.stdout.write(`  ${CHARACTER}-${name}.png (${sheet.width}x${sheet.height})\n`);
      continue;
    }

    const portrait = portraitFrom(sheet);
    tidy(portrait, seat);
    writeFileSync(resolve(OUT, `portrait-${name}.png`), PNG.sync.write(portrait));
    process.stdout.write(
      `  ninja-${name}.png (${sheet.width}x${sheet.height}) + portrait-${name}.png\n`,
    );
  }

  process.stdout.write("done\n");
}

main();
