import { describe, expect, it } from "vitest";
import { asPlayerId, type PlayerId } from "@floor-fifty/shared/common/ids";
import {
  INPUT_CREDIT_CAPACITY,
  INPUT_CREDITS_PER_TICK,
  InputMeter,
} from "../../../apps/server/src/rooms/input-meter";

const P = asPlayerId("room-p1");
const Q = asPlayerId("room-p2");

/** Spends until the meter refuses, and says how many frames got through. */
function spendAll(meter: InputMeter, playerId: PlayerId): number {
  let spent = 0;
  while (meter.spend(playerId)) {
    spent += 1;
    if (spent > 10_000) throw new Error("the meter never refused");
  }
  return spent;
}

describe("the input meter", () => {
  it("lets a full budget spend one second of frames and no more", () => {
    const meter = new InputMeter();
    meter.fill(P);
    expect(spendAll(meter, P)).toBe(INPUT_CREDIT_CAPACITY);
    expect(meter.spend(P)).toBe(false);
  });

  it("earns credit back each tick", () => {
    const meter = new InputMeter();
    meter.fill(P);
    spendAll(meter, P);
    meter.refill([P]);
    expect(spendAll(meter, P)).toBe(INPUT_CREDITS_PER_TICK);
  });

  it("never banks past one second, however long a player idles", () => {
    const meter = new InputMeter();
    meter.fill(P);
    for (let tick = 0; tick < 5; tick += 1) meter.refill([P]);
    expect(spendAll(meter, P)).toBe(INPUT_CREDIT_CAPACITY);
  });

  it("gives a seat it has never filled nothing until it earns it", () => {
    const meter = new InputMeter();
    expect(meter.spend(Q)).toBe(false);
    meter.refill([Q]);
    expect(spendAll(meter, Q)).toBe(INPUT_CREDITS_PER_TICK);
  });

  it("refills only the seats it is given", () => {
    const meter = new InputMeter();
    meter.fill(P);
    meter.fill(Q);
    spendAll(meter, P);
    spendAll(meter, Q);
    meter.refill([P]);
    expect(meter.spend(P)).toBe(true);
    expect(meter.spend(Q)).toBe(false);
  });

  it("forgets a seat that left", () => {
    const meter = new InputMeter();
    meter.fill(P);
    meter.forget(P);
    expect(meter.spend(P)).toBe(false);
  });
});
