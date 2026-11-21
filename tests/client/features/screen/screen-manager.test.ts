import { describe, expect, it, vi } from "vitest";
import { DisposeBag } from "../../../../apps/client/src/lib/dispose";
import type { ScreenId } from "../../../../apps/client/src/features/profile/screen-state";
import { ScreenManager } from "../../../../apps/client/src/features/screen/screen-manager";
import type { Screen } from "../../../../apps/client/src/features/screen/screen";
import { fakeContext, screenManagerWithFakes } from "../../support/fakes/screens";
import type { FadePort } from "../../../../apps/client/src/features/kit/screen-fade";
import type { VeilPort } from "../../../../apps/client/src/features/render/veil";
import type { ScreenFactory } from "../../../../apps/client/src/features/screen/screen-manager";
import { SCREEN_IDS } from "@floor-fifty/shared/content/presentation";

/** A screen that owns nothing, for tests about the manager rather than a screen. */
const nullScreen = (name: ScreenId): Screen => ({
  name,
  enter: async () => {},
  exit: () => {},
});

describe("screen transitions", () => {
  it("destroys every MainMenu-owned display object before entering Gameplay", async () => {
    const manager = screenManagerWithFakes();
    await manager.transition("MainMenu");
    await manager.transition("Gameplay");
    expect(manager.destroyedOwners()).toContain("MainMenu");
    expect(manager.liveOwners()).toEqual(["Gameplay"]);
  });

  it("never leaves two screens live at once across a queued transition", async () => {
    const manager = screenManagerWithFakes();
    await Promise.all([
      manager.transition("MainMenu"),
      manager.transition("Gameplay"),
      manager.transition("GameEnd"),
    ]);
    expect(manager.liveOwners()).toEqual(["GameEnd"]);
  });

  it("carries out any destination it is given, policy being the graph's job", async () => {
    // `MainMenu -> GameEnd` was illegal while the manager held an `ALLOWED`
    // table of its own. It is legal in the authored graph -- it is the
    // finished-room reconnect -- and the manager now has no second opinion.
    const manager = screenManagerWithFakes();
    await manager.transition("MainMenu");
    await manager.transition("GameEnd");
    expect(manager.liveOwners()).toEqual(["GameEnd"]);
  });

  it("ignores a transition to the screen already showing", async () => {
    const manager = screenManagerWithFakes();
    await manager.transition("MainMenu");
    await manager.transition("MainMenu");
    expect(manager.destroyedOwners()).toEqual([]);
  });

  it("tells a screen which screen it came from", async () => {
    const seen: (ScreenId | undefined)[] = [];
    const recording = (name: ScreenId): Screen => ({
      name,
      enter: async (context) => void seen.push(context.previousScreen),
      exit: () => {},
    });
    const { publishPresentationEvent: _publish, ...context } = fakeContext();
    const manager = new ScreenManager(
      {
        Splash: () => recording("Splash"),
        MainMenu: () => recording("MainMenu"),
        Lobby: () => recording("Lobby"),
        Gameplay: () => recording("Gameplay"),
        GameEnd: () => recording("GameEnd"),
        Story: () => recording("Story"),
        Replay: () => recording("Replay"),
      },
      context,
      () => {},
    );
    await manager.transition("Splash");
    await manager.transition("Lobby");
    expect(seen).toEqual([undefined, "Splash"]);
  });

  it("keeps a value both screens claim alive across the move, and no further", async () => {
    let built = 0;
    let destroyed = 0;
    const claiming = (name: ScreenId): Screen => {
      let release: (() => void) | undefined;
      return {
        name,
        enter: async (context) => {
          await Promise.resolve();
          release = context.carryOver.claim("menu-backdrop", () => {
            built += 1;
            return { destroy: () => void (destroyed += 1) };
          }).release;
        },
        exit: () => release?.(),
      };
    };
    const { publishPresentationEvent: _publish, carryOver: _carry, ...context } = fakeContext();
    const manager = new ScreenManager(
      {
        Splash: () => nullScreen("Splash"),
        MainMenu: () => claiming("MainMenu"),
        Lobby: () => claiming("Lobby"),
        Gameplay: () => nullScreen("Gameplay"),
        GameEnd: () => nullScreen("GameEnd"),
        Story: () => nullScreen("Story"),
        Replay: () => nullScreen("Replay"),
      },
      context,
      () => {},
    );
    await manager.transition("MainMenu");
    await manager.transition("Lobby");
    await manager.transition("MainMenu");
    expect({ built, destroyed }).toEqual({ built: 1, destroyed: 0 });
    await manager.transition("Gameplay");
    expect({ built, destroyed }).toEqual({ built: 1, destroyed: 1 });
  });

  it("tears the live screen down on disposal", async () => {
    const manager = screenManagerWithFakes();
    await manager.transition("Splash");
    manager.manager.dispose();
    expect(manager.liveOwners()).toEqual([]);
  });

  it("makes a screen current before awaiting its enter", async () => {
    // Splash publishes from inside `enter`. If the manager assigned `current`
    // afterwards, that event would resolve against no screen at all.
    let seen: ScreenId | undefined = "GameEnd";
    const manager = new ScreenManager(
      {
        Splash: () => ({
          name: "Splash" as const,
          async enter() {
            seen = manager.currentName;
          },
          exit() {},
        }),
        MainMenu: () => nullScreen("MainMenu"),
        Lobby: () => nullScreen("Lobby"),
        Gameplay: () => nullScreen("Gameplay"),
        GameEnd: () => nullScreen("GameEnd"),
        Story: () => nullScreen("Story"),
        Replay: () => nullScreen("Replay"),
      },
      fakeContext(),
      () => {},
    );

    await manager.transition("Splash");

    expect(seen).toBe("Splash");
  });

  it("exits a screen whose enter rejected and still accepts a later retry", async () => {
    let failNext = true;
    const entered: ScreenId[] = [];
    const exited: ScreenId[] = [];
    const manager = new ScreenManager(
      {
        Splash: () => nullScreen("Splash"),
        Lobby: () => nullScreen("Lobby"),
        MainMenu: () => ({
          name: "MainMenu" as const,
          async enter() {
            if (failNext) {
              failNext = false;
              throw new Error("menu assets failed");
            }
            entered.push("MainMenu");
          },
          exit() {
            exited.push("MainMenu");
          },
        }),
        Gameplay: () => nullScreen("Gameplay"),
        GameEnd: () => nullScreen("GameEnd"),
        Story: () => nullScreen("Story"),
        Replay: () => nullScreen("Replay"),
      },
      fakeContext(),
      () => {},
    );

    const failed = manager.transition("MainMenu");
    const stranded = manager.transition("Gameplay");
    await expect(failed).rejects.toThrow(/menu assets failed/);
    await expect(stranded).rejects.toThrow(/menu assets failed/);
    expect(exited).toEqual(["MainMenu"]);
    expect(manager.currentName).toBeUndefined();

    // A rejected chain used to stay rejected forever. An explicit retry works.
    await manager.transition("MainMenu");
    expect(entered).toEqual(["MainMenu"]);
  });
});

