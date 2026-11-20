// @vitest-environment node
/**
 * What a panel is (UI overhaul spec, "Panels", as changed by the Owner's card of
 * 2026-11-18 15:16Z, "Rounder, light frost", which supersedes the spec's "solid,
 * not glass"): a rounded chip 85% opaque over a soft blur,
 * with a dark two-pixel border and a one-pixel bevel inside it, solid with no
 * blur on a software renderer and under "reduce transparency", and padded 16 px
 * on a phone and 24 px from a tablet up. Read from the style
 * sheets, since a panel's look is its CSS and a jsdom render has no layout.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");
/** A style sheet without its comments, so a comment about a gradient is not one. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

const AQUARIAN = stripComments(read("apps/client/src/features/kit/aquarian.css"));
const TOKENS = stripComments(read("apps/client/src/features/kit/aquarian-tokens.css"));

/** The declarations of every rule whose selector list names `selector`. */
function rulesFor(css: string, selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1]!.split(",").some((part) => part.trim() === selector))
    .map((match) => match[2]!);
}

/** Every stylesheet and component under `ui/`. */
const UI = "apps/client/src";
const files = (dir: string): string[] =>
  readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(`${dir}/${entry.name}`) : /\.(svelte|css)$/.test(entry.name) ? [`${dir}/${entry.name}`] : [],
  );

/** Every panel class: the base and the race's chip. */
const PANELS = [".ff-aquarian-panel", ".ff-aq-hud"];

