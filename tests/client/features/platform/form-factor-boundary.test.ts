// @vitest-environment node
import { readFileSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_SRC, clientSourceFiles } from "../../support/client-source";

/**
 * The form-factor boundary (UI layout system spec §2.1 rule 1, §8.3).
 *
 * Only a screen root chooses an arrangement from the form factor. Everything
 * below it -- compositions and primitives -- responds to the space its
 * container gives it, so a new size (a 900x600 window, a browser's 270 px
 * landscape) is laid out by the system rather than by a branch nobody wrote.
 */


/** The components a screen or overlay mounts directly (spec §2, layer 4). */
const FORM_FACTOR_ROOTS = new Set([
  "TitleRoot.svelte",
  "LobbyRoot.svelte",
  "SelectScreen.svelte",
  "SplashRoot.svelte",
  "ResultsPanel.svelte",
  "RaceHud.svelte",
  "ReplayControls.svelte",
  "TutorialPrompt.svelte",
  "LandscapeGate.svelte",
]);

const BRANCHES: readonly [string, RegExp][] = [
  ["a form-factor variant", /\b(?:phone-l|desktop|tablet-p|wide):[\w[-]/],
  ["a data-form-factor selector", /data-form-factor/],
  ["the form factor read in script", /\b(?:formFactor|FormFactor)\b/],
  // The height tier is a root's to read too (spec §2, layer 3): below the
  // roots a component reads the tokens the tier tightens.
  ["a height-tier variant", /\b(?:short|compact):[\w[-]/],
  ["a data-height selector", /data-height/],
];

/** Removes HTML, block and line comments, keeping line numbers. */
function stripComments(source: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (match, lead: string) => lead + blank(match.slice(lead.length)));
}

/** The components, the layout pieces beside them, and observe-size (a layout file before it moved to lib/). */
function files(): string[] {
  return clientSourceFiles()
    .filter((file) => file.endsWith(".svelte") || (file.includes("/kit/layout/") && [".ts", ".css"].includes(extname(file))) || file.endsWith("/lib/observe-size.ts"))
    .map((file) => resolve(import.meta.dirname, "../../../..", file));
}

function offences(): string[] {
  const out: string[] = [];
  for (const path of files()) {
    if (FORM_FACTOR_ROOTS.has(basename(path))) continue;
    const lines = stripComments(readFileSync(path, "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const [what, pattern] of BRANCHES) {
        if (pattern.test(line)) out.push(`${relative(CLIENT_SRC, path)}:${index + 1} uses ${what}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  return out;
}

describe("the form-factor boundary", () => {
  it("keeps form-factor branching in the screen roots", () => {
    expect(offences()).toEqual([]);
  });

  it("still sees a branch it is meant to catch", () => {
    // Guards the patterns themselves: a regex that matched nothing would pass
    // every file. Each line here is a shape that once lived in a component.
    const shapes = [
      `<div class="grid phone-l:grid-cols-2">`,
      `:global([data-form-factor="desktop"]) .ff-frame {`,
      `import { formFactor } from "../viewport-tracking.svelte";`,
      `class="desktop:lg:w-auto"`,
      `<div class="grid short:gap-12">`,
      `:global([data-height="compact"]) .ff-connect label {`,
    ];
    for (const shape of shapes) expect(BRANCHES.some(([, pattern]) => pattern.test(shape)), shape).toBe(true);
    // And not on what it should leave alone.
    for (const fine of [`// desktop:lg: was the old inset`, `const desktop = true;`, `"phone-landscape"`, `compact?: boolean;`, `shortLabel: "Menu",`]) {
      expect(BRANCHES.some(([, pattern]) => pattern.test(stripComments(fine))), fine).toBe(false);
    }
  });
});
