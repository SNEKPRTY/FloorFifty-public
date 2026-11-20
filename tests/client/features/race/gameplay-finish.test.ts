/**
 * The victory sequence (race-flow spec §5.2): the winner's last landing plays
 * slowed on every screen, and Results waits for it.
 */

import { describe, expect, it, vi } from "vitest";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { RaceScene } from "../../../../apps/client/src/features/race/race-scene";
import { EASE_MS, HOLD_MS } from "../../../../apps/client/src/features/race/finish-sequence";
import { shippedContentPort } from "../../support/fakes/content";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { REMOTE_ID, snapshotAt } from "../../support/snapshots";

const racingAt = (tick: number) => snapshotAt(tick, { phase: "racing" });
const finishedAt = (tick: number) =>
  snapshotAt(tick, {
    phase: "finished",
    winnerId: REMOTE_ID,
    events: [{ id: `${tick}:raceFinished:${REMOTE_ID}:1`, tick, type: "raceFinished", winnerId: REMOTE_ID } as RaceEvent],
  });

describe("the finish sequence on screen", () => {
  it("holds Results back until the sequence ends", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    try {
      const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: racingAt(0) });
      for (let frame = 0; frame < 10; frame += 1) gameplay.screen.draw(16);
      gameplay.network.emitSnapshot(finishedAt(12));
      expect(gameplay.publishedEvents().map((event) => event.name)).not.toContain("room.finished");
      // Drawn up to a frame short of the sequence's end, then past it.
      let elapsed = 0;
      while (elapsed + 16 < EASE_MS + HOLD_MS) {
        gameplay.screen.draw(16);
        elapsed += 16;
      }
      expect(gameplay.publishedEvents().map((event) => event.name)).not.toContain("room.finished");
      for (let frame = 0; frame < 3; frame += 1) gameplay.screen.draw(16);
      expect(gameplay.publishedEvents().filter((event) => event.name === "room.finished")).toHaveLength(1);
      expect(gameplay.audio.calls).toContain("slowMusic:0.25");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the scenery's beat to the race song where it plays", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    try {
      const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: racingAt(0), content: shippedContentPort() });
      let asked = 0;
      gameplay.audio.nowPlaying = () => {
        asked += 1;
        return undefined;
      };
      gameplay.screen.draw(16);
      expect(asked).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("goes straight to Results for a client that arrives after the finish", async () => {
    const gameplay = await gameplayWithFakeNetwork({
      latestSnapshot: racingAt(0),
      whileLoading: (network) => network.emitSnapshot(finishedAt(12)),
    });
    expect(gameplay.lastPublished()).toBe("room.finished");
  });

  it("a stalled ticker still reaches Results", async () => {
    vi.useFakeTimers();
    try {
      const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: racingAt(0) });
      gameplay.screen.draw(16);
      gameplay.network.emitSnapshot(finishedAt(12));
      vi.advanceTimersByTime(2_000);
      expect(gameplay.lastPublished()).toBe("room.finished");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [false, "glides"],
    [true, "cuts"],
  ] as const)("puts the camera on the winner: reduced motion %s → it %s", async (reduced, _motion) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const focusOn = vi.spyOn(RaceScene.prototype, "focusOn");
    try {
      const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: racingAt(0) });
      gameplay.screen.draw(16);
      gameplay.network.emitSnapshot(finishedAt(12));
      expect(focusOn).toHaveBeenCalledWith(REMOTE_ID, reduced);
    } finally {
      focusOn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("sends a player who left during the finish to the menu, not to Results", async () => {
    const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: racingAt(0) });
    for (let frame = 0; frame < 10; frame += 1) gameplay.screen.draw(16);
    gameplay.network.emitSnapshot(finishedAt(12));
    gameplay.click("pause-open");
    gameplay.click("pause-leave");
    gameplay.click("pause-leave-confirm");
    await gameplay.settle();
    for (let elapsed = 0; elapsed < EASE_MS + HOLD_MS + 200; elapsed += 16) gameplay.screen.draw(16);
    const names = gameplay.publishedEvents().map((event) => event.name);
    expect(names).toContain("ui.leave-race-settled");
    expect(names).not.toContain("room.finished");
  });

  it("sends a player whose room fails during the finish to recovery, not to Results", async () => {
    const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: racingAt(0) });
    for (let frame = 0; frame < 10; frame += 1) gameplay.screen.draw(16);
    gameplay.network.emitSnapshot(finishedAt(12));
    gameplay.network.emitError({ code: "ROOM_CLOSED", message: "The room closed." });
    // The screen is still mounted for a frame or two while the flow takes over.
    for (let elapsed = 0; elapsed < EASE_MS + HOLD_MS + 200; elapsed += 16) gameplay.screen.draw(16);
    const names = gameplay.publishedEvents().map((event) => event.name);
    expect(names).toContain("room.recovery-required");
    expect(names).not.toContain("room.finished");
  });

  it("puts the song back to full speed when it leaves", async () => {
    const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: racingAt(0) });
    for (let frame = 0; frame < 10; frame += 1) gameplay.screen.draw(16);
    gameplay.network.emitSnapshot(finishedAt(12));
    for (let elapsed = 0; elapsed < 200; elapsed += 16) gameplay.screen.draw(16);
    gameplay.screen.exit();
    expect(gameplay.audio.calls).toContain("slowMusic:1.00");
  });
});

