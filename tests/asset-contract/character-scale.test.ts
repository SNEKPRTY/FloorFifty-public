import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { parseArtManifest } from "@floor-fifty/asset-contract/manifest-schema";
import { SEAT_COLOURS } from "@floor-fifty/shared/common/seats";
import { inkBounds } from "../../packages/asset-contract/tools/ink-bounds";

const ROOT = resolve(process.cwd(), "packages/asset-contract/assets");
const manifest = parseArtManifest(
  JSON.parse(readFileSync(resolve(ROOT, "art-manifest.json"), "utf8")),
);
/**
 * `player.rs:10`: the size the reference draws a racer at, square.
 *
 * The client draws to this number, so it is what the art has to read at. It
 * replaced an invented "twelve to eighteen per cent of the viewport" band,
 * which was a rule about how big a character ought to look rather than a fact
 * about the game being ported -- and satisfying it had pushed the sprite to
 * three times its frame, half again larger than the reference.
 */
const PLAYER_SPRITE_SIZE = 32 * 1.56;
const characters = manifest.bundles.shell.filter((asset) => asset.role === "character");
/** The cosmetic bodies (character select): each is drawn once per seat colour. */
const BODIES = ["ninja", "frog", "diver", "robo", "kitsune", "penguin", "oni", "witch", "knight"];

/** Every cell of a sheet, as its own PNG. */
function poses(asset: (typeof characters)[number]): PNG[] {
  const sheet = PNG.sync.read(readFileSync(resolve(ROOT, asset.file)));
  if (asset.role !== "character") throw new Error("not a character sheet");
  const rows = Object.values(asset.animations);
  const out: PNG[] = [];
  rows.forEach((row, rowIndex) => {
    for (let column = 0; column < row.frames; column += 1) {
      const cell = new PNG({ width: asset.width, height: asset.height });
      PNG.bitblt(
        sheet,
        cell,
        column * asset.width,
        rowIndex * asset.height,
        asset.width,
        asset.height,
        0,
        0,
      );
      out.push(cell);
    }
  });
  return out;
}

/** Which animation row a flattened pose index belongs to. */
function rowOf(asset: (typeof characters)[number], index: number): number {
  if (asset.role !== "character") throw new Error("not a character sheet");
  let seen = 0;
  for (const [row, animation] of Object.values(asset.animations).entries()) {
    seen += animation.frames;
    if (index < seen) return row;
  }
  return Object.values(asset.animations).length - 1;
}

