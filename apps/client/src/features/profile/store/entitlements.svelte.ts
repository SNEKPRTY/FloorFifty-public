/**
 * Owned packs, as live state (unlockables spec §8).
 *
 * `$state` so every tile that asks `owns` redraws when a pack is granted;
 * `subscribe` is for `main.ts`, which resends the access report.
 */

import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
import type { Entitlements } from "../access";
import { loadEntitlements, saveEntitlements } from "../entitlements";
import type { SettingsStorage } from "../settings";

export class EntitlementsStore implements Entitlements {
  private owned = $state<string[]>([]);
  readonly #listeners = new Set<() => void>();
  readonly #storage: SettingsStorage | undefined;
  readonly #content: () => GameContentPayload | undefined;

  constructor(storage: SettingsStorage | undefined, content: () => GameContentPayload | undefined) {
    this.#storage = storage;
    this.#content = content;
    this.owned = loadEntitlements(storage).owned;
  }

  owns(packId: string): boolean {
    return this.owned.includes(packId);
  }

  /** The one way in for a sales channel. Refuses a pack the catalog does not mark `dlc`. */
  grant(packId: string): boolean {
    const pack = this.#content()?.packs.find((candidate) => candidate.id === packId);
    if (pack?.dlc !== true) return false;
    if (this.owned.includes(packId)) return true;
    this.owned = [...this.owned, packId];
    saveEntitlements(this.#storage, { version: 1, owned: this.owned });
    for (const listener of [...this.#listeners]) listener();
    return true;
  }

  /** Hears every later change; does not fire on subscribe. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
