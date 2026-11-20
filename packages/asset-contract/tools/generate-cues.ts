/**
 * `pnpm assets:cues`.
 *
 * Synthesises the essential cue set.
 *
 * **Why drafted rather than generated.** The same reason the cloud band and the
 * sun are drawn from code: these are shapes, not performances. A landing is a
 * pitched thump forty milliseconds long, a focus tick is a click, a countdown
 * is three of one note and one of another a fifth above it. Asked for any of
 * them a generator returns a recording of a room, and what this game needs is
 * the shape with nothing else in it. Every cue here is a handful of numbers a
 * reviewer can change and hear the consequence of.
 *
 * **Why they are tuned to the song.** The stage track is 146 BPM in a minor
 * key, and a cue that lands a semitone outside it reads as a mistake however
 * well it is mixed. The pitched cues take their notes from one scale, declared
 * once below, so the mix is in tune by construction rather than by ear.
 *
 * **Synthesised here, declared when used.** This tool writes the whole set; the
 * manifest carries only the cues the game currently asks for. An asset in the
 * manifest is downloaded, validated and reviewed as though it were in the game,
 * and `asset-contract.test.ts` refuses one nothing addresses -- so a cue waits
 * here until the step that triggers it lands, rather than shipping as a file
 * nobody plays. The interface, error, accent and speculative contact
 * cues are all in that state today. `ui.unlock`, the NEW SONG and NEW
 * CHALLENGER sting, is synthesised here too when phase 6's Task 12 first plays
 * it (Wonder spec §3.1): no game sound is a recording but the announcer's.
 *
 * **Deterministic.** Noise comes from a seeded generator, so a regeneration is
 * byte-identical and never shows up as a diff. Output is 48 kHz mono 16-bit
 * WAV: uncompressed, because a forty-millisecond cue compresses to nothing and
 * a codec would add its own priming to a sound whose whole job is to be
 * immediate.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(import.meta.dirname, "..", "assets", "production", "cues");
const RATE = 48_000;

/**
 * The scale the pitched cues draw from.
 *
 * A minor pentatonic rooted two octaves above the track's own root. Pentatonic
 * because it has no semitone steps: any two of these notes sounded together or
 * in sequence agree, which is what lets a landing cue fire at an arbitrary
 * moment against a running track without ever clashing with it.
 */
const ROOT = 220; // A3
const SCALE = [0, 3, 5, 7, 10].map((semitones) => ROOT * 2 ** (semitones / 12));

const note = (degree: number, octave = 0): number =>
  SCALE[((degree % SCALE.length) + SCALE.length) % SCALE.length]! * 2 ** octave;

/** A small deterministic generator, so noise is the same noise every run. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state;
    value ^= value >>> 16;
    value = Math.imul(value, 0x85ebca6b);
    value ^= value >>> 13;
    value = Math.imul(value, 0xc2b2ae35);
    value ^= value >>> 16;
    return (value >>> 0) / 0x100000000 - 0.5;
  };
}

/**
 * `bright` is white noise differentiated, which tilts it six decibels an
 * octave upward.
 *
 * Plain white noise under a short envelope reads as a puff of air. The tilt
 * moves its energy into the range a transient actually lives in, and that is
 * most of the difference between a cue that sounds like a thud and one that
 * sounds like a hit.
 */
type Shape = "sine" | "triangle" | "square" | "saw" | "noise" | "bright";

type Voice = {
  readonly shape: Shape;
  /** Start and end frequency; a sweep between them reads as a gesture. */
  readonly from: number;
  readonly to?: number;
  readonly startMs?: number;
  readonly lengthMs: number;
  readonly attackMs?: number;
  readonly level?: number;
  readonly seed?: number;
  /** Decay steepness. Higher is shorter; 4.6 reaches 1% over the voice. */
  readonly curve?: number;
};

