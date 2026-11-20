/**
 * The title (launch polish spec §3.1.1).
 *
 * The accepted menu composition with the player's choices in place of the
 * connect form. Rooms are formed in the lobby, which has its own file.
 */

import gsap from "gsap";
import { flushSync, tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { installLocaleStrategy } from "../../../../apps/client/src/features/i18n/strategy";
import * as m from "../../../../apps/client/src/paraglide/messages.js";
import { TITLE_ARRIVAL_MS } from "../../../../apps/client/src/features/title/main-menu";
import { requestRacerHop } from "../../../../apps/client/src/features/lobby/racer-hops";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { shippedContentPort } from "../../support/fakes/content";
import { mainMenuWithFakeNetwork } from "../../support/fakes/screens";
import { fakeSettings, memoryStorage } from "../../support/fakes/settings";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const racerFrames = (overlay: HTMLElement) => [...overlay.querySelectorAll<HTMLElement>(".ff-menu-racer-frame")];

describe("the title", () => {
  it("offers Play, which asks the flow for the lobby", async () => {
    const title = await mainMenuWithFakeNetwork();
    expect(title.overlay.dataset["screen"]).toBe("title");
    title.click("title-play");
    expect(title.published()).toEqual(["ui.play-requested"]);
    title.screen.exit();
  });

  it("gets the tutorial's song ready while a player who has not done the tutorial reads the title", async () => {
    const title = await mainMenuWithFakeNetwork({ content: shippedContentPort() });
    await flush();
    expect(title.audio.calls).toContain("load:song-dawn-tutorial");
    expect(title.audio.calls).toContain("preload:music.tutorial");
    title.screen.exit();
  });

  it("leaves the tutorial's song alone for a player who has done it", async () => {
    const title = await mainMenuWithFakeNetwork({
      content: shippedContentPort(),
      settings: fakeSettings({ seen: { tutorial: true } }),
    });
    await flush();
    expect(title.audio.calls.filter((call) => call.includes("tutorial"))).toEqual([]);
    title.screen.exit();
  });

  it("gets nothing ready, and says nothing, before the content has arrived", async () => {
    const title = await mainMenuWithFakeNetwork();
    await flush();
    expect(title.audio.calls.filter((call) => call.startsWith("preload:"))).toEqual([]);
    title.screen.exit();
  });

  it("answers nothing until the arrival from the splash is over", async () => {
    vi.useFakeTimers();
    try {
      const entering = mainMenuWithFakeNetwork({ previousScreen: "Splash" });
      await vi.advanceTimersByTimeAsync(10);
      const title = await entering;
      expect(TITLE_ARRIVAL_MS).toBe(1180);
      expect(title.overlay.hasAttribute("inert")).toBe(true);
      await vi.advanceTimersByTimeAsync(TITLE_ARRIVAL_MS);
      expect(title.overlay.hasAttribute("inert")).toBe(false);
      title.screen.exit();
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers at once back from the lobby", async () => {
    const title = await mainMenuWithFakeNetwork({ previousScreen: "Lobby" });
    expect(title.overlay.hasAttribute("inert")).toBe(false);
    title.screen.exit();
  });

  it("shows Quit only in an installed app", async () => {
    const inTab = await mainMenuWithFakeNetwork();
    expect(inTab.query("title-quit")).toBeNull();
    inTab.screen.exit();

    const standalone = await mainMenuWithFakeNetwork({ displayMode: "standalone" });
    expect(standalone.query("title-quit")).not.toBeNull();
    standalone.screen.exit();
  });

  it("keeps the accepted composition: wordmark, ensemble, ledge and tagline", async () => {
    const title = await mainMenuWithFakeNetwork();
    for (const id of ["menu-wordmark", "menu-ledge", "menu-tagline", "menu-sheet"]) {
      expect(title.query(id)).not.toBeNull();
    }
    expect(title.overlay.querySelectorAll('[data-testid="menu-racer"]')).toHaveLength(4);
    title.screen.exit();
  });

  it("drops the racers onto the ledge, violet first and scarlet last, fresh from the splash", async () => {
    const title = await mainMenuWithFakeNetwork({ previousScreen: "Splash" });
    const frames = racerFrames(title.overlay);
    expect(frames.every((frame) => frame.classList.contains("ff-menu-racer-frame--drop"))).toBe(true);
    expect(frames.map((frame) => frame.style.getPropertyValue("--ff-racer-drop-order"))).toEqual(["3", "2", "1", "0"]);

    // A racer still falling does not hop; landed, it does.
    requestRacerHop(0);
    await flush();
    expect(frames[0]!.classList.contains("ff-menu-racer-frame--hop")).toBe(false);
    frames[0]!.dispatchEvent(new Event("animationend"));
    await flush();
    expect(frames[0]!.classList.contains("ff-menu-racer-frame--drop")).toBe(false);
    requestRacerHop(0);
    await flush();
    expect(frames[0]!.classList.contains("ff-menu-racer-frame--hop")).toBe(true);
    title.screen.exit();
  });

  it("keeps the racers on the ledge when coming back from the lobby", async () => {
    const title = await mainMenuWithFakeNetwork({ previousScreen: "Lobby" });
    expect(racerFrames(title.overlay).some((frame) => frame.classList.contains("ff-menu-racer-frame--drop"))).toBe(false);
    title.screen.exit();
  });

  it("jumps the one racer a controller's shoulder button asks for", async () => {
    const title = await mainMenuWithFakeNetwork();
    const frames = racerFrames(title.overlay);
    requestRacerHop(2);
    await flush();
    expect(frames.map((frame) => frame.classList.contains("ff-menu-racer-frame--hop"))).toEqual([false, false, true, false]);

    // Gone with the screen: a later press reaches no one.
    title.screen.exit();
    expect(() => requestRacerHop(2)).not.toThrow();
  });

  it("opens Settings and Contact as modals, and offers fullscreen and mute", async () => {
    const title = await mainMenuWithFakeNetwork();
    // A closed modal falls away over half a beat (polish spec §5.3): wait for
    // it to go, so each Close below is the open modal's.
    const closed = () => vi.waitFor(() => expect(title.overlay.querySelector('[role="dialog"]')).toBeNull());
    title.click("title-settings");
    expect(title.overlay.querySelector('[role="dialog"]')?.getAttribute("data-testid")).toBe("settings-modal");
    title.click("modal-close");
    await closed();
    title.click("quick-contact");
    expect(title.query("contact-modal")).not.toBeNull();
    title.click("modal-close");
    await closed();
    expect(title.query("corner-mute")).not.toBeNull();
    expect(title.query("quick-fullscreen") ?? title.query("quick-home-screen") ?? "none").not.toBeNull();
    title.screen.exit();
  });

  it("switches language with Settings open: the modal re-words in place, focus stays, Escape still returns it (languages plan, review focus 5)", async () => {
    const settings = new SettingsStore(memoryStorage());
    const undo = installLocaleStrategy(settings, () => ["en"]);
    try {
      const title = await mainMenuWithFakeNetwork({ settings });
      // The title arrives first. Its panel's rise starts a beat in, and GSAP's
      // first read of a transform under jsdom, which lays nothing out, lifts
      // the panel out of the page and back: that drops focus from the button
      // inside it, and would land wherever this test's clock had reached.
      for (const tween of gsap.globalTimeline.getChildren(true, true, false)) tween.progress(1);
      const opener = title.query<HTMLButtonElement>("title-settings")!;
      opener.focus();
      title.click("title-settings");
      const dialog = title.query<HTMLElement>("settings-modal")!;

      const ko = title.query<HTMLInputElement>("settings-language-ko")!;
      // The same jsdom lift for the picked row's pulse: read its transform before focusing the radio.
      gsap.set(ko.closest("label"), { scale: 1 });
      ko.focus();
      ko.click();
      await tick();
      flushSync();

      expect(settings.value.locale).toBe("ko");
      expect(title.query("settings-modal")).toBe(dialog);
      expect(document.activeElement).toBe(title.query("settings-language-ko"));
      expect(dialog.textContent).toContain(m.title_settings({}, { locale: "ko" }));

      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      flushSync();
      // The modal falls out over half a beat (polish spec §5.3) before it leaves.
      await vi.waitFor(() => expect(title.query("settings-modal")).toBeNull());
      expect(document.activeElement).toBe(title.query("title-settings"));
      title.screen.exit();
    } finally {
      undo();
    }
  });

  it("shows the language in play as a flag beside Mute, which opens the six flags two lines of three; a pick applies, closes and returns focus", async () => {
    const settings = new SettingsStore(memoryStorage());
    const undo = installLocaleStrategy(settings, () => ["ja-JP"]);
    try {
      const title = await mainMenuWithFakeNetwork({ settings });
      const opener = title.query<HTMLButtonElement>("title-language")!;
      // Automatic answers Japanese here: the button wears Japan's flag, and names the language beside it in its own words.
      expect(opener.querySelector("svg")!.dataset["flag"]).toBe("jp");
      expect(opener.textContent!.trim()).toBe("日本語");
      opener.focus();
      title.click("title-language");
      const dialog = title.query<HTMLElement>("language-modal")!;
      const lines = [...dialog.querySelectorAll<HTMLElement>(".ff-language-picker__flags")];
      expect(lines.map((line) => [...line.querySelectorAll("svg")].map((svg) => svg.dataset["flag"]))).toEqual([
        ["us", "jp"],
        ["kr", "mx"],
        ["br", "cn"],
      ]);

      title.query<HTMLInputElement>("title-language-ko")!.click();
      await vi.waitFor(() => expect(title.query("language-modal")).toBeNull());
      expect(settings.value.locale).toBe("ko");
      expect(document.activeElement).toBe(title.query("title-language"));
      expect(title.query("title-language")!.querySelector("svg")!.dataset["flag"]).toBe("kr");
      // Said, as the Settings panel says it (languages spec §5): the modal is gone, so the title says it.
      await vi.waitFor(() =>
        expect(title.query("title-announcer-region")?.textContent?.trim()).toBe(m.settings_language_changed({ language: "한국어" }, { locale: "ko" })),
      );
      title.screen.exit();
    } finally {
      undo();
    }
  });

  it("opens the iPad's Home Screen help over the whole screen, not inside the card's glass", async () => {
    // The glass's backdrop filter makes the card the box a fixed dialog is
    // placed in: mounted inside it, the help was a grey veil over the card.
    const agent = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)");
    try {
      const title = await mainMenuWithFakeNetwork();
      title.click("quick-home-screen");
      const help = title.query("home-screen-modal");
      expect(help).not.toBeNull();
      expect(help!.closest('[data-testid="title"]')).toBeNull();
      title.click("modal-close");
      // It falls away over half a beat (polish spec §5.3).
      await vi.waitFor(() => expect(title.query("home-screen-modal")).toBeNull());
      title.screen.exit();
    } finally {
      agent.mockRestore();
    }
  });

  it("mutes from the corner, saying so in words as well as state", async () => {
    const settings = fakeSettings();
    const title = await mainMenuWithFakeNetwork({ settings });
    const mute = title.query<HTMLButtonElement>("corner-mute")!;
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    title.click("corner-mute");
    expect(settings.value.audio.muted).toBe(true);
    expect(mute.getAttribute("aria-pressed")).toBe("true");
    expect(mute.textContent).toContain("Unmute");
    title.screen.exit();
  });

  it("the tutorial quick action asks the flow for the tutorial", async () => {
    const title = await mainMenuWithFakeNetwork();
    title.click("quick-tutorial");
    expect(title.published()).toEqual(["ui.tutorial-requested"]);
    title.screen.exit();
  });

  it("forms no room: no connect form, and nothing followed from a snapshot", async () => {
    const title = await mainMenuWithFakeNetwork();
    expect(title.query("create-room")).toBeNull();
    expect(title.query("name-input")).toBeNull();
    title.screen.exit();
  });
});

describe("the title's Character button", () => {
  it("shows the remembered character and opens the Character page", async () => {
    const settings = fakeSettings({ profile: { lastCharacter: "frog" } });
    const screen = await mainMenuWithFakeNetwork({ settings, content: shippedContentPort() });
    const button = screen.query<HTMLButtonElement>("title-character")!;
    expect(button.querySelector("img")!.getAttribute("src")).toBe("/assets/portrait.frogScarlet");
    screen.click("title-character");
    expect(screen.query("character-page")).not.toBeNull();
  });

  it("a pick is remembered, sends nothing, and closes the page", async () => {
    const screen = await mainMenuWithFakeNetwork({ content: shippedContentPort(), unlockAll: true });
    screen.click("title-character");
    const diver = [...screen.overlay.querySelectorAll<HTMLElement>("[data-testid=tile]")].find((tile) => tile.dataset["id"] === "diver")!;
    diver.click();
    flushSync();
    expect(screen.settings.value.profile.lastCharacter).not.toBe("diver"); // a tap only views
    screen.click("character-pick");
    expect(screen.settings.value.profile.lastCharacter).toBe("diver");
    expect(screen.network.calls.some((call) => call.startsWith("pickCharacter"))).toBe(false);
    await vi.waitFor(() => expect(screen.query("character-page")).toBeNull());
  });

  it("hides the title under the Character page, and shows it again after", async () => {
    const screen = await mainMenuWithFakeNetwork({ content: shippedContentPort() });
    screen.click("title-character");
    expect(screen.query("title")!.hasAttribute("data-under-page")).toBe(true);
    screen.click("character-back");
    expect(screen.query("title")!.hasAttribute("data-under-page")).toBe(false);
  });

  it("draws you in your remembered colour at the title", async () => {
    const settings = fakeSettings({ profile: { lastCharacter: "frog", lastColour: "cyan" } });
    const screen = await mainMenuWithFakeNetwork({ settings, content: shippedContentPort() });
    expect(screen.query("title-character")!.querySelector("img")!.getAttribute("src")).toBe("/assets/portrait.frogCyan");
  });

  it("a colour tapped at the title is only remembered", async () => {
    const screen = await mainMenuWithFakeNetwork({ content: shippedContentPort() });
    screen.click("title-character");
    screen.overlay.querySelector<HTMLButtonElement>('[data-testid=colour-swatch][data-colour="violet"]')!.click();
    flushSync();
    expect(screen.settings.value.profile.lastColour).toBe("violet");
    expect(screen.network.calls.some((call) => call.startsWith("pickColour"))).toBe(false);
  });

  it("stands you in front on the title, then the players you saw", async () => {
    const settings = fakeSettings({
      profile: { lastCharacter: "frog", lastColour: "violet", lastSeen: [{ id: "r1-p2", characterId: "diver", colour: "cyan" }] },
    });
    const screen = await mainMenuWithFakeNetwork({ settings, content: shippedContentPort() });
    const racers = [...screen.overlay.querySelectorAll("[data-testid=menu-racer]")].map((racer) => racer.getAttribute("src"));
    expect(racers.slice(0, 2)).toEqual(["/assets/production/frog-violet.png", "/assets/production/diver-cyan.png"]);
    expect(racers).toHaveLength(4);
  });

  it("offers no ? at the title", async () => {
    const screen = await mainMenuWithFakeNetwork({ content: shippedContentPort() });
    screen.click("title-character");
    expect(screen.query("tile-random")).toBeNull();
  });
});
