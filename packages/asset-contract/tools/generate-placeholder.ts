/**
 * `pnpm assets:placeholder`.
 *
 * Draws the part of the art set that is a drafting job rather than a
 * generative one: shapes an image model cannot be asked for.
 *
 * This is not a stand-in for those assets, it is how they are authored. A
 * cloud band has to tile across the logical width without a seam, and a sun
 * has to be a disc and nothing else; asked for either, a generator returns a
 * small scene. The two skylines used to be drawn here too and are not any
 * more: a city's whole appeal is density -- water towers, antennas, fire
 * escapes, vents -- and rectangles cannot reach it. See `generate-city.ts` for
 * those, and `generate-pixellab.ts` for the characters.
 *
 * Character sheets are drawn here only when PixelLab output is absent, so the
 * game still runs for a contributor without an API key. Output is deterministic
 * so a regeneration never shows up as a diff.
 *
 * Every colour resolves through a role. No hex literal is authored here, and
 * every written file passes through the quantizer so that a mixed edge lands on
 * the palette rather than between two swatches.
 */

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PLAYER_COLORS, playerColorHex, roleHex, type RoleName } from "../src/roles";
import { PixelCanvas, TRANSPARENT, createRandom, hex, mix, type Rgba } from "./pixel-canvas";
import { quantizeFile } from "./quantize";

const OUT = resolve(import.meta.dirname, "..", "assets", "production");

const role = (name: RoleName): Rgba => hex(roleHex(name));

const SKY_LOW = role("skyLow");
const CLOUD = role("cloud");
const OUTLINE = role("outline");

const write = (name: string, canvas: PixelCanvas): void => {
  const path = resolve(OUT, name);
  writeFileSync(path, canvas.toBuffer());
  quantizeFile(path);
  process.stdout.write(`  ${name} (${canvas.width}x${canvas.height})\n`);
};

// --------------------------------------------------------------- parallax

/**
 * The sun.
 *
 * A `cloud` core falling off through `skyLow` to nothing, so the disc can sit
 * over the dithered sky without a visible bounding box. White at the centre
 * because the field is high-key: in a pale sky the only way for the sun to read
 * as the brightest thing on screen is to be lighter than the sky, and `cloud`
 * is the one swatch that is.
 *
 * The falloff is the *horizon* tone rather than the overhead one, and that is a
 * correction rather than a preference. The halo was `skyHigh` while the field
 * was a two-tone dither that stayed pale blue near the horizon, so a blue glow
 * was invisible against it. The field is now blue overhead, pink through the
 * middle and peach at the horizon, and the sun sits in the warm band -- where a
 * cold halo stopped blending and started reading as a blue disc stuck to the
 * sky. The halo takes the tone of the band it is actually in.
 *
 * There is no sky plate behind it: the sky is a shader pass, and the disc is
 * the one piece of it with a shape.
 */
export function sun(): PixelCanvas {
  const canvas = new PixelCanvas(256, 256);
  canvas.disc(128, 128, 126, (t) => {
    if (t < 0.4) return CLOUD;
    if (t > 0.9) return TRANSPARENT;
    const fade = (t - 0.4) / 0.5;
    return mix(SKY_LOW, [SKY_LOW[0], SKY_LOW[1], SKY_LOW[2], 0], fade);
  });
  return canvas;
}

/**
 * The cloud band.
 *
 * Overlapping discs rather than drawn shapes, because a puff wants a bumpy
 * silhouette and a circle union gives one for free. Clouds carry no dark
 * outline -- they are the one foreground element that does not, since an
 * outline would make them read as solid objects rather than as air -- and
 * instead take a `skyLow` underside so they have a lit top and a shaded belly.
 * The horizon swatch rather than the overhead one: a cloud's underside catches
 * bounce from the warm end of the field, and a belly in the cool overhead
 * colour reads as a hole rather than as shade.
 *
 * Tileable across the logical width: every puff is placed well inside the
 * strip, and the seam falls in empty sky.
 */
