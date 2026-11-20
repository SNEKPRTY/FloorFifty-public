/**
 * The live race, recorded as video (unlockables spec §6.1, amended
 * 2026-10-03): the play field as drawn on screen, LCD panel and all, and the
 * game's own sound, through `MediaRecorder`, in the background on every race,
 * so Save and Share in the replay window never wait.
 *
 * Not the game canvas itself: that is the whole window at the display's
 * density (2560 px wide and more on a Retina screen), letterbox bars
 * included, and an encoder starved on it smears. Each frame the play field is
 * copied, right after the game renders it, into a recording canvas whose long
 * side is 1920 px (1280 on a phone), and that canvas is what is recorded.
 *
 * What the canvas does not draw -- the DOM HUD, the menus, the replay bar --
 * is not in the video. Whatever happens, every capture track is stopped, the
 * frame copy removed and the audio tap released exactly once.
 */

import type { DeviceClass } from "@floor-fifty/shared/common/protocol";

/** MP4 first (Chromium, WebKit); WebM where nothing else records (Firefox). */
export const VIDEO_TYPES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"] as const;

const FRAME_RATE = 30;
/** The recording's long side; the short side follows the play field's shape. */
const VIDEO_LONG_SIDE = 1920;
/** Enough for the LCD panel's fine mesh at 1080p: about 60 MB for a 60 s race. */
const VIDEO_BITS = 8_000_000;
/**
 * A phone records smaller and lighter: the whole race is held in memory until
 * results, and at the desktop's rate a three-minute Infinite race is 180 MB.
 * Its screen is small enough that 1280 px loses little.
 */
const PHONE_LONG_SIDE = 1280;
const PHONE_VIDEO_BITS = 4_000_000;
const AUDIO_BITS = 128_000;

export type Rect = { x: number; y: number; width: number; height: number };

/** The recording's size for a play field of `region`'s shape: long side 1920, both sides even. */
export function videoSize(region: Pick<Rect, "width" | "height">, longSide: number = VIDEO_LONG_SIDE): { width: number; height: number } {
  const scale = longSide / Math.max(region.width, region.height, 1);
  const even = (value: number): number => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(region.width), height: even(region.height) };
}

/**
 * Where a field of `region`'s shape is drawn in a recording of `size`: the
 * whole recording when the shapes match, else fitted and centred. A phone
 * turned or a window resized mid-race changes the field, and an encoder
 * cannot follow the recording changing size.
 */
export function fitInto(region: Pick<Rect, "width" | "height">, size: { width: number; height: number }): Rect {
  const scale = Math.min(size.width / region.width, size.height / region.height);
  const width = region.width * scale;
  const height = region.height * scale;
  // Within a pixel of the whole recording is the whole recording (the even rounding of `videoSize`).
  if (size.width - width < 1 && size.height - height < 1) return { x: 0, y: 0, ...size };
  return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height };
}

export function pickVideoType(isSupported: (type: string) => boolean): string | undefined {
  return VIDEO_TYPES.find((type) => isSupported(type));
}

export type RecordedVideo = { blob: Blob; type: string; extension: "mp4" | "webm"; stageId: string; finishedAt: Date };

export type AudioTap = { stream: MediaStream; release(): void };

export type RecorderDeps = {
  /** The game canvas. */
  canvas: HTMLCanvasElement | undefined;
  /** The play field on that canvas, in its own (device) pixels. */
  region: () => Rect;
  /** Runs `copy` after every render, in the same task; returns its removal. */
  frames: ((copy: () => void) => () => void) | undefined;
  audio: AudioTap | undefined;
  Recorder?: typeof MediaRecorder | undefined;
  createCanvas?: () => HTMLCanvasElement;
  /** A phone records at its lighter profile; anything else at the full one. */
  deviceClass?: DeviceClass;
};

export class RaceRecorder {
  private readonly chunks: Blob[] = [];
  private failed = false;
  private released = false;

  /** A recorder already recording, or undefined when this device cannot record (nothing is left held). */
  static start(deps: RecorderDeps): RaceRecorder | undefined {
    const Recorder = deps.Recorder ?? (typeof MediaRecorder === "undefined" ? undefined : MediaRecorder);
    const type = Recorder === undefined ? undefined : pickVideoType((candidate) => Recorder.isTypeSupported(candidate));
    const source = deps.canvas;
    if (Recorder === undefined || type === undefined || source === undefined || deps.frames === undefined) {
      deps.audio?.release();
      return undefined;
    }
    let stream: MediaStream | undefined;
    let stopCopying: (() => void) | undefined;
    try {
      const target = (deps.createCanvas ?? (() => document.createElement("canvas")))();
      const phone = deps.deviceClass === "phone";
      const size = videoSize(deps.region(), phone ? PHONE_LONG_SIDE : VIDEO_LONG_SIDE);
      target.width = size.width;
      target.height = size.height;
      const context = target.getContext("2d", { alpha: false });
      if (context === null || typeof target.captureStream !== "function") throw new Error("this canvas cannot record");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      const copy = (): void => {
        const region = deps.region();
        if (region.width <= 0 || region.height <= 0) return;
        const into = fitInto(region, size);
        if (into.width < size.width || into.height < size.height) {
          context.fillStyle = "#2e222f";
          context.fillRect(0, 0, size.width, size.height);
        }
        context.drawImage(source, region.x, region.y, region.width, region.height, into.x, into.y, into.width, into.height);
      };
      // One frame in hand before the recorder starts, so the video never opens black.
      copy();
      stopCopying = deps.frames(copy);
      stream = target.captureStream(FRAME_RATE);
      for (const track of deps.audio?.stream.getAudioTracks() ?? []) stream.addTrack(track);
      const recorder = new Recorder(stream, { mimeType: type, videoBitsPerSecond: phone ? PHONE_VIDEO_BITS : VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS });
      return new RaceRecorder(recorder, stream, type, deps.audio, stopCopying);
    } catch {
      stopCopying?.();
      for (const track of stream?.getTracks() ?? []) track.stop();
      deps.audio?.release();
      return undefined;
    }
  }

  private constructor(
    private readonly recorder: MediaRecorder,
    private readonly stream: MediaStream,
    private readonly type: string,
    private readonly audio: AudioTap | undefined,
    private readonly stopCopying: () => void,
  ) {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onerror = () => {
      this.failed = true;
    };
    // A chunk a second, so an error late in the race loses little and a
    // long race is not one huge buffer handed over at the end.
    recorder.start(1000);
  }

  /** Stops, and resolves the race's video, or undefined after an error or with nothing recorded. */
  finish(meta: { stageId: string; finishedAt: Date }): Promise<RecordedVideo | undefined> {
    return new Promise((resolve) => {
      const done = (): void => {
        this.release();
        if (this.failed || this.chunks.length === 0) return resolve(undefined);
        const extension = this.type.startsWith("video/mp4") ? "mp4" : "webm";
        resolve({ blob: new Blob(this.chunks, { type: this.type }), type: this.type, extension, ...meta });
      };
      if (this.recorder.state === "inactive") return done();
      this.recorder.onstop = done;
      try {
        this.recorder.stop();
      } catch {
        this.failed = true;
        done();
      }
    });
  }

  /** Stops with no result. */
  abort(): void {
    this.failed = true;
    this.recorder.onstop = null;
    try {
      if (this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      // Already stopped.
    }
    this.release();
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    this.stopCopying();
    for (const track of this.stream.getTracks()) track.stop();
    this.audio?.release();
  }
}
