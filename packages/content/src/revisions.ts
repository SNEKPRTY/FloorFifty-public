/**
 * The revisions.
 *
 * Each is SHA-256 over canonical bytes, and neither preimage contains the
 * hashes themselves. That is what makes "the exact artifact" a statement a
 * verifier can check: the envelope is derived from the payload, never folded
 * back into it.
 *
 * The partition is the useful part. `contentRevision` moves whenever anything
 * an author wrote moves, including a menu reordering or a repointed backdrop.
 * `rulesetRevision` moves only when base tuning or a mode moves, and each
 * stage's `courseRevision` only when that stage's course moves. The ruleset's
 * arrays are sorted by ID rather than by catalog order so that reordering a
 * public menu cannot disturb it.
 *
 * Beat and loop metadata are outside the ruleset. Nothing in the simulation
 * reads them: the design is that music amplifies the climb without judging the
 * player against it, so the same inputs produce the same race whether a song
 * is playing, muted, or absent. A song that decided a race would be the thing
 * this partition exists to make impossible.
 */

import { createHash } from "node:crypto";
import type {
  GameContent,
  GameContentPayload,
  RevisionHash,
} from "@floor-fifty/shared/content/game-content";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import { canonicalizeValue } from "./canonicalize";

const contentInput = (content: GameContentPayload) => ({ schemaVersion: 1 as const, content });

const byId = (a: { readonly id: string }, b: { readonly id: string }): number =>
  a.id.localeCompare(b.id);

/** Bumped to 4 for Survival's rising edge and elimination (survival spec §3); 3 was the endless course and its body window. */
export const RULESET_SCHEMA_VERSION = 4;

/**
 * What a race's rules are, apart from its course: base tuning and the modes,
 * each with its course and lap counts as well as its tuning, because whether a
 * course has a top and how many times it is climbed are rules too.
 *
 * A stage's seed and course tuning left this in phase 2b (select spec §4.6):
 * each stage now has its own `courseRevision`, so shipping a stage in a DLC
 * pack invalidates no saved replay of another stage.
 */
const rulesetInput = (content: GameContentPayload, version: number) => ({
  rulesetSchemaVersion: version,
  baseTuning: content.baseTuning,
  modes: [...content.modes].sort(byId).map(({ id, tuning, course, laps, clocks }) => ({ id, tuning, course, laps, clocks: clocks ?? [] })),
});

/**
 * One stage's course: its frozen seed and its tuning, over the base it
 * modifies. The seed decides which floors exist, which is as much a rules
 * change as the gravity they fall under. Its phrases are not here: they name
 * stretches of the climb for a reviewer and can be rewritten after a playtest
 * without any room needing to be told.
 */
const courseInput = (content: GameContentPayload, stage: GameContentPayload["stages"][number]) => ({
  id: stage.id,
  courseSeed: stage.course?.seed,
  courseTuning: stage.courseTuning,
  baseTuning: content.baseTuning,
});

const sha256 = (value: unknown): RevisionHash =>
  createHash("sha256").update(canonicalizeValue(value).bytes).digest("hex") as RevisionHash;

/** The ruleset revision of `content` under schema `version`; `buildArtifact` stamps this at RULESET_SCHEMA_VERSION. */
export const rulesetRevisionAt = (content: GameContentPayload, version: number): RevisionHash =>
  sha256(rulesetInput(content, version));

/** The revision a race on `stageId` records, and a replay of it checks. */
export const courseRevisionOf = (content: GameContentPayload, stageId: string): RevisionHash => {
  const stage = content.stages.find((entry) => entry.id === stageId);
  if (stage === undefined) throw new Error(`no stage ${stageId}`);
  return sha256(courseInput(content, stage));
};

/**
 * Wraps a payload in its envelope.
 *
 * The result is handed straight back through the runtime's own decoder, so a
 * payload the compiler could assemble but the client could not read fails
 * here rather than at a player's first request.
 */
export const buildArtifact = (content: GameContentPayload): GameContent =>
  parseGameContentArtifact({
    schemaVersion: 1,
    contentRevision: sha256(contentInput(content)),
    rulesetRevision: rulesetRevisionAt(content, RULESET_SCHEMA_VERSION),
    courseRevisions: Object.fromEntries(
      content.stages.map((stage) => [stage.id, courseRevisionOf(content, stage.id)]),
    ),
    content,
  });
