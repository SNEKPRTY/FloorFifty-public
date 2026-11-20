// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

// Audit S21, the Owner's "F" (2026-11-14, "all of A-F now"): strings that broke docs/copy-style.md and shipped. The
// style rules are: no contractions, "full screen" in two words, "floor" never "platform", "race" never "match" or
// "game" for one race, the unlock hint names the button ("Save video"), and "DNS" is never shown to a player.
const root = join(__dirname, "../../../..");
const ui = JSON.parse(readFileSync(join(root, "apps/client/messages/ui/en.json"), "utf8")) as Record<string, string>;
const unlocks = (parse(readFileSync(join(root, "content/unlocks.toml"), "utf8")) as { unlocks: { id: string; hint: string }[] }).unlocks;

describe("copy style (audit S21)", () => {
  it("has no contraction in the strings the audit named", () => {
    for (const key of ["error_server_moving", "ready_mode_survival_tagline", "replay_share_failed", "replay_share_unsupported"]) {
      expect(ui[key], key).not.toMatch(/\b\w+'(ll|re|t|ve|d)\b/);
    }
  });

  it("says the ready room's Survival rules as she sees them: lava, not an edge (copy audit S2, Owner's 14. A)", () => {
    expect(ui["ready_mode_survival_tagline"]).toBe(
      "Stay above the rising lava. If it reaches you, you are out. The last racer left wins. If time runs out, the highest floor wins.",
    );
  });

  it("writes full screen as two words, everywhere", () => {
    for (const [key, text] of Object.entries(ui)) expect(JSON.stringify(text), key).not.toMatch(/fullscreen/i);
    expect(ui["shell_fullscreen"]).toBe("Full screen");
    expect(ui["shell_landscape_go"]).toBe("Go full screen");
  });

  it("says floor, not platform", () => {
    // Copy audit (audit/onboarding-copy S10), applied at the coordinator's word: "boost" and "floor credit" are taught nowhere.
    expect(ui["ready_wall_help"]).toBe("Push into the side of a floor to bounce higher. Land on top for it to count.");
    for (const [key, text] of Object.entries(ui)) expect(JSON.stringify(text), key).not.toMatch(/\bplatform/i);
  });

  it("says race, never match or game, in the unlock hints, and names the Save video button", () => {
    for (const { id, hint } of unlocks) expect(hint, id).not.toMatch(/match|game|replay/i);
    expect(unlocks.find((unlock) => unlock.id === "any-match")?.hint).toBe("Finish any race");
    expect(unlocks.find((unlock) => unlock.id === "games-2")?.hint).toBe("Finish 2 races");
    expect(unlocks.find((unlock) => unlock.id === "share-replay")?.hint).toBe("Save or share a video"); // sharing counts too (copy audit N10)
    expect(ui["replay_save_video"]).toBe("Save video");
  });

  it("never shows DNS, and says why a replay is not there", () => {
    expect(ui["race_status_dns"]).toBe("Did not start");
    expect(ui["results_replay_unavailable"]).toBe("The replay is not ready yet.");
  });

  it("tells a player whose server updated what to do next, for a public or a private room", () => {
    expect(ui["error_server_moving"]).toBe("The game updated. Go back to the menu and start again.");
  });
});
