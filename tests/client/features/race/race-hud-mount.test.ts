/**
 * The race HUD as it is actually mounted.
 *
 * `race-hud.test.ts` covers the numbers. These are the properties only a
 * mounted component has: that exactly one HUD is in the overlay at a time, that
 * it releases its DOM, and that it is invisible to the pointer -- which is the
 * one that would hurt most, because a chip that swallowed a pointer would take
 * a touch control with it and the player would lose a movement they had already
 * started.
 *
 * jsdom has no layout and no hit testing, so the pointer claim is asserted
 * against the component's own source, the way `motion.test.ts` asserts the
 * rules that are about how a module is written.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RaceHudView } from "../../../../apps/client/src/features/race/race-hud.svelte";
import { fakeStage } from "../../support/fakes/stage";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
import { inputMethod } from "../../../../apps/client/src/features/platform/input-method.svelte";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const COMPONENT = resolve(
  import.meta.dirname,
  "../../../../apps/client/src/features/race/RaceHud.svelte",
);
const SOURCE = readFileSync(COMPONENT, "utf8");

const lobby = () =>
  snapshotAt(300, {
    raceStartedAtTick: 0,
    floorCount: 20,
    players: [
      playerSnapshot({ id: LOCAL_ID, name: "Kite", progress: 6 / 20 }),
      playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", status: "dns" }),
    ],
  });

/** Mounts one HUD and lets Svelte patch the DOM. */
function mount(stage = fakeStage()) {
  const view = new RaceHudView(stage);
  return { stage, view };
}

const settle = (): void => flushSync();
/** The words a node holds itself, not those of an element inside it. */
const ownText = (node: Element): string =>
  [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join("").trim();
/** Waits out an element's exit: a leaving toast is still in the page for a turn. */
const gone = (find: () => unknown): Promise<void> => vi.waitFor(() => expect(find()).toBeNull());

describe("a CPU's mood word in the standings (CPU banding spec §4)", () => {
  const withCpu = () =>
    snapshotAt(300, {
      raceStartedAtTick: 0,
      floorCount: 20,
      players: [
        playerSnapshot({ id: LOCAL_ID, name: "Kite", progress: 1 / 20 }),
        playerSnapshot({ id: REMOTE_ID, name: "Sunny", colour: "gold", cpu: true, progress: 8 / 20 }),
      ],
    });
  const barkOn = (stage: ReturnType<typeof fakeStage>) =>
    stage.overlay.querySelector<HTMLElement>(`[data-testid="hud-row"][data-seat="1"] [data-testid="hud-bark"]`);

  it("pops beside the CPU's row, wherever the CPU is on the course, and goes after its moment", () => {
    const { stage, view } = mount();
    view.update(withCpu(), LOCAL_ID, 0);
    view.bark(REMOTE_ID, "Ta-da!", 0);
    view.update(withCpu(), LOCAL_ID, 100);
    settle();
    expect(barkOn(stage)?.textContent?.trim()).toBe("Ta-da!");
    view.update(withCpu(), LOCAL_ID, 2_000);
    settle();
    expect(barkOn(stage)).toBeNull();
    view.destroy();
  });

  it("never moves the row it pops beside", () => {
    expect(SOURCE).toMatch(/\.ff-hud__bark\s*{[^}]*position:\s*absolute/);
  });
});

describe("the standings rows slide into place when their order changes", () => {
  const two = (first: typeof LOCAL_ID, second: typeof LOCAL_ID) =>
    snapshotAt(300, {
      raceStartedAtTick: 0,
      floorCount: 20,
      players: [
        playerSnapshot({ id: first, name: first === LOCAL_ID ? "Kite" : "Wren", progress: 4 / 20 }),
        playerSnapshot({ id: second, name: second === LOCAL_ID ? "Kite" : "Wren", progress: 8 / 20 }),
      ],
    });

  it("runs `flip` on a row that moved, and on none that stood still", () => {
    // jsdom lays nothing out: a row's place is its index, thirty pixels a row.
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const top = this.matches('[data-testid="hud-row"]') ? [...(this.parentElement?.children ?? [])].indexOf(this) * 30 : 0;
      return { top, left: 0, bottom: top + 30, right: 100, width: 100, height: 30, x: 0, y: top, toJSON: () => ({}) };
    });
    const animate = vi.spyOn(Element.prototype, "animate");
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    try {
      view.update(two(LOCAL_ID, REMOTE_ID), LOCAL_ID, 0);
      settle();
      animate.mockClear();
      view.update(two(LOCAL_ID, REMOTE_ID), LOCAL_ID, 100);
      settle();
      expect(animate, "rows that stand still do not move").not.toHaveBeenCalled();
      view.update(two(REMOTE_ID, LOCAL_ID), LOCAL_ID, 200);
      settle();
      const moved = animate.mock.contexts.filter((node) => (node as Element).matches('[data-testid="hud-row"]'));
      expect(moved, "both rows swapped places").toHaveLength(2);
      expect(JSON.stringify(animate.mock.calls[0]![0])).toContain("translate(");
    } finally {
      view.destroy();
      rect.mockRestore();
      animate.mockRestore();
    }
  });
});

