/**
 * Splash (launch polish §3.1.5, "Splash").
 *
 * Its whole job is to make the menu's load time visible and then get out of
 * the way, and to never show a half-loaded screen while it does.
 *
 * What the splash itself draws -- the wordmark's fonts and the art of its own
 * small `splash` bundle, under the duotone dither (`SplashArt`) -- must be in
 * before it shows. It stays under its black cover, with the boot loader over
 * that, until they are, and then shows all at once. There is no patience
 * timer: a slow link takes as long as it takes, and only a stall (nothing
 * arriving for 30 s, `load-meter.ts`) or an error ends the wait, with a throw
 * that `main.ts` turns into "couldn't load" and Try again. A font that fails,
 * or an art bundle that fails, is that failure -- never a fallback face or a
 * plain sky.
 *
 * Over the shown splash, in the DOM, are the wordmark and
 * a bar that is the real progress of what the title and the screens after it
 * need: the menu bundle, the shell bundle (their pictures) and the menu
 * song's bytes (the song is downloaded whole and played from memory,
 * `MenuStream`). The splash advances only when all have arrived, so the menus
 * never render against textures or pictures that have not, and the title
 * always arrives with its music in hand -- and then only when the player
 * touches, clicks or presses a key.
 *
 * The gate is for the sound. A browser will not start audio before a gesture,
 * and the menu song starts here (`claimMenuMusic`); a splash that moved on by
 * itself reached a silent title, and the song came in on whatever the player
 * happened to press first. Asking for the tap makes it the one that starts the
 * music, so the title always arrives with it playing.
 *
 * Then it reclaims a seat a reload left behind (§3.1.6), and hands over to the
 * title, or to the lobby if the seat came back.
 *
 * Before any of it, at launch, the studio's own screen (`studio-splash`): the
 * SNEKPRTY logo on white for three seconds.
 *
 * Then, on a device's first visit, the photosensitivity warning:
 * the race flashes and shakes, and the player may turn the effects off before
 * a frame of it plays (`PhotosensitivityWarning`). Before that, unless a
 * language is already chosen, a language step (`LanguageFirst`), so the
 * warning can be read. Their fonts are waited for like the splash's own.
 */

import { mount, unmount } from "svelte";
import { FONT_UI, FONT_WORDMARK, localeFaces } from "../i18n/fonts";
import { activeLocale } from "../i18n/strategy";
import type { ScreenId } from "../profile/screen-state";
import SplashRoot from "./SplashRoot.svelte";
import LanguageFirst from "./LanguageFirst.svelte";
import PhotosensitivityWarning from "./PhotosensitivityWarning.svelte";
import { SplashArt } from "../render/splash-art";
import { claimMenuBackdrop } from "./menu-backdrop";
import { claimMenuMusic, MENU_MUSIC, menuSongBeat } from "./menu-music";
import { leaveWordmark } from "./wordmark-handoff";
import { reducedMotion } from "../kit/motion";
import { dismissBootLoader, reportBootStep } from "./boot-loader";
import { recoverableError } from "../net/error-view";
import { MonotonicProgress, Readiness } from "../profile/progress.svelte";
import { LoadMeter, watchSlow } from "../../lib/load-meter";
import { noteLoadingMoment } from "./loading-trace";
import { BaseScreen, type ScreenContext } from "../screen/screen";
import { studioSplash, type StudioGate } from "./studio-splash";
import { PAD_PRESS } from "../platform/focus-nav";

/**
 * How the splash's one bar splits between the menu bundle, the shell bundle
 * and the menu song: their share of the bytes. The menu bundle is about
 * 0.4 MB, the shell's pictures about 2 MB and the song about 10 MB, so the
 * bar is mostly the song, honestly. Approximate by design: the bar only has
 * to be monotonic, real, and full when all three are in.
 */
const MENU_BAR_SHARES = [1, 5, 25] as const;

/**
 * One bar over loads that run side by side. Each part reports its own
 * fraction and the bar is the weighted sum, so it is full only when every
 * part is -- unlike `weighted`, which is for loads in a row, where a later
 * part reporting means the earlier ones are done.
 */
