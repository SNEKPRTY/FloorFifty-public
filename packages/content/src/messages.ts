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

export const storyPromptKey = (kind: string, method: string): string => `content_story_prompt_${snakeKey(kind)}_${method}`;
export const storyTitleKey = (chapter: string): string => `content_story_${snakeKey(chapter)}_title`;
/** A line a moment says in a climb: the chapter, the moment's place in it, the line's. */
export const storyBarkKey = (chapter: string, moment: number, line: number): string =>
  `content_story_${snakeKey(chapter)}_bark_${moment}_${line}`;
export const storyCutsceneTitleKey = (cutscene: string): string => `content_story_cut_${snakeKey(cutscene)}_title`;
export const storyCutLineKey = (cutscene: string, panel: number, line: number): string =>
  `content_story_cut_${snakeKey(cutscene)}_${panel}_${line}`;
export const storyThesisKey = (line: number): string => `content_story_thesis_${line}`;
export const STORY_LAST_KEY = "content_story_last";

export function renderContentMessages(payload: GameContentPayload): Canonical {
  const messages: Record<string, string> = {};
  for (const stage of [...payload.stages, ...payload.story.chapters.map((chapter) => chapter.stage)]) messages[contentKey("stage", stage.id)] = stage.displayName;
  for (const character of payload.characters) messages[contentKey("character", character.id)] = character.displayName;
  // The floor-count options a room races (20 floors, 50 floors, Infinite).
  for (const mode of payload.modes) messages[contentKey("mode", mode.id)] = mode.displayName;
  for (const pack of payload.packs) messages[contentKey("pack", pack.id)] = pack.title;
  for (const unlock of payload.unlocks) messages[contentKey("unlock", unlock.id)] = unlock.hint;
  for (const [kind, prompt] of Object.entries(payload.story.prompts)) {
    for (const [method, text] of Object.entries(prompt)) messages[storyPromptKey(kind, method)] = text;
  }
  const { chapters, cutscenes, ending } = payload.story;
  for (const chapter of chapters) {
    messages[storyTitleKey(chapter.id)] = chapter.title;
    chapter.moments.forEach((moment, momentIndex) =>
      moment.lines?.forEach((line, lineIndex) => (messages[storyBarkKey(chapter.id, momentIndex, lineIndex)] = line.text)),
    );
  }
  for (const cutscene of cutscenes) {
    messages[storyCutsceneTitleKey(cutscene.id)] = cutscene.title;
    cutscene.panels.forEach((panel, panelIndex) =>
      panel.lines.forEach((line, lineIndex) => (messages[storyCutLineKey(cutscene.id, panelIndex, lineIndex)] = line.text)),
    );
  }
  ending.thesis.forEach((line, index) => (messages[storyThesisKey(index)] = line));
  messages[STORY_LAST_KEY] = ending.last.text;
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