describe("the mounted race HUD", () => {
  it("marks the replay beside the timer, its capitals left to CSS", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage, { replay: true });
    view.update(lobby(), LOCAL_ID, 0);
    settle();
    const chip = stage.overlay.querySelector('[data-testid="hud-replay"]');
    expect(chip?.textContent).toBe("Replay");
    view.destroy();

    const race = new RaceHudView(stage);
    race.update(lobby(), LOCAL_ID, 0);
    settle();
    expect(stage.overlay.querySelector('[data-testid="hud-replay"]')).toBeNull();
    race.destroy();
  });

  it("mounts exactly one HUD and renders the model into it", () => {
    const { stage, view } = mount();

    view.update(lobby(), LOCAL_ID, 0);
    settle();

    expect(stage.overlay.querySelectorAll('[data-testid="race-hud"]')).toHaveLength(1);
    expect(stage.overlay.querySelector('[data-testid="hud-floors"]')?.textContent).toContain("06 / 20");
    expect(stage.overlay.querySelector('[data-testid="hud-timer"]')?.textContent?.trim()).toBe("0:05.0");
    expect(stage.overlay.querySelector('[data-testid="hud-lap"]')?.textContent).toContain("1/1");

    view.destroy();
  });

  it("shows a row per racer, in seat order, with the whole name and a status", () => {
    const { stage, view } = mount();

    view.update(lobby(), LOCAL_ID, 0);
    settle();

    const rows = [...stage.overlay.querySelectorAll('[data-testid="hud-row"]')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("data-seat")).toBe("0");
    expect(rows[0]?.getAttribute("data-local")).toBe("true");
    expect(rows[1]?.getAttribute("data-status")).toBe("dns");

    // The ellipsis is an affordance, not a truncation of the value: the whole
    // name is in the DOM and in `title`.
    const name = rows[1]?.querySelector(".ff-hud__name");
    expect(name?.textContent).toBe("Ninja Two");
    expect(name?.getAttribute("title")).toBe("Ninja Two");
    // And the status is a word beside the seat colour, not the colour alone.
    expect(rows[1]?.textContent).toContain("Did not start");

    view.destroy();
  });

  it("leaves one HUD after repeated race-again transitions", () => {
    // Race again destroys and re-enters the screen. A HUD that mounted without
    // unmounting would stack up one per race, and the oldest would sit under
    // the newest showing a finished race's numbers.
    const stage = fakeStage();
    for (let race = 0; race < 5; race += 1) {
      const view = new RaceHudView(stage);
      view.update(lobby(), LOCAL_ID, 0);
      settle();
      expect(stage.overlay.querySelectorAll('[data-testid="race-hud"]')).toHaveLength(1);
      view.destroy();
      settle();
      expect(stage.overlay.querySelectorAll('[data-testid="race-hud"]')).toHaveLength(0);
    }
  });

  it("re-lays itself out when the viewport changes", () => {
    // A rotation is a plain resize. A HUD that latched the rectangle it was
    // built with would be laid out for the orientation before last.
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    settle();
    expect(stage.overlay.querySelector('[data-testid="race-hud"]')?.getAttribute("data-orientation")).toBe(
      "landscape",
    );

    stage.emitViewport({
      canvasCss: { x: 0, y: 0, width: 390, height: 844 },
      gameplayCss: { x: 0, y: 300, width: 390, height: 244 },
      sceneryLogical: { x: 0, y: 0, width: 960, height: 540 },
      portrait: true,
      formFactor: "phone-portrait",
      fieldLogical: { width: 960, height: 720 },
      pixelRatio: 1,
    });
    settle();

    expect(stage.overlay.querySelector('[data-testid="race-hud"]')?.getAttribute("data-orientation")).toBe(
      "portrait",
    );
    view.destroy();
  });

  it("renders the Infinite clock outside the live region, enlarged when urgent (race-options spec §5.5)", () => {
    const { stage, view } = mount();
    const endless = snapshotAt(10_200, {
      raceStartedAtTick: 0,
      floorCount: 60,
      tuning: { ...snapshotAt(0).tuning, COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 },
      players: [playerSnapshot({ id: LOCAL_ID, y: 400, bestFloor: 7 }), playerSnapshot({ id: REMOTE_ID, name: "Wren", bestFloor: 9 })],
    });
    view.update(endless, LOCAL_ID, 0, 10_260);
    settle();

    const clock = stage.overlay.querySelector('[data-testid="hud-clock"]');
    expect(clock?.textContent?.trim()).toBe("0:09");
    expect(clock?.getAttribute("data-urgent")).toBe("true");
    expect(clock?.closest("[aria-live]")).toBeNull();
    expect(stage.overlay.querySelector('[data-testid="hud-best"]')?.textContent).toContain("7");
    expect(stage.overlay.querySelector('[data-testid="hud-best"]')?.textContent).toMatch(/^Best floor\s*▲\s*7$/);
    expect(stage.overlay.querySelector('[data-testid="hud-timer"]')).toBeNull();
    const leaders = [...stage.overlay.querySelectorAll('[data-leader="true"]')];
    expect(leaders.length).toBeGreaterThan(0);
    view.destroy();
  });
});

