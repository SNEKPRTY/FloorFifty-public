import type { AudioGraph } from "./graph";
import { audioDebug } from "./diagnostics";

/** Where a song's file is served, and the loop region its content authored. */
export type SongStreamSource = { src: string; loopStartMs?: number; loopEndMs?: number };

/**
 * How far ahead of "now" the decoded copy is scheduled when it takes over,
 * and how long the two overlap. The media element's clock and the graph's
 * clock are not locked together, so they can disagree by tens of
 * milliseconds; a short crossfade hides that where a hard switch would flam.
 */
export const SWAP_LEAD_SECONDS = 0.15;
export const SWAP_FADE_SECONDS = 0.25;

/**
 * A race song heard from the network while its decoded copy is made.
 *
 * Why this exists: decoding a whole song takes about 20 s on an iPad (WebKit,
 * measured 2026-10-10), and a race that starts before the decode lands used
 * to be silent for that long. A media element can play the file at once, the
 * way the menu song does (`MenuStream`), so the song starts right away and the
 * decoded copy, which keeps the authored seamless loop region, takes over when
 * it arrives (`MusicDeck.playMusic` does the swap).
 *
 * It is a stand-in and never the long-term player, so it stays small: no
 * download, no handoff of position beyond what the deck asks for, and the
 * authored loop region is only roughly honoured (see `onTimeUpdate`).
 *
 * One element serves every song, for the iPad's sake: WebKit lets a media
 * element play without a tap only after that same element has played during
 * one. `prime` plays a silent clip inside a gesture to earn that, and each
 * song then only changes the element's `src`.
 */
