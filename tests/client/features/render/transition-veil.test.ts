import { afterEach, describe, expect, it, vi } from "vitest";
import { COVER_MS, REDUCED_HALF_MS } from "../../../../apps/client/src/features/render/veil";
import { createTransitionVeil, veilCounters } from "../../../../apps/client/src/features/render/transition-veil";

/** The tokens, as the page's stylesheet gives them; jsdom loads no CSS. */
const colours = () => ({ action: [0.09, 0.41, 0.78] as const, glow: [0.31, 0.61, 1] as const });

/** Runs every animation to its end at once, recording each duration asked for. */
function instantAnimate(durations: number[]) {
  return async (durationMs: number, onFrame: (t: number) => void) => {
    durations.push(durationMs);
    onFrame(0);
    onFrame(0.5);
    onFrame(1);
  };
}

function recordingGl() {
  const lose = vi.fn();
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6,
    FLOAT: 7, TRIANGLES: 8, COLOR_BUFFER_BIT: 9,
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true), getShaderInfoLog: vi.fn(() => ""),
    createProgram: vi.fn(() => ({})), attachShader: vi.fn(), linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true), getProgramInfoLog: vi.fn(() => ""),
    deleteShader: vi.fn(), deleteProgram: vi.fn(), useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})), bindBuffer: vi.fn(), bufferData: vi.fn(), deleteBuffer: vi.fn(),
    getAttribLocation: vi.fn(() => 0), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({})), uniform1f: vi.fn(), uniform2f: vi.fn(), uniform3f: vi.fn(),
    viewport: vi.fn(), clearColor: vi.fn(), clear: vi.fn(), drawArrays: vi.fn(),
    isContextLost: vi.fn(() => false),
    getExtension: vi.fn((name: string) => (name === "WEBGL_lose_context" ? { loseContext: lose } : null)),
  };
  return { gl: gl as unknown as WebGLRenderingContext, raw: gl, lose };
}

