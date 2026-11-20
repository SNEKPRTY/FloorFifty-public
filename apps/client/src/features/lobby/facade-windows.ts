/**
 * The menu building's lit windows, breathing.
 *
 * The facade under the racers' ledge (`MenuHero.svelte`) is a CSS background,
 * tiled from its right-hand corner, so its windows could not sit under the
 * city shader that makes the race's windows breathe. This lays a canvas over
 * it, one texel per facade texel and scaled up crisp, that redraws only the
 * window texels, each window at its step of the warm ramp (`window-breath.ts`)
 * on the clock and beat the menu's backdrop publishes.
 *
 * Every repeat of the tile is its own set of windows: they are coded across
 * the whole tiled building (`window-code.ts`), so two copies of one window do
 * not breathe in step.
 */

import { roleTint } from "@floor-fifty/asset-contract/roles";
import { codeWindows, WINDOW_CODE_STEPS } from "../render/window-code";
import { menuWindows, windowStep, type WindowStep } from "../render/window-breath";

type Pixels = Readonly<{ data: Uint8ClampedArray; width: number; height: number }>;
type Rgb = readonly [number, number, number];

const rgb = (color: number): Rgb => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];

/**
 * Which window each texel of a `cols` x `rows` building belongs to (0-63), or
 * -1 for wall, with `tile` repeated from the top right as the CSS draws it.
 */
export function tiledWindowIds(tile: Pixels, cols: number, rows: number, key: Rgb): Int8Array {
  const data = new Uint8ClampedArray(cols * rows * 4);
  for (let y = 0; y < rows; y += 1) {
    const ty = y % tile.height;
    for (let x = 0; x < cols; x += 1) {
      // Anchored right: the building's last column is the tile's last.
      const tx = tile.width - 1 - ((cols - 1 - x) % tile.width);
      const from = (ty * tile.width + tx) * 4;
      data.set(tile.data.subarray(from, from + 4), (y * cols + x) * 4);
    }
  }
  codeWindows(data, cols, rows, key);

  const ids = new Int8Array(cols * rows).fill(-1);
  for (let index = 0; index < ids.length; index += 1) {
    const at = index * 4;
    if (data[at + 3] === 0 || data[at] !== key[0]) continue;
    const green = data[at + 1]! - key[1];
    const blue = data[at + 2]! - key[2];
    if (green < 0 || blue < 0 || green >= WINDOW_CODE_STEPS || blue >= WINDOW_CODE_STEPS) continue;
    ids[index] = green * WINDOW_CODE_STEPS + blue;
  }
  return ids;
}

/**
 * The colour each step paints. `out` is the palette's ink, which is where the
 * race's palette lock folds the shader's dark window.
 */
function stepColours(): Record<WindowStep, Rgb> {
  return {
    dim: rgb(roleTint("cityWindowDim")),
    window: rgb(roleTint("cityWindow")),
    bright: rgb(roleTint("cityWindowBright")),
    hot: rgb(roleTint("cityWindowHot")),
    out: rgb(roleTint("cityNearEdge")),
  };
}

const IDS = WINDOW_CODE_STEPS * WINDOW_CODE_STEPS;

export function facadeWindows(node: HTMLElement, src: string): { destroy(): void } {
  let destroyed = false;
  let frame = 0;
  let tile: Pixels | undefined;
  let ids: Int8Array | undefined;
  let image: ImageData | undefined;
  let painted = "";
  const canvas = document.createElement("canvas");
  canvas.className = "ff-menu-facade__windows";
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("2d");
  const colours = stepColours();
  const key = colours.window;

  // Sized to the building in whole texels, at the scale the CSS draws the tile.
  const layout = (): void => {
    if (tile === undefined || context === null) return;
    const tileWidth = Number.parseFloat(getComputedStyle(node).backgroundSize);
    const scale = tileWidth / tile.width;
    if (!(scale > 0)) return;
    const cols = Math.ceil(node.clientWidth / scale);
    const rows = Math.ceil(node.clientHeight / scale);
    canvas.style.width = `${cols * scale}px`;
    canvas.style.height = `${rows * scale}px`;
    if (cols === canvas.width && rows === canvas.height && ids !== undefined) return;
    canvas.width = cols;
    canvas.height = rows;
    if (cols === 0 || rows === 0) {
      ids = undefined;
      return;
    }
    ids = tiledWindowIds(tile, cols, rows, key);
    image = context.createImageData(cols, rows);
    painted = "";
  };

  const paint = (): void => {
    frame = destroyed ? 0 : requestAnimationFrame(paint);
    if (ids === undefined || image === undefined || context === null) return;
    const lights = menuWindows();
    const steps: WindowStep[] = [];
    for (let id = 0; id < IDS; id += 1) {
      steps.push(lights === undefined ? "window" : windowStep(id, lights.seconds, lights.glow));
    }
    // Steps are swatches, so most frames change nothing and draw nothing.
    const signature = steps.join();
    if (signature === painted) return;
    painted = signature;
    const data = image.data;
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index]!;
      if (id < 0) continue;
      const [r, g, b] = colours[steps[id]!];
      const at = index * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  };

  const resized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(layout);

  // A test DOM has no 2D canvas; the facade's own windows then simply hold still.
  if (context !== null) {
    const source = new Image();
    source.onload = () => {
      if (destroyed) return;
      const read = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      if (read === null) return;
      read.canvas.width = source.naturalWidth;
      read.canvas.height = source.naturalHeight;
      read.drawImage(source, 0, 0);
      tile = read.getImageData(0, 0, source.naturalWidth, source.naturalHeight);
      node.append(canvas);
      layout();
      resized?.observe(node);
      frame = requestAnimationFrame(paint);
    };
    source.src = src;
  }

  return {
    destroy() {
      destroyed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      resized?.disconnect();
      canvas.remove();
    },
  };
}
