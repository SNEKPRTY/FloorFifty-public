import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { clientFile } from "../../support/client-source";

/**
 * Type discipline, read from the source.
 *
 * Two faces and three weights. Fraunces sets the wordmark and nothing else in
 * the DOM (UI overhaul spec, "Type"), with one exception: the race's pop-up
 * words set Fraunces at 900 (Wonder spec §5.1, the owner's ruling of
 * 2026-10-04), from `features/race/juice/word-pool.ts` alone. Fusion Pixel sets
 * everything a player reads: 400 for reading text, 600 for anything that asks
 * for attention (labels, controls, numerals, emphasis) and 800 for headings. A stray face or a third
 * weight is exactly the drift this file exists to catch, and a style rule
 * cannot be trusted to hold it by review alone. The DOM and the canvas are
 * both covered, because a nameplate drawn by Pixi is as much a part of the
 * interface as a button.
 */

const SRC = resolve(import.meta.dirname, "../../../../apps/client/src");

function sources(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path, extensions);
    return extensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

/**
 * The rules alone: comments dropped (prose may quote a declaration), and
 * `@font-face` blocks too, which are allowed to name a file's weight range.
 */
const withoutFontFaces = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@font-face\s*\{[^}]*\}/g, "");

/** Each file's text with its path relative to `src`, for readable failures. */
const styled = sources(SRC, [".css", ".svelte"]).map((path) => ({
  file: relative(SRC, path),
  text: withoutFontFaces(readFileSync(path, "utf8")),
}));
const scripted = sources(SRC, [".ts"]).map((path) => ({
  file: relative(SRC, path),
  text: readFileSync(path, "utf8"),
}));

const FAMILY_TOKENS = ["var(--ff-font-ui)", "var(--ff-font-wordmark)", "var(--ff-font-endonym)", "inherit"];
const WEIGHTS = ["400", "600", "800"];
/**
 * The rules allowed the heading weight, by selector: a title is the only thing set in 800. A new
 * heading is a deliberate addition to this list, not a stray weight.
 */
const HEADINGS = new Set([
  "h1, h2, h3, .ff-dialog-heading__title",
  ".ff-dialog-heading__title",
  ".ff-frame__headline",
  ".ff-character-page__name",
]);

/** A stylesheet's rules, as a selector and its declarations. */
const rulesOf = (css: string): Array<{ selector: string; body: string }> =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1]!.trim().replace(/\s+/g, " "), body: match[2]! }));
/** The one file allowed its own face and weight: the pop-up words, through `wordFont` (Wonder spec §5.1). */
const WORDS_FILE = "features/race/juice/word-pool.ts";
const isWordsFace = (file: string, declaration: string): boolean =>
  file === WORDS_FILE && /this\.font(Family|Weight)\b/.test(declaration);

