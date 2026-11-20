/**
 * The song, read as motion: its beats and its highs.
 *
 * **Beats**, where the song's are known, are the song's own: a caller that
 * knows which track is playing, where it is, and its measured tempo and first
 * beat passes `songBeatAt` of them, and each whole beat starts a leg of the
 * duotone's ping pong. Hearing beats is a guess -- a bass line off the beat
 * sounds like a kick, and halves the tempo it learns -- and a measured grid
 * is not.
 *
 * Without one -- a results section, a finish's slow motion, a track nobody
 * measured -- beats are heard: power in the low band jumping past its own
 * recent average. Power, from the analyser's unclamped decibels, not its
 * bytes: a mastered song's bass sits near the bytes' ceiling, where no rise
 * can be 1.3 times the average, and a kick clips there with the bar it lands
 * on. Each one starts a leg, timed to the gap between the last few beats, so
 * the ease-in's snap -- the pair arriving at its fastest -- lands on the next
 * beat rather than between two. A beat that comes early cuts the leg short
 * and snaps then; one that comes late holds the pair until it does.
 *
 * A softer rise counts as a beat too, but only where the tempo says the next
 * one is due: on the grid it is the song's quieter kicks, off it a bass line.
 *
 * Each heard beat is also a **kick**: an envelope that jumps to how hard the
 * kick hit -- how far the low band leapt past its average -- and falls away
 * over a fraction of a second, for anything that should be struck by the beat
 * rather than timed to it. The curve is steep: an ordinary beat is a nudge,
 * and only the heavy ones strike hard. A run-on beat is not heard, so it does
 * not kick. With the song's beats known, the kick is still heard, wherever
 * it lands: it is how hard the music hit, not when the beat is.
 *
 * **Highs** are the hats and the shimmer: how sharply the top of the spectrum
 * rises from one frame to the next, against the loudest such rise lately, so a
 * quiet passage still has its peaks. Each one is a spike that jumps at once
 * and falls away over a fraction of a second.
 *
 * With no music -- no graph yet, a browser still waiting for the tap, a
 * silent passage -- the beat runs on by itself at the last tempo it heard
 * or was given, so the splash never stops moving, and the highs rest at zero.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { MusicSpectrum, NowPlaying } from "../audio";
import type { SongTiming } from "../audio/song-timings";
import { easeIn } from "./filters/duotone-dither";

/** Where a playing song is, in its own beats. */
export type SongBeat = {
  /** Beats since the song's first, fractional: 2.5 is halfway from the third to the fourth. */
  readonly beat: number;
  /** Seconds from one beat to the next. */
  readonly beatSeconds: number;
};

/**
 * Where a song is, in beats, `positionMs` into its track: its measured tempo,
 * and its first beat in ticks from the track's start, as `content/songs` and
 * `pnpm intake:song` give them.
 */
export const songBeatAt = (positionMs: number, song: SongTiming): SongBeat => ({
  beat: ((positionMs / 1000 - song.beatOffsetTicks / TICK_HZ) * song.bpm) / 60,
  beatSeconds: 60 / song.bpm,
});

/** Where whatever is playing is in its beats, if its timing is among `timings`. */
export const playingSongBeat = (
  audio: { nowPlaying?(): NowPlaying | undefined },
  timings: ReadonlyMap<string, SongTiming>,
): SongBeat | undefined => {
  const playing = audio.nowPlaying?.();
  const timing = playing === undefined ? undefined : timings.get(playing.alias);
  return playing === undefined || timing === undefined ? undefined : songBeatAt(playing.ms, timing);
};

/** One frame of the pulse. */
export type PulseFrame = {
  /** The duotone's phase, 0 to 1, a leg per beat. */
  readonly phase: number;
  /** How hard the highs are hitting, 0 to 1. */
  readonly spike: number;
  /** Beats so far, heard or run on. Counts up by one on each. */
  readonly beats: number;
  /** How far into the current beat, 0 to 1, by the tempo in use. */
  readonly progress: number;
  /** How hard the last heard kick struck, 0 to 1, falling away after it. */
  readonly kick: number;
};

/** The kick's band, in hertz. */
const LOW_BAND: readonly [number, number] = [40, 160];
/** The hats' band, in hertz. */
const HIGH_BAND: readonly [number, number] = [5_000, 14_000];

