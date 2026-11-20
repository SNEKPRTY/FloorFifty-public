import { flushSync } from "svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import gsap from "gsap";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { MAX_PLAYERS } from "@floor-fifty/shared/common/constants";
import { PLAYER_NAME_MAX_LENGTH } from "@floor-fifty/shared/common/schemas";
import { asRevision } from "@floor-fifty/shared/content/game-content";
import { GENERATED_CONTENT } from "../../../../apps/server/src/content/generated-content";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import { errorCopy } from "../../../../apps/client/src/features/screen/error-copy";
import { fakeContentPort, shippedContentPort } from "../../support/fakes/content";
import { FakeNetwork } from "../../support/fakes/network";
import { lobbyWithFakeNetwork } from "../../support/fakes/screens";
import { fakeSettings } from "../../support/fakes/settings";
import { fakeStage } from "../../support/fakes/stage";
import { lobbySnapshot, playerSnapshot, REMOTE_ID, snapshotAt } from "../../support/snapshots";
import { formFactor } from "../../../../apps/client/src/features/platform/viewport-tracking.svelte";
import { tabbables } from "../../../../apps/client/src/features/platform/focus-nav";

const backdropCount = (stage: ReturnType<typeof fakeStage>): number =>
  stage.ui.children.filter((child) => child.label === "non-gameplay-backdrop").length;

const typeInto = (field: HTMLInputElement, value: string): void => {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
};

// The lobby's first import (its screens, the select screen and the unlock
// code) runs to seconds on a busy runner; paid here, under its own timeout,
// rather than inside whichever test happens to run first.
beforeAll(async () => {
  await import("../../../../apps/client/src/features/lobby/lobby");
}, 30_000);

