/**
 * The guard for races (story mode v2, U4): the race scene keeps three openings
 * for the story -- its layer in the world, its named moments, and the Floors
 * chip's reading. A race uses none of them, so a race draws exactly what it
 * drew before they existed.
 */

import { describe, expect, it, vi } from "vitest";
import type { Container } from "pixi.js";
import { SNAPSHOT_INTERVAL_TICKS } from "../../../../apps/client/src/lib/constants";
import { JuiceDirector } from "../../../../apps/client/src/features/race/juice/juice-director";
import { FeelDirector } from "../../../../apps/client/src/features/race/juice/feel-director";
import { shippedContentPort } from "../../support/fakes/content";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { LOCAL_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const FRAME_MS = 1000 / 60;

const labels = (node: Container): string[] => node.children.flatMap((child) => [child.label, ...labels(child as Container)]);

async function raceFor(ticks: number) {
  const gameplay = await gameplayWithFakeNetwork({ content: shippedContentPort(), localPlayerId: LOCAL_ID });
  for (let tick = 0; tick <= ticks; tick += SNAPSHOT_INTERVAL_TICKS) {
    gameplay.network.emitSnapshot(snapshotAt(tick, { phase: "racing", players: [playerSnapshot({ id: LOCAL_ID })] }));
    for (let frame = 0; frame < SNAPSHOT_INTERVAL_TICKS; frame += 1) gameplay.screen.draw(FRAME_MS);
  }
  return gameplay;
}

describe("a race, with the story's openings unused", () => {
  it("has no story layer in its world, and the world's children are the race's own", async () => {
    const gameplay = await raceFor(60);
    const view = gameplay.screen["scene"]!.view;
    const world = view["world"] as Container;
    expect(labels(world)).not.toContain("story-layer");
    const before = world.children.length;
    // The layer is made only when asked for, once, right over the floors.
    const layer = view.storyLayer();
    expect(view.storyLayer()).toBe(layer);
    expect(world.children.length).toBe(before + 1);
    expect(world.getChildIndex(layer)).toBe(world.getChildIndex(view["platforms"].root) + 1);
    gameplay.screen.exit();
  });

  it("plays no story moment: no story dust, kick, hit-stop, shake or punch", async () => {
    const moment = vi.spyOn(JuiceDirector.prototype, "storyMoment");
    const jolt = vi.spyOn(FeelDirector.prototype, "jolt");
    try {
      const gameplay = await raceFor(90);
      expect(moment).not.toHaveBeenCalled();
      expect(jolt).not.toHaveBeenCalled();
      gameplay.screen.exit();
    } finally {
      moment.mockRestore();
      jolt.mockRestore();
    }
  });

  it("reads the Floors chip as a race does, with no story reading", async () => {
    const gameplay = await raceFor(30);
    expect(gameplay.overlay.querySelector('[data-testid="hud-floors"]')).not.toBeNull();
    expect(gameplay.overlay.querySelector('[data-testid="hud-story-floor"]')).toBeNull();
    gameplay.screen.exit();
  });
});
