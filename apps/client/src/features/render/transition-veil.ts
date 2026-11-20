/**
 * The liquid wipe between the race's screens (race-flow spec §7.2, D-F5).
 *
 * An Aquarian flood drawn on its own canvas over the whole page, the DOM UI
 * included, with one small WebGL program. Reduced motion, no WebGL or a lost
 * context mean the plain fading veil in `features/render/veil.ts`.
 */

import {
  COVER_MS, REDUCED_HALF_MS, REVEAL_MS,
  createDomVeil, frameAnimate, veilLayer,
  type Animate, type VeilPort,
} from "./veil";
import { DAWN_CAUSTIC_GLSL } from "./filters/dawn-refraction";


export type VeilColours = { action: readonly [number, number, number]; glow: readonly [number, number, number] };

export type VeilOptions = {
  host: HTMLElement;
  reducedMotion: () => boolean;
  colours?: () => VeilColours | undefined;
  animate?: Animate;
  createContext?: (canvas: HTMLCanvasElement) => WebGLRenderingContext | null;
  onCoveringChange?: (covering: boolean) => void;
};

/**
 * The shader's clock wraps here, in seconds. A wipe lasts under a second, so a
 * wrap landing inside one is a shimmer that shifts once; an unbounded clock
 * would cost a half-float device its smooth wave after a few minutes of play.
 */
const CLOCK_PERIOD_S = 120;

let liveCanvases = 0;
let liveContexts = 0;

/** What the leak run reads: one canvas and one context at most, ever. */
export function veilCounters(): { veilCanvases: number; glContexts: number } {
  return { veilCanvases: liveCanvases, glContexts: liveContexts };
}

const VERTEX = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

