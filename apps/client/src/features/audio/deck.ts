/**
 * The music slot: the looping track, the once-played section, the song-step
 * preview, and what they ask of the mix -- the climb's cutoff, the finish's
 * slow motion, the fall's muffle, and the ducks under a voice.
 *
 * Split out of `engine.ts`. Everything here was the engine's own code, moved
 * with its logic kept, reading the graph's nodes through the `AudioGraph`
 * and decodes through the `TrackLibrary`.
 */

import { MenuStream, STREAMED_MENU_ALIAS } from "./menu-stream";
import { SongBridge, SWAP_FADE_SECONDS, SWAP_LEAD_SECONDS, type SongStreamSource } from "./song-bridge";
import { logLerp } from "@floor-fifty/shared/common/math";
import {
  MUSIC_CUTOFF_OPEN_HZ,
  SLOW_MUSIC_CUTOFF_HZ,
  SLOW_MUSIC_SCALE,
  MUFFLE_HZ,
  MUFFLE_SECONDS,
  DUCK_ATTACK_SECONDS,
  DUCK_RELEASE_MS,
  SECTION_FADE_SECONDS,
  ECHO_OUT_SECONDS,
  ECHO_OUT_SEND,
  PREVIEW_FADE_SECONDS,
  MUSIC_TAIL_SECONDS,
  type LoopClock,
  type MusicDuck,
  type NowPlaying,
} from "./model";
import type { AudioGraph } from "./graph";
import type { TrackLibrary } from "./library";

export class MusicDeck {
  private musicCutoffHz = MUSIC_CUTOFF_OPEN_HZ;
  /** The finish's slow motion on the song: 1 is full speed. */
  private musicScale = 1;
  /**
   * The replay's speed on the song (race-options spec §7.2), under the
   * finish's. Unlike the finish's it outlives a track: the replay sets it and
   * then starts the song, which loads in between.
   */
  private musicRate = 1;
  /** The graph time a fall last muffled the music, if one has. */
  private muffledAt: number | undefined;
  /**
   * The ducks in force, on the graph's clock; see `duckMusic`. A cue's own
   * duck names it, so calling the cue off lets the music back up.
   */
  private ducks: { level: number; from: number; until: number; release: number; owner?: AudioBufferSourceNode }[] = [];

  private music: AudioBufferSourceNode | undefined;
  /** The track in the slot's own level, which its tail fades. */
  private musicLevel: GainNode | undefined;
  /** Tracks let go of and still ringing out, each with the level that fades it; see `MUSIC_TAIL_SECONDS`. */
  private readonly tails = new Map<AudioBufferSourceNode, GainNode>();
  /**
   * The song step's preview: one clip at a time, faded in and played once to
   * an echoing end, while the one it replaced fades out. Previews are music: they enter at
   * `musicInput`, so the analyser draws them and the music bus, the player's
   * music volume and the mute all apply (Review Focus 2).
   */
  private preview:
    | { alias: string; source: AudioBufferSourceNode; gain: GainNode; echo: GainNode | undefined; startedAt: number; clipMs: number }
    | undefined;
  /** The results section or song opening in the slot: where in its track it began, and when. */
  private sectionClock: { readonly alias: string; readonly startedAt: number; readonly startMs: number; readonly endMs: number } | undefined;
  /** The clip asked for last, set before its decode so a later ask wins. */
  private previewAlias: string | undefined;
  /** Clips still fading out, counted as live until they end. */
  private readonly fading = new Map<AudioBufferSourceNode, GainNode>();
  /**
   * A clip released while it still held the slot, its replacement decoding:
   * the deck releases the clip it paged away from in the same tick it asks
   * for the next. Forgotten once it gives the slot up, unless asked for again.
   */
  private releaseOnFade: string | undefined;
  /**
   * The track the music slot belongs to, set as soon as one is asked for
   * rather than once it has decoded. A stop that lands during the decode
   * clears it, and the decode then starts nothing: the menu track is several
   * seconds of decode, and a race could start inside them.
   */
  private musicAlias: string | undefined;
  /** Where the looping track in the slot started, to tell where it is now. */
  private loopClock: LoopClock | undefined;
  /** Where each loop was when it last left the slot, in milliseconds. */
  private readonly leftAt = new Map<string, number>();