/** A beat is the low band's power this far over its recent average... */
const BEAT_RATIO = 3;
/** ...and at least this loud, in decibels, so a quiet bar's noise is not a beat. */
const BEAT_FLOOR_DB = -86;
/** How long the low band's average remembers, in seconds. */
const LOW_AVERAGE_SECONDS = 0.8;
/** Beats this close together are one beat: about 200 bpm. */
const MIN_BEAT_GAP = 0.3;
/** Gaps longer than this are a missed beat or a pause, not the tempo. */
const MAX_BEAT_GAP = 1.2;
/** How far each heard gap moves the tempo. */
const TEMPO_FOLLOW = 0.3;
/** A late beat is waited for this share of a leg before the pulse runs on without it. */
const LATE_GRACE = 0.25;

/** A rise this far over the average is a beat, if it lands when one is due... */
const SOFT_BEAT_RATIO = 1.4;
/** ...within this share of a leg either side of it. */
const SOFT_BEAT_WINDOW = 0.2;
/** A kick this far over the low band's average power strikes at full strength. */
const KICK_FULL_RATIO = 8;
/** How every heard beat strikes at least: the ordinary beat's nudge. */
const KICK_SUBTLE = 0.22;
/** How steeply strength climbs from the nudge to a full strike: the heavy beats stand out. */
const KICK_CURVE = 2.5;
/** How fast a kick falls away, in seconds. */
const KICK_DECAY_SECONDS = 0.14;

/** How long the highs' loudest recent rise is remembered, in seconds. */
const HIGH_PEAK_SECONDS = 2;
/** The quietest a recent rise is taken to be, so silence is not normalised into spikes. */
const HIGH_PEAK_FLOOR = 0.015;
/** A rise below this share of the recent peak is no spike. */
const SPIKE_THRESHOLD = 0.35;
/** How fast a spike falls away, in seconds. */
const SPIKE_DECAY_SECONDS = 0.18;

const bandLevel = (spectrum: MusicSpectrum, [low, high]: readonly [number, number]): number => {
  const from = Math.max(0, Math.floor(low / spectrum.binHz));
  const to = Math.min(spectrum.bins.length, Math.ceil(high / spectrum.binHz));
  if (to <= from) return 0;
  let sum = 0;
  for (let bin = from; bin < to; bin++) sum += spectrum.bins[bin]!;
  return sum / (to - from) / 255;
};

/** The mean power of the band's bins, from their decibels: 1 is 0 dB. */
const bandPower = (spectrum: MusicSpectrum, [low, high]: readonly [number, number]): number => {
  const from = Math.max(0, Math.floor(low / spectrum.binHz));
  const to = Math.min(spectrum.decibels.length, Math.ceil(high / spectrum.binHz));
  if (to <= from) return 0;
  let sum = 0;
  for (let bin = from; bin < to; bin++) sum += 10 ** (spectrum.decibels[bin]! / 10);
  return sum / (to - from);
};

/** How much of a remembered value survives `seconds`, remembering for `memory` seconds. */
const decay = (seconds: number, memory: number): number => Math.exp(-seconds / memory);

export class MusicPulse {
  private now = 0;
  private lastBeatAt = 0;
  /** The last beat actually heard; the tempo is the gap between these. */
  private lastHeardAt = Number.NEGATIVE_INFINITY;
  /** Whether the leg under way was started by a run-on beat rather than a heard one. */
  private ranOn = false;
  private beats = 0;
  /** The song's whole beat last frame, while one is given. */
  private songBeat: number | undefined;
  private lowAverage = 0;
  private lowPrevious = 0;
  private highPrevious = 0;
  private highPeak = HIGH_PEAK_FLOOR;
  private spike = 0;
  private kick = 0;

  /** `legSeconds` is the tempo before any beat is heard: one leg of the ping pong. */
  constructor(private legSeconds: number) {}

  /** The tempo in use: seconds from one beat to the next. */
  get beatSeconds(): number {
    return this.legSeconds;
  }

