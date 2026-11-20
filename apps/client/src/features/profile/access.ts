/**
 * What this device may pick (stage, song and character select spec §4.3).
 *
 * Two sources grant anything: `Progress` is what this device earned by play
 * (`features/profile/store/progress.svelte.ts`), and `Entitlements` the packs it owns
 * (`features/profile/store/entitlements.svelte.ts`, which a future sales channel writes to;
 * there are no accounts). A dev build may pass `?dev=unlock-all`, for testing
 * and the human gate.
 */

import { accessRuleOf, accessibleSets, type AccessSets, type ItemKind } from "@floor-fifty/shared/content/access";
import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
import { unlockHint } from "../i18n/content";

export interface Entitlements {
  owns(packId: string): boolean;
}

export interface Progress {
  unlocked(conditionId: string): boolean;
  /** How far towards the condition's goal, when the store counts it. */
  count(conditionId: string): number | undefined;
  /** An earned item whose tile has not been revealed yet (unlockables spec §7.2). `itemKey` is `"<kind>:<id>"`. */
  isNew?(itemKey: string): boolean;
  /** The tile was seen and focused: stop calling it new. */
  reveal?(itemKey: string): void;
}

export const NO_ENTITLEMENTS: Entitlements = { owns: () => false };
export const NO_PROGRESS: Progress = { unlocked: () => false, count: () => undefined };
/** Nothing earned, nothing owned, no dev flag: the access a component assumes when given none. */
export const NO_ACCESS: AccessOptions = { unlockAll: false };

/** `?dev=unlock-all`, honoured only in a dev build; both branches are reachable from a test. */
export function unlockAllFor(search: string, dev: boolean): boolean {
  if (!dev) return false;
  return new URLSearchParams(search).getAll("dev").includes("unlock-all");
}

export type AccessOptions = { unlockAll: boolean; progress?: Progress; entitlements?: Entitlements };

/** Everything this device may pick, as the report the room intersects with its catalog. */
export function deviceAccess(content: GameContentPayload, options: AccessOptions): AccessSets {
  const progress = options.progress ?? NO_PROGRESS;
  const entitlements = options.entitlements ?? NO_ENTITLEMENTS;
  return accessibleSets(content, {
    unlocked: (id) => options.unlockAll || progress.unlocked(id),
    owns: (id) => options.unlockAll || entitlements.owns(id),
  });
}

export type TileAccess =
  /** `isNew` while an item earned by play has not been revealed (unlockables spec §7.2). */
  | { state: "open"; isNew?: true }
  /** `count` and `progress` are present together, only when the store counts the condition. */
  | { state: "locked"; hint: string; goal: number; count?: number; progress?: string }
  | { state: "dlc" };

/** How one tile is drawn: pickable, locked behind play (with its hint), or behind a pack. */
export function tileAccess(content: GameContentPayload, kind: ItemKind, id: string, options: AccessOptions): TileAccess {
  if (options.unlockAll) return { state: "open" };
  const rule = accessRuleOf(content, kind, id);
  if (rule === undefined || rule.kind === "open") return { state: "open" };
  if (rule.kind === "dlc") return (options.entitlements ?? NO_ENTITLEMENTS).owns(rule.pack.id) ? { state: "open" } : { state: "dlc" };
  const progress = options.progress ?? NO_PROGRESS;
  if (progress.unlocked(rule.condition.id)) return progress.isNew?.(`${kind}:${id}`) === true ? { state: "open", isNew: true } : { state: "open" };
  const count = progress.count(rule.condition.id);
  const goal = rule.condition.goal;
  return count === undefined
    ? { state: "locked", hint: unlockHint(rule.condition), goal }
    : { state: "locked", hint: unlockHint(rule.condition), goal, count: Math.min(count, goal), progress: `${Math.min(count, goal)}/${goal}` };
}
