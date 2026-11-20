/**
 * The world plates, against the art brief's numeric rules.
 *
 * The brief states several things about the city that are measurable rather
 * than aesthetic, and three of them had been violated by the shipped plates at
 * the point these tests were written: the far layer carried a dark outline, the
 * near layer used the global ink for its edges, and the lit windows were
 * scattered by an independent coin flip per cell rather than grouped.
 *
 * None of that is a matter of taste, so none of it needs a reviewer to catch
 * it twice. What a reviewer is for is whether the result looks like a city at
 * dawn; what these are for is making sure nobody has to spend that review
 * re-reporting a rule.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { playerColorHex, roleHex } from "@floor-fifty/asset-contract/roles";

const ASSET_ROOT = resolve(process.cwd(), "packages/asset-contract/assets");

const plate = (file: string): PNG =>
  PNG.sync.read(readFileSync(resolve(ASSET_ROOT, "production", file)));

/** `#rrggbb` at a pixel, or undefined where the plate is transparent. */
function pixel(png: PNG, x: number, y: number): string | undefined {
  const index = (y * png.width + x) * 4;
  if (png.data[index + 3] === 0) return undefined;
  const channel = (offset: number): string =>
    (png.data[index + offset] ?? 0).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Every opaque pixel's colour, counted. */
function census(png: PNG): Map<string, number> {
  const counts = new Map<string, number>();
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const colour = pixel(png, x, y);
      if (colour === undefined) continue;
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
  }
  return counts;
}

const INK = roleHex("outline");
const PLATFORM_TOP = roleHex("platformTop");

/** Rec. 601, which is what the brief and these tests both mean by value. */
function luma(hex: string): number {
  const channel = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
  return 0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5);
}
const CITY_FAR = roleHex("cityFar");
const CITY_NEAR = roleHex("cityNear");
const CITY_NEAR_EDGE = roleHex("cityNearEdge");
const CITY_WINDOW = roleHex("cityWindow");

describe("the distant skyline", () => {
  const far = plate("world-city-far.png");

  it("carries no dark outline, so haze can do the work of depth", () => {
    // "Remove dark outlines from far buildings." An outlined shape reads as
    // near however pale its fill is, which defeats the only job this layer has.
    expect(census(far).get(INK) ?? 0).toBe(0);
  });

  it("is drawn in one hazed value", () => {
    expect([...census(far).keys()]).toEqual([CITY_FAR]);
  });
});