const veilIn = (host: HTMLElement) => host.querySelector('[data-testid="transition-veil"]');

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the transition veil", () => {
  it("floods on its own canvas, then drains and leaves the page", async () => {
    const durations: number[] = [];
    const { gl, raw } = recordingGl();
    const veil = createTransitionVeil({
      host: document.body,
      reducedMotion: () => false,
      animate: instantAnimate(durations),
      createContext: () => gl,
      colours,
    });
    await veil.cover();
    const canvas = veilIn(document.body) as HTMLCanvasElement;
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas.style.zIndex).toBe("70");
    expect(canvas.style.pointerEvents).toBe("auto");
    expect(raw.drawArrays).toHaveBeenCalled();
    await veil.reveal();
    expect(veilIn(document.body)).toBeNull();
    expect(durations).toEqual([COVER_MS, COVER_MS]);
    veil.destroy();
  });

  it("keeps one canvas and one context across transitions, and releases the context on destroy", async () => {
    const { gl, lose } = recordingGl();
    const make = vi.fn(() => gl);
    // Counted against what was live before: the counters are the module's.
    const before = veilCounters();
    const veil = createTransitionVeil({ host: document.body, reducedMotion: () => false, animate: instantAnimate([]), createContext: make, colours });
    for (let round = 0; round < 10; round += 1) {
      await veil.cover();
      await veil.reveal();
    }
    expect(make).toHaveBeenCalledTimes(1);
    expect(veilCounters()).toEqual({ veilCanvases: before.veilCanvases + 1, glContexts: before.glContexts + 1 });
    veil.destroy();
    expect(lose).toHaveBeenCalledTimes(1);
    expect(veilCounters()).toEqual(before);
  });

  it("fades a plain veil 100 ms in and 100 ms out under reduced motion", async () => {
    const durations: number[] = [];
    const make = vi.fn(() => recordingGl().gl);
    const veil = createTransitionVeil({ host: document.body, reducedMotion: () => true, animate: instantAnimate(durations), createContext: make, colours });
    await veil.cover();
    const plain = veilIn(document.body) as HTMLElement;
    expect(plain.tagName).toBe("DIV");
    expect(plain.style.opacity).toBe("1");
    await veil.reveal();
    expect(veilIn(document.body)).toBeNull();
    expect(durations).toEqual([REDUCED_HALF_MS, REDUCED_HALF_MS]);
    expect(make).not.toHaveBeenCalled();
    veil.destroy();
  });

  it("falls back to the DOM veil without WebGL, running the reduced-motion fade (race-flow spec §7.2)", async () => {
    const durations: number[] = [];
    const veil = createTransitionVeil({ host: document.body, reducedMotion: () => false, animate: instantAnimate(durations), createContext: () => null });
    await veil.cover();
    expect((veilIn(document.body) as HTMLElement).tagName).toBe("DIV");
    await veil.reveal();
    expect(durations).toEqual([REDUCED_HALF_MS, REDUCED_HALF_MS]);
    veil.destroy();
  });

  it("never leaves focus navigation paused, even when the reveal fails", async () => {
    const changes: boolean[] = [];
    let calls = 0;
    const veil = createTransitionVeil({
      host: document.body,
      reducedMotion: () => true,
      animate: async (_ms, onFrame) => {
        calls += 1;
        onFrame(1);
        if (calls === 2) throw new Error("frame failed");
      },
      onCoveringChange: (covering) => changes.push(covering),
    });
    await veil.cover();
    await expect(veil.reveal()).rejects.toThrow(/frame failed/);
    expect(changes).toEqual([true, false]);
    expect(veilIn(document.body)).toBeNull();
    veil.destroy();
  });

  it("a lost context falls back to the DOM veil", async () => {
    const { gl } = recordingGl();
    const make = vi.fn(() => gl);
    let lostMidway = false;
    const veil = createTransitionVeil({
      host: document.body,
      reducedMotion: () => false,
      createContext: make,
      colours,
      animate: async (_ms, onFrame) => {
        onFrame(0);
        const canvas = veilIn(document.body);
        if (canvas?.tagName === "CANVAS" && !lostMidway) {
          lostMidway = true;
          canvas.dispatchEvent(new Event("webglcontextlost"));
        }
        onFrame(1);
      },
    });
    await veil.cover();
    expect((veilIn(document.body) as HTMLElement).tagName).toBe("DIV");
    await veil.reveal();
    expect(veilIn(document.body)).toBeNull();
    await veil.cover();
    expect((veilIn(document.body) as HTMLElement).tagName).toBe("DIV");
    expect(make).toHaveBeenCalledTimes(1);
    await veil.reveal();
    veil.destroy();
  });

  it("a context lost between cover and reveal keeps the swap covered and leaves no canvas behind", async () => {
    const { gl } = recordingGl();
    const veil = createTransitionVeil({ host: document.body, reducedMotion: () => false, animate: instantAnimate([]), createContext: () => gl, colours });
    await veil.cover();
    const canvas = veilIn(document.body) as HTMLCanvasElement;
    expect(canvas.tagName).toBe("CANVAS");
    // Lost while covered: the screens swap now, and must stay hidden.
    canvas.dispatchEvent(new Event("webglcontextlost"));
    const plain = veilIn(document.body) as HTMLElement;
    expect(plain.tagName).toBe("DIV");
    expect(plain.style.opacity).toBe("1");
    expect(document.body.querySelectorAll("canvas")).toHaveLength(0);
    await veil.reveal();
    expect(veilIn(document.body)).toBeNull();
    veil.destroy();
  });

  it("asks for high precision where the device has it, and keeps the shader's clock small where it does not", async () => {
    // The wave's phase is the time, and a half-float quantises it to coarse
    // steps after a few minutes of play: the flood would jump, not glide.
    const { gl, raw } = recordingGl();
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValue(0);
    const veil = createTransitionVeil({ host: document.body, reducedMotion: () => false, animate: instantAnimate([]), createContext: () => gl, colours });
    clock.mockReturnValue(3 * 60 * 60 * 1000);
    await veil.cover();
    clock.mockRestore();

    const fragment = raw.shaderSource.mock.calls.map(([, source]) => String(source)).find((source) => source.includes("uTime"))!;
    expect(fragment).toContain("#ifdef GL_FRAGMENT_PRECISION_HIGH");
    expect(fragment).toMatch(/precision highp float;[\s\S]*#else[\s\S]*precision mediump float;/);
    for (const [, value] of raw.uniform1f.mock.calls) expect(value as number).toBeLessThan(121);
    veil.destroy();
  });

  it("does not put a veil back up when destroyed mid-wipe and its context then reports lost", async () => {
    // `destroy` loses the context, and the event arrives after it has run.
    const { gl } = recordingGl();
    const changes: boolean[] = [];
    const veil = createTransitionVeil({
      host: document.body,
      reducedMotion: () => false,
      animate: instantAnimate([]),
      createContext: () => gl,
      colours,
      onCoveringChange: (covering) => changes.push(covering),
    });
    await veil.cover();
    const canvas = veilIn(document.body) as HTMLCanvasElement;
    veil.destroy();
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(veilIn(document.body)).toBeNull();
    expect(document.body.children, "nothing of the veil is left on the page").toHaveLength(0);
    expect(changes, "focus navigation is not left paused").toEqual([true, false]);
  });

  it("says when it starts and stops covering, so focus navigation can pause", async () => {
    const changes: boolean[] = [];
    const veil = createTransitionVeil({
      host: document.body,
      reducedMotion: () => true,
      animate: instantAnimate([]),
      onCoveringChange: (covering) => changes.push(covering),
    });
    await veil.cover();
    await veil.reveal();
    expect(changes).toEqual([true, false]);
    veil.destroy();
  });

  it("covers with the plain veil when the colour tokens cannot be read", async () => {
    const { gl } = recordingGl();
    const make = vi.fn(() => gl);
    const veil = createTransitionVeil({ host: document.body, reducedMotion: () => false, animate: instantAnimate([]), createContext: make });
    await veil.cover();
    expect((veilIn(document.body) as HTMLElement).tagName).toBe("DIV");
    expect(make).not.toHaveBeenCalled();
    await veil.reveal();
    veil.destroy();
  });
});

