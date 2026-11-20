/**
 * The WAV a master arrives as, read and written without a dependency.
 *
 * RIFF/WAVE, PCM (8/16/24/32-bit) or IEEE float (32-bit). Enough for the song
 * intake to measure a master, cut its preview and check an encode against
 * it; nothing ships in this form.
 */

export type Wav = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  format: "pcm" | "float";
  frames: number;
  data: DataView;
};

export function readWav(bytes: Uint8Array): Wav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || text(0) !== "RIFF" || text(8) !== "WAVE") throw new Error("not a WAV: no RIFF/WAVE header");
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | undefined;
  let data: DataView | undefined;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = text(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      let format = view.getUint16(body, true);
      if (format === 0xfffe) format = view.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === "data") {
      data = new DataView(bytes.buffer, bytes.byteOffset + body, Math.min(size, bytes.length - body));
    }
    offset = body + size + (size % 2);
  }
  if (fmt === undefined || data === undefined) throw new Error("not a WAV: no fmt or data chunk");
  if (fmt.format !== 1 && fmt.format !== 3) throw new Error(`not a WAV this tool reads: format ${fmt.format}`);
  const frameBytes = (fmt.bits / 8) * fmt.channels;
  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bits,
    format: fmt.format === 3 ? "float" : "pcm",
    frames: Math.floor(data.byteLength / frameBytes),
    data,
  };
}

function sampleAt(wav: Wav, frame: number, channel: number): number {
  const bytes = wav.bitsPerSample / 8;
  const offset = (frame * wav.channels + channel) * bytes;
  if (wav.format === "float") return wav.data.getFloat32(offset, true);
  if (wav.bitsPerSample === 16) return wav.data.getInt16(offset, true) / 32768;
  if (wav.bitsPerSample === 24) {
    const value = wav.data.getUint8(offset) | (wav.data.getUint8(offset + 1) << 8) | (wav.data.getInt8(offset + 2) << 16);
    return value / 8388608;
  }
  if (wav.bitsPerSample === 32) return wav.data.getInt32(offset, true) / 2147483648;
  return (wav.data.getUint8(offset) - 128) / 128;
}

export function monoSamples(wav: Wav, startFrame = 0, endFrame = wav.frames): Float32Array {
  const from = Math.max(0, startFrame);
  const to = Math.min(wav.frames, endFrame);
  const out = new Float32Array(Math.max(0, to - from));
  for (let frame = from; frame < to; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < wav.channels; channel += 1) sum += sampleAt(wav, frame, channel);
    out[frame - from] = sum / wav.channels;
  }
  return out;
}

/** One channel's samples in `[startFrame, endFrame)`, for loudness and a stereo preview cut. */
export function channelSamples(wav: Wav, channel: number, startFrame = 0, endFrame = wav.frames): Float32Array {
  const from = Math.max(0, startFrame);
  const to = Math.min(wav.frames, endFrame);
  const out = new Float32Array(Math.max(0, to - from));
  for (let frame = from; frame < to; frame += 1) out[frame - from] = sampleAt(wav, frame, channel);
  return out;
}

export function writeWav(samples: Float32Array[], sampleRate: number): Uint8Array {
  const channels = samples.length;
  const frames = samples[0]?.length ?? 0;
  const dataBytes = frames * channels * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, text: string): void => {
    for (let i = 0; i < 4; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  put(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let frame = 0; frame < frames; frame += 1)
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.max(-1, Math.min(1, samples[channel]![frame]!));
      view.setInt16(44 + (frame * channels + channel) * 2, Math.round(value * 32767), true);
    }
  return bytes;
}

/**
 * How many samples `encode` lags `master` by, within `maxLag`: the best
 * cross-correlation of two seconds of each, from the first second on. The
 * measured beat describes the master; it describes the shipped file only if
 * the encode decodes to the same timing, as the slice review checked for
 * Chrome in the Rain.
 */
export function sampleOffset(master: Wav, encode: Wav, maxLag: number): number {
  const start = Math.min(master.sampleRate, Math.max(0, master.frames - 2 * master.sampleRate - maxLag));
  const span = Math.max(0, Math.min(2 * master.sampleRate, master.frames - start - maxLag));
  const a = monoSamples(master, start, start + span);
  // `b[k]` is the encode's frame `from + k`; `from` may be clamped at 0.
  const from = Math.max(0, start - maxLag);
  const b = monoSamples(encode, from, start + span + maxLag);
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = 0; i < span; i += 1) {
      const j = start + i + lag - from;
      if (j >= 0 && j < b.length) score += a[i]! * b[j]!;
    }
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}
