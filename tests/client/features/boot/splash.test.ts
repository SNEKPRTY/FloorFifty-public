/**
 * The splash (launch polish §3.1.5, "Splash"): a DOM screen with a real
 * progress bar that waits, once the menu bundle is in, for the player's tap --
 * the gesture that starts the menu music -- and then reclaims a stored seat
 * before handing over.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { SPLASH_BARS_FADE_MS, SplashScreen, type SplashGate } from "../../../../apps/client/src/features/boot/splash";
import { LoadMeter, LoadStalled, SLOW_MS, STALL_MS } from "../../../../apps/client/src/lib/load-meter";
import { bootProgressValue, resetBootProgress } from "../../../../apps/client/src/features/boot/boot-loader";
import { ManualTimers } from "../../support/manual-timers";
import { ErrorChannel } from "../../../../apps/client/src/features/net/error-view";
import { MENU_MUSIC } from "../../../../apps/client/src/features/boot/menu-music";
import { FONT_WORDMARK } from "../../../../apps/client/src/features/i18n/fonts";
import { SettingsStore } from "../../../../apps/client/src/features/profile/store/settings.svelte";
import { FakeAssets } from "../../support/fakes/assets";
import { FakeAudio } from "../../support/fakes/audio";
import { recordingPublisher } from "../../support/fakes/events";
import { FakeNetwork } from "../../support/fakes/network";
import { fakeContext } from "../../support/fakes/screens";
import { fakeSettings } from "../../support/fakes/settings";
import { proceedAtOnce, skipStudio } from "../../support/fakes/ui";

const names = (publisher: ReturnType<typeof recordingPublisher>): string[] =>
  publisher.events.map((event) => event.name);

describe("the splash has no logo", () => {
  it("leaves the studio's mark to its own screen", async () => {
    const context = fakeContext();
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    await splash.enter(context);
    expect(context.stage.overlay.querySelector('[data-testid="splash"] img')).toBeNull();
    splash.exit();
  });

  it("waits for the studio's screen before it shows anything of the game", async () => {
    let end = (): void => {};
    const studio = (): { done: Promise<void>; cancel: () => void } => ({
      done: new Promise<void>((resolve) => {
        end = resolve;
      }),
      cancel: () => {},
    });
    const context = fakeContext();
    const splash = new SplashScreen(proceedAtOnce, studio);
    const entering = splash.enter(context);
    await Promise.resolve();
    await Promise.resolve();
    expect(context.stage.overlay.querySelector('[data-testid="splash"]')).toBeNull();
    end();
    await entering;
    expect(context.stage.overlay.querySelector('[data-testid="splash"]')).not.toBeNull();
    splash.exit();
  });
});

describe("loading under the studio's screen", () => {
  const studioThatHolds = (shown: boolean): { gate: () => { done: Promise<void>; cancel: () => void; shown: boolean }; end: () => void } => {
    let end = (): void => {};
    return {
      gate: () => ({
        done: new Promise<void>((resolve) => {
          end = resolve;
        }),
        cancel: () => {},
        shown,
      }),
      end: () => end(),
    };
  };

  it("starts the splash's, the menu's and the shell's bundles while the studio's screen is up", async () => {
    const assets = new FakeAssets();
    const asked: string[] = [];
    assets.whileLoading = (name) => asked.push(name);
    const studio = studioThatHolds(true);
    const splash = new SplashScreen(proceedAtOnce, studio.gate);
    const entering = splash.enter(fakeContext({ assets }));
    await Promise.resolve();
    expect(asked).toEqual(expect.arrayContaining(["splash", "menu", "shell"]));
    studio.end();
    await entering;
    splash.exit();
  });

  it("asks for nothing early when there is no studio screen", async () => {
    const assets = new FakeAssets();
    const asked: string[] = [];
    assets.whileLoading = (name) => asked.push(name);
    const studio = studioThatHolds(false);
    const splash = new SplashScreen(proceedAtOnce, studio.gate);
    const entering = splash.enter(fakeContext({ assets }));
    await Promise.resolve();
    expect(asked).toEqual([]);
    studio.end();
    await entering;
    splash.exit();
  });
});

describe("the splash's timing", () => {
  it("waits for the player however long they take, then goes on", async () => {
    vi.useFakeTimers();
    const publisher = recordingPublisher();
    const entering = new SplashScreen(undefined, skipStudio).enter(fakeContext({ publishPresentationEvent: publisher.publish }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(names(publisher)).toEqual([]);
    window.dispatchEvent(new Event("pointerdown"));
    await entering;
    expect(names(publisher)).toEqual(["app.splash-ready"]);
    vi.useRealTimers();
  });

  it("takes the tap only once the bundle has resolved, and not before", async () => {
    vi.useFakeTimers();
    const assets = new FakeAssets();
    let resolveMenu!: () => void;
    assets.gate = (name) => (name === "menu" ? new Promise<void>((resolve) => (resolveMenu = resolve)) : undefined);
    const publisher = recordingPublisher();
    const entering = new SplashScreen(undefined, skipStudio).enter(fakeContext({ assets, publishPresentationEvent: publisher.publish }));

    // A frame passes before the splash shows, and the menu loads after it.
    await vi.advanceTimersByTimeAsync(50);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    await vi.advanceTimersByTimeAsync(10);
    expect(names(publisher)).toEqual([]);

    resolveMenu();
    await vi.advanceTimersByTimeAsync(50);
    expect(names(publisher)).toEqual([]);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    await entering;
    expect(names(publisher)).toEqual(["app.splash-ready"]);
    vi.useRealTimers();
  });

  it("asks for a start once the bundle is in, since it waits for one", async () => {
    const context = fakeContext();
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    await splash.enter(context);
    const prompt = context.stage.overlay.querySelector('[data-testid="splash"]')?.textContent ?? "";
    expect(prompt).toMatch(/to start/);
    expect(prompt).not.toMatch(/to skip/);
    splash.exit();
  });

  it("loads Fraunces at 900 with its faces, so the race's words never draw in a fallback (Wonder spec §5.1)", async () => {
    const loaded: string[] = [];
    const fonts = { load: async (face: string) => (loaded.push(face), []), ready: Promise.resolve() };
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    try {
      const splash = new SplashScreen(proceedAtOnce, skipStudio);
      await splash.enter(fakeContext());
      expect(loaded).toContain(`900 1em ${FONT_WORDMARK}`);
      splash.exit();
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });

  it("stays black until its art, its fonts and a drawn frame are in, then shows", async () => {
    const assets = new FakeAssets();
    let resolveSplash!: () => void;
    assets.gate = (name) => (name === "splash" ? new Promise<void>((resolve) => (resolveSplash = resolve)) : undefined);
    document.documentElement.classList.add("ff-booting");
    const bootLoader = document.createElement("div");
    bootLoader.id = "ff-boot-loader";
    document.body.append(bootLoader);
    const context = fakeContext({ assets });
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    const entering = splash.enter(context);
    const root = (): Element | null => context.stage.overlay.querySelector('[data-testid="splash"]');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root()?.classList.contains("ff-splash--shown")).toBe(false);
    // The splash's own cover has taken over from the page's.
    expect(document.documentElement.classList.contains("ff-booting")).toBe(false);
    // The boot loader turns over the black cover until the splash shows.
    expect(bootLoader.classList.contains("ff-boot-loader--gone")).toBe(false);

    resolveSplash();
    await entering;
    expect(root()?.classList.contains("ff-splash--shown")).toBe(true);
    expect(bootLoader.classList.contains("ff-boot-loader--gone")).toBe(true);
    bootLoader.remove();
    splash.exit();
  });

  it("starts the menu music, which the title then carries on", async () => {
    const context = fakeContext();
    await new SplashScreen(proceedAtOnce, skipStudio).enter(context);
    const calls = (context.audio as unknown as { calls: string[] }).calls;
    expect(calls).toContain("unlock");
  });

  it("draws a real progress bar and removes the splash on exit", async () => {
    const context = fakeContext();
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    await splash.enter(context);
    const bar = context.stage.overlay.querySelector('[data-testid="splash-progress"]');
    expect(bar?.getAttribute("role")).toBe("progressbar");
    expect(bar?.getAttribute("aria-valuenow")).toBe("100");
    expect(context.stage.overlay.dataset["screen"]).toBe("splash");
    splash.exit();
    expect(context.stage.overlay.querySelector('[data-testid="splash"]')).toBeNull();
  });

  it("puts the art up from its own bundle before the menu bundle loads", async () => {
    const assets = new FakeAssets();
    const context = fakeContext({ assets });
    await new SplashScreen(proceedAtOnce, skipStudio).enter(context);
    expect(assets.loadedBundles.slice(0, 2)).toEqual(["splash", "menu"]);
  });

  it("reports the bundle's own progress, never a timer's", async () => {
    const assets = new FakeAssets();
    assets.progressSteps = [0.25, 0.5];
    const seen: (string | null | undefined)[] = [];
    const context = fakeContext({ assets });
    assets.whileLoading = (name) => {
      // The art's own bundle comes first and carries no bar.
      if (name !== "menu") return;
      seen.push(context.stage.overlay.querySelector('[data-testid="splash-progress"]')?.getAttribute("aria-valuenow"));
    };
    await new SplashScreen(proceedAtOnce, skipStudio).enter(context);
    expect(seen).toEqual(["0"]);
    expect(context.stage.overlay.querySelector('[data-testid="splash-progress"]')?.getAttribute("aria-valuenow")).toBe("100");
  });
});

/** A gate the player never opens, so a test can look at the splash while it waits for the tap. */
const NEVER: SplashGate = () => ({ done: new Promise<void>(() => undefined), cancel: () => undefined });