// High precision where the device has it, as Dawn Refraction's shader asks for:
// the wave's phase is the clock, and a half-float steps it coarsely.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uResolution;
uniform float uProgress;
uniform float uTime;
uniform vec3 uAction;
uniform vec3 uGlow;
${DAWN_CAUSTIC_GLSL}
float blob(vec2 p, vec2 c, float r) { vec2 d = p - c; return r * r / max(dot(d, d), 0.0001); }
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float phase = uTime * 2.0;
  float level = mix(-0.2, 1.2, uProgress);
  float surface = level + 0.05 * sin(p.x * 5.0 + phase) + 0.03 * sin(p.x * 11.0 - phase * 1.3);
  float field = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2((fi + 0.5) / 4.0 * aspect + 0.08 * sin(phase + fi * 1.7), surface + 0.03);
    field += blob(p, c, 0.06 + 0.015 * fi);
  }
  float covered = clamp(step(p.y, surface) + step(1.0, field), 0.0, 1.0);
  if (uProgress >= 1.0) covered = 1.0;
  if (uProgress <= 0.0) covered = 0.0;
  float caustic = dawnCaustic(p * 3.0, phase);
  float crest = smoothstep(surface - 0.08, surface, p.y);
  // Shimmer between two tokens, not a tween of either: the caustic is the
  // water's light, as Dawn Refraction's is the sky's.
  vec3 colour = mix(uAction, uGlow, clamp(caustic * 0.6 + crest * 0.35, 0.0, 1.0));
  gl_FragColor = vec4(colour * covered, covered);
}
`;

/** `#rrggbb` to 0..1 channels; the tokens are authored as hex. */
function channels(hex: string): readonly [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return undefined;
  const value = Number.parseInt(match[1]!, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/**
 * Aquarian blue, read when it is needed: `aquarian-tokens.css` is the only
 * source of smooth UI colours, so there is no copy of it here. Undefined when
 * the tokens cannot be read, and then the plain veil, which uses them in CSS,
 * covers instead.
 */
export function readVeilColours(): VeilColours | undefined {
  const style = getComputedStyle(document.documentElement);
  const action = channels(style.getPropertyValue("--ff-plain"));
  const glow = channels(style.getPropertyValue("--ff-glow"));
  return action === undefined || glow === undefined ? undefined : { action, glow };
}

type Liquid = {
  canvas: HTMLCanvasElement;
  draw(progress: number, seconds: number): void;
  lost: boolean;
  release(): void;
};

function liquidOn(options: VeilOptions, onLost: () => void): Liquid | undefined {
  const palette = (options.colours ?? readVeilColours)();
  if (palette === undefined) return undefined;
  const canvas = document.createElement("canvas");
  veilLayer(canvas);
  const gl = (options.createContext ?? ((c) => c.getContext("webgl", { premultipliedAlpha: true, antialias: false })))(canvas);
  if (gl === null) return undefined;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "veil shader");
    return shader;
  };
  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "veil program");
  } catch {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return undefined;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPosition");
  const uniforms = {
    resolution: gl.getUniformLocation(program, "uResolution"),
    progress: gl.getUniformLocation(program, "uProgress"),
    time: gl.getUniformLocation(program, "uTime"),
    action: gl.getUniformLocation(program, "uAction"),
    glow: gl.getUniformLocation(program, "uGlow"),
  };
  liveCanvases += 1;
  liveContexts += 1;
  const liquid: Liquid = {
    canvas,
    lost: false,
    draw(progress, seconds) {
      if (liquid.lost || gl.isContextLost()) {
        liquid.lost = true;
        return;
      }
      // Half resolution, scaled up by CSS: a soft edge, and a cheap frame on a tablet.
      const ratio = (globalThis.devicePixelRatio ?? 1) / 2;
      const width = Math.max(1, Math.round(innerWidth * ratio));
      const height = Math.max(1, Math.round(innerHeight * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const colours = palette;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uniforms.resolution, width, height);
      gl.uniform1f(uniforms.progress, progress);
      gl.uniform1f(uniforms.time, seconds);
      gl.uniform3f(uniforms.action, ...colours.action);
      gl.uniform3f(uniforms.glow, ...colours.glow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    release() {
      canvas.remove();
      if (!liquid.lost) gl.getExtension("WEBGL_lose_context")?.loseContext();
      liveCanvases -= 1;
      liveContexts -= 1;
    },
  };
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    liquid.lost = true;
    onLost();
  });
  return liquid;
}

/**
 * The liquid wipe between the race's screens (race-flow spec §7.2, D-F5): its
 * own top-most canvas, so it covers the DOM UI as well as the Pixi canvas.
 * Made on first use and kept; attached only while it covers or reveals.
 * Reduced motion, no WebGL, or a lost context mean the plain fading veil.
 */
export function createTransitionVeil(options: VeilOptions): VeilPort {
  const animate = options.animate ?? frameAnimate;
  const reduced = options.reducedMotion;
  // The plain veil always runs the short fade (race-flow spec §7.2): it is
  // reduced motion's veil, and the fallback when WebGL is missing or lost.
  const plain = createDomVeil(options.host, animate, () => ({ cover: REDUCED_HALF_MS, reveal: REDUCED_HALF_MS }));
  let liquid: Liquid | undefined;
  let tried = false;
  let active: "liquid" | "plain" | undefined;
  const current = () => active;
  const started = performance.now();
  const seconds = () => ((performance.now() - started) / 1000) % CLOCK_PERIOD_S;
  let destroyed = false;

  const liquidReady = (): Liquid | undefined => {
    if (reduced()) return undefined;
    if (!tried) {
      tried = true;
      liquid = liquidOn(options, () => {
        // Lost while it covers or reveals: the plain veil takes over at full
        // cover at once, so a swap under way stays hidden, and the dead canvas
        // leaves rather than sitting over the page catching every tap.
        // `destroy` loses the context itself, and the event arrives after it.
        if (destroyed || active !== "liquid") return;
        liquid?.canvas.remove();
        active = "plain";
        plain.showNow();
      });
    }
    return liquid !== undefined && !liquid.lost ? liquid : undefined;
  };

  /** Runs the flood or the drain; false if the context went mid-way. */
  const flow = async (wipe: Liquid, from: number, to: number, ms: number): Promise<boolean> => {
    await animate(ms, (t) => wipe.draw(from + (to - from) * t, seconds()));
    return !wipe.lost;
  };

  return {
    async cover() {
      options.onCoveringChange?.(true);
      const wipe = liquidReady();
      if (wipe !== undefined) {
        options.host.appendChild(wipe.canvas);
        active = "liquid";
        if (await flow(wipe, 0, 1, COVER_MS)) return;
        wipe.canvas.remove();
        // The loss already put the plain veil up, fully. Read through a call:
        // the handler changed it during the await, which narrowing cannot see.
        if (current() === "plain") return;
      }
      active = "plain";
      await plain.cover();
    },
    async reveal() {
      // Whatever happens on the way, the page ends uncovered and focus
      // navigation resumes: a veil left up would trap the player.
      try {
        if (active === "liquid" && liquid !== undefined && !liquid.lost) {
          const finished = await flow(liquid, 1, 0, REVEAL_MS);
          liquid.canvas.remove();
          if (!finished) await plain.reveal();
        } else {
          await plain.reveal();
        }
      } finally {
        liquid?.canvas.remove();
        plain.hide();
        active = undefined;
        options.onCoveringChange?.(false);
      }
    },
    destroy() {
      destroyed = true;
      plain.destroy();
      liquid?.release();
      liquid = undefined;
      // Torn down mid-wipe: nothing will reveal, so focus navigation resumes here.
      if (active !== undefined) {
        active = undefined;
        options.onCoveringChange?.(false);
      }
    },
  };
}
