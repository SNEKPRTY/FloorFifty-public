// @vitest-environment node
/**
 * The Tailwind theme.
 *
 * The client's DOM chrome is bound to the same 64 swatches as its pixels, and
 * this is where that is proved rather than trusted. `theme.css` clears
 * Tailwind's default palette with `--color-*: initial` before binding the
 * Resurrect roles; delete that one line and `bg-red-500` starts working again,
 * with no build error and nothing else to notice it.
 *
 * So the test compiles the real theme and asks Tailwind directly: does a role
 * utility resolve, and does an off-palette one resolve to nothing?
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { compile } from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";
import { readClient } from "../../support/client-source";

const ROOT = resolve(import.meta.dirname, "../../../..");
const THEME = resolve(ROOT, "apps/client/src/features/kit/theme.css");

/** Resolves imports the way the Vite plugin does for the client package. */
const requireFromClient = createRequire(resolve(ROOT, "apps/client/package.json"));

async function loadStylesheet(id: string, base: string) {
  const path =
    id === "tailwindcss"
      ? requireFromClient.resolve("tailwindcss/index.css")
      : id.startsWith("@floor-fifty/asset-contract/")
        ? resolve(ROOT, "packages/asset-contract/src", id.slice(id.lastIndexOf("/") + 1))
        : resolve(base, id);

  return { path, base: dirname(path), content: await readFile(path, "utf8") };
}

/** Compiles the theme and emits only the rules the given classes need. */
let build: (candidates: string[]) => string;

beforeAll(async () => {
  const compiler = await compile(await readFile(THEME, "utf8"), {
    base: dirname(THEME),
    loadStylesheet,
  });
  build = (candidates) => compiler.build(candidates);
});

describe("the Tailwind theme", () => {
  it("binds seat colours to the palette rather than to a literal", () => {
    const css = build(["bg-scarlet"]);

    expect(css).toContain("--color-scarlet");
    // Through the generated token, so the hex stays authored in one file.
    expect(css).toContain("var(--ff-player-scarlet)");
  });

  it("names all four seats, in seat order", () => {
    const css = build(["bg-scarlet", "bg-cyan", "bg-gold", "bg-violet"]);

    for (const token of ["--ff-player-scarlet", "--ff-player-cyan", "--ff-player-gold", "--ff-player-violet"]) {
      expect(css).toContain(token);
    }
  });

  it("refuses Tailwind's own palette", () => {
    // The guarantee. These are ordinary Tailwind classes; here they must be
    // unknown, so an off-palette colour cannot enter as a class nobody reviews.
    //
    // Asked as "is a rule emitted for this selector", because a compile always
    // carries the `:root` token block whether or not any candidate matched.
    for (const offPalette of ["bg-red-500", "text-slate-700", "border-blue-300", "bg-white"]) {
      const selector = `.${offPalette.replace(/\./g, "\\.")}`;
      expect(build([offPalette])).not.toContain(selector);
    }
  });

  it("measures spacing in logical pixels, so DOM chrome lands on world pixels", () => {
    const css = build(["p-8"]);

    // Eight logical pixels, not eight times 0.25rem.
    expect(css).toContain("--spacing: 1px");
    expect(css).toMatch(/padding:\s*calc\(var\(--spacing\)\s*\*\s*8\)/);
  });

  it("exposes the UI roles the chrome is drawn from", () => {
    const css = build(["text-ink", "text-muted", "bg-chip", "border-chip-edge"]);

    for (const token of ["--ff-ui-text", "--ff-ui-muted", "--ff-ui-chip-fill", "--ff-ui-chip-edge"]) {
      expect(css).toContain(token);
    }
  });
});

describe("the Aquarian UI palette", () => {
  it("binds its surfaces through the token file rather than a literal", () => {
    const css = build(["bg-aq-pearl", "text-aq-ink"]);

    // Through the Aquarian token, so the one authored UI colour lives in one
    // file. A hex here would mean the surface skipped that file.
    expect(css).toContain("--color-aq-pearl");
    expect(css).toContain("--ff-panel-fill");
    expect(css).toContain("--color-aq-ink");
    expect(css).toContain("--ff-text");
  });

  it("keeps the seat roles on the world palette beside the new surfaces", () => {
    // The point of the pass: the smooth UI is authored, while the world's
    // roles stay generated. Both must resolve in the same compiled sheet.
    const css = build(["bg-aq-pearl", "text-aq-ink", "bg-scarlet"]);

    expect(css).toContain("--ff-panel-fill");
    expect(css).toContain("--ff-text");
    expect(css).toContain("--ff-player-scarlet");
  });

  it("does not reopen Tailwind's palette by declaring the new roles", () => {
    // Declaring named roles must not walk back the reset above. The candidate
    // is asked alongside a valid one so the compile genuinely exercises it.
    const selector = ".bg-red-500".replace(/\./g, "\\.");

    expect(build(["bg-red-500", "bg-aq-pearl"])).not.toContain(selector);
  });
});

describe("form-factor layout system (responsive parity spec §3)", () => {
  const read = (file: string) =>
    readClient(file);

  it("declares the four variants on the document attribute", () => {
    const theme = read("theme.css");
    for (const variant of ["phone-l", "desktop", "tablet-p", "wide"]) {
      expect(theme).toMatch(new RegExp(`@custom-variant ${variant} \\(`));
    }
  });

  it("keeps the desktop values of every size token at today's px (spec §3.2)", () => {
    const tokens = read("aquarian-tokens.css");
    const root = /:root\s*{([\s\S]*?)\n}/.exec(tokens)![1]!;
    expect(root).toContain("--ff-gutter: clamp(1rem, 4vmin, 2.5rem);");
    expect(root).toContain("--ff-type-wordmark: clamp(72px, 12vw, 184px);");
    expect(root).toContain("--ff-racer-cell: 64px;");
    expect(root).toContain("--ff-form-width: 380px;");
    expect(root).toContain("--ff-content-max: 512px;");
    expect(root).toContain("--ff-hud-numeral: 24px;");
    expect(root).toContain("--ff-hud-timer: 24px;");
    expect(root).toContain("--ff-hud-value: 12px;");
    expect(root).toContain("--ff-hud-label: 12px;");
    expect(root).toContain("--ff-touch-size: clamp(56px, 16vmin, 88px);");
    // The seat badges were 11 px on desktop; nothing a player reads is under the hint size now.
    expect(root).toContain("--ff-type-tag: var(--ff-type-hint);");
  });

  it("sets the seat badges at the hint size on every form factor, with no smaller desktop size or per-factor floor", () => {
    const tokens = read("aquarian-tokens.css");
    // The root, inside the shell's zoom, and inside a dialog (divided by both zooms).
    expect(tokens.match(/--ff-type-tag:/g)).toHaveLength(3);
    expect(tokens).not.toMatch(/--ff-type-tag:\s*1[0-3]px/);
    expect(read("aquarian.css")).toMatch(/\.ff-seat__tag {[^}]*font-size: var\(--ff-type-tag\);/);
  });

  it("never branches layout on an orientation or height media query any more", () => {
    for (const file of ["ConnectPanel.svelte", "TouchControls.svelte"]) {
      const source = readClient(file);
      expect(source).not.toMatch(/@media \(orientation/);
      expect(source).not.toMatch(/max-height: 480px/);
    }
  });
});
