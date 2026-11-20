import { describe, expect, it, vi } from "vitest";
import {
  AssetLoadError,
  AssetManager,
  type AssetBackend,
} from "../../../../apps/client/src/features/render/assets";
import { AudioManager } from "../../../../apps/client/src/features/audio";
import { LoadMeter, LoadStalled, STALL_MS } from "../../../../apps/client/src/lib/load-meter";
import { ManualTimers } from "../../support/manual-timers";
import { SplashScreen } from "../../../../apps/client/src/features/boot/splash";
import { GameplayScreen } from "../../../../apps/client/src/features/race/gameplay";
import { LobbyScreen } from "../../../../apps/client/src/features/lobby/lobby";
import { FakeAssets } from "../../support/fakes/assets";
import { FakeNetwork } from "../../support/fakes/network";
import { fakeContext } from "../../support/fakes/screens";
import { fakeStage } from "../../support/fakes/stage";
import { proceedAtOnce, skipStudio } from "../../support/fakes/ui";
import { snapshotAt } from "../../support/snapshots";

const stubManifest = { bundles: [{ name: "menu", assets: [] }] };

function backendWith(overrides: Partial<AssetBackend> = {}): AssetBackend {
  return {
    init: vi.fn(async () => {}),
    loadBundle: vi.fn(async () => ({})),
    ...overrides,
  };
}

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => stubManifest }) as unknown as Response),
  );
}

describe("the asset manager", () => {
  it("initialises the backend from the manifest once", async () => {
    stubFetch();
    const backend = backendWith();
    const assets = new AssetManager(backend, "/assets/manifest.json");

    await assets.loadBundle("menu");
    await assets.loadBundle("gameplay");

    expect(backend.init).toHaveBeenCalledTimes(1);
    expect(backend.loadBundle).toHaveBeenCalledTimes(2);
  });

  it("unloads a bundle via the backend and evicts it from loaded set", async () => {
    stubFetch();
    const backend = backendWith({ unloadBundle: vi.fn(async () => {}) });
    const assets = new AssetManager(backend, "/assets/manifest.json");

    await assets.loadBundle("stage-rooftops" as any);
    expect(assets.isLoaded("stage-rooftops" as any)).toBe(true);

    await (assets as any).unloadBundle("stage-rooftops");
    expect(assets.isLoaded("stage-rooftops" as any)).toBe(false);
    expect(backend.unloadBundle).toHaveBeenCalledWith("stage-rooftops");
  });


  // Pixi cannot parse audio and warns for every file it is handed; the audio
  // manager decodes audio itself from `srcOf` (release readiness §9.2: no
  // console output in production).
  it("keeps audio out of the renderer's manifest, and still resolves its URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              bundles: [
                {
                  name: "audio",
                  assets: [
                    { alias: ["music.theme"], src: "assets/production/theme.m4a" },
                    { alias: ["sfx.go"], src: "assets/production/cues/go.wav" },
                    { alias: ["ui.icon"], src: "assets/production/icon.png" },
                  ],
                },
              ],
            }),
          }) as unknown as Response,
      ),
    );
    const backend = backendWith();
    const assets = new AssetManager(backend, "/assets/manifest.json");
    await assets.loadBundle("audio");

    const given = vi.mocked(backend.init).mock.calls[0]![0].manifest as {
      bundles: { name: string; assets: { src: string }[] }[];
    };
    expect(given.bundles[0]!.assets.map((asset) => asset.src)).toEqual(["assets/production/icon.png"]);
    expect(assets.srcOf("music.theme")).toBe("/assets/production/theme.m4a");
  });

  it("resolves an alias to its URL once the manifest is fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              bundles: [
                {
                  name: "gameplay",
                  assets: [{ alias: ["portrait.frogScarlet"], src: "assets/production/portrait-frog-scarlet.png" }],
                },
              ],
            }),
          }) as unknown as Response,
      ),
    );
    const assets = new AssetManager(backendWith(), "/base/assets/manifest.json");

    expect(assets.srcOf("portrait.frogScarlet")).toBeUndefined();
    await assets.loadBundle("gameplay");
    expect(assets.srcOf("portrait.frogScarlet")).toBe("/base/assets/production/portrait-frog-scarlet.png");
    expect(assets.srcOf("nothing.here")).toBeUndefined();
  });

  it("loads a bundle once no matter how many screens ask", async () => {
    stubFetch();
    const backend = backendWith();
    const assets = new AssetManager(backend, "/assets/manifest.json");

    await Promise.all([assets.loadBundle("menu"), assets.loadBundle("menu")]);
    await assets.loadBundle("menu");

    expect(backend.loadBundle).toHaveBeenCalledTimes(1);
    expect(assets.isLoaded("menu")).toBe(true);
  });

  it("forwards backend progress to every caller sharing one load", async () => {
    stubFetch();
    let release!: () => void;
    const backend = backendWith({
      loadBundle: vi.fn(async (_name: string, onProgress?: (fraction: number) => void) => {
        onProgress?.(0.5);
        await new Promise<void>((resolve) => (release = resolve));
      }),
    });
    const assets = new AssetManager(backend, "/assets/manifest.json");
    const first: number[] = [];
    const second: number[] = [];

    const loads = Promise.all([
      assets.loadBundle("menu", (fraction) => first.push(fraction)),
      assets.loadBundle("menu", (fraction) => second.push(fraction)),
    ]);
    await vi.waitFor(() => expect(first).toEqual([0.5]));
    release();
    await loads;

    expect(first).toEqual([0.5, 1]);
    expect(second).toEqual([0.5, 1]);
  });

  it("reports 1 at once for a bundle already loaded", async () => {
    stubFetch();
    const assets = new AssetManager(backendWith(), "/assets/manifest.json");
    await assets.loadBundle("menu");
    const seen: number[] = [];
    await assets.loadBundle("menu", (fraction) => seen.push(fraction));
    expect(seen).toEqual([1]);
  });

  it("reports the failing bundle and stays retryable", async () => {
    stubFetch();
    let attempts = 0;
    const backend = backendWith({
      loadBundle: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("network down");
        return {};
      }),
    });
    const assets = new AssetManager(backend, "/assets/manifest.json");

    await expect(assets.loadBundle("menu")).rejects.toBeInstanceOf(AssetLoadError);
    expect(assets.isLoaded("menu")).toBe(false);
    // A failed load is not remembered, so the retry is a real retry.
    await expect(assets.loadBundle("menu")).resolves.toBeUndefined();
    expect(assets.isLoaded("menu")).toBe(true);
  });

  it("names the bundle on an asset failure so a retry view can report it", async () => {
    stubFetch();
    const backend = backendWith({
      loadBundle: vi.fn(async () => {
        throw new Error("decode failed");
      }),
    });
    const assets = new AssetManager(backend, "/assets/manifest.json");

    await expect(assets.loadBundle("gameplay")).rejects.toMatchObject({ bundle: "gameplay" });
  });
});

