/**
 * The committed artifact, decoded.
 *
 * The one place production reads generated content from disk. It decodes at
 * import time on purpose: a malformed artifact should stop the process at
 * startup, not surface as a missing stage during someone's race.
 *
 * `packages/content` is deliberately absent from this file and from every
 * other production module. The compiler is a development tool; the server
 * only ever reads its output.
 */

import artifact from "../../../../content/generated/content.json";
import {
  parseGameContentArtifact,
  type GameContent,
} from "@floor-fifty/shared/content/game-content";

export const GENERATED_CONTENT: GameContent = parseGameContentArtifact(artifact);