/** The browser's font set, loading each face as the test says. */
function stubFonts(load: (face: string) => Promise<unknown[]>): void {
  Object.defineProperty(document, "fonts", { configurable: true, value: { load, ready: Promise.resolve() } });
}

const splashOf = (context: ReturnType<typeof fakeContext>): Element | null =>
  context.stage.overlay.querySelector('[data-testid="splash"]');
const isShown = (context: ReturnType<typeof fakeContext>): boolean => splashOf(context)?.classList.contains("ff-splash--shown") === true;
const askedForTap = (context: ReturnType<typeof fakeContext>): string | null | undefined =>
  context.stage.overlay.querySelector('[data-testid="splash-ready"]')?.getAttribute("data-ready");

/** What a promise has done so far, without waiting for it. */
function watch(promise: Promise<void>): { settled: boolean; error: unknown } {
  const outcome = { settled: false, error: undefined as unknown };
  promise.then(
    () => (outcome.settled = true),
    (error: unknown) => {
      outcome.settled = true;
      outcome.error = error;
    },
  );
  return outcome;
}

describe("the splash waits for everything it shows, and never gives up on a timer", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (document as unknown as { fonts?: unknown }).fonts;
    resetBootProgress();
    document.body.innerHTML = "";
  });

  it("shows once its fonts and art are in, and asks for the tap only when the menu bundle AND the song's bytes have both arrived", async () => {
    const assets = new FakeAssets();
    let resolveMenu!: () => void;
    assets.gate = (name) => (name === "menu" ? new Promise<void>((resolve) => (resolveMenu = resolve)) : undefined);
    const audio = new FakeAudio();
    let resolveSong!: () => void;
    audio.preloadGate = () => new Promise<void>((resolve) => (resolveSong = resolve));
    const context = fakeContext({ assets, audio });
    const splash = new SplashScreen(NEVER, skipStudio);
    void splash.enter(context);

    // What the splash draws is in: it shows, without waiting for the rest.
    await vi.waitFor(() => expect(isShown(context)).toBe(true));
    expect(askedForTap(context)).toBe("false");
    expect(audio.calls).toContain(`preload:${MENU_MUSIC}`);

    // The song alone is not enough: "Tap to start" means the menu is there too.
    resolveSong();
    await vi.waitFor(() => expect(assets.isLoaded("menu")).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(askedForTap(context)).toBe("false");

    resolveMenu();
    await vi.waitFor(() => expect(askedForTap(context)).toBe("true"));
    splash.exit();
  });

  it("does not ask for the tap on the menu bundle alone either", async () => {
    const audio = new FakeAudio();
    let resolveSong!: () => void;
    audio.preloadGate = () => new Promise<void>((resolve) => (resolveSong = resolve));
    const context = fakeContext({ audio });
    const splash = new SplashScreen(NEVER, skipStudio);
    void splash.enter(context);
    await vi.waitFor(() => expect((context.assets as FakeAssets).isLoaded("menu")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(askedForTap(context)).toBe("false");
    resolveSong();
    await vi.waitFor(() => expect(askedForTap(context)).toBe("true"));
    splash.exit();
  });

  it("waits for the shell bundle as well, which holds the pictures the title, the lobby and the select screens draw", async () => {
    const assets = new FakeAssets();
    let resolveShell!: () => void;
    assets.gate = (name) => (name === "shell" ? new Promise<void>((resolve) => (resolveShell = resolve)) : undefined);
    const context = fakeContext({ assets });
    const splash = new SplashScreen(NEVER, skipStudio);
    void splash.enter(context);

    // The menu bundle and the song are in; the portraits and stills are not.
    await vi.waitFor(() => expect(assets.isLoaded("menu")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(askedForTap(context)).toBe("false");
    resolveShell();
    await vi.waitFor(() => expect(askedForTap(context)).toBe("true"));
    splash.exit();
  });

  it("fails when the shell bundle fails, as the menu bundle does: no title with empty frames", async () => {
    const assets = new FakeAssets();
    assets.failing.add("shell");
    await expect(new SplashScreen(proceedAtOnce, skipStudio).enter(fakeContext({ assets }))).rejects.toThrow(/shell/);
  });

  it("draws one bar for the bundles and the song, from their own progress, and fills it only when all are in", async () => {
    const assets = new FakeAssets();
    const audio = new FakeAudio();
    audio.preloadSteps = [0.5];
    let resolveSong!: () => void;
    audio.preloadGate = () => new Promise<void>((resolve) => (resolveSong = resolve));
    let resolveShell!: () => void;
    assets.gate = (name) => (name === "shell" ? new Promise<void>((resolve) => (resolveShell = resolve)) : undefined);
    const context = fakeContext({ assets, audio });
    const splash = new SplashScreen(NEVER, skipStudio);
    void splash.enter(context);
    const bar = (): number => Number(context.stage.overlay.querySelector('[data-testid="splash-progress"]')?.getAttribute("aria-valuenow"));

    await vi.waitFor(() => expect(assets.isLoaded("menu")).toBe(true));
    // The menu bundle is in and half the song: most of the bytes are the song's.
    expect(bar()).toBeGreaterThan(40);
    expect(bar()).toBeLessThan(100);
    // The song arrives while the shell has not: loaded in parallel, so the bar
    // is not full on the strength of the last part alone.
    resolveSong();
    await vi.waitFor(() => expect(bar()).toBeGreaterThan(80));
    expect(bar()).toBeLessThan(100);
    resolveShell();
    await vi.waitFor(() => expect(bar()).toBe(100));
    splash.exit();
  });

  it("waits for a slow font as long as bytes keep arriving, however long that is", async () => {
    // The page's timers faked as well, so a patience timer put back would fire.
    vi.useFakeTimers();
    const timers = new ManualTimers();
    const loads = new LoadMeter({ timers });
    const arrivals: (() => void)[] = [];
    stubFonts(() => new Promise<unknown[]>((resolve) => arrivals.push(() => resolve([]))));
    const context = fakeContext({ loads });
    const splash = new SplashScreen(NEVER, skipStudio);
    const outcome = watch(splash.enter(context));

    // Five minutes with something arriving every ten seconds: ten times the
    // old three-second patience and ten times the stall, and still no splash.
    for (let seconds = 0; seconds < 300; seconds += 10) {
      await timers.advance(10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      loads.progress();
    }
    expect(outcome.settled).toBe(false);
    expect(isShown(context)).toBe(false);

    for (const arrive of arrivals) arrive();
    vi.useRealTimers();
    await vi.waitFor(() => expect(isShown(context)).toBe(true));
    splash.exit();
    // Five minutes of the page's own timers, run in fake time, is real work:
    // under a full parallel suite it took over the 5 s default (2026-10-10),
    // and over 20 s on the owner's Mac runner, whose eight cores run more
    // test files side by side (2026-10-11).
  }, 60_000);

  it("fails, and shows nothing half-loaded, when nothing arrives for 30 s", async () => {
    const timers = new ManualTimers();
    stubFonts(() => new Promise<unknown[]>(() => undefined));
    const context = fakeContext({ loads: new LoadMeter({ timers }) });
    const splash = new SplashScreen(NEVER, skipStudio);
    const outcome = watch(splash.enter(context));
    // The studio's screen (here already over) is awaited first; let that turn pass.
    await Promise.resolve();
    await Promise.resolve();

    await timers.advance(STALL_MS - 1);
    expect(outcome.settled).toBe(false);
    await timers.advance(1);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(LoadStalled);
    expect(isShown(context)).toBe(false);
    splash.exit();
  });

  it("fails on a font that will not load, rather than showing in a fallback face", async () => {
    stubFonts(() => Promise.reject(new DOMException("A network error occurred.", "NetworkError")));
    const context = fakeContext();
    const splash = new SplashScreen(NEVER, skipStudio);
    await expect(splash.enter(context)).rejects.toThrow(/network error/i);
    expect(isShown(context)).toBe(false);
    splash.exit();
  });

  it("fails when the art's bundle fails: no plain sky, no menu requested, no title", async () => {
    const assets = new FakeAssets();
    assets.failing.add("splash");
    const publisher = recordingPublisher();
    const context = fakeContext({ assets, publishPresentationEvent: publisher.publish });
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    await expect(splash.enter(context)).rejects.toThrow(/splash/);
    expect(isShown(context)).toBe(false);
    expect(assets.loadedBundles).not.toContain("menu");
    expect(names(publisher)).toEqual([]);
    splash.exit();
  });

  it("fails when the menu song cannot be downloaded, rather than reaching a title that is silent", async () => {
    const audio = new FakeAudio();
    audio.preloadFailing.add(MENU_MUSIC);
    const publisher = recordingPublisher();
    const context = fakeContext({ audio, publishPresentationEvent: publisher.publish });
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    await expect(splash.enter(context)).rejects.toThrow(/main|menu|download/i);
    expect(names(publisher)).toEqual([]);
    splash.exit();
  });

  it("waits for the fonts of a first visit's dialogs too, before showing either", async () => {
    const stored = new Map<string, string>();
    const settings = new SettingsStore({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) });
    const arrivals: (() => void)[] = [];
    stubFonts(() => new Promise<unknown[]>((resolve) => arrivals.push(() => resolve([]))));
    vi.useFakeTimers();
    const timers = new ManualTimers();
    const loads = new LoadMeter({ timers });
    const context = fakeContext({ settings, loads });
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    void splash.enter(context);
    // Twenty seconds on, long past the old three seconds' patience, with bytes arriving: no dialog in a fallback face.
    for (let seconds = 0; seconds < 20; seconds += 5) {
      await timers.advance(5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      loads.progress();
    }
    expect(context.stage.overlay.querySelector('[data-testid="language-first"]')).toBeNull();
    for (const arrive of arrivals) arrive();
    vi.useRealTimers();
    await vi.waitFor(() => expect(context.stage.overlay.querySelector('[data-testid="language-first"]')).not.toBeNull());
    splash.exit();
  });

  it("says it is slow after 8 s of waiting for the menu and the song, and not before, and not once they are in", async () => {
    const timers = new ManualTimers();
    const assets = new FakeAssets();
    let resolveMenu!: () => void;
    assets.gate = (name) => (name === "menu" ? new Promise<void>((resolve) => (resolveMenu = resolve)) : undefined);
    const context = fakeContext({ assets, loads: new LoadMeter({ timers }) });
    const splash = new SplashScreen(NEVER, skipStudio);
    void splash.enter(context);
    await vi.waitFor(() => expect(isShown(context)).toBe(true));
    const slow = (): string => context.stage.overlay.querySelector('[data-testid="splash-slow"]')?.textContent?.trim() ?? "";

    await timers.advance(SLOW_MS - 1);
    expect(slow()).toBe("");
    await timers.advance(1);
    expect(slow()).toMatch(/Still loading/);

    resolveMenu();
    await vi.waitFor(() => expect(askedForTap(context)).toBe("true"));
    expect(slow()).toBe("");
    splash.exit();
  });

  it("tells the boot loader's bar when its fonts and its art are in", async () => {
    document.body.innerHTML =
      '<div id="ff-boot-loader"><div data-testid="boot-progress" hidden><div class="ff-boot-loader__fill"></div></div></div>';
    const context = fakeContext();
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    await splash.enter(context);
    // Fonts and art are 4 of the bar's 9 parts; the host, content and manifest are main.ts's.
    expect(bootProgressValue()).toBeCloseTo(4 / 9);
    splash.exit();
  });
});

describe("splash and a stored seat", () => {
  it("tries to resume before handing over, and says so when the room is gone", async () => {
    const network = new FakeNetwork();
    network.resumeOutcome = "expired";
    const errors = new ErrorChannel();
    const publisher = recordingPublisher();

    await new SplashScreen(proceedAtOnce, skipStudio).enter(fakeContext({ network, errors, publishPresentationEvent: publisher.publish }));

    expect(network.calls).toContain("resume");
    expect(errors.take()).toMatchObject({ code: "ROOM_CLOSED", detail: "last-room-closed" });
    expect(publisher.events.map((event) => event.name)).toEqual(["app.splash-ready"]);
  });

  it("publishes app.room-resumed when the seat was reclaimed", async () => {
    const network = new FakeNetwork();
    network.resumeOutcome = "resumed";
    const publisher = recordingPublisher();
    await new SplashScreen(proceedAtOnce, skipStudio).enter(fakeContext({ network, publishPresentationEvent: publisher.publish }));
    expect(publisher.events.map((event) => event.name)).toEqual(["app.room-resumed"]);
  });

  it("hands over silently when there is nothing to resume", async () => {
    const network = new FakeNetwork();
    const errors = new ErrorChannel();
    await new SplashScreen(proceedAtOnce, skipStudio).enter(fakeContext({ network, errors }));
    expect(errors.take()).toBeUndefined();
  });
});

describe("the splash's bars", () => {
  it("are true black while it is up, and fade to the palette's black as it goes", async () => {
    const context = fakeContext();
    const calls: [boolean, number | undefined][] = [];
    context.stage.setBarsBlack = (black, fadeMs) => calls.push([black, fadeMs]);
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    await splash.enter(context);
    expect(calls).toEqual([[true, undefined]]);
    splash.exit();
    expect(calls.at(-1)).toEqual([false, SPLASH_BARS_FADE_MS]);
  });
});

describe("the photosensitivity warning", () => {
  it("comes before the splash on a first visit, holds it until the player goes on, and keeps the effects they chose", async () => {
    // Its own storage: `fakeSettings` shares the page's, which earlier tests have written.
    const stored = new Map<string, string>();
    const settings = new SettingsStore({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) });
    const context = fakeContext({ settings });
    const assets = context.assets as FakeAssets;
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    const entering = splash.enter(context);
    const overlay = context.stage.overlay;

    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="language-first"]')).not.toBeNull(), { timeout: 5_000 });
    overlay.querySelector<HTMLButtonElement>('[data-testid="language-first-continue"]')!.click();
    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="photosensitivity-warning"]')).not.toBeNull(), { timeout: 5_000 });
    expect(overlay.querySelector('[data-testid="splash"]')).toBeNull();
    // Its art is already in (the loader's bar moved while it loaded), so nothing waits after the steps.
    expect(assets.loadedBundles).toContain("splash");

    overlay.querySelector<HTMLInputElement>('[data-testid="photosensitivity-character-effects"]')!.click();
    overlay.querySelector<HTMLInputElement>('[data-testid="photosensitivity-stage-effects"]')!.click();
    overlay.querySelector<HTMLButtonElement>('[data-testid="photosensitivity-continue"]')!.click();
    await entering;

    expect(overlay.querySelector('[data-testid="photosensitivity-warning"]')).toBeNull();
    expect(settings.value.display).toMatchObject({ characterEffects: false, stageEffects: false });
    expect(settings.value.seen.photosensitivity).toBe(true);
    splash.exit();
  });

  it("follows a language step on a first visit, so the warning reads in the language picked", async () => {
    const stored = new Map<string, string>();
    const settings = new SettingsStore({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) });
    const context = fakeContext({ settings });
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    const entering = splash.enter(context);
    const overlay = context.stage.overlay;

    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="language-first"]')).not.toBeNull(), { timeout: 5_000 });
    expect(overlay.querySelector('[data-testid="photosensitivity-warning"]')).toBeNull();
    overlay.querySelector<HTMLButtonElement>('[data-testid="language-first-continue"]')!.click();

    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="photosensitivity-warning"]')).not.toBeNull(), { timeout: 5_000 });
    expect(overlay.querySelector('[data-testid="language-first"]')).toBeNull();
    overlay.querySelector<HTMLButtonElement>('[data-testid="photosensitivity-continue"]')!.click();
    await entering;
    splash.exit();
  });

  it("shows the world behind the first-visit steps, and lets it go before the splash", async () => {
    const assets = new FakeAssets();
    const context = fakeContext({ assets, settings: fakeSettings({ locale: "ja", seen: { photosensitivity: false } }) });
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    const entering = splash.enter(context);
    const overlay = context.stage.overlay;
    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="photosensitivity-warning"]')).not.toBeNull(), { timeout: 5_000 });
    // Everything the splash needs is in before the steps, while the loader still shows progress.
    expect(assets.loadedBundles).toEqual(expect.arrayContaining(["menu", "splash"]));
    expect(bootProgressValue()).toBeGreaterThan(0);
    expect(window.__ffBackdrop?.()).toEqual({ drawn: true });
    overlay.querySelector<HTMLButtonElement>('[data-testid="photosensitivity-continue"]')!.click();
    await entering;
    expect(window.__ffBackdrop?.().drawn).not.toBe(true);
    splash.exit();
  });

  it("skips the language step where a language is already chosen", async () => {
    const context = fakeContext({ settings: fakeSettings({ locale: "ja", seen: { photosensitivity: false } }) });
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    const entering = splash.enter(context);
    const overlay = context.stage.overlay;
    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="photosensitivity-warning"]')).not.toBeNull(), { timeout: 5_000 });
    expect(overlay.querySelector('[data-testid="language-first"]')).toBeNull();
    overlay.querySelector<HTMLButtonElement>('[data-testid="photosensitivity-continue"]')!.click();
    await entering;
    splash.exit();
  });

  it("saves nothing the first visit chose until the player taps to start, so Ruken's first-save prompt cannot cover the tap", async () => {
    const stored = new Map<string, string>();
    const settings = new SettingsStore({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) });
    const context = fakeContext({ settings: settings });
    // The splash asks for its gate only after two animation frames and its bundles, which is
    // after its DOM is up. A tap before that finds nothing to resolve and is lost, so the test
    // waits for the ask itself, not for a poll interval to outlast the frames.
    let tap: () => void = () => undefined;
    let gateAsked = false;
    const gate: SplashGate = () => {
      gateAsked = true;
      return { done: new Promise<void>((resolve) => (tap = resolve)), cancel: () => undefined };
    };
    const splash = new SplashScreen(gate, skipStudio);
    const entering = splash.enter(context);
    const overlay = context.stage.overlay;

    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="language-first"]')).not.toBeNull(), { timeout: 5_000 });
    overlay.querySelector<HTMLButtonElement>('[data-testid="language-first-continue"]')!.click();
    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="photosensitivity-warning"]')).not.toBeNull(), { timeout: 5_000 });
    overlay.querySelector<HTMLInputElement>('[data-testid="photosensitivity-stage-effects"]')!.click();
    overlay.querySelector<HTMLButtonElement>('[data-testid="photosensitivity-continue"]')!.click();
    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="splash"]')).not.toBeNull(), { timeout: 5_000 });

    // Up to "Tap to start": the choices apply, and nothing is written.
    expect(settings.value.seen.photosensitivity).toBe(true);
    expect(settings.value.display.stageEffects).toBe(false);
    expect(stored.size).toBe(0);

    await vi.waitFor(() => expect(gateAsked).toBe(true), { timeout: 5_000 });
    tap();
    await entering;
    const saved = JSON.parse([...stored.values()][0] ?? "{}") as { seen?: { photosensitivity?: boolean }; display?: { stageEffects?: boolean } };
    expect(stored.size).toBe(1);
    expect(saved).toMatchObject({ seen: { photosensitivity: true }, display: { stageEffects: false } });
    splash.exit();
  });

  it("saves what the first visit chose if the splash is left before the tap", async () => {
    const stored = new Map<string, string>();
    const settings = new SettingsStore({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) });
    const context = fakeContext({ settings });
    const splash = new SplashScreen(NEVER, skipStudio);
    void splash.enter(context);
    const overlay = context.stage.overlay;
    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="language-first"]')).not.toBeNull(), { timeout: 5_000 });
    overlay.querySelector<HTMLButtonElement>('[data-testid="language-first-continue"]')!.click();
    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="photosensitivity-warning"]')).not.toBeNull(), { timeout: 5_000 });
    overlay.querySelector<HTMLButtonElement>('[data-testid="photosensitivity-continue"]')!.click();
    await vi.waitFor(() => expect(overlay.querySelector('[data-testid="splash"]')).not.toBeNull(), { timeout: 5_000 });
    expect(stored.size).toBe(0);
    splash.exit();
    expect(stored.size).toBe(1);
  });

  it("is not shown once read", async () => {
    const context = fakeContext({ settings: fakeSettings({ seen: { photosensitivity: true } }) });
    const splash = new SplashScreen(proceedAtOnce, skipStudio);
    await splash.enter(context);
    expect(context.stage.overlay.querySelector('[data-testid="photosensitivity-warning"]')).toBeNull();
    splash.exit();
  });
});


it("does not navigate or announce a title when resume was superseded", async () => {
  const network = new FakeNetwork();
  network.resumeOutcome = "cancelled" as typeof network.resumeOutcome;
  const publisher = recordingPublisher();
  const context = fakeContext({ network, publishPresentationEvent: publisher.publish });
  const splash = new SplashScreen(proceedAtOnce, skipStudio);
  await splash.enter(context);
  expect(publisher.events).toEqual([]);
  splash.exit();
});