export function clouds(): PixelCanvas {
  const canvas = new PixelCanvas(960, 140);
  const random = createRandom(0xc10d);

  // Geometry first, drawing second. Every puff needs to be drawn twice -- belly
  // then lit top -- and recomputing the radii for the second pass would draw a
  // different cloud, because the generator has moved on.
  const puffs: { cx: number; cy: number; radius: number }[] = [];
  let x = 40;
  while (x < 900) {
    const count = 3 + Math.floor(random() * 3);
    const baseY = 40 + Math.floor(random() * 50);
    const scale = 0.7 + random() * 0.6;
    let cursor = x;

    for (let index = 0; index < count; index += 1) {
      const radius = Math.round((10 + random() * 9) * scale);
      puffs.push({
        cx: cursor + radius,
        cy: baseY - Math.round(random() * radius * 0.4),
        radius,
      });
      cursor += Math.round(radius * 1.2);
    }
    x = cursor + 60 + Math.floor(random() * 120);
  }

  // Bellies first, tops over them: the lit surface has to win every overlap, or
  // a puff behind casts shade onto the puff in front of it.
  for (const puff of puffs) {
    canvas.disc(puff.cx, puff.cy + Math.round(puff.radius * 0.5), puff.radius, () => SKY_LOW);
  }
  for (const puff of puffs) {
    canvas.disc(puff.cx, puff.cy, puff.radius, () => CLOUD);
  }
  return canvas;
}

/**
 * The snow shrine's snowfall.
 *
 * Sparse flakes in the one pale role, each a 2 x 2 or 3 x 3 block on whole
 * world pixels: nothing smaller is drawn, because a single pixel on a sparse
 * transparent band is all of its own grain and the art contract holds every
 * image to a small share of that. It tiles across the width: a flake the seam
 * cuts is drawn again at the far edge, so the band drifts without a join.
 * Deterministic, like the clouds it stands in for.
 */
export function snowfall(): PixelCanvas {
  const canvas = new PixelCanvas(960, 140);
  const random = createRandom(0x5a0f);
  for (let flake = 0; flake < 90; flake += 1) {
    const size = random() < 0.7 ? 2 : 3;
    const x = Math.floor(random() * canvas.width);
    const y = Math.floor(random() * (canvas.height - size));
    canvas.fillRect(x, y, size, size, CLOUD);
    // The part past the right edge reappears at the left; `set` clips the rest.
    if (x + size > canvas.width) canvas.fillRect(x - canvas.width, y, size, size, CLOUD);
  }
  return canvas;
}

/**
 * The snow shrine's near snowfall: fewer, larger flakes than `snowfall()`,
 * drawn nearer and drifting quicker, so the two bands read as depth. Tiled
 * across the seam the same way.
 */
export function snowfallNear(): PixelCanvas {
  const canvas = new PixelCanvas(960, 140);
  const random = createRandom(0x5a10);
  for (let flake = 0; flake < 36; flake += 1) {
    const size = random() < 0.6 ? 4 : 6;
    const x = Math.floor(random() * canvas.width);
    const y = Math.floor(random() * (canvas.height - size));
    canvas.fillRect(x, y, size, size, CLOUD);
    if (x + size > canvas.width) canvas.fillRect(x - canvas.width, y, size, size, CLOUD);
  }
  return canvas;
}

/**
 * Rooftops' far birds (stage ascent spec §5.3): a few small wing-strokes in
 * three loose groups, in the outline role, on whole 2-pixel units. Sparse on
 * purpose -- life at the edge of attention, not a flock to track. Tiles
 * across the seam like the snow.
 */
export function birds(): PixelCanvas {
  const canvas = new PixelCanvas(960, 140);
  const random = createRandom(0xb1d5);
  const INK = role("outline");
  for (const groupX of [90, 430, 760]) {
    const count = 3 + Math.floor(random() * 3);
    for (let bird = 0; bird < count; bird += 1) {
      const x = (groupX + Math.floor(random() * 90)) & ~1;
      const y = (30 + Math.floor(random() * 70)) & ~1;
      // A shallow "v": two wing strokes rising from a body pixel.
      for (const [dx, dy] of [[0, 0], [-2, -2], [-4, -2], [2, -2], [4, -2]] as const) {
        canvas.fillRect((x + dx + canvas.width) % canvas.width, y + dy, 2, 2, INK);
      }
    }
  }
  return canvas;
}

/** The craters' colour: the cool, low-saturation role just under the moon's pale disc. */
const CRATER = role("cityFar");

/**
 * The snow shrine's moon.
 *
 * A hard-edged disc of the pale role with three craters in a cooler one. Not
 * the sun's falloff: that fades its halo through partial alpha into the sky,
 * and a moon is a solid thing on a night sky. Every pixel inside the disc is
 * opaque and every pixel outside is clear, so its edge is a silhouette.
 */
