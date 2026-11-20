/**
 * What this device has earned, as live state (unlockables spec §5).
 *
 * The reducers in `features/profile/progress.ts` decide; this holds the result in
 * `$state`, saves it and tells listeners. A write that fails (no storage, a
 * full one, one that throws) leaves the change in memory: the grant still
 * happens and lasts the session.
 *
 * Every change starts from what is stored, not from what this tab loaded, so
 * two tabs open at once never write over each other's grants. A newer build's
 * store is never written over: this build's changes last the session only.
 */

import { accessRuleOf, type ItemKind } from "@floor-fifty/shared/content/access";
import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
import type { RaceFacts } from "@floor-fifty/shared/unlocks/conditions";
import type { Progress } from "../access";
import {
  closeSlot,
  countOf,
  judgeResults,
  isNewerProgress,
  loadProgress,
  readProgress,
  recordShare,
  reveal,
  saveProgress,
  type ProgressData,
} from "../progress";
import type { SettingsStorage } from "../settings";

const ITEM_KINDS: readonly string[] = ["stage", "song", "character"] satisfies readonly ItemKind[];

export class ProgressStore implements Progress {
  private data = $state<ProgressData>(loadProgress(undefined));
  readonly #listeners = new Set<() => void>();
  readonly #storage: SettingsStorage | undefined;
  readonly #content: () => GameContentPayload | undefined;
  /** A newer build's store: read nothing from it, write nothing over it. */
  readonly #newer: boolean;
  /** The last write failed, so memory is ahead of storage and is the base. */
  #unsaved = false;

  constructor(storage: SettingsStorage | undefined, content: () => GameContentPayload | undefined) {
    this.#storage = storage;
    this.#content = content;
    this.#newer = isNewerProgress(storage);
    this.data = loadProgress(storage);
  }

  get value(): ProgressData {
    return this.data;
  }

  unlocked(conditionId: string): boolean {
    return this.data.unlocked.includes(conditionId);
  }

  count(conditionId: string): number | undefined {
    return countOf(this.data, conditionId);
  }

  /** `"<kind>:<id>"`: an item earned by play whose tile has not been revealed yet (§7.2). */
  isNew(itemKey: string): boolean {
    if (this.data.revealed.includes(itemKey)) return false;
    const split = itemKey.indexOf(":");
    const kind = itemKey.slice(0, split);
    const content = this.#content();
    if (split < 0 || content === undefined || !ITEM_KINDS.includes(kind)) return false;
    const rule = accessRuleOf(content, kind as ItemKind, itemKey.slice(split + 1));
    return rule?.kind === "unlock" && this.unlocked(rule.condition.id);
  }

  reveal(itemKey: string): void {
    const base = this.#base();
    this.#apply(base, reveal(base, itemKey));
  }

  /** Results for a race: returns the condition granted this round, if one was. */
  judge(race: RaceFacts, key: string): string | undefined {
    const base = this.#base();
    const step = judgeResults(base, race, key, this.#order());
    this.#apply(base, step.data);
    return step.granted;
  }

  /** A save or share; `round` is the results' race key, or undefined outside a round. */
  share(round: string | undefined): string | undefined {
    const base = this.#base();
    const step = recordShare(base, round, this.#order());
    this.#apply(base, step.data);
    return step.granted;
  }

  /** The next race's countdown began. */
  closeSlot(): void {
    const base = this.#base();
    this.#apply(base, closeSlot(base));
  }

  /** Hears every later change; does not fire on subscribe. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #order(): string[] {
    return this.#content()?.unlocks.map((entry) => entry.id) ?? [];
  }

  /** What a change starts from: the stored progress, which another tab may have moved on, else memory. */
  #base(): ProgressData {
    if (this.#newer || this.#unsaved) return this.data;
    const stored = readProgress(this.#storage);
    // The same progress keeps this object, so an unchanged step tells no listener.
    return stored === undefined || JSON.stringify(stored) === JSON.stringify(this.data) ? this.data : stored;
  }

  #apply(base: ProgressData, next: ProgressData): void {
    if (next === base && base === this.data) return;
    this.data = next;
    if (next !== base && !this.#newer) this.#unsaved = !saveProgress(this.#storage, next);
    for (const listener of [...this.#listeners]) listener();
  }
}
