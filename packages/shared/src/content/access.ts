/**
 * Who may pick what (stage, song and character select spec §4.3).
 *
 * Every stage, song and character has exactly one rule: open; earned by
 * play (`unlock`, a condition in `unlocks.toml`); or paid (its pack has
 * `dlc = true`). The picker's content plays for everyone, so these sets gate
 * picking only: the server intersects a seat's report with the catalog and
 * refuses a pick outside it.
 */

import type { GameContentPayload, PackContent, UnlockContent } from "./game-content";

export type ItemKind = "stage" | "song" | "character";

export type AccessSets = {
  readonly stages: readonly string[];
  readonly songs: readonly string[];
  readonly characters: readonly string[];
};

/** What this device has earned and bought. */
export type Grants = { unlocked(conditionId: string): boolean; owns(packId: string): boolean };

export type AccessRule =
  | { kind: "open" }
  | { kind: "unlock"; condition: UnlockContent }
  | { kind: "dlc"; pack: PackContent };

const LIST: Record<ItemKind, "stages" | "songs" | "characters"> = {
  stage: "stages",
  song: "songs",
  character: "characters",
};

export function packOf(content: GameContentPayload, kind: ItemKind, id: string): PackContent | undefined {
  return content.packs.find((pack) => pack[LIST[kind]].includes(id as never));
}

function unlockOf(content: GameContentPayload, kind: ItemKind, id: string): string | undefined {
  const items: readonly { id: string; unlock?: string | undefined }[] = content[LIST[kind]];
  return items.find((item) => item.id === id)?.unlock;
}

export function accessRuleOf(content: GameContentPayload, kind: ItemKind, id: string): AccessRule | undefined {
  const pack = packOf(content, kind, id);
  if (pack === undefined) return undefined;
  if (pack.dlc) return { kind: "dlc", pack };
  const conditionId = unlockOf(content, kind, id);
  if (conditionId === undefined) return { kind: "open" };
  const condition = content.unlocks.find((unlock) => unlock.id === conditionId);
  return condition === undefined ? { kind: "open" } : { kind: "unlock", condition };
}

function granted(rule: AccessRule | undefined, grants: Grants): boolean {
  if (rule === undefined) return false;
  if (rule.kind === "open") return true;
  if (rule.kind === "dlc") return grants.owns(rule.pack.id);
  return grants.unlocked(rule.condition.id);
}

export function accessibleSets(content: GameContentPayload, grants: Grants): AccessSets {
  const pick = (kind: ItemKind): string[] =>
    content[LIST[kind]].map((item) => item.id as string).filter((id) => granted(accessRuleOf(content, kind, id), grants));
  return { stages: pick("stage"), songs: pick("song"), characters: pick("character") };
}

const NOTHING: Grants = { unlocked: () => false, owns: () => false };

/** What a seat with nothing earned or bought may pick. */
export function openSets(content: GameContentPayload): AccessSets {
  return accessibleSets(content, NOTHING);
}

/** A report cut down to the catalog, in catalog order; unknown IDs are dropped. */
export function intersectAccess(content: GameContentPayload, report: AccessSets): AccessSets {
  const cut = (kind: ItemKind): string[] => {
    const wanted = new Set(report[LIST[kind]]);
    return content[LIST[kind]].map((item) => item.id as string).filter((id) => wanted.has(id));
  };
  return { stages: cut("stage"), songs: cut("song"), characters: cut("character") };
}
