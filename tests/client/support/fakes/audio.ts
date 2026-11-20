import type { AudioPort } from "../../../../apps/client/src/features/audio";

export class FakeAudio implements AudioPort {
  /** Every call, in order, so a test can assert what a screen asked for. */
  readonly calls: string[] = [];

  async load(bundle?: string): Promise<void> {
    this.calls.push(`load:${bundle ?? ""}`);
  }
  /**
   * Whether the graph is running. A test clears it to be a browser that
   * blocks autoplay: every unlock then stays pending, as a refused resume
   * does, until `start` lets them all through.
   */
  running = true;
  private readonly waiting: (() => void)[] = [];

  async unlock(): Promise<void> {
    this.calls.push("unlock");
    if (!this.running) await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  /** Resolves each preload; a test holds one to be a song still downloading. */
  preloadGate: ((cue: string) => Promise<void> | undefined) | undefined;
  /** Fractions a preload reports before it resolves, as a download's bytes would. */
  preloadSteps: readonly number[] = [];
  /** Cues whose preload rejects, as a failed download does. */
  readonly preloadFailing = new Set<string>();
  async preload(cue: string, onProgress?: (fraction: number) => void): Promise<void> {
    this.calls.push(`preload:${cue}`);
    for (const fraction of this.preloadSteps) onProgress?.(fraction);
    await this.preloadGate?.(cue);
    if (this.preloadFailing.has(cue)) throw new Error(`the download of ${cue} failed`);
    onProgress?.(1);
  }
  start(): void {
    this.running = true;
    for (const resolve of this.waiting.splice(0)) resolve();
  }
  cue(alias: string, options: { bus: string; eventId?: string }): void {
    this.calls.push(`cue:${alias}:${options.bus}:${options.eventId ?? ""}`);
  }
  cancelPending(prefix: string): void {
    this.calls.push(`cancel:${prefix}`);
  }
  stopCues(prefix: string): void {
    this.calls.push(`stop:${prefix}`);
  }
  playBed(alias: string, gain?: number): void {
    this.calls.push(gain === undefined ? `bed:${alias}` : `bed:${alias}@${gain}`);
  }
  stopBed(alias?: string): void {
    this.calls.push(`bed-stop:${alias ?? ""}`);
  }
  setDrone(alias: string, level: number, rate = 1): void {
    this.calls.push(`drone:${alias}@${level.toFixed(2)}x${rate.toFixed(3)}`);
  }
  stopDrone(): void {
    this.calls.push("drone-stop");
  }
  /** Where each track would resume; a test sets one to be back from a race. */
  readonly positions = new Map<string, number>();

  play(cue: string, fromMs?: number): void {
    this.calls.push(fromMs === undefined ? `play:${cue}` : `play:${cue}@${fromMs}`);
  }
  positionOf(cue: string): number | undefined {
    return this.positions.get(cue);
  }
  /** What is sounding and where, for a pulse to keep time to; a test sets it. */
  playingNow: { alias: string; ms: number } | undefined;
  nowPlaying(): { alias: string; ms: number } | undefined {
    return this.playingNow;
  }
  /** The track last played and not since stopped, if any. */
  playing(): string | undefined {
    let current: string | undefined;
    for (const call of this.calls) {
      if (call.startsWith("play:")) current = call.slice("play:".length).split("@")[0];
      else if (call === "stop:" || call === `stop:${current ?? ""}`) current = undefined;
    }
    return current;
  }
  isLooping(cue: string): boolean {
    return this.playing() === cue;
  }
  stop(cue?: string): void {
    this.calls.push(`stop:${cue ?? ""}`);
  }
  playSection(cue: string, startMs: number, endMs: number): void {
    this.calls.push(`section:${cue}:${startMs}:${endMs}`);
  }
  playPreview(alias: string): void {
    this.calls.push(`preview:${alias}`);
  }
  stopPreview(): void {
    this.calls.push("preview-stop");
  }
  releaseTrack(alias: string): void {
    this.calls.push(`release:${alias}`);
  }
  setMuted(muted: boolean): void {
    this.calls.push(`muted:${String(muted)}`);
  }
  slowMusic(scale: number): void {
    this.calls.push(`slowMusic:${scale.toFixed(2)}`);
  }
  setMusicRate(rate: number): void {
    this.calls.push(`musicRate:${rate.toFixed(2)}`);
  }
  setMusicGain(gain: number): void {
    this.calls.push(`musicGain:${gain.toFixed(2)}`);
  }
  setMusicCutoff(hz: number): void {
    this.calls.push(`musicCutoff:${Math.round(hz)}`);
  }
  setPlayerVolume(bus: string, value: number): void {
    this.calls.push(`volume:${bus}:${value}`);
  }
  setUnfocused(unfocused: boolean): void {
    this.calls.push(`unfocused:${unfocused}`);
  }
}
