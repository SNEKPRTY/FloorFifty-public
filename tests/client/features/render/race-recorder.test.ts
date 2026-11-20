/**
 * The live race recorded as video (unlockables spec §6.1, amended): the
 * canvas and the game's sound through `MediaRecorder`, MP4 before WebM, and
 * every capture track and the audio tap released whatever happens.
 */
import { describe, expect, it } from "vitest";
import { pickVideoType, RaceRecorder, VIDEO_TYPES, videoSize, type Rect } from "../../../../apps/client/src/features/render/race-recorder";
import { RaceVideo, retireVideoWithRace } from "../../../../apps/client/src/features/net/race-video.svelte";
import { FakeNetwork } from "../../support/fakes/network";
import { fakeCapture, fakeRecorderClass } from "../../support/media";
import { snapshotAt } from "../../support/snapshots";

function setup(options: { supported?: (type: string) => boolean; throws?: boolean; canvas?: "none" | "no-capture"; region?: Rect } = {}) {
  const capture = fakeCapture();
  if (options.canvas === "no-capture") (capture.target as unknown as { captureStream?: unknown }).captureStream = undefined;
  const { Recorder, made } = fakeRecorderClass(options.supported, options.throws);
  const region = options.region ?? { x: 0, y: 54, width: 2560, height: 1440 };
  const deps = {
    canvas: options.canvas === "none" ? undefined : capture.source,
    region: () => region,
    frames: capture.frames,
    audio: capture.tap,
    Recorder,
    createCanvas: capture.createCanvas,
  };
  return { deps, made, ...capture };
}

/** jsdom's Blob has no `arrayBuffer`. */
const bytesOf = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });

const meta = { stageId: "rooftops", finishedAt: new Date(2026, 9, 3, 22, 0) };

describe("the video type", () => {
  it("prefers MP4 with codecs, then MP4, then WebM", () => {
    expect(pickVideoType(() => true)).toBe(VIDEO_TYPES[0]);
    expect(pickVideoType((type) => type === "video/mp4" || type.startsWith("video/webm"))).toBe("video/mp4");
    expect(pickVideoType((type) => type === "video/webm")).toBe("video/webm");
    expect(pickVideoType(() => false)).toBeUndefined();
  });
});