describe("the asset manager's manifest", () => {
  const manifestOf = (bundles: unknown[] = []): Response =>
    ({ ok: true, headers: new Headers(), json: async () => ({ bundles }) }) as unknown as Response;

  it("is fetched once however many bundles and callers ask at the same moment", async () => {
    let release!: (response: Response) => void;
    const fetchStub = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal("fetch", fetchStub);
    const backend = backendWith();
    const assets = new AssetManager(backend, "/assets/manifest.json");

    const loads = Promise.all([assets.loadBundle("splash"), assets.loadBundle("menu"), assets.prepare(), assets.prepare()]);
    await Promise.resolve();
    release(manifestOf());
    await loads;

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(backend.init).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failed fetch: every waiter hears of it, and the next ask fetches again", async () => {
    const fetchStub = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValue(manifestOf());
    vi.stubGlobal("fetch", fetchStub);
    const assets = new AssetManager(backendWith(), "/assets/manifest.json");

    const both = await Promise.allSettled([assets.loadBundle("splash"), assets.loadBundle("menu")]);
    expect(both.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    await expect(assets.loadBundle("splash")).resolves.toBeUndefined();
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("reports an answer that is not ok as a failure, not as an empty manifest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response));
    await expect(new AssetManager(backendWith(), "/assets/manifest.json").prepare()).rejects.toThrow(/404/);
  });

  it("is read as it arrives, each chunk news to the stall rule and to the loader", async () => {
    const timers = new ManualTimers();
    const loads = new LoadMeter({ timers });
    const text = new TextEncoder().encode('{"bundles":[]}');
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(text.slice(0, 7));
        controller.enqueue(text.slice(7));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-length": String(text.byteLength) } })));
    const assets = new AssetManager(backendWith(), "/assets/manifest.json", { loads });
    const fractions: number[] = [];
    await assets.prepare((fraction) => fractions.push(fraction));
    expect(fractions.at(-1)).toBe(1);
    expect(fractions.slice(0, -1)).toEqual([7 / text.byteLength, 1]);
  });

  it("stalls after 30 s of nothing, aborting the fetch, as a load error naming the bundle", async () => {
    const timers = new ManualTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }),
    );
    const assets = new AssetManager(backendWith(), "/assets/manifest.json", { loads: new LoadMeter({ timers }) });
    const outcome = assets.loadBundle("splash").then(
      () => "loaded",
      (error: unknown) => error,
    );

    await timers.advance(STALL_MS - 1);
    expect(signal?.aborted).toBe(false);
    await timers.advance(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(AssetLoadError);
    expect((error as AssetLoadError).bundle).toBe("splash");
    expect((error as AssetLoadError).cause).toBeInstanceOf(LoadStalled);
    expect(signal?.aborted).toBe(true);
  });
});

