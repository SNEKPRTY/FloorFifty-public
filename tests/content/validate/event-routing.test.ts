/**
 * Presentation route validation.
 *
 * A route is the only thing standing between an authoritative fact and a
 * screen change, so the capability list is checked as strictly as the graph.
 */

import { describe, expect, it } from "vitest";
import { validateEventRouting } from "@floor-fifty/content/validate/event-routing";
import {
  PRESENTATION_EVENT_NAMES,
  PRESENTATION_ROUTE_CAPABILITIES,
  PRESENTATION_ROUTE_REQUIREMENTS,
} from "@floor-fifty/shared/content/presentation";
import {
  located,
  routingWith,
  routingWithDuplicateOrder,
  routingWithDuplicatePair,
  routingWithOrder,
  routingWithout,
  shippedRouting,
} from "../support";

describe("validateEventRouting", () => {
  it("accepts the shipped routing", () => {
    expect(validateEventRouting(located("content/events.toml", shippedRouting()))).toEqual([]);
  });

  it.each([
    [routingWithout("room.finished", "flow.race-finished"), "missing"],
    [routingWith("room.finished", 20, "flow.room-racing"), "capability"],
    [routingWithDuplicatePair(), "duplicate"],
    [routingWithDuplicateOrder("room.finished"), "order"],
    [routingWithOrder("room.finished", 65536), "order"],
  ] as const)("rejects an invalid event route", (routing, message) => {
    expect(validateEventRouting(located("content/events.toml", routing))).toContainEqual(
      expect.objectContaining({
        code: "invalidEventRoute",
        file: "content/events.toml",
        message: expect.stringContaining(message),
      }),
    );
  });

  it("treats declaration order as noise while explicit order decides", () => {
    const reversed = { routes: [...shippedRouting().routes].reverse() };
    expect(validateEventRouting(located("content/events.toml", reversed))).toEqual([]);
  });

  it("keeps every required route inside the capability registry", () => {
    for (const [source, action] of PRESENTATION_ROUTE_REQUIREMENTS) {
      expect(PRESENTATION_ROUTE_CAPABILITIES[source]).toContain(action);
    }
    expect([...PRESENTATION_EVENT_NAMES].sort()).toEqual(
      Object.keys(PRESENTATION_ROUTE_CAPABILITIES).sort(),
    );
  });
});
