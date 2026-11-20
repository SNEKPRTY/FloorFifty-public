/**
 * The graph itself: the context, the four buses, the vintage stage, the hall,
 * the tape echo, and the master.
 *
 * Split out of `engine.ts`, which decides *when* sound happens; this owns
 * *where* it goes. Everything here was the engine's own code, moved with its
 * field names kept, so the behaviour is the engine's, unchanged.
 */

import {
  BUSES,
  DEFAULT_GAINS,
  HALL_SENDS,
  ECHO_SENDS,
  ECHO_SECONDS,
  ECHO_FEEDBACK,
  ECHO_TONE_HZ,
  MUSIC_CUTOFF_OPEN_HZ,
  LEVEL_GLIDE_SECONDS,
  CUT_SECONDS,
  MUSIC_FFT_SIZE,
  playerGain,
  type Bus,
  type FarPath,
  type AudioContextLike,
  type MusicSpectrum,
} from "./model";
import { hallImpulse, vintageStage } from "./synth";

export class AudioGraph {
  context: AudioContextLike | undefined;
  master: GainNode | undefined;
  readonly busNodes = new Map<Bus, GainNode>();
  /**
   * Where music enters the graph: a unity gain into the music bus and into
   * the analyser, so the spectrum is the track itself, not the track after
   * the momentum, the player's volume or the mute.
   */
  musicInput: GainNode | undefined;
  /** The climb's low-pass, between the music's input and its bus, where the graph has one. */
  musicFilter: BiquadFilterNode | undefined;
  /**
   * The music's duck, after its filter and before its bus: a gain of its own,
   * so a duck never overwrites the mix's level or the player's.
   */
  musicDuck: GainNode | undefined;
  analyser: AnalyserNode | undefined;
  spectrum: Uint8Array<ArrayBuffer> | undefined;
  decibels: Float32Array<ArrayBuffer> | undefined;
  readonly gains: Record<Bus, number> = { ...DEFAULT_GAINS };
  /** The player's own level per bus (settings) as a gain (`playerGain`), applied on top of the mix. */
  readonly playerVolume: Record<Bus, number> = { music: 1, effects: 1, ui: 1, voice: 1 };
  /** Whether the graph has a hall; see `hallSend`. */
  hall = false;
  /** Where the effects, UI and voice buses leave through the vintage stage, when the graph has one. */
  vintageIn: AudioNode | undefined;
  /** Whether the graph has a tape echo; see `echoSend`. */
  echo = false;
  /**
   * Where the end of a stretch of music enters the tape echo, at the music
   * bus's level and the player's music volume; see `echoOut`.
   */
  musicEcho: GainNode | undefined;
  /**
   * The beds' own way out, around the vintage stage, tracking the effects
   * bus's level and the player's effects volume.
   */
  ambience: GainNode | undefined;
  /** The beds' snapshot low-pass, between their gain and the master, where the graph has one. */
  ambienceFilter: BiquadFilterNode | undefined;
  /** The music's snapshot stage: a low-pass after the climb's and a gain before the duck; see `MIXES`. */
  musicMixFilter: BiquadFilterNode | undefined;
  musicMix: GainNode | undefined;
  /** The hall, for a far cue's extra send. */
  hallNode: ConvolverNode | undefined;
  private muted = false;
  /** The window has lost focus and the player asked for quiet then; apart from `muted`, which is theirs. */
  private unfocused = false;
  /** Ruken's volume for the game, 0..1 (its master volume, ducking and ads); 1 standalone. */
  private hostGain = 1;
  /** Whether `sleep` suspended the graph, so `wake` knows it may resume it. */
  private asleep = false;

  /**
   * The far cues' shared paths, owned by the mix side of the engine and read
   * here only so a bus level change reaches their wet levels with the rest.
   */
  constructor(private readonly farPaths: Map<Bus, FarPath>) {}

