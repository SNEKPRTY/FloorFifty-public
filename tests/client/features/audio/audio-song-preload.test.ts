import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shippedContentPort } from "../../support/fakes/content";
import { lobbyWithFakeNetwork } from "../../support/fakes/screens";
import { lobbySnapshot, LOCAL_ID, playerSnapshot } from "../../support/snapshots";

const live: Awaited<ReturnType<typeof lobbyWithFakeNetwork>>[] = [];
afterEach(() => { for (const opened of live.splice(0)) opened.screen.exit(); });

async function setup() {
  const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
  live.push(screen);
  await screen.createRoom("Kite");
  return screen;
}
function selecting(focus: string, step: "song" | "songReveal" = "song"): RoomSnapshot {
  return {
    ...lobbySnapshot(2, { players: [playerSnapshot()] }), phase: "select" as const,
    select: { step, endsAtTick: 900, loaded: [], picks: { [LOCAL_ID]: { focus, locked: false, seed: "random" } },
      ...(step === "songReveal" ? { song: { id: focus, pickedBy: LOCAL_ID } } : {}) },
  };
}
const aliasOf = (id: string) => shippedContentPort().current()!.content.songs.find(song => song.id === id)!.audioAlias;

describe("race songs preloaded during selection", () => {
  it("starts the local song during song select, without waiting for loading, and deduplicates snapshots", async () => {
    const screen = await setup();
    screen.receiveSnapshot(selecting("moving-on"));
    screen.receiveSnapshot(selecting("moving-on"));
    await screen.settle();
    expect(screen.audio.calls).toContain("load:song-moving-on");
    expect(screen.audio.calls.filter(call => call === `preload:${aliasOf("moving-on")}`)).toHaveLength(1);
    expect(screen.network.calls).not.toContain("loaded");
  });

  it("coalesces changes behind one speculative decode and releases the obsolete buffer", async () => {
    const screen = await setup();
    let finish!: () => void;
    const preload = vi.spyOn(screen.audio, "preload").mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    screen.receiveSnapshot(selecting("moving-on"));
    await screen.settle();
    expect(preload).toHaveBeenCalledWith(aliasOf("moving-on"));
    screen.receiveSnapshot(selecting("whats-next"));
    screen.receiveSnapshot(selecting("chrome-in-the-rain"));
    await screen.settle();
    expect(preload).toHaveBeenCalledTimes(1);
    finish();
    await screen.settle();
    expect(preload.mock.calls.map(([alias]) => alias)).toEqual([aliasOf("moving-on"), aliasOf("chrome-in-the-rain")]);
    expect(screen.audio.calls).toContain(`release:${aliasOf("moving-on")}`);
  });

  it("does not preload Random, but starts the resolved song at reveal", async () => {
    const screen = await setup();
    screen.receiveSnapshot(selecting("?"));
    await screen.settle();
    expect(screen.audio.calls.some(call => call.startsWith("preload:music."))).toBe(false);
    screen.receiveSnapshot(selecting("moving-on", "songReveal"));
    await screen.settle();
    expect(screen.audio.calls).toContain(`preload:${aliasOf("moving-on")}`);
  });

  it("keeps a warmed song for the reveal instead of releasing or preloading it again", async () => {
    const screen = await setup();
    screen.receiveSnapshot(selecting("moving-on"));
    await screen.settle();
    screen.receiveSnapshot(selecting("moving-on", "songReveal"));
    await screen.settle();
    expect(screen.audio.calls.filter(call => call === `preload:${aliasOf("moving-on")}`)).toHaveLength(1);
    expect(screen.audio.calls).not.toContain(`release:${aliasOf("moving-on")}`);
  });
});

it("releases a warmed speculative song when leaving the lobby without racing", async () => {
  const screen = await setup();
  screen.receiveSnapshot(selecting("moving-on"));
  await screen.settle();
  screen.screen.exit();
  expect(screen.audio.calls).toContain(`release:${aliasOf("moving-on")}`);
});

it("releases a canceled decode after it finishes and starts no queued work after exit", async () => {
  const screen = await setup();
  let finish!: () => void;
  screen.audio.preloadGate = () => new Promise<void>(resolve => { finish = resolve; });
  screen.receiveSnapshot(selecting("moving-on"));
  await screen.settle();
  screen.screen.exit();
  finish();
  await screen.settle();
  expect(screen.audio.calls).toContain(`release:${aliasOf("moving-on")}`);
  expect(screen.audio.calls.filter(call => call.startsWith("preload:"))).toHaveLength(1);
});

it("does not start a queued speculative song after exit", async () => {
  const screen = await setup();
  let finish!: () => void;
  screen.audio.preloadGate = () => new Promise<void>(resolve => { finish = resolve; });
  screen.receiveSnapshot(selecting("moving-on"));
  await screen.settle();
  screen.receiveSnapshot(selecting("whats-next"));
  screen.screen.exit();
  finish();
  await screen.settle();
  expect(screen.audio.calls).not.toContain(`preload:${aliasOf("whats-next")}`);
});

it("retains the chosen pending decode when the lobby hands off to the race", async () => {
  const screen = await setup();
  let finish!: () => void;
  screen.audio.preloadGate = () => new Promise<void>(resolve => { finish = resolve; });
  screen.receiveSnapshot(selecting("moving-on"));
  await screen.settle();
  const { select: _select, ...snapshot } = selecting("moving-on");
  screen.receiveSnapshot({ ...snapshot, phase: "countdown", songId: "moving-on" });
  screen.screen.exit();
  finish();
  await screen.settle();
  expect(screen.audio.calls).not.toContain(`release:${aliasOf("moving-on")}`);
});
