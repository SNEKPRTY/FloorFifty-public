// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { OpsEventBody } from "@floor-fifty/shared/common/ops-telemetry";
import { wireOpsTelemetry } from "../../../../apps/client/src/features/app/ops-telemetry-wiring";
import { ErrorChannel, recoverableError } from "../../../../apps/client/src/features/net/error-view";
import { FakeNetwork } from "../../support/fakes/network";
import { snapshotAt } from "../../support/snapshots";

const setup = () => {
  const reported: OpsEventBody[] = [];
  const network = new FakeNetwork();
  const errors = new ErrorChannel();
  const unwire = wireOpsTelemetry({
    telemetry: { report: (event) => reported.push(event) },
    network,
    errors,
  });
  return { reported, network, errors, unwire };
};

describe("what the client reports (release readiness §7.1)", () => {
  it("reports the socket's life", () => {
    const { reported, network } = setup();
    network.emitConnectionState("connected");
    network.emitConnectionState("reconnecting");
    network.emitConnectionState("offline");
    expect(reported).toEqual([
      { event: "socket", state: "open" },
      { event: "socket", state: "reconnect" },
      { event: "socket", state: "close" },
    ]);
  });

  it("reports a seat lost past the grace window as given up", () => {
    const { reported, network } = setup();
    network.emitError({ code: "ROOM_CLOSED", message: "lost", detail: "seat-lost" } as never);
    expect(reported).toContainEqual({ event: "socket", state: "gave-up" });
  });

  // Audit S23: after a release, "I cannot join" could not be told from mistyped codes. A refusal the player is shown
  // is reported by its code, so a version lock-out and a wrong code count apart.
  // UNREACHABLE (audit S7) is what a join that nothing answered becomes: the server down, a gateway failing, the phone
  // offline. It is shown to the player like the rest, so a dead server counts apart from a wrong code too.
  it.each([
    "VERSION_MISMATCH",
    "ROOM_FULL",
    "ROOM_CLOSED",
    "INVALID_ROOM",
    "SERVER_UPDATING",
    "SERVER_BUSY",
    "RATE_LIMITED",
    "UNREACHABLE",
  ])(
    "reports a %s refusal by its code",
    (code) => {
      const { reported, network } = setup();
      network.emitError({ code, message: "operator English, never sent" } as never);
      expect(reported).toEqual([{ event: "refusal", code }]);
    },
  );

  it("does not report a seat lost as a refusal, nor an error that is not a refusal of a join", () => {
    const { reported, network } = setup();
    network.emitError({ code: "ROOM_CLOSED", message: "lost", detail: "seat-lost" } as never);
    network.emitError({ code: "NOT_HOST", message: "x" } as never);
    network.emitError({ code: "MALFORMED_MESSAGE", message: "x" } as never);
    expect(reported).toEqual([{ event: "socket", state: "gave-up" }]);
  });

  it("reports each room phase once, as it changes", () => {
    const { reported, network } = setup();
    network.emitSnapshot(snapshotAt(1, { phase: "lobby" }));
    network.emitSnapshot(snapshotAt(2, { phase: "lobby" }));
    network.emitSnapshot(snapshotAt(3, { phase: "racing" }));
    expect(reported.filter((event) => event.event === "phase")).toEqual([
      { event: "phase", phase: "lobby" },
      { event: "phase", phase: "racing" },
    ]);
  });

  it("reports an asset failure by what failed, and still tells the player", () => {
    const { reported, errors } = setup();
    errors.report(recoverableError("ASSET_LOAD_FAILED", "race-assets"));
    expect(reported).toContainEqual({ event: "asset-failure", alias: "race-assets" });
    expect(errors.take()).toMatchObject({ code: "ASSET_LOAD_FAILED" });
  });

  it("stops reporting once unwired", () => {
    const { reported, network, unwire } = setup();
    unwire();
    network.emitConnectionState("connected");
    expect(reported).toEqual([]);
  });
});
