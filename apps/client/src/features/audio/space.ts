/**
 * The room the race sounds like it is in: the mix snapshots, survival's
 * danger and the lava's rumble, and the far cues' darkened paths.
 *
 * Split out of `engine.ts`. Everything here was the engine's own code, moved
 * with its logic kept, reading the graph's nodes through the `AudioGraph`.
 */

import { logLerp } from "@floor-fifty/shared/common/math";
import {
  MIXES,
  MIX_EASE_SECONDS,
  MUSIC_CUTOFF_OPEN_HZ,
  DANGER_RUMBLE_GAIN,
  DANGER_MUSIC_HZ,
  RUMBLE_FADE_SECONDS,
  RUMBLE_HZ,
  ease,
  type Bus,
  type FarPath,
  type MixName,
} from "./model";
import { rumbleNoise, RUMBLE_SECONDS, RUMBLE_SEAM } from "./synth";
import type { AudioGraph } from "./graph";

export class MixSpace {
  /** The snapshot asked for last, applied when the graph is built if it is not yet. */
  private mixName: MixName = "race";
  /** Survival's danger, 0 to 1. */
  danger = 0;
  /** The lava's rumble, started on the first danger. */
  private rumble: { readonly source: AudioBufferSourceNode; readonly level: GainNode; readonly nodes: readonly AudioNode[] } | undefined;
  /** Rumbles let go of and still fading out; see `endRumble`. */
  readonly rumbleTails = new Set<AudioBufferSourceNode>();

  /**
   * The far cues' shared paths. Owned by the engine, shared with the graph,
   * so a bus level change reaches a wet level and the mix eases the filters;
   * see `farPathFor`.
   */
  constructor(
    private readonly graph: AudioGraph,
    private readonly farPaths: Map<Bus, FarPath>,
  ) {}

  /** The snapshot the mix is in, or easing toward; see `MIXES`. */
  get mix(): MixName {
    return this.mixName;
  }

  /**
   * Eases the mix into a snapshot. Asked before the graph exists, it is
   * remembered and applied as the graph is built.
   */
  setMix(name: MixName): void {
    this.mixName = name;
    this.applyMix();
  }

  /** Survival's danger, 0 to 1: the lava's rumble swells and the music closes with its square. */
  setDanger(level: number): void {
    this.danger = Math.min(1, Math.max(0, level));
    this.applyDanger();
  }

  /** The music's snapshot level where the graph has it, one before. */
  get musicMixLevel(): number {
    return this.graph.musicMix?.gain.value ?? 1;
  }

  /** The music's snapshot cutoff where the graph has one: the snapshot's or the danger's, whichever is lower. */
  get musicMixCutoff(): number {
    return this.graph.musicMixFilter?.frequency.value ?? MUSIC_CUTOFF_OPEN_HZ;
  }

  /** The beds' snapshot cutoff. */
  get ambienceCutoff(): number {
    return this.graph.ambienceFilter?.frequency.value ?? MUSIC_CUTOFF_OPEN_HZ;
  }

  /** The far cues' shared cutoff where one is built, open before the first far cue. */
  get farCutoff(): number {
    return this.farPaths.values().next().value?.dry.frequency.value ?? MUSIC_CUTOFF_OPEN_HZ;
  }

  /** The far cues' extra ring's level into the hall for a bus: its bus level, or zero with none built. */
  farWetLevel(bus: Bus): number {
    return this.farPaths.get(bus)?.wetLevel?.gain.value ?? 0;
  }

  /** The lava's rumble level now; zero with none. */
  get rumbleLevel(): number {
    return this.rumble?.level.gain.value ?? 0;
  }

  /** How many rumble voices are sounding: the loop, plus any fading tails. */
  get rumbleSources(): number {
    return (this.rumble === undefined ? 0 : 1) + this.rumbleTails.size;
  }

  applyMix(): void {
    const context = this.graph.context;
    if (context === undefined) return;
    const at = context.currentTime;
    const mix = MIXES[this.mixName];
    if (this.graph.musicMix !== undefined) ease(this.graph.musicMix.gain, mix.musicLevel, at, MIX_EASE_SECONDS);
    if (this.graph.ambienceFilter !== undefined) ease(this.graph.ambienceFilter.frequency, mix.ambienceHz, at, MIX_EASE_SECONDS);
    for (const path of this.farPaths.values()) {
      ease(path.dry.frequency, mix.farHz, at, MIX_EASE_SECONDS);
      if (path.wet !== undefined) ease(path.wet.frequency, mix.farHz, at, MIX_EASE_SECONDS);
    }
    this.applyMusicMixCutoff();
    this.applyRumbleLevel();
  }