describe("disposal", () => {
  it("runs every disposer exactly once, most recent first", () => {
    const order: string[] = [];
    const bag = new DisposeBag();
    bag.add(() => order.push("first"));
    bag.add(() => order.push("second"));

    bag.dispose();
    bag.dispose();

    expect(order).toEqual(["second", "first"]);
  });

  it("removes a DOM listener it added", () => {
    const bag = new DisposeBag();
    const target = document.createElement("div");
    const listener = vi.fn();

    bag.addListener(target, "click", listener);
    target.dispatchEvent(new Event("click"));
    bag.dispose();
    target.dispatchEvent(new Event("click"));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("runs a disposer registered after teardown rather than dropping it", () => {
    const bag = new DisposeBag();
    bag.dispose();
    const late = vi.fn();
    bag.add(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});

type Log = string[];

/** A veil whose cover finishes when the test says; a release before the cover is remembered. */
function recordingVeil(log: Log) {
  let releaseCover: (() => void) | undefined;
  let released = false;
  const veil: VeilPort = {
    cover: () => {
      log.push("cover");
      if (released) {
        released = false;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => (releaseCover = resolve));
    },
    reveal: async () => {
      log.push("reveal");
    },
    destroy: () => log.push("destroy"),
  };
  return {
    veil,
    finishCover: () => {
      if (releaseCover === undefined) released = true;
      releaseCover?.();
      releaseCover = undefined;
    },
  };
}

function loggingScreen(name: ScreenId, log: Log, fail = false) {
  return () => ({
    name,
    async enter() {
      if (fail) throw new Error(`${name} failed`);
      log.push(`enter:${name}`);
    },
    exit() {
      log.push(`exit:${name}`);
    },
  });
}

function managerWith(log: Log, veil: VeilPort, failing?: ScreenId) {
  const factories = Object.fromEntries(
    SCREEN_IDS.map((id) => [id, loggingScreen(id, log, id === failing)]),
  ) as unknown as Record<ScreenId, ScreenFactory>;
  return new ScreenManager(factories, fakeContext(), () => undefined, () => veil);
}

describe("a liquid edge", () => {
  it("covers, then exits and enters, then reveals", async () => {
    const log: Log = [];
    const { veil, finishCover } = recordingVeil(log);
    const manager = managerWith(log, veil);
    await manager.transition("Lobby");
    const going = manager.transition("Gameplay", "liquid");
    await vi.waitFor(() => expect(log).toContain("cover"));
    expect(log).toEqual(["enter:Lobby", "cover"]);
    finishCover();
    await going;
    expect(log).toEqual(["enter:Lobby", "cover", "exit:Lobby", "enter:Gameplay", "reveal"]);
  });

  it("never touches the veil on a cut", async () => {
    const log: Log = [];
    const manager = managerWith(log, recordingVeil(log).veil);
    await manager.transition("MainMenu");
    await manager.transition("Lobby");
    expect(log).toEqual(["enter:MainMenu", "exit:MainMenu", "enter:Lobby"]);
  });

  it("a request queued under the cover runs under it, and only the last reveals", async () => {
    const log: Log = [];
    const { veil, finishCover } = recordingVeil(log);
    const manager = managerWith(log, veil);
    await manager.transition("Gameplay");
    const finished = manager.transition("GameEnd", "liquid");
    await vi.waitFor(() => expect(log).toContain("cover"));
    const left = manager.transition("MainMenu", "liquid");
    finishCover();
    await Promise.all([finished, left]);
    expect(log.filter((entry) => entry === "cover")).toHaveLength(1);
    expect(log.filter((entry) => entry === "reveal")).toHaveLength(1);
    expect(log.at(-1)).toBe("reveal");
    expect(log.slice(-3)).toEqual(["exit:GameEnd", "enter:MainMenu", "reveal"]);
  });

  it("reveals even when the next screen's enter throws, and still rejects", async () => {
    const log: Log = [];
    const { veil, finishCover } = recordingVeil(log);
    const manager = managerWith(log, veil, "GameEnd");
    await manager.transition("Gameplay");
    const failing = manager.transition("GameEnd", "liquid");
    finishCover();
    await expect(failing).rejects.toThrow(/GameEnd failed/);
    expect(log.at(-1)).toBe("reveal");
  });

  it("tells the entering screen when the veil has fully cleared, not before", async () => {
    // A screen's loader must outlive the wipe: taken down while the veil is
    // still fully up, the player sees a bare blue frame (Mac run, 2026-10-11).
    const log: Log = [];
    const { veil, finishCover } = recordingVeil(log);
    let finishReveal!: () => void;
    veil.reveal = () => {
      log.push("reveal");
      return new Promise<void>((resolve) => (finishReveal = resolve));
    };
    let cleared: Promise<void> | undefined;
    const factories = Object.fromEntries(SCREEN_IDS.map((id) => [id, loggingScreen(id, log)])) as unknown as Record<ScreenId, ScreenFactory>;
    factories.Story = () => ({
      name: "Story",
      async enter(context) {
        cleared = context.veilCleared?.().then(() => void log.push("cleared"));
      },
      exit: () => undefined,
    });
    const manager = new ScreenManager(factories, fakeContext(), () => undefined, () => veil);
    await manager.transition("MainMenu");
    const going = manager.transition("Story", "liquid");
    finishCover();
    await vi.waitFor(() => expect(log).toContain("reveal"));
    await Promise.resolve();
    expect(cleared).toBeDefined();
    expect(log).not.toContain("cleared");
    finishReveal();
    await going;
    await cleared;
    expect(log.slice(-2)).toEqual(["reveal", "cleared"]);
  });

  it("says the veil is clear at once on a cut, and when the app is torn down mid-cover", async () => {
    const log: Log = [];
    const { veil, finishCover } = recordingVeil(log);
    let cleared: Promise<void> | undefined;
    const factories = Object.fromEntries(SCREEN_IDS.map((id) => [id, loggingScreen(id, log)])) as unknown as Record<ScreenId, ScreenFactory>;
    factories.Story = () => ({
      name: "Story",
      async enter(context) {
        cleared = context.veilCleared?.();
        await new Promise<void>(() => undefined);
      },
      exit: () => undefined,
    });
    factories.Lobby = () => ({
      name: "Lobby",
      async enter(context) {
        await context.veilCleared?.();
        log.push("lobby clear");
      },
      exit: () => undefined,
    });
    const manager = new ScreenManager(factories, fakeContext(), () => undefined, () => veil);
    await manager.transition("Lobby");
    expect(log).toContain("lobby clear");
    void manager.transition("Story", "liquid");
    finishCover();
    await vi.waitFor(() => expect(cleared).toBeDefined());
    manager.dispose();
    await expect(cleared).resolves.toBeUndefined();
  });

  it("makes the veil once, on the first liquid edge", async () => {
    const log: Log = [];
    const { veil, finishCover } = recordingVeil(log);
    let made = 0;
    const manager = new ScreenManager(
      Object.fromEntries(SCREEN_IDS.map((id) => [id, loggingScreen(id, log)])) as unknown as Record<ScreenId, ScreenFactory>,
      fakeContext(),
      () => undefined,
      () => {
        made += 1;
        return veil;
      },
    );
    await manager.transition("Lobby");
    expect(made).toBe(0);
    const one = manager.transition("Gameplay", "liquid");
    finishCover();
    await one;
    const two = manager.transition("GameEnd", "liquid");
    finishCover();
    await two;
    expect(made).toBe(1);
  });
});

describe("a veil that fails", () => {
  it("cuts instead when the veil cannot be made, and tries again next time", async () => {
    const log: Log = [];
    let attempts = 0;
    const manager = new ScreenManager(
      Object.fromEntries(SCREEN_IDS.map((id) => [id, loggingScreen(id, log)])) as unknown as Record<ScreenId, ScreenFactory>,
      fakeContext(),
      () => undefined,
      () => {
        attempts += 1;
        throw new Error("no veil");
      },
    );
    await manager.transition("Lobby");
    await expect(manager.transition("Gameplay", "liquid")).resolves.toBeUndefined();
    await expect(manager.transition("GameEnd", "liquid")).resolves.toBeUndefined();
    expect(manager.currentName).toBe("GameEnd");
    expect(attempts).toBe(2);
  });

  it("cuts instead when the cover fails, and does not reject what is queued behind it", async () => {
    const log: Log = [];
    const veil: VeilPort = {
      cover: async () => {
        log.push("cover");
        throw new Error("cover failed");
      },
      reveal: async () => {
        log.push("reveal");
      },
      destroy: () => undefined,
    };
    const manager = managerWith(log, veil);
    await manager.transition("Lobby");
    const going = manager.transition("Gameplay", "liquid");
    const next = manager.transition("GameEnd");
    await expect(going).resolves.toBeUndefined();
    await expect(next).resolves.toBeUndefined();
    expect(manager.currentName).toBe("GameEnd");
    expect(log).toContain("reveal");
  });

  it("releases the veil when the app is torn down", async () => {
    const log: Log = [];
    const { veil, finishCover } = recordingVeil(log);
    const manager = managerWith(log, veil);
    await manager.transition("Lobby");
    const going = manager.transition("Gameplay", "liquid");
    finishCover();
    await going;
    manager.dispose();
    expect(log.at(-1)).toBe("destroy");
  });
});


describe("a fade edge", () => {
  /** A fade port whose out() finishes when the test says. */
  function recordingFade(log: Log) {
    let releaseOut: (() => void) | undefined;
    const fade: FadePort = {
      out: () => {
        log.push("fade-out");
        return new Promise<void>((resolve) => (releaseOut = resolve));
      },
      in: () => void log.push("fade-in"),
    };
    return { fade, finishOut: () => releaseOut?.() };
  }

  function fadingManager(log: Log, fade: FadePort, veil?: VeilPort) {
    const factories = Object.fromEntries(
      SCREEN_IDS.map((id) => [id, loggingScreen(id, log)]),
    ) as unknown as Record<ScreenId, ScreenFactory>;
    return new ScreenManager(factories, fakeContext(), () => undefined, veil === undefined ? undefined : () => veil, fade);
  }

  it("fades a fade edge out, swaps, and fades in", async () => {
    const log: Log = [];
    const { fade, finishOut } = recordingFade(log);
    const manager = fadingManager(log, fade);
    await manager.transition("Lobby");
    const going = manager.transition("MainMenu", "fade");
    await vi.waitFor(() => expect(log).toContain("fade-out"));
    finishOut();
    await going;
    expect(log).toEqual(["enter:Lobby", "fade-out", "exit:Lobby", "enter:MainMenu", "fade-in"]);
  });

  it("does not fade the first screen in, there being nothing to fade out", async () => {
    const log: Log = [];
    const manager = fadingManager(log, recordingFade(log).fade);
    await manager.transition("Splash", "fade");
    expect(log).toEqual(["enter:Splash"]);
  });

  it("a liquid edge does not also fade", async () => {
    const log: Log = [];
    const { veil, finishCover } = recordingVeil(log);
    const manager = fadingManager(log, recordingFade(log).fade, veil);
    await manager.transition("Lobby");
    const going = manager.transition("Gameplay", "liquid");
    await vi.waitFor(() => expect(log).toContain("cover"));
    finishCover();
    await going;
    expect(log).not.toContain("fade-out");
    expect(log).not.toContain("fade-in");
  });

  it("a fade edge does not raise the veil", async () => {
    const log: Log = [];
    const { fade, finishOut } = recordingFade(log);
    const manager = fadingManager(log, fade, recordingVeil(log).veil);
    await manager.transition("Lobby");
    const going = manager.transition("MainMenu", "fade");
    await vi.waitFor(() => expect(log).toContain("fade-out"));
    finishOut();
    await going;
    expect(log).not.toContain("cover");
  });

  it("the new screen takes input within 120 ms of the request", async () => {
    vi.useFakeTimers();
    try {
      const log: Log = [];
      const fade: FadePort = {
        out: () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
        in: () => void log.push(`fade-in@${Date.now() - start}`),
      };
      const manager = fadingManager(log, fade);
      await manager.transition("Lobby");
      const start = Date.now();
      const going = manager.transition("MainMenu", "fade");
      await vi.advanceTimersByTimeAsync(100);
      await going;
      expect(log.at(-1)).toBe("fade-in@100");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fades back in even when the new screen fails to enter", async () => {
    const log: Log = [];
    const { fade, finishOut } = recordingFade(log);
    const factories = Object.fromEntries(
      SCREEN_IDS.map((id) => [id, loggingScreen(id, log, id === "MainMenu")]),
    ) as unknown as Record<ScreenId, ScreenFactory>;
    const manager = new ScreenManager(factories, fakeContext(), () => undefined, undefined, fade);
    await manager.transition("Lobby");
    const going = manager.transition("MainMenu", "fade");
    const caught = going.catch((error: unknown) => error);
    await vi.waitFor(() => expect(log).toContain("fade-out"));
    finishOut();
    expect(await caught).toBeInstanceOf(Error);
    expect(log).toContain("fade-in");
  });
});
