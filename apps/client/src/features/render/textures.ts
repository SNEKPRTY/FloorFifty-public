/**
 * Texture lookup.
 *
 * A port rather than a direct call into Pixi's asset cache, so a view can be
 * tested without a renderer, a decode, or a network fetch. Views address art by
 * manifest alias and never by file.
 */

import { Assets, Texture, Rectangle } from "pixi.js";

export type TextureProvider = (alias: string) => Texture;

/** One animation row, as the art manifest declares it. */
export type SheetAnimation = { frames: number; durationMs: number };

/** A sheet's animation table, as the art manifest declares it. */
export type SheetAnimations = Readonly<Record<string, SheetAnimation>>;

/**
 * Reads a sheet's animation table by alias.
 *
 * A second port beside `TextureProvider` for the same reason as the first: the
 * frame counts and cycle lengths are the art manifest's to declare, and a view
 * that hardcoded them would keep playing yesterday's timing after the artist
 * changed it. `sync-client-assets` already carries the table through to the
 * Pixi manifest as bundle `data`; this is where a view reads it back.
 */
export type SheetDataProvider = (alias: string) => SheetAnimations | undefined;

/**
 * What happens when a view asks for a texture nobody loaded.
 *
 * - `throw` (development): the screen was built before its bundle arrived,
 *   which is the bug the Owner's loading rule forbids -- a screen shown
 *   before the pictures it draws. It is loud here so it is found here.
 * - `record` (the e2e inspection build): noted in `window.__ffLoading`'s
 *   sibling list, so a browser spec can fail on it, without taking down a
 *   screen the spec was not about.
 * - `empty` (release): an empty texture, as before. A sprite that does not
 *   draw is a visible, recoverable fault, while a throw during a frame takes
 *   the whole screen down; changing what a player's build does on the strength
 *   of a test-time check would be a risk with nothing to gain, since the
 *   checks above already ran against the same code.
 */
export type UnloadedTexturePolicy = "throw" | "record" | "empty";

/**
 * The unit suites run in `test` mode with `empty`: they build real views and
 * screens over fake stages and fake asset ports, where no Pixi bundle is ever
 * really loaded, so a throw there would fail 450 tests for a fault they are
 * not about. A test that is about the rule opts in with
 * `setUnloadedTexturePolicy("throw")`; the browser specs run the inspection
 * build, which records.
 */
let policy: UnloadedTexturePolicy =
  import.meta.env.MODE === "test"
    ? "empty"
    : import.meta.env.DEV
      ? "throw"
      : import.meta.env.VITE_VISUAL_INSPECTION === "1"
        ? "record"
        : "empty";

/** Sets the policy and returns the one it replaces, for a test to put back. */
export function setUnloadedTexturePolicy(next: UnloadedTexturePolicy): UnloadedTexturePolicy {
  const previous = policy;
  policy = next;
  return previous;
}

/** Aliases a view asked for that were not loaded, under the `record` policy. */
export function unloadedTextureAliases(): readonly string[] {
  return ((window as unknown as { __ffUnloadedTextures?: string[] }).__ffUnloadedTextures ?? []).slice();
}

/**
 * Resolves an alias through Pixi's loaded assets.
 *
 * A missing alias yields an empty texture in a release build rather than
 * throwing; in development it throws, and in the inspection build it is
 * recorded (see `UnloadedTexturePolicy`).
 */
export const loadedTextures: TextureProvider = (alias) => {
  const texture = Assets.get<Texture>(alias);
  if (texture !== undefined) return texture;
  if (policy === "throw") throw new Error(`the texture "${alias}" was asked for before its bundle was loaded`);
  if (policy === "record") {
    const target = window as unknown as { __ffUnloadedTextures?: string[] };
    (target.__ffUnloadedTextures ??= []).push(alias);
  }
  return Texture.EMPTY;
};

/** Every alias resolves to an empty texture. Used by view tests. */
export const emptyTextures: TextureProvider = () => Texture.EMPTY;

/**
 * Resolves a sheet's animation table through Pixi's asset resolver.
 *
 * The resolver rather than the cache, because `data` is manifest metadata and
 * is available whether or not the texture itself has finished loading. An
 * unknown alias, or a sheet that declares no animations, yields `undefined`,
 * which a view reads as "fall back to the contract's defaults".
 */
export const loadedSheetData: SheetDataProvider = (alias) => {
  try {
    const resolved = Assets.resolver.resolve(alias) as { data?: { animations?: unknown } };
    const animations = resolved?.data?.animations;
    return typeof animations === "object" && animations !== null
      ? (animations as SheetAnimations)
      : undefined;
  } catch {
    // An alias the resolver has never been given is not an error here: the
    // caller has a default for exactly this case.
    return undefined;
  }
};

/** No sheet declares anything. Used by view tests that pin the defaults. */
export const noSheetData: SheetDataProvider = () => undefined;

/**
 * Cuts one cell out of a sheet.
 *
 * Frames share the sheet's source, so a character's five animations cost one
 * upload rather than seventeen.
 *
 * A cut is not free, though: every `Texture` subscribes to its source's
 * `resize` event and only unsubscribes when it is destroyed. Call this once per
 * cell and keep the result -- a `FrameSheet` does exactly that. Anything that
 * cuts per rendered frame leaks a texture and a listener sixty times a second.
 */
export function frameOf(
  sheet: Texture,
  column: number,
  row: number,
  frameWidth: number,
  frameHeight: number,
): Texture {
  if (sheet === Texture.EMPTY || sheet.source === undefined) return Texture.EMPTY;
  return new Texture({
    source: sheet.source,
    frame: new Rectangle(column * frameWidth, row * frameHeight, frameWidth, frameHeight),
  });
}

/**
 * A sheet cut into a fixed grid, once.
 *
 * Owning the cut frames is the point: an animation selects a cell every frame,
 * and cutting one each time would accumulate textures and source listeners for
 * the whole race. The owner destroys the sheet with its display object.
 */
export class FrameSheet {
  private readonly frames: Texture[] = [];

  constructor(
    sheet: Texture,
    private readonly columns: number,
    rows: number,
    frameWidth: number,
    frameHeight: number,
  ) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        this.frames.push(frameOf(sheet, column, row, frameWidth, frameHeight));
      }
    }
  }

  /** The cell at `column, row`, or an empty texture outside the grid. */
  frame(column: number, row: number): Texture {
    return this.frames[row * this.columns + column] ?? Texture.EMPTY;
  }

  /**
   * Releases every cut frame.
   *
   * `Texture.EMPTY` is shared process-wide and is never destroyed: an unloaded
   * sheet cuts to it, and destroying it would take every other view down.
   */
  destroy(): void {
    for (const frame of this.frames) {
      if (frame === Texture.EMPTY) continue;
      frame.destroy();
    }
    this.frames.length = 0;
  }
}
