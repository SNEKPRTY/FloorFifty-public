/**
 * Authored presentation routes.
 *
 * Shape only: a source and an action the client implements, and an order
 * inside the representable range. Which pairings are permitted and which are
 * required is decided in `validate/event-routing.ts`.
 */

import { z } from "zod";
import {
  PRESENTATION_ACTION_IDS,
  PRESENTATION_EVENT_NAMES,
} from "@floor-fifty/shared/content/presentation";

/** Orders are unique per source and bounded, so they fit one 16-bit slot. */
export const MAX_ROUTE_ORDER = 65_535;

export const eventRoutingSchema = z
  .object({
    routes: z.array(
      z
        .object({
          source: z.enum(PRESENTATION_EVENT_NAMES),
          order: z.number().int().min(0).max(MAX_ROUTE_ORDER),
          action: z.enum(PRESENTATION_ACTION_IDS),
        })
        .strict(),
    ),
  })
  .strict();
