import { describe, expect, it, vi } from "vitest";
import type { ScreenId } from "../../../../../apps/client/src/features/profile/screen-state";
import { createFailureRecovery } from "../../../../../apps/client/src/features/screen/presentation/failure-recovery";
import { ScreenManager } from "../../../../../apps/client/src/features/screen/screen-manager";
import type { Screen } from "../../../../../apps/client/src/features/screen/screen";
import { fakeContext } from "../../../support/fakes/screens";

/**
 * Audit S14: a screen that failed to open mid-session was exited and none was
 * put in its place; the failure went to an error channel read only when the
 * menu next opened, and nothing opened it. The player had a bare canvas while
 * their seat stayed in the race, and the message kept for them said the game
 * "went back to the menu", which was untrue.
 */

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const fakeScreens = (current: ScreenId | undefined, transition: (next: ScreenId) => Promise<void>) => {
  const screens = { currentName: current, transition: vi.fn(transition) };
  return screens;
};

describe("when a screen fails to open (audit S14)", () => {
  it("reports the failure, then puts the menu in the empty place", async () => {
    const order: string[] = [];
    const screens = fakeScreens(undefined, async () => void order.push("menu"));
    const recover = createFailureRecovery({ screens, report: () => void order.push("report") });
    recover();
    await settled();
    expect(order).toEqual(["report", "menu"]);
    expect(screens.transition).toHaveBeenCalledWith("MainMenu");
  });

  it("only reports when a screen is still showing", async () => {
    const screens = fakeScreens("Gameplay", async () => {});
    const report = vi.fn();
    createFailureRecovery({ screens, report })();
    await settled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(screens.transition).not.toHaveBeenCalled();
  });

  it("does not loop when the menu fails to open too", async () => {
    const screens = fakeScreens(undefined, async () => {
      throw new Error("menu assets failed");
    });
    const recover = createFailureRecovery({ screens, report: () => {} });
    recover();
    await settled();
    recover();
    recover();
    await settled();
    expect(screens.transition).toHaveBeenCalledTimes(1);
  });

  it("tries again for a later failure once a screen has been showing in between", async () => {
    const screens = fakeScreens(undefined, async () => {});
    const recover = createFailureRecovery({ screens, report: () => {} });
    recover();
    await settled();
    screens.currentName = "MainMenu";
    recover();
    screens.currentName = undefined;
    recover();
    await settled();
    expect(screens.transition).toHaveBeenCalledTimes(2);
  });
});

describe("through the real screen manager", () => {
  it("ends on the menu, with the failure reported first, after a screen's enter throws", async () => {
    const reported: string[] = [];
    const { publishPresentationEvent: _publish, carryOver: _carry, ...context } = fakeContext();
    const screen = (name: ScreenId, fail = false): Screen => ({
      name,
      enter: async () => {
        if (fail) throw new Error(`${name} failed`);
      },
      exit: () => {},
    });
    const manager = new ScreenManager(
      {
        Splash: () => screen("Splash"),
        MainMenu: () => screen("MainMenu"),
        Lobby: () => screen("Lobby"),
        Gameplay: () => screen("Gameplay", true),
        GameEnd: () => screen("GameEnd"),
        Replay: () => screen("Replay"),
      },
      context,
      () => {},
    );
    const recover = createFailureRecovery({ screens: manager, report: () => void reported.push("failure") });
    await manager.transition("Lobby");
    await manager.transition("Gameplay").catch(() => recover());
    await settled();
    expect(manager.currentName).toBe("MainMenu");
    expect(reported).toEqual(["failure"]);
  });
});
