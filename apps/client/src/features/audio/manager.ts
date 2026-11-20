import { AudioEngine } from "./engine";
import type {
  AudioEngineOptions,
  AudioPort,
  Bus,
  CueOptions,
  DecodedTrack,
  MixName,
  MusicSpectrum,
  NowPlaying,
  AudioContextLike,
} from "./model";
import { audioDebug } from "./diagnostics";
import { STREAMED_MENU_ALIAS } from "./menu-stream";
import type { SongStreamSource } from "./song-bridge";
import { LoadMeter } from "../../lib/load-meter";
import { readJson } from "../../lib/fetch-progress";

/**
 * The engine, wired to a real browser and to the served asset manifest.
 *
 * `AudioPort` is the surface the screens were written against, and it stays:
 * `play` is the stage loop, `stop` ends it, `setMuted` is the mute. What it
 * gains is `unlock`, `cue`, and the loop points, which `HTMLAudioElement` had
 * no way to express.
 *
 * Loop points come from the Pixi bundle entry rather than from this file. The
 * art manifest is the one place an asset's facts live, `sync-client-assets`
 * carries them through as `data`, and a second copy here would be a second
 * thing to keep in step with a re-export.
 */
export class AudioManager implements AudioPort {
  private readonly engine: AudioEngine;
  /** Alias to served URL and authored loop region, filled by `load`. */
  private sources = new Map<string, { src: string; data: AudioAssetData }>();
  private context: AudioContextLike | undefined;
  /** The page's stall rule: the menu song's download answers to it. */
  private readonly loads: LoadMeter;

  constructor(options?: Partial<AudioEngineOptions> & { loads?: LoadMeter }) {
    this.loads = options?.loads ?? new LoadMeter();
    this.engine = new AudioEngine({
      menuStreamUrl: options?.menuStreamUrl ?? (() => this.sources.get("music.mainMenu")?.src),
      songStream: options?.songStream ?? ((alias) => this.streamableSong(alias)),
      createContext: options?.createContext ?? (() => this.browserContext()),
      decode: options?.decode ?? ((alias) => this.watchedDecode(alias)),
    });
  }

  get mixer(): AudioEngine {
    return this.engine;
  }

  /**
   * Reads one bundle of the served manifest so its aliases resolve to files,
   * adding them to those earlier loads mapped: the effects in `audio`, then a
   * song's own `song-<id>` bundle.
   */
  async load(bundle = "audio"): Promise<void> {
    // Filled aside and merged in whole, so a decode asked for mid-load finds
    // either the old map or the new one, never one half filled. A failed
    // fetch adds nothing and takes nothing away.
    const sources = new Map<string, { src: string; data: AudioAssetData }>();
    try {
      // Under the page's stall rule: a manifest that never answers must not
      // hold the splash for ever. A stall lands in the catch below like any
      // failure, and the menu song's preload then says it is not there.
      const manifest = await this.loads.guard(async (signal) => {
        const response = await fetch(MANIFEST_URL, { signal });
        if (!response.ok) return undefined;
        return readJson<{
          bundles?: { name: string; assets: { alias: string[]; src: string; data?: AudioAssetData }[] }[];
        }>(response, () => this.loads.progress());
      });
      if (manifest === undefined) return;
      const entries = manifest.bundles?.find((entry) => entry.name === bundle)?.assets ?? [];
      for (const asset of entries) {
        for (const alias of asset.alias) {
          sources.set(alias, { src: asset.src, data: asset.data ?? {} });
        }
      }
    } catch {
      // No manifest reachable is indistinguishable from an empty bundle, and
      // neither is an error a player can act on.
    }
    this.sources = new Map([...this.sources, ...sources]);
  }