describe("room formation", () => {
  it("does not forward a stale racing snapshot once the seat has ended", async () => {
    const network = new FakeNetwork();
    // The room closed under a race: the last snapshot said racing, and the
    // seat is gone.
    network.emitSnapshot(snapshotAt(30, { phase: "racing" }));
    network.connectionState = "offline";
    const menu = await lobbyWithFakeNetwork({ network, previousScreen: "Gameplay" });
    expect(menu.publishedEvents().map((event) => event.name)).not.toContain("room.racing");
  });

  it("forwards a resumed racing room to the race (review focus 4)", async () => {
    const network = new FakeNetwork();
    await network.createRoom("Kite");
    // The resumed room's first snapshot arrives before the lobby subscribes.
    network.emitSnapshot(snapshotAt(30, { phase: "racing" }));
    const lobby = await lobbyWithFakeNetwork({ network, previousScreen: "Splash" });
    expect(lobby.published()).toContain("room.racing");
  });

  it("forwards a room resumed mid-countdown to the stage, once (race-flow spec §3.1)", async () => {
    const network = new FakeNetwork();
    await network.createRoom("Kite");
    network.emitSnapshot(lobbySnapshot(1, { phase: "countdown", countdownEndsAtTick: 180, stageId: "rooftops" }));
    const lobby = await lobbyWithFakeNetwork({ network, previousScreen: "Splash" });
    expect(lobby.published().filter((name) => name === "room.racing")).toHaveLength(1);
  });

  it("does not send Race again back to the results it just left", async () => {
    const network = new FakeNetwork();
    await network.createRoom("Kite");
    // The room's reset to its lobby phase can land after the command's answer.
    network.emitSnapshot(snapshotAt(90, { phase: "finished" }));
    const lobby = await lobbyWithFakeNetwork({ network, previousScreen: "GameEnd" });
    expect(lobby.published()).not.toContain("room.finished");
  });

  it("goes back to the title only when not in a room", async () => {
    const lobby = await lobbyWithFakeNetwork();
    lobby.click("lobby-back");
    expect(lobby.published()).toContain("ui.back-requested");

    const held = new FakeNetwork();
    await held.createRoom("Kite");
    const seated = await lobbyWithFakeNetwork({ network: held });
    expect(seated.query("lobby-back")).toBeNull();
  });

  it("goes back on a controller's B, which arrives as Escape, only when not in a room", async () => {
    const { FocusNavigator } = await import("../../../../apps/client/src/features/platform/focus-nav");
    const lobby = await lobbyWithFakeNetwork();
    new FocusNavigator().back();
    expect(lobby.published()).toContain("ui.back-requested");
    lobby.screen.exit();

    // In a room, Leave room is the way out: it releases the seat, so B must
    // never do it by accident.
    const held = new FakeNetwork();
    await held.createRoom("Kite");
    const seated = await lobbyWithFakeNetwork({ network: held });
    new FocusNavigator().back();
    expect(seated.published()).not.toContain("ui.back-requested");
    seated.screen.exit();
  });


  it("uses the stacked wordmark and four full racer sprites from the accepted board", async () => {
    const screen = await lobbyWithFakeNetwork();
    const wordmark = screen.overlay.querySelector('[data-testid="menu-wordmark"]');
    const racers = [...screen.overlay.querySelectorAll<HTMLImageElement>('[data-testid="menu-racer"]')];

    expect(wordmark?.children).toHaveLength(2);
    expect(wordmark?.textContent?.replace(/\s+/g, " ").trim()).toBe("Floor Fifty");
    expect(racers).toHaveLength(4);
    expect(racers.every((racer) => /\/ninja-(scarlet|cyan|violet|gold)\.png$/.test(racer.src))).toBe(true);

    screen.screen.exit();
  });

  it("puts the form in a menu sheet and the hero outside it (responsive parity spec §3.4)", async () => {
    // The sheet is the form column on every form factor: a bottom sheet on a
    // phone held upright, a side column held sideways, a centred card on a
    // tablet. The wordmark belongs to the hero, never to the sheet.
    const screen = await lobbyWithFakeNetwork();
    const sheet = screen.query<HTMLElement>("menu-sheet");

    expect(sheet).not.toBeNull();
    expect(sheet!.hasAttribute("data-scroll-region")).toBe(true);
    expect(sheet!.contains(screen.query("find-race"))).toBe(true);
    // The code row's button is Create room until a code is typed.
    expect(sheet!.contains(screen.query("create-room"))).toBe(true);
    expect(sheet!.contains(screen.query("menu-wordmark"))).toBe(false);
    screen.screen.exit();
  });

  it("describes the swipe controls, the touch default (launch polish §3.1.3)", async () => {
    const screen = await lobbyWithFakeNetwork();
    const help = screen.overlay.querySelector<HTMLElement>(".ff-help-touch")!;

    expect(help.textContent?.trim()).toBe("Drag to steer. Flick down with either thumb to fast fall.");
    expect(help.textContent).not.toMatch(/restart|timer/i);
    screen.screen.exit();
  });

  it("describes the on-screen buttons as the ones that exist when they are chosen (spec §5.6)", async () => {
    // There is no restart button among them, so the help does not offer one.
    const screen = await lobbyWithFakeNetwork({ settings: fakeSettings({ input: { touchMode: "buttons" } }) });
    const help = screen.overlay.querySelector<HTMLElement>(".ff-help-touch")!;

    expect(help.textContent?.trim()).toBe("Use the on-screen arrows to steer and fast fall.");
    expect(help.textContent).not.toMatch(/restart|timer/i);
    screen.screen.exit();
  });

  it("hops a racer the pointer lands on, once, and lets the hop finish", async () => {
    const screen = await lobbyWithFakeNetwork();
    const frames = [...screen.overlay.querySelectorAll<HTMLElement>(".ff-menu-racer-frame")];
    const frame = frames[1]!;
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    frame.dispatchEvent(new MouseEvent("pointerenter"));
    await flush();
    expect(frame.classList.contains("ff-menu-racer-frame--hop")).toBe(true);
    // Only the racer under the pointer.
    expect(frames.filter((f) => f.classList.contains("ff-menu-racer-frame--hop"))).toHaveLength(1);

    // The sheet's pose steps end too; only the arc on the frame lands it.
    frame.querySelector("img")!.dispatchEvent(new Event("animationend", { bubbles: true }));
    await flush();
    expect(frame.classList.contains("ff-menu-racer-frame--hop")).toBe(true);

    frame.dispatchEvent(new Event("animationend"));
    await flush();
    expect(frame.classList.contains("ff-menu-racer-frame--hop")).toBe(false);
    screen.screen.exit();
  });

  it("hops a racer on a tap too, since a touch never hovers (responsive parity §5.8)", async () => {
    const screen = await lobbyWithFakeNetwork();
    const frame = screen.overlay.querySelectorAll<HTMLElement>(".ff-menu-racer-frame")[2]!;

    // A touch fires `pointerenter` on the racer it lands on.
    frame.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frame.classList.contains("ff-menu-racer-frame--hop")).toBe(true);
    screen.screen.exit();
  });

  it("keeps the racers still for a player who asked for less motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      const screen = await lobbyWithFakeNetwork();
      const frame = screen.overlay.querySelector<HTMLElement>(".ff-menu-racer-frame")!;
      frame.dispatchEvent(new MouseEvent("pointerenter"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(frame.classList.contains("ff-menu-racer-frame--hop")).toBe(false);
      screen.screen.exit();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stands the four racers on a rooftop ledge, as the Aquarian board does", async () => {
    const screen = await lobbyWithFakeNetwork();
    const ledge = screen.overlay.querySelector<HTMLElement>('[data-testid="menu-ledge"]');
    const ensemble = screen.overlay.querySelector(".ff-ensemble");

    expect(ledge).not.toBeNull();
    // Decoration, drawn in three so the slab can run to the screen edge while
    // the pipe and planters keep their shape.
    expect(ledge!.getAttribute("aria-hidden")).toBe("true");
    const pieces = [...ledge!.children].map((piece) => piece.getAttribute("style"));
    expect(pieces).toEqual([
      expect.stringMatching(/\/menu-ledge\.png/),
      expect.stringMatching(/\/menu-ledge-slab\.png/),
      expect.stringMatching(/\/menu-ledge\.png/),
    ]);
    // Beside the racers, in the same frame, so it moves with them at every size.
    expect(ledge!.parentElement).toBe(ensemble!.parentElement);
    screen.screen.exit();
  });

  it("sets the wordmark light, the keys as keycaps, and the friends line in the panel", async () => {
    // The Aquarian board's menu type (launch polish spec §2.8 items 3 and 4).
    const screen = await lobbyWithFakeNetwork();
    const overlay = screen.overlay;

    expect(overlay.querySelector('[data-testid="menu-wordmark"]')?.classList.contains("ff-wordmark--light")).toBe(true);

    const keys = [...overlay.querySelectorAll("kbd.ff-keycap")].map((key) => key.textContent?.trim());
    expect(keys).toEqual(["A", "D", "S"]);
    const help = overlay.querySelector(".ff-help");
    expect(help?.textContent).toMatch(/Move/);
    expect(help?.textContent).toMatch(/Fast fall/);
    expect(help?.textContent).not.toMatch(/Restart/);

    const friends = overlay.querySelector('[data-testid="menu-friends"]');
    const panel = overlay.querySelector('[data-testid="find-race"]')?.closest(".ff-aquarian-panel");
    expect(friends?.textContent?.trim()).toBe("Up to four players");
    expect(panel?.contains(friends!)).toBe(true);

    const hasArrow = (id: string) => {
      const button = overlay.querySelector(`[data-testid="${id}"]`)!;
      const arrows = button.querySelectorAll('span[aria-hidden="true"]');
      expect(arrows, id).toHaveLength(1);
      expect(arrows[0]!.textContent).toBe("→");
    };
    hasArrow("find-race");
    hasArrow("create-room");
    // Typing a code turns the code row's button into Join room, arrow and all.
    typeInto(overlay.querySelector<HTMLInputElement>('[data-testid="code-input"]')!, "ABC123");
    hasArrow("join-room");
    typeInto(overlay.querySelector<HTMLInputElement>('[data-testid="code-input"]')!, "");
    // The arrow is decoration: the buttons are still named by their words.
    const visibleName = (id: string) =>
      [...overlay.querySelector(`[data-testid="${id}"]`)!.childNodes]
        .filter((node) => !(node instanceof HTMLElement && node.getAttribute("aria-hidden") === "true"))
        .map((node) => node.textContent)
        .join("")
        .trim();
    expect(visibleName("find-race")).toBe("Find a race");
    expect(visibleName("create-room")).toBe("Create room");
    typeInto(overlay.querySelector<HTMLInputElement>('[data-testid="code-input"]')!, "ABC123");
    expect(visibleName("join-room")).toBe("Join room");
    screen.screen.exit();
  });

  it("sets the tagline as one line of its own, in the hero rather than the form", async () => {
    // It sits in the bottom letterbox bar where there is one, and under the
    // racers in the hero where there is not (responsive parity spec §5.2).
    // Either way it is never part of the form sheet.
    const screen = await lobbyWithFakeNetwork();
    const tagline = screen.query<HTMLElement>("menu-tagline")!;

    expect(tagline.children).toHaveLength(0);
    expect(tagline.textContent?.trim()).toBe("Bounce higher. Race together.");
    expect(tagline.classList.contains("ff-tagline")).toBe(true);
    expect(tagline.closest(".ff-hero")).not.toBeNull();
    expect(tagline.closest('[data-testid="menu-sheet"]')).toBeNull();
    screen.screen.exit();
  });

  it("sets the keys as the panel's footer, on its glass (UI layout spec §6.2)", async () => {
    const screen = await lobbyWithFakeNetwork();
    const help = screen.overlay.querySelector<HTMLElement>(".ff-help")!;
    expect(help.closest(".ff-aquarian-panel")).not.toBeNull();
    expect(help.closest(".ff-hero")).toBeNull();
    // `.ff-help` is the kit `Rise` around the list; the list holds the two keys.
    expect(help.querySelector("dl")!.children).toHaveLength(2);
    screen.screen.exit();
  });

  it("sets the connect panel on the one panel and labels the name field as the board does", async () => {
    const screen = await lobbyWithFakeNetwork();
    const panel = screen.query("create-room")!.closest(".ff-aquarian-panel");
    const label = screen.overlay.querySelector('label[for="ff-name"]');

    expect(panel?.classList.contains("ff-connect__card")).toBe(true);
    expect(label?.textContent?.trim()).toBe("Your name");
    screen.screen.exit();
  });

  it("finds a race on Enter in the name field and joins on Enter in the code field", async () => {
    // Each on its own menu: either action seats the player, which swaps the
    // connect panel out for the ready room.
    const enter = async (field: "name-input" | "code-input") => {
      const screen = await lobbyWithFakeNetwork();
      const name = screen.query<HTMLInputElement>("name-input")!;
      const code = screen.query<HTMLInputElement>("code-input")!;
      expect(name.getAttribute("enterkeyhint")).toBe("go");
      expect(code.getAttribute("enterkeyhint")).toBe("go");
      name.value = "Kite";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      code.value = "abc123";
      code.dispatchEvent(new Event("input", { bubbles: true }));
      screen.query<HTMLInputElement>(field)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const calls = [...screen.network.calls];
      screen.screen.exit();
      return calls;
    };

    expect(await enter("code-input")).toEqual(["joinRoom:ABC123:Kite"]);
    expect(await enter("name-input")).toEqual(["quickMatch:Kite"]);
  });

  it("finds a race from the name row, with the name or a racer name", async () => {
    const screen = await lobbyWithFakeNetwork();
    const name = screen.query<HTMLInputElement>("name-input")!;
    expect(name.closest(".ff-connect__group")).toBe(screen.query("find-race")!.closest(".ff-connect__group"));

    typeInto(name, "Kite");
    screen.query<HTMLButtonElement>("find-race")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.network.calls).toEqual(["quickMatch:Kite"]);
    screen.screen.exit();
  });

  it("falls back to a racer name when the field is empty", async () => {
    const screen = await lobbyWithFakeNetwork();
    // An earlier test's name is remembered by the device; this player has none.
    typeInto(screen.query<HTMLInputElement>("name-input")!, "");
    screen.query<HTMLButtonElement>("find-race")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.network.calls[0]).toMatch(/^quickMatch:Racer \d\d$/);
    screen.screen.exit();
  });

  it("says the placeholder's racer name in the new language after a switch, keeping its number", async () => {
    // As boot does: the strategy reads the store before anything draws a word.
    const settings = fakeSettings();
    const undo = installLocaleStrategy(settings, () => ["en-US"]);
    const screen = await lobbyWithFakeNetwork({ settings });
    try {
      const name = screen.query<HTMLInputElement>("name-input")!;
      typeInto(name, "");
      const number = /^Racer (\d\d)$/.exec(name.placeholder)?.[1];
      expect(number).toBeDefined();
      screen.settings.update({ locale: "ja" });
      flushSync();
      expect(name.placeholder).toBe(`レーサー${number}`);
    } finally {
      // The fakes' settings share one device's storage: leave Automatic for the next test.
      settings.update({ locale: null });
      undo();
      screen.screen.exit();
    }
  });

  it("shows the racer name an empty field will get as its placeholder, so what it shows is what you race as", async () => {
    const screen = await lobbyWithFakeNetwork();
    const name = screen.query<HTMLInputElement>("name-input")!;
    typeInto(name, "");
    expect(name.placeholder).toMatch(/^Racer \d\d$/);
    screen.query<HTMLButtonElement>("find-race")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.network.calls[0]).toBe(`quickMatch:${name.placeholder}`);
    screen.screen.exit();
  });

  it("has Create room on the code row while the code is empty, and Join room once one is typed", async () => {
    const screen = await lobbyWithFakeNetwork();
    const code = screen.query<HTMLInputElement>("code-input")!;
    const label = () => screen.overlay.querySelector('[data-testid="create-room"], [data-testid="join-room"]')!;

    expect(label().getAttribute("data-testid")).toBe("create-room");
    expect(label().textContent).toContain("Create room");

    typeInto(code, "a");
    expect(label().getAttribute("data-testid")).toBe("join-room");
    expect(label().textContent).toContain("Join room");

    typeInto(code, "");
    expect(label().getAttribute("data-testid")).toBe("create-room");
    screen.screen.exit();
  });

  it("treats a code of only spaces as empty", async () => {
    const screen = await lobbyWithFakeNetwork();
    typeInto(screen.query<HTMLInputElement>("code-input")!, "   ");
    expect(screen.query("create-room")).not.toBeNull();
    expect(screen.query("join-room")).toBeNull();
    screen.screen.exit();
  });

  it("keeps the same button element across the swap, so a held press survives it", async () => {
    const screen = await lobbyWithFakeNetwork();
    const before = screen.query("create-room")!;
    typeInto(screen.query<HTMLInputElement>("code-input")!, "ABC123");
    expect(screen.query("join-room")).toBe(before);
    screen.screen.exit();
  });

  it("creates a room from the code row's button while the code is empty", async () => {
    const screen = await lobbyWithFakeNetwork();
    typeInto(screen.query<HTMLInputElement>("name-input")!, "Kite");
    screen.query<HTMLButtonElement>("create-room")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.network.calls).toEqual(["createRoom:Kite"]);
    screen.screen.exit();
  });

  it("re-words a refusal on the status line when the language changes", async () => {
    const settings = fakeSettings();
    const undo = installLocaleStrategy(settings, () => ["en-US"]);
    const screen = await lobbyWithFakeNetwork({ settings });
    try {
      screen.network.emitError({ code: "ROOM_FULL", message: "room is full" });
      flushSync();
      const english = screen.query("menu-status")!.textContent!.trim();
      expect(english).toBe(errorCopy("ROOM_FULL")());
      settings.update({ locale: "ja" });
      flushSync();
      const japanese = screen.query("menu-status")!.textContent!.trim();
      expect(japanese).toBe(errorCopy("ROOM_FULL")());
      expect(japanese).not.toBe(english);
    } finally {
      // The fakes' settings share one device's storage: leave Automatic for the next test.
      settings.update({ locale: null });
      undo();
      screen.screen.exit();
    }
  });

  it("does nothing on Enter in an empty code field", async () => {
    const screen = await lobbyWithFakeNetwork();
    typeInto(screen.query<HTMLInputElement>("name-input")!, "Kite");
    screen.query<HTMLInputElement>("code-input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.network.calls).toEqual([]);
    expect((screen.query("menu-status")?.textContent ?? "").trim()).toBe("");
    screen.screen.exit();
  });

  it("puts Find a race ahead of the code row in focus order", async () => {
    // Document order is tab order: nothing here sets a tabindex.
    const screen = await lobbyWithFakeNetwork();
    const order = [
      ...screen.overlay.querySelectorAll<HTMLElement>(
        '[data-testid="find-race"], [data-testid="code-input"], [data-testid="create-room"]',
      ),
    ].map((node) => node.dataset["testid"]);
    expect(order).toEqual(["find-race", "code-input", "create-room"]);
    screen.screen.exit();
  });

  it("keeps the room field from reading as a verification-code field", async () => {
    // Apple's Passwords also fills one-time codes, and it keys on "code" in a
    // field's id and name: the room field offered it an AutoFill the name
    // field never did.
    const screen = await lobbyWithFakeNetwork();
    const room = screen.query<HTMLInputElement>("code-input")!;
    expect(room.id).not.toMatch(/code/i);
    expect(room.name).toBe("room");
    expect(screen.overlay.querySelector(`label[for="${room.id}"]`)?.textContent?.trim()).toBe("Have a room code?");
    screen.screen.exit();
  });

  it("gives password managers nothing to treat as a login", async () => {
    // A form holding one text field and a submit button reads as a sign-in to
    // a password manager, which then pops its AutoFill offer over the code
    // field. No form, and the managers' own opt-out attributes on both fields.
    const screen = await lobbyWithFakeNetwork();
    expect(screen.overlay.querySelector("form")).toBeNull();
    for (const id of ["name-input", "code-input"]) {
      const input = screen.query<HTMLInputElement>(id)!;
      expect(input.getAttribute("data-1p-ignore"), id).not.toBeNull();
      expect(input.getAttribute("data-lpignore"), id).toBe("true");
      expect(input.getAttribute("data-bwignore"), id).not.toBeNull();
      expect(input.getAttribute("data-form-type"), id).toBe("other");
    }
    expect(screen.query("code-input")!.getAttribute("autocomplete")).toBe("off");
    screen.screen.exit();
  });

  it("remembers the last name used and fills it in next time", async () => {
    localStorage.clear();
    const first = await lobbyWithFakeNetwork();
    await first.createRoom("Kite");
    first.screen.exit();

    const second = await lobbyWithFakeNetwork();
    expect(second.query<HTMLInputElement>("name-input")!.value).toBe("Kite");
    second.screen.exit();
    localStorage.clear();
  });

  it("still mounts with an empty name when storage throws", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const screen = await lobbyWithFakeNetwork();
      expect(screen.query<HTMLInputElement>("name-input")!.value).toBe("");
      await screen.createRoom("Kite");
      expect(screen.network.calls).toContain("createRoom:Kite");
      screen.screen.exit();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("keeps one refracted backdrop across connect and ready-room substates", async () => {
    const stage = fakeStage();
    const menu = await lobbyWithFakeNetwork({ stage });
    expect(backdropCount(stage)).toBe(1);
    await menu.createRoom("Kite");
    menu.receiveSnapshot(lobbySnapshot(1));
    expect(backdropCount(stage)).toBe(1);
    menu.screen.exit();
    expect(backdropCount(stage)).toBe(0);
  });

  it("keeps room formation inside the lobby and hands over to Gameplay as the countdown begins", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");

    // Select replaces the ready room (select spec §3); the countdown happens
    // on the stage, so the Lobby hands over as it begins (race-flow spec §3).
    screen.receiveSnapshot(
      lobbySnapshot(1, { phase: "select", select: { step: "stage", endsAtTick: 900, picks: {}, loaded: [] } }),
    );
    expect(screen.publishedEvents()).toEqual([]);
    // The ready room fades out as select fades in (one `ViewSwitch`), so it leaves a moment after.
    await vi.waitFor(() => expect(screen.query("seats")).toBeNull());
    expect(screen.query("select-screen")).not.toBeNull();

    screen.receiveSnapshot(lobbySnapshot(1, { phase: "countdown", countdownEndsAtTick: 180, stageId: "rooftops" }));
    expect(screen.publishedEvents().map((event) => event.name)).toEqual(["room.racing"]);

    screen.receiveSnapshot(snapshotAt(180, { phase: "racing" }));
    expect(screen.publishedEvents().map((event) => event.name)).toEqual(["room.racing"]);
  });

  it("leaving the room mid-countdown stops the countdown at once, mid-word", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1, { phase: "countdown", countdownEndsAtTick: 180 }));
    // The Lobby's own cues sound until it hands over to the stage, and there is
    // no Leave of its own meanwhile; the seat going away, however it goes, is
    // what stops the call.
    await screen.network.leaveRoom();
    await Promise.resolve();
    expect(screen.audio.calls).toContain("stop:countdown:");
  });

  it("creates a room from the name the player typed", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    expect(screen.network.calls).toContain("createRoom:Kite");
  });

  it("joins with an uppercased room code", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.joinRoom("abc123", "Kite");
    expect(screen.network.calls).toContain("joinRoom:ABC123:Kite");
  });

  it("joins with a code pasted from a chat, spaces and dash included", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.joinRoom(" abc-123\n", "Kite");
    expect(screen.network.calls).toContain("joinRoom:ABC123:Kite");
  });

  it("creates with a racer name when none was typed, since a controller cannot type", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("   ");
    expect(screen.network.calls).toHaveLength(1);
    expect(screen.network.calls[0]).toMatch(/^createRoom:Racer \d\d$/);
  });

  it("refuses to send a room code of the wrong length", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.joinRoom("AB1", "Kite");
    expect(screen.network.calls).toEqual([]);
    expect(screen.statusText()).toMatch(/6 characters/);
  });

  it("shows a server refusal in place and stays in the lobby", async () => {
    const screen = await lobbyWithFakeNetwork();
    screen.network.nextFailure = { code: "ROOM_FULL", message: "this room is full" };
    await screen.joinRoom("ABC123", "Kite");
    expect(screen.statusText()).toMatch(/full/);
    expect(screen.publishedEvents()).toEqual([]);
  });
});

