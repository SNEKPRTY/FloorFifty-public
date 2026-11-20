import type { SongStreamSource } from "./song-bridge";

/** The four mixes. Ordered loudest-lived to shortest, the voice last. */
export const BUSES = ["music", "effects", "ui", "voice"] as const;
export type Bus = (typeof BUSES)[number];

/**
 * How many cues may sound at once.
 *
 * Four racers landing on the same tick is four transients, and a reconnect can
 * deliver a burst of confirmations at once. Past this the oldest voice is
 * dropped rather than the newest refused: the most recent landing is the one a
 * player is watching.
 */
export const MAX_VOICES = 16;

/**
 * Default mix, before any tuning. Music runs a little over its file's own
 * level (−16 LUFS), which the export left quieter than the owner wants.
 */
export const DEFAULT_GAINS: Record<Bus, number> = { music: 1.1, effects: 0.9, ui: 0.7, voice: 0.95 };

/**
 * How much of each bus rings in the hall, post-fader so the player's volume
 * turns the echo down with the sound.
 *
 * The announcer most: he is the one sound meant to fill the arena. The effects
 * enough that a clash rings out. The interface a touch, so a menu click belongs
 * to the same place without smearing. The music not at all.
 */
export const HALL_SENDS: Record<Bus, number> = { music: 0, effects: 0.32, ui: 0.14, voice: 0.45 };

/**
 * How much of each bus feeds the tape echo, post-fader like the hall. The
 * announcer most, as in the hall, so a call trails away the way an arena's
 * does; the interface least, so a menu stays crisp.
 */
export const ECHO_SENDS: Record<Bus, number> = { music: 0, effects: 0.22, ui: 0.12, voice: 0.32 };

/** The echo: one repeat a little over a quarter-second apart, each darker and quieter. */
export const ECHO_SECONDS = 0.26;
export const ECHO_FEEDBACK = 0.38;
export const ECHO_TONE_HZ = 2_400;


/**
 * The music's climb filter wide open: past what the ear misses, so a track
 * with nothing asking for it sounds exactly as mastered.
 */
export const MUSIC_CUTOFF_OPEN_HZ = 20_000;
/** The music's low-pass at the finish's slowest (race-flow spec §5.2). */
export const SLOW_MUSIC_CUTOFF_HZ = 800;
/**
 * The finish's slowest scale, where the filter reaches `SLOW_MUSIC_CUTOFF_HZ`:
 * `SLOW_SCALE` in `finish-sequence.ts`, restated because this module imports
 * nothing (see the header).
 */
export const SLOW_MUSIC_SCALE = 0.25;


/**
 * How far a varied cue may stray, either way: pitch in cents, level in
 * decibels. A quarter of a semitone stays in tune with the track and a decibel
 * and a half is under what reads as a different level; together they are
 * enough that the fortieth landing is not the first one again.
 */
export const VARY_CENTS = 25;
export const VARY_DB = 1.5;

/**
 * The fall's muffle: the music slammed down to this cutoff and let open again
 * over this long, toward wherever the climb's own filter is heading. A reset
 * already closes the climb filter, but at the glide's pace; this is the
 * impact on top of it.
 */
export const MUFFLE_HZ = 320;
export const MUFFLE_SECONDS = 0.9;

/**
 * How long a sound cut short takes to go: long enough that the stop lands on
 * silence rather than mid-waveform, short enough to still read as a cut.
 */
export const CUT_SECONDS = 0.02;

/** How fast a level the player or a screen sets glides there, so a slider drag does not crackle. */
export const LEVEL_GLIDE_SECONDS = 0.01;

/**
 * The player's volume, slider to gain: squared, so the slider moves evenly
 * to the ear. Linear, half the slider was only -6 dB and every real change
 * was crowded into its bottom tenth; squared, half is -12 dB.
 */
export const playerGain = (value: number): number => {
  const share = Math.min(1, Math.max(0, value));
  return share * share;
};