  constructor(
    private readonly graph: AudioGraph,
    private readonly library: TrackLibrary,
    menuStreamUrl?: () => string | undefined,
    songStream?: (alias: string) => SongStreamSource | undefined,
  ) {
    this.stream = menuStreamUrl === undefined ? undefined : new MenuStream(graph, menuStreamUrl);
    this.bridge = songStream === undefined ? undefined : new SongBridge(graph, songStream);
  }

  readonly stream: MenuStream | undefined;
  /** A race song heard from the network while its decode runs; see `SongBridge`. */
  readonly bridge: SongBridge | undefined;

  /** Whether a track is currently looping. */
  get playingMusic(): boolean {
    return this.music !== undefined || this.stream?.playing === true || this.bridge?.playing === true;
  }

  /** The climb's cutoff as last asked for; a fresh graph opens with it there. */
  get cutoffHz(): number {
    return this.musicCutoffHz;
  }

  /** Sources the slot is ringing with: the track, plus its fading tails. */
  get musicSources(): number {
    return (this.music === undefined ? 0 : 1) + this.tails.size + (this.stream?.playing ? 1 : 0) + (this.bridge?.playing ? 1 : 0);
  }

  /** Preview clips sounding: the one playing plus any fading out. */
  get previewSources(): number {
    return (this.preview === undefined ? 0 : 1) + this.fading.size;
  }

  /**
   * Clamped to the audible band; above it the filter is simply open. Called
   * every frame of a race, which is also what carries a muffle back open.
   */
  setMusicCutoff(hz: number): void {
    this.musicCutoffHz = Math.min(MUSIC_CUTOFF_OPEN_HZ, Math.max(20, hz));
    this.applyMusicCutoff();
  }

  /**
   * The finish's slow motion on the song (race-flow spec §5.2): its rate, and
   * a low-pass that closes as it slows, composed under whatever cutoff the
   * race sets every frame. A new track starts at full speed: the next
   * playMusic or playSection resets it. `positionOf` assumes rate 1, which
   * only the menu reads, and never during a finish.
   */
  slowMusic(scale: number): void {
    this.musicScale = Math.min(1, Math.max(0.05, scale));
    this.applyMusicRate();
    this.applyMusicCutoff();
  }

  /** The replay's speed: 0.25 to 2, kept for the next track. It never touches the filter. */
  setMusicRate(rate: number): void {
    this.musicRate = Math.min(2, Math.max(0.25, rate));
    this.applyMusicRate();
  }

  private applyMusicRate(): void {
    if (this.music !== undefined) this.music.playbackRate.value = this.musicRate * this.musicScale;
    this.bridge?.setRate(this.musicRate * this.musicScale);
  }

  /** The finish's ceiling on the music's filter: open at full speed, 800 Hz at a quarter. */
  private get slowCutoff(): number {
    if (this.musicScale >= 1) return MUSIC_CUTOFF_OPEN_HZ;
    const t = Math.max(0, (this.musicScale - SLOW_MUSIC_SCALE) / (1 - SLOW_MUSIC_SCALE));
    return SLOW_MUSIC_CUTOFF_HZ + (MUSIC_CUTOFF_OPEN_HZ - SLOW_MUSIC_CUTOFF_HZ) * t ** 3;
  }

  /** Where the music's filter actually sits, in hertz: the climb's, or a muffle under it. */
  get musicCutoff(): number {
    const target = this.musicCutoffHz;
    const context = this.graph.context;
    if (this.muffledAt === undefined || context === undefined) return target;
    const opened = (context.currentTime - this.muffledAt) / MUFFLE_SECONDS;
    // Scheduled behind a delayed cue and not yet reached.
    if (opened < 0) return target;
    if (opened >= 1) {
      this.muffledAt = undefined;
      return target;
    }
    if (target <= MUFFLE_HZ) return target;
    // Evenly in octaves, eased in: a thud that hangs a moment, then opens.
    return Math.min(target, logLerp(MUFFLE_HZ, target, opened * opened));
  }

