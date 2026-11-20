/**
 * The per-frame cost probe (`perf-probe.spec.ts`).
 *
 * `frame-budget.spec.ts` reads `requestAnimationFrame` deltas, which stop at
 * vsync: a chain that costs 4ms and one that costs 15ms both report 16.7ms.
 * This probe measures the cost itself, from inside the page and without any
 * hook in the client:
 *
 * - **CPU**: every `requestAnimationFrame` callback is timed, and a frame's
 *   CPU time is the sum of its callbacks (the Pixi ticker, GSAP, Svelte).
 * - **Sync**: the same, with a 1x1 `readPixels` after each callback that drew,
 *   so the number includes the GPU finishing the frame. Run as its own pass,
 *   since the stall removes the overlap a real frame has.
 * - **GPU**: `EXT_disjoint_timer_query_webgl2` around each drawing callback,
 *   where the browser exposes it.
 * - **Submission**: draw calls, framebuffer binds (render-target passes), the
 *   pixels those passes cover, program switches, texture uploads and buffer
 *   uploads, all on the game's own context.
 * - **Heap**: `performance.memory` per frame (Chromium, with
 *   `--enable-precise-memory-info`): what a frame allocates, and how many
 *   collections a window saw.
 *
 * Wrapping the GL entry points costs a little CPU per call, the same in a
 * baseline and in a change, so the comparison holds; the absolute CPU numbers
 * read a few percent high.
 */

import type { BrowserContext, Page } from "@playwright/test";

export type FrameMode = "cpu" | "sync";

export type FrameStats = {
  frames: number;
  cpuMedian: number;
  cpuP95: number;
  /** Null where the timer query is not exposed. */
  gpuMedian: number | null;
  gpuP95: number | null;
  drawsMedian: number;
  passesMedian: number;
  /** Device pixels covered by the passes, in megapixels: the fill the filter chain asks for. */
  passMegapixelsMedian: number;
  programsMedian: number;
  textureUploadsMedian: number;
  textureUploadKbMedian: number;
  bufferUploadKbMedian: number;
  /** MB of JS heap at the end of the window. Null without `performance.memory`. */
  heapMb: number | null;
  /** KB a frame allocates, from the heap's rise between collections. */
  allocKbPerFrame: number | null;
  /** Collections seen in the window: frames where the heap fell. */
  gcs: number | null;
  canvas: { width: number; height: number } | null;
};

/** Installs the probe in every page `context` opens, before any of its scripts run. */
export async function installPerfProbe(context: BrowserContext): Promise<void> {
  await context.addInitScript(probeSource);
}

/** Samples `frames` frames on `page` and summarises them. */
export async function measureFrames(page: Page, mode: FrameMode, frames = 180): Promise<FrameStats> {
  return page.evaluate(
    async ({ mode, frames }) => {
      const probe = (window as unknown as { __ffPerf: { measure(mode: string, frames: number): Promise<unknown> } }).__ffPerf;
      return probe.measure(mode, frames);
    },
    { mode, frames },
  ) as Promise<FrameStats>;
}

export type PassTrace = {
  frames: number;
  /** Frames whose pass list matched the first one's, which the times are taken over. */
  matching: number;
  passes: { size: string; draws: number; programs: string[]; gpuMs: number | null }[];
};

/** A frame's passes, in order: the viewport each drew at, its draws, programs and median GPU time. */
export async function tracePasses(page: Page, frames = 60): Promise<PassTrace> {
  return page.evaluate(
    (count) => (window as unknown as { __ffPerf: { trace(count: number): Promise<PassTrace> } }).__ffPerf.trace(count),
    frames,
  );
}