describe("the timer as restart", () => {
  it("is a plain chip without a restart handler", () => {
    const { stage, view } = mount();
    view.update(lobby(), LOCAL_ID, 0);
    settle();
    expect(stage.overlay.querySelector('[data-testid="hud-restart"]')).toBeNull();
    expect(stage.overlay.querySelector('[data-testid="hud-timer"]')?.closest("button")).toBeNull();
    view.destroy();
  });

  it("offers no restart in Survival, where a reset does nothing (survival spec §3)", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage, { onRestart: () => {} });
    view.update(
      snapshotAt(600, {
        raceStartedAtTick: 0,
        floorCount: 60,
        tuning: { ...snapshotAt(0).tuning, COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 },
        players: [playerSnapshot({ id: LOCAL_ID })],
      }),
      LOCAL_ID,
      0,
      661,
    );
    settle();
    expect(stage.overlay.querySelector('[data-testid="hud-restart"]')).toBeNull();
    expect(stage.overlay.querySelector('[data-testid="hud-clock"]')?.textContent?.trim()).toBe("2:49");
    view.destroy();
  });

  it("darkens the edges with the danger, and calls OUT (survival spec §7)", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    const tuning = { ...snapshotAt(0).tuning, COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 };
    view.update(
      snapshotAt(600, { raceStartedAtTick: 0, floorCount: 60, tuning, players: [playerSnapshot({ id: LOCAL_ID, y: 110, floorEdgeY: 100 })] }),
      LOCAL_ID,
      0,
      600,
    );
    settle();
    const vignette = stage.overlay.querySelector<HTMLElement>('[data-testid="survival-vignette"]')!;
    expect(Number(vignette.style.opacity)).toBeGreaterThan(0.9);
    expect(stage.overlay.querySelector('[data-testid="out-banner"]')).toBeNull();
    view.update(
      snapshotAt(700, {
        raceStartedAtTick: 0,
        floorCount: 60,
        tuning,
        players: [playerSnapshot({ id: LOCAL_ID, y: 90, floorEdgeY: 100, outAtTick: 650, finishedAtTick: 650 })],
      }),
      LOCAL_ID,
      0,
      700,
    );
    settle();
    expect(stage.overlay.querySelector('[data-testid="out-banner"]')?.textContent).toBe("OUT!");
    expect(Number(vignette.style.opacity)).toBe(0);
    view.destroy();
  });

  it("restarts on a tap when given one, and still shows the time", () => {
    const stage = fakeStage();
    let restarts = 0;
    const view = new RaceHudView(stage, { onRestart: () => restarts++ });
    view.update(lobby(), LOCAL_ID, 0);
    settle();

    const button = stage.overlay.querySelector<HTMLButtonElement>('[data-testid="hud-restart"]')!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.querySelector('[data-testid="hud-timer"]')?.textContent?.trim()).toBe("0:05.0");
    button.click();
    expect(restarts).toBe(1);
    view.destroy();
  });
});

