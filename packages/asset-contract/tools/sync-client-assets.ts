/**
 * `pnpm assets:sync`.
 *
 * Copies the approved art into the client's served directory and derives the
 * Pixi asset manifest from the art manifest.
 *
 * The Pixi manifest is generated rather than hand-written so there is exactly
 * one source of truth for an alias. A hand-maintained second copy would drift,
 * and the first sign of the drift would be a missing texture at runtime rather
 * than a failing check.
 */

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { parseArtManifest, allAssets, type ArtAsset } from "../src/manifest-schema";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const ASSET_ROOT = resolve(PACKAGE_ROOT, "assets");
const CLIENT_ASSETS = resolve(PACKAGE_ROOT, "..", "..", "apps", "client", "public", "assets");

/** The palette-lock lookup texture, one texel per swatch. */
const PALETTE_LUT = "palette-lut.png";

/**
 * Everything a screen needs about an asset, carried on the Pixi bundle entry.
 *
 * Pixi passes `data` through to the loaded resource, so a view can read a
 * sheet's frame size and animation rows without a second lookup.
 */
function assetData(asset: ArtAsset): Record<string, unknown> {
  // An audio row shares nothing with the visual ones but its identity, so it
  // carries what a mixer needs -- the decoded length and the region to repeat
  // -- rather than a frame size it has no meaning for.
  if (asset.role === "audio") {
    return {
      role: asset.role,
      codec: asset.codec,
      sampleRate: asset.sampleRate,
      channels: asset.channels,
      durationMs: asset.durationMs,
      loudnessLufs: asset.loudnessLufs,
      loopStartMs: asset.loopStartMs,
      loopEndMs: asset.loopEndMs,
    };
  }

  // A cover carries its size and nothing else: it has no palette roles.
  if (asset.role === "cover") return { role: asset.role, frameWidth: asset.width, frameHeight: asset.height };
  if (asset.role === "demo") return { role: asset.role, kind: asset.kind, frameWidth: asset.width, frameHeight: asset.height };

  const common = {
    frameWidth: asset.width,
    frameHeight: asset.height,
    paletteRoles: asset.paletteRoles,
  };
  if (asset.role === "character" || asset.role === "sheet") {
    return { ...common, role: asset.role, animations: asset.animations };
  }
  if (asset.role === "grid") {
    return { ...common, role: asset.role, columns: asset.columns, rows: asset.rows };
  }
  return { ...common, role: asset.role };
}

function main(): void {
  const manifest = parseArtManifest(
    JSON.parse(readFileSync(resolve(ASSET_ROOT, "art-manifest.json"), "utf8")),
  );

  rmSync(CLIENT_ASSETS, { recursive: true, force: true });
  mkdirSync(resolve(CLIENT_ASSETS, "production"), { recursive: true });

  // The palette-lock shader's lookup texture. Copied explicitly rather than
  // declared as a manifest row: it is a lookup table, not art, and nothing in
  // the contract's schema -- frame size, palette roles, provenance -- describes
  // what it is or could validate it.
  copyFileSync(resolve(ASSET_ROOT, PALETTE_LUT), resolve(CLIENT_ASSETS, PALETTE_LUT));

  const bundles = new Map<string, { alias: string[]; src: string; data: unknown }[]>();

  for (const { bundle, asset } of allAssets(manifest)) {
    // Each file's own parent, not one fixed directory: the manifest addresses
    // assets by a path, and a path can nest. The cue set lives a level deeper
    // than the art, and a single `production/` was silently enough until it did.
    const destination = resolve(CLIENT_ASSETS, asset.file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(ASSET_ROOT, asset.file), destination);

    const entries = bundles.get(bundle) ?? [];
    entries.push({ alias: [asset.alias], src: `assets/${asset.file}`, data: assetData(asset) });
    bundles.set(bundle, entries);
  }

  // Every bundle is declared even when empty, so a screen can await one whose
  // rows a later initiative adds without changing.
  const pixiManifest = {
    bundles: Object.keys(manifest.bundles).map((name) => ({
      name,
      assets: bundles.get(name) ?? [],
    })),
  };

  writeFileSync(
    resolve(CLIENT_ASSETS, "manifest.json"),
    `${JSON.stringify(pixiManifest, null, 2)}\n`,
  );

  process.stdout.write(
    `synced ${allAssets(manifest).length} assets and the palette lookup into ` +
      `apps/client/public/assets\n`,
  );
}

main();