/** Runs in the page. Self-contained: Playwright serialises it. */
function probeSource(): void {
  type Frame = {
    cpu: number;
    draws: number;
    passes: number;
    passPixels: number;
    programs: number;
    texUploads: number;
    texBytes: number;
    bufBytes: number;
    queries: WebGLQuery[];
    heap: number;
  };
  type Gl = WebGL2RenderingContext;

  const contexts: Gl[] = [];
  let main: Gl | undefined;
  let frame: Frame | undefined;
  let frameTs = -1;
  let recording = false;
  let mode = "cpu";
  const done: Frame[] = [];
  let pendingFrames: { frame: Frame }[] = [];
  let timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  let fbDirty = true;
  let viewportArea = 0;
  let drewThisCallback = false;
  const pixel = new Uint8Array(4);
  /** One frame's passes in order, when a trace is asked for. */
  type TracedPass = { size: string; draws: number; programs: string[]; query: WebGLQuery | null };
  let trace: TracedPass[] | undefined;
  const traceFrames: TracedPass[][] = [];
  let traceTimer: { TIME_ELAPSED_EXT: number } | null = null;
  let passQueryOpen = false;
  let traceSize = "";
  const labels = new Map<WebGLProgram, string>();
  const labelOf = (gl: Gl, program: WebGLProgram): string => {
    let label = labels.get(program);
    if (label !== undefined) return label;
    const fragment =
      (gl.getAttachedShaders(program) ?? [])
        .map((shader) => gl.getShaderSource(shader) ?? "")
        .find((source) => !/gl_Position/.test(source)) ?? "";
    const uniforms = [...fragment.matchAll(/uniform\s+\w+\s+(\w+)/g)]
      .map((match) => match[1]!)
      .filter((name) => name !== "uTexture");
    label = uniforms.slice(0, 3).join(",") || "(texture only)";
    labels.set(program, label);
    return label;
  };

  const memory = (): number => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? -1;

  const blank = (): Frame => ({
    cpu: 0,
    draws: 0,
    passes: 0,
    passPixels: 0,
    programs: 0,
    texUploads: 0,
    texBytes: 0,
    bufBytes: 0,
    queries: [],
    heap: -1,
  });

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
    const ctx = (getContext as (...a: unknown[]) => unknown).apply(this, args);
    if (ctx instanceof WebGL2RenderingContext && !contexts.includes(ctx)) contexts.push(ctx);
    return ctx;
  } as typeof getContext;

  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const wrap = (name: string, before: (gl: Gl, args: unknown[]) => void): void => {
    const original = proto[name];
    if (typeof original !== "function") return;
    proto[name] = function (this: Gl, ...args: unknown[]) {
      if (recording && this === main && frame !== undefined) before(this, args);
      return original.apply(this, args);
    };
  };

  const draw = (gl: Gl): void => {
    frame!.draws += 1;
    drewThisCallback = true;
    if (fbDirty) {
      fbDirty = false;
      frame!.passes += 1;
      frame!.passPixels += viewportArea || gl.drawingBufferWidth * gl.drawingBufferHeight;
      if (trace !== undefined) {
        let query: WebGLQuery | null = null;
        if (traceTimer !== null) {
          if (passQueryOpen) gl.endQuery(traceTimer.TIME_ELAPSED_EXT);
          query = gl.createQuery();
          passQueryOpen = query !== null;
          if (query !== null) gl.beginQuery(traceTimer.TIME_ELAPSED_EXT, query);
        }
        trace.push({ size: traceSize, draws: 0, programs: [], query });
      }
    }
    const pass = trace?.at(-1);
    if (pass !== undefined) {
      pass.draws += 1;
      const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
      const label = program === null ? "?" : labelOf(gl, program);
      if (pass.programs.at(-1) !== label) pass.programs.push(label);
    }
  };
  for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"]) {
    wrap(name, draw);
  }
  wrap("bindFramebuffer", () => {
    fbDirty = true;
  });
  wrap("viewport", (_gl, args) => {
    viewportArea = (args[2] as number) * (args[3] as number);
    traceSize = `${args[2]}x${args[3]}`;
    fbDirty = true;
  });
  wrap("useProgram", () => {
    frame!.programs += 1;
  });
  const upload = (_gl: Gl, args: unknown[]): void => {
    frame!.texUploads += 1;
    // texImage2D(target, level, internal, width, height, ...) or (target, level, internal, format, type, source).
    const w = typeof args[3] === "number" && typeof args[4] === "number" && args.length >= 8 ? (args[3] as number) : undefined;
    if (w !== undefined) frame!.texBytes += w * (args[4] as number) * 4;
    else {
      const source = args[args.length - 1] as { width?: number; height?: number } | undefined;
      if (source && typeof source.width === "number" && typeof source.height === "number") {
        frame!.texBytes += source.width * source.height * 4;
      }
    }
  };
  wrap("texImage2D", upload);
  wrap("texSubImage2D", upload);
  const buffer = (_gl: Gl, args: unknown[]): void => {
    const data = args[1] as { byteLength?: number } | number;
    if (typeof data === "number") frame!.bufBytes += data;
    else if (data && typeof data.byteLength === "number") frame!.bufBytes += data.byteLength;
    // bufferSubData(target, offset, data)
    const sub = args[2] as { byteLength?: number } | undefined;
    if (typeof args[1] === "number" && sub && typeof sub.byteLength === "number") frame!.bufBytes += sub.byteLength;
  };
  wrap("bufferData", buffer);
  wrap("bufferSubData", buffer);

  const finishFrame = (): void => {
    if (frame === undefined) return;
    frame.heap = memory();
    pendingFrames.push({ frame });
    if (trace !== undefined) {
      traceFrames.push(trace);
      trace = [];
    }
    frame = undefined;
  };

  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    raf((ts: number) => {
      if (!recording) {
        callback(ts);
        return;
      }
      if (ts !== frameTs) {
        finishFrame();
        frameTs = ts;
        frame = blank();
      }
      const gl = main;
      let query: WebGLQuery | null = null;
      if (timer !== null && gl !== undefined) {
        query = gl.createQuery();
        if (query !== null) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      }
      drewThisCallback = false;
      const start = performance.now();
      try {
        callback(ts);
      } finally {
        if (mode === "sync" && drewThisCallback && gl !== undefined) {
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        }
        if (passQueryOpen && gl !== undefined && traceTimer !== null) {
          gl.endQuery(traceTimer.TIME_ELAPSED_EXT);
          passQueryOpen = false;
          fbDirty = true;
        }
        const current = frame;
        if (current !== undefined) current.cpu += performance.now() - start;
        if (query !== null && gl !== undefined && timer !== null) {
          gl.endQuery(timer.TIME_ELAPSED_EXT);
          if (current !== undefined && drewThisCallback) current.queries.push(query);
          else gl.deleteQuery(query);
        }
      }
    });

  const quantile = (values: number[], q: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  };

  const resolveQueries = async (gl: Gl): Promise<(number | null)[]> => {
    const results: (number | null)[] = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const last = done[done.length - 1]?.queries.at(-1);
      if (last === undefined || gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) break;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const disjoint = timer !== null && gl.getParameter(timer.GPU_DISJOINT_EXT);
    for (const entry of done) {
      if (entry.queries.length === 0 || disjoint) {
        results.push(null);
        continue;
      }
      let ns = 0;
      let ok = true;
      for (const query of entry.queries) {
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) ok = false;
        else ns += gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
        gl.deleteQuery(query);
      }
      results.push(ok ? ns / 1e6 : null);
    }
    return results;
  };

  const findMain = (): Gl | undefined =>
    contexts
      .filter((gl) => (gl.canvas as HTMLCanvasElement).isConnected)
      .sort((a, b) => b.drawingBufferWidth * b.drawingBufferHeight - a.drawingBufferWidth * a.drawingBufferHeight)[0];

  (window as unknown as { __ffPerf: unknown }).__ffPerf = {
    /**
     * `count` frames' passes: the viewport each drew at, its draws, its programs
     * and, where the timer query is exposed, its GPU time. Summarised by pass
     * index over the frames whose pass list matches the first one's.
     */
    async trace(count: number) {
      main = findMain();
      if (main === undefined) throw new Error("no WebGL2 canvas");
      const gl = main;
      mode = "cpu";
      timer = null;
      traceTimer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as typeof traceTimer;
      pendingFrames = [];
      traceFrames.length = 0;
      frame = undefined;
      frameTs = -1;
      fbDirty = true;
      trace = [];
      recording = true;
      await new Promise<void>((resolve) => {
        const wait = (): void => {
          if (traceFrames.length >= count + 1) resolve();
          else setTimeout(wait, 5);
        };
        wait();
      });
      recording = false;
      trace = undefined;
      const frames = traceFrames.slice(1, count + 1);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const shape = (passes: TracedPass[]) => passes.map((pass) => `${pass.size}:${pass.programs.join("|")}`).join(";");
      const reference = shape(frames[0]!);
      const matching = frames.filter((passes) => shape(passes) === reference);
      const summary = frames[0]!.map((pass, index) => {
        const times: number[] = [];
        for (const passes of matching) {
          const query = passes[index]?.query;
          if (query === null || query === undefined) continue;
          if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
            times.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6);
          }
        }
        return { size: pass.size, draws: pass.draws, programs: pass.programs, gpuMs: times.length > 0 ? quantile(times, 0.5) : null };
      });
      for (const passes of frames) for (const pass of passes) if (pass.query !== null) gl.deleteQuery(pass.query);
      traceTimer = null;
      return { frames: frames.length, matching: matching.length, passes: summary };
    },
    async measure(nextMode: string, count: number) {
      // The game's context: the largest connected WebGL2 canvas.
      main = findMain();
      if (main === undefined) throw new Error("no WebGL2 canvas");
      timer = main.getExtension("EXT_disjoint_timer_query_webgl2") as typeof timer;
      mode = nextMode;
      done.length = 0;
      pendingFrames = [];
      frame = undefined;
      frameTs = -1;
      fbDirty = true;
      recording = true;
      // A warm-up frame, then `count` whole frames.
      await new Promise<void>((resolve) => {
        const wait = (): void => {
          if (pendingFrames.length >= count + 1) resolve();
          else setTimeout(wait, 50);
        };
        wait();
      });
      recording = false;
      finishFrame();
      done.push(...pendingFrames.slice(1, count + 1).map((entry) => entry.frame));
      const gpu = await resolveQueries(main);
      const gpuValues = gpu.filter((value): value is number => value !== null);

      // The heap's rise between collections is what a frame allocated.
      let rise = 0;
      let rises = 0;
      let gcs = 0;
      for (let index = 1; index < done.length; index += 1) {
        const delta = done[index]!.heap - done[index - 1]!.heap;
        if (done[index]!.heap < 0) continue;
        if (delta < 0) gcs += 1;
        else {
          rise += delta;
          rises += 1;
        }
      }
      const hasHeap = done.length > 0 && done[0]!.heap >= 0;
      const pick = (key: keyof Frame) => done.map((entry) => entry[key] as number);
      const canvas = main.canvas as HTMLCanvasElement;
      return {
        frames: done.length,
        cpuMedian: quantile(pick("cpu"), 0.5),
        cpuP95: quantile(pick("cpu"), 0.95),
        gpuMedian: gpuValues.length > done.length / 2 ? quantile(gpuValues, 0.5) : null,
        gpuP95: gpuValues.length > done.length / 2 ? quantile(gpuValues, 0.95) : null,
        drawsMedian: quantile(pick("draws"), 0.5),
        passesMedian: quantile(pick("passes"), 0.5),
        passMegapixelsMedian: quantile(pick("passPixels"), 0.5) / 1e6,
        programsMedian: quantile(pick("programs"), 0.5),
        textureUploadsMedian: quantile(pick("texUploads"), 0.5),
        textureUploadKbMedian: quantile(pick("texBytes"), 0.5) / 1024,
        bufferUploadKbMedian: quantile(pick("bufBytes"), 0.5) / 1024,
        heapMb: hasHeap ? done[done.length - 1]!.heap / 1048576 : null,
        allocKbPerFrame: hasHeap && rises > 0 ? rise / rises / 1024 : null,
        gcs: hasHeap ? gcs : null,
        canvas: { width: canvas.width, height: canvas.height },
      };
    },
  };
}
