import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import * as cues from "../../../../apps/client/src/features/race/race-cues";
import { SEAT_CALLS } from "../../../../apps/client/src/lib/constants";

const root = resolve("packages/asset-contract/assets");
const manifest = JSON.parse(readFileSync(resolve(root, "art-manifest.json"), "utf8"));
const authored = new Map<string, { role: string; file: string }>(Object.values(manifest.bundles).flat().map((row: any) => [row.alias, row]));
function check(alias: string) {
  const asset = authored.get(alias);
  if (asset?.role !== "audio" || !existsSync(resolve(root, asset.file))) throw new Error(`Missing authored audio: ${alias}`);
}
const aliases = new Set<string>();
function collect(value: unknown): void {
  if (typeof value === "string" && /^(sfx|ui|vo|ambience|music)\./.test(value)) aliases.add(value);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) collect(item);
}
Object.values(cues).forEach(collect);
Object.values(SEAT_CALLS).forEach(collect);
for (let floor = 0; floor < 150; floor++) {
  collect(cues.landingCueFor(floor)); collect(cues.clashCueFor(floor));
  for (const rival of [false, true]) {
    collect(cues.landingSounds(floor, { floorCount: 150, rival }));
    for (const kind of ["bounce", "slam", "wrap"] as const) collect(cues.juiceSound(kind, { floorIndex: floor, floorCount: 150, rival }));
  }
}
for (const remaining of [0, 1000, 2000, 3000]) collect(cues.countdownCues("count", remaining));
for (const event of [
  { type: "playerReset", reason: "manual" }, { type: "playerReset", reason: "fall" },
  { type: "playerOut" }, { type: "lapCompleted", lap: 2 }, { type: "raceFinished", winnerId: asPlayerId("local") },
]) collect(cues.cuesForEvent({ id: "cue-contract", tick: 1, playerId: asPlayerId("local"), ...event } as RaceEvent, asPlayerId("local"), { lapCount: 3, players: [{ id: asPlayerId("local"), colour: "scarlet" }] }));

describe("production gameplay audio references", () => {
  it.each([...aliases])("resolves %s to an existing authored audio file", check);
  it("rejects an unknown alias rather than silently accepting the contract", () => {
    expect(() => check("sfx.deliberatelyUnknown")).toThrow(/Missing authored audio/);
  });
});
