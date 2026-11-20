// @vitest-environment node
/**
 * The page's colour scheme, as the browser reads it.
 *
 * The browser tints its own chrome -- the URL bar included -- from the theme it
 * believes the page is. The head has declared `dark` since the shell was
 * written (and the Resurrect arcade plan authored `color-scheme: dark` for the
 * root), but the root stylesheet later declared `color-scheme: light` for the
 * pearl panels' form controls. The stylesheet wins over the meta, so the
 * browser read the whole page as light and gave it a white URL bar.
 *
 * These cases pin the two signals together: the head says dark, and nothing in
 * the root stylesheet walks that back.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const INDEX = read("apps/client/index.html");
const STYLES = read("apps/client/src/features/kit/styles.css");

/** The content of the head's `<meta name="…">`. */
function meta(name: string): string | undefined {
  return new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`).exec(INDEX)?.[1];
}

/** Relative luminance of an `#rrggbb` colour, 0 (black) to 1 (white). */
function luma(hex: string): number {
  const [r, g, b] = (hex.replace("#", "").match(/../g) ?? []).map((pair) => parseInt(pair, 16));
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
}

describe("the page's colour scheme", () => {
  it("tells the browser the page is dark", () => {
    expect(meta("color-scheme")).toBe("dark");
  });

  it("does not let the root stylesheet walk that back to light", () => {
    // The regression: an unlayered `:root { color-scheme: light }` beats the
    // head's meta, and the browser's chrome goes white to match.
    expect(STYLES).toMatch(/color-scheme:\s*dark\b/);
    expect(STYLES).not.toMatch(/color-scheme:\s*light\b/);
  });

  it("gives a browser that tints from theme-color a dark colour", () => {
    const colour = meta("theme-color");
    expect(colour, "index.html has no theme-color").toBeDefined();
    expect(luma(colour!)).toBeLessThan(0.5);
  });
});