  /**
   * Builds the graph, once.
   *
   * Returns whether it built: the engine applies the remembered mix and
   * danger to a fresh graph, and only a fresh one. Safe to call from every
   * screen and on every gesture: a context already built is left alone, which
   * is what keeps a graph from being rebuilt under a playing track.
   */
  buildIfNeeded(createContext: () => AudioContextLike, musicCutoffHz: number): boolean {
    if (this.context !== undefined) return false;
    const context = createContext();
    const master = context.createGain();
    master.connect(context.destination);

    for (const bus of BUSES) {
      const node = context.createGain();
      node.gain.value = this.gains[bus] * this.playerVolume[bus];
      this.busNodes.set(bus, node);
    }

    const vintageIn = vintageStage(context, master);
    this.vintageIn = vintageIn;
    for (const bus of BUSES) this.busNodes.get(bus)!.connect(bus === "music" ? master : (vintageIn ?? master));

    if (vintageIn !== undefined && context.createDelay !== undefined) {
      // A tape echo: the delay's output darkened and fed back into it, so
      // each repeat is quieter and duller than the last, and every repeat
      // comes out through the vintage band.
      const delay = context.createDelay(1);
      delay.delayTime.value = ECHO_SECONDS;
      const tone = context.createBiquadFilter!();
      tone.type = "lowpass";
      tone.frequency.value = ECHO_TONE_HZ;
      const feedback = context.createGain();
      feedback.gain.value = ECHO_FEEDBACK;
      delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(delay);
      tone.connect(vintageIn);
      for (const bus of BUSES) {
        if (ECHO_SENDS[bus] === 0) continue;
        const send = context.createGain();
        send.gain.value = ECHO_SENDS[bus];
        this.busNodes.get(bus)!.connect(send);
        send.connect(delay);
      }
      // The music bus sends nothing; a stretch's end feeds this instead.
      const musicEcho = context.createGain();
      musicEcho.gain.value = this.gains.music * this.playerVolume.music;
      musicEcho.connect(delay);
      this.musicEcho = musicEcho;
      this.echo = true;
    }

    const ambience = context.createGain();
    ambience.gain.value = this.gains.effects * this.playerVolume.effects;
    if (context.createBiquadFilter !== undefined) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = MUSIC_CUTOFF_OPEN_HZ;
      ambience.connect(filter);
      filter.connect(master);
      this.ambienceFilter = filter;
    } else {
      ambience.connect(master);
    }
    this.ambience = ambience;

    if (context.createConvolver !== undefined && context.createBuffer !== undefined) {
      const hall = context.createConvolver();
      hall.buffer = hallImpulse(context.createBuffer.bind(context), context.sampleRate ?? 48_000);
      hall.connect(vintageIn ?? master);
      this.hallNode = hall;
      for (const bus of BUSES) {
        if (HALL_SENDS[bus] === 0) continue;
        const send = context.createGain();
        send.gain.value = HALL_SENDS[bus];
        this.busNodes.get(bus)!.connect(send);
        send.connect(hall);
      }
      this.hall = true;
    }

    const musicInput = context.createGain();
    const musicDuck = context.createGain();
    musicDuck.connect(this.busNodes.get("music")!);
    this.musicDuck = musicDuck;
    // The snapshot's stage, between the climb's filter and the duck.
    const musicMix = context.createGain();
    musicMix.connect(musicDuck);
    this.musicMix = musicMix;
    if (context.createBiquadFilter !== undefined) {
      // After the analyser's tap, so the spectrum the city moves to is the
      // whole track however far the climb has opened it.
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = musicCutoffHz;
      musicInput.connect(filter);
      this.musicFilter = filter;
      const mixFilter = context.createBiquadFilter();
      mixFilter.type = "lowpass";
      mixFilter.frequency.value = MUSIC_CUTOFF_OPEN_HZ;
      filter.connect(mixFilter);
      mixFilter.connect(musicMix);
      this.musicMixFilter = mixFilter;
    } else {
      musicInput.connect(musicMix);
    }
    this.musicInput = musicInput;
    if (context.createAnalyser !== undefined) {
      const analyser = context.createAnalyser();
      analyser.fftSize = MUSIC_FFT_SIZE;
      // Raw frames: whoever reads them smooths for their own purpose, and
      // the analyser's own smoothing would blunt the onsets they look for.
      analyser.smoothingTimeConstant = 0;
      musicInput.connect(analyser);
      this.analyser = analyser;
      this.spectrum = new Uint8Array(analyser.frequencyBinCount);
      this.decibels = new Float32Array(analyser.frequencyBinCount);
    }

