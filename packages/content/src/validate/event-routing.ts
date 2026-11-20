/**
 * Presentation route validation.
 *
 * Two code-owned tables decide everything here. `PRESENTATION_ROUTE_CAPABILITIES`
 * says which pairings exist at all; `PRESENTATION_ROUTE_REQUIREMENTS` says
 * which of them an artifact must actually wire. A later optional action
 * extends the first alone, and an accessibility-required pairing extends both.
 *
 * Parsing already rejects a non-integer or out-of-range order. The check is
 * repeated here because a validator is also called with `ParsedContent` a test
 * constructed by hand, and a rule that only holds for values that came through
 * a schema is not a rule.
 */

import {
  PRESENTATION_ROUTE_CAPABILITIES,
  PRESENTATION_ROUTE_REQUIREMENTS,
  type PresentationRouting,
} from "@floor-fifty/shared/content/presentation";
import { type Diagnostic, sortDiagnostics } from "../diagnostics";
import { MAX_ROUTE_ORDER } from "../schema/event-routing";
import type { Located } from "../types";

const pairKey = (source: string, action: string): string => `${source}.${action}`;

export function validateEventRouting(
  routing: Located<PresentationRouting>,
): readonly Diagnostic[] {
  const { file, value } = routing;
  const diagnostics: Diagnostic[] = [];
  const refuse = (keyPath: string, message: string): void => {
    diagnostics.push({ code: "invalidEventRoute", file, keyPath, message });
  };

  const seenPairs = new Set<string>();
  /** Orders already claimed, per source: a slot belongs to one action. */
  const claimedOrders = new Map<string, Set<number>>();

  value.routes.forEach((route, index) => {
    const capabilities: readonly string[] = PRESENTATION_ROUTE_CAPABILITIES[route.source] ?? [];
    if (!capabilities.includes(route.action))
      refuse(
        `routes.${index}.action`,
        `${route.source} has no capability for ${route.action}; it may route only to ${capabilities.join(", ")}`,
      );

    const key = pairKey(route.source, route.action);
    if (seenPairs.has(key)) refuse(`routes.${index}`, `duplicate route for ${key}`);
    seenPairs.add(key);

    if (!Number.isInteger(route.order) || route.order < 0 || route.order > MAX_ROUTE_ORDER) {
      refuse(
        `routes.${index}.order`,
        `order must be an integer in 0..${MAX_ROUTE_ORDER}, received ${route.order}`,
      );
      return;
    }

    const orders = claimedOrders.get(route.source) ?? new Set<number>();
    if (orders.has(route.order))
      refuse(`routes.${index}.order`, `duplicate order ${route.order} for ${route.source}`);
    orders.add(route.order);
    claimedOrders.set(route.source, orders);
  });

  for (const [source, action] of PRESENTATION_ROUTE_REQUIREMENTS) {
    const key = pairKey(source, action);
    if (!seenPairs.has(key)) refuse(`routes.${key}`, `missing required route ${key}`);
  }

  return sortDiagnostics(diagnostics);
}
