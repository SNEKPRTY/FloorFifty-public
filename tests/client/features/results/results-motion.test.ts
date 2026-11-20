/**
 * The results reveal, heard (A/V polish plan, G7): each standing's tick climbs
 * the scale toward the winner, and the winner lands on the stamp.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { revealRate, revealRow } from "../../../../apps/client/src/features/results/results-motion";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the reveal's pitch", () => {
  it("starts on the tick's own note and climbs with every standing", () => {
    expect(revealRate(0)).toBe(1);
    for (let order = 1; order < 8; order += 1) expect(revealRate(order)).toBeGreaterThan(revealRate(order - 1));
  });

  it("climbs the minor pentatonic the landings use, so a reveal over the results song stays in key", () => {
    const semitones = [0, 1, 2, 3, 4, 5].map((order) => Math.round(12 * Math.log2(revealRate(order))));
    expect(semitones).toEqual([0, 3, 5, 7, 10, 12]);
  });
});

describe("revealing a standing", () => {
  type Heard = { sound: string; rate: number | undefined };
  function listen(): Heard[] {
    const heard: Heard[] = [];
    document.body.addEventListener("ff-sfx", (event) => {
      const detail = (event as CustomEvent<{ sound: string; rate?: number }>).detail;
      heard.push({ sound: detail.sound, rate: detail.rate });
    });
    return heard;
  }

  const rows = (count: number) =>
    Array.from({ length: count }, () => {
      const row = document.createElement("li");
      document.body.append(row);
      return row;
    });

  it("ticks each standing a step higher, and stamps the winner's", () => {
    vi.useFakeTimers();
    const heard = listen();
    const actions = rows(3).map((row, order) => revealRow(row, { order, winner: order === 2 }));
    vi.runAllTimers();
    expect(heard).toEqual([
      { sound: "tick", rate: revealRate(0) },
      { sound: "tick", rate: revealRate(1) },
      { sound: "stamp", rate: undefined },
    ]);
    for (const action of actions) action.destroy();
  });

  it("stamps nobody when there is no winner: the top standing ticks like the rest", () => {
    vi.useFakeTimers();
    const heard = listen();
    const actions = rows(3).map((row, order) => revealRow(row, { order }));
    vi.runAllTimers();
    expect(heard.map((entry) => entry.sound)).toEqual(["tick", "tick", "tick"]);
    for (const action of actions) action.destroy();
  });
});
