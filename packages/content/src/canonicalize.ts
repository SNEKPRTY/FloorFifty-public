/**
 * Canonical bytes, and the payload they describe.
 *
 * The generated artifact is committed, so "the same content" has to mean "the
 * same bytes". Two things get it there: this module erases every difference
 * that authoring introduces but meaning does not -- key order, declaration
 * order, line endings, drafts -- and `buildPayload` fixes the one order that
 * does carry meaning, which is the catalog's.
 */

import { resolveTuning, type ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import {
  asContentId,
  type CharacterContent,
  type GameContent,
  type GameContentPayload,
  type ModeContent,
  type SongContent,
  type StageContent,
  type StoryContent,
} from "@floor-fifty/shared/content/game-content";
import type {
  FlowTransition,
  PresentationRoute,
} from "@floor-fifty/shared/content/presentation";
import type { Located, ParsedContent } from "./types";

export type Canonical = { readonly json: string; readonly bytes: Uint8Array };

/** Recursively key-sorted, with every array left exactly as the caller built it. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

/**
 * One value, one byte sequence.
 *
 * Two-space indentation and a single trailing newline so the committed file
 * reads and diffs like the hand-written JSON around it. The line-ending
 * normalisation is defensive: `JSON.stringify` emits LF, and a CRLF source
 * file has already lost its carriage returns to the TOML parser.
 */
export function canonicalizeValue(value: unknown): Canonical {
  const json = `${JSON.stringify(sortKeys(value), null, 2).replace(/\r\n/g, "\n")}\n`;
  return { json, bytes: new TextEncoder().encode(json) };
}

const byPair = (a: FlowTransition, b: FlowTransition): number =>
  a.from.localeCompare(b.from) || a.event.localeCompare(b.event) || a.to.localeCompare(b.to);

const byExplicitOrder = (a: PresentationRoute, b: PresentationRoute): number =>
  a.source.localeCompare(b.source) || a.order - b.order || a.action.localeCompare(b.action);

/** Catalogued items only, in the catalog's order, silently skipping unknowns. */
function inCatalogOrder<T extends { readonly id: string }>(
  ids: readonly string[],
  items: readonly Located<T>[],
): T[] {
  const byId = new Map<string, T>(items.map((item) => [item.value.id, item.value]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item === undefined ? [] : [item];
  });
}

/**
 * Assembles the payload the artifact carries.
 *
 * Only catalogued items are emitted, so a draft file is validated and then
 * forgotten. The one exception is the story's stage and its song, which
 * `story.toml` names: they ride inside `story`'s chapters, never in `stages`
 * or `songs` unless the catalog lists them too. Flow transitions and presentation routes are sorted here rather
 * than at read time, because that is the point at which declaration order
 * stops being available to mean anything.
 *
 * The base layer goes through `resolveTuning`, which is the same function the
 * rooms use, so the compiled numbers and the runtime's numbers cannot be
 * produced by two different rules. Validation has already proved the cast
 * safe: `validate/bounds.ts` accepted these names and ranges.
 */
export function buildPayload(parsed: ParsedContent): GameContentPayload {
  const catalog = parsed.catalog.value;

  const characters: readonly CharacterContent[] = inCatalogOrder(
    catalog.characters,
    parsed.characters,
  );
  const stages: readonly StageContent[] = inCatalogOrder(catalog.stages, parsed.stages);
  const modes: readonly ModeContent[] = inCatalogOrder(catalog.modes, parsed.modes);
  const songs: readonly SongContent[] = inCatalogOrder(catalog.songs, parsed.songs);

  // Validation has already refused a chapter whose stage or song is missing.
  const { prompts, actors, cutscenes, ending } = parsed.story.value;
  const story: StoryContent = {
    prompts,
    actors,
    cutscenes,
    ending,
    chapters: parsed.story.value.chapters.map(({ stageId, songId, ...chapter }) => ({
      ...chapter,
      stage: parsed.stages.find((stage) => stage.value.id === stageId)!.value,
      song: parsed.songs.find((song) => song.value.id === songId)!.value,
    })),
  };

  return {
    baseTuning: resolveTuning(parsed.tuning.value as Partial<ResolvedTuning>),
    presentation: {
      flow: {
        entry: parsed.flow.value.entry,
        transitions: [...parsed.flow.value.transitions].sort(byPair),
      },
      routing: { routes: [...parsed.eventRouting.value.routes].sort(byExplicitOrder) },
    },
    // Pack IDs are branded here, where the catalog's plain strings become content.
    packs: catalog.packs.map((pack) => ({
      id: asContentId(pack.id),
      title: pack.title,
      dlc: pack.dlc,
      stages: pack.stages.map(asContentId),
      songs: pack.songs.map(asContentId),
      characters: pack.characters.map(asContentId),
    })),
    unlocks: [...parsed.unlocks.value],
    blockedNames: [...parsed.blockedNames.value].sort(),
    characters,
    stages,
    songs,
    modes,
    // A chapter's stage and song ride inside it, so a stage or song the catalog
    // does not list is never raced and the ruleset does not see it.
    story,
    // Stage overrides are keyed by ID, sorted so two equivalent files hash alike.
    juice: {
      ...parsed.juice.value,
      palette: {
        stages: Object.fromEntries(
          Object.entries(parsed.juice.value.palette.stages).sort(([a], [b]) => a.localeCompare(b)),
        ),
      },
    },
  };
}

/** The exact bytes the committed artifact is, and is compared against. */
export const serializeArtifact = (artifact: GameContent): Canonical =>
  canonicalizeValue(artifact);
