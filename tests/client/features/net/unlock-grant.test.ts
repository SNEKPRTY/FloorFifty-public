import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";
import { closeSlotOnCountdown, grantOf, raceFactsOf } from "../../../../apps/client/src/features/net/unlock-grant";
import { ProgressStore } from "../../../../apps/client/src/features/profile/store/progress.svelte";
import { FakeNetwork } from "../../support/fakes/network";
import { LOCAL_ID, REMOTE_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")),
);

describe("race facts", () => {
  it("are the snapshot's phase, every seat's status and class, and the local ID", () => {
    const snapshot = snapshotAt(100, {
      phase: "finished",
      players: [
        playerSnapshot({ id: LOCAL_ID, status: "connected", deviceClass: "phone" }),
        playerSnapshot({ id: REMOTE_ID, status: "dns" }),
      ],
    });
    expect(raceFactsOf(snapshot, LOCAL_ID)).toEqual({
      phase: "finished",
      localPlayerId: LOCAL_ID,
      seats: [
        { id: LOCAL_ID, status: "connected", deviceClass: "phone", cpu: false },
        { id: REMOTE_ID, status: "dns", deviceClass: "desktop", cpu: false },
      ],
    });
  });

  it("carry each seat's CPU flag (CPU players spec §6)", () => {
    const snapshot = snapshotAt(100, {
      phase: "finished",
      players: [playerSnapshot({ id: LOCAL_ID }), playerSnapshot({ id: REMOTE_ID, cpu: true })],
    });
    expect(raceFactsOf(snapshot, LOCAL_ID).seats.map((seat) => seat.cpu)).toEqual([false, true]);
  });
});

describe("what a condition grants", () => {
  it("any-match is Crash Mode, a song", () => {
    expect(grantOf(content, "any-match", "scarlet")).toMatchObject({ kind: "song", id: "crash-mode", title: "Crash Mode" });
  });

  it("games-5 is Frog, a character in the local seat's colour, with its win portrait", () => {
    expect(grantOf(content, "games-5", "violet")).toMatchObject({
      kind: "character",
      id: "frog",
      name: "Frog",
      colour: "violet",
      portraitAlias: expect.stringMatching(/Win$/),
    });
  });

  it("an unknown condition grants nothing to draw", () => {
    expect(grantOf(content, "nope", "scarlet")).toBeUndefined();
  });
});

describe("the round's slot", () => {
  it("closes when the next race's countdown begins, and not before", () => {
    const network = new FakeNetwork();
    const progress = new ProgressStore(undefined, () => content);
    const dns = { phase: "finished" as const, localPlayerId: "me", seats: [{ id: "me", status: "dns" as const, deviceClass: "desktop" as const, cpu: false }] };
    progress.judge(dns, "7:1");
    closeSlotOnCountdown(network, progress);
    network.emitSnapshot(snapshotAt(10, { phase: "lobby" }));
    expect(progress.value.slot).not.toBeNull();
    network.emitSnapshot(snapshotAt(20, { phase: "countdown" }));
    expect(progress.value.slot).toBeNull();
  });
});
