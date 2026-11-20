import { describe, expect, it } from "vitest";
import { COMMAND_BUDGET, TICK_HZ } from "@floor-fifty/shared/common/constants";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { CommandMeter } from "../../../apps/server/src/rooms/command-meter";

const SEAT = asPlayerId("p1");
const OTHER = asPlayerId("p2");

const spendAll = (meter: CommandMeter, tick: number, tries: number): number => {
  let accepted = 0;
  for (let attempt = 0; attempt < tries; attempt += 1) if (meter.spend(SEAT, tick)) accepted += 1;
  return accepted;
};

describe("a seat's command budget (audit B2)", () => {
  it("lets a quiet seat spend its whole burst at once, and no more", () => {
    const meter = new CommandMeter();
    expect(spendAll(meter, 0, COMMAND_BUDGET.burst + 25)).toBe(COMMAND_BUDGET.burst);
  });

  it("earns commands back on the room clock, a few a second", () => {
    const meter = new CommandMeter();
    spendAll(meter, 0, COMMAND_BUDGET.burst);
    expect(spendAll(meter, TICK_HZ, 50)).toBe(COMMAND_BUDGET.perSecond);
  });

  it("never banks more than the burst, however long the seat was quiet", () => {
    const meter = new CommandMeter();
    spendAll(meter, 0, COMMAND_BUDGET.burst);
    expect(spendAll(meter, TICK_HZ * 600, 50)).toBe(COMMAND_BUDGET.burst);
  });

  it("is one seat's own: another seat has its whole burst", () => {
    const meter = new CommandMeter();
    spendAll(meter, 0, 100);
    expect(meter.spend(OTHER, 0)).toBe(true);
  });

  it("starts a forgotten seat full again, as a seat that left and a new one", () => {
    const meter = new CommandMeter();
    spendAll(meter, 0, 100);
    meter.forget(SEAT);
    expect(spendAll(meter, 0, 100)).toBe(COMMAND_BUDGET.burst);
  });
});
