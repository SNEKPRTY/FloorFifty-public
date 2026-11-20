/**
 * The shipped content, made to agree with a test replay's revisions, so
 * `checkReplay` passes it exactly as it would a replay of a real race.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asContentId, asRevision, parseGameContentArtifact, type GameContent } from "@floor-fifty/shared/content/game-content";
import type { Replay } from "@floor-fifty/shared/replay/replay";

export function shippedContent(): GameContent {
  return parseGameContentArtifact(
    JSON.parse(readFileSync(resolve(process.cwd(), "content/generated/content.json"), "utf8")),
  );
}

export function contentFor(replay: Replay): GameContent {
  const shipped = shippedContent();
  const { header } = replay;
  const known = shipped.content.modes.some((mode) => mode.id === header.modeId);
  return {
    ...shipped,
    rulesetRevision: asRevision(header.rulesetRevision),
    courseRevisions: { ...shipped.courseRevisions, [header.stageId]: asRevision(header.courseRevision) },
    content: {
      ...shipped.content,
      modes: known
        ? shipped.content.modes
        : [...shipped.content.modes, { id: asContentId(header.modeId), displayName: header.modeId, course: "finite", laps: [1], tuning: {} }],
    },
  };
}
