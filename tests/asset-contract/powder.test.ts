/**
 * The powdery finish, ported from the AutomataEngine sprite pipeline
 * (tools/sprite-morph.ts, commit c55e74f): a whole-image 2x2 OPEN then CLOSE
 * over every RGBA channel, then orphan-diagonal cleanup. These are that
 * repository's cases, on pngjs.
 */
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { powderFinish, powderFinishAtGrid, powderFinishFrames, powderFinishTiled } from "../../packages/asset-contract/tools/powder";

function field(width = 8): PNG {
  const png = new PNG({ width, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([50, 80, 110, 255], i);
  return png;
}

describe("the powdery finish", () => {
  it("removes a small highlight even when its colour belongs to another run", () => {
    const input = field();
    input.data.set([200, 210, 220, 255], (3 * 8 + 3) * 4);
    expect(powderFinish(input, 8).data).toEqual(field().data);
    // The input is left as it was, for a before/after comparison.
    expect(input.data[(3 * 8 + 3) * 4]).toBe(200);
  });

  it("fills a one-pixel dark hole", () => {
    const input = field();
    input.data.set([0, 0, 0, 255], (3 * 8 + 3) * 4);
    expect(powderFinish(input, 8).data).toEqual(field().data);
  });

  it("preserves a broad colour edge and a two-pixel bar without translation", () => {
    for (const right of [5, 8]) {
      const input = field();
      for (let y = 0; y < 8; y++) for (let x = 3; x < right; x++) input.data.set([200, 210, 220, 255], (y * 8 + x) * 4);
      expect(powderFinish(input, 8).data).toEqual(input.data);
    }
  });

  it("never reads a neighbouring cell", () => {
    const input = field(16);
    for (let y = 0; y < 8; y++) for (let x = 8; x < 16; x++) input.data.set([0, 0, 0, 0], (y * 16 + x) * 4);
    const output = powderFinish(input, 8);
    for (let y = 0; y < 8; y++) {
      expect([...output.data.subarray(y * 64, y * 64 + 32)]).toEqual([...field().data.subarray(0, 32)]);
      expect([...output.data.subarray(y * 64 + 32, (y + 1) * 64)]).toEqual(new Array(32).fill(0));
    }
  });

  it("simplifies alpha too, removing isolated features and clearing hidden RGB", () => {
    const input = field();
    for (let i = 3; i < input.data.length; i += 4) input.data[i] = 0;
    input.data.set([200, 210, 220, 255], (3 * 8 + 3) * 4);
    expect([...powderFinish(input, 8).data]).toEqual(new Array(input.data.length).fill(0));
  });

  it("rejects partial alpha and a cell that does not divide the width", () => {
    const input = field();
    expect(() => powderFinish(input, 3)).toThrow(/cell/);
    input.data[3] = 127;
    expect(() => powderFinish(input, 8)).toThrow(/alpha/);
  });
});

describe("the powdery finish on a snapped plate", () => {
  /** An 16x16 field on a 2-pixel grid, with one art pixel (a 2x2 block) of highlight. */
  it("removes a lone art pixel that the output-pixel finish would keep", () => {
    const input = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < input.data.length; i += 4) input.data.set([50, 80, 110, 255], i);
    for (const [x, y] of [[6, 6], [7, 6], [6, 7], [7, 7]] as const) input.data.set([200, 210, 220, 255], (y * 16 + x) * 4);
    const plain = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < plain.data.length; i += 4) plain.data.set([50, 80, 110, 255], i);
    expect([...powderFinish(input).data]).toEqual([...input.data]);
    expect([...powderFinishAtGrid(input, 2).data]).toEqual([...plain.data]);
  });

  it("keeps a two-art-pixel bar, unmoved", () => {
    const input = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < input.data.length; i += 4) input.data.set([50, 80, 110, 255], i);
    for (let y = 0; y < 16; y++) for (let x = 6; x < 10; x++) input.data.set([200, 210, 220, 255], (y * 16 + x) * 4);
    expect([...powderFinishAtGrid(input, 2).data]).toEqual([...input.data]);
  });
});

describe("the powdery finish on a sprite sheet", () => {
  /** A 16x16 sheet of four 8x8 frames, each the plain field. */
  function sheet(): PNG {
    const png = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < png.data.length; i += 4) png.data.set([50, 80, 110, 255], i);
    return png;
  }

  it("finishes each frame alone, reading nothing across a frame's edges in either direction", () => {
    const input = sheet();
    // The bottom-right frame is empty; the frames above it and beside it are not.
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) input.data.set([0, 0, 0, 0], (y * 16 + x) * 4);
    const output = powderFinishFrames(input, 8);
    for (const [fx, fy] of [[0, 0], [8, 0], [0, 8], [8, 8]] as const) {
      const frame = new PNG({ width: 8, height: 8 });
      for (let y = 0; y < 8; y++) input.data.copy(frame.data, y * 32, ((fy + y) * 16 + fx) * 4, ((fy + y) * 16 + fx + 8) * 4);
      const alone = powderFinish(frame);
      for (let y = 0; y < 8; y++) {
        expect([...output.data.subarray(((fy + y) * 16 + fx) * 4, ((fy + y) * 16 + fx + 8) * 4)]).toEqual([...alone.data.subarray(y * 32, (y + 1) * 32)]);
      }
    }
  });

  it("puts back the pixels a sprite cannot lose, as they were, and finishes the rest", () => {
    const input = sheet();
    const eye = (3 * 16 + 3) * 4;
    const speck = (3 * 16 + 11) * 4;
    input.data.set([255, 255, 255, 255], eye);
    input.data.set([200, 210, 220, 255], speck);
    const output = powderFinishFrames(input, 8, (r, g, b) => r === 255 && g === 255 && b === 255);
    expect([...output.data.subarray(eye, eye + 4)]).toEqual([255, 255, 255, 255]);
    expect([...output.data.subarray(speck, speck + 4)]).toEqual([50, 80, 110, 255]);
    // The input is left as it was.
    expect(input.data[speck]).toBe(200);
  });

  it("rejects a frame that does not divide the sheet", () => {
    expect(() => powderFinishFrames(sheet(), 6)).toThrow(/frame/);
  });
});

describe("the powdery finish on a seamless tile", () => {
  /** A 16x16 tile on a 2-pixel grid. */
  function tile(): PNG {
    const png = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < png.data.length; i += 4) png.data.set([50, 80, 110, 255], i);
    return png;
  }
  const paint = (png: PNG, x: number, y: number): void => {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) png.data.set([200, 210, 220, 255], ((y + dy) * 16 + x + dx) * 4);
  };

  it("keeps a two-art-pixel bar that the tile's edge cuts in half, as its neighbour in the repeat sees it", () => {
    const input = tile();
    // One art pixel at each end of every row: across the repeat, one bar two art pixels wide.
    for (let y = 0; y < 16; y += 2) {
      paint(input, 0, y);
      paint(input, 14, y);
    }
    expect([...powderFinishTiled(input, 2).data]).toEqual([...input.data]);
    // Without the wrap, each half is one art pixel wide and goes.
    expect([...powderFinishAtGrid(input, 2).data]).not.toEqual([...input.data]);
  });

  it("removes a lone art pixel in a corner, which a bare edge would shelter", () => {
    const input = tile();
    paint(input, 0, 0);
    expect([...powderFinishTiled(input, 2).data]).toEqual([...tile().data]);
  });
});
