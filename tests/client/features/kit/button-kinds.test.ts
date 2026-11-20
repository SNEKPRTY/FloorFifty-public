/**
 * The three button colours (UI overhaul spec, "Buttons"): green is the one
 * step forward on a screen, red leaves or gives something up, blue is
 * everything else. This pins which button is which by `data-testid`, so a
 * button cannot drift to another colour, and pins the
 * rules that hold for every button: one green a screen, a white focus ring,
 * and a press that is a CSS drop and not a tween.
 *
 * Most of this reads the components' source, because a button's kind is a class
 * the markup names; the ActionBar, whose buttons are built from data, is mounted.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import gsap from "gsap";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import ActionBar from "../../../../apps/client/src/features/kit/layout/ActionBar.svelte";
import type { BarAction } from "../../../../apps/client/src/features/kit/layout/action-bar";
import { installUiMotion } from "../../../../apps/client/src/features/kit/ui-motion";
import { clientComponents, clientFile } from "../../support/client-source";
import { installFakeResizeObserver } from "../../support/resize-observer";

const ROOT = resolve(import.meta.dirname, "../../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

/**
 * The opening tag of the button that carries `data-testid`, read to its own `>` (not an arrow's).
 * A class named by a constant (`class={FORWARD}`) is read through the constant.
 */
function tagOf(file: string, testId: string): string {
  const source = read(file);
  // A plain id, or an expression written as `{...}` for a button whose id depends on state.
  const needle = testId.startsWith("{") ? `data-testid=${testId}` : `data-testid="${testId}"`;
  for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + 1)) {
    const start = source.lastIndexOf("<", at);
    // A raw `<button>`, or the kit's `<Button kind="go">`, which wears the same class.
    if (!source.startsWith("<button", start) && !source.startsWith("<Button", start)) continue;
    let depth = 0;
    for (let i = at; i < source.length; i += 1) {
      const char = source[i];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0 && source[i - 1] !== "=") {
        const tag = source.slice(start, i + 1);
        const named = /class=\{([A-Z_]+)\}/.exec(tag)?.[1];
        const value = named === undefined ? undefined : new RegExp(`const ${named} = "([^"]*)"`).exec(source)?.[1];
        const spelled = value === undefined ? tag : tag.replace(`{${named}}`, `"${value}"`);
        return spelled.replace(/\bkind="(go|stop)"/, 'class="ff-aq-control--$1"');
      }
    }
  }
  throw new Error(`${file} has no button with data-testid="${testId}"`);
}

/** Buttons whose class is written in the markup: `[file, data-testid]`. */
const GO: Array<[string, string]> = [
  [clientFile("TitleRoot.svelte"), "title-play"],
  [clientFile("ConnectPanel.svelte"), "find-race"],
  [clientFile("FullscreenPicker.svelte"), "lock-in"],
  [clientFile("SeedEditor.svelte"), "seed-confirm"],
  [clientFile("CharacterPage.svelte"), "character-pick"],
  [clientFile("PhotosensitivityWarning.svelte"), "photosensitivity-continue"],
  [clientFile("LanguageFirst.svelte"), "language-first-continue"],
  [clientFile("TutorialPrompt.svelte"), "tutorial-race-now"],
  [clientFile("PauseOverlay.svelte"), "pause-resume"],
  [clientFile("LandscapeGate.svelte"), "landscape-gate-fullscreen"],
];
const STOP: Array<[string, string]> = [
  [clientFile("PauseOverlay.svelte"), "pause-leave"],
  [clientFile("PauseOverlay.svelte"), "pause-leave-confirm"],
];
/** Everything else that is not a step forward or a way out, which stays blue. */
const PLAIN: Array<[string, string]> = [
  [clientFile("ConnectPanel.svelte"), '{hasCode ? "join-room" : "create-room"}'],
  [clientFile("LobbyRoot.svelte"), "tutorial-offer-accept"],
  [clientFile("LobbyRoot.svelte"), "tutorial-offer-skip"],
  [clientFile("PauseOverlay.svelte"), "pause-leave-cancel"],
  [clientFile("TitleRoot.svelte"), "title-settings"],
  [clientFile("TitleRoot.svelte"), "title-character"],
  // The error panel is a layer over a screen, not a screen: the screen beneath keeps the green.
  [clientFile("ErrorPanel.svelte"), "error-retry"],
  [clientFile("ErrorPanel.svelte"), "error-reload"],
  // Its Dismiss is the notice's own ×, which draws no green or red (Notice.svelte).
];