/**
 * The mix's named states, the way a film mix keeps snapshots: what the music,
 * the beds and the far racers are doing in each. Each eases in on its own
 * stage of the graph -- the music a gain and a low-pass of its own after the
 * climb's filter and before the duck -- so a snapshot never fights the climb,
 * a muffle or a duck, and they compose.
 *
 * - `race`: everything open, as mastered.
 * - `paused`: the music heard through the wall while the menu is up.
 * - `breath`: the beat before the payoff. "LAST FLOOR!" sucks the room out --
 *   the music low and dark, the wind thin, the rivals far off -- so the
 *   finish's fanfare lands against near-silence. The film trick of pulling
 *   everything out just before the hit.
 */
export type MixName = "race" | "paused" | "breath";
export type MixState = {
  /** The music's level, one being as mastered. */
  readonly musicLevel: number;
  /** The music's low-pass, in hertz. */
  readonly musicHz: number;
  /** The beds' low-pass. */
  readonly ambienceHz: number;
  /** The low-pass every far cue shares, on top of its own; see `CueOptions.distance`. */
  readonly farHz: number;
  /**
   * The lava's rumble, as a share of what the danger asks for: a 140 Hz
   * rumble passes any of these low-passes, so the pause turns it down instead.
   */
  readonly rumble: number;
};
export const MIXES: Readonly<Record<MixName, MixState>> = {
  race: { musicLevel: 1, musicHz: MUSIC_CUTOFF_OPEN_HZ, ambienceHz: MUSIC_CUTOFF_OPEN_HZ, farHz: MUSIC_CUTOFF_OPEN_HZ, rumble: 1 },
  paused: { musicLevel: 0.7, musicHz: 600, ambienceHz: 900, farHz: 900, rumble: 0.2 },
  breath: { musicLevel: 0.35, musicHz: 1_800, ambienceHz: 1_400, farHz: 700, rumble: 1 },
};
/** How fast a snapshot eases in: a time constant, so it is all but there in a third of a second. */
export const MIX_EASE_SECONDS = 0.08;

/**
 * A far cue's own low-pass at full distance, and how much more of it rings in
 * the hall: air eats the top of a sound and a room's reflections outweigh it,
 * which is how a racer far below sounds far below rather than merely quiet.
 */
export const FAR_CUE_HZ = 1_400;
export const FAR_HALL_SEND = 0.3;
/** A far cue a little quieter too: a quarter down at full distance. */
export const FAR_LEVEL = 0.75;

/**
 * Survival's danger (survival spec §7), heard: a rumble swelling under the
 * race as the lava closes, and the music darkening toward this cutoff with
 * it. Both follow the square of the danger, so a distant lava is all but
 * silent and a near one fills the floor. A rumble, not a heartbeat.
 */
export const DANGER_RUMBLE_GAIN = 0.5;
export const DANGER_MUSIC_HZ = 1_200;
/** How long the rumble takes to fade once the danger is gone, before it stops. */
export const RUMBLE_FADE_SECONDS = 0.3;

/** The far cues' shared way out of one bus; see `MixSpace.farPathFor`. */
export type FarPath = {
  readonly dry: BiquadFilterNode;
  readonly wet: BiquadFilterNode | undefined;
  readonly wetLevel: GainNode | undefined;
};
/** Where the rumble's noise is cut: felt more than heard. */
export const RUMBLE_HZ = 140;

/** Eases an audio parameter toward `value`, or sets it on a graph that cannot automate. */
export function ease(param: AudioParam, value: number, at: number, seconds: number): void {
  if (typeof param.setTargetAtTime === "function") param.setTargetAtTime(value, at, seconds);
  else param.value = value;
}


/** How fast a duck pulls the music down, and the default for letting it back. */
export const DUCK_ATTACK_SECONDS = 0.012;
export const DUCK_RELEASE_MS = 260;

/** A bed sits well under the effects bus whose level it follows. */
export const BED_GAIN = 0.45;

