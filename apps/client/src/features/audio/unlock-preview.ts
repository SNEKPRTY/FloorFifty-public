/**
 * The new song's preview window under its banner (unlockables spec §7.1): the
 * stretch the song step previews, so the player knows it when they go to pick it.
 *
 * There is one music slot, so "the music ducks" is the slot handing over: the
 * preview plays in it, and when the banner goes the race song's results section
 * resumes where wall time says it would be. If that section has run out, the
 * results stay quiet, as they would have. A group that fails to load leaves
 * everything as it was.
 */

import type { AudioPort, SongLike } from "./";

type Section = { alias: string; startMs: number; endMs: number };

export class UnlockPreview {
  private section: (Section & { at: number }) | undefined;
  private playing: string | undefined;
  /** The banner is still up: a group that arrives after it went plays nothing. */
  private wanted = false;
  private disposed = false;

  constructor(
    private readonly audio: Pick<AudioPort, "load" | "playSection" | "stop">,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** The race song's results section, as GameEnd started it, now. */
  resultsSection(section: Section | undefined): void {
    this.section = section === undefined ? undefined : { ...section, at: this.now() };
  }

  /** `after`: what must start first, the results' own section, so neither overwrites the other. */
  async start(song: SongLike, after: Promise<void> = Promise.resolve()): Promise<void> {
    if (song.previewStartMs === undefined || song.previewEndMs === undefined) return;
    this.wanted = true;
    await after;
    if (this.disposed || !this.wanted) return;
    try {
      await this.audio.load(`song-${song.id}`);
    } catch {
      return;
    }
    if (this.disposed || !this.wanted) return;
    this.audio.playSection(song.audioAlias, song.previewStartMs, song.previewEndMs);
    this.playing = song.audioAlias;
  }

  /** The banner went: hand the slot back to the results. */
  end(): void {
    this.wanted = false;
    if (this.playing === undefined) return;
    this.playing = undefined;
    const section = this.section;
    if (section === undefined) return void this.audio.stop();
    const resumeAt = section.startMs + (this.now() - section.at);
    if (resumeAt >= section.endMs) return void this.audio.stop();
    this.audio.playSection(section.alias, resumeAt, section.endMs);
  }

  /** The results screen left: stop the preview and resume nothing. */
  dispose(): void {
    this.disposed = true;
    if (this.playing !== undefined) this.audio.stop(this.playing);
    this.playing = undefined;
  }
}