  private applyMusicMixCutoff(): void {
    if (this.graph.musicMixFilter === undefined || this.graph.context === undefined) return;
    const danger = logLerp(MUSIC_CUTOFF_OPEN_HZ, DANGER_MUSIC_HZ, this.danger * this.danger);
    ease(this.graph.musicMixFilter.frequency, Math.min(MIXES[this.mixName].musicHz, danger), this.graph.context.currentTime, MIX_EASE_SECONDS);
  }

  /** Applies the danger asked for: the music's cutoff and the rumble's level. */
  applyDanger(): void {
    const context = this.graph.context;
    if (context === undefined) return;
    this.applyMusicMixCutoff();
    // No danger, no rumble: let it go rather than loop silently all session.
    if (this.danger === 0) {
      this.endRumble(true);
      return;
    }
    if (this.rumble === undefined) {
      if (context.createBuffer === undefined) return;
      const level = context.createGain();
      level.gain.value = 0;
      const nodes: AudioNode[] = [level];
      let into: AudioNode = this.graph.ambience!;
      if (context.createBiquadFilter !== undefined) {
        const lowpass = context.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = RUMBLE_HZ;
        lowpass.connect(into);
        into = lowpass;
        nodes.push(lowpass);
      }
      level.connect(into);
      const source = context.createBufferSource();
      source.buffer = rumbleNoise(context.createBuffer.bind(context), context.sampleRate ?? 48_000);
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = RUMBLE_SECONDS * (1 - RUMBLE_SEAM);
      source.connect(level);
      source.start();
      this.rumble = { source, level, nodes };
    }
    this.applyRumbleLevel();
  }

  /** The rumble at the danger's square, and at the snapshot's share of it: the pause turns it down. */
  private applyRumbleLevel(): void {
    if (this.rumble === undefined || this.graph.context === undefined) return;
    const level = DANGER_RUMBLE_GAIN * this.danger * this.danger * MIXES[this.mixName].rumble;
    ease(this.rumble.level.gain, level, this.graph.context.currentTime, MIX_EASE_SECONDS);
  }

  /** Ends the rumble: faded over `RUMBLE_FADE_SECONDS`, or at once. */
  endRumble(fade: boolean): void {
    const rumble = this.rumble;
    if (rumble === undefined) return;
    this.rumble = undefined;
    const release = (): void => {
      this.rumbleTails.delete(rumble.source);
      rumble.source.disconnect();
      for (const node of rumble.nodes) node.disconnect();
    };
    if (fade && this.graph.context !== undefined) {
      const at = this.graph.context.currentTime;
      const gain = rumble.level.gain;
      gain.cancelScheduledValues(at);
      gain.setValueAtTime(gain.value, at);
      gain.linearRampToValueAtTime(0, at + RUMBLE_FADE_SECONDS);
      this.rumbleTails.add(rumble.source);
      rumble.source.onended = release;
      rumble.source.stop(at + RUMBLE_FADE_SECONDS);
      return;
    }
    rumble.source.onended = null;
    rumble.source.stop();
    release();
  }

  /** Every rumble tail cut now: the engine is going away. */
  cutRumbleTails(): void {
    for (const source of [...this.rumbleTails]) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.rumbleTails.clear();
  }

  /**
   * The shared far path for a bus, built the first time a far cue asks: a
   * dry low-pass into the bus, and -- where there is a hall -- a wet one at
   * the bus's own level into the hall. The wet path is filtered and faded
   * with the dry, so the breath and the pause darken a far ring with its
   * sound and the player's volume turns it down with them.
   */
  farPathFor(bus: Bus): FarPath | undefined {
    const context = this.graph.context;
    if (context?.createBiquadFilter === undefined) return undefined;
    const existing = this.farPaths.get(bus);
    if (existing !== undefined) return existing;
    const lowpass = (): BiquadFilterNode => {
      const filter = context.createBiquadFilter!();
      filter.type = "lowpass";
      filter.frequency.value = MIXES[this.mixName].farHz;
      return filter;
    };
    const dry = lowpass();
    dry.connect(this.graph.busNodes.get(bus)!);
    let path: FarPath = { dry, wet: undefined, wetLevel: undefined };
    if (this.graph.hallNode !== undefined) {
      const wet = lowpass();
      const wetLevel = context.createGain();
      wetLevel.gain.value = this.graph.gains[bus] * this.graph.playerVolume[bus];
      wet.connect(wetLevel);
      wetLevel.connect(this.graph.hallNode);
      path = { dry, wet, wetLevel };
    }
    this.farPaths.set(bus, path);
    return path;
  }
}
