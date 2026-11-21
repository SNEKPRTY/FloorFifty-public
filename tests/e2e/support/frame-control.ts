import type { Frame, Page } from "@playwright/test";

/** Takes over `requestAnimationFrame` and `performance.now` for the page once `__capture.start()` is called. */
export const FRAME_CONTROL = (): void => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let manual = false;
  let now = 0;
  let nextId = 1_000_000_000;
  let queue = new Map<number, FrameRequestCallback>();
  performance.now = () => (manual ? now : realNow());
  window.requestAnimationFrame = (callback) => {
    if (!manual) return realRaf((time) => (manual ? void queue.set(nextId++, callback) : callback(time)));
    const id = nextId++;
    queue.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (queue.delete(id)) return;
    realCancel(id);
  };
  (window as unknown as { __capture: unknown }).__capture = {
    start: () => {
      // Once: a second start would set the clock back to real time, behind the frames already stepped.
      if (manual) return;
      now = realNow();
      manual = true;
    },
    /** Draws `count` frames, `ms` apart, in this page's own time. */
    step: (count: number, ms: number) => {
      for (let index = 0; index < count; index += 1) {
        now += ms;
        const due = queue;
        queue = new Map();
        for (const callback of due.values()) callback(now);
      }
    },
  };
};

/**
 * Steps the page's frames, five ticks a frame (the run's cap), until `done` holds or `frames` have run. A
 * clock that has been taken over (`FRAME_CONTROL`, then `__capture.start()`) is how a slow software-drawn
 * browser reaches something minutes of play away: the page's own clock runs a tenth of real time there.
 */
export async function stepUntil(page: Page | Frame, done: () => Promise<boolean>, frames = 6_000, batch = 30, frameMs = 1000 / 12): Promise<boolean> {
  await page.evaluate(() => (window as unknown as { __capture: { start: () => void } }).__capture.start());
  for (let spent = 0; spent < frames; spent += batch) {
    await page.evaluate(([count, ms]) => (window as unknown as { __capture: { step: (n: number, ms: number) => void } }).__capture.step(count!, ms!), [batch, frameMs]);
    if (await done()) return true;
  }
  return false;
}

/** For something that shows briefly (being caught shows for a second and a half): a tick a frame, checked every few frames. */
export const BRIEF = { batch: 6, frameMs: 1000 / 60 } as const;

/**
 * A GPU-less browser names itself, and the client then draws a frame a second at half density. A page whose
 * frames are stepped by hand asks to be drawn as a GPU's would be, so each stepped frame is a whole one.
 */
export const GPU_LIKE = (): void => {
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const getParameter = proto.getParameter;
    proto.getParameter = function (this: WebGLRenderingContext, parameter: number) {
      return parameter === 0x9246 ? "ANGLE (Stepped frames, Vulkan 1.3)" : getParameter.call(this, parameter);
    };
  }
};