describe("a panel", () => {
  it("is one glass rule for the menus' panel and the race's chip, over a dimmed, blurred, saturated backdrop", () => {
    const rules = [...AQUARIAN.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => /\.ff-aquarian-panel\b/.test(match[1]!) && /backdrop-filter:\s*blur/.test(match[2]!));
    expect(rules, "one rule draws the glass").toHaveLength(1);
    const [selectors, body] = [rules[0]![1]!, rules[0]![2]!];
    expect(selectors).toContain(".ff-aq-hud");
    expect(body).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--ff-panel-fill\)\s+var\(--ff-panel-opacity\),\s*transparent\)/);
    expect(body).toMatch(/backdrop-filter:\s*blur\(var\(--ff-panel-blur\)\)\s+brightness\(var\(--ff-panel-dim\)\)\s+saturate\(var\(--ff-panel-saturate\)\)/);
    const opacity = Number(/--ff-panel-opacity:\s*(\d+)%/.exec(TOKENS)?.[1]);
    const blur = Number(/--ff-panel-blur:\s*(\d+)px/.exec(TOKENS)?.[1]);
    const dim = Number(/--ff-panel-dim:\s*([\d.]+)/.exec(TOKENS)?.[1]);
    const saturate = Number(/--ff-panel-saturate:\s*([\d.]+)/.exec(TOKENS)?.[1]);
    // The Owner's "More see-through, darker" (2026-11-19 01:08Z): a fill of 60 to 70%, over a backdrop dimmed to
    // under 0.7 of its light, so the game shows through dark and white text still holds 9:1 (`contrast.test.ts`).
    expect(opacity).toBeGreaterThanOrEqual(60);
    expect(opacity).toBeLessThanOrEqual(70);
    expect(dim).toBeLessThan(0.7);
    // How much of the game shows through: more than the old 85% fill's 15%, or the choice was not honoured.
    expect((1 - opacity / 100) * dim).toBeGreaterThan(0.17);
    expect(blur).toBeGreaterThanOrEqual(16);
    expect(blur).toBeLessThanOrEqual(24);
    expect(saturate).toBeGreaterThanOrEqual(1.5);
  });

  it("has no gradient anywhere", () => {
    for (const selector of PANELS) {
      for (const body of rulesFor(AQUARIAN, selector)) expect(body, `${selector} reads a gradient`).not.toMatch(/gradient/);
    }
  });

  it("is fully solid with no blur on a software renderer, the race's chip too", () => {
    const body = rulesFor(AQUARIAN, ':root[data-renderer="software"] .ff-aquarian-panel').join("\n");
    expect(rulesFor(AQUARIAN, ':root[data-renderer="software"] .ff-aq-hud').join("\n")).toMatch(/backdrop-filter:\s*none/);
    expect(body).toMatch(/background:\s*var\(--ff-panel-fill\)/);
    expect(body).toMatch(/backdrop-filter:\s*none/);
  });

  it("is fully solid with no blur when the player asks for less transparency", () => {
    const block = /@media \(prefers-reduced-transparency: reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(AQUARIAN)?.[1] ?? "";
    expect(block).toMatch(/\.ff-aquarian-panel/);
    expect(AQUARIAN).toMatch(/@media \(prefers-reduced-transparency: reduce\)\s*\{[^@]*\.ff-aq-hud\s*\{[^}]*backdrop-filter:\s*none/);
    expect(block).toMatch(/background:\s*var\(--ff-panel-fill\)/);
    expect(block).toMatch(/backdrop-filter:\s*none/);
  });

  it("draws every corner from the one radius token", () => {
    expect(rulesFor(TOKENS, ":root").join("\n")).toMatch(/--ff-panel-radius:\s*(\d+)px/);
    const radius = Number(/--ff-panel-radius:\s*(\d+)px/.exec(TOKENS)?.[1]);
    expect(radius, "rounder than the old 4 px").toBeGreaterThanOrEqual(8);
    expect(radius).toBeLessThanOrEqual(16);
    expect(rulesFor(TOKENS, ":root").join("\n")).toMatch(/--ff-control-radius:\s*calc\(var\(--ff-panel-radius\)/);
  });

  it("has the 2 px outline border and the 1 px bevel", () => {
    for (const selector of [".ff-aquarian-panel", ".ff-aq-hud"]) {
      const body = rulesFor(AQUARIAN, selector).join("\n");
      expect(body, selector).toMatch(/border:\s*2px solid var\(--ff-panel-border\)/);
      expect(body, selector).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--ff-panel-bevel\)/);
      expect(body, selector).toMatch(/border-radius:\s*var\(--ff-panel-radius\)/);
    }
    // Both draw the same frosted mix.
    expect(rulesFor(AQUARIAN, ".ff-aq-hud").join("\n")).toMatch(/background:\s*color-mix\(/);
  });

  it("keeps no panel tier that draws it differently", () => {
    // One panel look: the old `--glass` and `--solid` tiers are gone from the sheet and from every
    // screen, so a later tier cannot bring a second look back.
    for (const selector of [".ff-aquarian-panel--glass", ".ff-aquarian-panel--solid"]) expect(rulesFor(AQUARIAN, selector), selector).toEqual([]);
    const users = files(UI).filter((file) => /ff-aquarian-panel--(?:glass|solid)/.test(stripComments(read(file))));
    expect(users).toEqual([]);
  });

  it("is padded 16 px on a phone and 24 px on a desktop (an iPad upright is a scaled phone)", () => {
    const declared = (selector: string): string | undefined =>
      rulesFor(TOKENS, selector)
        .map((body) => /--ff-panel-pad:\s*([^;]+);/.exec(body)?.[1]?.trim())
        .find((value) => value !== undefined);
    expect(declared(":root")).toBe("24px");
    // An iPad upright draws the phone-upright layout (one block for both), so it is padded 16 too,
    // and the shell's zoom makes that a quarter larger.
    expect(declared('[data-form-factor="phone-portrait"]')).toBe("16px");
    expect(declared('[data-form-factor="tablet-portrait"]')).toBe("16px");
    expect(declared('[data-form-factor="phone-landscape"]')).toBe("16px");
    // The desktop declares none of its own, so it takes the root's 24.
    expect(declared('[data-form-factor="desktop"]')).toBeUndefined();
  });

  it("is a dialog's padding too", () => {
    expect(rulesFor(TOKENS, ":root").join("\n")).toMatch(/--ff-dialog-pad:\s*var\(--ff-panel-pad\)/);
  });
});