describe("the ready room", () => {
  it("shows a seat for every place in the room", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(2));
    expect(screen.overlay.querySelectorAll('[data-testid="seat"]')).toHaveLength(MAX_PLAYERS);
  });

  it("does not let a guest touch the lap chooser", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.joinRoom("ABC123", "Ninja 2");
    screen.receiveSnapshot(lobbySnapshot(2, { hostId: asPlayerId("room-p1") }));

    const lapThree = screen.query<HTMLButtonElement>("lap-3")!;
    expect(lapThree.disabled).toBe(true);
  });

  it("lets the host choose three laps", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(2, { hostId: asPlayerId("room-p1") }));

    const lapThree = screen.query<HTMLButtonElement>("lap-3")!;
    expect(lapThree.disabled).toBe(false);
    lapThree.click();
    expect(screen.network.calls).toContain("setLapCount:3");
  });

  it("lets the host choose the floors, and sends the mode (race-options spec §3.4)", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(2, { hostId: asPlayerId("room-p1") }));

    const fifty = screen.query<HTMLButtonElement>("mode-floors-50")!;
    expect(fifty.disabled).toBe(false);
    fifty.click();
    expect(screen.network.calls).toContain("setMode:floors-50");
  });

  it("shows a guest the floors, disabled", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.joinRoom("ABC123", "Ninja 2");
    screen.receiveSnapshot(lobbySnapshot(2, { hostId: asPlayerId("room-p1") }));

    for (const id of ["floors-20", "floors-50", "infinite"]) {
      expect(screen.query<HTMLButtonElement>(`mode-${id}`)!.disabled).toBe(true);
    }
  });

  it("checks the room's mode, not the clicked one", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1, { modeId: "infinite" }));

    screen.query<HTMLButtonElement>("mode-floors-20")!.click();
    expect(screen.query("mode-infinite")!.getAttribute("aria-checked")).toBe("true");
    expect(screen.query("mode-floors-20")!.getAttribute("aria-checked")).toBe("false");
  });

  it("hides the laps for a mode with one lap count", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1, { modeId: "floors-50" }));

    expect(screen.query("lap-chooser")).toBeNull();
    expect(screen.query("mode-chooser")).not.toBeNull();
  });

  it("shows the lap count the server reports rather than the one clicked", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1, { lapCount: 1 }));

    screen.query<HTMLButtonElement>("lap-3")!.click();
    // No snapshot has confirmed the change, so the control still shows one lap.
    expect(screen.query<HTMLButtonElement>("lap-1")!.dataset["selected"]).toBe("true");
  });

  it("toggles readiness through the server", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    screen.query<HTMLButtonElement>("ready-toggle")!.click();
    expect(screen.network.calls).toContain("setReady:true");
  });

  it("offers the room code with a copy affordance", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    expect(screen.query("room-code")?.textContent).toBe("ABC123");
    expect(screen.query("copy-code")).not.toBeNull();
  });

  it("returns to the create and join controls when the player leaves", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));

    screen.query<HTMLButtonElement>("leave-room")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.network.calls).toContain("leaveRoom");
    expect(screen.query("create-room")).not.toBeNull();
  });

  it("reflects the connection state on the screen root", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.network.emitConnectionState("reconnecting");
    expect(screen.query("lobby")?.getAttribute("data-connection")).toBe("reconnecting");
  });

  it("releases its subscription and DOM on exit", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.screen.exit();
    expect(screen.query("lobby")).toBeNull();
    // A snapshot after exit must not reach a screen that is gone.
    expect(() => screen.receiveSnapshot(snapshotAt(1, { phase: "racing" }))).not.toThrow();
    expect(screen.publishedEvents()).toEqual([]);
  });
});

