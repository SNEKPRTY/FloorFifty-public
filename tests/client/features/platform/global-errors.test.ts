import { afterEach, describe, expect, it, vi } from "vitest";
import { crashReason, installGlobalErrorHandlers } from "../../../../apps/client/src/features/platform/global-errors";

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

const rejection = (reason: unknown): Event => Object.assign(new Event("unhandledrejection"), { reason });

describe("the last line of defence (release readiness §6.7)", () => {
  // The Owner's ruling, 2026-11-14 (audit S27): a crash carries its class, its
  // screen and a short reason, so a report says more than "TypeError". The reason
  // is the first line of the message, cut and scrubbed (`crashReason`), never a
  // stack. (The old test pinned "its class alone, never its message".)
  it("reports an uncaught error by its class and a short reason", () => {
    const onFatal = vi.fn();
    uninstall = installGlobalErrorHandlers(window, onFatal);
    window.dispatchEvent(new ErrorEvent("error", { error: new RangeError("Invalid array length") }));
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledWith("RangeError", "Invalid array length");
  });

  it("reports a thrown value that is not an error by its type, with no reason", () => {
    const onFatal = vi.fn();
    uninstall = installGlobalErrorHandlers(window, onFatal);
    window.dispatchEvent(new ErrorEvent("error", { error: "Kite's room ABC234" }));
    expect(onFatal).toHaveBeenCalledWith("string", undefined);
  });

  // A rejection nobody awaited -- a sound effect that failed to fetch on a
  // flaky phone -- leaves the race running; it is reported, never fatal.
  it("reports an unhandled rejection by its class, as a rejection and not a fatal error", () => {
    const onFatal = vi.fn();
    const onRejection = vi.fn();
    uninstall = installGlobalErrorHandlers(window, onFatal, onRejection);
    window.dispatchEvent(rejection(new TypeError("x")));
    expect(onRejection).toHaveBeenCalledWith("TypeError");
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("names something rejected that is not an error by its type, never its value", () => {
    const onRejection = vi.fn();
    uninstall = installGlobalErrorHandlers(window, vi.fn(), onRejection);
    window.dispatchEvent(rejection("Kite's room ABC234"));
    expect(onRejection).toHaveBeenCalledWith("string");
  });

  // The browser reports a ResizeObserver loop, a cross-origin "Script error."
  // or an extension's error as an ErrorEvent with no error object. None is a
  // failure of the game, so none may put a player on the recovery panel.
  it("ignores an error event that carries no error", () => {
    const onFatal = vi.fn();
    uninstall = installGlobalErrorHandlers(window, onFatal);
    window.dispatchEvent(new ErrorEvent("error", { message: "ResizeObserver loop completed with undelivered notifications." }));
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("installs once per window, so booting twice reports once", () => {
    const onFatal = vi.fn();
    uninstall = installGlobalErrorHandlers(window, onFatal);
    const second = installGlobalErrorHandlers(window, onFatal);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("x") }));
    expect(onFatal).toHaveBeenCalledTimes(1);
    second();
  });

  it("can be removed, and installed again", () => {
    const first = vi.fn();
    installGlobalErrorHandlers(window, first)();
    const again = vi.fn();
    uninstall = installGlobalErrorHandlers(window, again);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("x") }));
    expect(first).not.toHaveBeenCalled();
    expect(again).toHaveBeenCalledTimes(1);
  });
});

describe("the reason a crash report carries (audit S27)", () => {
  it("is the first line of the message, with no stack", () => {
    expect(crashReason(new Error("Cannot read properties of undefined\n    at foo (bar.js:1:2)"))).toBe(
      "Cannot read properties of undefined",
    );
  });

  it("is at most 120 characters", () => {
    expect(crashReason(new Error("x".repeat(500)))).toHaveLength(120);
  });

  it("drops a web address", () => {
    expect(crashReason(new Error("Failed to fetch https://g-abc.example/pass/index.html?id=7 today"))).toBe("Failed to fetch today");
    expect(crashReason(new Error("Failed to fetch wss://floorfifty-api.fly.dev/x?token=abc now"))).toBe("Failed to fetch now");
  });

  it("keeps a quoted name of the kind a property has, since that is what a crash is about", () => {
    expect(crashReason(new TypeError("Cannot read properties of undefined (reading 'getBounds')"))).toBe(
      "Cannot read properties of undefined (reading 'getBounds')",
    );
  });

  it("masks anything else in quotes, which is where interpolated data lives", () => {
    expect(crashReason(new Error("Unexpected token 'Kite and Ninja' in JSON"))).toBe("Unexpected token '…' in JSON");
  });

  it("masks a room code, six characters of its alphabet", () => {
    expect(crashReason(new Error("no room ABC234 here"))).toBe("no room … here");
  });

  it("is nothing for a value that is not an error, or an error with no message", () => {
    expect(crashReason("a string")).toBeUndefined();
    expect(crashReason(undefined)).toBeUndefined();
    expect(crashReason(new Error(""))).toBeUndefined();
  });
});
