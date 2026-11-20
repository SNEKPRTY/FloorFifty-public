import { describe, expect, it } from "vitest";
import { InputManager } from "../../../../apps/client/src/features/platform/input";

/**
 * Key capture and frame aggregation.
 *
 * This lived beside the transport tests because the transport used to own the
 * keyboard. It never had anything to do with Socket.IO: a frame is produced by
 * what the player pressed, and it is sent by whoever is connected.
 */
describe("input aggregation", () => {
  it("emits a frame only when a key actually changes state", () => {
    const input = new InputManager();
    const frames: number[] = [];
    input.subscribe((frame) => frames.push(frame.sequence));
    input.attach(document);

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));

    expect(frames).toHaveLength(2);
    input.dispose();
  });

  it("increases the sequence on every emitted frame", () => {
    const input = new InputManager();
    const sequences: number[] = [];
    input.subscribe((frame) => sequences.push(frame.sequence));

    input.set("left", true, "keyboard");
    input.set("right", true, "keyboard");

    expect(sequences).toEqual([1, 2]);
    input.dispose();
  });

  it("treats the arrow keys as the letter keys", () => {
    const input = new InputManager();
    input.attach(document);
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    expect(input.frame.left).toBe(true);
    input.dispose();
  });

  it("clears reset after one frame so a held key is one respawn", () => {
    const input = new InputManager();
    const frames: boolean[] = [];
    input.subscribe((frame) => frames.push(frame.reset));

    input.set("reset", true, "keyboard");

    expect(frames).toEqual([true]);
    expect(input.frame.reset).toBe(false);
    input.dispose();
  });

  it("releases every held key when the window loses focus", () => {
    const input = new InputManager();
    input.attach(document);
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    window.dispatchEvent(new Event("blur"));
    expect(input.frame.right).toBe(false);
    input.dispose();
  });

  it("stops listening once disposed", () => {
    const input = new InputManager();
    input.attach(document);
    input.dispose();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    expect(input.frame.right).toBe(false);
  });
});

describe("sampling for a tick", () => {
  it("hands a reset press to exactly one tick, even a tap inside a frame", () => {
    const input = new InputManager();
    input.set("right", true, "keyboard");
    // Pressed and released before the race samples: a tap shorter than a tick.
    input.set("reset", true, "keyboard");
    input.set("reset", false, "keyboard");

    expect(input.sample()).toEqual({ left: false, right: true, fastFall: false, reset: true });
    expect(input.sample()).toEqual({ left: false, right: true, fastFall: false, reset: false });
    input.dispose();
  });

  it("reports held directions as they stand when sampled", () => {
    const input = new InputManager();
    input.set("left", true, "keyboard");
    input.set("fastFall", true, "keyboard");
    expect(input.sample()).toMatchObject({ left: true, fastFall: true, reset: false });
    input.set("left", false, "keyboard");
    expect(input.sample()).toMatchObject({ left: false, fastFall: true });
    input.dispose();
  });
});

describe("input from several devices at once", () => {
  it("holds an action while any source holds it", () => {
    const input = new InputManager();
    input.set("left", true, "gamepad");
    input.set("left", true, "keyboard");
    input.set("left", false, "keyboard");
    expect(input.frame.left).toBe(true);
    input.set("left", false, "gamepad");
    expect(input.frame.left).toBe(false);
    input.dispose();
  });

  it("emits only when the union changes", () => {
    const input = new InputManager();
    const frames: number[] = [];
    input.subscribe((frame) => frames.push(frame.sequence));
    input.set("right", true, "touch");
    input.set("right", true, "keyboard");
    input.set("right", false, "touch");
    expect(frames).toHaveLength(1);
    input.dispose();
  });

  it("releases only the keyboard when the window loses focus", () => {
    const input = new InputManager();
    input.attach(document);
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    input.set("right", true, "gamepad");

    window.dispatchEvent(new Event("blur"));

    expect(input.frame.left).toBe(false);
    expect(input.frame.right).toBe(true);
    input.dispose();
  });

  it("releases one source without touching the others", () => {
    const input = new InputManager();
    input.set("left", true, "gamepad");
    input.set("fastFall", true, "touch");
    input.releaseSource("gamepad");
    expect(input.frame.left).toBe(false);
    expect(input.frame.fastFall).toBe(true);
    input.dispose();
  });

  it("drops and ignores input while suspended", () => {
    const input = new InputManager();
    input.set("left", true, "keyboard");
    input.setSuspended(true);
    expect(input.frame.left).toBe(false);
    input.set("right", true, "gamepad");
    expect(input.frame.right).toBe(false);
    input.setSuspended(false);
    input.set("right", true, "gamepad");
    expect(input.frame.right).toBe(true);
    input.dispose();
  });

  it("samples a fast-fall tapped and released between two ticks exactly once", () => {
    const input = new InputManager();
    input.set("fastFall", true, "touch");
    input.set("fastFall", false, "touch");
    expect(input.sample().fastFall).toBe(true);
    expect(input.sample().fastFall).toBe(false);
    input.dispose();
  });
});

describe("a press the game does not bind (a first-race start press)", () => {
  const press = (target: EventTarget, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent("keydown", init));

  it("is reported once for a key no action uses, and sends no frame of its own", () => {
    const input = new InputManager();
    const frames: number[] = [];
    let presses = 0;
    input.subscribe((frame) => frames.push(frame.sequence));
    input.onAnyPress(() => (presses += 1));
    input.attach(document);

    press(document, { code: "Space", key: " " });
    press(document, { code: "Space", key: " ", repeat: true });
    expect(presses).toBe(1);
    expect(frames).toEqual([]);
    input.dispose();
  });

  it("is not reported for the keys the game already binds, or the browser's and the pause menu's", () => {
    const input = new InputManager();
    let presses = 0;
    input.onAnyPress(() => (presses += 1));
    input.attach(document);

    press(document, { code: "KeyD", key: "d" });
    press(document, { code: "KeyR", key: "r" });
    press(document, { code: "Escape", key: "Escape" });
    press(document, { code: "Tab", key: "Tab" });
    press(document, { code: "KeyL", key: "l", ctrlKey: true });
    press(document, { code: "KeyL", key: "l", metaKey: true });
    press(document, { code: "KeyL", key: "l", altKey: true });
    expect(presses).toBe(0);
    input.dispose();
  });

  it("stops being reported once the listener is removed", () => {
    const input = new InputManager();
    let presses = 0;
    const stop = input.onAnyPress(() => (presses += 1));
    input.attach(document);
    stop();
    press(document, { code: "Space", key: " " });
    expect(presses).toBe(0);
    input.dispose();
  });
});
