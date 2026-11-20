/**
 * `pnpm assets:portraits [character-id]`.
 *
 * Cuts the generated portrait sheet (`assets/source/portrait-sheet.png`, from
 * `IMAGE_PROMPTS.portraits`) into twelve 64 x 64 busts. With a character ID it
 * cuts `portrait-sheet-<id>.png` into `portrait-<id>-<seat>[-mood].png` instead
 * of the ninja's `portrait-<seat>[-mood].png`. Twelve busts: four seats down, three
 * moods across -- neutral, win, lose. Placeholders for the hand-drawn set the
 * art brief commissions (launch polish spec §2.8).
 *
 * Each bust is keyed, cropped square around its own content, box-resampled to
 * 64 and quantised onto exactly three colours: the outline ink, the seat's own
 * colour and white for the eyes. Three because the mask leaves only the eyes,
 * and a portrait with any more colour than the racer it names would stop
 * reading as that racer.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { PLAYER_COLORS, ROLES } from "../src/roles";
import { swatchRgb } from "../src/swatches";
import { powderFinishFrames } from "./powder";
import { ringMask } from "./ring";
import { contentBox, crop, quantizeToColours, resample, type Box } from "./source-raster";

const ROOT = resolve(import.meta.dirname, "..");
/** The character being cut: the ninja unless an ID is named. */
const CHARACTER = process.argv[2];
const SOURCE = resolve(ROOT, "assets", "source", CHARACTER === undefined ? "portrait-sheet.png" : `portrait-sheet-${CHARACTER}.png`);
const OUT = resolve(ROOT, "assets", "production");

/** Rows of the sheet, top to bottom, as the prompt orders them. */
const SEATS = ["scarlet", "cyan", "gold", "violet"] as const;
/** Columns of the sheet, left to right, and the file suffix each is saved under. */
const MOODS = [
  { mood: "neutral", suffix: "" },
  { mood: "win", suffix: "-win" },
  { mood: "lose", suffix: "-lose" },
] as const;

/**
 * The characters whose busts take the powdery finish (`powder.ts`), as the
 * stages and the racers do (owner, 2026-10-01: "all assets"). The ninja's
 * busts are cut when no ID is named.
 *
 * With the face kept, as the racers' is. At 64 pixels an eye, an ear or an
 * antenna is wider than the 2x2 the finish removes, but the lines that make
 * an expression are not: run plain, the finish deleted the ninja's win-mood
 * eye arcs -- one-pixel ink inside the white band -- and left a blank stare.
 * So the ink drawn inside the figure (eye arcs, pupils, mouth lines) is put
 * back after the finish; the outline, the seat colour and the white take it.
 * A character can opt out here, with its reason beside it.
 */
const POWDERED: ReadonlySet<string> = new Set(["ninja", "frog", "diver", "robo", "kitsune", "penguin", "oni", "witch", "knight"]);

/**
 * The characters whose white helmet ring is painted back solid after the
 * finish (`ring.ts`). The Diver's rivet ring broke into dashes under the
 * finish, and on some busts the cut had already split it at a seam; the
 * owner approved the finish on condition the ring stays one solid ring
 * (2026-10-01).
 */
const RINGED: ReadonlySet<string> = new Set(["diver"]);

const SIZE = 64;
/** Empty pixels kept round a bust once it is cropped square, in source pixels. */
const MARGIN = 6;

/** A square round `box`, with a margin, clamped to the sheet. */
function squareAround(png: PNG, box: Box): Box {
  const side = Math.min(Math.max(box.width, box.height) + MARGIN * 2, png.width, png.height);
  const x = Math.min(Math.max(0, Math.round(box.x + box.width / 2 - side / 2)), png.width - side);
  const y = Math.min(Math.max(0, Math.round(box.y + box.height / 2 - side / 2)), png.height - side);
  return { x, y, width: side, height: side };
}

function main(): void {
  const sheet = PNG.sync.read(readFileSync(SOURCE));
  // The prompt's equal cells divide the sheet, including its outer gutters.
  // Dividing only the content box shifts later rows into the preceding bust.
  const cellWidth = sheet.width / MOODS.length;
  const cellHeight = sheet.height / SEATS.length;
  const ink = swatchRgb(ROLES.outline);
  const eyes = swatchRgb(ROLES.cloud);

  process.stdout.write("cutting portraits:\n");
  SEATS.forEach((seat, row) => {
    const colours = [ink, swatchRgb(PLAYER_COLORS[seat]), eyes];
    MOODS.forEach(({ suffix }, column) => {
      const cell = {
        x: Math.floor(column * cellWidth),
        y: Math.floor(row * cellHeight),
        width: Math.floor(cellWidth),
        height: Math.floor(cellHeight),
      };
      // Crop the cell first so square padding cannot pull in its neighbour.
      const tile = crop(sheet, cell.x, cell.y, cell.width, cell.height);
      const square = squareAround(tile, contentBox(tile, { x: 0, y: 0, width: tile.width, height: tile.height }));
      const cut = crop(tile, square.x, square.y, square.width, square.height);
      let bust = resample(cut, 0, cut.height - 1, SIZE, SIZE);
      quantizeToColours(bust, colours);
      if (POWDERED.has(CHARACTER ?? "ninja")) {
        const drawn = bust;
        const opaque = (x: number, y: number): boolean =>
          x >= 0 && y >= 0 && x < SIZE && y < SIZE && drawn.data[(y * SIZE + x) * 4 + 3] !== 0;
        bust = powderFinishFrames(
          bust,
          SIZE,
          (r, g, b, x, y) =>
            r === ink[0] && g === ink[1] && b === ink[2] &&
            opaque(x - 1, y) && opaque(x + 1, y) && opaque(x, y - 1) && opaque(x, y + 1),
        );
        quantizeToColours(bust, colours);
        if (RINGED.has(CHARACTER ?? "ninja")) {
          const ring = ringMask(drawn, eyes);          for (let i = 0; i < ring.length; i += 1) {
            if (ring[i] && bust.data[i * 4 + 3] !== 0) bust.data.set([eyes[0], eyes[1], eyes[2], 255], i * 4);
          }
        }
      }
      const file = `portrait-${CHARACTER === undefined ? "" : `${CHARACTER}-`}${seat}${suffix}.png`;
      writeFileSync(resolve(OUT, file), PNG.sync.write(bust));
      process.stdout.write(`  ${file}\n`);
    });
  });
  process.stdout.write("done\n");
}

main();
