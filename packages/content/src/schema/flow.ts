/**
 * The authored flow graph.
 *
 * Shape only: names must be ones the client implements. Whether the graph is
 * complete, reachable, and within each pair's target allowlist is decided in
 * `validate/flow.ts`.
 */

import { z } from "zod";
import { FLOW_EVENTS, SCREEN_IDS, TRANSITION_STYLES } from "@floor-fifty/shared/content/presentation";

export const flowSchema = z
  .object({
    entry: z.enum(SCREEN_IDS),
    transitions: z.array(
      z
        .object({
          from: z.enum(SCREEN_IDS),
          event: z.enum(FLOW_EVENTS),
          to: z.enum(SCREEN_IDS),
          transition: z.enum(TRANSITION_STYLES).optional(),
        })
        .strict(),
    ),
  })
  .strict();
