/**
 * The art manifest schema.
 *
 * The manifest is the contract between PixelLab output and the renderer, and
 * now between an authored track and the mixer. Art and audio share only
 * identity and provenance: an audio row has no pixel size, no alpha, and no
 * palette, so it is built from the shared identity rather than from
 * `baseAssetSchema`, and the two halves are told apart by `role` everywhere
 * they are consumed.
 *
 * Duration and loop points appear here as well as in the song's content file,
 * and they answer different questions. The manifest says what the file on disk
 * contains; the song says which part of it an authored stage loops. Validation
 * checks the second against the first, which is what catches a re-export that
 * silently shortened the track.
 */

import { z } from "zod";
import { PLAYER_COLORS, ROLES } from "./roles";

/**
 * The bundles every manifest carries.
 *
 * `splash` is the splash screen's own art, alone, so the first screen can draw
 * it before the menu bundle it is showing the progress of has arrived. `shell`
 * is the select art and every character, loaded behind the ready room (select
 * spec §6.5), so boot time does not grow as packs are added. `reveal` is the
 * song covers at the reveal's full-frame size: never loaded as a bundle, only
 * fetched by URL for the one song a reveal lands on, so ten large covers
 * never sit in texture memory.
 */
export const CORE_BUNDLES = ["splash", "menu", "shell", "gameplay", "audio", "reveal"] as const;
export type CoreBundle = (typeof CORE_BUNDLES)[number];
/** A core bundle, one stage's layer art, or one song's audio. */
export type BundleName = CoreBundle | `stage-${string}` | `song-${string}`;
/** The core bundles; per-stage and per-song bundles are named by scheme. */
export const BUNDLE_NAMES = CORE_BUNDLES;

/** The bundle holding one stage's layer art and platform. */
export const stageBundle = (stageId: string): `stage-${string}` => `stage-${stageId}`;

/**
 * Bundles that carry no assets yet.
 *
 * Listing one here is a statement that its emptiness is intended, which is what
 * separates "not authored yet" from "the export dropped the files".
 *
 * Nothing is listed any more. `menu` was empty while the menu and the results
 * were built from HTML and the renderer's own text; the Resurrect Arcade
 * direction gave it a title plate and a backdrop. `audio` was empty until the
 * Exceptional Race Slice authored its stage loop. An empty bundle is now
 * always a missing export.
 */
export const KNOWN_EMPTY_BUNDLES: readonly BundleName[] = [];

/** Animations every character sheet must declare. A missing one is a parse error. */
export const REQUIRED_CHARACTER_ANIMATIONS = ["idle", "run", "jump", "fall", "land"] as const;

const paletteRoleSchema = z.enum([
  ...(Object.keys(ROLES) as [string, ...string[]]),
  ...(Object.keys(PLAYER_COLORS) as string[]),
]);

/**
 * Where an asset came from and how to make it again.
 *
 * An asset nobody can regenerate is an asset nobody can fix, so the prompt
 * travels with the manifest rather than in someone's shell history.
 */
const provenanceSchema = z
  .object({
    tool: z.string().min(1),
    prompt: z.string().min(1),
    source: z.string().min(1),
    license: z.string().min(1),
    /**
     * Set when the file was moved onto the palette after generation. Without
     * it the prompt above no longer reproduces the bytes on disk.
     */
    quantizedTo: z.literal("resurrect-64").optional(),
    /**
     * Set on art that stands in for a hand-authored asset still to come, so
     * the art pass can find every one of them from the manifest alone.
     */
    status: z.literal("placeholder").optional(),
  })
  .strict();

const animationSchema = z
  .object({
    frames: z.number().int().positive(),
    durationMs: z.number().int().positive(),
  })
  .strict();

/** What every asset carries, whatever a player does with it. */
const assetIdentity = {
  alias: z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/, "alias must be group.name"),
  file: z.string().min(1),
  provenance: provenanceSchema,
};

const baseAssetSchema = z.object({
  ...assetIdentity,
  /** Frame size for a sheet, image size otherwise. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Sprites must be cut out; only the sky plate is allowed to be opaque. */
  requiresAlpha: z.boolean(),
  paletteRoles: z.array(paletteRoleSchema).min(1),
  /**
   * How much sub-two-pixel detail this asset is entitled to, and why.
   *
   * See `pixel-grain.ts`. Omitted means the default, which is what a plate
   * that has been through the simplification passes measures. An asset that
   * genuinely needs finer detail -- a character's one-pixel eyes, a nine-slice
   * frame's one-pixel border, an ordered dither -- raises the budget here.
   *
   * `because` is required, and required to be a sentence rather than a word.
   * A budget that could be raised silently would be a mute button, and the
   * whole point of the check is that skipping the simplification passes should
   * cost somebody an explanation rather than nothing at all.
   */
  maxGrain: z
    .object({ budget: z.number().min(0).max(1), because: z.string().min(30) })
    .strict()
    .optional(),
});

