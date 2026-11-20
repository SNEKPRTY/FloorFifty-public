// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GamepadSource, readPad, type GamepadNav, type PadLike } from "../../../../apps/client/src/features/platform/gamepad-source";
import { InputManager } from "../../../../apps/client/src/features/platform/input";
import { fakePad } from "../../support/fakes/input";

const rig = (pads: (PadLike | null)[] = [fakePad()]) => {
  const input = new InputManager();
  const nav: GamepadNav[] = [];
  const state = { pads };
  const source = new GamepadSource({ getGamepads: () => state.pads, onNav: (event) => nav.push(event) });
  source.setRaceTarget(input);
  return { input, nav, state, source };
};

describe("reading a pad", () => {
  it("ignores a stick inside the 0.25 radial deadzone", () => {
    expect(readPad(fakePad().stick(0.2, 0.1))).toMatchObject({ left: false, right: false, fastFall: false });
  });

  it("steers past the deadzone and fast-falls only on a clear downward push", () => {
    expect(readPad(fakePad().stick(-0.6, 0.2))).toMatchObject({ left: true, fastFall: false });
    expect(readPad(fakePad().stick(0.1, 0.8))).toMatchObject({ fastFall: true, left: false, right: false });
  });

  it("maps the d-pad, the right trigger and View to the same intents", () => {
    expect(readPad(fakePad().press(14)).left).toBe(true);
    expect(readPad(fakePad().press(15)).right).toBe(true);
    expect(readPad(fakePad().press(13)).fastFall).toBe(true);
    expect(readPad(fakePad().press(7, 0.9)).fastFall).toBe(true);
    expect(readPad(fakePad().press(8)).reset).toBe(true);
  });

  it("fast-falls on the bottom face button too, since players reach for it as jump", () => {
    expect(readPad(fakePad().press(0)).fastFall).toBe(true);
    // Out of a race the same press is still confirm.
    expect(readPad(fakePad().press(0)).nav.has("confirm")).toBe(true);
  });
});

describe("the gamepad source", () => {
  it("feeds the race as its own source", () => {
    const { input, state, source } = rig();
    state.pads = [fakePad().press(14)];
    source.poll(0);
    expect(input.frame.left).toBe(true);
    state.pads = [fakePad()];
    source.poll(16);
    expect(input.frame.left).toBe(false);
  });

  it("releases what it held when the pad is unplugged", () => {
    const { input, state, source } = rig();
    state.pads = [fakePad().press(15)];
    source.poll(0);
    state.pads = [null];
    source.poll(16);
    expect(input.frame.right).toBe(false);
  });

  it("sends only Start to the page during a race, and everything in a menu", () => {
    const { nav, state, source } = rig();
    state.pads = [fakePad().press(0)];
    source.poll(0);
    state.pads = [fakePad().press(9)];
    source.poll(16);
    expect(nav).toEqual(["start"]);

    source.setRaceTarget(undefined);
    state.pads = [fakePad().press(0)];
    source.poll(32);
    expect(nav).toEqual(["start", "confirm"]);
  });

  it("repeats a held direction after a delay, not every frame", () => {
    const { nav, state, source } = rig();
    source.setRaceTarget(undefined);
    state.pads = [fakePad().press(13)];
    for (let t = 0; t <= 700; t += 16) source.poll(t);
    // One press, then repeats from 400 ms every 120 ms: 400, 520, 640.
    expect(nav.filter((event) => event === "down")).toHaveLength(4);
  });

  it("releases the old race target when the target changes", () => {
    const { input, state, source } = rig();
    state.pads = [fakePad().press(14)];
    source.poll(0);
    source.setRaceTarget(undefined);
    expect(input.frame.left).toBe(false);
  });

  it("fast-falls a race on A, and confirms a menu on A without fast-falling it", () => {
    const { input, nav, state, source } = rig();
    state.pads = [fakePad().press(0)];
    source.poll(0);
    expect(input.frame.fastFall).toBe(true);
    expect(nav).toEqual([]);
  });
});

describe("the shoulder buttons' racer jumps", () => {
  it("reports each shoulder button once per press, left to right, only out of a race", () => {
    const hops: number[] = [];
    const input = new InputManager();
    const state = { pads: [fakePad()] as (PadLike | null)[] };
    const source = new GamepadSource({ getGamepads: () => state.pads, onHop: (slot) => hops.push(slot) });

    // Left trigger, left bumper, right bumper, right trigger: the racers'
    // order on the ledge.
    for (const [t, button] of [6, 4, 5, 7].entries()) {
      state.pads = [fakePad().press(button)];
      source.poll(t * 32);
      source.poll(t * 32 + 16); // held: not reported again
    }
    expect(hops).toEqual([0, 1, 2, 3]);

    source.setRaceTarget(input);
    state.pads = [fakePad()];
    source.poll(200);
    state.pads = [fakePad().press(4)];
    source.poll(216);
    expect(hops).toEqual([0, 1, 2, 3]);
  });
});

