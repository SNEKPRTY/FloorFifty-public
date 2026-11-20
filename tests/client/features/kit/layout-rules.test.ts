// @vitest-environment node
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = async (path: string) => (await readFile(path, "utf8")).replace(/\s+/g, " ");

/** The CSS after the `@layer components { … }` block closes: unlayered, so it outranks scoped component styles. */
function unlayered(css: string): string {
  const start = css.indexOf("@layer components {");
  let depth = 0;
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(index + 1);
    }
  }
  return "";
}

describe("language layout rules (languages spec §6.3)", () => {
  it("sets the CJK rules outside the layer, keyed on :lang()", async () => {
    const css = unlayered(await read("apps/client/src/features/kit/aquarian.css"));
    expect(css).toMatch(/:root:lang\(ja\)[^{]*\{[^}]*line-break: strict/);
    expect(css).toMatch(/:root:lang\(zh-Hans\)[^{]*\{[^}]*line-break: strict/);
    expect(css).toMatch(/:root:lang\(ko\)[^{]*\{[^}]*word-break: keep-all/);
    expect(css).toMatch(/letter-spacing: 0;[^}]*text-transform: none|text-transform: none;[^}]*letter-spacing: 0/);
    expect(css).toMatch(/font-style: normal/);
  });

  it("drops tracking and case from every tracked label in CJK", async () => {
    const css = unlayered(await read("apps/client/src/features/kit/aquarian.css"));
    for (const label of [".ff-aq-label", ".ff-seat__tag", ".ff-hud__label", ".ff-hud__status", ".ff-rows__lock", ".ff-net-loader__badge", ".ff-boot-error h1", '[data-testid="connection-state"]']) {
      expect(css, label).toContain(label);
    }
  });

  it("lets a control wrap to two balanced lines in every locale, and never ellipsises one", async () => {
    const css = await read("apps/client/src/features/kit/aquarian.css");
    expect(css).toMatch(/\.ff-aq-control \{[^}]*text-wrap: balance/);
    const controls = [...css.matchAll(/\.ff-aq-control[^{,]*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
    expect(controls.filter((body) => /text-overflow:\s*ellipsis/.test(body))).toEqual([]);
  });

  it("lets the select headline take two lines held sideways, never an ellipsis on one: it is a heading, not a control", async () => {
    const css = await read("apps/client/src/features/select/SelectFrame.svelte");
    const sideways = /data-layout="sideways"\]\) \.ff-frame__headline \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(sideways).toMatch(/-webkit-line-clamp: 2/);
    expect(sideways).not.toMatch(/text-overflow: ellipsis|white-space: nowrap/);
  });
});

describe("the shell's scale (UI overhaul spec, \"Layout by form factor\")", () => {
  const tokens = async () => (await read("apps/client/src/features/kit/aquarian-tokens.css")).replace(/\/\*.*?\*\//g, "");
  /** The declarations of the first rule whose selector list is exactly `selector`. */
  const block = (css: string, selector: string): string | undefined =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) => match[1]!.trim() === selector)?.[2];

  it("grows the shell by a quarter on tablets and desktops, not on a short desktop window", async () => {
    const css = await tokens();
    expect(block(css, '[data-form-factor="tablet-portrait"]')).toMatch(/--ff-ui-zoom:\s*1\.25;/);
    expect(block(css, '[data-form-factor="desktop"]:not([data-height="short"])')).toMatch(/--ff-ui-zoom:\s*1\.25;/);
    // The old 1.2 / 1.4 tablet steps, and the 960 px block that raised it, are gone.
    expect(css).not.toMatch(/--ff-ui-zoom:\s*1\.[24];/);
    expect(css).not.toMatch(/@media \(min-width: 960px\)/);
    expect(css).not.toMatch(/\[data-form-factor="desktop"\]\[data-height="short"\][^}]*--ff-ui-zoom/);
  });

  it("holds the desktop's content to 880 px, which the zoom draws as 1100", async () => {
    expect(block(await tokens(), '[data-form-factor="desktop"]:not([data-height="short"])')).toMatch(/--ff-content-max:\s*880px;/);
  });

  it("reserves the split's body column at the zoomed width, so the sheet drawn inside it still fits", async () => {
    // The body is zoomed, so a sheet that is `--ff-sheet-width` wide in its own
    // units is drawn zoom times wider. A column of the unzoomed width left a
    // desktop's title buttons 27 px off the right edge (1440 x 900).
    const frame = await read("apps/client/src/features/kit/layout/ScreenFrame.svelte");
    expect(frame).toMatch(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, var\(--ff-split-body, calc\(var\(--ff-sheet-width\) \* var\(--ff-ui-zoom, 1\)\)\)\);/);
  });

  it("sets the room code and its label on the glass panel, since they stand over the sky", async () => {
    // Walk 43701633080 (es-419): white on the pale sky was unreadable on every view,
    // and the code is what a player reads out to a friend. Review R11 (#218): on the panel, not outlined.
    const roomCode = await read("apps/client/src/features/lobby/RoomCode.svelte");
    expect(roomCode).toMatch(/<Panel [^>]*class="ff-room-code /);
    const text = roomCode.match(/:global\(\.ff-room-code\) :global\(\.ff-aq-label\),[^{]*\{([^}]*)\}/)?.[1] ?? "";
    expect(text).toMatch(/color: var\(--ff-text\);/);
  });

  it("sets the start prompt on the glass panel, under the racer, since it stands on the sky", async () => {
    // Race screenshot, desktop 1440x900: white on pale cloud with a shadow below only read as "a:y key tc start".
    // Review R18 (#218): an outline at 30% still ran across the racer's name tag; it has a plate below her now.
    const hud = await read("apps/client/src/features/race/RaceHud.svelte");
    expect(hud).toMatch(/<Panel as="p" [^>]*class="ff-hud__start-prompt"/);
    const rule = hud.match(/:global\(\.ff-hud__start-prompt\) \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/top:\s*max\(62%/);
  });

  it("draws an iPad upright with the phone-upright layout, scaled", async () => {
    const css = await tokens();
    // One block for both, so the two cannot drift; the tablet's own block holds its zoom and the race HUD's floors number (the HUD sits outside the zoom).
    expect(block(css, '[data-form-factor="phone-portrait"], [data-form-factor="tablet-portrait"]')).toMatch(/--ff-touch-size:\s*76px;/);
    const tablet = block(css, '[data-form-factor="tablet-portrait"]')!;
    expect(tablet.match(/--[a-z-]+:/g)).toEqual(["--ff-ui-zoom:", "--ff-hud-numeral:"]);
  });
});

describe("the settings dialog's width (UI overhaul, batch 4)", () => {
  it("is as wide as the content maximum, not the narrow form width, where a body asks for two columns", async () => {
    const css = await read("apps/client/src/features/kit/Modal.svelte");
    const rule = /:global\(\.ff-modal__dialog\):has\(:global\(\[data-dialog-body\]\[data-two-up\]\)\) \{([^}]*)\}/.exec(css.replace(/\/\*.*?\*\//g, ""))?.[1] ?? "";
    expect(rule).toMatch(/max-width: min\(100%, var\(--ff-content-max\)\)/);
    // The short-band rule must not shrink it back below the content width.
    expect(css).toMatch(/max-width: min\(100%, max\(720px, var\(--ff-content-max\)\)\)/);
  });
});

describe("whole words (review R3)", () => {
  const read = (path: string): string => readFileSync(resolve(import.meta.dirname, "../../../..", path), "utf8");
  it("never splits a settings tab's word or a language's name", () => {
    const settings = read("apps/client/src/features/settings/SettingsPanel.svelte");
    expect(settings.match(/kind="ghost"[^>]*class="ff-settings__tab"/g)).toHaveLength(2);
    const tab = /\.ff-settings :global\(\.ff-settings__tab\) \{([^}]*)\}/.exec(settings)![1]!;
    expect(tab).toMatch(/hyphens:\s*none/);
    expect(tab).toMatch(/word-break:\s*keep-all/);
    const name = /\.ff-language-picker__name \{([^}]*)\}/.exec(read("apps/client/src/features/settings/LanguagePicker.svelte"))![1]!;
    expect(name).toMatch(/hyphens:\s*none/);
    expect(name).toMatch(/word-break:\s*keep-all/);
  });
});