const wave = (
  shape: Shape,
  phase: number,
  random: () => number,
  previous: { noise: number },
): number => {
  switch (shape) {
    case "sine":
      return Math.sin(phase * Math.PI * 2);
    case "triangle":
      return 4 * Math.abs(phase - Math.floor(phase + 0.5)) - 1;
    case "square":
      return phase % 1 < 0.5 ? 1 : -1;
    // Odd and even harmonics both, which is what gives a body its bite where a
    // triangle only gives it a pitch.
    case "saw":
      return 2 * (phase - Math.floor(phase + 0.5));
    case "noise":
      return random() * 2;
    case "bright": {
      const sample = random() * 2;
      const tilted = sample - previous.noise;
      previous.noise = sample;
      return tilted;
    }
  }
};

/**
 * Renders one cue.
 *
 * Every voice gets a short attack and an exponential decay. Exponential rather
 * than linear because that is how a struck object actually behaves, and a
 * linear release on a forty-millisecond transient reads as a cut tape.
 */
function render(voices: readonly Voice[]): Float64Array {
  const totalMs = Math.max(...voices.map((v) => (v.startMs ?? 0) + v.lengthMs));
  const samples = new Float64Array(Math.ceil((totalMs / 1000) * RATE));

  for (const voice of voices) {
    const random = createRandom(voice.seed ?? 0x51f7);
    const start = Math.floor(((voice.startMs ?? 0) / 1000) * RATE);
    const length = Math.floor((voice.lengthMs / 1000) * RATE);
    // Sub-millisecond by default. An attack a player can hear the rise of is
    // an attack that reads as soft, and nothing in a fighting game's cue set
    // is soft: the sound is already at full level by the time it registers.
    const attack = Math.max(1, Math.floor(((voice.attackMs ?? 0.3) / 1000) * RATE));
    const level = voice.level ?? 1;
    const curve = voice.curve ?? 4.6;
    let phase = 0;
    const previous = { noise: 0 };

    for (let index = 0; index < length; index += 1) {
      const at = start + index;
      if (at >= samples.length) break;

      const through = index / length;
      const swept =
        voice.to === undefined ? voice.from : voice.from + (voice.to - voice.from) * through;
      phase += swept / RATE;

      const rise = Math.min(1, index / attack);
      // Steeper than a natural decay. A cue that rings is a cue still sounding
      // when the next one fires, and a climb produces a landing every second:
      // the set has to clear itself out of the way.
      const fall = Math.exp(-curve * through);
      samples[at]! += wave(voice.shape, phase, random, previous) * level * rise * fall;
    }
  }

  return samples;
}

/**
 * Depth, from taps rather than from a reverb.
 *
 * A short cue with nothing after it reads as flat however bright it is: the ear
 * takes the absence of a tail to mean the sound happened nowhere. Arcade and
 * fighting-game cues of this era got their space from a slapback -- a handful
 * of discrete repeats close together, each quieter and each slightly shorter
 * than the last -- rather than from a real room, and that is what this is.
 *
 * Taps are spread by a widening interval rather than an even one. Even repeats
 * read as a delay effect; an interval that grows reads as a space, because a
 * real reflection field gets denser and later at once.
 *
 * Each tap is also rolled off against the one before it, so the tail darkens as
 * it recedes. A slapback that keeps the transient in every repeat sounds like
 * four hits rather than one hit in a room.
 */
type Echo = { readonly taps: number; readonly timeMs: number; readonly decay: number };

function applyEcho(samples: Float64Array, echo: Echo): Float64Array {
  const spread = 1.35;
  let offsetMs = echo.timeMs;
  let level = echo.decay;

  let longest = 0;
  for (let tap = 0; tap < echo.taps; tap += 1) {
    longest = Math.max(longest, offsetMs);
    offsetMs *= spread;
  }

  const out = new Float64Array(samples.length + Math.ceil((longest / 1000) * RATE) + 1);
  out.set(samples);

  offsetMs = echo.timeMs;
  level = echo.decay;
  for (let tap = 0; tap < echo.taps; tap += 1) {
    const offset = Math.floor((offsetMs / 1000) * RATE);
    // A one-pole low pass per tap: the tail loses its edge as it recedes.
    let carried = 0;
    const smoothing = 0.45 + tap * 0.12;
    for (let index = 0; index < samples.length; index += 1) {
      carried += (samples[index]! - carried) * (1 - Math.min(0.9, smoothing));
      out[index + offset]! += carried * level;
    }
    offsetMs *= spread;
    level *= echo.decay;
  }

  return out;
}