describe("type discipline", () => {
  it("declares the two faces, and the CJK faces only Fusion Pixel (languages spec §6.1)", () => {
    const theme = readFileSync(join(SRC, clientFile("theme.css").replace("apps/client/src/", "")), "utf8");
    const faces = [...theme.matchAll(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect([...new Set(faces)].sort()).toEqual([
      "FF Pixel",
      "FF Pixel JP",
      "FF Pixel JP Endonym",
      "FF Pixel KR",
      "FF Pixel KR Endonym",
      "FF Pixel SC",
      "FF Pixel SC Endonym",
      "Fraunces",
    ]);

    const tokens = [...theme.matchAll(/(--ff-font[a-z-]*):/g)].map((match) => match[1]);
    expect([...new Set(tokens)].sort()).toEqual(["--ff-font-endonym", "--ff-font-ui", "--ff-font-wordmark"]);
  });

  it("sets every DOM family through one of the two tokens", () => {
    const strays: string[] = [];
    for (const { file, text } of styled) {
      for (const match of text.matchAll(/font-family:\s*([^;]+);/g)) {
        if (!FAMILY_TOKENS.includes(match[1]!.trim())) strays.push(`${file}: ${match[0]}`);
      }
      for (const match of text.matchAll(/(?<![-\w])font:\s*([^;]+);/g)) {
        const value = match[1]!.trim();
        if (value !== "inherit" && !FAMILY_TOKENS.some((token) => value.endsWith(token))) {
          strays.push(`${file}: ${match[0]}`);
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it("sets headings in the UI face, and Fraunces only in the wordmark", () => {
    const strays: string[] = [];
    for (const { file, text } of styled) {
      for (const { selector, body } of rulesOf(text)) {
        // A token's own definition (`--ff-font-wordmark: ...`) is not a use of it.
        const uses = body.split(";").some((line) => /^\s*(?!--)[a-z-]+:.*(?:--ff-font-wordmark|font-wordmark)/.test(line));
        if (uses && !/\.ff-wordmark/.test(selector)) strays.push(`${file}: ${selector}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("gives the wordmark class to the brand's wordmark alone, never to a translated line", () => {
    // `.ff-wordmark` sets Fraunces. A line a player reads in their language (the
    // winner, the unlock banner) wears it only by mistake: zh-Hans showed the
    // winner's Latin name in the serif beside Noto Sans SC.
    // The story's credits open on the brand's wordmark too (story mode v2 spec, "The ending and the credits").
    const BRAND_WORDMARKS = new Set(["features/boot/SplashRoot.svelte", "features/lobby/MenuHero.svelte", "features/story/StoryFinale.svelte"]);
    const strays = styled
      .filter(({ file }) => file.endsWith(".svelte") && !BRAND_WORDMARKS.has(file))
      .filter(({ text }) => /class="[^"]*\bff-wordmark\b/.test(text))
      .map(({ file }) => file);
    expect(strays).toEqual([]);
  });

  it("writes the winner line's classes as separate tokens, so its size applies", () => {
    // A lost space once fused `m-0` and the base size into `m-0text-[clamp(…)]`, a class Tailwind has no
    // rule for: the winner line then drew at the inherited size on every view that is not short or compact.
    const results = readFileSync(join(SRC, clientFile("ResultsPanel.svelte").replace("apps/client/src/", "")), "utf8");
    const tag = /<h1\s[^>]*data-testid="winner"[^>]*>/.exec(results)?.[0] ?? "";
    const tokens = (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/);
    expect(tokens).toContain("m-0");
    expect(tokens).toContain("text-[clamp(1.375rem,6vw,2rem)]");
  });

  it("fuses no two utilities into one class token anywhere in the markup", () => {
    // A utility that starts right after a digit or a bracket is the missing-space typo above.
    const fused = /[0-9\]](?:text|bg|font|border|rounded|leading|tracking|gap|[pm][xytblr]?|[wh]|min-[wh]|max-[wh])-(?:\[|[a-z0-9])/;
    const strays = styled
      .filter(({ file }) => file.endsWith(".svelte"))
      .flatMap(({ file, text }) =>
        [...text.matchAll(/\bclass="([^"{}]*)"/g)]
          .flatMap((match) => match[1]!.split(/\s+/))
          .filter((token) => fused.test(token.replace(/\[[^\]]*\]/g, "[]")))
          .map((token) => `${file}: ${token}`),
      );
    expect(strays).toEqual([]);
  });

  it("uses the regular, strong and heading weights only, and the heading weight only in a heading", () => {
    const strays: string[] = [];
    for (const { file, text } of styled) {
      for (const { selector, body } of rulesOf(text)) {
        for (const match of body.matchAll(/font-weight:\s*([^;]+)(?:;|$)|(?<![-\w])font:\s*(\d+)\s/g)) {
          const weight = (match[1] ?? match[2])!.trim();
          if (!WEIGHTS.includes(weight)) strays.push(`${file}: ${match[0]}`);
          else if (weight === "800" && !HEADINGS.has(selector)) strays.push(`${file}: 800 in ${selector}`);
        }
      }
      for (const match of text.matchAll(/(?<![-\w])font:\s*(\d+)\s/g)) {
        if (!WEIGHTS.includes(match[1]!)) strays.push(`${file}: ${match[0]}`);
      }
      for (const match of text.matchAll(/\bfont-(thin|extralight|light|medium|bold|extrabold|black)\b/g)) {
        strays.push(`${file}: ${match[0]}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("sets every size in the UI face on the font's 12 px grid", () => {
    // Fusion Pixel is drawn on a 12 px grid: only whole multiples of 12 CSS px are crisp.
    // A size is a token (the tokens are checked below), a `round(...)` to the hint step,
    // or a literal multiple of 12. Anything else blurs the pixels.
    const onGrid = (value: string): boolean => {
      const size = value.trim().replace(/^(?:\d{3}\s+)?/, "");
      if (/^(inherit|var\(--ff-(type|hud|step)-[a-z]+\)|round\(|max\(var\(--ff-type-hint\), round\()/.test(size)) return true;
      const literal = /^(\d+(?:\.\d+)?)px\b/.exec(size);
      return literal !== null && Number(literal[1]) % 12 === 0;
    };
    const strays: string[] = [];
    for (const { file, text } of styled) {
      for (const { selector, body } of rulesOf(text)) {
        // The wordmark is Fraunces (its size is snapped to the grid only in a CJK locale), and the boot-failure
        // screen is set before any face has loaded.
        if (/font-wordmark/.test(body) || /ff-boot-error/.test(selector)) continue;
        for (const match of body.matchAll(/(?<![-\w])(font-size|font):\s*([^;}\n]+)/g)) {
          const value = match[1] === "font" ? match[2]!.replace(/^\s*\d{3}\s+/, "").replace(/\s*\/.*$/, "") : match[2]!;
          if (!onGrid(value)) strays.push(`${file}: ${selector} { ${match[0].trim()} }`);
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it("uses no Tailwind text size that is off the grid in markup", () => {
    // Tailwind's `text-xs` is 12 px by default; the theme rebinds it to the hint size.
    const theme = readFileSync(join(SRC, clientFile("theme.css").replace("apps/client/src/", "")), "utf8");
    expect(theme).toMatch(/--text-xs:\s*var\(--ff-type-hint\)/);
    const strays: string[] = [];
    for (const { file, text } of styled) {
      for (const match of text.matchAll(/\btext-\[(\d+(?:\.\d+)?)px\]/g)) {
        if (Number(match[1]) % 12 !== 0) strays.push(`${file}: ${match[0]}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("names the type scale on the grid: hint 12, body 12, button 24, title 24, hero 36, display 48", () => {
    const tokens = readFileSync(join(SRC, clientFile("aquarian-tokens.css").replace("apps/client/src/", "")), "utf8");
    const size = (name: string): string | undefined => new RegExp(`--ff-step-${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim();
    expect(["hint", "body", "button", "title", "hero", "display"].map(size)).toEqual(["12px", "12px", "24px", "24px", "36px", "48px"]);
    // Every step, including the ones a short window lowers, is a whole multiple of 12.
    for (const match of tokens.matchAll(/--ff-step-[a-z]+:\s*(\d+)px/g)) expect(Number(match[1]) % 12).toBe(0);
    // The HUD's own sizes are on the grid too.
    for (const match of tokens.matchAll(/--ff-hud-(?:numeral|timer|value|label):\s*(\d+)px/g)) expect(Number(match[1]) % 12).toBe(0);
    // Inside the shell's zoom each step is divided by it, so it is whole on the glass.
    expect(tokens).toMatch(/\.ff-screen-frame__body[^{]*\{[^}]*--ff-type-hint:\s*calc\(var\(--ff-step-hint\) \/ var\(--ff-ui-zoom, 1\)\)/);
    // The seat and status badges (YOU, HOST) are the hint size.
    expect(tokens).not.toMatch(/--ff-type-tag:\s*1[0-3]px/);
  });

  it("sets canvas text through the shared stacks, at the same two weights", () => {
    const strays: string[] = [];
    for (const { file, text } of scripted) {
      for (const match of text.matchAll(/fontFamily:\s*([^,}\n]+)/g)) {
        const value = match[1]!.trim();
        // `this.fontFamily` is PlayerView's copy of FONT_UI or a fontUiFor stack, swapped on a language switch.
        if (value !== "FONT_UI" && value !== "FONT_WORDMARK" && value !== "this.fontFamily" && !value.startsWith("fontUiFor(")) strays.push(`${file}: ${match[0]}`);
      }
      for (const match of text.matchAll(/fontWeight:\s*["']?([\w.]+)["']?/g)) {
        if (isWordsFace(file, match[0])) continue;
        if (!WEIGHTS.includes(match[1]!)) strays.push(`${file}: ${match[0]}`);
      }
    }
    expect(strays).toEqual([]);
  });

  // The Latin stacks, in the plain :root block; each locale's is held in tests/client/features/i18n/fonts.test.ts.
  it("lets only the pop-up words set their own weight (Wonder spec §5.1)", () => {
    expect(isWordsFace(WORDS_FILE, "fontWeight: this.fontWeight")).toBe(true);
    expect(isWordsFace("features/race/name-tag.ts", "fontWeight: this.fontWeight")).toBe(false);
    expect(isWordsFace(WORDS_FILE, 'fontWeight: "900"')).toBe(false);
  });

  it("keeps the canvas stacks identical to the CSS tokens", async () => {
    const { FONT_UI, FONT_WORDMARK } = (await import(
      /* @vite-ignore */ join(SRC, "features/i18n/fonts.ts")
    )) as typeof import("../../../../apps/client/src/features/i18n/fonts");
    const theme = readFileSync(join(SRC, clientFile("theme.css").replace("apps/client/src/", "")), "utf8");
    const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(theme)?.[1]?.trim();
    expect(FONT_UI).toBe(token("--ff-font-ui"));
    expect(FONT_WORDMARK).toBe(token("--ff-font-wordmark"));
  });
});
