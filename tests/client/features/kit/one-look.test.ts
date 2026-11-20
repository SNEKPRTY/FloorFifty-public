/**
 * One look (Owner, 2026-11-19: "these UI elements are not adequately shared components", "never a
 * non-glossy panel"). A panel, a button, glass and arrive/leave motion are written once, in the kit
 * (`Panel`, `Button`, `IconButton`, `ViewSwitch`, `Toast`). A screen uses them and styles none of its own.
 * There are no exceptions: every file outside the kit keeps every rule.
 */

import { describe, expect, it } from "vitest";
import { nonKitFiles, ruleBreaks, ruleBreaksIn, type Rule } from "../../support/one-look";

/** Files outside the kit that break one of `rules`. */
function offenders(rules: Rule[]): string[] {
  return nonKitFiles().filter((file) => ruleBreaks(file).some((rule) => rules.includes(rule)));
}

describe("the one look", () => {
  it("only the kit writes the panel classes", () => {
    expect(offenders(["panel"])).toEqual([]);
  });

  it("only the kit writes the button class", () => {
    expect(offenders(["button"])).toEqual([]);
  });

  it("only the kit draws glass", () => {
    expect(offenders(["glass"])).toEqual([]);
  });

  it("a raw <button> is a reason, not a habit", () => {
    // A tile, the swipe surface and a touch control carry `data-motion="none"`: their own consequence is the motion.
    expect(offenders(["rawButton"])).toEqual([]);
  });

  it("only the kit wires arrive and leave", () => {
    expect(offenders(["motion"])).toEqual([]);
  });
});

describe("the rules see what they are meant to (planted violations)", () => {
  const svelte = "x/Screen.svelte";
  it.each([
    ["panel", '<div class="card ff-aquarian-panel">hi</div>'],
    ["panel", '<span class:ff-aq-hud={on}>hi</span>'],
    ["button", '<button data-motion="none" class="ff-aq-control ff-aq-control--go">Go</button>'],
    ["glass", "<style>.a { backdrop-filter: blur(4px); }</style>"],
    ["glass", "<style>.a { background: var(--ff-panel-fill); }</style>"],
    ["glass", '<div style:backdrop-filter="blur(16px)">x</div>'],
    ["glass", '<div style:-webkit-backdrop-filter={blur}>x</div>'],
    ["glass", '<div style:background="var(--ff-panel-fill)">x</div>'],
    ["rawButton", '<button type="button" onclick={go}>Go</button>'],
    ["motion", "<div in:fadeIn|global out:surfaceOut>x</div>"],
    ["motion", "<div use:riseIn={{ delay: 1 }}>x</div>"],
  ] as const)("%s: %s", (rule, source) => {
    expect(ruleBreaksIn(source, svelte)).toContain(rule);
  });

  it.each([
    ["a selector that hooks the class", "<style>:global(.ff-aq-hud) .a { color: red; }</style>", "panel"],
    ["a querySelector for the class", 'overlay.querySelectorAll(".ff-aq-hud")', "panel"],
    ["a custom property named after it", "<style>.a { --ff-aq-control-height: 48px; }</style>", "button"],
    ["a comment", "<!-- a ff-aquarian-panel -->\n/* ff-aq-control */", "panel"],
    ["a button that is its own motion", '<button data-motion="none" class="tile">x</button>', "rawButton"],
    ["a feature's own motion file", "<div use:popOnRise={{ count: 1 }}>x</div>", "motion"],
    ["a colour held in a tile", "<style>.a { color: var(--ff-panel-fill); }</style>", "glass"],
  ] as const)("does not trip on %s", (_name, source, rule) => {
    expect(ruleBreaksIn(source, svelte)).not.toContain(rule);
  });
});