  /** Slams the music's filter shut, to open again over `MUFFLE_SECONDS`. */
  muffleMusic(at = this.graph.context?.currentTime ?? 0): void {
    this.muffledAt = at;
    this.applyMusicCutoff();
  }

  /** Lifts the muffle scheduled for `at`, when its cue is called off first. */
  unmuffleIf(at: number): void {
    if (this.muffledAt === at) this.muffledAt = undefined;
  }

  applyMusicCutoff(): void {
    if (this.graph.musicFilter !== undefined) this.graph.musicFilter.frequency.value = Math.min(this.musicCutoff, this.slowCutoff);
  }

  /**
   * Pulls the music down from `at`, on the graph's clock.
   *
   * Every duck in force is kept, and the level at each moment is the deepest
   * of the ones covering it: the finish's silence under "GAME!" stays silent,
   * and the line's own lighter duck takes over once the silence lets go
   * rather than the music jumping back to full between them.
   */
  duckMusic(duck: MusicDuck, at: number, lengthMs: number, owner?: AudioBufferSourceNode): void {
    const context = this.graph.context;
    if (this.graph.musicDuck === undefined || context === undefined) return;
    const now = context.currentTime;
    this.ducks = this.ducks.filter((held) => held.until > now);
    this.ducks.push({
      level: Math.min(1, Math.max(0, duck.level)),
      from: Math.max(now, at),
      until: Math.max(now, at) + Math.max(0, duck.holdMs ?? lengthMs) / 1000,
      release: Math.max(1, duck.releaseMs ?? DUCK_RELEASE_MS) / 1000,
      ...(owner === undefined ? {} : { owner }),
    });
    this.scheduleDucks(this.duckLevelAt(now - 1e-6));
  }

  /**
   * Takes back the ducks of cues called off: one queued never dips the music,
   * and one speaking lets it back up now, at its own release.
   */
  releaseDucks(owners: ReadonlySet<AudioBufferSourceNode>): void {
    const context = this.graph.context;
    if (context === undefined || owners.size === 0) return;
    const removed = this.ducks.filter((held) => held.owner !== undefined && owners.has(held.owner));
    if (removed.length === 0) return;
    const now = context.currentTime;
    const before = this.duckLevelAt(now);
    this.ducks = this.ducks.filter((held) => !removed.includes(held) && held.until > now);
    this.scheduleDucks(before, Math.max(...removed.map((held) => held.release)));
  }

  /**
   * Writes the ducks in force onto the music's duck gain, whole from now,
   * starting from `previous`, the level it holds now. `releaseNow` is how
   * fast to come back up from a duck taken away this moment.
   */
  private scheduleDucks(previous: number, releaseNow?: number): void {
    const param = this.graph.musicDuck?.gain;
    const context = this.graph.context;
    if (param === undefined || context === undefined) return;
    const now = context.currentTime;
    // Rewritten whole from now: each boundary is a step to the level in
    // force just after it, fast going down and at the duck's own release
    // coming back up.
    // Held where it is rather than cancelled: a plain cancel mid-fade snaps
    // the level back to the last step's start, and a snap is a click.
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
    else if (typeof param.cancelScheduledValues === "function") param.cancelScheduledValues(now);
    const boundaries = [...new Set([now, ...this.ducks.flatMap((held) => [held.from, held.until])])]
      .filter((time) => time >= now)
      .sort((a, b) => a - b);
    for (const time of boundaries) {
      const level = this.duckLevelAt(time);
      if (level === previous) continue;
      const ending = this.ducks.filter((held) => held.until === time);
      const release = Math.max(
        DUCK_ATTACK_SECONDS * 4.6,
        ...ending.map((held) => held.release),
        ...(time === now && releaseNow !== undefined ? [releaseNow] : []),
      );
      // A time constant is a third of the way to "there"; a quarter-plus of
      // the release lands within a percent of it by the end.
      param.setTargetAtTime(level, time, level < previous ? DUCK_ATTACK_SECONDS : release / 4.6);
      previous = level;
    }
  }

