import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import PlayerRows from "../../../../apps/client/src/features/select/PlayerRows.svelte";
import type { PlayerRow } from "../../../../apps/client/src/features/select/select-model";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

const rows: PlayerRow[] = [
  { seat: 0, name: "Kite", colour: "scarlet", itemId: "snow-shrine", itemLabel: "Snow Shrine", locked: false, local: true },
  { seat: 1, name: "Sable", colour: "cyan", itemId: "rooftops", itemLabel: "Rooftops", locked: true, local: false },
];

describe("the player rows", () => {
  it("draws one row per player, in words: name, stage, and Locked", () => {
    const host = document.createElement("div");
    document.body.append(host);
    component = mount(PlayerRows, { target: host, props: { rows } });
    flushSync();
    const drawn = [...host.querySelectorAll<HTMLElement>("[data-testid=player-row]")];
    expect(drawn).toHaveLength(2);
    expect(drawn.map((row) => row.textContent!.replace(/\s+/g, " ").trim())).toEqual(["Kite Snow Shrine", "Sable Rooftops Locked"]);
    expect(drawn[1]!.dataset["locked"]).toBe("true");
    expect(drawn[0]!.classList.contains("ff-colour-scarlet")).toBe(true);
  });

  it("marks every row as a row, so a list contract can count them whole", () => {
    const host = document.createElement("div");
    document.body.append(host);
    component = mount(PlayerRows, { target: host, props: { rows } });
    flushSync();
    for (const row of host.querySelectorAll<HTMLElement>("[data-testid=player-row]")) expect(row.hasAttribute("data-row")).toBe(true);
  });

  it("names whose pick won inside the winner's row", () => {
    const host = document.createElement("div");
    document.body.append(host);
    component = mount(PlayerRows, { target: host, props: { rows, winnerSeat: 1, winnerBadge: "Sable's pick" } });
    flushSync();
    const sable = host.querySelector<HTMLElement>("[data-testid=player-row][data-seat='1']")!;
    expect(sable.querySelector("[data-testid=roulette-byline]")!.textContent).toBe("Sable's pick");
    expect(host.querySelectorAll("[data-testid=roulette-byline]")).toHaveLength(1);
  });

  it("sets the word in CSS capitals, never in the source", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/src/features/select/PlayerRows.svelte"), "utf8");
    expect(source).not.toContain(">LOCKED<");
    expect(source).toMatch(/\.ff-rows__lock\s*\{[^}]*text-transform:\s*uppercase/);
  });

  it("marks the highlight and the winner", () => {
    const host = document.createElement("div");
    document.body.append(host);
    component = mount(PlayerRows, { target: host, props: { rows, highlightSeat: 1, winnerSeat: 1 } });
    flushSync();
    const sable = host.querySelector<HTMLElement>("[data-testid=player-row][data-seat='1']")!;
    expect(sable.dataset["highlight"]).toBe("true");
    expect(sable.dataset["winner"]).toBe("true");
  });
});

describe("the deferred minors", () => {
  it("tones a player's bust until it loads, with no ring at that size", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const withArt = rows.map((row) => ({ ...row, art: `/assets/portrait.${row.colour}` }));
    component = mount(PlayerRows, { target: host, props: { rows: withArt } });
    flushSync();
    const frame = host.querySelector<HTMLElement>(".ff-rows__art.ff-async")!;
    expect(frame.dataset["load"]).toBe("pending");
    expect(frame.querySelector("img")!.classList.contains("ff-portrait")).toBe(false);
    expect(frame.classList.contains("ff-portrait")).toBe(true);
  });

  it("keeps a bust's cell when there is no bust, so every row lines up", () => {
    const host = document.createElement("div");
    document.body.append(host);
    component = mount(PlayerRows, { target: host, props: { rows } });
    flushSync();
    for (const row of host.querySelectorAll<HTMLElement>("[data-testid=player-row]")) {
      expect(row.firstElementChild!.classList.contains("ff-rows__art")).toBe(true);
    }
  });
});
