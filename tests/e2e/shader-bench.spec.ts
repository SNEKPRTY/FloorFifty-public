import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./support/test";
import { RESURRECT64, swatchRgb } from "../../packages/asset-contract/src/swatches";
import { CELL_TEXTURE, paletteCellTable } from "../../apps/client/src/features/render/filters/palette-cells";

/**
 * A filter's fragment shader, as it stands against a git ref, on the GPU.
 *
 * The frame probe (`perf-probe.spec.ts`) times whole frames, and on a busy
 * machine two builds measured minutes apart differ by more than one shader
 * change is worth. This bench puts both programs in one page and alternates
 * them, so the comparison shares every condition. It also reads both outputs
 * back and compares them byte for byte, on the game's own art and on noise,
 * which is the evidence that a change is pixel-identical.
 *
 *   FLOOR_FIFTY_BENCH_BASE=main pnpm exec playwright test tests/e2e/shader-bench.spec.ts --project=perf-probe
 *
 * A measurement, not a gate; the identity check is the one assertion.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const BASE = process.env["FLOOR_FIFTY_BENCH_BASE"] ?? "HEAD";
const PALETTE_LOCK = "apps/client/src/features/render/filters/palette-lock.ts";

function fragmentFrom(source: string, name: string): string {
  const match = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(source);
  if (match === null) throw new Error(`no ${name} in the source`);
  return match[1]!;
}

function atRef(path: string): string {
  return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8" });
}

const dataUrl = (path: string): string => `data:image/png;base64,${readFileSync(path).toString("base64")}`;

test("palette lock: the working tree against the base, on the GPU", async ({ page }) => {
  test.setTimeout(400_000);
  const before = fragmentFrom(atRef(PALETTE_LOCK), "FRAGMENT");
  const after = fragmentFrom(readFileSync(resolve(ROOT, PALETTE_LOCK), "utf8"), "FRAGMENT");
  const assets = resolve(ROOT, "apps/client/public/assets");
  const art = readdirSync(resolve(assets, "production"))
    .filter((name) => name.endsWith(".png"))
    .sort()
    .map((name) => dataUrl(resolve(assets, "production", name)));

  await page.setContent("<canvas></canvas>");
  const result = await page.evaluate(
    async ({ before, after, palette, art, swatches, cells, cellSize }) => {
      const width = 780;
      const height = 1688;
      const canvas = document.querySelector("canvas")!;
      canvas.width = width;
      canvas.height = height;
      const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false })!;

      const load = (src: string) =>
        new Promise<HTMLImageElement>((done, fail) => {
          const image = new Image();
          image.onload = () => done(image);
          image.onerror = fail;
          image.src = src;
        });

      const texture = (source: TexImageSource | null, w: number, h: number, pixels?: Uint8Array) => {
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        if (source !== null) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels ?? null);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        for (const [key, value] of [
          [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
          [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
          [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
          [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
        ] as const) {
          gl.texParameteri(gl.TEXTURE_2D, key, value);
        }
        return tex;
      };

      // The game's art, tiled over the frame the way a race's composite is
      // covered: opaque pixel art with transparent gaps.
      const sheet = document.createElement("canvas");
      sheet.width = width;
      sheet.height = height;
      const ctx = sheet.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      let x = 0;
      let y = 0;
      let row = 0;
      for (const src of art) {
        const image = await load(src);
        const w = Math.min(image.width, width);
        const h = Math.min(image.height, 400);
        if (x + w > width) {
          x = 0;
          y += row;
          row = 0;
        }
        if (y >= height) {
          x = 0;
          y = 0;
        }
        ctx.drawImage(image, 0, 0, w, h, x, y, w, h);
        x += w;
        row = Math.max(row, h);
      }
      const artTex = texture(sheet, width, height);

      // Noise: every channel random, alpha 0, 1 or anything between.
      const noise = new Uint8Array(width * height * 4);
      let seed = 1;
      const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) & 0xff;
      for (let i = 0; i < noise.length; i += 4) {
        const pick = random() % 3;
        const a = pick === 0 ? 0 : pick === 1 ? 255 : random();
        // Premultiplied, as Pixi's targets are.
        noise[i] = Math.round((random() * a) / 255);
        noise[i + 1] = Math.round((random() * a) / 255);
        noise[i + 2] = Math.round((random() * a) / 255);
        noise[i + 3] = a;
      }
      const noiseTex = texture(null, width, height, noise);
      const paletteImage = await load(palette);
      const paletteTex = texture(paletteImage, 64, 1);
      // The cell table, for a program that searches by cell (palette-cells.ts).
      const cellsTex = texture(null, cellSize.width, cellSize.height, new Uint8Array(cells));
      // The asset contract's swatches as unit channels, for a program that
      // takes the palette as a uniform array (what `paletteChannels` builds).
      const swatchValues = new Float32Array(swatches.flatMap(([r, g, b]) => [r / 255, g / 255, b / 255]));
      // And checked against the lookup texture's own bytes: the two forms of
      // the palette must agree, or the comparison is between two palettes.
      const lutCanvas = document.createElement("canvas");
      lutCanvas.width = 64;
      lutCanvas.height = 1;
      const lutContext = lutCanvas.getContext("2d")!;
      lutContext.drawImage(paletteImage, 0, 0);
      const lutBytes = lutContext.getImageData(0, 0, 64, 1).data;
      let lutMismatches = 0;
      swatches.forEach(([r, g, b], i) => {
        if (lutBytes[i * 4] !== r || lutBytes[i * 4 + 1] !== g || lutBytes[i * 4 + 2] !== b) lutMismatches += 1;
      });

      const vertex = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;
void main() {
  vTextureCoord = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
      const compile = (fragment: string) => {
        const program = gl.createProgram()!;
        for (const [type, source] of [
          [gl.VERTEX_SHADER, vertex],
          [gl.FRAGMENT_SHADER, fragment],
        ] as const) {
          const shader = gl.createShader(type)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "compile");
          gl.attachShader(program, shader);
        }
        gl.bindAttribLocation(program, 0, "aPosition");
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
        return program;
      };
      const programs = { before: compile(before), after: compile(after) };

      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      // Two targets, alternated draw by draw. Each switch ends a render pass, as
      // each of Pixi's filter passes does; drawing into one target forty times
      // would let a tile-based GPU shade only the last of forty opaque quads.
      const fbos = [0, 1].map(() => {
        const fbo = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture(null, width, height), 0);
        return fbo;
      });
      let flip = 0;
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);

      type Mood = { tint: number[]; mix: number; ceil: number[] };
      const draw = (program: WebGLProgram, input: WebGLTexture, mood: Mood) => {
        flip = 1 - flip;
        drawInto(program, input, mood, fbos[flip]!, width, height);
      };
      const drawInto = (program: WebGLProgram, input: WebGLTexture, mood: Mood, fbo: WebGLFramebuffer, w: number, h: number) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, cellsTex);
        const cellsAt = gl.getUniformLocation(program, "uCells");
        if (cellsAt !== null) gl.uniform1i(cellsAt, 2);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, input);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, paletteTex);
        gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);
        // A sampler (the lookup texture) or an array of 64 (the uniforms).
        const lut = gl.getUniformLocation(program, "uPalette");
        if (lut !== null) {
          const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
          let type = 0;
          for (let i = 0; i < count; i += 1) {
            const info = gl.getActiveUniform(program, i);
            if (info?.name.startsWith("uPalette")) type = info.type;
          }
          if (type === gl.FLOAT_VEC3) gl.uniform3fv(lut, swatchValues);
          else gl.uniform1i(lut, 1);
        }
        gl.uniform3fv(gl.getUniformLocation(program, "uMoodTint"), mood.tint);
        gl.uniform1f(gl.getUniformLocation(program, "uMoodMix"), mood.mix);
        gl.uniform3fv(gl.getUniformLocation(program, "uMoodCeil"), mood.ceil);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      const read = () => {
        const out = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return out;
      };

      const moods: Record<string, Mood> = {
        rest: { tint: [1, 1, 1], mix: 0, ceil: [1, 1, 1] },
        storm: { tint: [0.7, 0.75, 0.9], mix: 0.6, ceil: [1, 1, 1] },
        flash: { tint: [1.2, 1.15, 1.05], mix: 1, ceil: [0.9, 0.85, 0.8] },
      };
      const inputs = { art: artTex, noise: noiseTex };

      const identity: Record<string, number> = {};
      for (const [inputName, input] of Object.entries(inputs)) {
        for (const [moodName, mood] of Object.entries(moods)) {
          draw(programs.before, input, mood);
          const a = read();
          draw(programs.after, input, mood);
          const b = read();
          let differing = 0;
          for (let i = 0; i < a.length; i += 4) {
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) differing += 1;
          }
          identity[`${inputName}/${moodName}`] = differing;
        }
      }

      let lowAlpha: { checked: number; examples: string[] } = { checked: 0, examples: [] };
      // Every opaque 8-bit colour, 4096 x 4096, in four strips: the bulk of a
      // frame is opaque, so this is the input space nearly every pixel is in.
      {
        const stripWidth = 4096;
        const stripHeight = 1024;
        const target = texture(null, stripWidth, stripHeight);
        const fbo = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
        const pixels = new Uint8Array(stripWidth * stripHeight * 4);
        const a = new Uint8Array(pixels.length);
        const b = new Uint8Array(pixels.length);
        for (const moodName of ["rest", "storm"]) {
          let differing = 0;
          for (let strip = 0; strip < 4; strip += 1) {
            for (let i = 0; i < stripWidth * stripHeight; i += 1) {
              const colour = strip * stripWidth * stripHeight + i;
              pixels[i * 4] = colour >> 16;
              pixels[i * 4 + 1] = (colour >> 8) & 0xff;
              pixels[i * 4 + 2] = colour & 0xff;
              pixels[i * 4 + 3] = 255;
            }
            const input = texture(null, stripWidth, stripHeight, pixels);
            drawInto(programs.before, input, moods[moodName]!, fbo, stripWidth, stripHeight);
            gl.readPixels(0, 0, stripWidth, stripHeight, gl.RGBA, gl.UNSIGNED_BYTE, a);
            drawInto(programs.after, input, moods[moodName]!, fbo, stripWidth, stripHeight);
            gl.readPixels(0, 0, stripWidth, stripHeight, gl.RGBA, gl.UNSIGNED_BYTE, b);
            gl.deleteTexture(input);
            for (let i = 0; i < a.length; i += 4) {
              if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) differing += 1;
            }
          }
          identity[`every-opaque-colour/${moodName}`] = differing;
        }

        // And every premultiplied colour at the low alphas, 1 to 48: a soft
        // edge or a haze, where unpremultiplying leaves coarse colours that sit
        // on ties and past the cube's faces.
        const examples: string[] = [];
        let differing = 0;
        let index = 0;
        let filled = 0;
        const flush = (): void => {
          if (filled === 0) return;
          const input = texture(null, stripWidth, stripHeight, pixels);
          drawInto(programs.before, input, moods["rest"]!, fbo, stripWidth, stripHeight);
          gl.readPixels(0, 0, stripWidth, stripHeight, gl.RGBA, gl.UNSIGNED_BYTE, a);
          drawInto(programs.after, input, moods["rest"]!, fbo, stripWidth, stripHeight);
          gl.readPixels(0, 0, stripWidth, stripHeight, gl.RGBA, gl.UNSIGNED_BYTE, b);
          gl.deleteTexture(input);
          for (let i = 0; i < filled * 4; i += 4) {
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
              differing += 1;
              if (examples.length < 8) {
                examples.push(`in ${[...pixels.slice(i, i + 4)]} before ${[...a.slice(i, i + 4)]} after ${[...b.slice(i, i + 4)]}`);
              }
            }
          }
          pixels.fill(0);
          filled = 0;
        };
        for (let alpha = 1; alpha <= 48; alpha += 1) {
          for (let r = 0; r <= alpha; r += 1) {
            for (let g = 0; g <= alpha; g += 1) {
              for (let bl = 0; bl <= alpha; bl += 1) {
                pixels.set([r, g, bl, alpha], filled * 4);
                filled += 1;
                index += 1;
                if (filled === stripWidth * stripHeight) flush();
              }
            }
          }
        }
        flush();
        identity["low-alpha/rest"] = differing;
        lowAlpha = { checked: index, examples };
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(target);
      }

      // Timed: alternating rounds of 40 draws, each round closed by a sync.
      const timing: Record<string, { before: number; after: number }> = {};
      const sync = new Uint8Array(4);
      for (const [inputName, input] of Object.entries(inputs)) {
        for (const moodName of ["rest", "storm"]) {
          const mood = moods[moodName]!;
          const samples = { before: [] as number[], after: [] as number[] };
          for (let round = 0; round < 16; round += 1) {
            for (const name of round % 2 === 0 ? (["before", "after"] as const) : (["after", "before"] as const)) {
              gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
              const start = performance.now();
              for (let i = 0; i < 40; i += 1) draw(programs[name], input, mood);
              gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
              samples[name].push((performance.now() - start) / 40);
            }
          }
          const median = (values: number[]) => [...values].sort((p, q) => p - q)[Math.floor(values.length / 2)]!;
          timing[`${inputName}/${moodName}`] = { before: median(samples.before), after: median(samples.after) };
        }
      }
      return { identity, timing, size: `${width}x${height}`, lutMismatches, lowAlpha };
    },
    { before, after, palette: dataUrl(resolve(assets, "palette-lut.png")), art,
      swatches: RESURRECT64.map((_, index) => [...swatchRgb(index)] as [number, number, number]),
      cells: [...paletteCellTable(RESURRECT64.map((_, index) => swatchRgb(index).map((channel) => channel / 255) as [number, number, number]))],
      cellSize: CELL_TEXTURE,
    },
  );

  console.log(`palette lock against ${BASE}, ${result.size} per draw:`);
  for (const [name, { before, after }] of Object.entries(result.timing)) {
    console.log(`  ${name.padEnd(12)} before ${before.toFixed(3)}ms  after ${after.toFixed(3)}ms  (${((after / before - 1) * 100).toFixed(0)}%)`);
  }
  console.log(`  differing pixels: ${JSON.stringify(result.identity)}`);
  console.log(`  low alphas: ${result.lowAlpha.checked} colours checked${result.lowAlpha.examples.map((line) => `\n    ${line}`).join("")}`);
  expect(result.lutMismatches, "the lookup texture and the asset contract hold the same 64 swatches").toBe(0);
  for (const [name, differing] of Object.entries(result.identity)) {
    expect(differing, `${name}: the change is pixel-identical`).toBe(0);
  }
});
