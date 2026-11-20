/**
 * Client test environment.
 *
 * jsdom has no canvas implementation, and Pixi probes for one when its module
 * graph loads. The probe is harmless but noisy, so a WebGL request gets null
 * here, and a 2D one a context that only measures text. No test renders:
 * anything that would need a real context uses a fake stage instead.
 */

import { afterAll } from "vitest";

// jsdom starts its frame loop with whatever `setInterval` is global when the
// first frame is asked for. Pixi and Svelte keep jsdom's own
// `requestAnimationFrame`, so a frame they asked for under fake timers put the
// loop on the fake clock, and once real timers came back no frame in that file
// ever fired again. A frame here rides the real timers, taken before any test
// can fake them; while a test fakes timers, the global it calls is faked anyway.
// Like jsdom's loop, which stops when its window closes, no frame outlives the
// file: an animation that asks for its next frame after teardown would find no
// `requestAnimationFrame` and fail the run from outside any test.
if (typeof window !== "undefined") {
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);
  const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const pending = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const handle = realSetTimeout(() => {
      pending.delete(handle);
      if (!closed) callback(performance.now());
    }, 1000 / 60);
    pending.add(handle);
    return handle as unknown as number;
  };
  window.cancelAnimationFrame = (handle: number): void => {
    const timer = handle as unknown as ReturnType<typeof setTimeout>;
    pending.delete(timer);
    realClearTimeout(timer);
  };
  afterAll(() => {
    closed = true;
    for (const handle of pending) realClearTimeout(handle);
    pending.clear();
  });
}

// Pixi reads the 2D context's prototype for feature checks (letter spacing).
if (typeof window !== "undefined" && typeof globalThis.CanvasRenderingContext2D === "undefined") {
  globalThis.CanvasRenderingContext2D = class {} as never;
}

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
    return kind === "2d" ? measuringContext() : null;
  } as never;
}

/**
 * A 2D context that measures text and draws nothing: enough for Pixi to lay
 * out a `Text` (a name tag sizes its plate from its text's width). A glyph is
 * taken as 0.6 of the font size wide and the font as 0.8 / 0.2 of it above
 * and below the baseline; every drawing call is a no-op, and drawing an image
 * throws, so code that reads pixels back falls back as before.
 */
function measuringContext(): CanvasRenderingContext2D {
  let font = "10px sans-serif";
  const size = (): number => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const metrics = (text: string) => ({
    width: text.length * size() * 0.6,
    actualBoundingBoxAscent: size() * 0.8,
    actualBoundingBoxDescent: size() * 0.2,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: text.length * size() * 0.6,
    fontBoundingBoxAscent: size() * 0.8,
    fontBoundingBoxDescent: size() * 0.2,
  });
  const target: Record<string, unknown> = {
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
    measureText: metrics,
    // Pixel work (haze, LCD rewrites) reads an image back; with nothing drawn
    // there is nothing to read, so it fails as an unreadable source would.
    drawImage: () => {
      throw new Error("the test canvas draws no images");
    },
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(Math.max(1, width * height * 4)),
    }),
  };
  return new Proxy(target, {
    get: (object, key) => (key in object ? object[key as string] : () => {}),
    set: (object, key, value) => {
      object[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/**
 * jsdom does not implement `PointerEvent`.
 *
 * Touch controls are built on pointer events precisely because they unify mouse
 * and touch and carry a pointer id, so the tests need the constructor even
 * though the environment lacks it. This is the minimum the controls read.
 *
 * Like everything else here, it is for jsdom: a file that runs on node
 * (`@vitest-environment node`) gets no DOM stand-ins at all.
 */
if (typeof window !== "undefined" && typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "touch";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as never;
}

// Pointer capture is a no-op in jsdom but must exist to be spied on or called.
if (typeof Element !== "undefined" && Element.prototype.setPointerCapture === undefined) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}