  private duckLevelAt(time: number): number {
    let level = 1;
    for (const held of this.ducks) if (held.from <= time && time < held.until) level = Math.min(level, held.level);
    return level;
  }

  /** How far down the music is ducked at this moment, one being not at all. */
  get musicDuckLevel(): number {
    const context = this.graph.context;
    return context === undefined ? 1 : this.duckLevelAt(context.currentTime);
  }

  /**
   * Loops one track on the region its content authored.
   *
   * `fromMs` starts it part-way in. The loop still returns to the region's
   * own start, so the first pass is the only one that begins there.
   */
  async playMusic(alias: string, fromMs = 0): Promise<void> {
    const context = this.graph.context;
    if (context === undefined) return;
    // Already being heard from the network: the ask that started it swaps in
    // the decoded copy, and a second ask (the race's, at GO) must not restart it.
    if (this.bridge?.held === alias) return;
    this.handOver(alias);
    if (alias === STREAMED_MENU_ALIAS && this.stream !== undefined) {
      this.endTrack();
      this.musicScale = 1;
      this.applyMusicCutoff();
      this.stream.play(fromMs);
      return;
    }
    // A whole song takes about 20 s to decode on an iPad. Rather than be
    // silent that long, a song not yet decoded is heard from the network
    // (`SongBridge`) and the decoded copy takes over where it has got to. A
    // song already decoded starts from its buffer at once, as it always did.
    let bridged = false;
    if (this.library.decodedTrack(alias) === undefined && this.bridge !== undefined) {
      this.musicScale = 1;
      this.applyMusicCutoff();
      bridged = this.bridge.start(alias, fromMs, this.musicRate);
    }
    // A track that lands late and was not bridged comes in where it would have
    // been by now, not from the top: the wait is added to `fromMs`. A track
    // already decoded resolves at once, so this adds 0.
    const askedAt = context.currentTime;
    // A decode that fails leaves a bridged song sounding rather than silent.
    const track = await this.library.trackFor(alias).catch(() => undefined);
    if (track === undefined || this.musicAlias !== alias) return;
    const lateByMs = Math.max(0, context.currentTime - askedAt) * 1000;

    // Where the song is by now if the network copy has been carrying it. The
    // slot holds no buffer source then, so there is nothing to cut, and the
    // bridge fades itself out under the new source.
    const handedFromMs = bridged ? this.bridge?.handOff() : undefined;
    if (handedFromMs === undefined) this.endTrack();
    // A new track starts at full speed, whatever a finish left behind.
    this.musicScale = 1;
    this.applyMusicCutoff();

    const source = context.createBufferSource();
    source.buffer = track.buffer;
    source.loop = true;
    // Seconds: the graph's unit. The content authors milliseconds because that
    // is the unit the measurement was made in.
    source.loopStart = track.loopStartMs / 1000;
    source.loopEnd = track.loopEndMs / 1000;
    const level = context.createGain();
    level.connect(this.graph.musicInput!);
    source.connect(level);
    const offsetMs = firstPassOffsetMs(handedFromMs ?? fromMs + lateByMs, track.loopStartMs, track.loopEndMs);
    // On a handoff the decoded copy starts after the lead and fades in as the
    // network copy fades out, so the two overlap rather than click or flam.
    const startsAt = handedFromMs === undefined ? context.currentTime : context.currentTime + SWAP_LEAD_SECONDS;
    if (handedFromMs !== undefined) {
      level.gain.setValueAtTime(0, context.currentTime);
      level.gain.setValueAtTime(0, startsAt);
      level.gain.linearRampToValueAtTime(1, startsAt + SWAP_FADE_SECONDS);
    }
    source.start(handedFromMs === undefined ? 0 : startsAt, offsetMs / 1000);
    this.music = source;
    this.musicLevel = level;
    this.applyMusicRate();
    this.loopClock = {
      alias,
      startedAt: startsAt,
      offsetMs,
      loopStartMs: track.loopStartMs,
      loopEndMs: track.loopEndMs,
    };
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
    if (alias === STREAMED_MENU_ALIAS && this.stream !== undefined) return this.stream.position;
    if (this.bridge?.held === alias) return this.bridge.position;
    if (this.loopClock?.alias === alias && this.music !== undefined) return this.loopPosition(this.loopClock);
    return this.leftAt.get(alias);
  }

