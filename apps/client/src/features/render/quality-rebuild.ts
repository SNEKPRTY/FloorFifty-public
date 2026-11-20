/**
 * A backdrop that follows the graphics-quality setting live.
 *
 * Quality decides which passes a backdrop builds at all -- `low` drops the
 * city atmosphere, and the menu drops its coded windows -- so a change is a
 * rebuild, not a toggle. The old one is destroyed first: two live backdrops
 * would both hold a lease, and the pool would grow by one per switch.
 */

import type { QualitySetting } from "../profile/settings";
import type { SettingsStore } from "../profile/store/settings.svelte";
import { refractionOverrideFor } from "./filters/dawn-refraction";
import { VISUAL_INSPECTION_ENABLED } from "./inspection";

export function rebuildOnQuality<T extends { destroy(): void }>(
  settings: SettingsStore,
  build: (quality: QualitySetting) => T,
  onBuilt?: (built: T) => void,
): { current(): T; dispose(): void } {
  let quality = settings.value.display.quality;
  let built = build(quality);
  onBuilt?.(built);

  const release = settings.subscribe((next) => {
    if (next.display.quality === quality) return;
    quality = next.display.quality;
    built.destroy();
    built = build(quality);
    onBuilt?.(built);
  });

  return {
    current: () => built,
    dispose: () => {
      release();
      built.destroy();
    },
  };
}

/** The player's quality, unless an inspection build asked for another. */
export function effectiveQuality(quality: QualitySetting): QualitySetting {
  return refractionOverrideFor(window.location.search, VISUAL_INSPECTION_ENABLED) ?? quality;
}
