/**
 * The authored words, as a message catalogue (languages spec §4.2).
 *
 * The TOML stays the English source: authors keep writing English in
 * `content/`, and every build rewrites `apps/client/messages/content/en.json`
 * from it, where translators find the keys. The file is derived beside the
 * artifact, never inside it, so neither `contentRevision` nor
 * `rulesetRevision` sees it -- though editing the English in TOML still moves
 * `contentRevision`, as any authored change does.
 *
 * Song names are titles and stay as authored in every locale (D-L4): they
 * never become keys.
 */

import { readFile } from "node:fs/promises";
import type { GameContentPayload } from "@floor-fifty/shared/content/game-content";
import { canonicalizeValue, type Canonical } from "./canonicalize";
import type { CompilerPaths } from "./compiler";
import type { Diagnostic } from "./diagnostics";

/** `snow-shrine` → `snow_shrine`, `fastFall` → `fast_fall`: message keys are snake_case. */
export const snakeKey = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase();

const SUFFIX = { stage: "name", character: "name", mode: "name", pack: "title", unlock: "hint" } as const;

export function contentKey(kind: keyof typeof SUFFIX, id: string): string {
  return `content_${kind}_${snakeKey(id)}_${SUFFIX[kind]}`;
}

export const tutorialKey = (kind: string, method: string): string => `content_tutorial_${snakeKey(kind)}_${method}`;

export function renderContentMessages(payload: GameContentPayload): Canonical {
  const messages: Record<string, string> = {};
  for (const stage of [...payload.stages, payload.tutorial.stage]) messages[contentKey("stage", stage.id)] = stage.displayName;
  for (const character of payload.characters) messages[contentKey("character", character.id)] = character.displayName;
  // The floor-count options a room races (20 floors, 50 floors, Infinite).
  for (const mode of payload.modes) messages[contentKey("mode", mode.id)] = mode.displayName;
  for (const pack of payload.packs) messages[contentKey("pack", pack.id)] = pack.title;
  for (const unlock of payload.unlocks) messages[contentKey("unlock", unlock.id)] = unlock.hint;
  for (const step of payload.tutorial.steps) {
    for (const [method, text] of Object.entries(step.prompt)) {
      if (text !== undefined) messages[tutorialKey(step.kind, method)] = text;
    }
  }
  return canonicalizeValue({ $schema: "https://inlang.com/schema/inlang-message-format", ...messages });
}

export async function verifyContentMessages(
  paths: CompilerPaths,
  payload: GameContentPayload,
): Promise<readonly Diagnostic[]> {
  let committed: string | undefined;
  try {
    committed = await readFile(paths.messagesPath, "utf8");
  } catch {
    committed = undefined;
  }
  if (committed === renderContentMessages(payload).json) return [];
  return [
    {
      code: "staleArtifact",
      file: "apps/client/messages/content/en.json",
      keyPath: "",
      message: "the content messages are stale; run `pnpm content:build`",
    },
  ];
}