describe("the ready room on the layout primitives (UI layout spec §6.3)", () => {
  it("keeps four seats in a list that never gives a row away", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(2));
    const list = screen.query<HTMLElement>("seats")!.closest("[data-min-rows]");
    expect(list?.getAttribute("data-min-rows")).toBe("4");
    // The contract counts whole rows by their [data-row] children.
    expect(list!.querySelectorAll("[data-row]")).toHaveLength(4);
    screen.screen.exit();
  });

  it("puts the badges on a line of their own under the name", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    const seat = screen.queryAll("seat")[0]!;
    const name = seat.querySelector<HTMLElement>('[data-testid="seat-name"]')!;
    const you = seat.querySelector<HTMLElement>('[data-testid="seat-you"]')!;
    expect(name.contains(you)).toBe(false);
    expect(you.closest("[data-badge-row]")).not.toBeNull();
    // A seat's name is whole: it wraps, it is never the cut text.
    expect(name.querySelector("[data-truncatable]")).toBeNull();
    expect(name.dataset["whole"]).toBe("true");
    screen.screen.exit();
  });

  it("fills the selected Floors and Laps rather than underlining them", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1, { modeId: "floors-20", lapCount: 1 }));
    expect(screen.query("mode-floors-20")!.classList.contains("ff-option--selected")).toBe(true);
    expect(screen.query("lap-1")!.classList.contains("ff-option--selected")).toBe(true);
    expect(screen.query("mode-floors-20")!.classList.contains("ff-aq-control--selected")).toBe(false);
    screen.screen.exit();
  });

  it("shows the room code in the corner row, beside Mute", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    const corners = screen.overlay.querySelector("[data-corner-controls]")!;
    expect(corners.contains(screen.query("room-code"))).toBe(true);
    expect(corners.contains(screen.query("copy-code"))).toBe(true);
    expect(corners.contains(screen.query("corner-mute"))).toBe(true);
    screen.screen.exit();
  });

  it("anchors Ready and Leave room in one action bar under the settings", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    const bar = screen.query<HTMLElement>("ready-toggle")!.closest("[data-action-bar]")!;
    expect(bar.contains(screen.query("leave-room"))).toBe(true);
    const options = screen.query<HTMLElement>("race-options")!;
    expect(options.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.query("ready-toggle")!.getAttribute("data-sfx")).toBe("ready");
    expect(screen.query("leave-room")!.getAttribute("data-sfx")).toBe("back");
    screen.screen.exit();
  });
});