    this.context = context;
    this.master = master;
    this.applyMaster();
    return true;
  }

  /** Resumes the graph unless it is already running. */
  async resumeUnlessRunning(): Promise<void> {
    if (this.context === undefined) return;
    if (this.context.state !== "running") await this.context.resume();
  }

  /**
   * Suspends the graph while the page is hidden: a locked phone or a
   * backgrounded tab, which went on playing the stage music.
   *
   * Only a running graph is put to sleep, and `wake` resumes only a graph
   * this put to sleep, so waking never starts sound a player had not
   * unlocked. Suspending pauses every voice where it is, so the loop carries
   * on from the same place; nothing visual reads the audio clock (see
   * `beat-clock.ts`), so the race does not notice.
   *
   * The lines queued and not yet begun are silenced first: on the frozen
   * clock they would wait out the absence and then call a count long over.
   * The engine cancels those itself, before it asks.
   */
  async sleep(): Promise<void> {
    if (this.context?.state !== "running") return;
    this.asleep = true;
    await this.context.suspend();
  }

  /**
   * Resumes a graph `sleep` suspended, or one the system interrupted -- a
   * call, Siri -- which `sleep` never saw running and so never marked.
   */
  async wake(): Promise<void> {
    if (this.context === undefined) return;
    if (!this.asleep && this.context.state !== "interrupted") return;
    this.asleep = false;
    if (this.context.state !== "running") await this.context.resume();
  }

  /**
   * On any gesture: resumes a graph the system suspended while the page stayed
   * in view, which nothing else would, since only a gesture may. One `sleep`
   * suspended is left for `wake`, and one never unlocked is never built.
   */
  async resumeOnGesture(): Promise<void> {
    if (this.context === undefined || this.asleep || this.context.state === "running") return;
    await this.context.resume();
  }

  /** Whether a cue asked for now would wait on a stopped clock rather than sound. */
  get silenced(): boolean {
    return this.asleep || this.context?.state === "interrupted";
  }

  /**
   * Clamped into unity, or the bus's default where the mix runs it past
   * that, so no screen can drive the master harder than the mix does.
   */
  setBusGain(bus: Bus, value: number): void {
    this.gains[bus] = Math.min(Math.max(1, DEFAULT_GAINS[bus]), Math.max(0, value));
    this.applyBus(bus);
  }

  busGain(bus: Bus): number {
    return this.gains[bus];
  }

  /**
   * The player's volume for one bus, from the settings panel.
   *
   * Kept apart from the mix's gain and multiplied in, so a screen setting the
   * mix never overwrites the player's choice, and the player's choice never
   * flattens the mix.
   */
  setPlayerVolume(bus: Bus, value: number): void {
    this.playerVolume[bus] = playerGain(value);
    this.applyBus(bus);
  }

  private applyBus(bus: Bus): void {
    const level = this.gains[bus] * this.playerVolume[bus];
    const node = this.busNodes.get(bus);
    if (node !== undefined) this.glide(node.gain, level);
    if (bus === "effects" && this.ambience !== undefined) this.glide(this.ambience.gain, level);
    if (bus === "music" && this.musicEcho !== undefined) this.glide(this.musicEcho.gain, level);
    const farWet = this.farPaths.get(bus)?.wetLevel;
    if (farWet !== undefined) this.glide(farWet.gain, level);
  }

  /** Moves a level there over `LEVEL_GLIDE_SECONDS` rather than in one step, which clicks. */
  private glide(param: AudioParam, value: number): void {
    if (this.context === undefined) {
      param.value = value;
      return;
    }
    const now = this.context.currentTime;
    param.cancelScheduledValues?.(now);
    param.setTargetAtTime(value, now, LEVEL_GLIDE_SECONDS / 3);
  }

  /**
   * Ends `source` without a click: `level`, the gain only it feeds, falls to
   * nothing over `CUT_SECONDS` and the source stops there. Without a level of
   * its own it stops at once.
   */
  cut(source: AudioBufferSourceNode, level: GainNode | undefined): void {
    source.onended = null;
    if (this.context === undefined || level === undefined) {
      source.stop();
      source.disconnect();
      level?.disconnect();
      return;
    }
    const at = this.context.currentTime;
    const param = level.gain;
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(at);
    else {
      param.cancelScheduledValues(at);
      param.setValueAtTime(param.value, at);
    }
    param.linearRampToValueAtTime(0, at + CUT_SECONDS);
    source.onended = () => {
      source.disconnect();
      level.disconnect();
    };
    source.stop(at + CUT_SECONDS);
  }

  /**
   * Silences the master rather than the buses.
   *
   * The mix is a set of decisions somebody made, and a mute is not one of
   * them: taking the master to zero leaves every bus where it was, so
   * unmuting restores the mix rather than a default of it.
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get masterGain(): number {
    return this.muted || this.unfocused ? 0 : this.hostGain;
  }

  /**
   * Scales the master by the host's volume (Ruken P6 §4). The player's own
   * mute still wins: the master is the mute times the host's gain.
   */
  setHostGain(gain: number): void {
    this.hostGain = Math.min(1, Math.max(0, gain));
    this.applyMaster();
  }

  /**
   * Silences the master while another window has focus, for a player who
   * asked for that in settings. Only the master: the graph runs on, so the
   * race's sound is where it should be the moment focus comes back.
   */
  setUnfocused(unfocused: boolean): void {
    this.unfocused = unfocused;
    this.applyMaster();
  }

  /** How much of a bus rings in the hall; zero on a graph that has none. */
  hallSend(bus: Bus): number {
    return this.hall ? HALL_SENDS[bus] : 0;
  }

  /** How much of a bus feeds the tape echo; zero on a graph that has none. */
  echoSend(bus: Bus): number {
    return this.echo ? ECHO_SENDS[bus] : 0;
  }

  /** Whether a bus leaves through the vintage stage: every one but the music, where the graph has one. */
  vintage(bus: Bus): boolean {
    return this.vintageIn !== undefined && bus !== "music";
  }

  /** The mix beside the speakers, for recording the race (unlockables spec §6.1). */
  captureStream(): { stream: MediaStream; release(): void } | undefined {
    const { context, master } = this;
    if (context?.createMediaStreamDestination === undefined || master === undefined) return undefined;
    const tap = context.createMediaStreamDestination();
    master.connect(tap);
    let released = false;
    return {
      stream: tap.stream,
      release: () => {
        if (released) return;
        released = true;
        master.disconnect(tap);
      },
    };
  }

  /** This frame of the music, before the mix; see `MusicSpectrum`. */
  musicSpectrum(): MusicSpectrum | undefined {
    const { analyser, spectrum, decibels, context } = this;
    if (analyser === undefined || spectrum === undefined || decibels === undefined || context === undefined) return undefined;
    analyser.getByteFrequencyData(spectrum);
    analyser.getFloatFrequencyData(decibels);
    return { bins: spectrum, decibels, binHz: (context.sampleRate ?? 48_000) / MUSIC_FFT_SIZE };
  }

  private applyMaster(): void {
    if (this.master === undefined) return;
    this.glide(this.master.gain, this.masterGain);
  }
}