  /**
   * Where a race song's file is and its authored loop region, for hearing it
   * while it decodes. Only songs: a cue or preview is short enough to decode
   * at once, and the menu song has its own stream.
   */
  private streamableSong(alias: string): SongStreamSource | undefined {
    if (!alias.startsWith("music.") || alias === STREAMED_MENU_ALIAS) return undefined;
    const entry = this.sources.get(alias);
    if (entry === undefined) return undefined;
    return {
      src: entry.src,
      ...(entry.data.loopStartMs === undefined ? {} : { loopStartMs: entry.data.loopStartMs }),
      ...(entry.data.loopEndMs === undefined ? {} : { loopEndMs: entry.data.loopEndMs }),
    };
  }

  /** Whether some `load` has mapped this alias to a file. */
  hasSource(alias: string): boolean {
    return this.sources.has(alias);
  }

  /** Starts audio. Must be called from inside a user gesture. */
  async unlock(): Promise<void> {
    await this.engine.unlock();
  }

  /**
   * Gets a track ready for its first play. The menu song is the whole file
   * downloaded (`onProgress` hears the fraction), guarded by the stall rule;
   * the rest are decoded as before.
   */
  preload(cue: string, onProgress?: (fraction: number) => void): Promise<void> {
    if (cue !== STREAMED_MENU_ALIAS) return this.engine.preload(cue);
    let reported = 0;
    const report = (fraction: number): void => {
      if (fraction <= reported) return;
      reported = fraction;
      onProgress?.(fraction);
    };
    return this.loads
      .guard((signal) =>
        this.engine.preload(cue, {
          signal,
          onReceived: (received, total) => {
            this.loads.progress();
            if (total !== undefined) report(Math.min(1, received / total));
          },
        }),
      )
      .then(() => report(1));
  }

  play(cue: string, fromMs?: number): void {
    void this.engine.playMusic(cue, fromMs);
  }

  positionOf(cue: string): number | undefined {
    return this.engine.positionOf(cue);
  }

  isLooping(cue: string): boolean {
    return this.engine.isLooping(cue);
  }

  nowPlaying(): NowPlaying | undefined {
    return this.engine.nowPlaying();
  }

  stop(cue?: string): void {
    this.engine.stopMusic(cue);
  }

  playSection(cue: string, startMs: number, endMs: number): void {
    void this.engine.playSection(cue, startMs, endMs);
  }

  playPreview(alias: string): void {
    void this.engine.playPreview(alias);
  }

  stopPreview(): void {
    this.engine.stopPreview();
  }

  releaseTrack(alias: string): void {
    this.engine.release(alias);
  }

  /** One effect or interface sound, de-duplicated by its authoritative event. */
  cue(alias: string, options: CueOptions): void {
    void this.engine.playCue(alias, options);
  }

  cancelPending(prefix: string): void {
    this.engine.cancelPending(prefix);
  }

  stopCues(prefix: string): void {
    this.engine.stopCues(prefix);
  }

  playBed(alias: string, gain?: number): void {
    void this.engine.playBed(alias, gain);
  }

  stopBed(alias?: string): void {
    this.engine.stopBed(alias);
  }

  setDrone(alias: string, level: number, rate?: number): void {
    void this.engine.setDrone(alias, level, rate);
  }

  stopDrone(): void {
    this.engine.stopDrone();
  }

  setMuted(muted: boolean): void {
    this.engine.setMuted(muted);
  }

  setUnfocused(unfocused: boolean): void {
    this.engine.setUnfocused(unfocused);
  }

  setHostGain(gain: number): void {
    this.engine.setHostGain(gain);
  }

  /** The player's own volume for a bus, from settings. */
  setPlayerVolume(bus: Bus, value: number): void {
    this.engine.setPlayerVolume(bus, value);
  }

  setMusicGain(gain: number): void {
    this.engine.setBusGain("music", gain);
  }

  setMusicCutoff(hz: number): void {
    this.engine.setMusicCutoff(hz);
  }

  slowMusic(scale: number): void {
    this.engine.slowMusic(scale);
  }

  setMusicRate(rate: number): void {
    this.engine.setMusicRate(rate);
  }

  setMix(name: MixName): void {
    this.engine.setMix(name);
  }

  setDanger(level: number): void {
    this.engine.setDanger(level);
  }