describe("CPU seats (CPU players spec §5.1)", () => {
  type Lobby = Awaited<ReturnType<typeof lobbyWithFakeNetwork>>;
  const seatsOf = (screen: Lobby) => [...screen.overlay.querySelectorAll<HTMLElement>('[data-testid="seat"]')];
  const statusOf = (seat: HTMLElement) => seat.querySelector('[data-testid="seat-status"]')?.textContent?.trim();

  async function room(over: Parameters<typeof lobbySnapshot>[1] = {}, count = 1) {
    const network = new FakeNetwork();
    const screen = await lobbyWithFakeNetwork({ network });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(count, { access: "private", ...over }));
    return { screen, network };
  }

  it("gives the host a + CPU button on every open seat, and adds a CPU when pressed", async () => {
    const { screen, network } = await room();
    const open = seatsOf(screen).slice(1);
    expect(open.map((seat) => statusOf(seat))).toEqual(["+ CPU", "+ CPU", "+ CPU"]);
    const button = open[1]!.querySelector<HTMLButtonElement>('[data-testid="seat-add-cpu"]')!;
    expect(button.getAttribute("aria-label")).toBe("Add a CPU");
    button.click();
    expect(network.calls).toContain("addCpu");
    screen.screen.exit();
  });

  it("shows a CPU seat with CPU in its status slot, and lets the host remove it", async () => {
    const snapshot = lobbySnapshot(2, { access: "private" });
    const players = [snapshot.players[0]!, { ...snapshot.players[1]!, name: "Koi", cpu: true, ready: true }];
    const { screen, network } = await room({ players });
    const cpuSeat = seatsOf(screen)[1]!;
    expect(cpuSeat.dataset["cpu"]).toBe("true");
    expect(statusOf(cpuSeat)).toBe("CPU");
    const remove = cpuSeat.querySelector<HTMLButtonElement>('[data-testid="seat-remove-cpu"]')!;
    expect(remove.getAttribute("aria-label")).toBe("Remove Koi");
    remove.click();
    expect(network.calls).toContain(`removeCpu:${players[1]!.id}`);
    screen.screen.exit();
  });

  it("gives a guest no seat buttons and no + CPU", async () => {
    const { screen } = await room({ hostId: REMOTE_ID }, 2);
    expect(screen.overlay.querySelectorAll('[data-testid="seat-add-cpu"], [data-testid="seat-remove-cpu"]')).toHaveLength(0);
    expect(seatsOf(screen).slice(2).map((seat) => statusOf(seat))).toEqual(["", ""]);
    screen.screen.exit();
  });

  it("gives nobody seat buttons in a public room", async () => {
    const { screen } = await room({ access: "public", tick: 0, soloFromTick: 1200 });
    expect(screen.overlay.querySelectorAll('[data-testid="seat-add-cpu"]')).toHaveLength(0);
    screen.screen.exit();
  });

  it("puts the host's seat buttons in the keyboard and controller focus order", async () => {
    const { screen } = await room();
    const order = tabbables(screen.overlay).map((element) => element.dataset["testid"]);
    expect(order.filter((id) => id === "seat-add-cpu")).toHaveLength(3);
    screen.screen.exit();
  });

  it("announces a CPU arriving and leaving through the polite live region", async () => {
    const { screen } = await room();
    const region = () => screen.overlay.querySelector<HTMLElement>('p.sr-only[aria-live="polite"]')!.textContent?.trim();
    const base = lobbySnapshot(1, { access: "private" });
    const koi = playerSnapshot({ id: REMOTE_ID, name: "Koi", colour: "cyan", cpu: true, ready: true });
    screen.receiveSnapshot({ ...base, players: [...base.players, koi] });
    flushSync();
    expect(region()).toBe("Koi joined as a CPU.");
    screen.receiveSnapshot(base);
    flushSync();
    expect(region()).toBe("Koi left.");
    screen.screen.exit();
  });

  it("never raises a CPU or open seat to the touch floor your own seat takes", async () => {
    const { screen } = await room();
    const open = seatsOf(screen)[1]!;
    expect(open.querySelector(".ff-seat__change")).toBeNull();
    expect(open.querySelector(".ff-seat__cpu")).not.toBeNull();
    screen.screen.exit();
  });
});

