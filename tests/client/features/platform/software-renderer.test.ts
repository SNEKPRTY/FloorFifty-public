import { describe, expect, it } from "vitest";
import {
  SOFTWARE_MAX_FPS,
  isSoftwareRenderer,
  markRenderer,
  softwareFrameCap,
} from "../../../../apps/client/src/features/platform/software-renderer";

describe("isSoftwareRenderer", () => {
  it("names the CPU rasterisers a browser falls back to", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(true);
    expect(isSoftwareRenderer("softpipe")).toBe(true);
  });

  it("leaves every real GPU alone", () => {
    expect(isSoftwareRenderer("ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA NVIDIA RTX A4000))")).toBe(false);
    expect(isSoftwareRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)")).toBe(false);
    expect(isSoftwareRenderer("Adreno (TM) 730")).toBe(false);
    expect(isSoftwareRenderer("Apple GPU")).toBe(false);
  });

  it("assumes a GPU when the browser will not say", () => {
    expect(isSoftwareRenderer(null)).toBe(false);
    expect(isSoftwareRenderer("")).toBe(false);
  });
});

describe("softwareFrameCap", () => {
  it("caps a software renderer below what one of its frames costs, and nothing else", () => {
    expect(softwareFrameCap(true)).toEqual({ minFPS: SOFTWARE_MAX_FPS, maxFPS: SOFTWARE_MAX_FPS });
    expect(softwareFrameCap(false)).toBeNull();
  });

  it("is a cap Pixi will keep: its maxFPS never goes below minFPS", () => {
    const cap = softwareFrameCap(true)!;
    expect(cap.maxFPS).toBeGreaterThanOrEqual(cap.minFPS);
    expect(SOFTWARE_MAX_FPS).toBeLessThan(10);
  });

  it("draws one frame a second, not two", () => {
    // Two frames a second kept the page's main thread waiting on the copy-back with
    // three pages on four cores (2 rAF a second, a click 4s); one left it free (2026-11-18).
    expect(softwareFrameCap(true)).toEqual({ minFPS: 1, maxFPS: 1 });
  });
});

describe("markRenderer", () => {
  it("marks the page's root so the panels drop their blur on a software renderer", () => {
    const root = document.createElement("html");
    markRenderer(root, true);
    expect(root.dataset.renderer).toBe("software");
    markRenderer(root, false);
    expect(root.dataset.renderer).toBe("gpu");
  });
});