  musicSpectrum(): MusicSpectrum | undefined {
    return this.engine.musicSpectrum();
  }

  captureStream(): { stream: MediaStream; release(): void } | undefined {
    return this.engine.captureStream();
  }

  get isMuted(): boolean {
    return this.engine.isMuted;
  }

  get playing(): boolean {
    return this.engine.playingMusic;
  }

  destroy(): void {
    this.engine.destroy();
  }

  private browserContext(): AudioContextLike {
    if (this.context === undefined) {
      const context = new AudioContext();
      audioDebug?.watchContext(context);
      this.context = context as unknown as AudioContextLike;
    }
    return this.context;
  }

  /** `decodeAlias`, its outcome logged under `?audiodebug` (see `diagnostics.ts`). */
  private async watchedDecode(alias: string): Promise<DecodedTrack | undefined> {
    if (audioDebug === undefined) return this.decodeAlias(alias);
    // Logged as it starts as well as when it ends: a decode that never ends
    // shows as a start with no outcome.
    await audioDebug.benchDone;
    audioDebug.log(`decode ${alias} started`);
    const started = performance.now();
    try {
      const track = await this.decodeAlias(alias);
      audioDebug.decoded(alias, { buffer: track?.buffer, ms: performance.now() - started });
      return track;
    } catch (error) {
      audioDebug.decoded(alias, { error, ms: performance.now() - started });
      throw error;
    }
  }

  /**
   * A context for decoding alone. The splash decodes the menu song before the
   * player's first tap, and a real AudioContext made then is one the browser
   * refuses to start and warns about (release readiness §9.2). An offline
   * context decodes the same bytes, and its buffers play in any context.
   */
  private decodeContext(alias: string): Pick<AudioContext, "decodeAudioData"> {
    // WebKit serializes decodeAudioData per context. A long race song must
    // never hold up a title cue, voice line, preview or ambient bed.
    if (alias.startsWith("music.") && typeof OfflineAudioContext === "function") {
      return new OfflineAudioContext(2, 1, DECODE_SAMPLE_RATE);
    }
    if (this.decoder === undefined) {
      this.decoder =
        typeof OfflineAudioContext === "function"
          ? new OfflineAudioContext(2, 1, DECODE_SAMPLE_RATE)
          : (this.browserContext() as unknown as AudioContext);
    }
    return this.decoder;
  }

  private decoder: Pick<AudioContext, "decodeAudioData"> | undefined;

  private async decodeAlias(alias: string): Promise<DecodedTrack | undefined> {
    const entry = this.sources.get(alias);
    if (entry === undefined) return undefined;

    const context = this.decodeContext(alias);
    const fetchStarted = performance.now();
    const response = await fetch(entry.src);
    if (!response.ok) return undefined;
    const bytes = await response.arrayBuffer();
    const decodeStarted = performance.now();
    audioDebug?.log(`decode ${alias} fetched ${bytes.byteLength} bytes`);
    const buffer = await context.decodeAudioData(bytes);
    // Fetching and decoding apart: which of the two the wait is spent in.
    audioDebug?.pin(
      `decode:${alias}`,
      `${alias}: fetch ${Math.round(decodeStarted - fetchStarted)}ms, decode ${Math.round(performance.now() - decodeStarted)}ms`,
    );

    // A cue with no authored loop repeats nothing, so the whole buffer stands
    // in for a region and `loop` is simply never set on it.
    return {
      buffer,
      loopStartMs: entry.data.loopStartMs ?? 0,
      loopEndMs: entry.data.loopEndMs ?? buffer.duration * 1000,
    };
  }
}
/** The fields `sync-client-assets` carries through from an audio manifest row. */
type AudioAssetData = { loopStartMs?: number; loopEndMs?: number };

/** Where the client's generated Pixi manifest is served from. */
const MANIFEST_URL = "assets/manifest.json";

/** The delivery encodes' own rate (48 kHz), so decoding resamples nothing. */
const DECODE_SAMPLE_RATE = 48_000;