/**
 * The climb's drone at full: about the music's own level, so the top of the
 * race is felt under the song rather than lost in its bass.
 */
export const DRONE_GAIN = 0.35;
/** How fast the drone follows what it is asked for: two seconds to settle. */
export const DRONE_SMOOTH_SECONDS = 0.5;

/**
 * The music analyser's window: about 21 ms at 48 kHz, short enough to catch
 * a hi-hat, with bins about 47 Hz wide, narrow enough to find the kick.
 */
export const MUSIC_FFT_SIZE = 1024;

/** How long a stretch played to its end fades over, on a graph with no echo. */
export const SECTION_FADE_SECONDS = 0.06;
/**
 * The last stretch of a section or a preview that plays to its end, over
 * which the dry sound gives way to the tape echo the cues ring in.
 */
export const ECHO_OUT_SECONDS = 1;
/** How much of the music feeds the echo by the end: more than any bus, so the repeats carry the tail alone. */
export const ECHO_OUT_SEND = 0.6;
/** A preview's fade in, and the fade out of the one it replaces. */
export const PREVIEW_FADE_SECONDS = 0.35;
/**
 * How long a track let go of rings out: a screen's exit stops its music under
 * the veil, and a cut there is a click and a hole. Faded instead, the old
 * screen's sound runs a moment under the new one's start -- an editor's
 * L-cut -- and the slot is free at once for the next track.
 */
export const MUSIC_TAIL_SECONDS = 0.35;

/** When and where the looping track in the music slot started. */
export type LoopClock = {
  readonly alias: string;
  /** The graph's time at the start, in seconds. */
  readonly startedAt: number;
  readonly offsetMs: number;
  readonly loopStartMs: number;
  readonly loopEndMs: number;
};

/** A decoded track and the region of it the stage repeats. */
export type DecodedTrack = {
  readonly buffer: AudioBuffer;
  readonly loopStartMs: number;
  readonly loopEndMs: number;
};

/**
 * The slice of `AudioContext` this uses.
 *
 * Narrowed so a test can supply a recording graph: there is no Web Audio under
 * a unit test, and a mixer that could only be exercised in a browser would be
 * a mixer nothing checks.
 */
export type AudioContextLike = {
  state: AudioContextState;
  readonly currentTime: number;
  readonly destination: AudioNode;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  createMediaElementSource?(element: HTMLMediaElement): MediaElementAudioSourceNode;
  /** Optional: a graph without these has no hall, and every cue still plays dry. */
  createConvolver?(): ConvolverNode;
  createBuffer?(channels: number, length: number, sampleRate: number): AudioBuffer;
  /** Optional: a graph without one has no spectrum to read, and nothing else changes. */
  createAnalyser?(): AnalyserNode;
  /** Optional: a graph without one cannot be recorded (unlockables spec §6.1). */
  createMediaStreamDestination?(): MediaStreamAudioDestinationNode;
  /** Optional: a graph without these has no vintage stage, and every bus goes straight out. */
  createBiquadFilter?(): BiquadFilterNode;
  createWaveShaper?(): WaveShaperNode;
  /** Optional: a graph without one has no echo; the vintage band still applies. */
  createDelay?(maxDelayTime?: number): DelayNode;
  /** Optional: a graph without one plays every cue centred. */
  createStereoPanner?(): StereoPannerNode;
  readonly sampleRate?: number;
};

/**
 * The music as it sounds right now, one frame of it: magnitudes in [0, 255]
 * per bin, the same magnitudes in decibels, and how wide a bin is in hertz.
 * Read before the player's volume and the mute, so a screen that moves to the
 * song keeps moving when the player turns it down.
 *
 * The bytes are for drawing: they map -100 dB to -30 dB onto [0, 255] and
 * clip above it, where a mastered song's bass spends most of its time. The
 * decibels are unclamped, for anything that measures the music rather than
 * drawing it.
 */
