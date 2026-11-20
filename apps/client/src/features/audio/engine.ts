import {
  BUSES,
  MAX_VOICES,
  type Bus,
  type MixName,
  type FarPath,
  type AudioContextLike,
  type NowPlaying,
  type MusicSpectrum,
  type AudioEngineOptions,
  type MusicDuck,
  type CueOptions,
} from "./model";
import { AudioGraph } from "./graph";
import { MixSpace } from "./space";
import { TrackLibrary } from "./library";
import { STREAMED_MENU_ALIAS } from "./menu-stream";
import type { OnReceived } from "../../lib/fetch-progress";
import { MusicDeck } from "./deck";
import { CueVoices } from "./voices";
import { Ambience } from "./ambience";

export class AudioEngine {
  readonly buses: readonly Bus[] = BUSES;
  readonly maxVoices = MAX_VOICES;

  /** The shared path every far cue leaves through, per bus, built on the first far cue; see `farPathFor`. */
  private readonly farPaths = new Map<Bus, FarPath>();
  /** The graph: buses, effects, the master and the context itself. */
  private readonly graph = new AudioGraph(this.farPaths);
  /** The room the mix sounds like: snapshots, danger and rumble, far paths. */
  private readonly space = new MixSpace(this.graph, this.farPaths);
  /** Decodes by alias, shared across the slots. */
  private readonly library = new TrackLibrary((alias) => this.options.decode(alias));
  /** The music slot: the loop, the sections, the previews and the ducks. */
  private readonly deck: MusicDeck;

  /** The cue voices: effects and the announcer. */
  private readonly cues: CueVoices;
  /** The ambient slots: the bed and the drone. */
  private readonly ambience = new Ambience(this.graph, this.library);

  constructor(private readonly options: AudioEngineOptions) {
    this.deck = new MusicDeck(this.graph, this.library, options.menuStreamUrl, options.songStream);
    this.cues = new CueVoices(this.graph, this.deck, this.space, this.library, options.random ?? Math.random);
  }

  // The graph's nodes and levels, read by the slots and the mix below. Set
  // only by the graph itself.
  private get context(): AudioContextLike | undefined {
    return this.graph.context;
  }

  /** Whether a track is currently looping. */
  get playingMusic(): boolean {
    return this.deck.playingMusic;
  }

  get masterGain(): number {
    return this.graph.masterGain;
  }

  /** How many cues are sounding right now. */
  get activeVoices(): number {
    return this.cues.activeVoices;
  }

  /** Every source node still sounding: the music slot, the cues, the bed, and the previews. */
  get liveSources(): number {
    return this.cues.activeVoices + this.deck.musicSources + this.space.rumbleSources + this.ambience.sources + this.deck.previewSources;
  }

  /** Preview clips sounding: the one playing plus any fading out. */
  get previewSources(): number {
    return this.deck.previewSources;
  }

  /** How much of a bus rings in the hall; zero on a graph that has none. */
  hallSend(bus: Bus): number {
    return this.graph.hallSend(bus);
  }

  /** How much of a bus feeds the tape echo; zero on a graph that has none. */
  echoSend(bus: Bus): number {
    return this.graph.echoSend(bus);
  }

  /** Whether a bus leaves through the vintage stage: every one but the music, where the graph has one. */
  vintage(bus: Bus): boolean {
    return this.graph.vintage(bus);
  }

  busGain(bus: Bus): number {
    return this.graph.busGain(bus);
  }

