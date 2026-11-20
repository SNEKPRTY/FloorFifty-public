/**
 * Integrated loudness, ITU-R BS.1770-4: K-weighting, 400 ms blocks at 75 %
 * overlap, an absolute gate at -70 LUFS and a relative gate 10 LU below. The
 * program's music target is -16 LUFS; this measures, it never adjusts.
 *
 * Measured on the master's samples, to two decimals. ffmpeg's `ebur128`
 * prints one decimal, and agrees with this to within 0.1 LU on every shipped
 * song.
 */

// K-weighting at 48 kHz, from the standard's tables.
const SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
const HIGHPASS = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] };

function biquad(input: Float32Array, { b, a }: { b: number[]; a: number[] }): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i]!;
    const y = b[0]! * x + b[1]! * x1 + b[2]! * x2 - a[0]! * y1 - a[1]! * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** The summed channel power of each block, K-weighted. */
function blockPowers(channels: readonly Float32Array[], sampleRate: number, blockMs: number, stepMs: number): number[] {
  if (sampleRate !== 48_000) throw new Error("loudness is measured at 48 kHz");
  const weighted = channels.map((channel) => biquad(biquad(channel, SHELF), HIGHPASS));
  const block = Math.round((blockMs / 1000) * sampleRate);
  const step = Math.round((stepMs / 1000) * sampleRate);
  const powers: number[] = [];
  for (let start = 0; start + block <= (weighted[0]?.length ?? 0); start += step) {
    let sum = 0;
    for (const channel of weighted) {
      let square = 0;
      for (let i = start; i < start + block; i += 1) square += channel[i]! * channel[i]!;
      sum += square / block;
    }
    powers.push(sum);
  }
  return powers;
}

const lufs = (power: number): number => -0.691 + 10 * Math.log10(power);
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

export function integratedLoudness(channels: readonly Float32Array[], sampleRate: number): number {
  const powers = blockPowers(channels, sampleRate, 400, 100).filter((power) => lufs(power) > -70);
  // Under one gated block (silence, or under 400 ms) there is no integrated
  // loudness; the manifest wants a negative number, and the floor is honest.
  if (powers.length === 0) return -70;
  const relative = lufs(mean(powers)) - 10;
  return Math.round(lufs(mean(powers.filter((power) => lufs(power) > relative))) * 100) / 100;
}

/**
 * Where the loudest `windowMs` begins, on whole seconds, clear of `avoid` when
 * given: the starting proposal for a results or a preview window.
 */
export function loudestWindowMs(
  channels: readonly Float32Array[],
  sampleRate: number,
  windowMs: number,
  avoid?: { startMs: number; endMs: number },
): number {
  const seconds = blockPowers(channels, sampleRate, 1000, 1000);
  const span = Math.round(windowMs / 1000);
  let best = 0;
  let bestSum = -Infinity;
  for (let start = 0; start + span <= seconds.length; start += 1) {
    if (avoid !== undefined && start * 1000 < avoid.endMs && (start + span) * 1000 > avoid.startMs) continue;
    const sum = seconds.slice(start, start + span).reduce((a, b) => a + b, 0);
    if (sum > bestSum) {
      bestSum = sum;
      best = start;
    }
  }
  return best * 1000;
}
