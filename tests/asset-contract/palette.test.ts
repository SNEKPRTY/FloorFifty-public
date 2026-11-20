import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { PLAYER_COLORS, ROLES, roleHex } from "@floor-fifty/asset-contract/roles";
import { RESURRECT64, nearestSwatch, swatchRgb } from "@floor-fifty/asset-contract/swatches";

const PACKAGE_ROOT = resolve(process.cwd(), "packages/asset-contract");

describe("the Resurrect 64 palette", () => {
  it("has exactly sixty-four swatches", () => {
    expect(RESURRECT64).toHaveLength(64);
  });

  it("is lowercase six-digit hex throughout", () => {
    for (const swatch of RESURRECT64) expect(swatch).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("has no duplicate swatch", () => {
    expect(new Set(RESURRECT64).size).toBe(64);
  });

  it("matches the canonical hex file in order", () => {
    const lines = readFileSync(resolve(PACKAGE_ROOT, "palettes/resurrect64.hex"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(lines.map((line) => `#${line.toLowerCase()}`)).toEqual([...RESURRECT64]);
  });

  it("resolves a swatch to its own index", () => {
    RESURRECT64.forEach((swatch, index) => {
      const r = Number.parseInt(swatch.slice(1, 3), 16);
      const g = Number.parseInt(swatch.slice(3, 5), 16);
      const b = Number.parseInt(swatch.slice(5, 7), 16);
      expect(nearestSwatch(r, g, b)).toBe(index);
    });
  });

  it("writes one lookup pixel per swatch", () => {
    const lut = PNG.sync.read(readFileSync(resolve(PACKAGE_ROOT, "assets/palette-lut.png")));
    expect(lut.width).toBe(64);
    expect(lut.height).toBe(1);
    RESURRECT64.forEach((swatch, index) => {
      const at = index * 4;
      const channels = [lut.data[at], lut.data[at + 1], lut.data[at + 2]]
        .map((value) => (value ?? 0).toString(16).padStart(2, "0"))
        .join("");
      expect(`#${channels}`).toBe(swatch);
      expect(lut.data[at + 3]).toBe(255);
    });
  });
});

describe("generated palette artifacts", () => {
  it("regenerate byte-identically from the canonical source", () => {
    const swatchesPath = resolve(PACKAGE_ROOT, "src/swatches.ts");
    const lutPath = resolve(PACKAGE_ROOT, "assets/palette-lut.png");
    const before = {
      swatches: readFileSync(swatchesPath),
      lut: readFileSync(lutPath),
      css: readFileSync(resolve(PACKAGE_ROOT, "src/palette.css")),
    };

    execFileSync("pnpm", ["assets:palette"], { cwd: process.cwd(), stdio: "pipe" });

    expect(readFileSync(swatchesPath).equals(before.swatches)).toBe(true);
    expect(readFileSync(lutPath).equals(before.lut)).toBe(true);
    expect(readFileSync(resolve(PACKAGE_ROOT, "src/palette.css")).equals(before.css)).toBe(true);
  });
});

/** Hue in degrees, for the pairs the brief separates by colour rather than value. */
const hue = (index: number): number => {
  const [r, g, b] = swatchRgb(index).map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  if (chroma === 0) return 0;
  const sextant =
    max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  return (sextant * 60 + 360) % 360;
};

/** Rec. 601 luma, which is what "value step" means everywhere in the brief. */
const luma = (index: number): number => {
  const [r, g, b] = swatchRgb(index);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** WCAG relative luminance, for the contrast ratios dust is held to. */
const relativeLuminance = (index: number): number => {
  const [r, g, b] = swatchRgb(index).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrastRatio = (a: number, b: number): number => {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
};

describe("palette roles", () => {
  it("puts dust where every floor face and the low sky can see it (polish spec §4.2)", () => {
    for (const face of [ROLES.platformTop, ROLES.platformBody, ROLES.skyLow, ROLES.cityNear]) {
      expect(contrastRatio(ROLES.dust, face)).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("keeps the finish burst's highlight off every seat colour", () => {
    expect(Object.values(PLAYER_COLORS)).not.toContain(ROLES.finishBurst);
  });

  it("binds every role to a real swatch index", () => {
    for (const index of Object.values(ROLES)) {
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(64);
    }
  });

  it("declares the roles the brief and the renderer both name", () => {
    expect(Object.keys(ROLES).sort()).toEqual(
      [
        "cityFar",
        "cityMid",
        "cityNear",
        "cityNearEdge",
        "cityWindow",
        "cityWindowBright",
        "cityWindowDim",
        "cityWindowHot",
        "cloud",
        "dawnFog",
        "dawnGlow",
        "dawnHaze",
        "dawnHigh",
        "dawnSun",
        "dawnSunCore",
        "dawnTeal",
        "dust",
        "finishBurst",
        "floorPending",
        "floorStranded",
        "floorTaken",
        "outline",
        "platformBody",
        "platformGlow",
        "platformMovingTop",
        "platformOutline",
        "platformTop",
        "rooftopDetails",
        "rooftopFoliage",
        "skyHigh",
        "skyLow",
        "skyMid",
        "uiChipEdge",
        "uiChipFill",
        "uiMuted",
        "uiText",
      ].sort(),
    );
  });

  it("names exactly four player colours", () => {
    expect(Object.keys(PLAYER_COLORS).sort()).toEqual(["cyan", "gold", "scarlet", "violet"]);
  });

  it("keeps the sky the lightest region", () => {
    const sky = Math.min(luma(ROLES.skyHigh), luma(ROLES.skyLow));
    for (const role of ["cityFar", "cityNear", "platformBody", "outline"] as const) {
      expect(luma(ROLES[role])).toBeLessThan(sky);
    }
  });

  it("places the dawn band between the two sky tones", () => {
    // The three sky roles have to read as one ramp, overhead to horizon, or the
    // gradient inverts and the field looks banded rather than lit. Value is what
    // orders them: the mid tone has to fall strictly between the other two, and
    // above every region it sits in front of.
    const high = luma(ROLES.skyHigh);
    const mid = luma(ROLES.skyMid);
    const low = luma(ROLES.skyLow);
    expect(mid).toBeGreaterThan(Math.min(high, low));
    expect(mid).toBeLessThan(Math.max(high, low));
    expect(mid).toBeGreaterThan(luma(ROLES.cityFar));
  });

  it("puts the clouds above the sky and nothing else above them", () => {
    // Clouds are the only thing lighter than the field they sit in. That is
    // what lets the sky be pale without the picture going flat.
    const cloud = luma(ROLES.cloud);
    expect(cloud).toBeGreaterThan(luma(ROLES.skyHigh));
    expect(cloud).toBeGreaterThan(luma(ROLES.skyLow));
  });

  it("separates a platform's top face from its body", () => {
    expect(luma(ROLES.platformTop) - luma(ROLES.platformBody)).toBeGreaterThan(30);
  });

  it("keeps both floor indicators clear of everything they are read against", () => {
    // The bar sits directly under a floor's top face, against the open sky. It
    // is three pixels tall and it is the only thing on screen that says whether
    // a floor still owes the local player a landing, so it has to carry at a
    // glance rather than on inspection.
    for (const role of ["floorTaken", "floorPending"] as const) {
      expect(Math.abs(luma(ROLES[role]) - luma(ROLES.skyHigh))).toBeGreaterThan(40);
      expect(Math.abs(luma(ROLES[role]) - luma(ROLES.skyLow))).toBeGreaterThan(40);
      expect(Math.abs(luma(ROLES[role]) - luma(ROLES.platformTop))).toBeGreaterThan(40);
    }
  });

  it("separates the two floor indicator states by hue, as the reference does", () => {
    // The reference reads `Color::GREEN` against `Color::ORANGE_RED`: near
    // enough in value that hue is what carries the difference, and far enough
    // apart in hue that it carries it completely.
    const gap = Math.abs(hue(ROLES.floorTaken) - hue(ROLES.floorPending));
    expect(Math.min(gap, 360 - gap)).toBeGreaterThan(90);
  });

  it("steps the skylines from pale blue-grey to deep slate-navy", () => {
    // Launch polish spec 2.4.2, measured on the extended-stage board: far about
    // 170 of luma, the middle skyline between, the near rooftops about 45.
    const far = luma(ROLES.cityFar);
    const mid = luma(ROLES.cityMid);
    const near = luma(ROLES.cityNear);
    expect(far - mid).toBeGreaterThanOrEqual(40);
    expect(mid - near).toBeGreaterThanOrEqual(40);
    expect(near).toBeLessThanOrEqual(60);
    for (const role of ["cityFar", "cityMid", "cityNear"] as const) {
      expect(hue(ROLES[role]), role).toBeGreaterThanOrEqual(190);
      expect(hue(ROLES[role]), role).toBeLessThanOrEqual(250);
    }
  });

  it("separates the two city layers by value", () => {
    expect(Math.abs(luma(ROLES.cityFar) - luma(ROLES.cityNear))).toBeGreaterThan(12);
  });

  it("keeps every player colour readable against every sky tone", () => {
    // All three: the re-graded sky (launch polish, phase 1) puts the lilac
    // band where racers spend the middle of a climb, so it is held to the same
    // contract as overhead and the horizon -- the gold seat included.
    for (const index of Object.values(PLAYER_COLORS)) {
      for (const tone of ["skyHigh", "skyMid", "skyLow"] as const) {
        expect(Math.abs(luma(index) - luma(ROLES[tone])), tone).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("finishes the platform top in the board's green", () => {
    // The extended-stage board's top face samples at rgb(186,218,159), hue 94:
    // a lit grass green. The sage it replaced sat at hue 71.
    expect(Math.abs(hue(ROLES.platformTop) - 94)).toBeLessThan(15);
    expect(luma(ROLES.platformTop) - luma(ROLES.platformBody)).toBeGreaterThan(30);
  });

  it("keeps every scenery colour clear of the surfaces a player lands on", () => {
    // Weighted RGB distance, as the palette lock measures it. 112 is the
    // closest pair of seat colours the art review accepted -- the one pair a
    // player could hesitate over -- so nothing behind the play field may come
    // closer to a landing surface than that.
    const distance = (a: number, b: number): number => {
      const [ar, ag, ab] = swatchRgb(a);
      const [br, bg, bb] = swatchRgb(b);
      return Math.sqrt(2 * (ar - br) ** 2 + 4 * (ag - bg) ** 2 + 3 * (ab - bb) ** 2);
    };
    const scenery = [
      "cityFar", "cityMid", "cityNear", "cityNearEdge", "cityWindow",
      "rooftopDetails", "rooftopFoliage", "cloud", "skyHigh", "skyMid", "skyLow",
    ] as const;
    for (const surface of ["platformTop", "platformMovingTop"] as const) {
      for (const role of scenery) {
        expect(distance(ROLES[role], ROLES[surface]), `${role} vs ${surface}`).toBeGreaterThanOrEqual(112);
      }
    }
  });

  it("resolves a role to its swatch hex", () => {
    expect(roleHex("outline")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