describe("what the HUD must not do", () => {
  it("cannot receive a pointer anywhere over the course", () => {
    // The claim that matters: this sits in the same overlay as the touch
    // controls, over the same canvas. A chip that intercepted a pointer would
    // take a movement with it -- and the input a player notices losing is the
    // one they already started holding.
    expect(SOURCE).toContain("pointer-events: none");
    // Exactly three opt-ins: the pause button (launch polish §3.1.1) and the
    // touch timer's restart, both in the top metric row, and the compact
    // screen's standings pill in the top corner (UI layout spec §4.4) -- all
    // away from the touch controls and the swipe surface's lower half, so no
    // steering touch starts on them. The portrait standings line, in the
    // lower half, takes none.
    expect(SOURCE.match(/pointer-events: auto/g)).toHaveLength(3);
    expect(SOURCE).toMatch(/:global\(\.ff-hud__summary\) \{[^}]*pointer-events: auto/);
    expect(SOURCE).toMatch(/:global\(\.ff-hud__standing\) \{[^}]*pointer-events: none/);
    expect(SOURCE).toMatch(/:global\(\.ff-hud__pause\) \{[^}]*pointer-events: auto/);
    expect(SOURCE).toMatch(/:global\(\.ff-hud__restart\) \{[^}]*pointer-events: auto/);
  });

  it("announces nothing on a timer", () => {
    // A running clock in a live region is unusable: it would interrupt a screen
    // reader ten times a second. Phase and status changes have the HUD's one
    // polite region (race-flow spec §6).
    expect(SOURCE).not.toContain('aria-live="assertive"');
    // One polite region for the race's phase and status changes (race-flow spec §6), and no other.
    expect(SOURCE.match(/aria-live=/g)).toHaveLength(1);
    expect(SOURCE).toContain('aria-live="polite"');
    // The lap banner and the pulse rest under reduced motion; the pulse keeps its outline.
    expect(SOURCE).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.ff-hud__lap-banner[\s\S]*animation: none/);
  });

  it("never sets HUD type below twelve CSS pixels", () => {
    // The floor the spec sets, and the reason the HUD moved to the DOM: the
    // drawn one had to sit on an eight-pixel grid, and its roster rows were
    // already at the smallest size that face allowed.
    // Every size is a token or a `round()` to the hint step, and the tokens are
    // whole multiples of 12 (Fusion Pixel's grid).
    const sizes = [...SOURCE.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1]!.trim());
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toMatch(/^(var\(--ff-(hud|type)-[a-z]+\)|round\()/);
    const tokens = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/kit/aquarian-tokens.css"), "utf8");
    for (const match of tokens.matchAll(/--ff-hud-(?:numeral|timer|value|label):\s*(\d+)px/g)) {
      expect(Number(match[1]) % 12).toBe(0);
    }
  });
});

describe("the portrait HUD", () => {
  const PORTRAIT = {
    canvasCss: { x: 0, y: 0, width: 390, height: 844 },
    gameplayCss: { x: 0, y: 60, width: 390, height: 219 },
    sceneryLogical: { x: 0, y: -148, width: 960, height: 2077 },
    portrait: true,
    formFactor: "phone-portrait" as const,
    fieldLogical: { width: 960, height: 720 },
    pixelRatio: 1,
  };

  it("says the local racer's place and who leads, in one line, on a phone upright", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    stage.emitViewport(PORTRAIT);
    view.update(
      snapshotAt(300, {
        raceStartedAtTick: 0,
        floorCount: 20,
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", progress: 1 / 20 }),
          playerSnapshot({ id: REMOTE_ID, name: "Wren", progress: 8 / 20 }),
        ],
      }),
      LOCAL_ID,
      0,
    );
    settle();
    const line = stage.overlay.querySelector<HTMLElement>('[data-testid="hud-standings-line"]');
    expect(line?.textContent?.trim()).toBe("2nd / 2 · Wren leads");
    expect(line?.classList.contains("ff-aq-hud")).toBe(true);
    expect(stage.overlay.querySelector('[data-testid="hud-pips"]')).toBeNull();
    expect(stage.overlay.querySelector('[data-testid="hud-pip"]')).toBeNull();
    view.destroy();
  });

  it("shows a CPU's mood word under the standings line on a phone upright, in its scarf colour, without moving the line", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    stage.emitViewport(PORTRAIT);
    const cpu = () =>
      snapshotAt(300, {
        raceStartedAtTick: 0,
        floorCount: 20,
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite", progress: 1 / 20 }),
          playerSnapshot({ id: REMOTE_ID, name: "Sunny", colour: "gold", cpu: true, progress: 8 / 20 }),
        ],
      });
    view.update(cpu(), LOCAL_ID, 0);
    settle();
    const line = stage.overlay.querySelector<HTMLElement>('[data-testid="hud-standings-line"]')!;
    const before = ownText(line);
    expect(line.querySelector('[data-testid="hud-bark"]')).toBeNull();
    view.bark(REMOTE_ID, "Ta-da!", 0);
    view.update(cpu(), LOCAL_ID, 100);
    settle();
    const bark = line.querySelector<HTMLElement>('[data-testid="hud-bark"]');
    expect(bark?.textContent?.trim()).toBe("Ta-da!");
    expect(bark?.style.color).toContain("--ff-player-");
    expect(bark?.getAttribute("aria-hidden")).toBe("true");
    expect(ownText(line)).toBe(before?.trim());
    view.update(cpu(), LOCAL_ID, 2_000);
    settle();
    expect(line.querySelector('[data-testid="hud-bark"]')).toBeNull();
    view.destroy();
  });

  it("says only the place when the local racer leads", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    stage.emitViewport(PORTRAIT);
    view.update(lobby(), LOCAL_ID, 0);
    settle();
    expect(stage.overlay.querySelector('[data-testid="hud-standings-line"]')?.textContent?.trim()).toBe("1st / 2");
    expect(stage.overlay.querySelector('[data-testid="hud-roster"]')).toBeNull();
    expect(stage.overlay.querySelector('[data-testid="hud-floors"]')).not.toBeNull();
    view.destroy();
  });

  it("says nothing of standings with one racer", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage, { solo: true });
    stage.emitViewport(PORTRAIT);
    view.update(lobby(), LOCAL_ID, 0);
    settle();
    expect(stage.overlay.querySelector('[data-testid="hud-standings-line"]')).toBeNull();
    view.destroy();
  });

  it("gives a tablet held upright the named roster as a band, not pips (spec §5.4)", () => {
    // A tablet has room for the names, so it keeps the full roster markup and
    // lays it out as a band above the thumbs. The lap stays in the metric row
    // once: the roster's own lap heading is a landscape thing.
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    stage.emitViewport({
      ...PORTRAIT,
      canvasCss: { x: 0, y: 0, width: 820, height: 1180 },
      gameplayCss: { x: 0, y: 60, width: 820, height: 820 },
      formFactor: "tablet-portrait",
      fieldLogical: { width: 960, height: 960 },
    });
    view.update(lobby(), LOCAL_ID, 0);
    settle();

    const roster = stage.overlay.querySelector<HTMLElement>('[data-testid="hud-roster"]');
    expect(roster).not.toBeNull();
    expect(stage.overlay.querySelector('[data-testid="hud-pips"]')).toBeNull();
    expect(stage.overlay.querySelectorAll('[data-testid="hud-row"]')).toHaveLength(2);
    expect(stage.overlay.querySelectorAll('[data-testid="hud-lap"]')).toHaveLength(1);
    expect(stage.overlay.querySelector('[data-testid="race-hud"]')?.getAttribute("data-band")).toBe("roster");
    view.destroy();
  });

  it("keeps a racer's name on the left of the row, whatever else the row holds", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    view.update(lobby(), LOCAL_ID, 0);
    settle();
    for (const row of stage.overlay.querySelectorAll<HTMLElement>('[data-testid="hud-row"]')) {
      const cells = [...row.children].map((cell) => (cell as HTMLElement).className);
      const name = cells.findIndex((c) => c.includes("ff-hud__name"));
      // Only the seat's dot and number come before the name; the status and the climb bar follow it.
      expect(name).toBeGreaterThanOrEqual(0);
      expect(cells.slice(0, name).every((c) => /ff-hud__(dot|place|leader|bark)/.test(c))).toBe(true);
      const tail = cells.findIndex((c) => c.includes("ff-hud__row-tail"));
      if (tail >= 0) expect(tail).toBeGreaterThan(name);
    }
    view.destroy();
  });

  it("keeps the full roster in landscape", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    view.update(lobby(), LOCAL_ID, 0);
    settle();

    expect(stage.overlay.querySelector('[data-testid="hud-roster"]')).not.toBeNull();
    expect(stage.overlay.querySelector('[data-testid="hud-pip"]')).toBeNull();
    view.destroy();
  });
});

