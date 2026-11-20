/**
 * The cue voices: one-shot effects and the announcer's lines, capped so a
 * landing never crowds out the one the player is watching, de-duplicated by
 * authoritative event, and carrying their asks of the music with them.
 *
 * Split out of `engine.ts`. Everything here was the engine's own code, moved
 * with its logic kept.
 */

import { logLerp } from "@floor-fifty/shared/common/math";
import {
  MAX_VOICES,
  MUSIC_CUTOFF_OPEN_HZ,
  VARY_CENTS,
  VARY_DB,
  FAR_CUE_HZ,
  FAR_HALL_SEND,
  FAR_LEVEL,
  VOICE_BUS_DUCK,
  type CueOptions,
} from "./model";
import type { AudioGraph } from "./graph";
import type { MusicDeck } from "./deck";
import type { MixSpace } from "./space";
import type { TrackLibrary } from "./library";

export class CueVoices {
  private voices: AudioBufferSourceNode[] = [];
  /** When each voice begins on the graph's clock, so the cap can tell one sounding from one still queued. */
  private readonly voiceStarts = new WeakMap<AudioBufferSourceNode, number>();
  /** Each cue's own level, which a cut fades. */
  private readonly voiceLevels = new Map<AudioBufferSourceNode, GainNode>();
  /**
   * Cues of an event, by source, until they end: which event they belong to,
   * when they begin, and whether they muffle the music then.
   */
  private readonly scheduled = new Map<AudioBufferSourceNode, { eventId: string; startsAt: number; muffle: boolean }>();
  /** Events whose cue is asked for and still decoding; a cancel takes them out before they start. */
  private readonly decoding = new Set<string>();
  /** Authoritative events already sounded. */
  private readonly heard = new Set<string>();

  constructor(
    private readonly graph: AudioGraph,
    private readonly deck: MusicDeck,
    private readonly space: MixSpace,
    private readonly library: TrackLibrary,
    private readonly random: () => number,
  ) {}

  /** How many cues are sounding right now. */
  get activeVoices(): number {
    return this.voices.length;
  }

  /**
   * Sounds one cue, once.
   *
   * Silent before `unlock`, which is the ordinary state of a page nobody has
   * touched yet rather than an error to report.
   */
  async playCue(alias: string, options: CueOptions): Promise<void> {
    const context = this.graph.context;
    if (context === undefined) return;

    const { eventId } = options;
    if (eventId !== undefined) {
      if (this.heard.has(eventId)) return;
      this.heard.add(eventId);
    }
    // Heard all the same: it happened while nobody could hear it, and must
    // not sound later either.
    if (this.graph.silenced) return;

    if (eventId !== undefined) this.decoding.add(eventId);
    const track = await this.library.trackFor(alias);
    if (eventId !== undefined && !this.decoding.delete(eventId)) return;
    if (track === undefined || this.graph.context === undefined || this.graph.silenced) return;

    // The oldest voice goes, not the newest. The most recent landing is the
    // one the player is looking at. Oldest among those already sounding: a
    // cue queued to start later -- the announcer's next line -- has not been
    // heard yet, so it is not old.
    while (this.voices.length >= MAX_VOICES) {
      const now = context.currentTime;
      const oldest = this.voices.find((voice) => (this.voiceStarts.get(voice) ?? 0) <= now) ?? this.voices[0]!;
      this.dropVoices([oldest]);
    }

    const source = context.createBufferSource();
    source.buffer = track.buffer;

    // A varied cue strays symmetrically around what it was asked for.
    const spread = (): number => this.random() * 2 - 1;
    const rate = (options.rate ?? 1) * (options.vary === true ? 2 ** ((spread() * VARY_CENTS) / 1200) : 1);
    const distance = Math.min(1, Math.max(0, options.distance ?? 0));
    const gain =
      (options.gain ?? 1) *
      (options.vary === true ? 10 ** ((spread() * VARY_DB) / 20) : 1) *
      (1 - (1 - FAR_LEVEL) * distance);
    if (rate !== 1 && source.playbackRate !== undefined) source.playbackRate.value = rate;

    let into: AudioNode = this.graph.busNodes.get(options.bus)!;
    const far = distance > 0 ? this.space.farPathFor(options.bus) : undefined;
    if (far !== undefined) {
      // Its own darkening, then the far path the breath closes: dry into the
      // bus, and a ring at the bus's level into the hall.
      const air = context.createBiquadFilter!();
      air.type = "lowpass";
      air.frequency.value = logLerp(MUSIC_CUTOFF_OPEN_HZ, FAR_CUE_HZ, distance);
      air.connect(far.dry);
      if (far.wet !== undefined) {
        const send = context.createGain();
        send.gain.value = FAR_HALL_SEND * distance;
        air.connect(send);
        send.connect(far.wet);
      }
      into = air;
    }
    const pan = Math.min(1, Math.max(-1, options.pan ?? 0));
    if (pan !== 0 && context.createStereoPanner !== undefined) {
      const panner = context.createStereoPanner();
      panner.pan.value = pan;
      panner.connect(into);
      into = panner;
    }
    // Its own level always, even at one: it is what a cut fades.
    const level = context.createGain();
    level.gain.value = Math.min(1, Math.max(0, gain));
    level.connect(into);
    source.connect(level);
    this.voiceLevels.set(source, level);

    source.onended = () => {
      this.voices = this.voices.filter((voice) => voice !== source);
      this.scheduled.delete(source);
      this.voiceLevels.delete(source);
      level.disconnect();
    };
    const delay = Math.max(0, options.delayMs ?? 0) / 1000;
    const startsAt = context.currentTime + delay;
    if (options.maxMs === undefined) source.start(delay === 0 ? 0 : startsAt);
    else source.start(delay === 0 ? 0 : startsAt, 0, Math.max(0, options.maxMs) / 1000);
    this.voices.push(source);
    this.voiceStarts.set(source, startsAt);
    // On the cue's own start, so a line queued behind another ducks when it
    // speaks rather than when it was asked for. A voice cue ducks by default:
    // the announcer is always heard over the music.
    const duck = options.duck ?? (options.bus === "voice" ? VOICE_BUS_DUCK : undefined);
    const soundsMs = Math.min(((track.buffer.duration ?? 0) * 1000) / rate, options.maxMs ?? Number.POSITIVE_INFINITY);
    if (duck !== undefined) this.deck.duckMusic(duck, startsAt, soundsMs, source);
    if (options.muffle === true) this.deck.muffleMusic(startsAt);
    if (eventId !== undefined) this.scheduled.set(source, { eventId, startsAt, muffle: options.muffle === true });
  }