describe("which pad the player is using", () => {
  it("reports the pad on every new press, not only when the pad changes", () => {
    // The app marks the controller as the input in use from this report. A
    // keyboard press in between moves that mark away, so a single pad that
    // reported itself once was never heard from again.
    const active: string[] = [];
    const state = { pads: [fakePad()] as (PadLike | null)[] };
    const source = new GamepadSource({ getGamepads: () => state.pads, onActive: (pad) => active.push(pad.id) });

    state.pads = [fakePad().press(0)];
    source.poll(0);
    state.pads = [fakePad()];
    source.poll(16);
    state.pads = [fakePad().press(0)];
    source.poll(32);

    expect(active).toHaveLength(2);
  });
});

/** Every nav a source fires while `held` is held for `untilMs`, with its time. */
const timeline = (held: PadLike, untilMs = 700): [number, GamepadNav][] => {
  const heard: [number, GamepadNav][] = [];
  let now = 0;
  const state = { pads: [held] as (PadLike | null)[] };
  const source = new GamepadSource({ getGamepads: () => state.pads, onNav: (nav) => heard.push([now, nav]) });
  for (now = 0; now <= untilMs; now += 16) source.poll(now);
  state.pads = [fakePad()];
  source.poll(now);
  return heard;
};

const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315].map((degrees) => (degrees * Math.PI) / 180);

describe("stick drift and the deadzone", () => {
  it("drift just inside the deadzone, in every direction, neither navigates nor steers", () => {
    for (const angle of ANGLES) {
      const pad = fakePad().stick(0.24 * Math.cos(angle), 0.24 * Math.sin(angle));
      expect(timeline(pad, 1000)).toEqual([]);
      expect(readPad(pad)).toMatchObject({ left: false, right: false, fastFall: false });
    }
  });

  it("just outside the deadzone, each direction fires exactly one nav", () => {
    const cases: [number, number, GamepadNav][] = [
      [0, -0.3, "up"],
      [0, 0.3, "down"],
      [-0.3, 0, "left"],
      [0.3, 0, "right"],
    ];
    for (const [x, y, nav] of cases) {
      expect(timeline(fakePad().stick(x, y), 100).map(([, event]) => event)).toEqual([nav]);
    }
  });

  it("a diagonal push is one step along its stronger axis, not two", () => {
    expect(timeline(fakePad().stick(0.5, 0.8), 100).map(([, event]) => event)).toEqual(["down"]);
    expect(timeline(fakePad().stick(-0.8, 0.5), 100).map(([, event]) => event)).toEqual(["left"]);
  });
});

describe("d-pad and stick parity", () => {
  const pairs: [number, [number, number]][] = [
    [12, [0, -0.9]],
    [13, [0, 0.9]],
    [14, [-0.9, 0]],
    [15, [0.9, 0]],
  ];

  it("a held d-pad and a held stick fire the same navs at the same times", () => {
    for (const [button, [x, y]] of pairs) {
      expect(timeline(fakePad().press(button))).toEqual(timeline(fakePad().stick(x, y)));
    }
  });

  it("steer a race identically", () => {
    for (const [button, [x, y]] of pairs.slice(2)) {
      const { left, right } = readPad(fakePad().press(button));
      expect(readPad(fakePad().stick(x, y))).toMatchObject({ left, right });
    }
  });
});

describe("more than one pad", () => {
  it("a second pad at rest never releases what the first holds", () => {
    const { input, source } = rig([fakePad().press(14), fakePad({ index: 1 })]);
    source.poll(0);
    source.poll(16);
    expect(input.frame.left).toBe(true);
  });

  it("a press on the second pad takes over from the first", () => {
    const { input, state, source } = rig([fakePad().press(14), fakePad({ index: 1 })]);
    source.poll(0);
    state.pads = [fakePad(), fakePad({ index: 1 }).press(15)];
    source.poll(16);
    expect(input.frame).toMatchObject({ left: false, right: true });
  });

  it("a pad plugged in mid-race steers on its first press", () => {
    const { input, state, source } = rig([null]);
    source.poll(0);
    state.pads = [fakePad().press(14)];
    source.poll(16);
    expect(input.frame.left).toBe(true);
  });
});

/** A pad holding several buttons at once. */
const pressing = (...buttons: number[]): PadLike =>
  buttons.reduce<PadLike>(
    (pad, button) => ({
      ...pad,
      buttons: pad.buttons.map((entry, index) => (index === button ? { pressed: true, value: 1 } : entry)),
    }),
    fakePad(),
  );