describe("the asset manager and a bundle that goes quiet", () => {
  it("fails a bundle that reports nothing for 30 s, and not one that keeps reporting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: new Headers(), json: async () => ({ bundles: [] }) }) as unknown as Response));
    const timers = new ManualTimers();
    let report: ((fraction: number) => void) | undefined;
    const backend = backendWith({
      loadBundle: vi.fn((_name: string, onProgress?: (fraction: number) => void) => {
        report = onProgress!;
        return new Promise<unknown>(() => undefined);
      }),
    });
    const assets = new AssetManager(backend, "/assets/manifest.json", { loads: new LoadMeter({ timers }) });
    const outcome = assets.loadBundle("menu").then(
      () => "loaded",
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(report).toBeTypeOf("function"));

    // A file of the bundle lands every 20 s for ten minutes: slow, never failed.
    let settled = false;
    void outcome.then(() => (settled = true));
    for (let step = 1; step <= 30; step += 1) {
      await timers.advance(20_000);
      report?.(step / 100);
    }
    expect(settled).toBe(false);

    await timers.advance(STALL_MS);
    const error = await outcome;
    expect(error).toBeInstanceOf(AssetLoadError);
    expect((error as AssetLoadError).cause).toBeInstanceOf(LoadStalled);
    // And it can be asked for again: a failure is not remembered.
    expect(assets.isLoaded("menu")).toBe(false);
  });
});

describe("the asset manager and a request it gave up on", () => {
  // Pixi keeps a load in its loader until it settles and hands the same promise
  // to the next ask for that file. A request that hung is never going to
  // settle, so a Try again that asked for the bundle again got the hung one
  // back, and stalled again for ever.
  it("tells the backend to forget the hung loads of a bundle that stalled, so Try again asks the network again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: new Headers(), json: async () => ({ bundles: [] }) }) as unknown as Response));
    const timers = new ManualTimers();
    const abandon = vi.fn();
    let hangs = true;
    const backend = backendWith({
      loadBundle: vi.fn(() => (hangs ? new Promise<unknown>(() => undefined) : Promise.resolve({}))),
      abandon,
    });
    const assets = new AssetManager(backend, "/assets/manifest.json", { loads: new LoadMeter({ timers }) });
    const first = assets.loadBundle("splash").then(
      () => "loaded",
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(backend.loadBundle).toHaveBeenCalledTimes(1));
    await timers.advance(STALL_MS);
    expect(await first).toBeInstanceOf(AssetLoadError);
    expect(abandon).toHaveBeenCalledWith("splash");

    hangs = false;
    await expect(assets.loadBundle("splash")).resolves.toBeUndefined();
    expect(backend.loadBundle).toHaveBeenCalledTimes(2);
  });

  it("tells the backend after any failed load, and not after one that worked", async () => {
    stubFetch();
    const abandon = vi.fn();
    let fail = true;
    const backend = backendWith({
      loadBundle: vi.fn(async () => {
        if (fail) throw new Error("decode failed");
        return {};
      }),
      abandon,
    });
    const assets = new AssetManager(backend, "/assets/manifest.json");
    await expect(assets.loadBundle("menu")).rejects.toBeInstanceOf(AssetLoadError);
    expect(abandon).toHaveBeenCalledTimes(1);
    fail = false;
    await assets.loadBundle("menu");
    expect(abandon).toHaveBeenCalledTimes(1);
  });
});

