// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Audit S22: the seed dialog's focus ring was `box-shadow: 0 0 0 3px
 * var(--ff-aq-target)`, and `--ff-aq-target` is `44px`, a size. The rule was
 * invalid, and it had already removed the outline, so a keyboard or controller
 * player lost their place. A size token may never stand where a colour goes.
 */

const SIZE_TOKENS = ["--ff-aq-target", "--ff-aq-control-height", "--ff-aq-field-gap", "--ff-aq-group-gap"];
const COLOUR_PROPERTIES = /(?:^|[\s;{])(box-shadow|outline|outline-color|border-color|color|background|background-color|fill|stroke)\s*:([^;}]*)/g;

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "paraglide" ? [] : sources(path);
    return /\.(svelte|css)$/.test(name) ? [path] : [];
  });
}

describe("size tokens in the client's styles (audit S22)", () => {
  const files = sources(join(__dirname, "../../../../apps/client/src"));

  it("reads the client's styles", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("never uses a size token as a colour", () => {
    const misuses: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(COLOUR_PROPERTIES)) {
        const [, property, value] = match;
        const trimmed = value!.trim();
        // `box-shadow: 0 0 0 3px <colour>` may hold a size token as a length, but not as its colour, which comes last.
        const misused = SIZE_TOKENS.some((token) =>
          property === "box-shadow" ? trimmed.endsWith(`var(${token})`) : trimmed.includes(`var(${token})`),
        );
        if (misused) misuses.push(`${file.split("apps/client/")[1]}: ${property}:${value}`);
      }
    }
    expect(misuses).toEqual([]);
  });
});