describe("the ready room's panel (review R35)", () => {
  it("never rises over the corner row on a tall phone upright: safely at the foot, held to the room", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../../../..", "apps/client/src/features/lobby/ReadyRoom.svelte"), "utf8");
    const rule = /\.ff-ready\[data-arrangement="stack"\] :global\(\.ff-ready__chip\) \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/align-self:\s*safe end/);
    expect(rule).toMatch(/max-height:\s*100%/);
  });
});

describe("the hero above the panel on the smallest phone upright (review R6/R7)", () => {
  const read = (path: string): string => readFileSync(resolve(import.meta.dirname, "../../../..", path), "utf8");
  it("draws the character page's character smaller on a short upright screen, so she stands whole above the panel", () => {
    expect(read("apps/client/src/features/select/CharacterPage.svelte")).toMatch(/layout === "upright" && heightTier\.current !== undefined \? 3 : SCALE\[layout\]/);
  });
  it("keeps the title's corner to one row on a phone held upright: the language's word sits small under its flag", () => {
    const corners = read("apps/client/src/features/kit/layout/CornerControls.svelte");
    expect(corners).toMatch(/@container \(max-width: 400px\) \{\s*:global\(\.ff-corners__language\) \{\s*flex-direction: column;/);
    // It keeps its word, small under the flag: every button has a word.
    expect(corners).not.toMatch(/clip-path/);
  });
});