  /**
   * Moves on `seconds`, hearing `spectrum` if there is one, on the song's own
   * beats if `song` says where they are.
   */
  update(seconds: number, spectrum?: MusicSpectrum, song?: SongBeat): PulseFrame {
    const dt = Math.max(0, seconds);
    this.now += dt;
    this.kick *= decay(dt, KICK_DECAY_SECONDS);

    if (spectrum !== undefined && spectrum.bins.length > 0) {
      // On the song's beats a heard one only strikes; it is not a leg.
      if (this.hearLow(bandPower(spectrum, LOW_BAND), dt)) {
        if (song === undefined) this.beat();
        else this.lastHeardAt = this.now;
      }
      this.hearHigh(bandLevel(spectrum, HIGH_BAND), dt);
    } else {
      this.spike *= decay(dt, SPIKE_DECAY_SECONDS);
    }

    if (song !== undefined) return this.onSong(song);
    this.songBeat = undefined;

    // Run on through a silence at the tempo last heard: beat after beat, on
    // the leg's own clock, however long a frame was. A late beat is waited
    // for a little while there is music to hear it in.
    const wait = this.legSeconds * (spectrum === undefined ? 1 : 1 + LATE_GRACE);
    while (this.now - this.lastBeatAt >= wait) this.runOn(this.lastBeatAt + wait);

    const progress = Math.min(1, (this.now - this.lastBeatAt) / this.legSeconds);
    const eased = easeIn(progress);
    return {
      phase: this.beats % 2 === 0 ? eased : 1 - eased,
      spike: this.spike,
      beats: this.beats,
      progress,
      kick: this.kick,
    };
  }

  /**
   * On the song's beats: a leg per whole beat, counted on rather than back
   * when the track loops, and the leg's clock kept on the song's so a run-on
   * beat after it lands where the song's next would have.
   */
  private onSong(song: SongBeat): PulseFrame {
    const whole = Math.floor(song.beat);
    if (this.songBeat !== undefined && whole !== this.songBeat) this.beats += 1;
    this.songBeat = whole;
    const progress = song.beat - whole;
    this.legSeconds = song.beatSeconds;
    this.lastBeatAt = this.now - progress * song.beatSeconds;
    this.ranOn = false;
    const eased = easeIn(progress);
    return {
      phase: this.beats % 2 === 0 ? eased : 1 - eased,
      spike: this.spike,
      beats: this.beats,
      progress,
      kick: this.kick,
    };
  }

  /** Hears the low band; true when it heard a beat, which has struck the kick. */
  private hearLow(level: number, dt: number): boolean {
    const rising = level > this.lowPrevious;
    this.lowPrevious = level;
    // How hard it hit, against the average before this frame joined it.
    const over = level / Math.max(this.lowAverage, 1e-12);
    const keep = decay(dt, LOW_AVERAGE_SECONDS);
    this.lowAverage = this.lowAverage * keep + level * (1 - keep);
    const onset = rising && level > 10 ** (BEAT_FLOOR_DB / 10) && this.now - this.lastHeardAt >= MIN_BEAT_GAP;
    if (!onset) return false;
    const sinceBeat = this.now - this.lastBeatAt;
    const due = Math.abs(sinceBeat - this.legSeconds) <= this.legSeconds * SOFT_BEAT_WINDOW;
    const isBeat = over > BEAT_RATIO || (over > SOFT_BEAT_RATIO && due && sinceBeat >= MIN_BEAT_GAP);
    if (!isBeat) return false;
    const strength = Math.min(1, Math.max(0, (over - SOFT_BEAT_RATIO) / (KICK_FULL_RATIO - SOFT_BEAT_RATIO)));
    this.kick = Math.max(this.kick, KICK_SUBTLE + (1 - KICK_SUBTLE) * strength ** KICK_CURVE);
    return true;
  }

  private hearHigh(level: number, dt: number): void {
    const rise = Math.max(0, level - this.highPrevious);
    this.highPrevious = level;
    this.highPeak = Math.max(rise, HIGH_PEAK_FLOOR, this.highPeak * decay(dt, HIGH_PEAK_SECONDS));
    const hit = Math.min(1, Math.max(0, (rise / this.highPeak - SPIKE_THRESHOLD) / (1 - SPIKE_THRESHOLD)));
    this.spike = Math.max(hit, this.spike * decay(dt, SPIKE_DECAY_SECONDS));
  }

  /** A heard beat: the tempo follows the gap since the last, and a leg starts. */
  private beat(): void {
    const gap = this.now - this.lastHeardAt;
    if (gap <= MAX_BEAT_GAP) this.legSeconds += (gap - this.legSeconds) * TEMPO_FOLLOW;
    this.lastHeardAt = this.now;
    // Just after a run-on beat, this is the beat it stood in for: the leg is
    // moved onto it rather than a second one started.
    const standIn = this.ranOn && this.now - this.lastBeatAt < MIN_BEAT_GAP;
    this.ranOn = false;
    this.lastBeatAt = this.now;
    if (!standIn) this.beats += 1;
  }

  private runOn(at: number): void {
    this.ranOn = true;
    this.lastBeatAt = at;
    this.beats += 1;
  }
}