describe("a public ready room", () => {
  type Lobby = Awaited<ReturnType<typeof lobbyWithFakeNetwork>>;
  const ready = (screen: Lobby) => screen.query<HTMLButtonElement>("ready-toggle")!;
  const liveRegion = (screen: Lobby) =>
    screen.overlay.querySelector<HTMLElement>('p.sr-only[aria-live="polite"]')!;

  async function seated(over: Parameters<typeof lobbySnapshot>[1], count = 1) {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(count, { access: "public", ...over }));
    return screen;
  }

  it("shows the search clock on the status line, and Race CPUs ready to press", async () => {
    const screen = await seated({ tick: 0, soloFromTick: 1200 });
    expect(screen.query("quick-match-clock")?.textContent?.trim()).toBe("Looking for racers… 0:20");
    expect(ready(screen).textContent?.trim()).toBe("Race CPUs");
    expect(ready(screen).disabled).toBe(false);
    screen.screen.exit();
  });

  it("gives the status line its own test ID, and the quick-match clock a span inside it (audit remediation D-R7)", async () => {
    const screen = await seated({ tick: 0, soloFromTick: 1200 });
    const status = screen.query("race-options-status")!;
    expect(status.tagName).toBe("P");
    expect(status.querySelector('[data-testid="quick-match-clock"]')?.textContent?.trim()).toBe("Looking for racers… 0:20");
    screen.screen.exit();
  });

  it("shows the start clock with company, and Ready as before", async () => {
    const screen = await seated({ tick: 360, startsAtTick: 1800 }, 2);
    expect(screen.query("quick-match-clock")?.textContent?.trim()).toBe("Race starts in 0:24");
    expect(ready(screen).textContent?.trim()).toBe("Ready");
    expect(ready(screen).disabled).toBe(false);
    screen.screen.exit();
  });

  it("pulses the status line once when a race is found, and not when it is called off", async () => {
    const screen = await seated({ tick: 0, soloFromTick: 1200 });
    const line = screen.query("race-options-status")!;
    expect(gsap.getTweensOf(line)).toHaveLength(0);

    screen.receiveSnapshot(lobbySnapshot(2, { access: "public", tick: 360, startsAtTick: 1800 }));
    expect(gsap.getTweensOf(line), "a found race pulses it").toHaveLength(1);
    gsap.killTweensOf(line);

    screen.receiveSnapshot(lobbySnapshot(2, { access: "public", tick: 400, startsAtTick: 1800 }));
    expect(gsap.getTweensOf(line), "the clock ticking on does not").toHaveLength(0);

    screen.receiveSnapshot(lobbySnapshot(1, { access: "public", tick: 500, soloFromTick: 1700 }));
    expect(gsap.getTweensOf(line), "a race called off does not").toHaveLength(0);
    screen.screen.exit();
  });

  it("enables Race CPUs when the search has run out", async () => {
    const screen = await seated({ tick: 1200, soloFromTick: 1200 });
    expect(screen.query("quick-match-clock")?.textContent?.trim()).toBe("Nobody has joined. You can race CPUs.");
    expect(ready(screen).textContent?.trim()).toBe("Race CPUs");
    expect(ready(screen).disabled).toBe(false);
    screen.screen.exit();
  });

  it("keeps a private room's line and its Ready button", async () => {
    const screen = await seated({ access: "private", tick: 0 });
    expect(screen.query("quick-match-clock")).toBeNull();
    // The seat the fake network gives is the host's.
    expect(screen.overlay.textContent).toContain("Everyone must be ready to start.");
    expect(ready(screen).textContent?.trim()).toBe("Ready");
    screen.screen.exit();
  });

  it("keeps the same ready button as the clock changes, so a held press survives", async () => {
    const screen = await seated({ tick: 0, soloFromTick: 1200 });
    const before = ready(screen);
    screen.receiveSnapshot(lobbySnapshot(2, { access: "public", tick: 60, startsAtTick: 1860 }));
    expect(ready(screen)).toBe(before);
    expect(before.textContent?.trim()).toBe("Ready");
    screen.screen.exit();
  });

  it("announces the clock once, and not again as the seconds pass", async () => {
    const screen = await seated({ tick: 0, soloFromTick: 1200 });
    expect(liveRegion(screen).textContent).toBe("Looking for racers.");
    screen.receiveSnapshot(lobbySnapshot(1, { access: "public", tick: 60, soloFromTick: 1200 }));
    screen.receiveSnapshot(lobbySnapshot(1, { access: "public", tick: 120, soloFromTick: 1200 }));
    expect(liveRegion(screen).textContent).toBe("Looking for racers.");

    screen.receiveSnapshot(lobbySnapshot(2, { access: "public", tick: 180, startsAtTick: 1980 }));
    expect(liveRegion(screen).textContent).toBe("Race starts in 30 seconds.");
    screen.screen.exit();
  });
});

describe("surviving the snapshot stream", () => {
  // Authority broadcasts at 20 Hz, so the ready room is re-rendered every 50 ms
  // for as long as a player sits in it. Rebuilding the DOM on each one destroys
  // the button under the player's finger: a press held longer than 50 ms lands
  // its `pointerup` on a node that is no longer in the document, and the click
  // event never fires. Nothing registers.
  it("keeps the same ready button across an ordinary snapshot", async () => {
    const menu = await lobbyWithFakeNetwork();
    menu.network.localPlayerId = "room-p1";
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 100 }));

    const before = menu.query<HTMLButtonElement>("ready-toggle");
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 103 }));

    expect(menu.query<HTMLButtonElement>("ready-toggle")).toBe(before);
  });

  it("keeps the pressed button in the document so its click can fire", async () => {
    const menu = await lobbyWithFakeNetwork();
    menu.network.localPlayerId = "room-p1";
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 100 }));

    const pressed = menu.query<HTMLButtonElement>("ready-toggle")!;
    pressed.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 103 }));

    expect(document.contains(pressed)).toBe(true);
  });

  it("registers a press that spans a snapshot", async () => {
    const menu = await lobbyWithFakeNetwork();
    menu.network.localPlayerId = "room-p1";
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 100 }));

    const pressed = menu.query<HTMLButtonElement>("ready-toggle")!;
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 103 }));
    pressed.click();

    expect(menu.network.calls).toContain("setReady:true");
  });

  it("keeps the lap chooser's buttons across a snapshot", async () => {
    const menu = await lobbyWithFakeNetwork();
    menu.network.localPlayerId = "room-p1";
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 100 }));

    const before = menu.query<HTMLButtonElement>("lap-3");
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 103 }));

    expect(menu.query<HTMLButtonElement>("lap-3")).toBe(before);
  });

  it("still shows what the newest snapshot says", async () => {
    // Reusing the nodes must not mean showing stale state.
    const menu = await lobbyWithFakeNetwork();
    menu.network.localPlayerId = "room-p1";
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 100 }));
    expect(menu.query("ready-toggle")?.textContent).toBe("Ready");

    const ready = lobbySnapshot(2, { tick: 103 });
    menu.receiveSnapshot({
      ...ready,
      players: ready.players.map((player) =>
        player.id === "room-p1" ? { ...player, ready: true } : player,
      ),
    });

    expect(menu.query("ready-toggle")?.textContent).toBe("Not ready");
    expect(menu.query<HTMLElement>("seats")?.textContent).toContain("Ready");
  });

  it("reflects a lap count the host changed", async () => {
    const menu = await lobbyWithFakeNetwork();
    menu.network.localPlayerId = "room-p1";
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 100 }));
    menu.receiveSnapshot(lobbySnapshot(2, { tick: 103, lapCount: 3 }));

    expect(menu.query<HTMLButtonElement>("lap-3")?.dataset["selected"]).toBe("true");
    expect(menu.query<HTMLButtonElement>("lap-1")?.dataset["selected"]).toBe("false");
  });

  it("does not wipe a name the player is typing when the connection changes", async () => {
    // The connect view is rebuilt by the same render path, so a reconnect while
    // someone is typing their name throws the name away.
    const menu = await lobbyWithFakeNetwork();
    const name = menu.query<HTMLInputElement>("name-input")!;
    name.value = "Kite";

    menu.network.emitConnectionState("reconnecting");

    expect(menu.query<HTMLInputElement>("name-input")?.value).toBe("Kite");
  });
});

/**
 * Content refresh.
 *
 * Two triggers, because neither covers the other's case. The notification
 * reaches a client sitting outside a room, where no snapshot ever arrives;
 * the snapshot comparison reaches a client that joined or reconnected after
 * that notification fired, or that missed it. The comparison is the durable
 * one, which makes the notification an optimisation rather than the mechanism.
 */
