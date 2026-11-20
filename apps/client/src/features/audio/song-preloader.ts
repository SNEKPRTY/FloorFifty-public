import type { AudioPort } from "./model";
import type { SongLike } from "./songs";

type Song = Pick<SongLike, "id" | "audioAlias">;

/**
 * Gives the local pick a head start while the song step is on screen.
 * Only one speculative decode runs at a time: paging through long stereo
 * songs must not allocate a buffer for every slide at once. The latest pick
 * wins when that decode ends. The race can still request its chosen track
 * directly, sharing the library's promise if it is already being decoded.
 */
export class SongPreloader {
  private wanted: Song | undefined;
  private readyAlias: string | undefined;
  private loading = false;
  private disposed = false;
  private keepOnDispose: string | undefined;

  constructor(private readonly audio: Pick<AudioPort, "load" | "preload" | "releaseTrack">) {}

  focus(song: Song | undefined): void {
    if (this.disposed || song?.audioAlias === this.wanted?.audioAlias) return;
    this.wanted = song;
    if (this.readyAlias !== undefined && this.readyAlias !== song?.audioAlias) {
      this.audio.releaseTrack?.(this.readyAlias);
      this.readyAlias = undefined;
    }
    if (!this.loading) void this.preload();
  }

  private async preload(): Promise<void> {
    const song = this.wanted;
    if (song === undefined || this.disposed) return;
    this.loading = true;
    try {
      await this.audio.load(`song-${song.id}`);
      if (this.disposed || this.wanted?.audioAlias !== song.audioAlias) return;
      await this.audio.preload?.(song.audioAlias);
      if (this.wanted?.audioAlias === song.audioAlias) this.readyAlias = song.audioAlias;
    } catch {
      // Speculation must not block selection. The reveal/race loader retries.
    } finally {
      this.loading = false;
      const keep = this.disposed ? this.keepOnDispose : this.wanted?.audioAlias;
      if (keep !== song.audioAlias) {
        this.audio.releaseTrack?.(song.audioAlias);
        if (!this.disposed) void this.preload();
      }
    }
  }

  /** Retain only a race handoff's chosen track; abandon all other speculation. */
  dispose(keepAlias?: string): void {
    this.disposed = true;
    this.keepOnDispose = keepAlias;
    if (this.readyAlias !== undefined && this.readyAlias !== keepAlias) {
      this.audio.releaseTrack?.(this.readyAlias);
      this.readyAlias = undefined;
    }
    // A decode cannot be canceled. Its finally releases it once it settles.
  }
}