const characterAssetSchema = baseAssetSchema
  .extend({
    role: z.literal("character"),
    animations: z.record(z.string(), animationSchema),
  })
  .strict()
  .superRefine((asset, context) => {
    for (const animation of REQUIRED_CHARACTER_ANIMATIONS) {
      if (asset.animations[animation] !== undefined) continue;
      context.addIssue({
        code: "custom",
        path: ["animations", animation],
        message: `character sheet ${asset.alias} is missing the required "${animation}" animation`,
      });
    }
  });

const sheetAssetSchema = baseAssetSchema
  .extend({
    role: z.literal("sheet"),
    animations: z.record(z.string(), animationSchema),
  })
  .strict();

const imageAssetSchema = baseAssetSchema
  .extend({
    role: z.literal("image"),
    /**
     * The strip repeats across the width, so its two edge columns must agree
     * about what is drawn: `validate-assets.ts` holds it to `SEAM_TOLERANCE`.
     */
    tilesHorizontally: z.literal(true).optional(),
    /**
     * A stage's full-frame sky. A tall screen repeats its top and bottom bands
     * (`SKY_BAND_ROWS`), so each band must be two identical halves.
     */
    skyPlate: z.literal(true).optional(),
  })
  .strict();

/** A fixed grid of equally sized cells: a bitmap font page, an icon sheet, a
 *  touch-button strip. Cells are addressed by index, not by animation name. */
const gridAssetSchema = baseAssetSchema
  .extend({
    role: z.literal("grid"),
    columns: z.number().int().positive(),
    rows: z.number().int().positive(),
  })
  .strict();

/**
 * One decodable track.
 *
 * `loopStartMs`/`loopEndMs` describe the region the mixer repeats, measured on
 * the decoded timeline rather than on the compressed file, because that is the
 * only timeline a Web Audio buffer has. A container whose decode is not
 * sample-aligned with its source would invalidate them, so the delivery encode
 * is verified against the source before these numbers are written down.
 *
 * `loudnessLufs` is integrated loudness to ITU-R BS.1770. It is recorded rather
 * than enforced: the mix is judged by ear at the review gate, and a number here
 * is what makes "quieter than the effects" a measurement instead of an opinion.
 */