describe("the near skyline", () => {
  const near = plate("world-city-near.png");
  const counts = census(near);
  const mass = [...counts.values()].reduce((a, b) => a + b, 0);

  it("shades its buildings with a step down from their own value", () => {
    // "Near buildings use local-value edges", which is a rule about rank: a
    // rooftop must not carry the weight that marks a landing surface.
    //
    // This asserted that the plate contained no ink at all, which worked while
    // the city was a mid-value violet. The city is dark now -- that is what
    // makes a green slab legible, and it is how both approved boards are lit
    // -- and below luma 52 the palette has exactly one violet left. So the
    // shaded return and the global outline are the same swatch, and "contains
    // no ink" no longer says anything about rank.
    //
    // What does is the ordering below, which is the rule the original was
    // reaching for.
    expect(counts.get(CITY_NEAR_EDGE) ?? 0).toBeGreaterThan(0);
    expect(luma(CITY_NEAR_EDGE)).toBeLessThan(luma(CITY_NEAR));
  });

  it("stays far below the surface a player lands on", () => {
    // The rank rule itself. Every value in the near city has to sit well under
    // the platform's top face, or the thing a player looks for every second is
    // competing with the thing behind it.
    for (const colour of counts.keys()) {
      if (colour === CITY_WINDOW) continue;
      expect(luma(PLATFORM_TOP) - luma(colour)).toBeGreaterThan(60);
    }
  });

  it("keeps the lit body dominant and the shaded return a minority", () => {
    // A city split evenly between light and shade reads as a chequerboard.
    // A shaded return is the minority face of a building.
    const body = (counts.get(CITY_NEAR) ?? 0) / mass;
    const shade = (counts.get(CITY_NEAR_EDGE) ?? 0) / mass;

    // Half the mass or more, and at least half again the shade: the powdery
    // finish (stage ascent) grows the dark returns a little as it closes small
    // gaps, from 58% body / 27% shade to 51% / 32%, and the face still reads
    // as lit with a shaded side rather than as an even split.
    expect(body).toBeGreaterThan(0.5);
    expect(shade).toBeGreaterThan(0.1);
    expect(shade).toBeLessThan(body / 1.5);
  });

  it("lights up to the boards' share of the facade, and no further", () => {
    // The Resurrect Arcade brief began at "no more than 5% of a building
    // facade". Both accepted boards are far denser, and launch polish spec
    // §2.8 item 9 raises the cap to 12% for this stage -- still panes, never
    // glitter (the next test).
    // Measured over the roofline band rather than the whole plate: below it
    // every column is simply continued downward, and counting that unlit mass
    // as facade would flatter the number by more than half.
    const groundY = 220;
    let facade = 0;
    let lit = 0;
    for (let y = 0; y < groundY; y += 1) {
      for (let x = 0; x < near.width; x += 1) {
        const colour = pixel(near, x, y);
        if (colour === undefined) continue;
        facade += 1;
        if (colour === CITY_WINDOW) lit += 1;
      }
    }

    expect(facade).toBeGreaterThan(0);
    expect(lit / facade).toBeLessThan(0.12);
    // And lit like the boards: a sparse facade is the gap this closes.
    expect(lit / facade).toBeGreaterThan(0.03);
  });

  it("draws windows as panes rather than as glitter", () => {
    // "Group windows into short runs with large unlit areas. Avoid random
    // single-pixel glitter."
    //
    // Measured as the size of each connected lit region rather than as a run
    // on a fixed column pitch: the drafted city placed windows on a four-pixel
    // grid and the generated one does not, but "a window is a pane, not a
    // speck" is true of both and is what the rule is actually about.
    const seen = new Set<number>();
    const sizes: number[] = [];

    for (let y = 0; y < near.height; y += 1) {
      for (let x = 0; x < near.width; x += 1) {
        const key = y * near.width + x;
        if (seen.has(key) || pixel(near, x, y) !== CITY_WINDOW) continue;

        let size = 0;
        const stack = [[x, y] as const];
        seen.add(key);
        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!;
          size += 1;
          for (const [nx, ny] of [
            [cx - 1, cy],
            [cx + 1, cy],
            [cx, cy - 1],
            [cx, cy + 1],
          ] as const) {
            const nextKey = ny * near.width + nx;
            if (seen.has(nextKey)) continue;
            if (pixel(near, nx, ny) !== CITY_WINDOW) continue;
            seen.add(nextKey);
            stack.push([nx, ny]);
          }
        }
        sizes.push(size);
      }
    }

    expect(sizes.length).toBeGreaterThan(0);
    const specks = sizes.filter((size) => size < 4).length;
    expect(specks / sizes.length).toBeLessThan(0.25);
  });
});

describe("both city plates", () => {
  it.each([["world-city-far.png"], ["world-city-near.png"]])(
    "ends in a band the skirt can stretch without tearing in %s",
    (file) => {
      // The renderer continues a strip below its own edge by stretching the
      // last row downward. That is seamless exactly when the last row is
      // already what the rows above it are, so the foot of each plate is a
      // vertical extrusion.
      //
      // An earlier version compared the bottom row against the middle of the
      // plate instead. That held for the drafted city, whose towers were
      // literal columns all the way down, and it fails for art where a notch
      // between two towers closes before the bottom -- which is a difference
      // in how the art is drawn, not a tear. What matters is only that the
      // foot is uniform.
      const png = plate(file);
      const foot = 24;

      for (let y = png.height - foot; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
          expect(
            pixel(png, x, y),
            `${file} column ${x} changes at row ${y}; the skirt would tear here`,
          ).toBe(pixel(png, x, png.height - 1));
        }
      }
    },
  );

  it("does not reach that uniformity by being empty", () => {
    // The control. A fully transparent foot, or a plate of one flat colour,
    // would satisfy the rule above and mean nothing.
    const near = plate("world-city-near.png");
    let opaque = 0;
    for (let x = 0; x < near.width; x += 1) {
      if (pixel(near, x, near.height - 1) !== undefined) opaque += 1;
    }
    expect(opaque).toBeGreaterThan(near.width * 0.5);
  });
});