  /**
   * Takes cues out of the mix, and what they asked of the music with them: a
   * duck, and the muffle of one not yet begun. One sounding fades out; one
   * still queued has made no sound, and simply never starts.
   */
  private dropVoices(sources: readonly AudioBufferSourceNode[]): void {
    const now = this.graph.context?.currentTime ?? 0;
    for (const source of sources) {
      const scheduled = this.scheduled.get(source);
      const level = this.voiceLevels.get(source);
      this.voices = this.voices.filter((voice) => voice !== source);
      this.scheduled.delete(source);
      this.voiceLevels.delete(source);
      const queued = scheduled !== undefined && scheduled.startsAt > now;
      if (queued) {
        source.onended = null;
        source.stop();
        source.disconnect();
        level?.disconnect();
        if (scheduled.muffle) this.deck.unmuffleIf(scheduled.startsAt);
      } else {
        this.graph.cut(source, level);
      }
    }
    this.deck.releaseDucks(new Set(sources));
    this.deck.applyMusicCutoff();
  }

  /** Stops every cue whose event ID starts with `prefix`, sounding or queued; see `AudioPort.stopCues`. */
  stopCues(prefix: string): void {
    for (const eventId of this.decoding) if (eventId.startsWith(prefix)) this.decoding.delete(eventId);
    this.dropVoices([...this.scheduled].filter(([, { eventId }]) => eventId.startsWith(prefix)).map(([source]) => source));
  }

  /** Stops the not-yet-begun cues whose event ID starts with `prefix`; see `AudioPort.cancelPending`. */
  cancelPending(prefix: string): void {
    for (const eventId of this.decoding) if (eventId.startsWith(prefix)) this.decoding.delete(eventId);
    if (this.graph.context === undefined) return;
    const now = this.graph.context.currentTime;
    this.dropVoices(
      [...this.scheduled]
        .filter(([, { eventId, startsAt }]) => startsAt > now && eventId.startsWith(prefix))
        .map(([source]) => source),
    );
  }

  /** Forgets which events have sounded. Called when a race starts. */
  resetHeard(): void {
    this.heard.clear();
  }

  /** Every voice stopped and forgotten: the engine is going away. */
  destroy(): void {
    for (const voice of this.voices) voice.stop();
    this.voices = [];
    this.scheduled.clear();
    this.voiceLevels.clear();
    this.heard.clear();
  }
}
