import { describe, expect, it } from "vitest";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
import { CONNECTION_LABELS } from "../../../../apps/client/src/features/net/connection-state.svelte";

describe("shell copy comes from the catalogue", () => {
  it("labels the connection states from one table", () => {
    expect(CONNECTION_LABELS.offline()).toBe("Offline");
    expect(CONNECTION_LABELS.reconnecting()).toBe("Reconnecting…");
    expect(CONNECTION_LABELS.connected).toBe(m.shell_connection_connected);
  });

  it("names the title's buttons", () => {
    expect([m.title_play(), m.title_character(), m.title_settings(), m.title_quit()]).toEqual([
      "Play",
      "Character",
      "Settings",
      "Quit",
    ]);
  });
});
