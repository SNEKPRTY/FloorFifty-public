import type { SettingsPatch, SettingsStorage } from "../../../../apps/client/src/features/profile/settings";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";

/** Settings with no storage behind them, optionally seeded with a patch. */
/**
 * A storage of its own, empty, for a store a test must not share. `new
 * SettingsStore(undefined)` takes the constructor's default, which is the
 * page's real `localStorage`, so one test's choice is the next one's.
 */
export function memoryStorage(): SettingsStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
}

export function fakeSettings(seed?: SettingsPatch): SettingsStore {
  const store = new SettingsStore(undefined);
  if (seed !== undefined) store.update(seed);
  return store;
}