describe("the menu and the server's content", () => {
  it("refreshes on entry", async () => {
    const content = fakeContentPort(GENERATED_CONTENT);
    await lobbyWithFakeNetwork({ content });
    expect(content.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes an open menu on a content notification", async () => {
    const content = fakeContentPort(GENERATED_CONTENT);
    const menu = await lobbyWithFakeNetwork({ content });

    menu.network.emitContentRevision("b".repeat(64));

    expect(content.refresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes an open menu on a snapshot from newer content", async () => {
    const content = fakeContentPort(GENERATED_CONTENT);
    const menu = await lobbyWithFakeNetwork({ content });

    menu.receiveSnapshot(
      lobbySnapshot(1, { contentRevision: GENERATED_CONTENT.contentRevision }),
    );
    expect(content.refresh).toHaveBeenCalledTimes(1);

    menu.receiveSnapshot(lobbySnapshot(1, { contentRevision: asRevision("b".repeat(64)) }));
    expect(content.refresh).toHaveBeenCalledTimes(2);
  });

  /**
   * A room freezes its content for life, so a lobby whose room was created
   * before a rebuild broadcasts a revision this client can never catch up to.
   * One refresh per revision it has not already asked about; never one per
   * snapshot, which at 20 Hz is a request storm that cannot converge.
   */
  it("asks once for the content a frozen room keeps naming", async () => {
    const content = fakeContentPort(GENERATED_CONTENT);
    const menu = await lobbyWithFakeNetwork({ content });
    const frozen = asRevision("b".repeat(64));

    for (let i = 0; i < 10; i += 1) {
      menu.receiveSnapshot(lobbySnapshot(1, { contentRevision: frozen }));
    }

    expect(content.refresh).toHaveBeenCalledTimes(2);
  });

  it("asks again when a frozen room is replaced by a differently frozen one", async () => {
    const content = fakeContentPort(GENERATED_CONTENT);
    const menu = await lobbyWithFakeNetwork({ content });

    menu.receiveSnapshot(lobbySnapshot(1, { contentRevision: asRevision("b".repeat(64)) }));
    menu.receiveSnapshot(lobbySnapshot(1, { contentRevision: asRevision("c".repeat(64)) }));

    expect(content.refresh).toHaveBeenCalledTimes(3);
  });

  it("lets go of the notification when it leaves", async () => {
    const content = fakeContentPort(GENERATED_CONTENT);
    const menu = await lobbyWithFakeNetwork({ content });
    menu.screen.exit();

    menu.network.emitContentRevision("b".repeat(64));

    expect(content.refresh).toHaveBeenCalledTimes(1);
  });
});

/**
 * Seat identity.
 *
 * A seat says who is in it three different ways -- its number, its name, and
 * whether it is you or the host -- and those are three different questions. The
 * markers in particular must come from the room's identity rather than from a
 * seat's position: the host is whoever `hostId` names and "you" is whoever
 * `localPlayerId` names, and neither is seat one the moment a room fills in a
 * different order.
 */
describe("seat identity", () => {
  it("marks YOU and HOST from the room's identity, not from seat one", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.joinRoom("ABC123", "Ninja 2");
    // The local player sits first but is not the host; the host sits second.
    // Inferring either marker from position would get both rows wrong here.
    screen.network.localPlayerId = "room-p1";
    screen.receiveSnapshot(lobbySnapshot(2, { hostId: asPlayerId("room-p2") }));

    const seats = [...screen.overlay.querySelectorAll('[data-testid="seat"]')];
    expect(seats).toHaveLength(MAX_PLAYERS);
    expect(seats[0]?.getAttribute("data-you")).toBe("true");
    expect(seats[0]?.getAttribute("data-host")).toBe("false");
    expect(seats[1]?.getAttribute("data-you")).toBe("false");
    expect(seats[1]?.getAttribute("data-host")).toBe("true");
  });

  it("keeps a maximum-length name whole in the DOM and in its title", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    const longest = "N".repeat(PLAYER_NAME_MAX_LENGTH);
    const lobby = lobbySnapshot(2);
    screen.receiveSnapshot({
      ...lobby,
      players: lobby.players.map((player, index) =>
        index === 0 ? { ...player, name: longest } : player,
      ),
    });

    // The seat grows a line rather than cut the name; the whole name is also
    // in the title a pointer shows.
    const name = screen.query<HTMLElement>("seat-name")!;
    expect(name.textContent).toBe(longest);
    expect(name.querySelector(".ff-namepill__name")!.getAttribute("title")).toBe(longest);
  });

  it("keeps the same seats and the same ready button across a snapshot", async () => {
    const screen = await lobbyWithFakeNetwork();
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(2));

    const held = screen.query("ready-toggle");
    const firstSeat = screen.overlay.querySelector('[data-testid="seat"]');
    screen.receiveSnapshot(lobbySnapshot(2));

    expect(screen.query("ready-toggle")).toBe(held);
    expect(screen.overlay.querySelectorAll('[data-testid="seat"]')).toHaveLength(MAX_PLAYERS);
    expect(screen.overlay.querySelector('[data-testid="seat"]')).toBe(firstSeat);
  });
});