/** A track sounding now, and how far into its own file it is, in milliseconds. */
export type NowPlaying = { readonly alias: string; readonly ms: number };

export type MusicSpectrum = { readonly bins: Uint8Array; readonly decibels: Float32Array; readonly binHz: number };

export type AudioEngineOptions = {
  createContext: () => AudioContextLike;
  /** Whole-file menu loop only; race regions remain decoded buffers. */
  menuStreamUrl?: () => string | undefined;
  /** Where a race song's file is, to hear it from the network while it decodes. */
  songStream?: (alias: string) => SongStreamSource | undefined;
  /** Resolves an alias to a decoded buffer and its authored loop region. */
  decode: (alias: string) => Promise<DecodedTrack | undefined>;
  /** In `[0, 1)`, for a varied cue's spread. A test supplies its own. */
  random?: () => number;
};

/**
 * The music pulled down under a cue: to `level` of itself, held for
 * `holdMs` (the cue's own length when omitted), then let back over
 * `releaseMs`. Zero is silence -- the finish's hit-stop.
 */
export type MusicDuck = {
  readonly level: number;
  readonly holdMs?: number;
  readonly releaseMs?: number;
};

/**
 * Every voice cue's duck, unless it brings its own (polish spec §8.3): the
 * music steps down while the announcer speaks -- GAME!, a name, a lap call --
 * and recovers over 300 ms.
 */
export const VOICE_BUS_DUCK: MusicDuck = { level: 0.55, releaseMs: 300 };

export type CueOptions = {
  readonly bus: Bus;
  /**
   * Level for this cue alone, against its bus. One is the bus's own level.
   *
   * A per-cue gain rather than a per-cue bus: a landing and a finish belong to
   * the same mix and should move together when that mix is tuned, while still
   * sitting at different levels within it.
   */
  readonly gain?: number;
  /**
   * The authoritative event this cue belongs to, when it belongs to one.
   *
   * Present, the cue sounds once however many times it is asked for. Absent --
   * a UI click, which has no authoritative identity -- every ask is a sound,
   * because two clicks are two clicks.
   */
  readonly eventId?: string;
  /**
   * How long after now to start, on the graph's own clock. For a line that
   * follows another -- "GAME!", then "the winner is", then a name -- so the
   * sequence keeps its timing however late the main thread gets to it.
   */
  readonly delayMs?: number;
  /**
   * The longest it may sound, in milliseconds, cut there however long the
   * clip is. For a count's number said late, which would otherwise still be
   * speaking when the next number is due.
   */
  readonly maxMs?: number;
  /**
   * Playback speed, and so pitch: two is an octave up. For a landing that
   * climbs the scale with the racer.
   */
  readonly rate?: number;
  /**
   * A small random spread in pitch and level each time it sounds; see
   * `VARY_CENTS`. For a cue heard often enough to wear.
   */
  readonly vary?: boolean;
  /** Where it sits between the speakers, -1 left to 1 right. Centred without. */
  readonly pan?: number;
  /** Pulls the music down while this sounds, from the moment it starts. */
  readonly duck?: MusicDuck;
  /** Slams the music's filter shut as it starts, and lets it open again. */
  readonly muffle?: boolean;
  /**
   * How far off it happened, 0 (here) to 1 (as far as the mix places
   * anything): darker, wetter and a little quieter with distance, and closed
   * further while the race holds its breath (`MIXES.breath`). A rival a few
   * floors below. Near without.
   */
  readonly distance?: number;
};