describe("character scale", () => {
  it("ships nine bodies, each in the four seat colours", () => {
    expect(characters).toHaveLength(BODIES.length * SEAT_COLOURS.length);
  });

  it("gives every character the same frame size", () => {
    expect(new Set(characters.map((a) => `${a.width}x${a.height}`)).size).toBe(1);
  });

  it("fills its frame, so the drawn size is the reference's size", () => {
    // Per pose, not per sheet. Ink varied by five pixels across frames of one
    // generated animation, which is the difference between passing and failing
    // on alternating frames.
    //
    // The rule is frame utilisation rather than a share of the viewport. A
    // racer's size on screen is fixed by the reference at PLAYER_SPRITE_SIZE;
    // what the art controls is how much of its frame it spends, and a pose that
    // sits small inside a generous frame draws small at any scale.
    for (const character of characters) {
      for (const [index, pose] of poses(character).entries()) {
        const bounds = inkBounds(pose);
        expect(bounds, `${character.alias} pose ${index} is empty`).not.toBeNull();
        const ink = bounds!.bottom - bounds!.top + 1;
        const share = ink / character.height;
        expect(share, `${character.alias} pose ${index} is ${ink}px of ${character.height}`)
          .toBeGreaterThanOrEqual(0.8);
        expect(share, `${character.alias} pose ${index} is ${ink}px of ${character.height}`)
          .toBeLessThanOrEqual(1);
      }
    }
  });

  it("draws at the size the reference draws a racer", () => {
    // Parity, stated once. The client reads the same number from
    // `lib/constants.ts`; this pins the art against it so a re-authored
    // sheet at a different frame size cannot silently change how big a racer
    // looks.
    for (const character of characters) {
      const drawn = PLAYER_SPRITE_SIZE / character.height;
      expect(drawn, `${character.alias} would draw at ${drawn.toFixed(2)}x`).toBeCloseTo(1.56, 2);
    }
  });

  it("stands every grounded pose on one baseline", () => {
    // A baseline that moves between grounded poses reads as the character
    // bobbing rather than as animation.
    //
    // `jump` and `fall` are exempt, and not as a concession: a pose that leaves
    // the ground is the one pose whose feet must leave the baseline, and
    // holding it to the others would be asserting that a leap does not rise.
    const GROUNDED = ["idle", "run", "land"];
    for (const character of characters) {
      if (character.role !== "character") throw new Error("not a character sheet");
      const rows = Object.keys(character.animations);
      const feet = poses(character)
        .map((pose, index) => ({ pose, row: rows[rowOf(character, index)] }))
        .filter((entry) => GROUNDED.includes(entry.row ?? ""))
        .map((entry) => inkBounds(entry.pose)!.bottom);
      expect(Math.max(...feet) - Math.min(...feet)).toBeLessThanOrEqual(1);
    }
  });

  it("stands every pose on its frame's edge, so a racer never floats", () => {
    // The client stands a sprite on the bottom of its collider. Empty rows
    // under the feet draw as air between a racer and the platform it is on --
    // which is what two rows of margin here did. A ceiling grip is the mirror
    // case: it hangs from the top of its frame, because its hands meet a floor.
    for (const character of characters) {
      if (character.role !== "character") throw new Error("not a character sheet");
      const rows = Object.keys(character.animations);
      for (const [index, pose] of poses(character).entries()) {
        const row = rows[rowOf(character, index)];
        const bounds = inkBounds(pose)!;
        if (row === "ceiling") {
          expect(bounds.top, `${character.alias} ${row} ${index}`).toBe(0);
        } else {
          expect(bounds.bottom, `${character.alias} ${row} ${index}`).toBe(character.height - 1);
        }
      }
    }
  });

  it("declares the Game and Watch pose counts", () => {
    for (const character of characters) {
      if (character.role !== "character") throw new Error("not a character sheet");
      expect(
        Object.fromEntries(
          Object.entries(character.animations).map(([name, row]) => [name, row.frames]),
        ),
      ).toEqual({
        idle: 2,
        run: 4,
        jump: 1,
        fall: 1,
        land: 2,
        // Two each, and two on purpose. Contact with a wall or a ceiling is a
        // state rather than a motion, and the language this sheet is drawn in
        // cuts between poses rather than tweening through them.
        wall: 2,
        ceiling: 2,
      });
    }
  });

  it("gives all four seats of a body an identical silhouette", () => {
    // One pose set recoloured, so alpha must match exactly. Four independent
    // generations would pass every other case here and fail this one. Bodies
    // differ from one another; only a body's own seats are compared.
    for (const body of BODIES) {
      const alpha = characters
        .filter((asset) => asset.alias.startsWith(`${body}.`))
        .map((asset) => {
          const png = PNG.sync.read(readFileSync(resolve(ROOT, asset.file)));
          return png.data.filter((_, index) => index % 4 === 3).join(",");
        });
      expect(alpha, `${body} has a sheet per seat`).toHaveLength(SEAT_COLOURS.length);
      for (const seat of alpha.slice(1)) expect(seat).toBe(alpha[0]);
    }
  });

  it("ships a portrait per body and player colour, in each of the three moods", () => {
    // Neutral, win and lose (launch polish spec §2.8). The ninja keeps the
    // bare `portrait.<colour>` names; every other body is `portrait.<body><Colour>`.
    const expected = BODIES.flatMap((body) =>
      SEAT_COLOURS.flatMap((seat) => {
        const base = body === "ninja" ? `portrait.${seat}` : `portrait.${body}${seat[0]!.toUpperCase()}${seat.slice(1)}`;
        return [base, `${base}Lose`, `${base}Win`];
      }),
    );
    expect(
      manifest.bundles.shell
        .filter((asset) => asset.alias.startsWith("portrait."))
        .map((asset) => asset.alias)
        .sort(),
    ).toEqual(expected.sort());
  });

  it("declares the player colour each character wears", () => {
    for (const character of characters) {
      expect(character.paletteRoles).toContain(character.alias.split(".")[1]);
    }
  });
});