describe("the tutorial offer (launch polish §3.1.4)", () => {
  it("offers the tutorial on the first Play, once", async () => {
    const settings = fakeSettings();
    const first = await lobbyWithFakeNetwork({ settings, previousScreen: "MainMenu" });
    expect(first.query("tutorial-offer")).not.toBeNull();
    first.click("tutorial-offer-accept");
    expect(first.published()).toContain("ui.tutorial-requested");
    first.screen.exit();

    const skipped = await lobbyWithFakeNetwork({ settings, previousScreen: "MainMenu" });
    skipped.click("tutorial-offer-skip");
    expect(settings.value.seen.tutorial).toBe(true);
    // The offer is a kit panel and falls out before it goes.
    await vi.waitFor(() => expect(skipped.query("tutorial-offer")).toBeNull());
    skipped.screen.exit();

    const again = await lobbyWithFakeNetwork({ settings, previousScreen: "MainMenu" });
    expect(again.query("tutorial-offer")).toBeNull();
    again.screen.exit();
  });

  it("does not offer the tutorial to a player returning from a race", async () => {
    const lobby = await lobbyWithFakeNetwork({ previousScreen: "GameEnd" });
    expect(lobby.query("tutorial-offer")).toBeNull();
    lobby.screen.exit();
  });

  it("does not offer the tutorial to a player already in a room", async () => {
    const held = new FakeNetwork();
    await held.createRoom("Kite");
    const seated = await lobbyWithFakeNetwork({ network: held, previousScreen: "MainMenu" });
    expect(seated.query("tutorial-offer")).toBeNull();
    seated.screen.exit();
  });

  it("offers the tutorial above the form, not inside it", async () => {
    // The offer shows on a first Play from the title. Seeded unseen: the
    // tests above store a skip, which a fresh store would read back.
    const lobby = await lobbyWithFakeNetwork({ settings: fakeSettings({ seen: { tutorial: false } }), previousScreen: "MainMenu" });
    const offer = lobby.query<HTMLElement>("tutorial-offer")!;
    expect(offer.closest('[data-testid="menu-sheet"]')).toBeNull();
    expect(offer.compareDocumentPosition(lobby.query("menu-sheet")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    lobby.screen.exit();
  });
});

describe("the character select from your seat", () => {
  const tileIn = (overlay: HTMLElement, id: string) =>
    [...overlay.querySelectorAll<HTMLElement>("[data-testid=tile]")].find((tile) => tile.dataset["id"] === id)!;

  it("makes only your own seat a button, tagged Change", async () => {
    formFactor.current = "tablet-portrait";
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(2, { players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, name: "Sable" })] }));
    const seats = screen.queryAll("seat");
    expect(seats[0]!.querySelector("[data-testid=seat-change]")).not.toBeNull();
    expect(seats[0]!.querySelector("[data-testid=seat-change-tag]")!.textContent).toBe("Change");
    expect(seats[1]!.querySelector("[data-testid=seat-change]")).toBeNull();
  });

  it("opens the Character page in your seat colour, with ?", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    screen.click("seat-change");
    expect(screen.query("character-page")).not.toBeNull();
    expect(screen.query("tile-random")).not.toBeNull();
    expect(tileIn(screen.overlay, "ninja").querySelector("img")!.getAttribute("src")).toBe("/assets/portrait.scarlet");
  });

  it("a pick goes to the server, is remembered, and closes the page", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort(), unlockAll: true });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    screen.click("seat-change");
    tileIn(screen.overlay, "frog").click();
    flushSync();
    expect(screen.network.calls).not.toContain("pickCharacter:frog"); // a tap only views
    screen.click("character-pick");
    expect(screen.network.calls).toContain("pickCharacter:frog");
    expect(screen.settings.value.profile.lastCharacter).toBe("frog");
    await vi.waitFor(() => expect(screen.query("character-page")).toBeNull());
  });

  it("hides the ready room under the Character page", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    screen.click("seat-change");
    expect(screen.query("lobby")!.hasAttribute("data-under-page")).toBe(true);
    screen.click("character-back");
    expect(screen.query("lobby")!.hasAttribute("data-under-page")).toBe(false);
  });

  it("? goes to the server and is not remembered", async () => {
    // Seeded: fakeSettings shares jsdom's localStorage across tests.
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort(), settings: fakeSettings({ profile: { lastCharacter: "ninja" } }) });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    screen.click("seat-change");
    screen.click("tile-random");
    screen.click("character-pick");
    expect(screen.network.calls).toContain("pickCharacter:?");
    expect(screen.settings.value.profile.lastCharacter).toBe("ninja");
  });

  it("tags Change on its own line on every form factor, now that the badges have a row (UI layout spec §6.3)", async () => {
    for (const factor of ["tablet-portrait", "phone-landscape", "phone-portrait", "desktop"] as const) {
      formFactor.current = factor;
      const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
      await screen.createRoom("Kite");
      screen.receiveSnapshot(lobbySnapshot(1));
      const tag = screen.query<HTMLElement>("seat-change-tag");
      expect(tag, factor).not.toBeNull();
      // Drawn as a button, but the seat row is the one control.
      expect(tag!.tagName, factor).toBe("SPAN");
      expect(screen.query("seat-change"), factor).not.toBeNull();
      screen.screen.exit();
    }
    formFactor.current = "desktop";
  });

  it("the seat row has no colour control; the Character page offers the colours, others' flagged", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(2)); // you scarlet, Ninja 2 cyan
    expect(screen.queryAll("seat-colour")).toHaveLength(0);
    screen.click("seat-change");
    const cyan = screen.overlay.querySelector<HTMLButtonElement>('[data-testid=colour-swatch][data-colour="cyan"]')!;
    expect(cyan.disabled).toBe(true);
    expect(cyan.getAttribute("aria-label")).toBe("Blue, taken by P2");
    expect(screen.overlay.querySelector('[data-testid=colour-swatch][data-colour="scarlet"]')!.getAttribute("aria-checked")).toBe("true");
  });

  it("a colour tapped on the page goes to the server and is remembered, and the page stays open", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(2));
    screen.click("seat-change");
    screen.overlay.querySelector<HTMLButtonElement>('[data-testid=colour-swatch][data-colour="gold"]')!.click();
    flushSync();
    expect(screen.network.calls).toContain("pickColour:gold");
    expect(screen.settings.value.profile.lastColour).toBe("gold");
    expect(screen.query("character-page")).not.toBeNull();
  });

  it("remembers the other players in the room for the title's lineup", async () => {
    // Seeded: fakeSettings shares jsdom's localStorage across tests.
    const screen = await lobbyWithFakeNetwork({
      content: shippedContentPort(),
      settings: fakeSettings({ profile: { lastCharacter: "ninja", lastColour: "scarlet", lastSeen: [] } }),
    });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(2, { players: [playerSnapshot(), playerSnapshot({ id: REMOTE_ID, name: "Sable", characterId: "frog", colour: "gold" })] }));
    expect(screen.settings.value.profile.lastSeen[0]).toEqual({ id: REMOTE_ID, characterId: "frog", colour: "gold" });
    expect(screen.settings.value.profile.lastSeen.some((racer) => racer.id === screen.network.localPlayerId)).toBe(false);
  });

  it("disables your seat while ready, and hides the tag", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1, { players: [playerSnapshot({ ready: true })] }));
    expect(screen.query<HTMLButtonElement>("seat-change")!.disabled).toBe(true);
    expect(screen.query("seat-change-tag")).toBeNull();
  });

  it("sends the remembered character once after joining", async () => {
    const screen = await lobbyWithFakeNetwork({
      content: shippedContentPort(),
      unlockAll: true,
      settings: fakeSettings({ profile: { lastCharacter: "diver" } }),
    });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    screen.receiveSnapshot(lobbySnapshot(1));
    expect(screen.network.calls.filter((call) => call === "pickCharacter:diver")).toHaveLength(1);
  });

  it("does not send a remembered character this device cannot pick", async () => {
    const screen = await lobbyWithFakeNetwork({
      content: shippedContentPort(),
      settings: fakeSettings({ profile: { lastCharacter: "robo" } }),
    });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    expect(screen.network.calls.some((call) => call.startsWith("pickCharacter"))).toBe(false);
  });

  it("the seat button and an open page survive the snapshot stream", async () => {
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    const seat = screen.query("seat-change");
    screen.click("seat-change");
    const ninja = tileIn(screen.overlay, "ninja");
    screen.receiveSnapshot({ ...lobbySnapshot(1), tick: 3 });
    flushSync();
    expect(screen.query("seat-change")).toBe(seat);
    expect(tileIn(screen.overlay, "ninja")).toBe(ninja);
    expect(screen.query("character-page")).not.toBeNull();
  });

  it("still renders with storage blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1));
    screen.click("seat-change");
    expect(screen.query("character-page")).not.toBeNull();
  });
  it("keeps a resumed seat's pick instead of the remembered one", async () => {
    const network = new FakeNetwork();
    await network.createRoom("Kite");
    network.emitSnapshot(lobbySnapshot(1));
    const screen = await lobbyWithFakeNetwork({
      network,
      previousScreen: "Splash",
      content: shippedContentPort(),
      unlockAll: true,
      settings: fakeSettings({ profile: { lastCharacter: "diver" } }),
    });
    screen.receiveSnapshot(lobbySnapshot(1));
    expect(network.calls.some((call) => call.startsWith("pickCharacter"))).toBe(false);
  });

  it("keeps the body ? drew when the room comes back from Race again", async () => {
    const network = new FakeNetwork();
    await network.createRoom("Kite");
    network.emitSnapshot(lobbySnapshot(1));
    const screen = await lobbyWithFakeNetwork({
      network,
      previousScreen: "GameEnd",
      content: shippedContentPort(),
      unlockAll: true,
      settings: fakeSettings({ profile: { lastCharacter: "diver" } }),
    });
    screen.receiveSnapshot(lobbySnapshot(1));
    expect(network.calls.some((call) => call.startsWith("pickCharacter"))).toBe(false);
  });
});

describe("the desktop ready room", () => {
  afterEach(() => {
    formFactor.current = "desktop";
  });

  it("has no character card beside the seats; Change is on your seat", async () => {
    formFactor.current = "desktop";
    const screen = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await screen.createRoom("Kite");
    screen.receiveSnapshot(lobbySnapshot(1, { players: [playerSnapshot({ characterId: "frog" })] }));
    expect(screen.query("character-showcase")).toBeNull();
    screen.click("seat-change");
    expect(screen.query("character-page")).not.toBeNull();
  });
});
