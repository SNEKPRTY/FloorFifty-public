/**
 * The bus and the router.
 *
 * Both are about ordering and isolation: one event's listeners all run before
 * the next event's, and one action's failure cannot take the actions behind
 * it with it. Neither may leak a payload into a diagnostic.
 */

import { describe, expect, it } from "vitest";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { PresentationEventBus } from "../../../../../apps/client/src/features/screen/presentation/presentation-event-bus";
import { routedHarness, twoOrderedRoutes } from "../../../support/presentation";

describe("PresentationEventBus", () => {
  it("drains nested publication after every route for the current event", () => {
    const bus = new PresentationEventBus();
    const seen: string[] = [];

    bus.subscribe((event) => {
      seen.push(`first:${event.name}`);
      if (event.name === "app.splash-ready") bus.publish("room.racing", {});
    });
    bus.subscribe((event) => seen.push(`second:${event.name}`));

    bus.publish("app.splash-ready", {});

    expect(seen).toEqual([
      "first:app.splash-ready",
      "second:app.splash-ready",
      "first:room.racing",
      "second:room.racing",
    ]);
  });

  it("returns an idempotent disposer", () => {
    const bus = new PresentationEventBus();
    const seen: string[] = [];
    const dispose = bus.subscribe((event) => seen.push(event.name));

    dispose();
    dispose();
    bus.publish("room.racing", {});

    expect(seen).toEqual([]);
  });

  it("drops queued events and listeners on disposal, more than once safely", () => {
    const bus = new PresentationEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => seen.push(event.name));

    bus.dispose();
    bus.dispose();
    bus.publish("room.racing", {});

    expect(seen).toEqual([]);
  });
});

describe("PresentationEventRouter", () => {
  it("runs a source's actions in ascending explicit order", () => {
    const calls: string[] = [];
    const { bus, router } = routedHarness(twoOrderedRoutes());
    router.register("flow.race-finished", () => calls.push("first"));
    router.register("flow.return-to-menu", () => calls.push("second"));
    router.lock();

    bus.publish("room.finished", {});

    // Declared 20 before 10; explicit order is what decides.
    expect(calls).toEqual(["first", "second"]);
  });

  it("continues ordered actions after a failure without logging payload", () => {
    const calls: string[] = [];
    const { bus, router, failures, traces } = routedHarness(twoOrderedRoutes());
    router.register("flow.race-finished", () => {
      throw new Error("broken");
    });
    router.register("flow.return-to-menu", () => calls.push("later"));
    router.lock();

    bus.publish("room.finished", { winnerId: asPlayerId("secret-player") });

    expect(calls).toEqual(["later"]);
    expect(failures[0]).toEqual(
      expect.objectContaining({
        source: "room.finished",
        action: "flow.race-finished",
        order: 10,
      }),
    );
    expect(traces.map((entry) => entry.outcome)).toEqual(["error", "ok"]);
    expect(JSON.stringify({ failures, traces })).not.toContain("secret-player");
  });

  it("refuses to lock while a routed action has no handler", () => {
    const { router } = routedHarness(twoOrderedRoutes());
    router.register("flow.race-finished", () => {});

    expect(() => router.lock()).toThrow(/flow.return-to-menu/);
  });

  it("refuses registration and deregistration once locked", () => {
    const { router } = routedHarness(twoOrderedRoutes());
    const dispose = router.register("flow.race-finished", () => {});
    router.register("flow.return-to-menu", () => {});
    router.lock();

    expect(() => router.register("flow.race-again", () => {})).toThrow(/locked/);
    expect(() => dispose()).toThrow(/locked/);
  });

  it("stops routing once disposed", () => {
    const calls: string[] = [];
    const { bus, router } = routedHarness(twoOrderedRoutes());
    router.register("flow.race-finished", () => calls.push("first"));
    router.register("flow.return-to-menu", () => calls.push("second"));
    router.lock();

    router.dispose();
    bus.publish("room.finished", {});

    expect(calls).toEqual([]);
  });

  it("routes through a replaced table without unlocking handlers", () => {
    const calls: string[] = [];
    const { bus, router } = routedHarness(twoOrderedRoutes());
    router.register("flow.race-finished", () => calls.push("first"));
    router.register("flow.return-to-menu", () => calls.push("second"));
    router.lock();

    router.replace(
      { routes: [{ source: "room.finished", order: 5, action: "flow.return-to-menu" }] },
      "f".repeat(64) as never,
    );
    bus.publish("room.finished", {});

    expect(calls).toEqual(["second"]);
    expect(() => router.register("flow.race-again", () => {})).toThrow(/locked/);
  });
});
