/**
 * The settings, as live state.
 *
 * `$state` so Svelte panels bind to it directly. `subscribe` is for the
 * non-Svelte appliers (audio, panel, backdrops), which must not depend on a
 * component being mounted to hear a change.
 */

import {
  DEFAULT_SETTINGS,
  deviceStorage,
  loadSettings,
  saveSettings,
  type Settings,
  type SettingsPatch,
  type SettingsStorage,
} from "../settings";

export class SettingsStore {
  // A plain (non-#) field: Svelte's `$state` class fields are the supported form.
  private current = $state<Settings>(structuredClone(DEFAULT_SETTINGS) as Settings);
  readonly #listeners = new Set<(value: Settings) => void>();
  private readonly storage: SettingsStorage | undefined;
  #holds = 0;
  #unsaved = false;

  constructor(storage: SettingsStorage | undefined = deviceStorage()) {
    this.storage = storage;
    this.current = loadSettings(storage);
  }

  get value(): Settings {
    return this.current;
  }

  /** Merges a patch one section deep, saves it and tells every subscriber. */
  update(patch: SettingsPatch): void {
    const current = this.current;
    const next: Settings = {
      version: 2,
      audio: { ...current.audio, ...patch.audio },
      display: { ...current.display, ...patch.display },
      input: { ...current.input, ...patch.input },
      seen: { ...current.seen, ...patch.seen },
      profile: { ...current.profile, ...patch.profile },
      story: { ...current.story, ...patch.story },
      // A scalar, not a section: `null` (Automatic) is a value, absent is "unchanged".
      locale: patch.locale === undefined ? current.locale : patch.locale,
    };
    this.current = next;
    if (this.#holds > 0) this.#unsaved = true;
    else saveSettings(this.storage, next);
    for (const listener of [...this.#listeners]) listener(next);
  }

  /**
   * Keeps changes in memory, unsaved, until the returned release runs; then
   * saves the latest once. The splash holds them until the player taps to
   * start: inside Ruken the first save of an anonymous player brings up the
   * host's sign-in prompt, which must not cover "Tap to start". Releasing
   * twice does nothing more.
   */
  holdSaves(): () => void {
    this.#holds += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.#holds -= 1;
      if (this.#holds === 0 && this.#unsaved) {
        this.#unsaved = false;
        saveSettings(this.storage, this.current);
      }
    };
  }

  /** Hears every later change; does not fire on subscribe. */
  subscribe(listener: (value: Settings) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
