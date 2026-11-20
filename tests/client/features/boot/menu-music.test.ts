/**
 * The menu track: the title and the lobby share it the way they share the
 * sky, it waits for a gesture on a fresh page, and letting go of it never
 * silences the race that took over the music slot.
 */

import { describe, expect, it } from "vitest";
import { CarryOver } from "../../../../apps/client/src/features/profile/carry-over";
import { claimMenuBed, claimMenuMusic, MENU_MUSIC, MENU_MUSIC_START_MS, menuSongBeat } from "../../../../apps/client/src/features/boot/menu-music";
import { MENU_BED, MENU_BED_GAIN } from "../../../../apps/client/src/features/audio/menu-cues";
import { FakeAudio } from "../../support/fakes/audio";
import { shippedContentPort } from "../../support/fakes/content";
import { FakeNetwork } from "../../support/fakes/network";
import { fakeContext } from "../../support/fakes/screens";
import { lobbySnapshot } from "../../support/snapshots";

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the menu music", () => {
  it("stays quiet when the room is past the stage step: the song step's own audio holds the slot", async () => {
    // A reload mid song step: the splash claims the menu theme, and its
    // manifest can arrive after the first preview has started.
    const audio = new FakeAudio();
    const network = new FakeNetwork();
    network.emitSnapshot(lobbySnapshot(2, { phase: "select", select: { step: "song", endsAtTick: 900, picks: {}, loaded: [] } }));
    const release = claimMenuMusic(fakeContext({ audio, network }));
    await settled();
    expect(audio.calls.some((call) => call.startsWith("play:"))).toBe(false);
    release();
  });

  it("stays quiet on a reload into the stage countdown, which the Lobby forwards at once", async () => {
    // The count is the race's now (race-flow spec §3): a theme started here
    // would sound for the moment before the hand-off.
    const audio = new FakeAudio();
    const network = new FakeNetwork();
    network.emitSnapshot(lobbySnapshot(2, { phase: "countdown", countdownEndsAtTick: 180 }));
    const release = claimMenuMusic(fakeContext({ audio, network }));
    await settled();
    expect(audio.calls.some((call) => call.startsWith("play:"))).toBe(false);
    release();
  });

  it("asks for sound at once and schedules the song from 3:40", async () => {
    const audio = new FakeAudio();
    const release = claimMenuMusic(fakeContext({ audio }));
    await settled();
    expect(audio.calls[0]).toBe("unlock");
    expect(audio.calls.at(-1)).toBe(`play:${MENU_MUSIC}@${MENU_MUSIC_START_MS}`);
    // The song alone: the bed waits for the title.
    expect(audio.calls.some((call) => call.startsWith("bed"))).toBe(false);
    expect(MENU_MUSIC_START_MS).toBe(220_000);
    release();
  });

  it("asks again on every gesture until the browser lets sound start", async () => {
    const audio = new FakeAudio();
    audio.running = false;
    const release = claimMenuMusic(fakeContext({ audio }));
    await settled();
    // Chrome on a phone ignores a touch's press and honours its release.
    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("pointerup"));
    expect(audio.calls.filter((call) => call === "unlock")).toHaveLength(3);

    audio.start();
    await settled();
    window.dispatchEvent(new Event("touchend"));
    window.dispatchEvent(new Event("click"));
    expect(audio.calls.filter((call) => call === "unlock")).toHaveLength(3);
    release();
  });

  it("stops listening at once where sound needs no gesture", async () => {
    const audio = new FakeAudio();
    const release = claimMenuMusic(fakeContext({ audio }));
    await settled();
    window.dispatchEvent(new Event("pointerup"));
    expect(audio.calls.filter((call) => call === "unlock")).toHaveLength(1);
    release();
  });

  it("resumes where it left off, at the mix's own level and unfiltered", async () => {
    const audio = new FakeAudio();
    audio.positions.set(MENU_MUSIC, 251_500);
    const release = claimMenuMusic(fakeContext({ audio }));
    await settled();
    // A race leaves the climb's filter wherever the finish was.
    expect(audio.calls.slice(-3)).toEqual(["musicGain:1.10", "musicCutoff:20000", `play:${MENU_MUSIC}@251500`]);
    release();
  });

  it("keeps playing across the switch from one menu screen to the next", async () => {
    const audio = new FakeAudio();
    const carryOver = new CarryOver();
    const context = fakeContext({ audio, carryOver });

    const releaseSplash = claimMenuMusic(context);
    await settled();
    carryOver.hold();
    releaseSplash();
    const releaseTitle = claimMenuMusic(context);
    carryOver.settle();
    await settled();

    expect(audio.calls.filter((call) => call.startsWith("play:"))).toHaveLength(1);
    expect(audio.calls.filter((call) => call.startsWith("stop:"))).toHaveLength(0);
    releaseTitle();
  });

  it("stops only its own track when let go, and stops listening", async () => {
    const audio = new FakeAudio();
    const release = claimMenuMusic(fakeContext({ audio }));
    release();
    await settled();
    expect(audio.calls).toContain(`stop:${MENU_MUSIC}`);
    // Let go before the manifest came in: nothing is scheduled after.
    expect(audio.calls.some((call) => call.startsWith("play:"))).toBe(false);

    window.dispatchEvent(new Event("pointerdown"));
    expect(audio.calls.filter((call) => call === "unlock")).toHaveLength(1);
  });
});

