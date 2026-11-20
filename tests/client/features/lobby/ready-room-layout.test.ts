import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { flushSync, mount, unmount } from "svelte";
import ReadyRoom from "../../../../apps/client/src/features/lobby/ReadyRoom.svelte";
import { createRoomStore } from "../../../../apps/client/src/features/net/store/room-store.svelte";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { shippedContentPort } from "../../support/fakes/content";
import { FakeNetwork } from "../../support/fakes/network";
import { fakeSettings } from "../../support/fakes/settings";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
import { readClient } from "../../support/client-source";
import { LOCAL_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";

const src = (path: string): string => readClient(path.split("/").pop()!);

const shipped = shippedContentPort().current()?.content;
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  document.body.innerHTML = "";
});

function room(arrangement: "stack" | "split") {
  const network = new FakeNetwork();
  network.localPlayerId = LOCAL_ID;
  network.roomCode = "ABC123";
  network.emitSnapshot(
    snapshotAt(0, { phase: "lobby", modeId: "infinite", players: [playerSnapshot({ id: LOCAL_ID, name: "Wolfgang-Amadeus" })] }),
  );
  const store = createRoomStore(network);
  const settings = fakeSettings();
  cleanup.push(installLocaleStrategy(settings, () => ["en"]));
  const target = document.createElement("div");
  document.body.append(target);
  const panel = mount(ReadyRoom, {
    target,
    props: { store, network, settings, attempt: (action: () => Promise<void>) => void action(), setStatus: () => {}, artSrc: () => "/fixture.png", content: () => shipped, arrangement },
  });
  cleanup.push(() => {
    void unmount(panel);
    store.dispose();
  });
  flushSync();
  return target;
}

describe("the ready room's layout", () => {
  it.each(["stack", "split"] as const)("names its root for the fit checks (%s)", (arrangement) => {
    const root = room(arrangement).querySelector<HTMLElement>('[data-testid="ready-room"]');
    expect(root).not.toBeNull();
    expect(root!.dataset["arrangement"]).toBe(arrangement);
    expect(root!.querySelector('[data-testid="seats"]')).not.toBeNull();
    expect(root!.querySelector('[data-testid="ready-actions"]')).not.toBeNull();
  });

  it("lets a seat's name run to two lines instead of cutting it", () => {
    const name = room("stack").querySelector<HTMLElement>('[data-testid="seat-name"]')!;
    expect(name.dataset["whole"]).toBe("true");
    expect(name.textContent).toBe("Wolfgang-Amadeus");
    const css = src("styles/aquarian.css");
    const rule = /\.ff-namepill\[data-whole="true"\] \.ff-namepill__name\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(rule).not.toMatch(/ellipsis/);
  });

  it("draws You and Host as words, not chips, and the wait line in the text colour", () => {
    const css = src("styles/aquarian.css");
    const badge = /\.ff-badge\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(badge).not.toMatch(/border:/);
    expect(badge).toMatch(/color:\s*var\(--ff-text-2\)/);
    const status = room("split").querySelector<HTMLElement>('[data-testid="race-options-status"]')!;
    expect(status.className).not.toContain("ff-aq-secondary");
    expect(src("features/lobby/ReadyRoom.svelte")).toMatch(/\.ff-ready__status\s*\{[^}]*color:\s*var\(--ff-text\)/);
  });

  it("keeps the room code's label on every size and starts the row at the panel's padding", () => {
    expect(src("features/lobby/RoomCode.svelte")).not.toMatch(/max-width:\s*420px/);
    const corners = src("layout/CornerControls.svelte");
    expect(corners).toMatch(/data-header-at="start"\] \.ff-corners__middle\s*\{[^}]*margin-inline-start:[^;]*var\(--ff-panel-pad\)/);
    expect(src("features/lobby/LobbyRoot.svelte")).toMatch(/headerAt=\{inRoom \? "start" : undefined\}/);
  });

  it("no longer stands the character card beside the seats", () => {
    expect(existsSync("apps/client/src/features/lobby/CharacterShowcase.svelte")).toBe(false);
    const lobby = src("features/lobby/LobbyRoot.svelte");
    expect(lobby).not.toContain("CharacterShowcase");
    expect(lobby).not.toContain("ff-lobby__body--showcase");
  });
});

describe("the race choice", () => {
  it("is plain rows of whole buttons, not a scroller", () => {
    const target = room("stack");
    const options = target.querySelector<HTMLElement>('[data-testid="race-options"]')!;
    expect(options).not.toBeNull();
    expect(options.closest(".ff-scroll-list")).toBeNull();
    expect(target.querySelector('[data-testid="race-settings-scroll"]')).toBeNull();
    expect(target.querySelector('[data-testid="scroll-more"]')).toBeNull();
    // Floors, then Minutes (Survival's clock), each a label and its buttons.
    const groups = [...options.querySelectorAll<HTMLElement>('[role="radiogroup"]')].map((group) => group.dataset["testid"]);
    expect(groups).toEqual(["mode-chooser", "clock-chooser"]);
  });

  it("puts the rules behind a Rules button with a word, and out of the room's face", () => {
    const target = room("split");
    const button = target.querySelector<HTMLButtonElement>('[data-testid="ready-rules"]')!;
    expect(button.textContent).toContain(m.ready_rules_button());
    expect(target.querySelector('[data-testid="mode-tagline"]')).toBeNull();
    expect(target.querySelector('[data-testid="wall-tech-help"]')).toBeNull();
    button.click();
    flushSync();
    expect(document.querySelector('[data-testid="mode-tagline"]')?.textContent).toBe(m.ready_mode_survival_tagline());
    expect(document.querySelector('[data-testid="wall-tech-help"]')?.textContent).toBe(m.ready_wall_help());
  });

  it("still says the chosen mode aloud while the rules are closed", () => {
    const live = room("stack").querySelector<HTMLElement>('[data-testid="mode-live"]')!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.classList.contains("sr-only")).toBe(true);
    expect(live.textContent?.trim()).not.toBe("");
  });

  it("has Rules in all six languages", () => {
    for (const locale of ["en", "es-419", "pt-BR", "ja", "ko", "zh-Hans"]) {
      const words = JSON.parse(readFileSync(`apps/client/messages/ui/${locale}.json`, "utf8")) as Record<string, string>;
      expect(words["ready_rules_button"], locale).toBeTruthy();
    }
  });
});