describe("the race recorder", () => {
  it("records a 1920-wide copy of the play field, with the game's sound, at the spec's rates", () => {
    const { deps, made, video, target, drawImage, source, frame } = setup();
    const recorder = RaceRecorder.start(deps);
    expect(recorder).toBeDefined();
    expect([target.width, target.height]).toEqual([1920, 1080]);
    expect(target.captureStream).toHaveBeenCalledWith(30);
    expect(made[0]!.state).toBe("recording");
    expect(made[0]!.options).toMatchObject({ mimeType: VIDEO_TYPES[0], videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
    expect(video.tracks.map((track) => track.kind)).toEqual(["video", "audio"]);
    // One copy before the recorder starts, then one after every render: the field alone, no bars.
    expect(drawImage).toHaveBeenCalledTimes(1);
    frame();
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenLastCalledWith(source, 0, 54, 2560, 1440, 0, 0, 1920, 1080);
    recorder!.abort();
  });

  it("records a phone at 1280 px and half the bits, so a three-minute race is not held as 180 MB", () => {
    const { deps, made, target } = setup();
    const recorder = RaceRecorder.start({ ...deps, deviceClass: "phone" });
    expect([target.width, target.height]).toEqual([1280, 720]);
    expect(made[0]!.options).toMatchObject({ videoBitsPerSecond: 4_000_000 });
    recorder!.abort();
  });

  it("fits a field that changes shape mid-race inside the recording, never stretched", () => {
    const region = { x: 0, y: 54, width: 2560, height: 1440 };
    const { deps, drawImage, fillRect, source, frame } = setup({ region });
    const recorder = RaceRecorder.start(deps)!;
    // The phone turned upright: the recording keeps its size (an encoder
    // cannot follow a change), and the field is fitted in it, centred, on black.
    Object.assign(region, { x: 0, y: 0, width: 1440, height: 2560 });
    frame();
    expect(fillRect).toHaveBeenLastCalledWith(0, 0, 1920, 1080);
    expect(drawImage).toHaveBeenLastCalledWith(source, 0, 0, 1440, 2560, 656.25, 0, 607.5, 1080);
    // Back to the shape it began with: the whole recording again.
    Object.assign(region, { x: 0, y: 54, width: 2560, height: 1440 });
    fillRect.mockClear();
    frame();
    expect(fillRect).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenLastCalledWith(source, 0, 54, 2560, 1440, 0, 0, 1920, 1080);
    recorder.abort();
  });

  it("sizes the recording to the field's shape, long side 1920, even sides", () => {
    expect(videoSize({ width: 2560, height: 1440 })).toEqual({ width: 1920, height: 1080 });
    expect(videoSize({ width: 1280, height: 720 })).toEqual({ width: 1920, height: 1080 });
    expect(videoSize({ width: 780, height: 1688 })).toEqual({ width: 888, height: 1920 });
    expect(videoSize({ width: 999, height: 333 })).toEqual({ width: 1920, height: 640 });
  });

  it.each([
    ["no MediaRecorder", { Recorder: undefined }],
    ["no game canvas", { canvas: "none" as const }],
    ["a recording canvas that cannot capture", { canvas: "no-capture" as const }],
    ["no supported type", { supported: () => false }],
    ["a recorder that throws", { throws: true }],
  ])("starts nothing with %s, and releases what it took", (_name, change) => {
    const { deps, video, release, copying } = setup(change as never);
    const recorder = RaceRecorder.start("Recorder" in change ? { ...deps, Recorder: undefined } : deps);
    expect(recorder).toBeUndefined();
    expect(release).toHaveBeenCalledOnce();
    expect(copying()).toBe(0);
    for (const track of video.tracks) expect(track.stop.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("finishes with one Blob of every chunk, named for the race, and releases everything once", async () => {
    const { deps, made, video, release } = setup();
    const recorder = RaceRecorder.start(deps)!;
    made[0]!.emit([1, 2]);
    made[0]!.emit([3]);
    const recorded = await recorder.finish(meta);
    expect(recorded).toMatchObject({ type: VIDEO_TYPES[0], extension: "mp4", stageId: "rooftops", finishedAt: meta.finishedAt });
    expect(new Uint8Array(await bytesOf(recorded!.blob))).toEqual(new Uint8Array([1, 2, 3]));
    expect(recorded!.blob.type).toBe(VIDEO_TYPES[0]);
    for (const track of video.tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    recorder.abort();
    expect(release).toHaveBeenCalledOnce();
  });

  it("names a WebM recording .webm", async () => {
    const { deps, made } = setup({ supported: (type) => type.startsWith("video/webm") });
    const recorder = RaceRecorder.start(deps)!;
    made[0]!.emit([1]);
    expect((await recorder.finish(meta))?.extension).toBe("webm");
  });

  it("finishes with nothing after an error, or with no chunks", async () => {
    const failed = setup();
    const broken = RaceRecorder.start(failed.deps)!;
    failed.made[0]!.emit([1]);
    failed.made[0]!.onerror?.({});
    expect(await broken.finish(meta)).toBeUndefined();
    expect(failed.release).toHaveBeenCalledOnce();

    const empty = setup();
    expect(await RaceRecorder.start(empty.deps)!.finish(meta)).toBeUndefined();
  });

  it("aborts with no result, releasing everything once", () => {
    const { deps, video, release, made, copying } = setup();
    const recorder = RaceRecorder.start(deps)!;
    expect(copying()).toBe(1);
    recorder.abort();
    recorder.abort();
    expect(copying()).toBe(0);
    expect(made[0]!.state).toBe("inactive");
    for (const track of video.tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("the race's video", () => {
  it("keeps one video until it is retired", () => {
    const store = new RaceVideo();
    const one = { blob: new Blob(), type: "video/mp4", extension: "mp4" as const, ...meta };
    const two = { ...one, stageId: "snow-shrine" };
    store.keep(one);
    store.keep(two);
    expect(store.current).toBe(two);
    store.retire();
    expect(store.current).toBeUndefined();
  });

  it("retires with the next race's countdown and when the room is gone, not at results", () => {
    const network = new FakeNetwork();
    const store = new RaceVideo();
    const video = { blob: new Blob(), type: "video/mp4", extension: "mp4" as const, ...meta };
    retireVideoWithRace(network, store);
    store.keep(video);
    network.emitSnapshot(snapshotAt(0, { phase: "finished" }));
    network.emitSnapshot(snapshotAt(0, { phase: "lobby" }));
    expect(store.current).toBe(video);
    network.emitSnapshot(snapshotAt(0, { phase: "countdown" }));
    expect(store.current).toBeUndefined();
    store.keep(video);
    network.emitConnectionState("offline");
    expect(store.current).toBeUndefined();
  });
});
