/**
 * A WebP's dimensions, from its header alone.
 *
 * Covers are the only WebP the art contract carries (they are smooth UI art,
 * not palette-locked world art), and the gate needs no decoder to check that
 * a file is the size its row says.
 */
export function webpSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 30) return undefined;
  const text = (offset: number, length: number): string => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = text(12, 4);
  const u24 = (offset: number): number => bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
  if (chunk === "VP8X") return { width: 1 + u24(24), height: 1 + u24(27) };
  if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return undefined;
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return undefined;
}
