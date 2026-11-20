import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { renderBootFailure } from "../../../../apps/client/src/features/boot/boot-failure";

// Audit S15: the boot failure panel wrote the library's raw error.message onto the screen. It is the screen for "the
// server is down", and docs/copy-style.md forbids both jargon and a library's own text. Owner's string C,
// 2026-11-14: "The game could not load. Check your connection, then try again."
describe("renderBootFailure", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
  });

  it("wears the kit's glass and rise, and the green button, so it is a panel like every other (Owner: glass only)", () => {
    renderBootFailure(host, new Error("boom"));
    const panel = host.querySelector<HTMLElement>('[data-testid="boot-error"]')!;
    expect(panel.classList.contains("ff-aquarian-panel")).toBe(true);
    expect(panel.classList.contains("ff-panel-arrive")).toBe(true);
    expect(host.querySelector('[data-testid="boot-retry"]')!.className).toBe("ff-aq-control ff-aq-control--go");
  });

  it("says the game could not load and what to do, in the game's words", () => {
    renderBootFailure(host, new Error("boom"));
    expect(host.querySelector("h1")!.textContent).toBe("Floor Fifty cannot start");
    expect(host.querySelector(".ff-reason")!.textContent).toBe("The game could not load. Check your connection, then try again.");
    expect(host.querySelector("button")!.textContent).toBe("Try again");
  });

  it("never shows the error's own text", () => {
    renderBootFailure(host, new Error("WebGLRenderingContext: CONTEXT_LOST_WEBGL at pixi.mjs:1:2"));
    expect(host.textContent).not.toContain("WebGL");
    expect(host.textContent).not.toContain("pixi");
    renderBootFailure(host, "TypeError: Failed to fetch");
    expect(host.textContent).not.toContain("TypeError");
  });
});

// The failure page keeps to what the page has without the game's art (spec, "Boot failed"), so its look is the
// inline style in index.html, spelled out in the UI palette, and the stylesheet's copy of it.
describe("the boot failure's inline look", () => {
  const INDEX = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/index.html"), "utf8");
  const SHEET = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/kit/styles.css"), "utf8");
  const rule = (css: string, selector: string): string => {
    const escaped = selector.replace(/[.#[\]="]/g, "\\$&");
    const match = new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
    if (match === null) throw new Error(`no rule for ${selector}`);
    return match[1]!;
  };
  const style = /<style>([\s\S]*?)<\/style>/.exec(INDEX)![1]!;

  it("draws the loader's ring in the UI blue", () => {
    expect(rule(style, ".ff-boot-loader__ring")).toContain("#4d9be6");
    expect(INDEX).not.toContain("#4f9bff");
  });

  for (const [name, css] of [["index.html", style], ["the stylesheet", SHEET]] as const) {
    it(`sets the heading in sentence case in ${name}`, () => {
      expect(rule(css, ".ff-boot-error h1")).not.toMatch(/uppercase/);
    });

    it(`keeps the panel at least 16 px from every edge in ${name}`, () => {
      const panel = rule(css, ".ff-boot-error");
      expect(panel).toMatch(/width:\s*calc\(100% - 32px\)/);
      // The page's own copy is solid, for when the stylesheet itself failed to load; the stylesheet's
      // draws no fill, because the panel wears the kit's glass (below).
      if (name === "index.html") expect(panel).toMatch(/background:\s*#2e222f/);
      else expect(panel).not.toMatch(/background:/);
    });

    if (name === "index.html") {
      it(`draws Try again as the green button in ${name}`, () => {
        expect(rule(css, ".ff-boot-error button")).toMatch(/#165a4c|var\(--ff-go\)/);
      });
    }
  }

  it("keeps Try again at the title size, not the kit button's, which shrinks sideways on a phone", () => {
    expect(rule(SHEET, ".ff-boot-error button")).toMatch(/font-size:\s*var\(--ff-type-title\)/);
  });

  it("stands in the middle of the screen, across and down (Owner, 2026-11-19)", () => {
    // Both copies: the page's inline style, drawn before the stylesheet loads, and the stylesheet's.
    for (const file of ["apps/client/index.html", "apps/client/src/features/kit/styles.css"]) {
      const css = readFileSync(resolve(import.meta.dirname, "../../../..", file), "utf8");
      const rule = /\.ff-boot-error\s*\{([^}]*)\}/.exec(css)![1]!;
      // A fixed box on every edge with automatic margins centres both ways, at any height.
      expect(rule, file).toMatch(/position:\s*fixed/);
      expect(rule, file).toMatch(/inset:\s*0/);
      expect(rule, file).toMatch(/margin:\s*auto;/);
      expect(rule, file).toMatch(/height:\s*fit-content/);
      expect(rule, file).not.toMatch(/\d+vh/);
      // And reads centred (review R37): the box's edge is a colour the page is not, all the way
      // round, and its words and button sit in its middle, not against a left bar.
      expect(rule, file).toMatch(/border:\s*2px solid (#ed8099|var\(--ff-danger\));/);
      expect(rule, file).not.toMatch(/border-left:/);
      expect(rule, file).toMatch(/text-align:\s*center/);
    }
  });
});