describe("the green step forward", () => {
  it.each(GO)("%s: %s is green", (file, testId) => {
    expect(tagOf(file, testId)).toContain("ff-aq-control--go");
  });
});

describe("the red way out", () => {
  it.each(STOP)("%s: %s is red", (file, testId) => {
    expect(tagOf(file, testId)).toContain("ff-aq-control--stop");
  });
});

describe("everything else is blue", () => {
  it.each(PLAIN)("%s: %s is neither green nor red", (file, testId) => {
    expect(tagOf(file, testId)).not.toMatch(/ff-aq-control--(?:go|stop)/);
  });

  it("leaves no .ff-aq-control--primary in the client", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.(svelte|css|ts)$/.test(entry.name) && read(path).includes("ff-aq-control--primary")) offenders.push(path);
      }
    };
    walk("apps/client/src");
    expect(offenders).toEqual([]);
  });
});

describe("the action bar's buttons", () => {
  let component: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (component !== undefined) unmount(component);
    component = undefined;
    document.body.innerHTML = "";
  });

  function classes(list: BarAction[]): Record<string, string[]> {
    const fake = installFakeResizeObserver();
    const host = document.body.appendChild(document.createElement("div"));
    component = mount(ActionBar, { target: host, props: { actions: list, measure: () => ({ available: 0, widths: [0, 0, 0] }) } });
    flushSync();
    const found = Object.fromEntries(
      [...host.querySelectorAll<HTMLElement>('[data-row="visible"] button')].map((button) => [button.dataset["testid"]!, [...button.classList]]),
    );
    fake.restore();
    return found;
  }
  const noop = (): void => {};

  it("makes a primary action green unless it says another tone", () => {
    const found = classes([
      { id: "go", label: "Go", kind: "primary", onSelect: noop },
      { id: "again", label: "Again", kind: "primary", tone: "plain", onSelect: noop },
    ]);
    expect(found["go"]).toContain("ff-aq-control--go");
    expect(found["again"]).not.toContain("ff-aq-control--go");
  });

  it("makes a secondary or utility action blue unless it says another tone", () => {
    const found = classes([
      { id: "leave", label: "Leave", kind: "secondary", tone: "stop", onSelect: noop },
      { id: "back", label: "Back", kind: "secondary", tone: "go", onSelect: noop },
      { id: "plain", label: "Plain", kind: "secondary", onSelect: noop },
      { id: "icon", label: "Icon", kind: "utility", onSelect: noop },
    ]);
    expect(found["leave"]).toContain("ff-aq-control--stop");
    expect(found["back"]).toContain("ff-aq-control--go");
    for (const id of ["plain", "icon"]) expect(found[id]).not.toContain("ff-aq-control--go");
  });

  it("colours the screens' own actions as the table says", () => {
    // The ready room's Ready is its primary (green); its Leave is red.
    const ready = read(clientFile("ReadyRoom.svelte"));
    expect(ready).toMatch(/id: "ready-toggle"[^}]*kind: "primary"/);
    expect(ready).toMatch(/id: "leave-room"[^}]*tone: "stop"/);
    // Results' Race again is its primary (green).
    expect(read(clientFile("ResultsPanel.svelte"))).toMatch(/id: "race-again"[^\n]*kind: "primary"/);
    // The replay's end: Back to results is the step forward; Watch again is blue.
    const replay = read(clientFile("ReplayControls.svelte"));
    expect(replay).toMatch(/id: "back"[^\n]*tone: "go"/);
    expect(replay).toMatch(/id: "watch-again"[^\n]*tone: "plain"/);
  });
});

/**
 * Dialogs that sit on a scrim of their own. Coordinator's ruling: "A dialog with a scrim is its own
 * screen, so SeedEditor's Confirm over Lock in passes." Each is a `Modal` user, which is the scrim.
 */
const SCRIM_DIALOGS = [clientFile("SeedEditor.svelte")];
/**
 * Components drawn together as one screen, outside any scrim dialog. A lobby is its frame and its
 * connect panel; the stage and song steps each draw the one Lock in.
 */