function sharedBar(progress: MonotonicProgress, shares: readonly number[]): (part: number, fraction: number) => void {
  const reached = shares.map(() => 0);
  const total = shares.reduce((sum, share) => sum + share, 0);
  return (part, fraction) => {
    reached[part] = Math.max(reached[part] ?? 0, Math.min(1, Math.max(0, fraction)));
    progress.report(shares.reduce((sum, share, index) => sum + share * (reached[index] ?? 0), 0) / total);
  };
}

/** The announcer's "Floor Fifty!" follows the title slam's transient. */
const TITLE_CALL_AFTER_MS = 220;

/**
 * Every face the splash sets, loaded. Asked for by name rather than trusting
 * `document.fonts.ready` alone, which settles as soon as nothing is loading --
 * before the browser has laid the splash out and started on its faces.
 */
// Fraunces at 900 is the race's pop-up words' face (Wonder spec §5.1): loaded here, so no word draws in a fallback.
const SPLASH_FACES = [`600 1em ${FONT_WORDMARK}`, `900 1em ${FONT_WORDMARK}`, `400 1em ${FONT_UI}`, `600 1em ${FONT_UI}`];

/**
 * Every face the splash sets, and the player's own script, loaded -- or a
 * throw. A face that fails to load is a failure like any other, not a
 * fallback face; and the wait is under the stall rule, which only a silent
 * link ends. `onProgress` hears the fraction of the faces that are in.
 */
const fontsReady = (loads: LoadMeter, onProgress?: (fraction: number) => void): Promise<void> => {
  const fonts = document.fonts;
  if (fonts === undefined) {
    onProgress?.(1);
    return Promise.resolve();
  }
  // And the player's own script, so a CJK locale's first screen draws in its face.
  const faces = [...SPLASH_FACES, ...localeFaces(activeLocale())];
  return loads.guard(async () => {
    let loaded = 0;
    await Promise.all(
      faces.map(async (face) => {
        await fonts.load(face);
        loaded += 1;
        loads.progress();
        onProgress?.(loaded / faces.length);
      }),
    );
    await fonts.ready;
  });
};

/**
 * How long the bars take from the splash's true black to the palette's once
 * the splash has gone: long enough to read as the room's lights coming up,
 * short enough to be done before the title's hero settles.
 */
export const SPLASH_BARS_FADE_MS = 900;

/** One animation frame, so the canvas has drawn what was just added to it. */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else resolve();
  });

/** A wait for the player to go on, and a way to stop waiting. */
export type SplashGate = () => { done: Promise<void>; cancel: () => void };

/** The next touch, click, key or pad press (A is a pad player's tap). */
export const tapToStart: SplashGate = () => {
  let cancel = (): void => {};
  const done = new Promise<void>((resolve) => {
    const go = (): void => {
      cancel();
      resolve();
    };
    cancel = () => {
      window.removeEventListener("keydown", go);
      window.removeEventListener("pointerdown", go);
      window.removeEventListener(PAD_PRESS, go);
    };
    window.addEventListener("keydown", go);
    window.addEventListener("pointerdown", go);
    window.addEventListener(PAD_PRESS, go);
  });
  return { done, cancel };
};

export class SplashScreen extends BaseScreen {
  readonly name: ScreenId = "Splash";

  /** `proceed` resolves when the player asks to go on; tests pass one that already has. */
  constructor(
    private readonly proceed: SplashGate = tapToStart,
    private readonly studio: StudioGate = (overlay) => studioSplash(overlay),
  ) {
    super();
  }