  /**
   * Builds the graph and resumes it, once.
   *
   * Safe to call from every screen and on every gesture: a context already
   * running is left alone, which is what keeps a resume from being counted
   * twice or a graph from being rebuilt under a playing track.
   */
  async unlock(): Promise<void> {
    if (this.graph.buildIfNeeded(this.options.createContext, this.deck.cutoffHz)) {
      this.space.applyMix();
      if (this.space.danger > 0) this.space.applyDanger();
    }
    // Both calls must happen before an await, inside the browser gesture.
    this.deck.stream?.resume();
    await this.graph.resumeUnlessRunning();
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
   */
  async sleep(): Promise<void> {
    this.deck.stream?.sleep();
    this.deck.bridge?.sleep();
    if (this.context?.state !== "running") return;
    this.cues.cancelPending("");
    await this.graph.sleep();
  }

  /**
   * Resumes a graph `sleep` suspended, or one the system interrupted -- a
   * call, Siri -- which `sleep` never saw running and so never marked.
   */
  async wake(): Promise<void> {
    this.deck.stream?.wake();
    this.deck.bridge?.wake();
    await this.graph.wake();
  }

  /**
   * On any gesture: resumes a graph the system suspended while the page stayed
   * in view, which nothing else would, since only a gesture may. One `sleep`
   * suspended is left for `wake`, and one never unlocked is never built.
   */
  async resumeOnGesture(): Promise<void> {
    this.deck.stream?.resume();
    // Both inside the gesture: the song element is let play on its own later.
    this.deck.bridge?.prime();
    this.deck.bridge?.resume();
    await this.graph.resumeOnGesture();
  }

  /**
   * Clamped into unity, or the bus's default where the mix runs it past
   * that, so no screen can drive the master harder than the mix does.
   */
  setBusGain(bus: Bus, value: number): void {
    this.graph.setBusGain(bus, value);
  }

  /**
   * Clamped to the audible band; above it the filter is simply open. Called
   * every frame of a race, which is also what carries a muffle back open.
   */
  setMusicCutoff(hz: number): void {
    this.deck.setMusicCutoff(hz);
  }

  /**
   * The finish's slow motion on the song (race-flow spec §5.2): its rate, and
   * a low-pass that closes as it slows, composed under whatever cutoff the
   * race sets every frame. A new track starts at full speed: the next
   * playMusic or playSection resets it. `positionOf` assumes rate 1, which
   * only the menu reads, and never during a finish.
   */
  slowMusic(scale: number): void {
    this.deck.slowMusic(scale);
  }

  /** The replay's speed: 0.25 to 2, kept for the next track. It never touches the filter. */
  setMusicRate(rate: number): void {
    this.deck.setMusicRate(rate);
  }

  /** Where the music's filter actually sits, in hertz: the climb's, or a muffle under it. */
  get musicCutoff(): number {
    return this.deck.musicCutoff;
  }

  /** Slams the music's filter shut, to open again over `MUFFLE_SECONDS`. */
  muffleMusic(at?: number): void {
    this.deck.muffleMusic(at);
  }

  /**
   * Pulls the music down from `at`, on the graph's clock; see `MusicDeck`.
   * Public: cues duck through here, and the mix tests drive it directly.
   */
  duckMusic(duck: MusicDuck, at: number, lengthMs: number, owner?: AudioBufferSourceNode): void {
    this.deck.duckMusic(duck, at, lengthMs, owner);
  }

  /** The snapshot the mix is in, or easing toward; see `MIXES`. */
  get mix(): MixName {
    return this.space.mix;
  }

  /**
   * Eases the mix into a snapshot. Asked before the graph exists, it is
   * remembered and applied as the graph is built.
   */
  setMix(name: MixName): void {
    this.space.setMix(name);
  }

  /** Survival's danger, 0 to 1: the lava's rumble swells and the music closes with its square. */
  setDanger(level: number): void {
    this.space.setDanger(level);
  }

  /** The music's snapshot level where the graph has it, one before. */
  get musicMixLevel(): number {
    return this.space.musicMixLevel;
  }

  /** The music's snapshot cutoff where the graph has one: the snapshot's or the danger's, whichever is lower. */
  get musicMixCutoff(): number {
    return this.space.musicMixCutoff;
  }

  /** The beds' snapshot cutoff. */
  get ambienceCutoff(): number {
    return this.space.ambienceCutoff;
  }

  /** The far cues' shared cutoff where one is built, open before the first far cue. */
  get farCutoff(): number {
    return this.space.farCutoff;
  }

  /** The far cues' extra ring's level into the hall for a bus: its bus level, or zero with none built. */
  farWetLevel(bus: Bus): number {
    return this.space.farWetLevel(bus);
  }

  /** The lava's rumble level now; zero with none. */
  get rumbleLevel(): number {
    return this.space.rumbleLevel;
  }

  /** How far down the music is ducked at this moment, one being not at all. */
  get musicDuckLevel(): number {
    return this.deck.musicDuckLevel;
  }

  /**
   * The player's volume for one bus, from the settings panel.
   *
   * Kept apart from the mix's gain and multiplied in, so a screen setting the
   * mix never overwrites the player's choice, and the player's choice never
   * flattens the mix.
   */
  setPlayerVolume(bus: Bus, value: number): void {
    this.graph.setPlayerVolume(bus, value);
  }

  /**
   * Silences the master rather than the buses.
   *
   * The mix is a set of decisions somebody made, and a mute is not one of
   * them: taking the master to zero leaves every bus where it was, so
   * unmuting restores the mix rather than a default of it.
   */
  setMuted(muted: boolean): void {
    this.graph.setMuted(muted);
  }

  get isMuted(): boolean {
    return this.graph.isMuted;
  }

  /**
   * Silences the master while another window has focus, for a player who
   * asked for that in settings. Only the master: the graph runs on, so the
   * race's sound is where it should be the moment focus comes back.
   */
  setUnfocused(unfocused: boolean): void {
    this.graph.setUnfocused(unfocused);
  }

  /** The host's volume for the game, inside Ruken; see `AudioGraph.setHostGain`. */
  setHostGain(gain: number): void {
    this.graph.setHostGain(gain);
  }

  /**
   * Loops one track on the region its content authored.
   *
   * `fromMs` starts it part-way in. The loop still returns to the region's
   * own start, so the first pass is the only one that begins there.
   */
  async playMusic(alias: string, fromMs = 0): Promise<void> {
    await this.deck.playMusic(alias, fromMs);
  }

  /**
   * Where a looping track is, in milliseconds on its own timeline: live while
   * it holds the slot, or where it was when it last left it. Undefined for a
   * track that has not looped here yet.
   *
   * Read off the graph's clock, which stops while the page sleeps, so a
   * locked phone does not move the place the song resumes from.
   */
  positionOf(alias: string): number | undefined {
    return this.deck.positionOf(alias);
  }

  /**
   * Whether `alias` is the looping track in the slot right now. Not a section
   * or a preview, and not a track still decoding: a caller that would start
   * the song only if it is not already going asks this first, since asking
   * `playMusic` for the track already looping starts it over.
   */
  isLooping(alias: string): boolean {
    return this.deck.isLooping(alias);
  }

  /**
   * The music a pulse can keep time to: the preview, the looping track or the
   * section in the slot, and how far into its own file it is. Undefined with
   * nothing sounding, and through a finish's slow motion, which the graph's
   * clock this reads does not slow with.
   */
  nowPlaying(): NowPlaying | undefined {
    return this.deck.nowPlaying();
  }

  /**
   * Plays one stretch of a track once, without looping: a song's results
   * section, under the "[name] wins" screen.
   *
   * It takes the music slot, so it replaces the race loop rather than playing
   * over it, and `stopMusic` ends it early. It ends in the tape echo
   * (`echoOut`) rather than cutting: an authored end time lands mid-waveform,
   * and a hard stop there clicks.
   */
  async playSection(alias: string, startMs: number, endMs: number): Promise<void> {
    await this.deck.playSection(alias, startMs, endMs);
  }

  /**
   * Ends the music slot. Given an alias, only while that track holds it: the
   * menu lets go of its track after the race has already started its own.
   */
  stopMusic(alias?: string): void {
    this.deck.stopMusic(alias);
  }

  /**
   * Crossfades to `alias`, played once to an echoing end: the slide on screen
   * in the song step changed. Once it has played out, asking for it again
   * plays it from the top. Asking for the clip already playing changes nothing. The menu
   * theme played through the ready room and the stage step; the first preview
   * is what ends it (spec §6.4). A clip that cannot be found or decoded plays
   * nothing and throws nothing (Review Focus 5): the clip paged away from
   * fades out, as it would for a song with no preview.
   */
  async playPreview(alias: string): Promise<void> {
    await this.deck.playPreview(alias);
  }

  /** Fades the preview out: the song reveal began, or the slide on screen has none. */
  stopPreview(): void {
    this.deck.stopPreview();
  }

  /** Forgets a decoded track, unless it is sounding or asked for: a clip the song step paged away from. */
  release(alias: string): void {
    this.deck.release(alias);
  }

  /**
   * Loops an ambient bed -- wind, a city below -- at the effects bus's level,
   * well under the cues, and around the vintage stage rather than through it.
   * One slot: asking for the bed already playing leaves it alone, so every
   * screen may ask on entry without stacking a second gust.
   */
  async playBed(alias: string, gain = 1): Promise<void> {
    await this.ambience.playBed(alias, gain);
  }

  /**
   * Ends the bed. Given an alias, only while that bed holds the slot: the menu
   * lets go of its bed after the race has already started its own.
   */
  stopBed(alias?: string): void {
    this.ambience.stopBed(alias);
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
    await this.ambience.setDrone(alias, level, rate);
  }

  /** Ends the drone at once: the finish cuts it rather than letting it fade. */
  stopDrone(): void {
    this.ambience.stopDrone();
  }

  /**
   * Sounds one cue, once.
   *
   * Silent before `unlock`, which is the ordinary state of a page nobody has
   * touched yet rather than an error to report.
   */
  async playCue(alias: string, options: CueOptions): Promise<void> {
    await this.cues.playCue(alias, options);
  }

  /** Stops every cue whose event ID starts with `prefix`, sounding or queued; see `AudioPort.stopCues`. */
  stopCues(prefix: string): void {
    this.cues.stopCues(prefix);
  }

  /** Stops the not-yet-begun cues whose event ID starts with `prefix`; see `AudioPort.cancelPending`. */
  cancelPending(prefix: string): void {
    this.cues.cancelPending(prefix);
  }

  /** The mix beside the speakers, for recording the race (unlockables spec §6.1). */
  captureStream(): { stream: MediaStream; release(): void } | undefined {
    return this.graph.captureStream();
  }

  /** This frame of the music, before the mix; see `MusicSpectrum`. */
  musicSpectrum(): MusicSpectrum | undefined {
    return this.graph.musicSpectrum();
  }

  /** Forgets which events have sounded. Called when a race starts. */
  resetHeard(): void {
    this.cues.resetHeard();
  }

  destroy(): void {
    this.deck.destroy();
    this.stopBed();
    this.deck.cutPreviews();
    this.cues.destroy();
    this.space.endRumble(false);
    this.space.cutRumbleTails();
  }

  /**
   * Gets a track ready ahead of its first play, so that play starts at once.
   * The menu song is downloaded whole (the bytes are the wait, and `stream`
   * reports them); every other track is decoded.
   */
  async preload(alias: string, stream: { signal?: AbortSignal; onReceived?: OnReceived } = {}): Promise<void> {
    if (alias === STREAMED_MENU_ALIAS && this.deck.stream !== undefined) {
      await this.deck.stream.load(stream);
      return;
    }
    await this.library.preload(alias);
  }

}