const audioAssetSchema = z
  .object({
    ...assetIdentity,
    role: z.literal("audio"),
    /** A media type a browser can be asked about, e.g. `audio/mp4`. */
    codec: z.string().min(1),
    sampleRate: z.number().int().positive(),
    channels: z.number().int().positive(),
    durationMs: z.number().int().positive(),
    loudnessLufs: z.number().finite().negative(),
    /**
     * The file's sample peak in dBFS, measured from the file that ships
     * (`pnpm assets:measure`). One-shots are held to −1 by a test (polish
     * spec §8.1); music and beds record it beside their loudness.
     */
    peakDbfs: z.number().finite().max(0).optional(),
    /**
     * The region the mixer repeats, or nothing.
     *
     * Absent on a one-shot, which is what a landing or a countdown beep is:
     * there is no region to repeat, and writing the whole file in as a loop it
     * never takes would be a fact the manifest asserts and nothing honours.
     */
    loopStartMs: z.number().int().min(0).optional(),
    loopEndMs: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((asset, context) => {
    if (asset.loopStartMs === undefined || asset.loopEndMs === undefined) return;
    if (asset.loopStartMs >= asset.loopEndMs)
      context.addIssue({
        code: "custom",
        path: ["loopEndMs"],
        message: "must be greater than loopStartMs",
      });
    if (asset.loopEndMs > asset.durationMs)
      context.addIssue({
        code: "custom",
        path: ["loopEndMs"],
        message: `loop ends past the file: ${asset.loopEndMs}ms of ${asset.durationMs}ms`,
      });
  });

/**
 * A song's jukebox cover: smooth, owner-supplied UI art in WebP, so neither
 * the Resurrect 64 lock nor the grain budget applies (stage, song and
 * character select spec §8). The gate checks its size from the file's header.
 */
const coverAssetSchema = z
  .object({
    ...assetIdentity,
    role: z.literal("cover"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const assetSchema = z.discriminatedUnion("role", [
  characterAssetSchema,
  sheetAssetSchema,
  imageAssetSchema,
  gridAssetSchema,
  audioAssetSchema,
  coverAssetSchema,
]);

export const artManifestSchema = z
  .object({
    version: z.number().int().positive(),
    brief: z.string().min(1),
    bundles: z
      .record(
        z
          .string()
          .regex(
            /^(splash|menu|shell|gameplay|audio|reveal|stage-[a-z0-9-]+|song-[a-z0-9-]+)$/,
            "a bundle is a core bundle, stage-<id> or song-<id>",
          ),
        z.array(assetSchema),
      )
      .superRefine((bundles, context) => {
        for (const core of CORE_BUNDLES)
          if (bundles[core] === undefined)
            context.addIssue({ code: "custom", path: [core], message: `missing bundle ${core}` });
      })
      // Every core bundle is present once the refinement passes, so readers
      // may index them without a check; a stage's or song's may be absent.
      .transform(
        (bundles) =>
          bundles as Record<CoreBundle, ArtAssetRow[]> &
            Partial<Record<`stage-${string}` | `song-${string}`, ArtAssetRow[]>>,
      ),
  })
  .strict()
  .superRefine((manifest, context) => {
    // A duplicate alias silently shadows an asset at load time, so it is caught
    // across the whole manifest rather than per bundle.
    const seen = new Set<string>();
    for (const [bundle, assets] of Object.entries(manifest.bundles)) {
      for (const asset of assets ?? []) {
        if (seen.has(asset.alias)) {
          context.addIssue({
            code: "custom",
            path: ["bundles", bundle],
            message: `duplicate asset alias: ${asset.alias}`,
          });
        }
        seen.add(asset.alias);
      }
    }
  });

type ArtAssetRow = z.infer<typeof assetSchema>;
export type ArtAsset = ArtAssetRow;
export type ArtManifest = z.infer<typeof artManifestSchema>;

/** An audio row. Nothing about it has pixels. */
export type AudioAsset = Extract<ArtAsset, { role: "audio" }>;

/** A song's cover. It has pixels, but no palette and no grain budget. */
export type CoverAsset = Extract<ArtAsset, { role: "cover" }>;

/**
 * An asset that renders as palette-locked PNG art.
 *
 * Every pixel rule -- dimensions, alpha, palette conformance -- is expressed
 * against this type rather than against `ArtAsset`, so adding a second
 * non-visual role later cannot silently reach a check that assumes a PNG. A
 * cover renders too, but as a WebP outside the palette, so it is left out
 * with audio and checked on its own.
 */
export type VisualAsset = Exclude<ArtAsset, AudioAsset | CoverAsset>;

export const isAudioAsset = (asset: ArtAsset): asset is AudioAsset => asset.role === "audio";
export const isCoverAsset = (asset: ArtAsset): asset is CoverAsset => asset.role === "cover";
export const isVisualAsset = (asset: ArtAsset): asset is VisualAsset => asset.role !== "audio" && asset.role !== "cover";

/** Raised when a manifest does not describe a loadable asset set. */
export class ArtManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtManifestError";
  }
}

/** Parses an untrusted manifest, reporting the first problem in full. */
export function parseArtManifest(value: unknown): ArtManifest {
  const result = artManifestSchema.safeParse(value);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue?.path.join(".") ?? "manifest";
  throw new ArtManifestError(`${path}: ${issue?.message ?? "invalid art manifest"}`);
}

/** Every asset in the manifest, paired with the bundle that owns it. */
export function allAssets(manifest: ArtManifest): { bundle: BundleName; asset: ArtAsset }[] {
  return (Object.entries(manifest.bundles) as [BundleName, ArtAsset[]][]).flatMap(([bundle, assets]) =>
    assets.map((asset) => ({ bundle, asset })),
  );
}

/**
 * The pixel dimensions a file must have to satisfy its declaration.
 *
 * A sheet is one row per animation and one column per frame of the longest
 * animation; a glyph page is its grid; an image is itself.
 */
export function expectedFileSize(asset: VisualAsset): { width: number; height: number } {
  if (asset.role === "character" || asset.role === "sheet") {
    const animations = Object.values(asset.animations);
    const columns = Math.max(...animations.map((animation) => animation.frames));
    return { width: asset.width * columns, height: asset.height * animations.length };
  }
  if (asset.role === "grid") {
    return { width: asset.width * asset.columns, height: asset.height * asset.rows };
  }
  return { width: asset.width, height: asset.height };
}
