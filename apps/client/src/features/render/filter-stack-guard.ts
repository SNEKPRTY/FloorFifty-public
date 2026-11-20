/**
 * A guard for a Pixi 8.21 filter-stack bug that a resize turns into a crash.
 *
 * `FilterSystem.push` asks `_findFilterResolution` for the previous filter's
 * resolution, but that helper reads `_filterStack[index - 1]` *after* the new
 * entry has been pushed -- the entry being set up, not the one before it. Its
 * `inputTexture` is whatever that slot held last frame. Usually that texture
 * is idle in the pool and still alive, so the wrong read is harmless.
 *
 * A canvas resize changes that. `TexturePool.setScreenSize` destroys the idle
 * textures sized to the old screen, the stale one among them, and the next
 * push reads `source._resolution` off a destroyed texture. The render throws
 * mid-frame, the filter stack is left unbalanced, and every frame after it is
 * wrong: the picture breaks on a window resize or a phone rotation.
 *
 * Clearing the slots after a resize makes the helper fall back to the root
 * resolution, which is what a correct lookup returns for the first filter in
 * a frame anyway. The slots are refilled by the next push, so nothing else
 * reads the cleared value.
 */

type FilterStackEntry = { inputTexture?: unknown };

/** The part of a Pixi renderer this reaches into. Private in Pixi, so loose. */
export type FilterStackHost = { filter?: unknown };

export function dropStaleFilterInputs(renderer: FilterStackHost): void {
  const stack = (renderer.filter as { _filterStack?: FilterStackEntry[] } | undefined)?._filterStack;
  if (!Array.isArray(stack)) return;
  for (const entry of stack) {
    if (entry !== undefined) entry.inputTexture = null;
  }
}