/**
 * 0.7 (−3.1 dBFS): the level the mix was tuned against before phase 6 lifted
 * it to −1 dBFS, which made every landing harsher (Wonder spec §3.3). The
 * climb drone shares it: `DRONE_GAIN` in the client is set against this file.
 */
const SYNTH_PEAK = 0.7;

/** Normalises to a headroom and writes a 16-bit mono WAV. */
function write(name: string, samples: Float64Array, peak = SYNTH_PEAK): number {
  const loudest = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const gain = loudest === 0 ? 0 : peak / loudest;

  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]! * gain));
    data.writeInt16LE(Math.round(clamped * 32_767), index * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  writeFileSync(resolve(OUT, `${name}.wav`), Buffer.concat([header, data]));
  return Math.round((samples.length / RATE) * 1000);
}

/**
 * The set, and what each one is for.
 *
 * Landing has three variants. One landing sound repeated twenty times up a
 * climb stops being information and becomes a metronome; three that differ only
 * in pitch keep it reading as the same action without the repetition wearing.
 */
type Cue = { readonly voices: readonly Voice[]; readonly echo?: Echo };

const CUES: Record<string, Cue> = {
  // Every impact is the same three-part shape: a bright tick that arrives
  // first and is gone in five milliseconds, a saw body that carries the pitch,
  // and a fast sweep down through it. The tick is what the ear times the event
  // by; the body is what tells it what was hit.
  "sfx.landLow": { echo: { taps: 3, timeMs: 38, decay: 0.34 }, voices: [
    { shape: "bright", from: 0, lengthMs: 6, level: 0.9, curve: 9 },
    { shape: "saw", from: note(0) * 2, to: note(0) * 0.9, lengthMs: 55, level: 0.55, curve: 7 },
    { shape: "square", from: note(0), to: note(0) * 0.8, lengthMs: 45, level: 0.28, curve: 7 },
    ] },
  "sfx.landMid": { echo: { taps: 3, timeMs: 36, decay: 0.34 }, voices: [
    { shape: "bright", from: 0, lengthMs: 6, level: 0.9, curve: 9, seed: 0x2b },
    { shape: "saw", from: note(2) * 2, to: note(2) * 0.9, lengthMs: 52, level: 0.55, curve: 7 },
    { shape: "square", from: note(2), to: note(2) * 0.8, lengthMs: 42, level: 0.28, curve: 7 },
    ] },
  "sfx.landHigh": { echo: { taps: 3, timeMs: 34, decay: 0.34 }, voices: [
    { shape: "bright", from: 0, lengthMs: 5, level: 0.9, curve: 9, seed: 0x3c },
    { shape: "saw", from: note(4) * 2, to: note(4) * 0.9, lengthMs: 48, level: 0.55, curve: 7 },
    { shape: "square", from: note(4), to: note(4) * 0.8, lengthMs: 40, level: 0.28, curve: 7 },
    ] },

  // The speculative contact tick: the transient alone, with no body at all.
  // It says "something happened here" and deliberately not what, because at
  // the moment it plays the server has not yet agreed that anything did.
  "sfx.contact": { voices: [
    { shape: "bright", from: 0, lengthMs: 4, level: 0.55, curve: 10 },
    { shape: "sine", from: note(1, 2), lengthMs: 18, level: 0.3, curve: 9 },
    ] },

  // Falling, and the recovery from it. Down for the loss.
  "sfx.reset": { echo: { taps: 3, timeMs: 70, decay: 0.3 }, voices: [
    { shape: "bright", from: 0, lengthMs: 8, level: 0.5, curve: 8, seed: 0x4d },
    { shape: "saw", from: note(3), to: note(0) / 2, lengthMs: 190, level: 0.45, curve: 5 },
    ] },

  // Three counts and a go, a fifth above them, so the start is heard as an
  // arrival rather than as a fourth count.
  "sfx.countdown": { voices: [
    { shape: "bright", from: 0, lengthMs: 4, level: 0.5, curve: 10 },
    { shape: "square", from: note(0, 1), lengthMs: 70, level: 0.5, curve: 6 },
    ] },
  "sfx.countdownGo": { echo: { taps: 4, timeMs: 95, decay: 0.42 }, voices: [
    { shape: "bright", from: 0, lengthMs: 6, level: 0.8, curve: 9 },
    { shape: "saw", from: note(3, 1), lengthMs: 140, level: 0.6, curve: 5 },
    { shape: "square", from: note(0, 2), lengthMs: 150, level: 0.3, curve: 5, startMs: 8 },
    ] },

  // A lap is an achievement inside a race; a finish is the end of one. Each
  // note keeps its own tick, so a run of them reads as struck rather than as
  // a melody fading in.
  "sfx.lap": { echo: { taps: 3, timeMs: 110, decay: 0.38 }, voices: [
    { shape: "bright", from: 0, lengthMs: 4, level: 0.5, curve: 10 },
    { shape: "saw", from: note(0, 1), lengthMs: 90, level: 0.5, curve: 6 },
    { shape: "bright", from: 0, lengthMs: 4, level: 0.5, curve: 10, startMs: 85, seed: 0x5e },
    { shape: "saw", from: note(2, 1), lengthMs: 150, level: 0.5, curve: 5, startMs: 85 },
    ] },
  "sfx.finish": { echo: { taps: 4, timeMs: 130, decay: 0.45 }, voices: [
    { shape: "bright", from: 0, lengthMs: 4, level: 0.5, curve: 10 },
    { shape: "saw", from: note(0, 1), lengthMs: 95, level: 0.5, curve: 6 },
    { shape: "bright", from: 0, lengthMs: 4, level: 0.5, curve: 10, startMs: 90, seed: 0x6f },
    { shape: "saw", from: note(2, 1), lengthMs: 95, level: 0.5, curve: 6, startMs: 90 },
    { shape: "bright", from: 0, lengthMs: 4, level: 0.5, curve: 10, startMs: 180, seed: 0x7a },
    { shape: "saw", from: note(4, 1), lengthMs: 95, level: 0.5, curve: 6, startMs: 180 },
    { shape: "bright", from: 0, lengthMs: 6, level: 0.8, curve: 9, startMs: 270, seed: 0x8b },
    { shape: "saw", from: note(0, 2), lengthMs: 340, level: 0.65, curve: 4, startMs: 270 },
    ] },

  // Phrase accents, for the beat clock to place. Quiet and bright rather than
  // quiet and dull: it marks the music without competing with the cues that
  // report the race.
  "sfx.accent": { echo: { taps: 2, timeMs: 85, decay: 0.3 }, voices: [
    { shape: "bright", from: 0, lengthMs: 3, level: 0.3, curve: 11 },
    { shape: "sine", from: note(4, 2), lengthMs: 90, level: 0.22, curve: 7 },
    ] },

  // Interface. A tick to move and a brighter pair to commit.
  "ui.focus": { voices: [
    { shape: "bright", from: 0, lengthMs: 3, level: 0.4, curve: 11 },
    { shape: "square", from: note(2, 2), lengthMs: 16, level: 0.28, curve: 9 },
    ] },
  "ui.activate": { voices: [
    { shape: "bright", from: 0, lengthMs: 4, level: 0.55, curve: 10 },
    { shape: "square", from: note(2, 2), lengthMs: 28, level: 0.4, curve: 8 },
    { shape: "square", from: note(4, 2), lengthMs: 45, level: 0.4, curve: 7, startMs: 26 },
    ] },

  // A refusal, which is the one cue allowed to be dissonant: it is the only
  // moment the game says no, and agreeing with the music would soften it.
  "sfx.error": { echo: { taps: 2, timeMs: 55, decay: 0.3 }, voices: [
    { shape: "bright", from: 0, lengthMs: 6, level: 0.5, curve: 9, seed: 0x9c },
    { shape: "saw", from: note(1) * 1.06, to: note(0), lengthMs: 150, level: 0.42, curve: 6 },
    ] },

  // Wonder's sounds (Wonder spec §3.1). One family with the landings: a bright
  // transient the ear times by, a body on the scale, a sweep, and the short
  // echo. `note(5)` wraps to `note(0)`, so anything higher takes the octave.
  "sfx.slam": { echo: { taps: 3, timeMs: 44, decay: 0.38 }, voices: [
    { shape: "bright", from: 0, lengthMs: 8, level: 1, curve: 8, seed: 0x5a },
    { shape: "noise", from: 0, lengthMs: 40, level: 0.35, curve: 9, seed: 0x5b },
    { shape: "saw", from: note(0), to: note(0) * 0.45, lengthMs: 110, level: 0.6, curve: 5 },
    { shape: "square", from: note(0) * 0.5, to: note(0) * 0.35, lengthMs: 90, level: 0.4, curve: 5 },
    ] },
  "sfx.wrap": { echo: { taps: 2, timeMs: 30, decay: 0.3 }, voices: [
    { shape: "bright", from: 0, lengthMs: 4, level: 0.6, curve: 10, seed: 0x61 },
    { shape: "square", from: note(0, 1), to: note(3, 2), lengthMs: 70, level: 0.35, curve: 4 },
    ] },
  // Survival's lava (lava spec §5): a soft hiss as a racer dips in. Tilted
  // noise let go slowly over a low sine that sags, so it reads as heat and not
  // a hit. No boom: the fall-off owns the drop.
  "sfx.sizzle": { echo: { taps: 2, timeMs: 36, decay: 0.28 }, voices: [
    { shape: "bright", from: 0, lengthMs: 260, level: 0.3, curve: 3, seed: 0x71 },
    { shape: "noise", from: 0, lengthMs: 200, level: 0.18, curve: 4, seed: 0x72 },
    { shape: "sine", from: note(0) * 0.5, to: note(0) * 0.42, lengthMs: 140, level: 0.22, curve: 5 },
    ] },
  "ui.pop": { echo: { taps: 2, timeMs: 28, decay: 0.3 }, voices: [
    { shape: "bright", from: 0, lengthMs: 4, level: 0.7, curve: 10, seed: 0x62 },
    { shape: "sine", from: note(2, 2), to: note(2, 2) * 1.06, lengthMs: 45, level: 0.6, curve: 7 },
    ] },
  "ui.tick": { voices: [
    { shape: "bright", from: 0, lengthMs: 3, level: 0.8, curve: 11, seed: 0x63 },
    { shape: "square", from: note(4, 2), lengthMs: 12, level: 0.25, curve: 10 },
    ] },
  "ui.open": { echo: { taps: 2, timeMs: 32, decay: 0.3 }, voices: [
    { shape: "square", from: note(0, 1), lengthMs: 55, level: 0.4, curve: 6 },
    { shape: "square", from: note(2, 1), startMs: 50, lengthMs: 70, level: 0.4, curve: 6 },
    ] },
  "ui.close": { echo: { taps: 2, timeMs: 32, decay: 0.3 }, voices: [
    { shape: "square", from: note(2, 1), lengthMs: 55, level: 0.4, curve: 6 },
    { shape: "square", from: note(0, 1), startMs: 50, lengthMs: 70, level: 0.4, curve: 6 },
    ] },
  "ui.copied": { echo: { taps: 2, timeMs: 30, decay: 0.3 }, voices: [
    { shape: "square", from: note(0, 1), lengthMs: 45, level: 0.35, curve: 6 },
    { shape: "square", from: note(2, 1), startMs: 45, lengthMs: 45, level: 0.35, curve: 6 },
    { shape: "square", from: note(4, 1), startMs: 90, lengthMs: 80, level: 0.4, curve: 6 },
    ] },
  "sfx.bounce": { voices: [
    { shape: "bright", from: 0, lengthMs: 3, level: 0.5, curve: 11, seed: 0x64 },
    { shape: "sine", from: note(0, 1) * 1.1, to: note(0, 1), lengthMs: 30, level: 0.45, curve: 8 },
    ] },
  "sfx.wordPop": { echo: { taps: 2, timeMs: 30, decay: 0.32 }, voices: [
    { shape: "bright", from: 0, lengthMs: 5, level: 0.8, curve: 9, seed: 0x65 },
    { shape: "saw", from: note(4, 1), to: note(4, 1) * 1.04, lengthMs: 60, level: 0.4, curve: 6 },
    { shape: "square", from: note(4), lengthMs: 50, level: 0.3, curve: 6 },
    ] },
  // One note the client pitches per streak step by playback rate (race-cues.ts).
  "sfx.streakStep": { echo: { taps: 2, timeMs: 30, decay: 0.3 }, voices: [
    { shape: "bright", from: 0, lengthMs: 4, level: 0.7, curve: 10, seed: 0x66 },
    { shape: "square", from: note(0, 1), lengthMs: 70, level: 0.45, curve: 6 },
    ] },
  "sfx.stamp": { echo: { taps: 3, timeMs: 40, decay: 0.36 }, voices: [
    { shape: "bright", from: 0, lengthMs: 6, level: 1, curve: 8, seed: 0x67 },
    { shape: "saw", from: note(0, 1), lengthMs: 140, level: 0.45, curve: 4 },
    { shape: "saw", from: note(2, 1), lengthMs: 140, level: 0.35, curve: 4 },
    { shape: "square", from: note(4, 1), lengthMs: 140, level: 0.3, curve: 4 },
    ] },
  "sfx.whoops": { echo: { taps: 2, timeMs: 34, decay: 0.3 }, voices: [
    { shape: "square", from: note(4, 1), to: note(1, 1), lengthMs: 90, level: 0.4, curve: 4 },
    { shape: "square", from: note(1, 1), startMs: 90, to: note(0), lengthMs: 120, level: 0.35, curve: 4 },
    ] },
};

