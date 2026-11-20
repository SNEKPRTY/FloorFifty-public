// @vitest-environment node
/**
 * Every colour the client draws, the menus' included, is a Resurrect 64 swatch
 * (Owner, 2026-11-18: "the colours need to be on the Resurrect 64 palette for
 * UI"). The palette is `packages/asset-contract/palettes/resurrect64.hex`; the
 * menus' own role table is `ui-palette.json`, and both must stay inside it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

const SWATCHES = new Set(
  read("packages/asset-contract/palettes/resurrect64.hex")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => /^[0-9a-f]{6}$/.test(line))
    .map((line) => `#${line}`),
);

/** Files that draw a colour that is not a menu colour, each with the reason. A new entry is a deliberate edit here. */
const EXEMPT: Record<string, string> = {
  "apps/client/src/features/net/net-stats-overlay.ts": "debug overlay (network numbers, not shown to players)",
  "apps/client/src/features/race/touch-debug.ts": "debug overlay (touch points, not shown to players)",
  "apps/client/src/features/audio/diagnostics.ts": "debug overlay (audio diagnostics, not shown to players)",
  "apps/client/src/features/render/non-gameplay-backdrop.ts": "black and white probe textures that measure the refraction filter; never drawn as a colour",
};

/** Source without comments, so a seed code like `#048213` in a doc line is not read as a colour. */
const code = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Hex in any spelling (`#rgb`, `#rrggbb`, `#rrggbbaa`, and the `%23` an SVG data URL uses). */
const HEX = /(?<![&\w])(?:#|%23)([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?!\w)/g;
/** `rgb(r g b / a)` and `rgba(r, g, b, a)` with literal numbers; a call that builds its colour from a role is not one. */
const RGB = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,/][^)]*)?\)/g;

/** Every colour a source spells out, as `#rrggbb` (the alpha dropped, the short form widened). */
function coloursIn(source: string): string[] {
  const text = code(source);
  const hexes = [...text.matchAll(HEX)].map((match) => {
    const digits = match[1]!.toLowerCase();
    return `#${digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits.slice(0, 6)}`;
  });
  const rgbs = [...text.matchAll(RGB)].map((match) => `#${[1, 2, 3].map((i) => Number(match[i]).toString(16).padStart(2, "0")).join("")}`);
  return [...hexes, ...rgbs];
}

function files(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "paraglide" ? [] : files(path);
    return /\.(svelte|css|ts|json)$/.test(entry.name) ? [path] : [];
  });
}

describe("the client's colours", () => {
  it("are all Resurrect 64 swatches, apart from the named exceptions", () => {
    const sources = [...files("apps/client/src"), "apps/client/index.html", "apps/client/public/manifest.webmanifest"];
    const strays = sources
      .filter((file) => !(file in EXEMPT))
      .flatMap((file) =>
        coloursIn(read(file))
          .filter((colour) => !SWATCHES.has(colour))
          .map((colour) => `${file}: ${colour}`),
      );
    expect([...new Set(strays)]).toEqual([]);
  });

  it("keeps each exception to a file that exists and still draws a colour", () => {
    for (const file of Object.keys(EXEMPT)) expect(coloursIn(read(file)).length, file).toBeGreaterThan(0);
  });

  it("sees a colour in every spelling", () => {
    expect(coloursIn("a { color: #FFF; b: #12345678; c: rgb(20 43 73 / 0.18); d: rgba(0, 0, 0, 0.6); e: url(\"data:...%23142b49\") }")).toEqual([
      "#ffffff", "#123456", "#142b49", "#142b49", "#000000",
    ]);
    expect(coloursIn("rgb(roleTint(x))\n// #123456\n/* #abcdef */")).toEqual([]);
  });

  it("lists only swatches in the menus' role table", () => {
    const table = JSON.parse(read("apps/client/src/features/kit/ui-palette.json")) as Array<{ hex: string }>;
    expect(table.map((entry) => entry.hex.toLowerCase()).filter((hex) => !SWATCHES.has(hex))).toEqual([]);
  });
});
