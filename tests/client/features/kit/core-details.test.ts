/**
 * The core details (polish spec §6): each uses a primitive from `features/kit/motion.ts`
 * and that primitive's reduced-motion variant.
 *
 * GSAP's ticker does not run under jsdom, so these assert which tweens were
 * created and the state each element settles in.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import gsap from "gsap";
import { flushSync, mount, unmount } from "svelte";
import ConnectionIndicator from "../../../../apps/client/src/features/net/ConnectionIndicator.svelte";
import ProgressBar from "../../../../apps/client/src/features/kit/ProgressBar.svelte";
import { MonotonicProgress } from "../../../../apps/client/src/features/profile/progress.svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGGER } from "../../../../apps/client/src/features/kit/motion";
import { revealRow, rollUp } from "../../../../apps/client/src/features/results/results-motion";
import { seatMotion, stampIn } from "../../../../apps/client/src/features/lobby/seat-motion";
import { RaceHudView } from "../../../../apps/client/src/features/race/race-hud.svelte";
import { fakeStage } from "../../support/fakes/stage";
import { setReducedMotion } from "../../support/motion";
import { LOCAL_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";
import { readClient } from "../../support/client-source";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("a ready-room seat (seatMotion)", () => {
  const seat = () => document.body.appendChild(document.createElement("li"));
  const open = { occupant: undefined, ready: false, host: false };
  const filled = { occupant: "p1", ready: false, host: false };
  const tweens = (node: Element) => gsap.getTweensOf(node);

  it("does nothing on the first render", () => {
    const node = seat();
    seatMotion(node, filled);
    expect(tweens(node)).toHaveLength(0);
  });

  it("slides in from its edge as it fills, on whole pixels, in steps", () => {
    const node = seat();
    const action = seatMotion(node, open);
    action.update(filled);
    const [tween] = tweens(node);
    expect(tween!.vars["roundProps"]).toBe("x");
    expect(String(tween!.vars["ease"])).toMatch(/^steps\(/);
    expect(gsap.getProperty(node, "x")).not.toBe(0);
  });

  it("collapses as it empties, and settles back to its full height", () => {
    const node = seat();
    const action = seatMotion(node, filled);
    action.update(open);
    const [tween] = tweens(node);
    expect(tween!.vars["scaleY"]).toBe(1);
    expect(gsap.getProperty(node, "scaleY")).toBeLessThan(1);
  });

  it("pulses when its racer readies, and once when the host passes to it", () => {
    const node = seat();
    const action = seatMotion(node, filled);
    action.update({ ...filled, ready: true });
    expect(tweens(node).at(-1)!.vars["scale"]).toBe(1.06);
    gsap.killTweensOf(node);
    action.update({ ...filled, ready: true, host: true });
    expect(tweens(node)).toHaveLength(1);
    gsap.killTweensOf(node);
    action.update({ ...filled, ready: true, host: true });
    expect(tweens(node)).toHaveLength(0);
  });

  it("arrives still under reduced motion", () => {
    setReducedMotion(true);
    const node = seat();
    const action = seatMotion(node, open);
    action.update(filled);
    action.update({ ...filled, ready: true, host: true });
    action.update(open);
    expect(tweens(node)).toHaveLength(0);
  });
});

describe("the ready room's wiring", () => {
  const READY_ROOM = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/lobby/ReadyRoom.svelte"), "utf8");

  it("gives every seat its motion, from its occupant, readiness and host", () => {
    expect(READY_ROOM).toMatch(/use:seatMotion=\{\{ occupant: player\?\.id, ready: player\?\.ready \?\? false, host: isHost \}\}/);
  });

  it("stamps Ready: the stamp steps in at 1.1 and keeps the word", () => {
    expect(READY_ROOM).toMatch(/data-testid="ready-stamp"[^>]*use:stampIn/);
  });

  it("copies the room code with confirm, for 1.2 s, keeping its width, quietly but for its own sound", () => {
    // The code and Copy stand in the frame's corner row, in their own component.
    const ROOM_CODE = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/lobby/RoomCode.svelte"), "utf8");
    const at = ROOM_CODE.indexOf('data-testid="copy-code"');
    expect(at).toBeGreaterThan(-1);
    const tag = ROOM_CODE.slice(ROOM_CODE.lastIndexOf("<Button", at), ROOM_CODE.indexOf(">", at));
    // The kit button is a component, so `confirm` is driven from an effect on its element.
    expect(ROOM_CODE).toMatch(/confirm\(copyButton, \{ active \}\)/);
    expect(tag).toContain('data-sfx="none"');
    // Phase 5's words; the tick is a decoration beside the approved "Copied".
    expect(ROOM_CODE).toMatch(/data-confirm-label="idle">\{m\.ready_copy\(\)\}</);
    expect(ROOM_CODE).toMatch(/data-confirm-label="done">\{m\.ready_copied\(\)\}<span aria-hidden="true"> ✓<\/span></);
    expect(ROOM_CODE).toMatch(/setTimeout\(\(\) => \(copied = false\), CONFIRM_MS\)/);
    expect(ROOM_CODE).toMatch(/requestUiSound\(copyButton, "copied"\)/);
  });
});

describe("stampIn", () => {
  it("steps in at 1.1 and settles at 1", () => {
    const node = document.body.appendChild(document.createElement("span"));
    stampIn(node);
    const [tween] = gsap.getTweensOf(node);
    expect(gsap.getProperty(node, "scale")).toBe(1.1);
    expect(tween!.vars["scale"]).toBe(1);
    expect(String(tween!.vars["ease"])).toMatch(/^steps\(/);
  });

  it("appears in place under reduced motion", () => {
    setReducedMotion(true);
    const node = document.body.appendChild(document.createElement("span"));
    stampIn(node);
    expect(gsap.getTweensOf(node)).toHaveLength(0);
  });
});

describe("the results reveal", () => {
  /** Mounts `count` rows, each revealed in reveal order, the winner (row 0) last. */
  function rows(count: number) {
    const list = document.body.appendChild(document.createElement("ol"));
    const sounds: string[] = [];
    list.addEventListener("ff-sfx", (event) => sounds.push((event as CustomEvent<{ sound: string }>).detail.sound));
    const actions = Array.from({ length: count }, (_, index) => {
      const row = list.appendChild(document.createElement("li"));
      return { row, action: revealRow(row, { order: count - 1 - index }) };
    });
    return { actions, sounds };
  }

  it("reveals from last place to first, 2 × STAGGER apart, so the winner arrives last", () => {
    const { actions } = rows(4);
    const delays = actions.map(({ row }) => gsap.getTweensOf(row)[0]!.vars["delay"] as number);
    expect(delays).toEqual([3, 2, 1, 0].map((step) => step * 2 * STAGGER));
    expect(delays[0]).toBeGreaterThan(delays[3]!);
  });

  it("ticks once per standing as it is revealed, and never after the panel goes", () => {
    vi.useFakeTimers();
    try {
      const { actions, sounds } = rows(3);
      vi.advanceTimersByTime(2 * STAGGER * 1000);
      expect(sounds).toEqual(["tick", "tick"]);
      actions.forEach(({ action }) => action.destroy());
      vi.advanceTimersByTime(10_000);
      expect(sounds).toEqual(["tick", "tick"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not tick for a standing that has left the page before its turn", () => {
    vi.useFakeTimers();
    try {
      const { actions } = rows(3);
      const dispatched = actions.map(({ row }) => vi.spyOn(row, "dispatchEvent"));
      for (const { row } of actions) row.remove();
      expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
      for (const spy of dispatched) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("arrives in place under reduced motion, still ticking each standing", () => {
    setReducedMotion(true);
    vi.useFakeTimers();
    try {
      const { actions, sounds } = rows(2);
      expect(actions.every(({ row }) => gsap.getTweensOf(row).length === 0)).toBe(true);
      vi.advanceTimersByTime(1_000);
      expect(sounds).toEqual(["tick", "tick"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls each time up to its value and settles on it", () => {
    const cell = document.body.appendChild(document.createElement("span"));
    rollUp(cell, "0:42.7");
    expect(cell.textContent).toBe("0:42.7");
    expect(cell.querySelectorAll("[data-rolling='true']").length).toBeGreaterThan(0);
  });

  it("shows the time at once under reduced motion", () => {
    setReducedMotion(true);
    const cell = document.body.appendChild(document.createElement("span"));
    rollUp(cell, "—");
    expect(cell.textContent).toBe("—");
  });

  it("lands the winner's portrait with one squash step, off under reduced motion", () => {
    const panel = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/results/ResultsPanel.svelte"), "utf8");
    // Global: the portrait is drawn by AsyncImage, a child component.
    expect(panel).toMatch(/\.ff-result--winner :global\(\.ff-portrait\)\s*{[^}]*animation:\s*ff-win-land[^;]*steps\(1\)/);
    expect(panel).toMatch(/@keyframes ff-win-land\s*{\s*from\s*{\s*transform: scaleY\(0\.9\)/);
    expect(panel).toMatch(/prefers-reduced-motion: reduce\)\s*{\s*\.ff-result--winner :global\(\.ff-portrait\)\s*{\s*animation: none/);
    expect(panel).toMatch(/use:revealRow=\{\{ order: rows\.length - 1 - index, winner: isWinner \}\}/);
    expect(panel).toMatch(/use:rollUp=\{part\}/);
  });
});

describe("loading and connection", () => {
  const component = (name: string) => readClient(name);

  it("fills the load bar in steps, and glints once across a full fill", () => {
    const progress = new MonotonicProgress();
    const host = document.body.appendChild(document.createElement("div"));
    const bar = mount(ProgressBar, { target: host, props: { progress, testId: "bar" } });
    flushSync();
    const node = host.querySelector<HTMLElement>("[data-testid='bar']")!;
    expect(node.dataset["complete"]).toBe("false");
    progress.report(1);
    flushSync();
    expect(node.dataset["complete"]).toBe("true");
    const css = component("ProgressBar.svelte");
    expect(css).toMatch(/transition: width 160ms steps\(4\)/);
    expect(css).toMatch(/:global\(\[data-complete="true"\]\) \.ff-progress__fill::after\s*{[^}]*animation: ff-glint[^;]*steps\(/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*{[^}]*transition: none;[\s\S]*animation: none/);
    unmount(bar);
  });

  it.each([
    ["reconnecting", "true"],
    ["connecting", "false"],
    ["offline", "false"],
    ["connected", "false"],
  ] as const)("breathes while %s: %s, and always says it in words", (state, breathing) => {
    const host = document.body.appendChild(document.createElement("div"));
    const indicator = mount(ConnectionIndicator, { target: host, props: { state } });
    flushSync();
    const node = host.querySelector<HTMLElement>("[data-testid='connection-state']")!;
    expect(node.dataset["breathing"]).toBe(breathing);
    expect(node.textContent?.trim().length).toBeGreaterThan(0);
    unmount(indicator);
  });

  it("breathes in steps, on opacity alone, and not at all under reduced motion", () => {
    const css = component("ConnectionIndicator.svelte");
    expect(css).toMatch(/:global\(\[data-breathing="true"\]\)\s*{[^}]*animation: ff-breathe 1\.2s steps\(4\) infinite/);
    expect(css).toMatch(/@keyframes ff-breathe\s*{[^}]*opacity: 0\.6;?\s*}/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*{\s*:global\(\[data-breathing="true"\]\)\s*{\s*animation: none/);
  });
});

describe("the Floors chip (race HUD)", () => {
  /** A race where the local racer has climbed `floors` of 20. */
  const climbed = (floors: number) =>
    snapshotAt(100, { phase: "racing", floorCount: 20, players: [playerSnapshot({ id: LOCAL_ID, progress: floors / 20 })] });

  function hud() {
    const stage = fakeStage();
    const view = new RaceHudView(stage);
    view.update(climbed(3), LOCAL_ID, 0);
    flushSync();
    const chip = () => stage.overlay.querySelector<HTMLElement>('[data-testid="hud-floors"]')!;
    return { view, chip };
  }

  it("pops at the authored scale when authority credits a floor", () => {
    const { view, chip } = hud();
    view.setFloorsPop(1, 1.08);
    flushSync();
    expect(gsap.getTweensOf(chip())[0]!.vars["scale"]).toBe(1.08);
    view.destroy();
  });

  it("pops on the hudPop spring when one is given, knocked to the authored scale on 1/32 steps (Wonder spec §4.2)", () => {
    const { view, chip } = hud();
    view.setFloorsPop(1, 1.25, { f: 5, zeta: 0.4, r: 0 });
    flushSync();
    expect(chip().style.transform).toBe("scale(1.25)");
    expect(gsap.getTweensOf(chip())).toHaveLength(0);
    view.destroy();
  });

  it("never pops on the first render", () => {
    const { view, chip } = hud();
    expect(gsap.getTweensOf(chip())).toHaveLength(0);
    expect(chip().style.transform).toBe("");
    view.destroy();
  });

  it("rolls the count that changed, and settles on the new value", () => {
    const { view, chip } = hud();
    view.update(climbed(4), LOCAL_ID, 16);
    flushSync();
    expect(chip().querySelectorAll("[data-rolling='true']")).toHaveLength(1);
    expect(chip().textContent).toContain("04 / 20");
    view.destroy();
  });

  it("under reduced motion, the digit swaps and nothing pops", () => {
    setReducedMotion(true);
    const { view, chip } = hud();
    view.setFloorsPop(1, 1.08, { f: 5, zeta: 0.4, r: 0 });
    view.update(climbed(4), LOCAL_ID, 16);
    flushSync();
    expect(gsap.getTweensOf(chip())).toHaveLength(0);
    expect(chip().style.transform).toBe("");
    expect(chip().querySelectorAll("[data-rolling]")).toHaveLength(0);
    expect(chip().textContent).toContain("04 / 20");
    view.destroy();
  });
});
