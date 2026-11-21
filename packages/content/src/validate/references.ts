/**
 * Reference validation.
 *
 * Item files declare IDs; `catalog.toml` decides which of them are public and
 * in what order. This pass is the join between the two, and every failure it
 * reports is a menu row pointing at nothing, at a duplicate, or at the wrong
 * kind of thing.
 *
 * A draft -- an item file no catalog array names -- is legal and silent here.
 * It is still parsed and still bounds-checked; it simply reaches neither the
 * payload nor either revision.
 */

import { type Diagnostic, sortDiagnostics } from "../diagnostics";
import type { CatalogSource, Located, ParsedContent } from "../types";

/** The four kinds an ID may belong to. One ID belongs to exactly one. */
type ItemKind = "character" | "stage" | "song" | "mode";

type ItemRecord = { readonly kind: ItemKind; readonly file: string };

/**
 * Every declared ID, across every kind.
 *
 * One map rather than four, because an ID that is a character in one file and
 * a stage in another is exactly the ambiguity the catalog cannot resolve.
 */
function indexItems(parsed: ParsedContent): {
  readonly items: ReadonlyMap<string, ItemRecord>;
  readonly diagnostics: readonly Diagnostic[];
} {
  const items = new Map<string, ItemRecord>();
  const diagnostics: Diagnostic[] = [];

  const kinds: readonly [ItemKind, readonly Located<{ readonly id: string }>[]][] = [
    ["character", parsed.characters],
    ["stage", parsed.stages],
    ["song", parsed.songs],
    ["mode", parsed.modes],
  ];

  for (const [kind, located] of kinds) {
    for (const item of located) {
      const existing = items.get(item.value.id);
      if (existing !== undefined) {
        diagnostics.push({
          code: "duplicateId",
          file: item.file,
          keyPath: "id",
          message: `${item.value.id} is already declared as a ${existing.kind} in ${existing.file}`,
        });
        continue;
      }
      items.set(item.value.id, { kind, file: item.file });
    }
  }

  return { items, diagnostics };
}

export function validateReferences(parsed: ParsedContent): readonly Diagnostic[] {
  const { items, diagnostics: idDiagnostics } = indexItems(parsed);
  const diagnostics: Diagnostic[] = [...idDiagnostics];
  const catalogFile = parsed.catalog.file;
  const refuse = (
    code: Diagnostic["code"],
    keyPath: string,
    message: string,
    file = catalogFile,
  ): void => {
    diagnostics.push({ code, file, keyPath, message });
  };

  /** Checks one catalog array: no repeats, every entry present and of `kind`. */
  const checkList = (keyPath: string, ids: readonly string[], kind: ItemKind): void => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) refuse("duplicateCatalogEntry", `${keyPath}.${index}`, `${id} is listed more than once`);
      seen.add(id);

      const item = items.get(id);
      if (item === undefined) {
        refuse("unknownReference", `${keyPath}.${index}`, `no ${kind} declares the id ${id}`);
        return;
      }
      if (item.kind !== kind)
        refuse("wrongKind", `${keyPath}.${index}`, `${id} is a ${item.kind}, not a ${kind}`);
    });
  };

  const catalog: CatalogSource = parsed.catalog.value;
  checkList("characters", catalog.characters, "character");
  checkList("stages", catalog.stages, "stage");
  checkList("modes", catalog.modes, "mode");

  checkList("songs", catalog.songs, "song");

  // Pack IDs are their own namespace, but two packs may not share one.
  const packIds = new Set<string>();
  catalog.packs.forEach((pack, index) => {
    if (packIds.has(pack.id)) refuse("duplicateCatalogEntry", `packs.${index}.id`, `${pack.id} is listed more than once`);
    packIds.add(pack.id);
  });

  const unlockIds = new Set(parsed.unlocks.value.map((unlock) => unlock.id as string));
  for (const item of [...parsed.characters, ...parsed.stages, ...parsed.songs]) {
    const unlock = item.value.unlock;
    if (unlock !== undefined && !unlockIds.has(unlock))
      refuse("unknownReference", "unlock", `no condition in unlocks.toml has the id ${unlock}`, item.file);
  }

  // A song in a pack is a tile on the jukebox, and a tile needs its cover.
  for (const songId of catalog.songs) {
    const song = parsed.songs.find((entry) => entry.value.id === songId);
    if (song !== undefined && song.value.coverAlias === undefined)
      refuse("missingField", "coverAlias", `${songId} is in a pack, and a song in a pack needs a cover`, song.file);
  }

  // A chapter's stage and song are found among every file of their kind,
  // catalogued or not: `buildPayload` emits both inside the chapter. A song
  // that earns its place by an unlock is not the story's to hand out, and a
  // line's speaker is the hero or a character that exists.
  const story = parsed.story;
  story.value.chapters.forEach((chapter, index) => {
    const at = `chapters.${index}`;
    if (!parsed.stages.some((stage) => stage.value.id === chapter.stageId))
      refuse("unknownReference", `${at}.stageId`, `no stage declares the id ${chapter.stageId}`, story.file);
    const song = parsed.songs.find((entry) => entry.value.id === chapter.songId);
    if (song === undefined)
      refuse("unknownReference", `${at}.songId`, `no song declares the id ${chapter.songId}`, story.file);
    else if (song.value.unlock !== undefined)
      refuse("wrongKind", `${at}.songId`, `${chapter.songId} is earned by an unlock; a chapter's song must be open`, story.file);
  });
  // An actor is a character that exists; the speakers are checked against the actors by the schema.
  for (const [actorId, actor] of Object.entries(story.value.actors)) {
    if (!parsed.characters.some((entry) => entry.value.id === actor.characterId))
      refuse("unknownReference", `actors.${actorId}.characterId`, `no character declares the id ${actor.characterId}`, story.file);
  }

  return sortDiagnostics(diagnostics);
}
