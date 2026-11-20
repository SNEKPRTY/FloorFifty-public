/** The mood pops (CPU banding spec §4): a word when a CPU enters a mood, and only then. */
import { describe, expect, it, vi } from "vitest";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import type { PlayerSnapshot, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
// Static: `Bark` loads Pixi text, which cold on a busy runner would be charged to the test that first needs it.
import { Bark } from "../../../../apps/client/src/features/race/juice/bark";
import { CpuBarks } from "../../../../apps/client/src/features/race/juice/cpu-barks";
import { playerSnapshot, snapshotAt } from "../../support/snapshots";

const PERSON = asPlayerId("room-p1");
const SUNNY = asPlayerId("room-p2");
const KOI = asPlayerId("room-p3");

/** A racing room of 20 floors: the person on `person` floors, each CPU on its own. */
function racing(person: number, cpus: Record<string, { colour: PlayerSnapshot["colour"]; floors: number }>): RoomSnapshot {
  const base = snapshotAt(10, { phase: "racing" });
  const floors = base.floorCount;
  return {
    ...base,
    players: [
      playerSnapshot({ id: PERSON, progress: person / floors }),
      ...Object.entries(cpus).map(([id, cpu]) =>
        playerSnapshot({ id: asPlayerId(id), cpu: true, colour: cpu.colour, progress: cpu.floors / floors, name: id }),
      ),
    ],
  };
}

describe("the CPU mood pops", () => {
  it("says nothing on the first look, whatever the mood: a CPU already ahead did not just get there", () => {
    const barks = new CpuBarks();
    expect(barks.update(racing(2, { [SUNNY]: { colour: "gold", floors: 10 } }))).toEqual([]);
  });

  it("pops the personality's word as a CPU starts cruising, and nothing while it stays", () => {
    const barks = new CpuBarks();
    barks.update(racing(2, { [SUNNY]: { colour: "gold", floors: 3 } }));
    expect(barks.update(racing(2, { [SUNNY]: { colour: "gold", floors: 6 } }))).toEqual([{ id: SUNNY, text: m.race_bark_sunny_cruising(), colour: "gold" }]);
    expect(barks.update(racing(2, { [SUNNY]: { colour: "gold", floors: 7 } }))).toEqual([]);
  });

  it("pops again as it starts pushing", () => {
    const barks = new CpuBarks();
    barks.update(racing(6, { [SUNNY]: { colour: "gold", floors: 6 } }));
    expect(barks.update(racing(10, { [SUNNY]: { colour: "gold", floors: 6 } }))).toEqual([{ id: SUNNY, text: m.race_bark_sunny_pushing(), colour: "gold" }]);
  });

  it("never pops for Koi, the benchmark, nor for a person", () => {
    const barks = new CpuBarks();
    barks.update(racing(2, { [KOI]: { colour: "cyan", floors: 2 } }));
    expect(barks.update(racing(2, { [KOI]: { colour: "cyan", floors: 9 } }))).toEqual([]);
  });

  it("says nothing outside a race", () => {
    const barks = new CpuBarks();
    barks.update(racing(2, { [SUNNY]: { colour: "gold", floors: 3 } }));
    expect(barks.update({ ...racing(2, { [SUNNY]: { colour: "gold", floors: 9 } }), phase: "finished" })).toEqual([]);
  });
});

describe("Bark display", () => {
  it("avoids redundant style invalidations when shown with same face and colour", async () => {
    const bark = new Bark();
    bark.show("CRUISING", "gold", "sans-serif");
    expect(bark.root.visible).toBe(true);
    expect(bark.root.text).toBe("CRUISING");

    const fillSetter = vi.spyOn(bark.root.style, "fill", "set");
    const fontSetter = vi.spyOn(bark.root.style, "fontFamily", "set");

    bark.show("CRUISING", "gold", "sans-serif");
    expect(fillSetter).not.toHaveBeenCalled();
    expect(fontSetter).not.toHaveBeenCalled();
  });
});