describe("the landscape HUD (spec §2.8 item 12)", () => {
  it("lays out like the Aquarian board: a two-line floors chip, a lap tile and a roster of dots", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    view.update(lobby(), LOCAL_ID, 0);
    settle();

    const floors = stage.overlay.querySelector('[data-testid="hud-floors"]')!;
    expect(floors.querySelector(".ff-hud__label")?.textContent).toBe("Floors");
    expect(floors.querySelector(".ff-hud__value--large")?.textContent?.trim()).toBe("06 / 20");

    // The lap is a tile of the metric row now (UI layout spec §4.4), once.
    const laps = stage.overlay.querySelectorAll('[data-testid="hud-lap"]');
    expect(laps).toHaveLength(1);
    expect(laps[0]?.textContent).toContain("1/1");
    expect(laps[0]?.closest("[data-hud-metrics]")).not.toBeNull();

    const roster = stage.overlay.querySelector('[data-testid="hud-roster"]')!;

    const rows = [...roster.querySelectorAll('[data-testid="hud-row"]')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // Plain rows inside the one panel, not a chip per racer.
      expect(row.classList.contains("ff-aq-hud")).toBe(false);
      expect(row.querySelector(".ff-hud__dot")).not.toBeNull();
    }
    // Each racer's progress as a bar (restored after review): Kite is at 6/20.
    const fill = rows[0]!.querySelector<HTMLElement>(".ff-hud__track .ff-hud__fill");
    expect(fill).not.toBeNull();
    expect(fill!.style.width).toBe("30%");
    expect(rows[1]!.textContent).toContain("Did not start");
    view.destroy();
  });

  it("keeps the lap in the portrait metric row, not in the standings line", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    stage.emitViewport({
      canvasCss: { x: 0, y: 0, width: 390, height: 844 },
      gameplayCss: { x: 0, y: 60, width: 390, height: 219 },
      sceneryLogical: { x: 0, y: -148, width: 960, height: 2077 },
      portrait: true,
      formFactor: "phone-portrait",
      fieldLogical: { width: 960, height: 720 },
      pixelRatio: 1,
    });
    view.update(lobby(), LOCAL_ID, 0);
    settle();

    const lap = stage.overlay.querySelector('[data-testid="hud-lap"]');
    expect(lap?.closest('[aria-label="Race progress"]')).not.toBeNull();
    expect(lap?.closest('[data-testid="hud-standings-line"]')).toBeNull();
    view.destroy();
  });

  it("shows the lap banner for the local racer's hold, and pulses another racer's lap chip", () => {
    const { stage, view } = mount();
    const players = (remoteLap: number, hold?: number) => [
      playerSnapshot({ id: LOCAL_ID, lap: 2, ...(hold === undefined ? {} : { holdUntilTick: hold }) }),
      playerSnapshot({ id: REMOTE_ID, lap: remoteLap }),
    ];
    view.update(snapshotAt(100, { lapCount: 3, players: players(1, 140) }), LOCAL_ID, 0);
    flushSync();
    expect(stage.overlay.querySelector('[data-testid="lap-banner"]')?.textContent).toBe("LAP 2");
    view.update(snapshotAt(103, { lapCount: 3, players: players(2, 140) }), LOCAL_ID, 50);
    flushSync();
    const remote = [...stage.overlay.querySelectorAll('[data-testid="hud-row"]')].find((row) => row.getAttribute("data-local") !== "true");
    expect(remote?.getAttribute("data-pulse")).toBe("true");
    view.destroy();
  });

  it("keeps a lap chip and a status word in one grid cell, so a DNS racer's row stays one row", () => {
    // The row is a five-column grid and the climb bar is pinned to the fifth.
    // A chip and a status each taking a cell of their own pushed the bar onto a
    // second row, doubling the row of any ghost or DNS racer in a multi-lap
    // race (measured in Chromium: 19 px became 29 px). jsdom has no layout, so
    // this pins the structure that prevents it.
    const { stage, view } = mount();
    view.update(
      snapshotAt(100, {
        lapCount: 3,
        players: [
          playerSnapshot({ id: LOCAL_ID, name: "Kite" }),
          playerSnapshot({ id: REMOTE_ID, name: "Ninja Two", status: "dns" }),
        ],
      }),
      LOCAL_ID,
      0,
    );
    flushSync();
    const row = [...stage.overlay.querySelectorAll('[data-testid="hud-row"]')].find((r) => r.getAttribute("data-status") === "dns")!;
    const chip = row.querySelector('[data-testid="hud-row-lap"]')!;
    const status = row.querySelector(".ff-hud__status")!;
    expect(chip.parentElement).toBe(status.parentElement);
    expect(chip.parentElement).not.toBe(row);
    expect(row.querySelector(".ff-hud__track")?.parentElement).toBe(row);
    view.destroy();
  });

  it("says what the announcer gives it, in one polite region", () => {
    const { stage, view } = mount();
    view.update(snapshotAt(0), LOCAL_ID, 0);
    view.announce(["Wren finished first"]);
    flushSync();
    const region = stage.overlay.querySelector('[data-testid="race-announcer"]')!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("Wren finished first");
    view.announce([]);
    flushSync();
    expect(region.textContent).toBe("Wren finished first");
    view.destroy();
  });
});

