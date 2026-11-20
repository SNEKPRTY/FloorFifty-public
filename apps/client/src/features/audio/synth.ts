import type { AudioContextLike } from "./model";

/**
 * The vintage band: nothing under a small speaker's floor, nothing over what
 * an old DAC and a CRT's speaker let through.
 */
const VINTAGE_HIGHPASS_HZ = 160;
const VINTAGE_LOWPASS_HZ = 5_000;

/** How hard the soft clip leans on a full-scale peak; see `softClipCurve`. */
const VINTAGE_DRIVE = 1.5;

/**
 * How far past full scale the clip still shapes. A shaper only reads [-1, 1]
 * and holds its last value beyond, so the finish -- the fanfare, a crowd, a
 * call and their echoes at once -- would hit a flat wall. The signal is brought down
 * by this much going in and the curve spans it, so the sum rounds off smoothly
 * however many sounds pile up.
 */
const VINTAGE_HEADROOM = 2;

/** The hall's length and shape; see `hallImpulse`. */
const HALL_SECONDS = 2.4;
const HALL_PREDELAY_SECONDS = 0.022;
/** The rumble's loop, synthesized: long enough that its repeat is not heard. */
export const RUMBLE_SECONDS = 4;
/** The share of the rumble's buffer its loop crossfades over, and leaves out. */
export const RUMBLE_SEAM = 0.1;
/**
 * The hall's impulse response, synthesised rather than shipped.
 *
 * A room is noise that decays: a short pre-delay, a handful of discrete early
 * reflections off near walls, then a dense tail falling away exponentially. The
 * two channels draw different noise, which is what makes the tail wide. The
 * high end decays faster than the low -- a one-pole lowpass whose cutoff falls
 * over the tail -- because air eats treble, and a tail that stays bright reads
 * as a spring rather than a hall. Deterministic: the same seed, the same room.
 */
export function hallImpulse(
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer,
  sampleRate: number,
): AudioBuffer {
  const length = Math.round(HALL_SECONDS * sampleRate);
  const buffer = createBuffer(2, length, sampleRate);
  const predelay = Math.round(HALL_PREDELAY_SECONDS * sampleRate);
  const reflections = [0.011, 0.019, 0.029, 0.041, 0.053];
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let state = 0x9e3779b9 ^ (channel * 0x85ebca6b);
    const noise = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) / 0x100000000) * 2 - 1;
    };
    let lowpassed = 0;
    for (let i = predelay; i < length; i += 1) {
      const t = (i - predelay) / sampleRate;
      const progress = t / (HALL_SECONDS - HALL_PREDELAY_SECONDS);
      // -60 dB across the tail: ln(1000) ≈ 6.9.
      const envelope = Math.exp(-6.9 * progress);
      const damping = 0.85 - 0.7 * progress;
      lowpassed += damping * (noise() - lowpassed);
      data[i] = lowpassed * envelope;
    }
    for (const [index, at] of reflections.entries()) {
      const offset = predelay + Math.round((at + channel * 0.003) * sampleRate);
      if (offset < length) data[offset] = (data[offset] ?? 0) + (index % 2 === 0 ? 0.6 : -0.5) * (1 - index * 0.12);
    }
  }
  return buffer;
}

/**
 * The lava's rumble, synthesized rather than shipped, as the hall is: brown
 * noise (white noise integrated, so its energy falls with frequency), mono,
 * deterministic, and faded across its seam so the loop does not click.
 */
export function rumbleNoise(
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer,
  sampleRate: number,
): AudioBuffer {
  const length = Math.round(RUMBLE_SECONDS * sampleRate);
  const buffer = createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let state = 0x2545f491;
  let brown = 0;
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const white = ((state >>> 0) / 0x100000000) * 2 - 1;
    // Leaky, so it wanders without drifting off to a rail.
    brown = (brown + 0.02 * white) / 1.02;
    data[i] = brown * 3.5;
  }
  // The last stretch crossfaded into the first, and the loop ends where that
  // stretch begins: the sample after the loop's end is then the one the
  // start was faded from, so the repeat is seamless.
  const seam = Math.round(length * RUMBLE_SEAM);
  for (let i = 0; i < seam; i += 1) {
    const t = i / seam;
    data[i] = data[i]! * t + data[length - seam + i]! * (1 - t);
  }
  return buffer;
}

/**
 * The vintage stage, built into `output`: a high-pass and a low-pass for the
 * band, then a soft clip. Returns where a bus joins it, or `undefined` on a
 * graph that cannot build it -- every bus then goes straight out, unchanged.
 */
export function vintageStage(context: AudioContextLike, output: AudioNode): AudioNode | undefined {
  if (context.createBiquadFilter === undefined || context.createWaveShaper === undefined) return undefined;
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = VINTAGE_HIGHPASS_HZ;
  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = VINTAGE_LOWPASS_HZ;
  const headroom = context.createGain();
  headroom.gain.value = 1 / VINTAGE_HEADROOM;
  const clip = context.createWaveShaper();
  clip.curve = softClipCurve(2_048, VINTAGE_DRIVE, VINTAGE_HEADROOM);
  clip.oversample = "2x";
  highpass.connect(lowpass);
  lowpass.connect(headroom);
  headroom.connect(clip);
  clip.connect(output);
  return highpass;
}

/**
 * A `tanh` soft clip over a signal brought down by `headroom` on its way in,
 * scaled so a quiet signal comes out at unity: the ordinary level of a cue is
 * untouched, and only a peak near full scale is rounded off -- by
 * `tanh(drive) / drive`, about -4 dB at a drive of 1.5 -- the way an old output
 * stage gives a little rather than cracking. Nothing comes out louder than
 * `1 / drive`, however loud the sum going in.
 */
export function softClipCurve(length: number, drive: number, headroom = 1): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const x = ((i / (length - 1)) * 2 - 1) * headroom;
    curve[i] = Math.tanh(drive * x) / drive;
  }
  return curve;
}
