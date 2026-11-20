/**
 * The live race recorded for the replay window (unlockables spec §6.1,
 * amended): a race that reaches results keeps its video; anything else
 * keeps none and leaves nothing held.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { RaceVideo } from "../../../../apps/client/src/features/net/race-video.svelte";
import { FakeAudio } from "../../support/fakes/audio";
import { gameplayWithFakeNetwork } from "../../support/fakes/screens";
import { fakeStage, FakeTicker } from "../../support/fakes/stage";
import { fakeCapture, fakeRecorderClass } from "../../support/media";
import { REMOTE_ID, snapshotAt } from "../../support/snapshots";

const finishedAt = (tick: number) =>
  snapshotAt(tick, {
    phase: "finished",
    winnerId: REMOTE_ID,
    stageId: "snow-shrine",
    events: [{ id: `${tick}:raceFinished:${REMOTE_ID}:1`, tick, type: "raceFinished", winnerId: REMOTE_ID } as RaceEvent],
  });

async function recordingRace() {
  const capture = fakeCapture();
  const { Recorder, made } = fakeRecorderClass();
  vi.stubGlobal("MediaRecorder", Recorder);
  // A ticker, so the recording's copy has a render to follow.
  const stage = Object.assign(fakeStage({ ticker: new FakeTicker() }), { canvas: () => capture.source });
  // The recording canvas the recorder makes is the fake's.
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => (tag === "canvas" ? capture.target : create(tag))) as never);
  const audio = new FakeAudio();
  Object.assign(audio, { captureStream: () => capture.tap });
  const raceVideo = new RaceVideo();
  const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: snapshotAt(0, { phase: "racing" }), stage, audio, raceVideo });
  return { gameplay, raceVideo, made, capture };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("recording the live race", () => {
  it("records from the start, and keeps the video when the race reaches results", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { gameplay, raceVideo, made, capture } = await recordingRace();
    expect(made).toHaveLength(1);
    expect(made[0]!.state).toBe("recording");
    made[0]!.emit([1, 2, 3]);
    gameplay.network.emitSnapshot(finishedAt(12));
    vi.advanceTimersByTime(2_000); // the stall fallback reaches results
    expect(gameplay.lastPublished()).toBe("room.finished");
    vi.useRealTimers();
    await settle();
    expect(raceVideo.current).toMatchObject({ stageId: "snow-shrine", extension: "mp4" });
    expect(raceVideo.current!.blob.size).toBe(3);
    gameplay.screen.exit();
    for (const track of capture.video.tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(capture.release).toHaveBeenCalledOnce();
    // The copy came off the ticker with the recording: nothing is drawn after.
    expect(capture.target.width).toBe(1920);
  });

  it("keeps nothing when the player leaves mid-race, and releases everything", async () => {
    const { gameplay, raceVideo, made, capture } = await recordingRace();
    made[0]!.emit([1]);
    gameplay.screen.exit();
    await settle();
    expect(raceVideo.current).toBeUndefined();
    expect(made[0]!.state).toBe("inactive");
    for (const track of capture.video.tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(capture.release).toHaveBeenCalledOnce();
  });

  it("drops the recording when the tab is hidden mid-race", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { gameplay, raceVideo, made } = await recordingRace();
    made[0]!.emit([1]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(made[0]!.state).toBe("inactive");
    gameplay.network.emitSnapshot(finishedAt(12));
    vi.advanceTimersByTime(2_000);
    vi.useRealTimers();
    await settle();
    expect(raceVideo.current).toBeUndefined();
    gameplay.screen.exit();
  });

  it("races exactly as before where nothing can record", async () => {
    const raceVideo = new RaceVideo();
    const gameplay = await gameplayWithFakeNetwork({ latestSnapshot: snapshotAt(0, { phase: "racing" }), raceVideo });
    gameplay.screen.draw(16);
    expect(raceVideo.current).toBeUndefined();
    gameplay.screen.exit();
  });
});