describe("a handover", () => {
  it("does not let an A held on Resume fast-fall the race", () => {
    const { input, state, source } = rig();
    source.setRaceTarget(undefined);
    state.pads = [fakePad().press(0)];
    source.poll(0);
    source.setRaceTarget(input);
    source.poll(16);
    expect(input.frame.fastFall).toBe(false);

    state.pads = [fakePad()];
    source.poll(32);
    state.pads = [fakePad().press(0)];
    source.poll(48);
    expect(input.frame.fastFall).toBe(true);
  });

  it("does not let a direction held into the pause menu walk it", () => {
    const { nav, state, source } = rig();
    state.pads = [fakePad().press(13)];
    source.poll(0);
    source.setRaceTarget(undefined);
    for (let t = 16; t <= 1000; t += 16) source.poll(t);
    expect(nav).toEqual([]);

    state.pads = [fakePad()];
    source.poll(1016);
    state.pads = [fakePad().press(13)];
    source.poll(1032);
    expect(nav).toEqual(["down"]);
  });

  it("masks only what was held: a fresh input still acts", () => {
    const { input, state, source } = rig();
    source.setRaceTarget(undefined);
    state.pads = [fakePad().press(0)];
    source.poll(0);
    source.setRaceTarget(input);
    state.pads = [pressing(0, 14)];
    source.poll(16);
    expect(input.frame).toMatchObject({ left: true, fastFall: false });
  });

  it("masks a held stick until it comes back inside the deadzone", () => {
    const { nav, state, source } = rig();
    state.pads = [fakePad().stick(0, 0.9)];
    source.poll(0);
    source.setRaceTarget(undefined);
    state.pads = [fakePad().stick(0, 0.4)];
    source.poll(16);
    expect(nav).toEqual([]);
    state.pads = [fakePad().stick(0, 0.1)];
    source.poll(32);
    state.pads = [fakePad().stick(0, 0.9)];
    source.poll(48);
    expect(nav).toEqual(["down"]);
  });

  it("stops the poll's own navs once Start hands the pad to the pause menu", () => {
    // Start and d-pad up pressed on the same frame: Start pauses (the app's
    // handler hands the pad to the menu synchronously), and up must not then
    // walk the pause menu from that same stale reading.
    const heard: GamepadNav[] = [];
    const input = new InputManager();
    const state = { pads: [fakePad()] as (PadLike | null)[] };
    const source: GamepadSource = new GamepadSource({
      getGamepads: () => state.pads,
      onNav: (nav) => {
        heard.push(nav);
        if (nav === "start") source.setRaceTarget(undefined);
      },
    });
    source.setRaceTarget(input);
    state.pads = [pressing(9, 12)];
    source.poll(0);
    source.poll(16);
    source.poll(600);
    expect(heard).toEqual(["start"]);
  });

  it("a second pad's Start pauses and releases what the first pad was steering", () => {
    const { input, state, source } = rig([fakePad().press(14), fakePad({ index: 1 })]);
    source.poll(0);
    state.pads = [fakePad().press(14), fakePad({ index: 1 }).press(9)];
    source.poll(16);
    source.setRaceTarget(undefined);
    expect(input.frame.left).toBe(false);
  });

  it("unplugging mid-hold stops the repeat and leaves nothing masked", () => {
    const events = new EventTarget();
    const { nav, state, source } = rig();
    source.attach(events);
    source.setRaceTarget(undefined);
    state.pads = [fakePad().press(13)];
    source.poll(0);
    const disconnect = Object.assign(new Event("gamepaddisconnected"), { gamepad: { index: 0 } });
    events.dispatchEvent(disconnect);
    state.pads = [null];
    for (let t = 16; t <= 1000; t += 16) source.poll(t);
    expect(nav).toEqual(["down"]);

    state.pads = [fakePad().press(13)];
    source.poll(1016);
    expect(nav).toEqual(["down", "down"]);
  });

  it("says whether a race holds the pad", () => {
    const input = new InputManager();
    const source = new GamepadSource({ getGamepads: () => [] });
    expect(source.racing).toBe(false);
    source.setRaceTarget(input);
    expect(source.racing).toBe(true);
    source.setRaceTarget(undefined);
    expect(source.racing).toBe(false);
  });

  it("reports each handover", () => {
    const handovers: string[] = [];
    const input = new InputManager();
    const source = new GamepadSource({ getGamepads: () => [], onHandover: (to) => handovers.push(to) });
    source.setRaceTarget(input);
    source.setRaceTarget(input);
    source.setRaceTarget(undefined);
    expect(handovers).toEqual(["race", "menu"]);
  });
});

describe("a pad button as a start press (first race)", () => {
  it("reports each new button press once in a race, the ones the game does not map included", () => {
    const { input, state, source } = rig();
    let presses = 0;
    input.onAnyPress(() => (presses += 1));
    state.pads = [fakePad().press(2)]; // X: no action, no menu step
    source.poll(0);
    source.poll(16);
    expect(presses).toBe(1);
    state.pads = [fakePad()];
    source.poll(32);
    state.pads = [fakePad().press(3)];
    source.poll(48);
    expect(presses).toBe(2);
  });

  it("does not count Start, which pauses, or a button held across a handover", () => {
    const { input, state, source } = rig();
    let presses = 0;
    input.onAnyPress(() => (presses += 1));
    state.pads = [fakePad().press(9)];
    source.poll(0);
    expect(presses).toBe(0);

    source.setRaceTarget(undefined);
    state.pads = [fakePad().press(2)];
    source.poll(16);
    source.setRaceTarget(input);
    source.poll(32);
    expect(presses).toBe(0);
  });
});
