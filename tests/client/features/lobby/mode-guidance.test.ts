import { afterEach, describe, expect, it } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import ReadyRoom from "../../../../apps/client/src/features/lobby/ReadyRoom.svelte";
import { createRoomStore } from "../../../../apps/client/src/features/net/store/room-store.svelte";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { RaceHudView } from "../../../../apps/client/src/features/race/race-hud.svelte";
import { FakeNetwork } from "../../support/fakes/network";
import { fakeSettings } from "../../support/fakes/settings";
import { fakeStage } from "../../support/fakes/stage";
import { LOCAL_ID, playerSnapshot, snapshotAt } from "../../support/snapshots";
import * as m from "../../../../apps/client/src/paraglide/messages.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); document.body.innerHTML = ""; });

function ready(modeId: string, returning = false) {
  const network = new FakeNetwork();
  network.localPlayerId = LOCAL_ID;
  network.roomCode = "NEW234";
  const deliver = (mode: string) => network.emitSnapshot(snapshotAt(0, { phase: "lobby", modeId: mode, players: [playerSnapshot({ id: LOCAL_ID })] }));
  deliver(modeId);
  const store = createRoomStore(network);
  const settings = fakeSettings({ seen: { tutorial: returning } });
  cleanup.push(installLocaleStrategy(settings, () => ["en"]));
  const target = document.createElement("div");
  document.body.append(target);
  const panel = mount(ReadyRoom, { target, props: { store, network, settings, attempt: (action: () => Promise<void>) => void action(), setStatus: () => {}, artSrc: () => "/fixture.png", content: () => undefined, arrangement: "split" } });
  cleanup.push(() => { void unmount(panel); store.dispose(); });
  // The rules live in the Rules sheet: open it, as a player does.
  target.querySelector<HTMLButtonElement>('[data-testid="ready-rules"]')!.click();
  flushSync();
  return { target: document.body, settings, deliver: (mode: string) => { deliver(mode); flushSync(); } };
}

describe("selected-mode guidance", () => {
  it.each([false, true])("teaches Survival before ready, including on a returning device (%s)", (returning) => {
    const { target } = ready("infinite", returning);
    const rules = target.querySelector('[data-testid="mode-tagline"]')!.textContent!;
    // The Owner's wording, 2026-11-14 ("14. A"): lava, not "the rising edge"; the highest floor ranks on the clock.
    expect(rules).toMatch(/rising lava/i);
    expect(rules).toMatch(/you are out/i);
    expect(rules).toMatch(/last racer left wins/i);
    expect(rules).toMatch(/time runs out.*highest floor wins/i);
  });

  it.each(["floors-20", "floors-50"])("explains recovery in %s and follows host mode changes", (mode) => {
    const { target, deliver } = ready(mode);
    expect(target.querySelector('[data-testid="mode-tagline"]')?.textContent).toMatch(/drop back.*collect.*restart/i);
    deliver("infinite");
    expect(target.querySelector('[data-testid="mode-tagline"]')?.textContent).toMatch(/last racer left/i);
    deliver(mode);
    expect(target.querySelector('[data-testid="mode-tagline"]')?.textContent).toMatch(/drop back/i);
    expect(target.textContent).toMatch(/side of a floor.*bounce higher.*top.*count/i);
  });

  it("uses the live mode for the swipe coach and keeps the Survival clock inert", () => {
    const stage = fakeStage();
    const view = new RaceHudView(stage, { settings: fakeSettings(), hint: "swipe", onRestart: () => { throw new Error("Survival must not reset"); } });
    cleanup.push(() => view.destroy());
    view.update(snapshotAt(100, { modeId: "infinite", tuning: { ...snapshotAt(0).tuning, RACE_TIME_LIMIT_TICKS: 7200 }, players: [playerSnapshot({ id: LOCAL_ID })] }), LOCAL_ID, 0);
    flushSync();
    expect(stage.overlay.querySelector('[data-testid="swipe-coach"]')?.textContent).toContain(m.shell_swipe_coach_survival());
    expect(stage.overlay.querySelector('[data-testid="swipe-coach"]')?.textContent).not.toMatch(/restart/i);
    expect(stage.overlay.querySelector('[data-testid="hud-restart"]')).toBeNull();
    view.update(snapshotAt(101, { modeId: "floors-20", players: [playerSnapshot({ id: LOCAL_ID })] }), LOCAL_ID, 10);
    flushSync();
    expect(stage.overlay.querySelector('[data-testid="swipe-coach"]')?.textContent).toMatch(/restart/i);
  });
});


it("recomputes the current mode words after a language switch without remounting", () => {
  const { target, settings, deliver } = ready("infinite", true);
  const rules = target.querySelector('[data-testid="mode-tagline"]')!;
  const english = rules.textContent;
  settings.update({ locale: "ja" });
  flushSync();
  expect(rules.textContent).not.toBe(english);
  deliver("floors-50");
  settings.update({ locale: "en" });
  flushSync();
  expect(rules.textContent).toMatch(/drop back/i);
  expect(rules.textContent).not.toMatch(/last.*standing/i);
});