const browserHeight = {
  canvasCss: { x: 0, y: 0, width: 780, height: 270 },
  gameplayCss: { x: 0, y: 7, width: 780, height: 256 },
  sceneryLogical: { x: 0, y: 0, width: 960, height: 540 },
  portrait: false,
  formFactor: "phone-landscape" as const,
  fieldLogical: { width: 960, height: 540 },
  pixelRatio: 1,
};

describe("the standings at a browser's height", () => {
  it("collapses to one pill that says your place and the leader", () => {
    const stage = fakeStage();
    stage.emitViewport(browserHeight);
    const view = new RaceHudView(stage);
    view.update(lobby(), LOCAL_ID, 0);
    settle();
    const pill = stage.overlay.querySelector<HTMLButtonElement>('[data-testid="hud-standings-pill"]');
    expect(pill?.textContent?.trim()).toBe("1st / 2");
    expect(stage.overlay.querySelector('[data-testid="hud-roster"]')).toBeNull();
    view.destroy();
  });

  it("opens the full roster for three seconds on a tap", () => {
    vi.useFakeTimers();
    const stage = fakeStage();
    stage.emitViewport(browserHeight);
    const view = new RaceHudView(stage);
    view.update(lobby(), LOCAL_ID, 0);
    settle();
    stage.overlay.querySelector<HTMLButtonElement>('[data-testid="hud-standings-pill"]')!.click();
    settle();
    expect(stage.overlay.querySelector('[data-testid="hud-roster"]')).not.toBeNull();
    vi.advanceTimersByTime(3000);
    settle();
    expect(stage.overlay.querySelector('[data-testid="hud-roster"]')).toBeNull();
    view.destroy();
    vi.useRealTimers();
  });
});