describe("screens and their bundles", () => {
  it("loads menu assets before Splash resolves", async () => {
    const assets = new FakeAssets();
    const stage = fakeStage();
    await new SplashScreen(proceedAtOnce, skipStudio).enter(fakeContext({ assets, stage }));
    expect(assets.loadedBundles).toContain("menu");
    expect(stage.ui.children.some((child) => child.label === "non-gameplay-backdrop")).toBe(false);
  });

  it("advances to MainMenu only after the menu bundle resolves", async () => {
    const assets = new FakeAssets();
    const order: string[] = [];
    const original = assets.loadBundle.bind(assets);
    assets.loadBundle = async (name) => {
      await original(name);
      order.push(`loaded:${name}`);
    };

    await new SplashScreen(proceedAtOnce, skipStudio).enter(
      fakeContext({
        assets,
        publishPresentationEvent: (name) => order.push(`published:${name}`),
      }),
    );

    // The shell holds the portraits, sheets and stills the title and the lobby draw.
    expect(order).toEqual(["loaded:splash", "loaded:menu", "loaded:shell", "published:app.splash-ready"]);
  });

  it("awaits the deliberately empty audio bundle without special-casing it", async () => {
    const assets = new FakeAssets();
    // Gameplay reads the room's tuning from the snapshot that sent it here, so
    // a harness without one is testing a screen that leaves immediately.
    const network = new FakeNetwork();
    network.emitSnapshot(snapshotAt(0));
    const stage = fakeStage();
    await new GameplayScreen().enter(fakeContext({ assets, network, stage }));
    // A race with no stage chosen draws the fallback skylines, which live in
    // Rooftops' bundle.
    expect(assets.loadedBundles).toEqual(["gameplay", "shell", "stage-rooftops", "audio"]);
    expect(stage.ui.children.some((child) => child.label === "non-gameplay-backdrop")).toBe(false);
  });

  it("loads the shell behind the ready room, without waiting on it (select spec §6.5)", async () => {
    const assets = new FakeAssets();
    let release: () => void = () => undefined;
    assets.gate = (name) => (name === "shell" ? new Promise<void>((resolve) => (release = resolve)) : undefined);
    const screen = new LobbyScreen();
    await screen.enter(fakeContext({ assets, network: new FakeNetwork() }));
    expect(assets.loadedBundles).toContain("menu");
    expect(assets.loadedBundles).not.toContain("shell");
    release();
    await vi.waitFor(() => expect(assets.loadedBundles).toContain("shell"));
    await screen.exit();
  });

  it("surfaces an asset failure to the caller rather than rendering a blank screen", async () => {
    const assets = new FakeAssets();
    assets.failing.add("menu");
    await expect(new SplashScreen(proceedAtOnce, skipStudio).enter(fakeContext({ assets }))).rejects.toThrow(/menu/);
  });
});

describe("the audio seam", () => {
  it("adds a bundle's aliases to those already loaded", async () => {
    const manifest = {
      bundles: [
        { name: "audio", assets: [{ alias: ["sfx.jump"], src: "assets/production/jump.wav" }] },
        { name: "song-moving-on", assets: [{ alias: ["music.movingOn"], src: "assets/production/moving-on.m4a" }] },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => manifest }) as unknown as Response));
    const audio = new AudioManager();
    await audio.load("audio");
    await audio.load("song-moving-on");
    expect(audio.hasSource("sfx.jump")).toBe(true);
    expect(audio.hasSource("music.movingOn")).toBe(true);

    // A load that fails takes nothing away.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as unknown as Response));
    await audio.load("audio");
    expect(audio.hasSource("sfx.jump")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("stops waiting on a manifest that goes 30 s without a byte, and maps nothing, rather than hanging the splash", async () => {
    const timers = new ManualTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }),
    );
    const audio = new AudioManager({ loads: new LoadMeter({ timers }) });
    let settled = false;
    void audio.load("audio").then(() => (settled = true));
    await timers.advance(STALL_MS - 1);
    expect(settled).toBe(false);
    await timers.advance(1);
    expect(settled).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(audio.hasSource("music.mainMenu")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("resolves rather than throwing while no cues are authored", async () => {
    const audio = new AudioManager();
    await expect(audio.load()).resolves.toBeUndefined();
    expect(() => audio.play("countdown")).not.toThrow();
    audio.setMuted(true);
    expect(audio.isMuted).toBe(true);
  });
});