export function moon(): PixelCanvas {
  const canvas = new PixelCanvas(256, 256);
  canvas.disc(128, 128, 120, () => CLOUD);
  for (const [cx, cy, radius] of [[100, 108, 14], [150, 140, 10], [118, 158, 6]] as const) {
    canvas.disc(cx, cy, radius, () => CRATER);
  }
  return canvas;
}

// -------------------------------------------------------------- platforms

// -------------------------------------------------------------- characters

/**
 * One flat ninja frame.
 *
 * The fallback for a checkout with no API key, drawn to the same direction the
 * generated set follows: one body value edge to edge, a dark outline, and no
 * interior shading. `lean` shifts the torso, `legSpread` opens the stride, and
 * `crouch` compresses the pose.
 */
function ninjaFrame(
  body: Rgba,
  lean: number,
  legSpread: number,
  crouch: number,
): PixelCanvas {
  const frame = new PixelCanvas(48, 64);
  const centreX = 24 + lean;
  const headY = 12 + crouch;

  const limb = (x: number, y: number, width: number, height: number): void => {
    // Outline first, body inside it: figure and ground separate by
    // construction rather than by luck of the colours behind.
    frame.fillRect(x - 1, y - 1, width + 2, height + 2, OUTLINE);
    frame.fillRect(x, y, width, height, body);
  };

  limb(centreX - 6, headY, 12, 10);
  limb(centreX - 5, headY + 10, 10, 16);
  limb(centreX - 8, headY + 12, 3, 8);
  limb(centreX + 5, headY + 12, 3, 8);

  const hipY = headY + 26;
  limb(centreX - 4 - legSpread, hipY, 4, 14 - crouch);
  limb(centreX + legSpread, hipY, 4, 14 - crouch);

  return frame;
}

/** Frame parameters per animation row, in the order the brief fixes. */
const ANIMATION_ROWS: {
  name: string;
  frames: { lean: number; spread: number; crouch: number }[];
}[] = [
  {
    name: "idle",
    frames: [
      { lean: 0, spread: 2, crouch: 0 },
      { lean: 0, spread: 2, crouch: 1 },
    ],
  },
  {
    name: "run",
    frames: [
      { lean: 1, spread: 0, crouch: 0 },
      { lean: 2, spread: 3, crouch: 1 },
      { lean: 2, spread: 5, crouch: 2 },
      { lean: 1, spread: 3, crouch: 1 },
    ],
  },
  { name: "jump", frames: [{ lean: 1, spread: 1, crouch: 2 }] },
  { name: "fall", frames: [{ lean: -1, spread: 4, crouch: 0 }] },
  {
    name: "land",
    frames: [
      { lean: 0, spread: 5, crouch: 4 },
      { lean: 0, spread: 4, crouch: 6 },
    ],
  },
];

function ninjaSheet(body: Rgba): PixelCanvas {
  const columns = Math.max(...ANIMATION_ROWS.map((row) => row.frames.length));
  const sheet = new PixelCanvas(48 * columns, 64 * ANIMATION_ROWS.length);

  ANIMATION_ROWS.forEach((row, rowIndex) => {
    row.frames.forEach((frame, columnIndex) => {
      sheet.blit(
        ninjaFrame(body, frame.lean, frame.spread, frame.crouch),
        columnIndex * 48,
        rowIndex * 64,
      );
    });
  });

  return sheet;
}

// -------------------------------------------------------------------- main

process.stdout.write("drawing authored art:\n");
// The snow shrine's own drafted pieces: shapes a generator cannot be asked for.
write("world-snowfall.png", snowfall());
write("world-snowfall-near.png", snowfallNear());
write("world-birds.png", birds());
write("world-moon.png", moon());
// The sun and the clouds are converted from generated sources by
// `generate-city.ts` now (launch polish spec §2.8); the drafted versions below
// are kept as the reference for what each plate has to do, not written.
// Characters come from PixelLab; these are the fallback for a checkout without
// an API key, and they never overwrite generated output.
for (const name of Object.keys(PLAYER_COLORS) as (keyof typeof PLAYER_COLORS)[]) {
  const file = `ninja-${name}.png`;
  if (existsSync(resolve(OUT, file))) {
    process.stdout.write(`  ${file} (kept: generated art present)\n`);
    continue;
  }
  write(file, ninjaSheet(hex(playerColorHex(name))));
}
process.stdout.write("done\n");
