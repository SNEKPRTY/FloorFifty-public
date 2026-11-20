/**
 * Screens a case leaves open are closed after it. A lobby mid-roulette keeps
 * its spin timers, and one firing after the file's jsdom is gone throws
 * "document is not defined" into whichever file the worker runs next.
 */
import { describe, expect, it } from "vitest";
import { lobbyWithFakeNetwork } from "./fakes/screens";
import { closeOpenScreens } from "./open-screens";

describe("closeOpenScreens", () => {
  it("closes a lobby the case left open", async () => {
    const lobby = await lobbyWithFakeNetwork();
    let exits = 0;
    const exit = lobby.screen.exit.bind(lobby.screen);
    lobby.screen.exit = () => {
      exits += 1;
      exit();
    };
    closeOpenScreens();
    expect(exits).toBe(1);
    expect(lobby.overlay.childElementCount).toBe(0);
  });

  it("leaves a lobby the case closed itself", async () => {
    const lobby = await lobbyWithFakeNetwork();
    lobby.screen.exit();
    let exits = 0;
    lobby.screen.exit = () => {
      exits += 1;
    };
    closeOpenScreens();
    expect(exits).toBe(0);
  });
});