describe("the scenery against the landing surfaces", () => {
  // The pixel half of the palette contract "keeps every scenery colour clear of
  // the surfaces a player lands on": the art on disk, not just the roles it was
  // quantized to. A scenery pixel the colour of a floor's top face is a rooftop
  // that looks like somewhere to land.
  const weighted = (a: string, b: string): number => {
    const channel = (hex: string, at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
    return Math.sqrt(
      2 * (channel(a, 1) - channel(b, 1)) ** 2 +
        4 * (channel(a, 3) - channel(b, 3)) ** 2 +
        3 * (channel(a, 5) - channel(b, 5)) ** 2,
    );
  };
  const surfaces = [PLATFORM_TOP, roleHex("platformMovingTop")];

  for (const file of [
    "world-city-far.png",
    "world-city-mid.png",
    "world-city-near.png",
    "world-lanterns.png",
    "world-rooftop-details.png",
    "world-rooftop-props.png",
    "world-clouds.png",
    "world-sun.png",
  ]) {
    it(`keeps ${file} clear of every top-face colour`, () => {
      for (const colour of census(plate(file)).keys()) {
        for (const surface of surfaces) {
          expect(weighted(colour, surface), `${colour} vs ${surface}`).toBeGreaterThanOrEqual(112);
        }
      }
    });
  }
});

describe("the placeholder rooftop props", () => {
  const props = plate("world-rooftop-props.png");
  const counts = census(props);

  it("draws in the details' ink and the foliage green, and nothing else", () => {
    expect([...counts.keys()].sort()).toEqual([roleHex("rooftopDetails"), roleHex("rooftopFoliage")].sort());
  });

  it("stays sparse, so it reads as props on the roofline rather than a second skyline", () => {
    // 18%: the mockup-parity props (spec §2.8 item 10) are richer than the
    // first placeholder strip -- fire escapes and trees -- and still read as
    // fixtures standing on the rooftops in the stage captures.
    const opaque = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(opaque / (props.width * props.height)).toBeLessThan(0.18);
  });
});

describe("the portraits", () => {
  // Generated placeholders (launch polish spec §2.8), one seat per row of the
  // source sheet and one mood per column.
  for (const seat of ["scarlet", "cyan", "gold", "violet"] as const) {
    for (const mood of ["", "-win", "-lose"]) {
      it(`draws portrait-${seat}${mood} in outline, its seat colour and white only`, () => {
        const png = plate(`portrait-${seat}${mood}.png`);
        expect([png.width, png.height]).toEqual([64, 64]);
        const allowed = new Set([roleHex("outline"), playerColorHex(seat), roleHex("cloud")]);
        const counts = census(png);
        for (const colour of counts.keys()) expect(allowed.has(colour), colour).toBe(true);
        // A face, not a smudge: the seat colour covers a real share of the bust.
        expect((counts.get(playerColorHex(seat)) ?? 0) / (64 * 64)).toBeGreaterThan(0.1);
        // And eyes: the one feature the mask leaves.
        expect(counts.get(roleHex("cloud")) ?? 0).toBeGreaterThan(0);
      });
    }
  }
});

describe("the sky plates", () => {
  // Painted like the boards (launch polish spec §2.8 items 6 and 7).
  it("draws the sun with hard alpha, so the lock cannot mint a halo ring", () => {
    const sun = plate("world-sun.png");
    for (let i = 3; i < sun.data.length; i += 4) expect([0, 255]).toContain(sun.data[i]);
  });

  it("lets the cloud band wrap without a seam", () => {
    const clouds = plate("world-clouds.png");
    const columnEmpty = (x: number): boolean => {
      for (let y = 0; y < clouds.height; y += 1) {
        if (clouds.data[(y * clouds.width + x) * 4 + 3] !== 0) return false;
      }
      return true;
    };
    expect(columnEmpty(0)).toBe(true);
    expect(columnEmpty(clouds.width - 1)).toBe(true);
  });

  it("lights the clouds from below in peach", () => {
    expect(census(plate("world-clouds.png")).get(roleHex("skyLow")) ?? 0).toBeGreaterThan(0);
  });
});

describe("the middle distance", () => {
  it("rises above the near rooftops with towers and spires", () => {
    // Each plate stands at its sink (mid 270, near 290), bottom-anchored, so a
    // column's top in world space is sink - height + its first drawn row. The
    // spires are the mid plate's tallest columns; the near rooftops are the
    // near plate's typical column, not its one tallest antenna.
    const columnTops = (png: PNG): number[] => {
      const tops: number[] = [];
      for (let x = 0; x < png.width; x += 1) {
        let top = png.height;
        for (let y = 0; y < png.height; y += 1) {
          if (png.data[(y * png.width + x) * 4 + 3] !== 0) {
            top = y;
            break;
          }
        }
        tops.push(top);
      }
      return tops.sort((a, b) => a - b);
    };
    const mid = columnTops(plate("world-city-mid.png"));
    const near = columnTops(plate("world-city-near.png"));
    const spires = 270 - 400 + mid[Math.floor(mid.length * 0.02)]!;
    const rooftops = 290 - 440 + near[Math.floor(near.length / 2)]!;
    expect(spires).toBeLessThan(rooftops - 40);
  });
});

describe("the menu's layers (spec §2.9 item 2)", () => {
  it("draws the far city in the far roles only, solid below its skyline", () => {
    const far = plate("menu-city-far.png");
    const allowed = new Set([roleHex("cityFar"), roleHex("cityMid")]);
    for (const colour of census(far).keys()) expect(allowed.has(colour), colour).toBe(true);
    // Every column, once it starts, runs to the bottom: parallax never shows a
    // hole behind the near layer.
    for (let x = 0; x < far.width; x += 1) {
      let started = false;
      for (let y = 0; y < far.height; y += 1) {
        const opaque = far.data[(y * far.width + x) * 4 + 3] !== 0;
        if (opaque) started = true;
        else if (started) throw new Error(`column ${x} has a gap at row ${y}`);
      }
    }
  });

  it("draws the near city in the near roles only", () => {
    const allowed = new Set([roleHex("cityNear"), roleHex("cityNearEdge"), roleHex("cityWindow")]);
    for (const colour of census(plate("menu-city-near.png")).keys()) expect(allowed.has(colour), colour).toBe(true);
  });
});

describe("the dawn plates", () => {
  const SKY = ["dawnHaze", "dawnHigh", "dawnGlow", "dawnSun", "dawnSunCore", "dawnTeal", "dawnFog"] as const;
  const MIST = ["dawnGlow", "dawnHigh", "dawnTeal"] as const;

  it("draws the near plate as one silhouette swatch", () => {
    expect([...census(plate("world-dawn-near.png")).keys()]).toEqual([roleHex("outline")]);
  });

  it("keeps the mist to its teals, and keys out the sky above it", () => {
    const mist = plate("world-dawn-mist.png");
    const ramp = new Set(MIST.map(roleHex));
    for (const colour of census(mist).keys()) expect(ramp.has(colour), colour).toBe(true);
    // The hills stand in the lower part of the plate; everything above is keyed out.
    for (let x = 0; x < mist.width; x += 1) expect(pixel(mist, x, mist.height / 3)).toBeUndefined();
    expect(pixel(mist, mist.width / 2, mist.height - 1)).toBeDefined();
  });

  it("fills the sky edge to edge, on the dawn ramp only, as a stippled gradient", () => {
    const sky = plate("world-dawn-sky.png");
    const ramp = new Set(SKY.map(roleHex));
    expect(census(sky).size).toBeGreaterThan(4);
    for (const colour of census(sky).keys()) expect(ramp.has(colour), colour).toBe(true);
    expect(pixel(sky, 0, 0)).toBeDefined();
    expect(pixel(sky, sky.width - 1, sky.height - 1)).toBeDefined();
    // Violet-grey at the top, teal at the foot: the concept's order, not a
    // rank by value. Averaged across the row, because a stipple is read as its mix.
    const average = (y: number): [number, number, number] => {
      const sum = [0, 0, 0];
      for (let x = 0; x < sky.width; x += 1) {
        const hex = pixel(sky, x, y)!;
        for (let k = 0; k < 3; k += 1) sum[k]! += Number.parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
      }
      return sum.map((channel) => channel / sky.width) as [number, number, number];
    };
    const [topR, topG, topB] = average(0);
    expect(topB).toBeGreaterThan(topG + 10);
    expect(topB).toBeGreaterThan(topR + 10);
    const [footR, footG, footB] = average(sky.height - 1);
    expect(footG).toBeGreaterThan(footR + 40);
    expect(footB).toBeGreaterThan(footR + 40);
  });
});
