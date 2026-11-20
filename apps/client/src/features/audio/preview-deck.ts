/**
 * The song step's previews (stage, song and character select spec §6.4).
 *
 * The clip of the song on screen crossfades in as the player pages, locally:
 * each player hears their own. A short debounce means paging through the
 * songs starts one preview, the last, rather than a stutter of them, and the
 * clip paging left is released so a phone does not hold nine decoded clips.
 * Every song previews, locked and DLC ones too, so a player hears what they
 * can unlock; Random has no preview and fades the current one out.
 */

import type { AudioPort } from "./";

export const PREVIEW_DEBOUNCE_MS = 250;

export type PreviewTimers = {
  set(run: () => void, ms: number): ReturnType<typeof setTimeout>;
  clear(id: ReturnType<typeof setTimeout>): void;
};

/** Through arrows, not `{ set: setTimeout }`: a browser's timer refuses to be called on another object. */
const GLOBAL_TIMERS: PreviewTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (id) => clearTimeout(id),
};

type PreviewAudio = Pick<AudioPort, "playPreview" | "stopPreview" | "releaseTrack">;

export class PreviewDeck {
  private pending: ReturnType<typeof setTimeout> | undefined;
  /** The clip asked for last, playing or still waiting out the debounce. */
  private wanted: string | undefined;
  /** The clip playing now. */
  private playing: string | undefined;

  constructor(
    private readonly audio: PreviewAudio,
    private readonly timers: PreviewTimers = GLOBAL_TIMERS,
    private readonly debounceMs = PREVIEW_DEBOUNCE_MS,
  ) {}

  focus(alias: string | undefined): void {
    if (alias === this.wanted) return;
    this.wanted = alias;
    this.cancel();
    // Back on the clip already playing before the wait ran out: nothing changes.
    if (alias === this.playing) return;
    this.pending = this.timers.set(() => {
      this.pending = undefined;
      const left = this.playing;
      this.playing = alias;
      if (alias === undefined) this.audio.stopPreview?.();
      else this.audio.playPreview?.(alias);
      if (left !== undefined) this.audio.releaseTrack?.(left);
    }, this.debounceMs);
  }

  stop(): void {
    const idle = this.pending === undefined && this.playing === undefined;
    this.cancel();
    this.wanted = undefined;
    if (idle) return;
    const left = this.playing;
    this.playing = undefined;
    this.audio.stopPreview?.();
    if (left !== undefined) this.audio.releaseTrack?.(left);
  }

  private cancel(): void {
    if (this.pending !== undefined) this.timers.clear(this.pending);
    this.pending = undefined;
  }
}