describe("the metric row", () => {
  it("is one three-column grid with Time on the centre axis", () => {
    // jsdom has no layout, so the grid is asserted from the source, as the
    // pointer rule above is.
    expect(SOURCE).toMatch(/\.ff-hud__metrics\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/);
    expect(SOURCE).toMatch(/\.ff-hud__metrics\s*\{[^}]*align-items:\s*stretch/);
  });

  it("draws Menu as a square icon tile that still says what it is", () => {
    const view = new RaceHudView(fakeStage(), { onPause: () => {} });
    settle();
    const menu = document.querySelector<HTMLButtonElement>('[data-testid="pause-open"]')!;
    expect(menu.getAttribute("aria-label")).toBe("Pause menu");
    expect(menu.classList.contains("ff-hud__pause--tile")).toBe(true);
    view.destroy();
  });

  it("stretches each standings name and draws a six-pixel climb bar", () => {
    expect(SOURCE).toMatch(/\.ff-hud__row\s*\{[^}]*grid-template-columns:\s*10px auto minmax\(0,\s*1fr\) auto minmax\(40px,\s*0\.6fr\)/);
    expect(SOURCE).toMatch(/\.ff-hud__track\s*\{[^}]*height:\s*6px/);
  });
});

describe("the first-race words on the mounted HUD (first-race spec parts 2 and 3)", () => {
  const tuning = { ...snapshotAt(0).tuning, COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 };
  const survival = (local: Parameters<typeof playerSnapshot>[0] = {}) =>
    snapshotAt(300, { raceStartedAtTick: 0, floorCount: 60, tuning, players: [playerSnapshot({ id: LOCAL_ID, ...local })] });
  const query = (stage: ReturnType<typeof fakeStage>, id: string) => stage.overlay.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const show = (snapshot: ReturnType<typeof survival>, options: ConstructorParameters<typeof RaceHudView>[1] = {}) => {
    const stage = fakeStage();
    const view = new RaceHudView(stage, options);
    view.update(snapshot, LOCAL_ID, 0, 300);
    settle();
    return { stage, view };
  };
  afterEach(() => inputMethod.note("keyboard"));

  it("asks for any key until her first input, and for a tap on touch", () => {
    const { stage, view } = show(survival({ awaitingInput: true }));
    expect(query(stage, "start-prompt")?.textContent?.trim()).toBe(m.race_start_press());
    inputMethod.note("touch");
    settle();
    expect(query(stage, "start-prompt")?.textContent?.trim()).toBe(m.race_start_tap());
    view.update(survival({ awaitingInput: false }), LOCAL_ID, 0, 301);
    settle();
    expect(query(stage, "start-prompt")).toBeNull();
    view.destroy();
  });

  it("is silent, being a prompt over the racer that the live region need not repeat", () => {
    const { stage, view } = show(survival({ awaitingInput: true }));
    expect(query(stage, "start-prompt")?.getAttribute("aria-hidden")).toBe("true");
    view.destroy();
  });

  it("never shows the start prompt on a replay", () => {
    const { stage, view } = show(survival({ awaitingInput: true }), { replay: true });
    expect(query(stage, "start-prompt")).toBeNull();
    view.destroy();
  });

  it("puts the reason under OUT!, silent like the banner, and takes the start prompt away", () => {
    const { stage, view } = show(survival({ awaitingInput: true, outAtTick: 290, finishedAtTick: 290 }));
    expect(query(stage, "out-line")?.textContent?.trim()).toBe(m.race_out_line());
    expect(query(stage, "out-line")?.getAttribute("aria-hidden")).toBe("true");
    expect(query(stage, "start-prompt")).toBeNull();
    view.destroy();
  });

  it("shows neither in a 20-floor race", () => {
    const { stage, view } = show(snapshotAt(300, { raceStartedAtTick: 0, players: [playerSnapshot({ id: LOCAL_ID, awaitingInput: true })] }));
    expect(query(stage, "start-prompt")).toBeNull();
    expect(query(stage, "out-line")).toBeNull();
    view.destroy();
  });
});

