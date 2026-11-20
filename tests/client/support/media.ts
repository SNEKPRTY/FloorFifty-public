/**
 * `MediaRecorder`, capture streams and an audio tap, for the race recording
 * (unlockables spec §6.1). jsdom has none of them.
 */
import { vi } from "vitest";

export type FakeTrack = { kind: string; stop: ReturnType<typeof vi.fn> };

export function fakeStream(kinds: string[]): { tracks: FakeTrack[]; stream: MediaStream } {
  const tracks: FakeTrack[] = kinds.map((kind) => ({ kind, stop: vi.fn() }));
  return {
    tracks,
    stream: {
      getTracks: () => [...tracks],
      getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
      addTrack: (track: FakeTrack) => tracks.push(track),
    } as unknown as MediaStream,
  };
}

export type FakeRecorder = {
  state: "inactive" | "recording";
  options: MediaRecorderOptions;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  emit(bytes: number[]): void;
};

/** A recorder whose chunks and errors the test drives; `made` lists every one constructed. */
export function fakeRecorderClass(
  supported: (type: string) => boolean = () => true,
  throws = false,
): { Recorder: typeof MediaRecorder; made: FakeRecorder[] } {
  const made: FakeRecorder[] = [];
  class Recorder implements FakeRecorder {
    static isTypeSupported = supported;
    state: "inactive" | "recording" = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    constructor(
      readonly stream: MediaStream,
      readonly options: MediaRecorderOptions,
    ) {
      if (throws) throw new Error("no recorder for you");
      made.push(this);
    }
    start(): void {
      this.state = "recording";
    }
    stop(): void {
      this.state = "inactive";
      queueMicrotask(() => this.onstop?.());
    }
    emit(bytes: number[]): void {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
    }
  }
  return { Recorder: Recorder as unknown as typeof MediaRecorder, made };
}

/**
 * The game canvas, the recording canvas it is copied into (with its video
 * track and a `drawImage` spy), a frame source the test pumps, and an audio
 * tap whose release is a spy.
 */
export function fakeCapture() {
  const video = fakeStream(["video"]);
  const audio = fakeStream(["audio"]);
  const release = vi.fn();
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const context = { drawImage, fillRect, fillStyle: "", imageSmoothingEnabled: false, imageSmoothingQuality: "low" };
  const target = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    captureStream: vi.fn(() => video.stream),
  } as unknown as HTMLCanvasElement;
  const source = {} as HTMLCanvasElement;
  const copies = new Set<() => void>();
  const frames = vi.fn((copy: () => void) => {
    copies.add(copy);
    return () => copies.delete(copy);
  });
  return {
    source,
    target,
    context,
    drawImage,
    fillRect,
    video,
    audio,
    tap: { stream: audio.stream, release },
    release,
    frames,
    /** Runs one render's copy. */
    frame: () => copies.forEach((copy) => copy()),
    copying: () => copies.size,
    createCanvas: () => target,
  };
}
