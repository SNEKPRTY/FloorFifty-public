/**
 * Remote players are drawn from the interpolated buffer, so the moment being
 * drawn has to move every frame rather than once per arriving snapshot.
 */

import { describe, expect, it } from "vitest";
import { SNAPSHOT_INTERVAL_TICKS } from "../../../../apps/client/src/lib/constants";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const FRAME_MS = 1000 / 60;

/** The newest authority tick the fixture feeds. */
const NEWEST_TICK = 36;

/** A remote player running at a constant six units per tick. */
const remoteAt = (tick: number) =>
  snapshotAt(tick, { players: [playerSnapshot({ id: REMOTE_ID, x: tick * 6 })] });

/**
 * Enough history for the delayed render moment to fall between two snapshots.
 *
 * Snapshots are interleaved with rendered frames at the rate they actually
 * arrive -- one every `SNAPSHOT_INTERVAL_TICKS` frames -- because a clock that
 * runs on rendered time is only in its steady state if time has been rendered.
 */
async function racingWithHistory() {
  const gameplay = await gameplayWithFakeNetwork();
  for (let tick = 24; tick <= NEWEST_TICK; tick += SNAPSHOT_INTERVAL_TICKS) {
    gameplay.network.emitSnapshot(remoteAt(tick));
    // Frames are rendered between arrivals, not after the last one: the delay
    // behind authority is largest the instant a snapshot lands and shrinks
    // until the next, so stopping on an arrival leaves a full interval of
    // buffered history to draw through.
    if (tick === NEWEST_TICK) break;
    for (let frame = 0; frame < SNAPSHOT_INTERVAL_TICKS; frame += 1) {
      gameplay.screen.draw(FRAME_MS);
    }
  }
  return gameplay;
}

const remoteX = (gameplay: Awaited<ReturnType<typeof racingWithHistory>>): number =>
  gameplay.screen.sample()!.players.find((player) => player.id === REMOTE_ID)!.x;

describe("a remote player between two snapshots", () => {
  it("moves on every rendered frame, not once per snapshot", async () => {
    const gameplay = await racingWithHistory();

    const positions: number[] = [];
    for (let frame = 0; frame < 3; frame += 1) {
      gameplay.screen.draw(FRAME_MS);
      positions.push(remoteX(gameplay));
    }

    // Strictly increasing: no frame repeats the one before it.
    expect(positions[1]).toBeGreaterThan(positions[0]!);
    expect(positions[2]).toBeGreaterThan(positions[1]!);
  });

  it("covers the snapshot interval in even steps rather than one jump", async () => {
    const gameplay = await racingWithHistory();

    const steps: number[] = [];
    let previous = remoteX(gameplay);
    for (let frame = 0; frame < 3; frame += 1) {
      gameplay.screen.draw(FRAME_MS);
      const next = remoteX(gameplay);
      steps.push(next - previous);
      previous = next;
    }

    // Six units a tick, one tick a frame: every frame carries its own share
    // instead of two frames carrying nothing and the third carrying all of it.
    for (const step of steps) expect(step).toBeCloseTo(6, 0);
  });
});

describe("a snapshot that arrives late", () => {
  it("keeps the picture moving through the frames the delay covers", async () => {
    const gameplay = await racingWithHistory();

    // The next snapshot is due after one interval and never comes. The delay
    // holds one and a half intervals of history, so the frames that interval
    // would have covered are already buffered and still have somewhere to go.
    const steps: number[] = [];
    let previous = remoteX(gameplay);
    for (let frame = 0; frame < SNAPSHOT_INTERVAL_TICKS; frame += 1) {
      gameplay.screen.draw(FRAME_MS);
      const next = remoteX(gameplay);
      steps.push(next - previous);
      previous = next;
    }

    for (const step of steps) expect(step).toBeGreaterThan(0);
  });
});