export interface AudioPort {
  load(bundle?: string): Promise<void>;
  /**
   * Gets a track ready ahead of its first play, so that play starts at once:
   * decoded, or for the menu song downloaded whole, `onProgress` hearing the
   * fraction that has arrived.
   */
  preload?(cue: string, onProgress?: (fraction: number) => void): Promise<void>;
  /** Starts the graph. Must be reached from inside a user gesture. */
  unlock(): Promise<void>;
  /** Loops a track in the music slot, from `fromMs` into it on the first pass. */
  play(cue: string, fromMs?: number): void;
  /** Where a looping track is, or was when it last left the slot. */
  positionOf(cue: string): number | undefined;
  /** Whether `cue` is looping in the music slot now: the song the song reveal started, at GO. */
  isLooping?(cue: string): boolean;
  /** The music sounding now and where it is in its own file; see `AudioEngine.nowPlaying`. */
  nowPlaying?(): NowPlaying | undefined;
  /** Ends the music slot; given a cue, only while that cue holds it. */
  stop(cue?: string): void;
  /** One stretch of a track, once and unlooped, in the music slot. */
  playSection(cue: string, startMs: number, endMs: number): void;
  /**
   * Crossfades to a song's preview clip, played once to an echoing end, in the music slot's place:
   * the first preview ends whatever the slot held (the menu theme).
   */
  playPreview?(alias: string): void;
  /** Fades the preview out. */
  stopPreview?(): void;
  /** Forgets a decoded clip the song step paged away from, unless it is sounding. */
  releaseTrack?(alias: string): void;
  /** One effect or interface sound, de-duplicated by its authoritative event. */
  cue(alias: string, options: CueOptions): void;
  /**
   * Silences the cues of events whose ID starts with `prefix` that have been
   * scheduled and not yet begun. A line already speaking finishes; the ones
   * queued behind it never sound. For a countdown the room called off.
   */
  cancelPending?(prefix: string): void;
  /**
   * Stops the cues of events whose ID starts with `prefix` at once: the line
   * speaking now as well as the ones queued behind it. For a countdown the
   * player walked away from (they left the room) or the room called off.
   */
  stopCues?(prefix: string): void;
  /**
   * Loops an ambient bed under everything else, at `gain` against the usual
   * bed level; asking again for the same bed is a no-op.
   */
  playBed?(alias: string, gain?: number): void;
  /** Ends the ambient bed; given an alias, only while that bed holds the slot. */
  stopBed?(alias?: string): void;
  /** Holds the climb's drone at `level` of full, played at `rate`; see `AudioEngine.setDrone`. */
  setDrone?(alias: string, level: number, rate?: number): void;
  /** Ends the climb's drone at once. */
  stopDrone?(): void;
  setMuted(muted: boolean): void;
  /** Silences the master while another window has focus; apart from the player's mute. */
  setUnfocused?(unfocused: boolean): void;
  /** The music bus level. */
  setMusicGain(gain: number): void;
  /**
   * The music's low-pass cutoff in hertz, which the climb's momentum drives:
   * muffled at the bottom of an ascent, open at the top.
   */
  setMusicCutoff(hz: number): void;
  /** Slows the song for the finish (race-flow spec §5.2); 1 is full speed. */
  slowMusic?(scale: number): void;
  /**
   * The replay's song rate (race-options spec §7.2): 0.25 to 2, applied at
   * once and kept for the next track until set back to 1. `slowMusic` stays
   * the finish's, with its filter, and multiplies under it.
   */
  setMusicRate?(rate: number): void;
  /** The player's own volume for a bus, from settings, on top of the mix. */
  setPlayerVolume(bus: Bus, value: number): void;
  /** Eases the mix into one of its snapshots; see `MIXES`. */
  setMix?(name: MixName): void;
  /** Survival's danger, 0 to 1: the lava's rumble and the music closing; see `DANGER_RUMBLE_GAIN`. */
  setDanger?(level: number): void;
  /** This frame of the music, or `undefined` with no graph or no analyser. */
  musicSpectrum?(): MusicSpectrum | undefined;
  /**
   * The mix as a stream, for recording the race (unlockables spec §6.1): a tap
   * beside the speakers, so what is heard does not change. `undefined` with no
   * graph yet, or a graph that cannot make one.
   */
  captureStream?(): { stream: MediaStream; release(): void } | undefined;
}
