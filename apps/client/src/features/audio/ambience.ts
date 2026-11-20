/**
 * The ambient slots beside the music: the looping bed (wind, the city below)
 * and the climb's drone, both around the vintage stage rather than through
 * it.
 *
 * Split out of `engine.ts`. Everything here was the engine's own code, moved
 * with its logic kept.
 */

import { BED_GAIN, DRONE_GAIN, DRONE_SMOOTH_SECONDS } from "./model";
import type { AudioGraph } from "./graph";
import type { TrackLibrary } from "./library";

export class Ambience {
  /** The ambient bed, and the alias it belongs to from the moment it is asked for. */
  private bed: AudioBufferSourceNode | undefined;
  private bedLevel: GainNode | undefined;
  private bedAlias: string | undefined;
  private drone: { readonly source: AudioBufferSourceNode; readonly level: GainNode } | undefined;
  private droneAlias: string | undefined;
  /** What the drone was last asked for, kept for the one still decoding. */
  private droneTarget = { level: 0, rate: 1 };

  constructor(
    private readonly graph: AudioGraph,
    private readonly library: TrackLibrary,
  ) {}

  /** The bed and the drone, for the engine's live-source count. */
  get sources(): number {
    return (this.bed === undefined ? 0 : 1) + (this.drone === undefined ? 0 : 1);
  }

  /**
   * Loops an ambient bed -- wind, a city below -- at the effects bus's level,
   * well under the cues, and around the vintage stage rather than through it.
   * One slot: asking for the bed already playing leaves it alone, so every
   * screen may ask on entry without stacking a second gust.
   */
  async playBed(alias: string, gain = 1): Promise<void> {
    if (this.graph.context === undefined || this.bedAlias === alias) return;
    this.endBed();
    this.bedAlias = alias;
    const track = await this.library.trackFor(alias);
    if (track === undefined || this.graph.context === undefined || this.bedAlias !== alias) return;

    const context = this.graph.context;
    const level = context.createGain();
    level.gain.value = BED_GAIN * Math.min(1, Math.max(0, gain));
    level.connect(this.graph.ambience!);
    const source = context.createBufferSource();
    source.buffer = track.buffer;
    source.loop = true;
    source.loopStart = track.loopStartMs / 1000;
    source.loopEnd = track.loopEndMs / 1000;
    source.connect(level);
    source.start();
    this.bed = source;
    this.bedLevel = level;
  }

  /**
   * Ends the bed. Given an alias, only while that bed holds the slot: the menu
   * lets go of its bed after the race has already started its own.
   */
  stopBed(alias?: string): void {
    if (alias !== undefined && alias !== this.bedAlias) return;
    this.bedAlias = undefined;
    this.endBed();
  }

  private endBed(): void {
    if (this.bed === undefined) return;
    const source = this.bed;
    const level = this.bedLevel;
    this.bed = undefined;
    this.bedLevel = undefined;
    this.graph.cut(source, level);
  }

  /**
   * Holds the climb's drone at `level` of full, in [0, 1], played at `rate`.
   *
   * Its own slot, beside the bed rather than in it: the race keeps its wind
   * while the drone comes and goes. Around the vintage stage, as the bed is,
   * because what the drone is for lives under the stage's floor. The level
   * eases rather than steps, so a call every frame swells it in and a reset
   * lets it fall away; at zero it keeps looping, silent, ready to come back.
   */
  async setDrone(alias: string, level: number, rate = 1): Promise<void> {
    if (this.graph.context === undefined) return;
    this.droneTarget = { level: Math.min(1, Math.max(0, level)), rate };
    if (this.droneAlias === alias) {
      if (this.drone !== undefined) this.applyDrone(this.drone);
      return;
    }
    this.endDrone();
    this.droneAlias = alias;
    const track = await this.library.trackFor(alias);
    if (track === undefined || this.graph.context === undefined || this.droneAlias !== alias) return;

    const context = this.graph.context;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(this.graph.ambience!);
    const source = context.createBufferSource();
    source.buffer = track.buffer;
    source.loop = true;
    source.loopStart = track.loopStartMs / 1000;
    source.loopEnd = track.loopEndMs / 1000;
    source.connect(gain);
    this.drone = { source, level: gain };
    this.applyDrone(this.drone);
    source.start();
  }

  /** Ends the drone at once: the finish cuts it rather than letting it fade. */
  stopDrone(): void {
    this.droneAlias = undefined;
    this.endDrone();
  }

  private applyDrone(drone: { readonly source: AudioBufferSourceNode; readonly level: GainNode }): void {
    const { level, rate } = this.droneTarget;
    drone.level.gain.setTargetAtTime(DRONE_GAIN * level, this.graph.context?.currentTime ?? 0, DRONE_SMOOTH_SECONDS);
    if (drone.source.playbackRate !== undefined) drone.source.playbackRate.value = rate;
  }

  private endDrone(): void {
    if (this.drone === undefined) return;
    const { source, level } = this.drone;
    this.drone = undefined;
    this.graph.cut(source, level);
  }
}
