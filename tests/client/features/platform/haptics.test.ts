// @vitest-environment node
/**
 * Haptics: which pulses a frame earns, and where they go -- the pad's rumble,
 * a phone's vibration, or nowhere.
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import { Haptics, hapticsFor, PAD_EFFECTS, PHONE_PATTERNS, type HapticKind } from "../../../../apps/client/src/features/platform/haptics";

const me = "me" as PlayerId;
const them = "them" as PlayerId;
const moment = (kind: "bounce" | "slam" | "wrap", playerId: PlayerId) => ({ kind, playerId, x: 0, y: 0, fromX: 0, key: `${playerId}:${kind}` });
const event = (value: object) => value as RaceEvent;

describe("which pulses a frame earns", () => {
  it("rumbles the local racer's landings, slams, falls, laps and the finish", () => {
    const kinds = hapticsFor(
      {
        moments: [moment("bounce", me), moment("slam", them)],
        reached: [
          event({ type: "lapCompleted", playerId: me, lap: 2, id: "l" }),
          event({ type: "playerReset", playerId: me, reason: "fall", id: "r" }),
          event({ type: "raceFinished", winnerId: them, id: "f" }),
        ],
      },
      me,
    );
    expect(kinds).toEqual(["land", "lap", "fall", "finish"]);
  });

  it("gives a slam rather than a landing under it, and the winner a bigger finish", () => {
    expect(hapticsFor({ moments: [moment("bounce", me), moment("slam", me)], reached: [] }, me)).toEqual(["slam"]);
    expect(hapticsFor({ moments: [], reached: [event({ type: "raceFinished", winnerId: me, id: "f" })] }, me)).toEqual(["win"]);
  });

  it("feels nothing of a rival's, and nothing without a local racer", () => {
    expect(hapticsFor({ moments: [moment("slam", them)], reached: [event({ type: "playerOut", playerId: them, id: "o" })] }, me)).toEqual([]);
    expect(hapticsFor({ moments: [moment("slam", me)], reached: [] }, undefined)).toEqual([]);
  });
});

type FakePad = { connected: boolean; index: number; vibrationActuator?: { playEffect: Mock<PlayEffect> } };
type PlayEffect = (type: string, params: unknown) => Promise<unknown>;

function rig(options: { pads?: FakePad[]; enabled?: boolean; touch?: boolean; vibrate?: boolean } = {}) {
  const vibrate = vi.fn(() => true);
  const haptics = new Haptics({
    enabled: () => options.enabled ?? true,
    getGamepads: () => options.pads ?? [],
    ...(options.vibrate === false ? {} : { vibrate }),
    touch: () => options.touch ?? false,
  });
  return { haptics, vibrate };
}

const pad = (index = 0): FakePad => ({ connected: true, index, vibrationActuator: { playEffect: vi.fn<PlayEffect>(async () => "complete") } });

describe("where a pulse goes", () => {
  it("rumbles a connected pad with the kind's dual-rumble effect", () => {
    const one = pad();
    const { haptics, vibrate } = rig({ pads: [one], touch: true });
    haptics.pulse("slam");
    expect(one.vibrationActuator!.playEffect).toHaveBeenCalledWith("dual-rumble", {
      duration: PAD_EFFECTS.slam.duration,
      strongMagnitude: PAD_EFFECTS.slam.strong,
      weakMagnitude: PAD_EFFECTS.slam.weak,
      startDelay: 0,
    });
    // A pad in hand is the feedback: the phone stays still.
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("rumbles the first pad that can when several are connected", () => {
    const bare: FakePad = { connected: true, index: 0 };
    const second = pad(1);
    const third = pad(2);
    const { haptics } = rig({ pads: [bare, second, third] });
    haptics.pulse("lap");
    expect(second.vibrationActuator!.playEffect).toHaveBeenCalled();
    expect(third.vibrationActuator!.playEffect).not.toHaveBeenCalled();
  });

  it("vibrates a touch phone with no pad, but never for a landing", () => {
    const { haptics, vibrate } = rig({ touch: true });
    haptics.pulse("land");
    expect(vibrate).not.toHaveBeenCalled();
    haptics.pulse("win");
    expect(vibrate).toHaveBeenCalledWith(PHONE_PATTERNS.win);
  });

  it("is silent off a touch screen with no pad, with the setting off, or with nothing to vibrate", () => {
    for (const setup of [{ touch: false }, { enabled: false, touch: true, pads: [pad()] }, { touch: true, vibrate: false }]) {
      const { haptics, vibrate } = rig(setup);
      for (const kind of Object.keys(PAD_EFFECTS) as HapticKind[]) expect(() => haptics.pulse(kind)).not.toThrow();
      expect(vibrate).not.toHaveBeenCalled();
      for (const each of setup.pads ?? []) expect(each.vibrationActuator!.playEffect).not.toHaveBeenCalled();
    }
  });

  it("never throws into the race's frame: an actuator without playEffect, or one that throws at once", () => {
    const legacy = { connected: true, index: 0, vibrationActuator: {} } as unknown as FakePad;
    const throwing: FakePad = {
      connected: true,
      index: 0,
      vibrationActuator: {
        playEffect: vi.fn(() => {
          throw new Error("unsupported");
        }),
      },
    };
    for (const one of [legacy, throwing]) {
      const { haptics } = rig({ pads: [one] });
      expect(() => haptics.pulse("slam")).not.toThrow();
    }
  });

  it("survives a pad with no actuator and one whose effect throws", () => {
    const bare: FakePad = { connected: true, index: 0 };
    const broken: FakePad = { connected: true, index: 1, vibrationActuator: { playEffect: vi.fn(() => Promise.reject(new Error("no"))) } };
    const { haptics } = rig({ pads: [bare, broken] });
    expect(() => haptics.pulse("finish")).not.toThrow();
    expect(broken.vibrationActuator!.playEffect).toHaveBeenCalled();
  });
});