  /**
   * Whether `alias` is the looping track in the slot right now. Not a section
   * or a preview, and not a track still decoding: a caller that would start
   * the song only if it is not already going asks this first, since asking
   * `playMusic` for the track already looping starts it over.
   */
  isLooping(alias: string): boolean {
    if (alias === STREAMED_MENU_ALIAS && this.stream !== undefined) return this.stream.playing;
    if (this.bridge?.held === alias && this.bridge.playing) return true;
    return this.loopClock?.alias === alias && this.music !== undefined;
  }

  /**
   * The music a pulse can keep time to: the preview, the looping track or the
   * section in the slot, and how far into its own file it is. Undefined with
   * nothing sounding, and through a finish's slow motion, which the graph's
   * clock this reads does not slow with.
   */
  nowPlaying(): NowPlaying | undefined {
    const now = this.graph.context?.currentTime;
    if (now === undefined) return undefined;
    const preview = this.preview;
    if (preview !== undefined) {
      // Played out, though its end has not been heard of yet: a silent clip has no beat.
      const elapsedMs = (now - preview.startedAt) * 1000;
      return elapsedMs < preview.clipMs ? { alias: preview.alias, ms: elapsedMs } : undefined;
    }
    if (this.stream?.playing) return { alias: STREAMED_MENU_ALIAS, ms: this.stream.position! };
    if (this.music === undefined && this.bridge?.playing) return { alias: this.bridge.held!, ms: this.bridge.position! };
    if (this.music === undefined || this.musicScale !== 1) return undefined;
    if (this.loopClock !== undefined) return { alias: this.loopClock.alias, ms: this.loopPosition(this.loopClock) };
    const section = this.sectionClock;
    if (section === undefined) return undefined;
    const ms = section.startMs + (now - section.startedAt) * 1000;
    return ms < section.endMs ? { alias: section.alias, ms } : undefined;
  }

  private loopPosition(clock: LoopClock): number {
    const elapsedMs = ((this.graph.context?.currentTime ?? clock.startedAt) - clock.startedAt) * 1000;
    const at = clock.offsetMs + elapsedMs;
    if (at < clock.loopEndMs) return at;
    const span = clock.loopEndMs - clock.loopStartMs;
    return span <= 0 ? clock.loopStartMs : clock.loopStartMs + ((at - clock.loopEndMs) % span);
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
    if (this.graph.context === undefined) return;
    this.handOver(alias);
    const track = await this.library.trackFor(alias);
    if (track === undefined || this.musicAlias !== alias) return;

    this.endTrack();
    // A new track starts at full speed, whatever a finish left behind.
    this.musicScale = 1;
    this.applyMusicCutoff();

    const context = this.graph.context;
    if (context === undefined) return;
    const duration = Math.max(0, (endMs - startMs) / 1000);
    const fade = context.createGain();
    fade.connect(this.graph.musicInput!);

    const source = context.createBufferSource();
    source.buffer = track.buffer;
    source.connect(fade);
    // Cut short, the source stops and disconnects, so its send carries nothing on.
    this.echoOut(source, fade, context.currentTime, context.currentTime + duration);
    source.onended = () => {
      fade.disconnect();
      if (this.music === source) {
        this.music = undefined;
        this.musicLevel = undefined;
      }
    };
    source.start(0, startMs / 1000, duration);
    this.music = source;
    this.musicLevel = fade;
    this.sectionClock = { alias, startedAt: context.currentTime, startMs, endMs };
  }