/**
 * The climb's drone: a loop, not a cue, so it is built differently.
 *
 * The top of the race should be felt more than heard, so this lives under
 * the vintage band's floor -- the runtime plays it around the stage, as it
 * does the ambient bed -- and it is the one sound here with no transient at
 * all. An engine hum on the root and its fifth: two saws a hair apart on A,
 * so the floor slowly churns rather than sits, and one on E above them,
 * darkened until only the body is left. The runtime bends it up as the
 * climb peaks; the file is the hum at rest.
 *
 * Seamless by construction. Every frequency is snapped to a whole number of
 * cycles in the loop, and a second rendered past the end is folded over the
 * start with an equal-power crossfade, so the filter's settling and the
 * chorus both wrap without a seam.
 */
const DRONE_SECONDS = 10;

function renderDrone(): Float64Array {
  const loop = DRONE_SECONDS * RATE;
  const total = loop + RATE;
  const snap = (hz: number) => Math.round(hz * DRONE_SECONDS) / DRONE_SECONDS;
  const saws = [
    { hz: note(0) / 4, level: 0.5 },
    { hz: (note(0) / 4) * 1.004, level: 0.4 },
    { hz: note(3) / 4, level: 0.3 },
  ].map((voice) => ({ ...voice, hz: snap(voice.hz) }));

  // A two-pole low pass at 140 Hz, a little resonant (RBJ, Q 0.9).
  const w = (2 * Math.PI * 140) / RATE;
  const alpha = Math.sin(w) / (2 * 0.9);
  const a0 = 1 + alpha;
  const b0 = (1 - Math.cos(w)) / 2 / a0;
  const b1 = (1 - Math.cos(w)) / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;

  const raw = new Float64Array(total);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let index = 0; index < total; index += 1) {
    let x = 0;
    for (const { hz, level } of saws) {
      const phase = (hz * index) / RATE;
      x += 2 * (phase - Math.floor(phase + 0.5)) * level;
    }
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    raw[index] = y;
  }

  const out = raw.slice(0, loop);
  for (let index = 0; index < RATE; index += 1) {
    const t = index / RATE;
    out[index] = raw[index]! * Math.sin((t * Math.PI) / 2) + raw[loop + index]! * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  process.stdout.write("synthesising cues:\n");
  for (const [alias, cue] of Object.entries(CUES)) {
    const name = alias.replace(".", "-");
    const rendered = render(cue.voices);
    const ms = write(name, cue.echo === undefined ? rendered : applyEcho(rendered, cue.echo));
    process.stdout.write(`  ${name}.wav (${ms}ms)\n`);
  }
  // The drone is a loop, not a one-shot, but it keeps the same peak: the level
  // `DRONE_GAIN` in the client was tuned against.
  process.stdout.write(`  ambience-climbDrone.wav (${write("ambience-climbDrone", renderDrone())}ms, loop)\n`);
  process.stdout.write("done\n");
}

main();