export class SongBridge {
  private element: HTMLAudioElement | undefined;
  private source: MediaElementAudioSourceNode | undefined;
  /** The bridge's own level, which the crossfade pulls down. */
  private level: GainNode | undefined;
  private alias: string | undefined;
  private wanted = false;
  private asleep = false;
  private primed = false;
  private priming = false;
  private loopStartMs = 0;
  private loopEndMs: number | undefined;
  private offsetSeconds = 0;
  private seekPending = false;
  private rate = 1;
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly graph: AudioGraph,
    private readonly find: (alias: string) => SongStreamSource | undefined,
  ) {}

  /** The song asked for and not given up on, sounding or waiting for a gesture. */
  get held(): string | undefined {
    return this.wanted ? this.alias : undefined;
  }

  get playing(): boolean {
    return this.wanted && this.element !== undefined && !this.element.paused;
  }

  /** Where the song is in its own file, in milliseconds. */
  get position(): number | undefined {
    if (!this.wanted || this.element === undefined) return undefined;
    return this.seekPending ? this.offsetSeconds * 1000 : this.element.currentTime * 1000;
  }

  /**
   * Called on every gesture. Plays a silent clip once, so the element is later
   * allowed to play a song with no gesture of its own (the race starts from a
   * timer, not a tap). Nothing is made until a gesture asks for it.
   */
  prime(): void {
    if (this.primed || this.priming || this.wanted || typeof Audio === "undefined") return;
    // A blob: URL, because Ruken's content policy allows `media-src 'self' blob:`
    // and a data: URL would be refused. Let go once the clip has played or failed.
    // Priming is only a help: a browser without blob URLs just goes unprimed,
    // and a gesture must never fail because of it.
    if (typeof URL.createObjectURL !== "function") return;
    const clipUrl = silentClipUrl();
    const element = this.element ?? this.create();
    element.src = clipUrl;
    this.priming = true;
    element.play().then(
      () => {
        this.priming = false;
        this.primed = true;
        URL.revokeObjectURL(clipUrl);
        // A song may have claimed the element while the clip started.
        if (!this.wanted) element.pause();
      },
      () => {
        // Not a gesture after all; the next one tries again.
        this.priming = false;
        URL.revokeObjectURL(clipUrl);
      },
    );
  }

  /** Starts `alias` from `fromMs`. False when it cannot be streamed, and nothing is changed. */
  start(alias: string, fromMs: number, rate: number): boolean {
    const found = this.find(alias);
    const context = this.graph.context;
    if (found === undefined || typeof Audio === "undefined" || context?.createMediaElementSource === undefined) return false;
    if (this.graph.musicInput === undefined) return false;
    this.cancelPause();
    const element = this.element ?? this.create();
    if (this.source === undefined) {
      this.source = context.createMediaElementSource(element);
      this.level = context.createGain();
      this.source.connect(this.level);
      this.level.connect(this.graph.musicInput);
    }
    this.level!.gain.cancelScheduledValues(context.currentTime);
    this.level!.gain.setValueAtTime(1, context.currentTime);

    this.alias = alias;
    this.wanted = true;
    this.loopStartMs = found.loopStartMs ?? 0;
    this.loopEndMs = found.loopEndMs;
    this.rate = rate;
    this.offsetSeconds = Math.max(0, fromMs) / 1000;
    this.seekPending = this.offsetSeconds > 0;
    // A native loop is the safety net: if the decoded copy is slow enough that
    // the stream reaches the end of the file, it goes round rather than stops.
    element.loop = true;
    element.src = found.src;
    element.playbackRate = rate;
    audioDebug?.log(`song bridge ${alias}: streaming from ${Math.round(fromMs)}ms while it decodes`);
    this.seek();
    this.resume();
    return true;
  }

  /** Called on every gesture and on wake: plays if it should be and is not. */
  resume(): void {
    const element = this.element;
    if (!this.wanted || this.asleep || element === undefined || !element.paused) return;
    void element.play().catch((error: unknown) => {
      // Kept wanted: the next gesture tries again, and the decoded copy takes
      // over when it lands whatever happens here.
      audioDebug?.log(`song bridge ${this.alias ?? ""} play: ${String(error)}`);
    });
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.element !== undefined) this.element.playbackRate = rate;
  }

  /**
   * The decoded copy is taking over `SWAP_LEAD_SECONDS` from now: fade out
   * across the overlap, then pause. Returns where the song will be when the
   * decoded copy starts, in milliseconds, for it to start from.
   */
  handOff(): number | undefined {
    const position = this.position;
    const context = this.graph.context;
    if (position === undefined || context === undefined || this.level === undefined) return undefined;
    const from = context.currentTime + SWAP_LEAD_SECONDS;
    audioDebug?.log(`song bridge ${this.alias ?? ""}: decoded copy takes over at ${Math.round(position)}ms`);
    this.level.gain.cancelScheduledValues(context.currentTime);
    this.level.gain.setValueAtTime(1, from);
    this.level.gain.linearRampToValueAtTime(0, from + SWAP_FADE_SECONDS);
    this.wanted = false;
    this.alias = undefined;
    this.cancelPause();
    this.pauseTimer = setTimeout(() => this.element?.pause(), (SWAP_LEAD_SECONDS + SWAP_FADE_SECONDS) * 1000);
    return position + SWAP_LEAD_SECONDS * 1000 * this.rate;
  }

  stop(): void {
    this.wanted = false;
    this.alias = undefined;
    this.cancelPause();
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
    this.level?.disconnect();
    this.source = undefined;
    this.level = undefined;
    const element = this.element;
    if (element === undefined) return;
    element.removeEventListener("loadedmetadata", this.seek);
    element.removeEventListener("timeupdate", this.onTimeUpdate);
    element.removeAttribute("src");
    element.load();
    this.element = undefined;
  }

  private create(): HTMLAudioElement {
    const element = new Audio();
    element.preload = "auto";
    element.addEventListener("loadedmetadata", this.seek);
    element.addEventListener("timeupdate", this.onTimeUpdate);
    this.element = element;
    return element;
  }

  private cancelPause(): void {
    if (this.pauseTimer !== undefined) clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
  }

  /** WebKit may refuse to seek before the file's metadata is in; this retries when it is. */
  private readonly seek = (): void => {
    if (!this.wanted || this.element === undefined || !this.seekPending) return;
    try {
      this.element.currentTime = this.offsetSeconds;
      this.seekPending = false;
    } catch {
      // loadedmetadata calls this again.
    }
  };

  /**
   * Goes back to the loop region's start when the stream passes its end, as the
   * decoded copy would. `timeupdate` fires a few times a second, so this can
   * overshoot by a fraction of a second and is not seamless; it only matters
   * if the decode takes longer than the song's first pass.
   */
  private readonly onTimeUpdate = (): void => {
    const element = this.element;
    if (!this.wanted || element === undefined || this.loopEndMs === undefined) return;
    if (element.currentTime * 1000 >= this.loopEndMs) element.currentTime = this.loopStartMs / 1000;
  };
}

/** A tenth of a second of silence as a WAV blob URL: the clip `prime` plays. */
function silentClipUrl(): string {
  const samples = 800; // 0.1 s at 8 kHz, 8-bit mono
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // size of the format chunk
  view.setUint16(20, 1, true); // plain PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true); // sample rate
  view.setUint32(28, 8000, true); // bytes per second
  view.setUint16(32, 1, true); // bytes per frame
  view.setUint16(34, 8, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(0x80, 44); // 8-bit PCM is unsigned: 0x80 is silence
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}