const SCREENS: Record<string, string[]> = {
  lobby: [clientFile("LobbyRoot.svelte"), clientFile("ConnectPanel.svelte")],
  "stage step": [clientFile("StageStep.svelte"), clientFile("FullscreenPicker.svelte")],
  "song step": [clientFile("SongStep.svelte"), clientFile("FullscreenPicker.svelte")],
};
const greensIn = (file: string): number => [...read(file).matchAll(/ff-aq-control--go|tone: "go"|kind="go"/g)].length;

describe("one green button on a screen", () => {
  it("is named once in each component, so no component draws two", () => {
    const offenders: string[] = [];
    for (const file of clientComponents()) {
      const greens = greensIn(file);
      if (greens > 1) offenders.push(`${file}: ${greens}`);
    }
    expect(offenders).toEqual([]);
  });

  it("draws one green across the components a screen is made of", () => {
    const offenders = Object.entries(SCREENS)
      .map(([screen, files]) => [screen, files.reduce((sum, file) => sum + greensIn(file), 0)] as const)
      .filter(([, greens]) => greens > 1)
      .map(([screen, greens]) => `${screen}: ${greens}`);
    expect(offenders).toEqual([]);
  });

  it("counts a dialog with a scrim as its own screen, not a part of the one beneath", () => {
    for (const file of SCRIM_DIALOGS) {
      expect(read(file), `${file} is a Modal user`).toMatch(/import Modal from/);
      for (const [screen, files] of Object.entries(SCREENS)) expect(files, `${screen} lists ${file}`).not.toContain(file);
    }
  });

  it("draws no green on the error panel: it lies over a screen that has its own", () => {
    // Coordinator's ruling: "The error panel over a screen is not its own screen: its Try again is blue
    // while the screen beneath has a green." Over the lobby it would otherwise be a second green beside
    // Find a race.
    expect(greensIn(clientFile("ErrorPanel.svelte"))).toBe(0);
    expect(read(clientFile("ErrorPanel.svelte"))).not.toMatch(/FORWARD/);
  });
});

describe("a rule for a class no button wears", () => {
  it("leaves no ghost-button rule in the results panel, whose action bar no longer adds the class", () => {
    expect(read(clientFile("ResultsPanel.svelte"))).not.toContain("ff-aq-control--ghost");
  });
});

