/**
 * The browser is drawing on a GPU.
 *
 * Every spec in this suite assumes it, and the failure mode when it is not
 * true is slow and confusing: SwiftShader reaches the title in over a minute,
 * so specs time out one by one instead of saying why. This spec says why, once,
 * first. It also records how long the title took, which is the spike's
 * measure, so a slow runner shows up in the report before it shows up as flakes.
 */

import { expect, test } from "./support/test";
import { openTitle } from "./support/room-driver";

test("the browser draws WebGL on a real GPU", async ({ page }, testInfo) => {
  const started = Date.now();
  await openTitle(page);
  const toTitleMs = Date.now() - started;

  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl === null) return "no webgl";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return info === null ? String(gl.getParameter(gl.RENDERER)) : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  });

  testInfo.annotations.push(
    { type: "renderer", description: renderer },
    { type: "to-title-ms", description: String(toTitleMs) },
  );
  expect(renderer).not.toMatch(/swiftshader|llvmpipe|softpipe|software|no webgl/i);
});