  protected async onEnter(context: ScreenContext): Promise<void> {
    // The studio's own screen comes first, before anything of the game: the
    // boot loader and the black are under it. A key or a touch ends it early.
    const studio = this.studio(context.stage.overlay);
    this.bag.add(studio.cancel);
    // The three seconds are not wasted: the faces and the bundles the splash and the
    // title need load underneath. A failure is not reported here; the steps below ask
    // for the same things and meet it themselves, under the stall rule.
    if (studio.shown === true) this.warmUp(context);
    await studio.done;
    const loads = context.loads ?? new LoadMeter();
    // Nothing the first visit's steps choose is saved until the tap: inside
    // Ruken an anonymous player's first save brings up the host's sign-in
    // prompt, and on a slow load it arrived before "Tap to start" and covered
    // it. Held in memory, the choices apply at once; leaving saves them.
    const releaseSaves = context.settings.holdSaves();
    this.bag.add(releaseSaves);
    if (!context.settings.value.seen.photosensitivity) await this.warn(context, loads);

    const progress = new MonotonicProgress();
    const readiness = new Readiness();
    const art = new Readiness();
    const shown = new Readiness();
    const slow = new Readiness();
    const app = mount(SplashRoot, {
      target: context.stage.overlay,
      props: { progress, readiness, art, shown, slow, still: !context.settings.value.display.stageEffects },
    });
    this.bag.add(() => void unmount(app));
    context.stage.overlay.dataset["screen"] = "splash";
    // The splash's own black cover is up; the page's boot black can go.
    document.documentElement.classList.remove("ff-booting");
    // The menu song starts here rather than on the title, and carries over.
    this.bag.add(claimMenuMusic(context));
    // True black bars around the art while it is up, faded to the palette's
    // black once the menus have it.
    context.stage.setBarsBlack?.(true);
    this.bag.add(() => context.stage.setBarsBlack?.(false, SPLASH_BARS_FADE_MS));

    // What the splash draws: its fonts and the art of its own bundle. Both
    // are waited for, however long that takes (the stall rule, not a timer,
    // ends the wait), and a failure of either throws: there is no plain sky
    // and no fallback face. The boot loader is over the cover meanwhile, and
    // says how far each has got.
    await Promise.all([
      fontsReady(loads, (fraction) => reportBootStep("fonts", fraction)),
      context.assets.loadBundle("splash", (fraction) => reportBootStep("art", fraction)),
    ]);
    // Moves to the song: its beats and its highs (`MusicPulse`).
    // Stage effects off holds it as reduced motion does: one still pair, no
    // flips on the beat and no flare on the highs (the photosensitivity
    // warning's switch, read live).
    const splashArt = new SplashArt(context.stage, {
      music: () => context.audio.musicSpectrum?.(),
      song: () => menuSongBeat(context),
      reducedMotion: () => reducedMotion() || !context.settings.value.display.stageEffects,
    });
    this.bag.add(() => splashArt.dispose());
    art.ready = splashArt.drawn;

    // Black until every piece of what it draws is ready, then all at once:
    // the art on the canvas and drawn at least once, and the wordmark in its
    // own face. Two frames: the first draws the art and compiles its dither,
    // the second is a frame with nothing left to arrive.
    await nextFrame();
    await nextFrame();
    shown.ready = true;
    noteLoadingMoment("splash-shown", () => ({
      fontsLoaded: SPLASH_FACES.every((face) => document.fonts?.check(face) ?? true),
      splashArtLoaded: context.assets.isLoaded("splash"),
    }));
    reportBootStep("fonts", 1);
    reportBootStep("art", 1);
    dismissBootLoader();

    // What the title and the screens after it need, behind the shown splash,
    // on one bar: the menu bundle (the sky and city on the canvas), the shell
    // bundle (the portraits, sheets, stills and covers the title, the lobby
    // and the select screens show as pictures) and the menu song's bytes. All
    // of them, and only all, lead to "Tap to start". The song is downloaded
    // whole, so its arrival is real, not a guess at a decode that never ran.
    // Past eight seconds the splash says it is slow -- it is not failing.
    this.bag.add(watchSlow(loads.timers, () => (slow.ready = true)));
    const report = sharedBar(progress, MENU_BAR_SHARES);
    await Promise.all([
      context.assets.loadBundle("menu", (fraction) => report(0, fraction)),
      context.assets.loadBundle("shell", (fraction) => report(1, fraction)),
      this.downloadSong(context, (fraction) => report(2, fraction)),
    ]);
    readiness.ready = true;
    noteLoadingMoment("menu-ready", () => ({
      menuBundleLoaded: context.assets.isLoaded("menu"),
      shellBundleLoaded: context.assets.isLoaded("shell"),
      songDownloaded: true,
    }));

    // Only once the bundle and the song are in, so a tap during the load
    // starts the music (see `claimMenuMusic`) without also leaving before the
    // menu has its textures.
    const gate = this.proceed();
    this.bag.add(gate.cancel);
    await gate.done;
    releaseSaves();

    // A reload or an app restart reclaims the seat before anything renders
    // (migration spec; launch polish §3.1.6). Tried once: the grace loop is
    // for a drop within this page load.
    const outcome = await context.network.resume?.();
    if (outcome === "cancelled") return;
    if (outcome === "expired") {
      context.errors.report(recoverableError("ROOM_CLOSED", "last-room-closed"));
    }
    // The title arrives called, the way a fighting game's does: a slam, and
    // the announcer naming the game over it. The tap that got here unlocked
    // the graph, so both are heard. A reclaimed seat skips the title and so
    // skips its call.
    if (outcome !== "resumed") {
      context.audio.cue("ui.title", { bus: "ui" });
      context.audio.cue("vo.title", { bus: "voice", delayMs: TITLE_CALL_AFTER_MS });
    }
    // The title slides its wordmark over from where this one is
    // (`wordmark-handoff`); the lobby a reclaimed seat goes to does not.
    leaveWordmark(outcome === "resumed" ? null : context.stage.overlay.querySelector('[data-testid="splash-wordmark"]'));
    // Published from inside `enter`. The screen manager makes this screen
    // current before awaiting, so the event resolves against Splash. A
    // reclaimed seat goes to its lobby, which forwards a running race.
    context.publishPresentationEvent(outcome === "resumed" ? "app.room-resumed" : "app.splash-ready", {});
  }