describe("a button's own look", () => {
  const AQUARIAN = read("apps/client/src/features/kit/aquarian.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const STYLES = read("apps/client/src/features/kit/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (css: string, selector: string): string =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => match[1]!.split(",").some((part) => part.trim() === selector))
      .map((match) => match[2]!)
      .join("\n");

  it("gives each kind a face, a 2 px border and a lit bevel", () => {
    // A kind sets three custom properties and the base rule draws them, so blue is the default.
    const base = rule(AQUARIAN, ".ff-aq-control");
    expect(base).toMatch(/--ff-btn-face:\s*var\(--ff-plain\)/);
    expect(base).toMatch(/--ff-btn-edge:\s*var\(--ff-plain-edge\)/);
    expect(base).toMatch(/--ff-btn-bevel:\s*var\(--ff-plain-bevel\)/);
    expect(base).toMatch(/background:\s*var\(--ff-btn-face\)/);
    expect(base).toMatch(/border:\s*2px solid var\(--ff-btn-edge\)/);
    expect(base).toMatch(/box-shadow:\s*inset 0 1px 0 var\(--ff-btn-bevel\)/);
    const go = rule(AQUARIAN, ".ff-aq-control--go");
    expect(go).toMatch(/--ff-btn-face:\s*var\(--ff-go\)/);
    expect(go).toMatch(/--ff-btn-edge:\s*var\(--ff-go-edge\)/);
    // One size for every label: green is not set larger to make up for its contrast.
    expect(go).not.toMatch(/font-size/);
    expect(rule(AQUARIAN, ".ff-aq-control--stop")).toMatch(/--ff-btn-face:\s*var\(--ff-stop\)/);
  });

  it("draws a chosen option filled and every other option as the panel", () => {
    // A row of options that are all blue tells the chosen one only by a ring: the "reads the same"
    // defect. The chosen option is the blue one, so the others fall back to the panel's own face.
    const unchosen = rule(AQUARIAN, ".ff-option:not(.ff-option--selected)");
    expect(unchosen).toMatch(/--ff-btn-face:\s*var\(--ff-panel-fill\)/);
    expect(unchosen).toMatch(/--ff-btn-edge:\s*var\(--ff-panel-border\)/);
    expect(unchosen).toMatch(/--ff-btn-bevel:\s*var\(--ff-panel-bevel\)/);
    // The chosen option keeps the blue face.
    expect(rule(AQUARIAN, ".ff-option--selected")).toMatch(/background:\s*var\(--ff-plain\)/);
  });

  it("draws the tab that is not showing as the panel, as the options are", () => {
    const unchosen = rule(AQUARIAN, '.ff-aq-control[role="tab"][aria-selected="false"]');
    expect(unchosen).toMatch(/--ff-btn-face:\s*var\(--ff-panel-fill\)/);
    expect(unchosen).toMatch(/--ff-btn-edge:\s*var\(--ff-panel-border\)/);
    expect(unchosen).toMatch(/--ff-btn-bevel:\s*var\(--ff-panel-bevel\)/);
  });

  it("leaves a flat option's label white", () => {
    // White on the panel fill is 9:1 (`contrast.test.ts`), so the flat face needs no colour of its own.
    expect(rule(AQUARIAN, ".ff-aq-control")).toMatch(/color:\s*var\(--ff-text\)/);
    expect(rule(AQUARIAN, ".ff-option:not(.ff-option--selected)")).not.toMatch(/\bcolor:/);
  });

  it("presses by dropping the face 2 px and flipping the bevel, with no transition", () => {
    const pressed = rule(AQUARIAN, '.ff-aq-control:active:not(:disabled):not([aria-disabled="true"])');
    expect(pressed).toMatch(/translate:\s*0 2px/);
    expect(pressed).toMatch(/box-shadow:\s*inset 0 -1px 0/);
    expect(rule(AQUARIAN, ".ff-aq-control")).toMatch(/transition:\s*none/);
  });

  it("is focused by a white 2 px ring outside its border", () => {
    expect(rule(STYLES, ":focus-visible")).toMatch(/outline:\s*2px solid var\(--ff-text\)/);
    expect(rule(STYLES, ":focus-visible")).toMatch(/outline-offset:\s*2px/);
  });

  it("draws the focus ring visibly on the panel and on all three faces (3:1)", () => {
    const tokens = `${read("apps/client/src/features/kit/aquarian-tokens.css")}\n${read("packages/asset-contract/src/palette.css")}`;
    const hex = (token: string): string => {
      const value = new RegExp(`--${token}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim() ?? "";
      const alias = /^var\(--([a-z0-9-]+)\)$/.exec(value);
      return alias !== null ? hex(alias[1]!) : value;
    };
    const luminance = (color: string): number => {
      const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (const surface of ["ff-panel-fill", "ff-go", "ff-stop", "ff-plain"]) {
      const [high, low] = [luminance(hex("ff-text")), luminance(hex(surface))].sort((a, b) => b - a);
      expect((high! + 0.05) / (low! + 0.05), surface).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("a press", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });
  const pointer = (type: string) => new PointerEvent(type, { bubbles: true, pointerType: "mouse", pointerId: 1 });

  it("leaves no tween on a .ff-aq-control: the CSS drop is the whole press", () => {
    const root = document.body.appendChild(document.createElement("div"));
    root.innerHTML = `<button class="ff-aq-control">Go</button>`;
    const release = installUiMotion(root);
    const button = root.querySelector("button")!;
    for (const type of ["pointerover", "pointerdown", "pointerup", "pointerout"]) button.dispatchEvent(pointer(type));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(gsap.getTweensOf(button)).toHaveLength(0);
    release();
  });

  it("still refuses a disabled .ff-aq-control", () => {
    const root = document.body.appendChild(document.createElement("div"));
    root.innerHTML = `<button class="ff-aq-control" disabled>No</button>`;
    const release = installUiMotion(root);
    const button = root.querySelector("button")!;
    button.dispatchEvent(pointer("pointerdown"));
    expect(gsap.getTweensOf(button).length).toBeGreaterThan(0);
    release();
  });
});
