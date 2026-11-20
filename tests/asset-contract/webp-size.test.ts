import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { webpSize } from "../../packages/asset-contract/src/webp-size";

const PRODUCTION = resolve(import.meta.dirname, "../../packages/asset-contract/assets/production");

describe("webpSize", () => {
  it("reads a shipped cover's dimensions", () => {
    expect(webpSize(readFileSync(resolve(PRODUCTION, "covers/cover-moving-on-192.webp")))).toEqual({ width: 192, height: 192 });
    expect(webpSize(readFileSync(resolve(PRODUCTION, "covers/cover-moving-on-640.webp")))).toEqual({ width: 640, height: 640 });
  });

  it("reads each chunk kind", () => {
    const vp8x = new Uint8Array(30);
    vp8x.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8X")]);
    vp8x.set([191, 0, 0, 99, 0, 0], 24); // 192 x 100
    expect(webpSize(vp8x)).toEqual({ width: 192, height: 100 });

    const vp8l = new Uint8Array(30);
    vp8l.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8L")]);
    vp8l[20] = 0x2f;
    new DataView(vp8l.buffer).setUint32(21, (64 - 1) | ((32 - 1) << 14), true);
    expect(webpSize(vp8l)).toEqual({ width: 64, height: 32 });
  });

  it("refuses what is not a WebP", () => {
    expect(webpSize(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(webpSize(readFileSync(resolve(PRODUCTION, "splash.png")))).toBeUndefined();
  });
});
