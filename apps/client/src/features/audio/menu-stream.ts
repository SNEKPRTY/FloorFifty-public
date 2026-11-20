import type { AudioGraph } from "./graph";
import { audioDebug } from "./diagnostics";
import { readBlob, type OnReceived } from "../../lib/fetch-progress";

export const STREAMED_MENU_ALIAS = "music.mainMenu";

/** The song's type when the server does not say: what the delivery encode is. */
const SONG_TYPE = "audio/mp4";

/**
 * The whole-file menu loop. Race regions still belong to the buffer deck.
 *
 * The song is a download first and a stream second. Setting `Audio.src` to
 * the file's URL looked like a preload but was not one: iOS ignores
 * `preload` until a gesture, so nothing was fetched, and "the song is ready"
 * was a guess. `load()` fetches the file with counted bytes, makes a Blob
 * URL of it, and the element plays from memory -- which needs no network at
 * the tap, seeks to the opening offset at once, and is what lets the splash
 * say "Tap to start" only when the music really is in.
 */
export class MenuStream {
  private element: HTMLAudioElement | undefined;
  private source: MediaElementAudioSourceNode | undefined;
  private wanted = false;
  private asleep = false;
  private lastPosition: number | undefined;
  private offsetSeconds = 0;
  private seekPending = false;
  private requestedAt = 0;
  /** The song's bytes as a Blob URL, once all of them are in. */
  private blobUrl: string | undefined;
  /** The download in flight, shared by whoever asks while it runs. */
  private download: Promise<void> | undefined;
  private readonly listeners = new Set<OnReceived>();

  constructor(private readonly graph: AudioGraph, private readonly url: () => string | undefined) {}

  /**
   * Fetches the whole song, reporting bytes as they arrive, and resolves when
   * the element can play it from memory. Rejects on an error, a refusal or a
   * song the manifest does not name; a failure is not remembered, so the next
   * call downloads again. Callers while one runs share it (their progress is
   * heard; the first caller's `signal` is the one that stops it).
   */
  load(options: { signal?: AbortSignal; onReceived?: OnReceived } = {}): Promise<void> {
    if (this.blobUrl !== undefined) return Promise.resolve();
    if (options.onReceived !== undefined) this.listeners.add(options.onReceived);
    this.download ??= this.fetchSong(options.signal).finally(() => {
      this.download = undefined;
      this.listeners.clear();
    });
    return this.download;
  }

  private async fetchSong(signal: AbortSignal | undefined): Promise<void> {
    const src = this.url();
    if (src === undefined) throw new Error("the menu song is not in the manifest");
    const response = await fetch(src, signal === undefined ? {} : { signal });
    if (!response.ok) throw new Error(`the menu song ${src}: ${response.status}`);
    const announced = response.headers?.get("content-type");
    const type = announced === null || announced === undefined || announced === "" || announced === "application/octet-stream" ? SONG_TYPE : announced;
    const blob = await readBlob(response, type, (received, total) => {
      for (const listener of [...this.listeners]) listener(received, total);
    });
    this.blobUrl = URL.createObjectURL(blob);
    this.prepare();
    // A play asked for while the bytes were coming starts now (a refused one
    // waits for the next gesture, as ever).
    if (this.wanted) {
      this.seek();
      this.resume();
    }
  }

  /** Makes the element once there is something to play. */
  prepare(): void {
    if (this.element !== undefined || this.blobUrl === undefined) return;
    const element = new Audio();
    element.preload = "auto";
    element.loop = true;
    element.src = this.blobUrl;
    element.addEventListener("loadedmetadata", this.seek);
    element.addEventListener("playing", this.onPlaying);
    this.element = element;
  }

  /**
   * Asks for the song from `fromMs`. With the bytes in it starts at once;
   * without, it starts when they land (`load` is the one that fetches them).
   */
  play(fromMs: number): void {
    this.wanted = true;
    this.offsetSeconds = Math.max(0, fromMs) / 1000;
    this.lastPosition = this.offsetSeconds * 1000;
    this.seekPending = true;
    this.requestedAt = performance.now();
    this.prepare();
    if (this.element === undefined) return;
    this.seek();
    this.resume();
  }

  private readonly seek = (): void => {
    if (!this.wanted || this.element === undefined) return;
    // Some WebKit versions defer seeking until metadata arrives. Keep the
    // requested offset for that event instead of starting the song at zero.
    try {
      this.element.currentTime = this.offsetSeconds;
      this.seekPending = false;
    } catch {
      // loadedmetadata retries; position/stop retain the requested offset.
    }
  };

  private readonly onPlaying = (): void => {
    audioDebug?.pin("stream:menu", `${STREAMED_MENU_ALIAS}: streaming, play ${Math.round(performance.now() - this.requestedAt)}ms`);
  };

  /** Called synchronously from unlock and every gesture, even on a running graph. */
  resume(): void {
    const element = this.element;
    const context = this.graph.context;
    if (!this.wanted || this.asleep || element === undefined || context?.createMediaElementSource === undefined) return;
    if (this.source === undefined) {
      this.source = context.createMediaElementSource(element);
      this.source.connect(this.graph.musicInput!);
    }
    // Do not wait for AudioContext.resume: media autoplay permission is
    // separate and WebKit needs this play() inside the gesture too.
    if (!element.paused) return;
    void element.play().catch((error: unknown) => {
      // Keep the request so the next eligible gesture can retry. stop() and
      // handoff clear it; a late rejection must never restore an old request.
      audioDebug?.log(`stream ${STREAMED_MENU_ALIAS} play: ${String(error)}`);
    });
  }

  get playing(): boolean { return this.wanted && this.element !== undefined && !this.element.paused; }
  get position(): number | undefined {
    if (!this.wanted) return this.lastPosition;
    return this.seekPending || this.element === undefined ? this.offsetSeconds * 1000 : this.element.currentTime * 1000;
  }

  stop(): void {
    if (!this.wanted) return;
    this.lastPosition = this.position;
    this.wanted = false;
    this.element?.pause();
  }

  sleep(): void {
    this.asleep = true;
    this.element?.pause();
  }

  wake(): void {
    this.asleep = false;
    this.resume();
  }

  destroy(): void {
    this.stop();
    this.source?.disconnect();
    this.source = undefined;
    if (this.blobUrl !== undefined) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = undefined;
    const element = this.element;
    if (element === undefined) return;
    element.removeEventListener("loadedmetadata", this.seek);
    element.removeEventListener("playing", this.onPlaying);
    element.removeAttribute("src");
    element.load();
    this.element = undefined;
  }
}
