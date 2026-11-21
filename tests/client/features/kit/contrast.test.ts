/**
 * WCAG AA on the surfaces phase 6 touches (polish spec §10.1, from the old
 * phase 6 gate): every DOM text and background pair, and a non-colour signal
 * for seat, ready, connection and standing.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
import { CONNECTION_LABELS } from "../../../../apps/client/src/features/net/connection-labels";
import { readClient } from "../../support/client-source";

const ROOT = resolve(import.meta.dirname, "../../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");
const TOKENS = `${read("apps/client/src/features/kit/aquarian-tokens.css")}\n${read("packages/asset-contract/src/palette.css")}`;

/** A token's hex, following one `var()` hop (`--ff-aq-white` is `var(--ff-ui-text)`). */
function hex(token: string): string {
  const value = new RegExp(`--${token}:\\s*([^;]+);`).exec(TOKENS)?.[1]?.trim();
  if (value === undefined) throw new Error(`no token --${token}`);
  const alias = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (alias !== null) return hex(alias[1]!);
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`--${token} is ${value}, not a hex`);
  return value;
}

const luminance = (color: string): number => {
  const [r, g, b] = [1, 3, 5]
    .map((at) => parseInt(color.slice(at, at + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (text: string, background: string): number => {
  const [high, low] = [luminance(hex(text)), luminance(hex(background))].sort((a, b) => b - a);
  return (high! + 0.05) / (low! + 0.05);
};

/** The world's brightest colour: what a frosted panel is drawn over in the worst case (palette.css's roles). */
const BRIGHTEST_WORLD = [...read("packages/asset-contract/src/palette.css").matchAll(/#[0-9a-fA-F]{6}\b/g)]
  .map((match) => match[0].toLowerCase())
  .sort((a, b) => luminance(b) - luminance(a))[0]!;

/**
 * A panel's drawn fill, in the worst case: the brightest world colour dimmed by the glass's own
 * `brightness()` (`--ff-panel-dim`, a backdrop filter the browser applies before it draws the fill),
 * then the fill at `--ff-panel-opacity` over that.
 */
function worstCasePanel(): string {
  const opacity = Number(/--ff-panel-opacity:\s*(\d+)%/.exec(TOKENS)?.[1]) / 100;
  const dim = Number(/--ff-panel-dim:\s*([\d.]+)/.exec(TOKENS)?.[1]);
  const channels = [1, 3, 5].map((at) => {
    const over = parseInt(hex("ff-panel-fill").slice(at, at + 2), 16);
    const under = parseInt(BRIGHTEST_WORLD.slice(at, at + 2), 16) * dim;
    return Math.round(opacity * over + (1 - opacity) * under);
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Contrast of a token's colour on a panel, measured on the solid fill and on the worst-case frosted one; the lower of the two. */
const onPanel = (text: string): number => {
  const [high, low] = [luminance(hex(text)), luminance(worstCasePanel())].sort((a, b) => b - a);
  return Math.min(ratio(text, "ff-panel-fill"), (high! + 0.05) / (low! + 0.05));
};

/**
 * Text on background: the panel is see-through over a darkened, blurred
 * backdrop (Owner, 2026-11-19 01:08Z, "More see-through, darker"), so every pair on a panel is
 * measured twice, on the solid fill and on the worst case, the fill over the
 * brightest world colour, and the lower figure must pass the same threshold
 * as before. Button faces are opaque.
 */
describe("WCAG AA on the menus' surfaces", () => {
  it("draws the panel over the world's brightest colour, which is white", () => {
    expect(BRIGHTEST_WORLD).toBe("#ffffff");
  });

  it("sets white on the panel fill at 9:1 or more, solid and over the brightest world colour", () => {
    expect(onPanel("ff-text")).toBeGreaterThanOrEqual(9);
  });

  it("sets secondary text on the panel fill at 4.5:1 or more, solid and over the brightest world colour", () => {
    expect(onPanel("ff-text-2")).toBeGreaterThanOrEqual(4.5);
  });

  it("draws the race's small buttons (the coach's OK) as kit buttons, so they carry a measured button face below and write no colour of their own", () => {
    for (const [file, testId] of [
      ["SwipeCoach.svelte", "swipe-coach-dismiss"],
    ] as const) {
      const source = readClient(file);
      expect(source, testId).toMatch(new RegExp(`<Button[^>]*data-testid="${testId}"`));
      expect(source, testId).not.toMatch(/ff-aq-control/);
    }
  });

  it("sets the HUD's replay mark in a colour that reads on a chip at 4.5:1 or more, at the label size", () => {
    const css = read("apps/client/src/features/race/RaceHud.svelte");
    const rule = /\.ff-hud__replay\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/font:\s*600 var\(--ff-type-hint\)/);
    const colour = /color:\s*var\(--([a-z0-9-]+)\)/.exec(rule)?.[1];
    expect(colour, "the mark's colour token").toBeDefined();
    expect(onPanel(colour!)).toBeGreaterThanOrEqual(4.5);
  });

  it("sets white on all three button faces at 4.5:1 or more, at any size", () => {
    // The weakest face (blue) measures 5.4:1, so no button label needs to be large to pass.
    for (const face of ["ff-go", "ff-stop", "ff-plain"]) expect(ratio("ff-text", face), face).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the old muted grey for disabled things only", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      for (const block of cssBlocks(read(file))) {
        const reads = block.body.some((line) => /^(?!--)[a-z-]+:.*var\(--ff-(?:text-off|ui-muted)\)/.test(line));
        if (reads && !/:disabled|\[aria-disabled/.test(block.selector)) offenders.push(`${file}: ${block.selector}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // The Owner's pick of 2026-11-18: the menus on Resurrect 64. A later palette is a deliberate edit of this table
  // and of `ui-palette.json`, and nothing else.
  it.each([
    ["ff-panel-fill", "#2e222f"],
    ["ff-panel-border", "#2e222f"],
    ["ff-panel-bevel", "#484a77"],
    ["ff-text-2", "#c7dcd0"],
    ["ff-text-off", "#7f708a"],
    ["ff-go", "#165a4c"],
    ["ff-go-edge", "#2e222f"],
    ["ff-go-bevel", "#239063"],
    ["ff-stop", "#ae2334"],
    ["ff-stop-edge", "#6e2727"],
    ["ff-stop-bevel", "#e83b3b"],
    ["ff-plain", "#4d65b4"],
    ["ff-plain-edge", "#2e222f"],
    ["ff-plain-bevel", "#4d9be6"],
    ["ff-glow", "#8fd3ff"],
    ["ff-danger", "#ed8099"],
  ])("draws %s as %s", (token, colour) => {
    expect(hex(token)).toBe(colour);
  });

  it("uses all of the UI palette, and nothing in the token files is outside it", () => {
    const palette = readPalette();
    const allowed = new Set(palette.map((entry) => entry.hex.toLowerCase()));
    const used = [...`${read("apps/client/src/features/kit/aquarian-tokens.css")}\n${read("apps/client/src/features/kit/theme.css")}`.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(
      (match) => match[0].toLowerCase(),
    );
    expect(used.filter((colour) => !allowed.has(colour)), "a colour outside the palette file").toEqual([]);
    expect([...allowed].filter((colour) => !used.includes(colour)), "a palette entry nothing uses").toEqual([]);
    // The palette file names each colour as the Wada dataset does, so a swatch can be traced.
    for (const entry of palette) expect(entry.name, entry.hex).not.toBe("");
  });

  // The spec: "Every colour a menu draws is a hex in that file or the palette's own white", and a test
  // fails on any other. So the scan covers every stylesheet and component under `ui/`, not two files: an
  // amber badge and a world red on a panel's edge once passed because nothing read their files.
  it("draws no hex outside Resurrect 64 anywhere under ui/", () => {
    const allowed = new Set(
      read("packages/asset-contract/palettes/resurrect64.hex")
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => /^[0-9a-f]{6}$/.test(line))
        .map((line) => `#${line}`),
    );
    const strays = uiFiles()
      .filter((file) => !(file in HEX_EXCEPTIONS))
      .flatMap((file) =>
        [...withoutComments(read(file)).matchAll(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/g)]
          .map((match) => match[0].toLowerCase())
          .filter((colour) => !allowed.has(colour))
          .map((colour) => `${file}: ${colour}`),
      );
    expect(strays).toEqual([]);
  });

  it("reads no world colour in a menu, apart from the named exceptions", () => {
    // The world's roles are everything `palette.css` defines but the palette's white. A menu that
    // reads one draws in Resurrect 64, which the menus do not.
    const world = [...read("packages/asset-contract/src/palette.css").matchAll(/(--ff-[a-z0-9-]+):/g)].map((match) => match[1]!).filter((name) => name !== "--ff-ui-text");
    const strays = uiFiles()
      .filter((file) => !file.endsWith("/theme.css")) // theme.css only binds Tailwind names to roles
      .flatMap((file) =>
        [...withoutComments(read(file)).matchAll(/var\((--ff-[a-z0-9-]+)/g)]
          .map((match) => match[1]!)
          .filter((name) => world.includes(name))
          .filter((name) => !(WORLD_READ_EXCEPTIONS[file] ?? []).some((prefix) => name.startsWith(prefix)))
          .map((name) => `${file}: ${name}`),
      );
    expect([...new Set(strays)]).toEqual([]);
  });

  it("keeps each exception to a file that still needs it", () => {
    // An exception nothing uses any more is a hole left open.
    for (const file of Object.keys(HEX_EXCEPTIONS)) expect(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/.test(withoutComments(read(file))), file).toBe(true);
    for (const [file, prefixes] of Object.entries(WORLD_READ_EXCEPTIONS)) {
      for (const prefix of prefixes) expect(read(file), `${file} reads ${prefix}`).toContain(`var(${prefix}`);
    }
  });

  it("has no old Aquarian colour names left", () => {
    // The old names were aliases of the new roles while the screens moved over. With every screen on the
    // new names, an old one is a second way to say the same colour, and the old blue is not a UI colour.
    const old = /--ff-aq-(?:pearl|ice|edge|ink|muted|action|action-hover|glow|surface|shadow|panel-radius|control-radius|hud-radius)(?![\w-])/;
    const sources = [...clientFiles(), "apps/client/index.html"];
    expect(sources.filter((file) => old.test(read(file)))).toEqual([]);
    expect(sources.filter((file) => /#4f9bff/i.test(read(file)))).toEqual([]);
  });

  it("shows every pager dot, not only the current one, at 3:1 on the panel", () => {
    // The stage picker's dots were the panel's own colour, so only the lit one showed and the
    // player could not see where in the list they were.
    const source = read("apps/client/src/features/kit/layout/PagerDots.svelte");
    const fill = (selector: string): string =>
      /background:\s*var\(--([a-z0-9-]+)\)/.exec(new RegExp(`${selector.replace(/[.[\]"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(source)![1]!)![1]!;
    const rest = fill(".ff-pager__pip");
    // The current dot's own pip steps aside for the lit marker standing on it.
    const current = fill(".ff-pager__marker::before");
    expect(onPanel(rest), rest).toBeGreaterThanOrEqual(3);
    expect(onPanel(current), current).toBeGreaterThanOrEqual(3);
    expect(hex(rest)).not.toBe(hex(current));
  });

  it("draws an unchosen option's whole edge at 3:1 on the panel, so every choice reads as a button", () => {
    // The race length and minutes the player had not picked were the panel's face inside the
    // panel's own edge colour, so "20", "50", "1" and "5" read as bare numbers, not buttons.
    const source = read("apps/client/src/features/kit/layout/OptionGroup.svelte");
    const rule = /:global\(\.ff-option:not\(\.ff-option--selected\)\)\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    const edge = /--ff-btn-edge:\s*var\(--([a-z0-9-]+)\)/.exec(rule)?.[1];
    expect(edge, "an unchosen option names its own edge").toBeDefined();
    expect(onPanel(edge!), edge).toBeGreaterThanOrEqual(3);
  });

  it("tints a refusal chip's edge, not its words", () => {
    // The world's red on the panel is about 2.2:1, too faint for words; the danger colour is a mark, at 3:1.
    const rule = /:global\(\.chip\[data-tone="danger"\]\)\s*\{([^}]*)\}/.exec(read("apps/client/src/features/kit/Chip.svelte"))![1]!;
    expect(rule).not.toMatch(/(?<![-\w])color:/);
    expect(rule).toMatch(/border-color:\s*var\(--ff-danger\)/);
  });

  it("marks the boot-error panel's edge in the danger colour, not the world's red", () => {
    const rule = /\.ff-boot-error\s*\{([^}]*)\}/.exec(read("apps/client/src/features/kit/styles.css"))![1]!;
    expect(/border:\s*2px solid var\(--(ff-[a-z-]+)\)/.exec(rule)?.[1]).toBe("ff-danger");
    // A non-text mark on the panel's own fill, held to WCAG's 3:1 (1.4.11).
    expect(onPanel("ff-danger")).toBeGreaterThanOrEqual(3);
    expect(read("apps/client/src/features/kit/styles.css")).not.toMatch(/var\(--ff-floor-/);
  });

  it("draws the Featured badge from the palette, at 4.5:1", () => {
    const tag = /<span\s[^>]*data-testid="mode-featured-badge"[^>]*>/.exec(read("apps/client/src/features/kit/layout/OptionGroup.svelte"))?.[0] ?? "";
    const background = /\bbg-\[var\(--(ff-[a-z-]+)\)\]/.exec(tag)?.[1];
    const text = /\btext-\[var\(--(ff-[a-z-]+)\)\]/.exec(tag)?.[1];
    // Tailwind draws nothing for `text-black` here (theme.css clears every colour), so the label
    // would take the button's white and the badge would be white on amber.
    expect(background, "the badge's background names a palette token").toBeDefined();
    expect(text, "the badge's text names a palette token").toBeDefined();
    expect(ratio(text!, background!)).toBeGreaterThanOrEqual(4.5);
  });
});

/** The palette file: each colour's Wada name, hex and role. */
function readPalette(): Array<{ name: string; hex: string; role: string }> {
  return JSON.parse(read("apps/client/src/features/kit/ui-palette.json")) as Array<{ name: string; hex: string; role: string }>;
}

/** A source without its comments, so a comment that quotes a colour or a role is not a use of it. */
const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

/**
 * Files under `ui/` allowed a hex of their own, each with the reason. A new entry is a deliberate edit
 * here, not a quiet one.
 */
const HEX_EXCEPTIONS: Record<string, string> = {};

/**
 * Files under `ui/` allowed to read a world colour, by the variable's prefix, each with the reason. Where it
 * is a debt, the reason says what rebuild removes it. A new entry is a deliberate edit here.
 */
const WORLD_READ_EXCEPTIONS: Record<string, string[]> = {
  // The colour a player is: the scarf shown beside a name, a seat, a character's dot. Identity, not decoration.
  "apps/client/src/features/kit/aquarian.css": ["--ff-player-"],
  "apps/client/src/features/race/RaceHud.svelte": ["--ff-player-"],
  "apps/client/src/features/select/CharacterPage.svelte": ["--ff-player-"],
};

/** Every file under the client's source whose name matches `kinds`. */
function filesUnder(kinds: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (kinds.test(entry.name)) out.push(path);
    }
  };
  walk("apps/client/src");
  return out;
}

/** Every `.svelte` and `.css` file under the client's source. */
const sourceFiles = (): string[] => filesUnder(/\.(svelte|css)$/);

/** Every file under the client's source that can name a style: sheets, components and scripts. */
const clientFiles = (): string[] => filesUnder(/\.(svelte|css|ts|html)$/);

/** Every `.svelte` and `.css` file in the client, where every menu is drawn. */
const uiFiles = (): string[] => sourceFiles().filter((file) => file.startsWith("apps/client/src/"));

/** The rules of a stylesheet or a `<style>` block: a selector and its declarations. */
function cssBlocks(source: string): Array<{ selector: string; body: string[] }> {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.trim(),
    body: match[2]!.split(";").map((line) => line.trim()),
  }));
}

// "Offline" is a problem notice. Its words are the signal, so they stay the
// primary text; the danger colour marks the notice's left edge, a non-text mark
// held to WCAG's 3:1 (1.4.11). It was 3.3:1 as text, older than this gate.
describe("the connection indicator's Offline", () => {
  const offline = /\[data-tone="problem"\]\)?\s*{([^}]*)}/.exec(read("apps/client/src/features/kit/Notice.svelte"))![1]!;
  const token = (property: string): string | undefined =>
    new RegExp(`(?:^|[;\\s])${property}:\\s*(?:[^;]*\\s)?var\\(--([a-z0-9-]+)\\)`).exec(offline)?.[1];

  it("keeps its words at least 4.5:1, in the primary text unless it says otherwise", () => {
    expect(onPanel(token("color") ?? "ff-text")).toBeGreaterThanOrEqual(4.5);
  });

  it("still marks the notice in the danger colour, at least 3:1 as a non-text mark", () => {
    expect(token("border-left")).toBe("ff-danger");
    expect(onPanel("ff-danger")).toBeGreaterThanOrEqual(3);
  });
});

describe("a signal beyond colour", () => {
  const READY_ROOM = read("apps/client/src/features/lobby/ReadyRoom.svelte");
  const RESULTS = read("apps/client/src/features/results/ResultsPanel.svelte");
  const CONNECTION = read("apps/client/src/features/net/ConnectionIndicator.svelte");

  it("numbers every seat", () => {
    expect(READY_ROOM).toMatch(/data-testid="seat-number"[\s\S]*?>\{seat\.index \+ 1\}</);
  });

  // The words come from the catalogue (phase 5); English is checked here.
  const en = { locale: "en" } as const;

  it("says Ready or Waiting in words, and marks Ready with the stamp's shape", () => {
    expect(READY_ROOM).toMatch(/player\.ready \? m\.ready_ready\(\) : m\.ready_waiting\(\)/);
    expect([m.ready_ready({}, en), m.ready_waiting({}, en)]).toEqual(["Ready", "Waiting"]);
    expect(READY_ROOM).toMatch(/\.ff-ready__stamp::before\s*{\s*content: "✓"/);
  });

  it("says the connection's state in words", () => {
    expect(CONNECTION).toContain("{CONNECTION_LABELS[state]()}");
    expect(CONNECTION_LABELS.reconnecting).toBe(m.shell_connection_reconnecting);
    expect(CONNECTION_LABELS.offline).toBe(m.shell_connection_offline);
    expect([m.shell_connection_reconnecting({}, en), m.shell_connection_offline({}, en)]).toEqual(["Reconnecting…", "Offline"]);
  });

  it("numbers every standing", () => {
    expect(RESULTS).toMatch(/class="ff-result__place">\{placed \? `\$\{index \+ 1\}` : "—"\}</);
  });
});

describe("the splash's start line, on a lighter plate (Owner, 2026-11-19 04:45Z)", () => {
  it("is the glass with its own lighter tokens, and its white words still read at 9:1 over the brightest world under the splash's wash", () => {
    const splash = read("apps/client/src/features/boot/SplashRoot.svelte");
    const rule = /\.ff-splash__ready\[data-ready="true"\] \{([^}]*)\}/.exec(splash)?.[1] ?? "";
    const opacity = Number(/--ff-panel-opacity:\s*(\d+)%/.exec(rule)?.[1]) / 100;
    const dim = Number(/--ff-panel-dim:\s*([\d.]+)/.exec(rule)?.[1]);
    // Lighter than the shared glass: less fill, less dimming.
    expect(opacity).toBeLessThan(Number(/--ff-panel-opacity:\s*(\d+)%/.exec(TOKENS)?.[1]) / 100);
    expect(dim).toBeGreaterThan(Number(/--ff-panel-dim:\s*([\d.]+)/.exec(TOKENS)?.[1]));
    // What the plate sees: the brightest world colour under the splash's ink wash (`.ff-splash--art`).
    const wash = Number(/\.ff-splash--art \{\s*background: color-mix\(in srgb, var\(--ff-panel-border\) (\d+)%/.exec(splash)?.[1]) / 100;
    expect(wash).toBeGreaterThan(0);
    const channels = [1, 3, 5].map((at) => {
      const fill = parseInt(hex("ff-panel-fill").slice(at, at + 2), 16);
      const ink = parseInt(hex("ff-panel-border").slice(at, at + 2), 16);
      const under = (wash * ink + (1 - wash) * parseInt(BRIGHTEST_WORLD.slice(at, at + 2), 16)) * dim;
      return Math.round(opacity * fill + (1 - opacity) * under);
    });
    const plate = `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    const [high, low] = [luminance(hex("ff-text")), luminance(plate)].sort((a, b) => b - a);
    expect((high! + 0.05) / (low! + 0.05)).toBeGreaterThanOrEqual(9);
  });
});
