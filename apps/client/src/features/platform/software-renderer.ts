/**
 * A browser drawing WebGL on the CPU.
 *
 * Without a usable GPU, Chromium rasterises WebGL in software (SwiftShader;
 * Mesa's llvmpipe on Linux, Microsoft's Basic Render Driver on Windows). There
 * the title's one frame -- 24 draws, eight of them the bloom's full-screen blur
 * -- measured about 470ms on four cores (1280 x 720, 2026-11-18). The ticker
 * asks for the next frame as soon as one ends, so the GPU process never rests
 * and the page's main thread spends nearly every frame waiting on it: loading
 * the menu took 27s at an uncapped rate and 4s with frames capped below that
 * cost.
 *
 * So a software renderer draws one frame a second, at half a device pixel per
 * CSS pixel (`canvas-resolution.ts`): about 260ms a frame. One, not two: in software the page's main thread waits while each drawn
 * frame is copied back, and with three pages sharing four cores two frames a
 * second kept it waiting all the time (2 rAF a second, a click 4s; at one
 * frame, 31 rAF a second and a click 15ms, 2026-11-18). Everything still draws,
 * as it would on a GPU, only less often and less densely. A GPU is never
 * capped, so no player with one sees a difference.
 */

/** Frames a second on a software renderer: well below what its frames cost the page. */
export const SOFTWARE_MAX_FPS = 1;

const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render|software/i;

/** Whether the renderer `name` (from `WEBGL_debug_renderer_info`) rasterises on the CPU. */
export function isSoftwareRenderer(name: string | null | undefined): boolean {
  return typeof name === "string" && SOFTWARE.test(name);
}

/**
 * The ticker limits for a renderer. Pixi keeps `maxFPS` at or above
 * `minFPS` (10 by default), so both are set.
 */
export function softwareFrameCap(software: boolean): { minFPS: number; maxFPS: number } | null {
  return software ? { minFPS: SOFTWARE_MAX_FPS, maxFPS: SOFTWARE_MAX_FPS } : null;
}

/**
 * Tells the style sheets which kind of renderer drew the page: `<html data-renderer="software">`
 * turns the panels' frosted blur off (`aquarian.css`, "Panels"), since a live blur of a canvas that
 * already costs hundreds of milliseconds a frame is too dear. A GPU gets "gpu" and changes nothing.
 */
export function markRenderer(root: HTMLElement, software: boolean): void {
  root.dataset.renderer = software ? "software" : "gpu";
}

/** The unmasked renderer name of `gl`, or null where the browser withholds it. */
export function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext | undefined): string | null {
  if (gl === undefined) return null;
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}