describe("the page's surfaces", () => {
  // The one white page: the studio's own screen at launch, white by the Owner's ask (2026-11-18).
  const WHITE_SCREEN = "apps/client/src/features/boot/StudioSplash.svelte";

  it("leaves no --ff-aq-white surface", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (path !== WHITE_SCREEN && /\.(svelte|css)$/.test(entry.name)) {
          for (const match of stripComments(read(path)).matchAll(/background(?:-color|-image)?:[^;}]*--ff-aq-white[^;}]*/g)) {
            offenders.push(`${path}: ${match[0].trim()}`);
          }
        }
      }
    };
    walk("apps/client/src");
    expect(offenders).toEqual([]);
  });
});

/**
 * The frost has one source, in every menu file and not only `aquarian.css`. A component's own style
 * block that draws a surface see-through, or blurs what is behind it, brings a second glass back, so
 * every stylesheet and component under `ui/` is read: only the panel rule in `aquarian.css` may blur.
 */
describe("a menu surface", () => {
  /** The one file that frosts: its panel rule is pinned above (`is frosted`). */
  const PANEL_RULE_FILE = "apps/client/src/features/kit/aquarian.css";
  const SOURCES = files(UI).map((file) => ({ file, text: stripComments(read(file)) }));

  /**
   * Files with a see-through surface still to remove, each with the reason: an empty list is the goal.
   * A scrim (a dimmer of the panel border colour) is not a surface, and a gradient is art; neither is matched.
   */
  const TRANSLUCENT_UNTIL: Record<string, string> = {};

  it("blurs only in the panel and chip rules", () => {
    expect(SOURCES.filter(({ text }) => /backdrop-filter/.test(text)).map(({ file }) => file)).toEqual(["apps/client/src/features/kit/aquarian.css"]);
    const blurs = [...stripComments(read("apps/client/src/features/kit/aquarian.css")).matchAll(/([^{}]+)\{([^{}]*backdrop-filter:\s*blur[^{}]*)\}/g)];
    expect(blurs.map((match) => match[1]!.replace(/\s+/g, " ").trim())).toEqual([".ff-aquarian-panel, .ff-aq-hud"]);
  });

  it("is not a panel colour mixed with transparent, outside the one panel rule", () => {
    const surface = /background(?:-color)?:\s*color-mix\(in srgb,\s*var\(--ff-(?:aq-pearl|aq-white|aq-ice|aq-surface|panel-fill)\)[^;]*transparent/;
    const strays = SOURCES.filter(({ file, text }) => surface.test(text) && !(file in TRANSLUCENT_UNTIL) && file !== PANEL_RULE_FILE).map(({ file }) => file);
    expect(strays).toEqual([]);
  });

  it("lists an exception only while its file still has the surface", () => {
    for (const file of Object.keys(TRANSLUCENT_UNTIL)) {
      const text = SOURCES.find((source) => source.file === file)?.text ?? "";
      expect(/background(?:-color)?:\s*color-mix\(in srgb,\s*var\(--ff-panel-fill\)[^;]*transparent/.test(text), file).toBe(true);
    }
  });

  it("keeps the dialogs' scrim light enough that the glass shows what is behind it", () => {
    // Owner, 2026-11-18 22:22Z: "why only the chips and not the modals". The dialog is the same frosted
    // panel as a chip, but a 45% dark scrim behind it left nothing bright for the blur to frost.
    const modal = stripComments(read("apps/client/src/features/kit/Modal.svelte"));
    const scrim = /\.ff-modal\s*\{[^}]*?background:\s*color-mix\(in srgb,\s*var\(--ff-panel-border\)\s*(\d+)%/.exec(modal);
    expect(scrim, "the modal's scrim rule").not.toBeNull();
    expect(Number(scrim![1])).toBeLessThanOrEqual(25);
    // The dialog is the kit's Panel, rising by the shared keyframe.
    expect(modal).toMatch(/<Panel[^>]*class="ff-panel-arrive ff-modal__dialog/);
  });
});

