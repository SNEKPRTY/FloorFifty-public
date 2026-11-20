import { describe, expect, it } from "vitest";
import { CURSOR_IDLE_MS, CursorRunner, cursorHidden } from "../../../../apps/client/src/features/platform/cursor-policy";

describe("the cursor policy", () => {
  const racing = { screen: "Gameplay" as const, paused: false, msSincePointerMove: 0 };

  it.each([
    [{ ...racing, lastInput: "keyboard" as const }, true],
    [{ ...racing, lastInput: "gamepad" as const }, true],
    [{ ...racing, lastInput: "pointer" as const }, false],
    [{ ...racing, lastInput: "pointer" as const, msSincePointerMove: CURSOR_IDLE_MS }, true],
    [{ ...racing, lastInput: "keyboard" as const, paused: true }, false],
    [{ ...racing, lastInput: "keyboard" as const, screen: "MainMenu" as const }, false],
    [{ ...racing, lastInput: "keyboard" as const, screen: "GameEnd" as const }, false],
  ])("%o hides: %s", (state, hidden) => {
    expect(cursorHidden(state)).toBe(hidden);
  });

  it("brings the cursor back on movement and hides it again after 2 s idle", () => {
    let now = 0;
    const target = document.createElement("div");
    const runner = new CursorRunner(target, { now: () => now, screen: () => "Gameplay" });
    const detach = runner.attach(document);

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    runner.tick();
    expect(target.style.cursor).toBe("none");

    document.dispatchEvent(new MouseEvent("pointermove"));
    runner.tick();
    expect(target.style.cursor).toBe("");

    now = CURSOR_IDLE_MS;
    runner.tick();
    expect(target.style.cursor).toBe("none");

    detach();
    expect(target.style.cursor).toBe("");
  });
});