describe("the one-time hints in the toast slot (first-race spec parts 4 and 5)", () => {
  const tuning = { ...snapshotAt(0).tuning, COURSE_FLOOR_COUNT: 50, RACE_TIME_LIMIT_TICKS: 10_800 };
  const survival = (local: Parameters<typeof playerSnapshot>[0] = {}) =>
    snapshotAt(300, { raceStartedAtTick: 0, floorCount: 60, tuning, players: [playerSnapshot({ id: LOCAL_ID, ...local })] });
  const climb = () => snapshotAt(300, { raceStartedAtTick: 0, players: [playerSnapshot({ id: LOCAL_ID })] });
  const mountHint = (snapshot: ReturnType<typeof survival>, hint: ConstructorParameters<typeof RaceHudView>[1] extends infer O ? O extends { hint?: infer H } ? H : never : never) => {
    const stage = fakeStage();
    const view = new RaceHudView(stage, { hint });
    view.update(snapshot, LOCAL_ID, 0, 300);
    settle();
    return { stage, view, hint: () => stage.overlay.querySelector<HTMLElement>('[data-testid="race-hint"]') };
  };
  afterEach(() => inputMethod.note("keyboard"));

  it("shows the lava line in the toast slot", () => {
    const { view, hint } = mountHint(survival(), "edge");
    expect(hint()?.textContent).toBe(m.race_hint_edge());
    expect(hint()?.dataset["hint"]).toBe("edge");
    expect(hint()?.closest(".ff-hud__toast")).not.toBeNull();
    view.destroy();
  });

  it("names the player's own restart: R, the pad's button, or the timer", () => {
    const { view, hint } = mountHint(climb(), "restart");
    expect(hint()?.textContent).toBe(m.race_hint_restart_keyboard());
    inputMethod.noteGamepad("xbox");
    settle();
    expect(hint()?.querySelector("[data-glyph]")).not.toBeNull();
    expect(hint()?.textContent).not.toContain("\uE000");
    inputMethod.note("touch");
    settle();
    expect(hint()?.textContent).toBe(m.race_hint_restart_touch());
    view.destroy();
  });

  it("changes the hint while the race runs", async () => {
    const { view, hint } = mountHint(climb(), "floors");
    expect(hint()?.textContent).toBe(m.race_hint_floors());
    view.setHint("restart");
    settle();
    expect(hint()?.dataset["hint"]).toBe("restart");
    view.setHint(undefined);
    settle();
    await gone(hint);
    view.destroy();
  });

  it("empties the toast slot when she is out, the swipe coach included", async () => {
    const out = survival({ outAtTick: 290, finishedAtTick: 290 });
    const edge = mountHint(out, "edge");
    await gone(edge.hint);
    edge.view.destroy();
    const coach = mountHint(out, "swipe");
    await gone(() => coach.stage.overlay.querySelector('[data-testid="swipe-coach"]'));
    coach.view.destroy();
  });

  it("still shows the swipe coach and the missed-floor reminder as before", async () => {
    const coach = mountHint(climb(), "swipe");
    expect(coach.stage.overlay.querySelector('[data-testid="swipe-coach"]')).not.toBeNull();
    coach.view.destroy();
    const reminder = mountHint(climb(), "floors");
    reminder.view.setHint(undefined);
    reminder.view.setRecoveryHint(true);
    settle();
    expect(reminder.stage.overlay.querySelector('[data-testid="missed-floor-help"]')).not.toBeNull();
    await gone(reminder.hint);
    reminder.view.destroy();
  });

  it("lets a first-race hint take the slot over the missed-floor reminder while it runs, so the hint's clock spends what she saw", async () => {
    const { stage, view, hint } = mountHint(climb(), "floors");
    view.setRecoveryHint(true);
    settle();
    expect(hint()?.dataset["hint"]).toBe("floors");
    expect(stage.overlay.querySelector('[data-testid="missed-floor-help"]')).toBeNull();
    view.setHint(undefined);
    settle();
    await gone(hint);
    expect(stage.overlay.querySelector('[data-testid="missed-floor-help"]')).not.toBeNull();
    view.destroy();
  });
});

describe("the tutorial's OUT! and Floors chip (first-race spec §1)", () => {
  const finite = () =>
    snapshotAt(300, {
      raceStartedAtTick: 0,
      floorCount: 20,
      players: [playerSnapshot({ id: LOCAL_ID, name: "Kite", progress: 1 / 20 })],
    });

  it("shows OUT! when told to, with no line under it", () => {
    const { stage, view } = mount();
    view.update(finite(), LOCAL_ID, 0);
    view.showOut(true);
    settle();
    expect(stage.overlay.querySelector('[data-testid="out-banner"]')?.textContent).toBe(m.race_out());
    expect(stage.overlay.querySelector('[data-testid="out-line"]')).toBeNull();
    view.showOut(false);
    settle();
    expect(stage.overlay.querySelector('[data-testid="out-banner"]')).toBeNull();
    view.destroy();
  });

  it("shows no Floors counter in the tutorial, and keeps it in a race", () => {
    const solo = new RaceHudView(fakeStage(), { solo: true });
    solo.update(finite(), LOCAL_ID, 0);
    settle();
    expect(solo["stage"].overlay.querySelector('[data-testid="hud-floors"]')).toBeNull();
    solo.destroy();
    const { stage, view } = mount();
    view.update(finite(), LOCAL_ID, 0);
    settle();
    expect(stage.overlay.querySelector('[data-testid="hud-floors"]')).not.toBeNull();
    view.destroy();
  });
});