  /**
   * Ends the music slot. Given an alias, only while that track holds it: the
   * menu lets go of its track after the race has already started its own.
   */
  stopMusic(alias?: string): void {
    if (alias !== undefined && alias !== this.musicAlias) return;
    this.musicAlias = undefined;
    this.endTrack(true);
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
    if (this.graph.context === undefined) return;
    this.previewAlias = alias;
    if (this.releaseOnFade === alias) this.releaseOnFade = undefined;
    if (this.preview?.alias === alias) return;
    const track = await this.library.trackFor(alias).catch(() => undefined);
    if (this.graph.context === undefined || this.previewAlias !== alias) return;
    if (track === undefined) {
      this.fadePreviewOut();
      return;
    }
    if (this.preview?.alias === alias) return;

    this.stopMusic();
    this.fadePreviewOut();
    const context = this.graph.context;
    if (context === undefined) return;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(1, context.currentTime + PREVIEW_FADE_SECONDS);
    gain.connect(this.graph.musicInput!);
    const source = context.createBufferSource();
    source.buffer = track.buffer;
    source.connect(gain);
    const startedAt = context.currentTime;
    const echo = this.echoOut(source, gain, startedAt, startedAt + track.buffer.duration);
    source.onended = () => {
      if (this.preview?.source !== source) return;
      this.preview = undefined;
      source.disconnect();
      gain.disconnect();
    };
    source.start();
    this.preview = { alias, source, gain, echo, startedAt, clipMs: track.buffer.duration * 1000 };
  }

  /**
   * Ends `source` at `endsAt`, graph time, in the tape echo: over the last
   * `ECHO_OUT_SECONDS` its `dry` level falls to nothing while a send from the
   * source into the echo opens, so the stretch trails off in darkening repeats
   * the way a cue does. A graph with no echo fades `dry` over
   * `SECTION_FADE_SECONDS` instead. Returns the send, for an end that comes
   * sooner to close.
   */
  private echoOut(source: AudioBufferSourceNode, dry: GainNode, startsAt: number, endsAt: number): GainNode | undefined {
    const context = this.graph.context!;
    if (this.graph.musicEcho === undefined) {
      dry.gain.setTargetAtTime(0, Math.max(startsAt, endsAt - SECTION_FADE_SECONDS), SECTION_FADE_SECONDS / 4);
      return undefined;
    }
    const from = Math.max(startsAt, endsAt - ECHO_OUT_SECONDS);
    dry.gain.setValueAtTime(1, from);
    dry.gain.linearRampToValueAtTime(0, endsAt);
    const send = context.createGain();
    send.gain.value = 0;
    send.gain.setValueAtTime(0, from);
    send.gain.linearRampToValueAtTime(ECHO_OUT_SEND, endsAt);
    source.connect(send);
    send.connect(this.graph.musicEcho);
    return send;
  }

  /** Fades the preview out: the song reveal began, or the slide on screen has none. */
  stopPreview(): void {
    this.previewAlias = undefined;
    this.fadePreviewOut();
  }

  /** Forgets a decoded track, unless it is sounding or asked for: a clip the song step paged away from. */
  release(alias: string): void {
    if (alias === this.previewAlias || alias === this.musicAlias) return;
    if (alias === this.preview?.alias) {
      this.releaseOnFade = alias;
      return;
    }
    this.library.forget(alias);
  }

