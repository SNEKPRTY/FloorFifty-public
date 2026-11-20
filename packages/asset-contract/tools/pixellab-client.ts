/**
 * A minimal PixelLab API client.
 *
 * One endpoint is wrapped: a single pixel-art image. Everything else the
 * service offers is deliberately absent, because an unused wrapper is a thing
 * that rots -- which is why `animate-with-text` is gone. Character poses are
 * stills now, so nothing called it, and its frames were locked to 64 x 64,
 * which put the brief's size band out of reach at integer scale.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = "https://api.pixellab.ai/v1";

/** The largest image `generate-image-pixflux` will return. */
export const MAX_IMAGE_SIZE = 400;

export type Base64Image = { type: "base64"; base64: string };

/**
 * Reads the key from `.env.local`.
 *
 * Deliberately file-based rather than process-wide: the key is a local
 * credential for a manual procurement step, and it must never end up in a
 * committed script, a CI environment, or a shell history.
 */
export function readApiKey(repoRoot: string): string {
  const envPath = resolve(repoRoot, ".env.local");
  let contents: string;
  try {
    contents = readFileSync(envPath, "utf8");
  } catch {
    throw new Error(`no .env.local at ${envPath}; PIXELLAB_API_KEY is required to generate art`);
  }

  const line = contents.split("\n").find((entry) => entry.startsWith("PIXELLAB_API_KEY="));
  const key = line?.slice("PIXELLAB_API_KEY=".length).trim();
  if (!key) throw new Error("PIXELLAB_API_KEY is missing from .env.local");
  return key;
}

async function post<T>(key: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`PixelLab ${path} failed (${response.status}): ${detail.slice(0, 400)}`);
  }
  return (await response.json()) as T;
}

export type GenerateOptions = {
  description: string;
  width: number;
  height: number;
  /** Transparent background. Required for anything that is not a full plate. */
  noBackground?: boolean;
  /**
   * A PNG whose pixels constrain the output palette.
   *
   * Mandatory for anything that ships. Measured on three stills and a
   * four-frame animation: constrained, 100% of opaque pixels come back exactly
   * on-palette with zero drift; unconstrained, 0% do, and quantizing the
   * result collapsed ten distinct colours to five. The quantizer cannot
   * recover shading it has already merged.
   */
  colorImage?: Base64Image;
  /** Fixed so a regeneration reproduces the reviewed asset. */
  seed: number;
};

/** Generates one pixel-art image. */
export async function generateImage(key: string, options: GenerateOptions): Promise<Buffer> {
  if (options.width > MAX_IMAGE_SIZE || options.height > MAX_IMAGE_SIZE) {
    throw new Error(
      `PixelLab caps generated images at ${MAX_IMAGE_SIZE}px; ` +
        `${options.width}x${options.height} must be composed from tiles instead`,
    );
  }

  const result = await post<{ image: Base64Image }>(key, "/generate-image-pixflux", {
    description: options.description,
    image_size: { width: options.width, height: options.height },
    no_background: options.noBackground ?? true,
    seed: options.seed,
    ...(options.colorImage ? { color_image: options.colorImage } : {}),
  });

  return Buffer.from(result.image.base64, "base64");
}
