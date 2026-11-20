/**
 * Tempo and first beat, by the method `docs/art/exceptional-race-slice-review.md`
 * ("The song") recorded for Chrome in the Rain:
 *
 * 1. Onset envelope: log-magnitude spectral flux, 2048-sample window, 512
 *    hop, half-wave rectified and summed across bins.
 * 2. Tempo: the best beat-grid score over 70-190 BPM at 0.5 BPM, choosing the
 *    double when it scores nearly as well (the first pass on Chrome in the Rain
 *    locked to half tempo), then refined at 0.05 BPM around the winner.
 * 3. First beat: the phase of the best grid at that tempo, referred to the
 *    analysis window's centre.
 *
 * A beat's onset is a peak one or two frames wide, and a grid whose period is
 * not a whole number of frames falls between frames on most beats. Each grid
 * point therefore reads the larger of the two frames around it. Reading the
 * nearer frame alone lost enough of a 150 BPM click track's peaks that its
 * half tempo scored higher, and it measured 75.
 */

/** The simulation's tick rate (`TICK_HZ` in @floor-fifty/shared), restated: this package does not depend on shared. */
const TICK_HZ = 60;

export const ONSET = { window: 2048, hop: 512 } as const;
const MIN_BPM = 70;
const MAX_BPM = 190;
/** A double tempo wins when it scores at least this share of the base's score. */
const DOUBLE_SHARE = 0.9;

/** In-place radix-2 FFT over `re`/`im` of a power-of-two length. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size)
      for (let k = 0; k < size / 2; k += 1) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b]! * cos - im[b]! * sin;
        const ti = re[b]! * sin + im[b]! * cos;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
  }
}

export function onsetEnvelope(mono: Float32Array, sampleRate: number): { envelope: Float32Array; hopSeconds: number; windowSeconds: number } {
  const { window, hop } = ONSET;
  const frames = Math.max(0, Math.floor((mono.length - window) / hop) + 1);
  const envelope = new Float32Array(frames);
  const hann = Float64Array.from({ length: window }, (_unused, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (window - 1)));
  let previous = new Float64Array(window / 2);
  const re = new Float64Array(window);
  const im = new Float64Array(window);
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * hop;
    for (let i = 0; i < window; i += 1) {
      re[i] = mono[offset + i]! * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const current = new Float64Array(window / 2);
    let flux = 0;
    for (let bin = 0; bin < window / 2; bin += 1) {
      current[bin] = Math.log1p(Math.hypot(re[bin]!, im[bin]!));
      const rise = current[bin]! - previous[bin]!;
      if (rise > 0) flux += rise;
    }
    envelope[frame] = frame === 0 ? 0 : flux;
    previous = current;
  }
  return { envelope, hopSeconds: hop / sampleRate, windowSeconds: window / sampleRate };
}

/** The best mean envelope on a beat grid of this tempo, over every phase, relative to the envelope's mean. */
function gridScore(envelope: Float32Array, hopSeconds: number, bpm: number): { score: number; phase: number } {
  const period = 60 / bpm / hopSeconds;
  let mean = 0;
  for (const value of envelope) mean += value;
  mean = mean / Math.max(1, envelope.length) || 1;
  let best = { score: 0, phase: 0 };
  for (let phase = 0; phase < period; phase += 1) {
    let sum = 0;
    let count = 0;
    for (let at = phase; at < envelope.length; at += period) {
      sum += Math.max(envelope[Math.floor(at)] ?? 0, envelope[Math.ceil(at)] ?? 0);
      count += 1;
    }
    const score = sum / Math.max(1, count) / mean;
    if (score > best.score) best = { score, phase };
  }
  return best;
}

export function estimateBpm(envelope: Float32Array, hopSeconds: number): number {
  let best = { bpm: MIN_BPM, score: 0 };
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const { score } = gridScore(envelope, hopSeconds, bpm);
    if (score > best.score) best = { bpm, score };
  }
  // Half tempo scores as well as the true tempo on a grid of every other beat.
  const double = best.bpm * 2;
  if (double <= MAX_BPM && gridScore(envelope, hopSeconds, double).score >= best.score * DOUBLE_SHARE) best = { bpm: double, score: 0 };
  let refined = { bpm: best.bpm, score: 0 };
  for (let bpm = best.bpm - 1; bpm <= best.bpm + 1 + 1e-9; bpm += 0.05) {
    const { score } = gridScore(envelope, hopSeconds, bpm);
    if (score > refined.score) refined = { bpm, score };
  }
  return Math.round(refined.bpm * 100) / 100;
}

export function downbeatMs(envelope: Float32Array, hopSeconds: number, windowSeconds: number, bpm: number): number {
  const { phase } = gridScore(envelope, hopSeconds, bpm);
  const beatMs = 60000 / bpm;
  // Frame `phase` covers the window starting at phase * hop; its centre is the onset.
  const ms = (phase * hopSeconds + windowSeconds / 2) * 1000;
  return ms % beatMs;
}

export function msToTicks(ms: number): number {
  return Math.round((ms * TICK_HZ) / 1000);
}