describe("the menu bed", () => {
  it("plays the menu's air once the manifest is in", async () => {
    const audio = new FakeAudio();
    const release = claimMenuBed(fakeContext({ audio }));
    await settled();
    expect(audio.calls.at(-1)).toBe(`bed:${MENU_BED}@${MENU_BED_GAIN}`);
    release();
  });

  it("carries across the switch from the title to the lobby", async () => {
    const audio = new FakeAudio();
    const carryOver = new CarryOver();
    const context = fakeContext({ audio, carryOver });

    const releaseTitle = claimMenuBed(context);
    await settled();
    carryOver.hold();
    releaseTitle();
    const releaseLobby = claimMenuBed(context);
    carryOver.settle();
    await settled();

    expect(audio.calls.filter((call) => call.startsWith("bed:"))).toHaveLength(1);
    expect(audio.calls.filter((call) => call.startsWith("bed-stop:"))).toHaveLength(0);
    releaseLobby();
  });

  it("stops only its own bed when let go", async () => {
    const audio = new FakeAudio();
    const release = claimMenuBed(fakeContext({ audio }));
    release();
    await settled();
    // By name: the race's may already hold the slot.
    expect(audio.calls).toContain(`bed-stop:${MENU_BED}`);
    expect(audio.calls.some((call) => call.startsWith("bed:"))).toBe(false);
  });
});

describe("the menu song's beat", () => {
  it("is the beat of whatever the menu plays: the theme, a song's preview, nothing", () => {
    const context = fakeContext({ content: shippedContentPort() });
    const audio = context.audio as FakeAudio;
    expect(menuSongBeat(context)).toBeUndefined();
    // 131 bpm, first beat 15 ticks in: four beats on is 250 ms + 4 x 458 ms.
    audio.playingNow = { alias: MENU_MUSIC, ms: 250 + (4 * 60_000) / 131 };
    expect(menuSongBeat(context)?.beat).toBeCloseTo(4);
    expect(menuSongBeat(context)?.beatSeconds).toBeCloseTo(60 / 131);
    const song = context.content.current()!.content.songs.find((each) => each.previewStartMs !== undefined)!;
    audio.playingNow = { alias: `${song.audioAlias}Preview`, ms: 0 };
    expect(menuSongBeat(context)?.beat).toBeCloseTo(
      ((song.previewStartMs! / 1000 - song.beatOffsetTicks / 60) * song.bpm) / 60,
    );
  });
});