  private fadePreviewOut(): void {
    const current = this.preview;
    const context = this.graph.context;
    if (current === undefined || context === undefined) return;
    this.preview = undefined;
    // The fading source holds its own buffer; the cache need not.
    if (this.releaseOnFade === current.alias) {
      this.releaseOnFade = undefined;
      this.library.forget(current.alias);
    }
    // One clip fades at a time: one still fading when the next begins is cut,
    // so paging never stacks a third voice (Review Focus 1).
    this.cutFading();
    const at = context.currentTime;
    // Paged away from: a quick fade, and no echo.
    current.echo?.gain.cancelScheduledValues(at);
    current.echo?.gain.setValueAtTime(0, at);
    const level = current.gain.gain;
    level.cancelScheduledValues(at);
    level.setValueAtTime(level.value, at);
    level.linearRampToValueAtTime(0, at + PREVIEW_FADE_SECONDS);
    this.fading.set(current.source, current.gain);
    current.source.onended = () => {
      this.fading.delete(current.source);
      current.source.disconnect();
      current.gain.disconnect();
    };
    current.source.stop(at + PREVIEW_FADE_SECONDS);
  }

  private cutFading(): void {
    for (const [source, gain] of this.fading) {
      source.onended = null;
      source.stop();
      source.disconnect();
      gain.disconnect();
    }
    this.fading.clear();
  }

  /** Every preview, playing or fading, stopped now: the engine is going away. */
  cutPreviews(): void {
    this.previewAlias = undefined;
    const current = this.preview;
    this.preview = undefined;
    if (current !== undefined) this.fading.set(current.source, current.gain);
    this.cutFading();
  }

  /**
   * Claims the music slot for `alias`, and cuts whatever else is sounding in it
   * now rather than once the new track has decoded. The race asks for its song
   * while the menu's is still playing, and the decode is a fetch away: without
   * this the menu track plays under the race for that long, and for good if the
   * race's never arrives. Asking again for the track already claimed cuts
   * nothing, so a repeat ask does not gap the loop.
   */
  private handOver(alias: string): void {
    const previous = this.musicAlias;
    this.musicAlias = alias;
    if (previous !== alias) this.endTrack(true);
  }

  /** Empties the slot: at once, or with `tail` over `MUSIC_TAIL_SECONDS`. */
  private endTrack(tail = false): void {
    this.stream?.stop();
    this.bridge?.stop();
    if (this.music === undefined) return;
    if (this.loopClock !== undefined) this.leftAt.set(this.loopClock.alias, this.loopPosition(this.loopClock));
    this.loopClock = undefined;
    this.sectionClock = undefined;
    const source = this.music;
    const level = this.musicLevel;
    this.music = undefined;
    this.musicLevel = undefined;
    if (tail && level !== undefined && this.graph.context !== undefined) {
      const at = this.graph.context.currentTime;
      // Held where it is first, so a section's own fade cannot snap it back up.
      level.gain.cancelScheduledValues(at);
      level.gain.setValueAtTime(level.gain.value, at);
      level.gain.linearRampToValueAtTime(0, at + MUSIC_TAIL_SECONDS);
      this.tails.set(source, level);
      source.onended = () => {
        this.tails.delete(source);
        source.disconnect();
        level.disconnect();
      };
      source.stop(at + MUSIC_TAIL_SECONDS);
      return;
    }
    this.graph.cut(source, level);
  }

  /** Every tail cut now: the engine is going away. */
  private cutTails(): void {
    for (const [source, level] of this.tails) {
      source.onended = null;
      source.stop();
      source.disconnect();
      level.disconnect();
    }
    this.tails.clear();
  }

  /** The slot emptied and every tail cut: the engine is going away. */
  destroy(): void {
    this.musicAlias = undefined;
    this.endTrack();
    this.cutTails();
    this.stream?.destroy();
    this.bridge?.destroy();
  }
}

/**
 * Where the first pass of a looping track starts. Within the first pass that
 * is `fromMs` itself. Past the loop's end (a track that landed late, after the
 * time it would have run out), it wraps into the loop region the way the
 * playing track would have, rather than stopping at the end.
 */
function firstPassOffsetMs(fromMs: number, loopStartMs: number, loopEndMs: number): number {
  const from = Math.max(0, fromMs);
  if (from <= loopEndMs) return from;
  const region = loopEndMs - loopStartMs;
  if (region <= 0) return loopEndMs;
  return loopStartMs + ((from - loopEndMs) % region);
}
