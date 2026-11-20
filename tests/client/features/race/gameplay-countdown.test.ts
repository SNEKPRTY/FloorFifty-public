/**
 * The countdown on the stage (race-flow spec §3): Gameplay mounts as the
 * countdown begins, shows 3 · 2 · 1 · GO over the racers, sends held input,
 * and starts the race song at GO rather than at mount -- unless the song
 * step's reveal already started it, which then plays on through the count.
 */

import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { FakeAudio } from "../../support/fakes/audio";
import { shippedContentPort } from "../../support/fakes/content";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { LOCAL_ID, snapshotAt } from "../../support/snapshots";

const ENDS = 180;
const counting = (tick: number) => snapshotAt(tick, { phase: "countdown", countdownEndsAtTick: ENDS, hostId: LOCAL_ID });
const count = (overlay: HTMLElement) => {
  flushSync();
  return overlay.querySelector('[data-testid="race-count"]')?.textContent?.trim();
};

afterEach(() => {
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
});

describe("the countdown on the stage", () => {
  it("stands the racers on the stage under the count, and starts the song at GO", async () => {
    const gameplay = await gameplayWithFakeNetwork({
      latestSnapshot: counting(0),
      localPlayerId: LOCAL_ID,
      content: shippedContentPort(),
    });
    for (let frame = 0; frame < 10; frame += 1) gameplay.screen.draw(16);
    expect(count(gameplay.overlay)).toBe("3");
    expect(gameplay.audio.playing()).toBeUndefined();
    gameplay.network.emitSnapshot(snapshotAt(ENDS + 3, { phase: "racing" }));
    for (let frame = 0; frame < 20; frame += 1) gameplay.screen.draw(16);
    expect(gameplay.audio.playing()).toBeDefined();
  });

  it("a reload mid-count shows the number left and issues each cue once", async () => {
    const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: counting(ENDS - 70), localPlayerId: LOCAL_ID });
    gameplay.network.emitSnapshot(counting(ENDS - 67));
    gameplay.network.emitSnapshot(counting(ENDS - 64));
    for (let frame = 0; frame < 4; frame += 1) gameplay.screen.draw(16);
    expect(count(gameplay.overlay)).toBe("2");
    const calls = gameplay.audio.calls.filter((call) => call.startsWith("cue:") && call.includes(":countdown:"));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toEqual([...new Set(calls)]);
    expect(calls.some((call) => call.startsWith("cue:vo.three"))).toBe(false);
  });

  it("sends input held in the countdown, but predicts nothing until racing", async () => {
    const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: counting(0), localPlayerId: LOCAL_ID });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    for (let frame = 0; frame < 10; frame += 1) gameplay.screen.draw(16);
    expect(gameplay.network.sentInputs.some((frame) => frame.right)).toBe(true);
    expect(gameplay.screen.predictedState()).toBeUndefined();
  });

  it("stops the count if the player leaves during it", async () => {
    const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: counting(0), localPlayerId: LOCAL_ID });
    gameplay.screen.exit();
    expect(gameplay.audio.calls).toContain("stop:countdown:");
  });

  it("silences whatever else holds the music slot as the stage countdown begins", async () => {
    // A reload mid-count, or a room that skipped the song step: the count is
    // heard over the stage's bed, and the song starts at GO.
    const gameplay = await gameplayWithFakeNetwork({
      latestSnapshot: counting(0),
      localPlayerId: LOCAL_ID,
      content: shippedContentPort(),
    });
    expect(gameplay.audio.calls).toContain("stop:");
  });

  it("keeps the song the reveal started playing through the count and GO, rather than starting it over", async () => {
    const content = shippedContentPort();
    const alias = content.current()!.content.songs.find((song) => song.id === "moving-on")!.audioAlias;
    const audio = new FakeAudio();
    audio.play(alias);
    const gameplay = await gameplayWithFakeNetwork({
      latestSnapshot: snapshotAt(0, { phase: "countdown", countdownEndsAtTick: ENDS, hostId: LOCAL_ID, songId: "moving-on" }),
      localPlayerId: LOCAL_ID,
      content,
      audio,
    });
    for (let frame = 0; frame < 10; frame += 1) gameplay.screen.draw(16);
    gameplay.network.emitSnapshot(snapshotAt(ENDS + 3, { phase: "racing", songId: "moving-on" }));
    for (let frame = 0; frame < 20; frame += 1) gameplay.screen.draw(16);
    expect(audio.calls.filter((call) => call === `play:${alias}`)).toHaveLength(1);
    expect(audio.calls).not.toContain("stop:");
    expect(audio.playing()).toBe(alias);
  });

  it("stops the count when the connection drops during it", async () => {
    const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: counting(0), localPlayerId: LOCAL_ID });
    gameplay.network.emitConnectionState("offline");
    expect(gameplay.audio.calls).toContain("stop:countdown:");
  });
});