  /** Starts what the steps after the studio's screen need, without waiting for it. */
  private warmUp(context: ScreenContext): void {
    const quiet = (): void => undefined;
    const faces = [...SPLASH_FACES, ...localeFaces(activeLocale())];
    for (const face of faces) void document.fonts?.load(face).catch(quiet);
    for (const bundle of ["splash", "menu", "shell"] as const) void context.assets.loadBundle(bundle).catch(quiet);
  }

  /**
   * Gets the menu song's bytes, reporting how many have arrived. The manifest
   * that names the file is read first; the download itself is the audio
   * manager's (`AudioManager.preload`), under the stall rule, and rejects on
   * an error, so a title that would have been silent is a failure instead.
   */
  private async downloadSong(context: ScreenContext, onProgress: (fraction: number) => void): Promise<void> {
    await context.audio.load("audio");
    await context.audio.preload?.(MENU_MUSIC, onProgress);
    onProgress(1);
  }

  /**
   * The photosensitivity warning, until the player goes on. In its own face
   * where the fonts arrive in time, over the menu world.
   * Before it, unless a language is already chosen, the language step: a
   * player who cannot read English must be able to read the warning. Only
   * the warning marks the visit seen, so a reload between the two asks the
   * language again.
   */
  private async warn(context: ScreenContext, loads: LoadMeter): Promise<void> {
    // Their fonts first, however long: a dialog in a fallback face is a
    // half-drawn screen. The boot loader is on show until they are in.
    await fontsReady(loads);
    // The world behind the first screens, not an empty dark field: the menu
    // bundle is wanted next anyway. The boot black and the loader step aside
    // for it; the splash's own cover comes down over it when the steps end.
    // The splash's art too, so nothing is left to load after the steps, when
    // the loader is gone: the loader's bar moves with both meanwhile.
    const arrived = { menu: 0, splash: 0 };
    const report = (name: keyof typeof arrived) => (fraction: number): void => {
      arrived[name] = fraction;
      reportBootStep("art", (arrived.menu + arrived.splash) / 2);
    };
    await Promise.all([context.assets.loadBundle("menu", report("menu")), context.assets.loadBundle("splash", report("splash"))]);
    const releaseBackdrop = claimMenuBackdrop(context);
    this.bag.add(releaseBackdrop);
    await nextFrame();
    document.documentElement.classList.remove("ff-booting");
    dismissBootLoader();
    if (context.settings.value.locale === null) await this.step(context, LanguageFirst);
    await this.step(context, PhotosensitivityWarning);
    releaseBackdrop();
    context.settings.update({ seen: { photosensitivity: true } });
  }

  /** One first-visit dialog on the overlay, until the player goes on. */
  private step(context: ScreenContext, dialog: typeof LanguageFirst | typeof PhotosensitivityWarning): Promise<void> {
    return new Promise<void>((resolve) => {
      let open = true;
      const close = (): void => {
        if (!open) return;
        open = false;
        void unmount(app);
      };
      const app = mount(dialog, {
        target: context.stage.overlay,
        props: {
          settings: context.settings,
          onContinue: () => {
            close();
            resolve();
          },
        },
      });
      this.bag.add(close);
    });
  }
}
