/**
 * The asset manager.
 *
 * Screens ask for a bundle by name and never for a file. That indirection is
 * what lets the art contract move a file, change a sheet layout, or re-render
 * an asset without a screen knowing.
 *
 * Nothing here gives up on a clock of its own. Every wait -- the manifest and
 * each bundle -- is guarded by the one stall rule (`load-meter.ts`): it fails
 * only when nothing has arrived for 30 s, or on an error, and the screen that
 * asked shows "couldn't load" with Try again. A slow bundle just takes as
 * long as it takes.
 */

import { readJson } from "../../lib/fetch-progress";
import { LoadMeter } from "../../lib/load-meter";

/** A core bundle, one stage's layer art (`stage-<id>`), or one song's audio (`song-<id>`). */
export type AssetBundleName = "splash" | "menu" | "shell" | "gameplay" | "audio" | "reveal" | `stage-${string}` | `song-${string}`;

/**
 * The loading surface a screen depends on.
 *
 * Declared as a port so a screen test can assert which bundles were requested
 * without a renderer, a network, or a real image decode.
 */
export interface AssetPort {
  /**
   * Loads a bundle, reporting its real progress from 0 to 1. A bundle already
   * loaded reports 1 at once.
   */
  loadBundle(name: AssetBundleName, onProgress?: (fraction: number) => void): Promise<void>;
  /** Unloads a bundle, freeing its assets from the cache. */
  unloadBundle?(name: AssetBundleName): Promise<void>;
  isLoaded(name: AssetBundleName): boolean;
  /** A DOM image's URL for this alias, once the manifest is known; undefined before. */
  srcOf?(alias: string): string | undefined;
}

/** The subset of Pixi's `Assets` this manager uses. */
export interface AssetBackend {
  init(options: { manifest: unknown; basePath?: string }): Promise<void>;
  loadBundle(name: string, onProgress?: (fraction: number) => void): Promise<unknown>;
  /** Unloads a bundle from Pixi's cache and releases GPU textures. */
  unloadBundle?(name: string): Promise<unknown>;
  /**
   * Forgets whatever of this bundle is still in flight after a failed load.
   * A renderer that keeps a load until it settles hands the same promise to
   * the next ask for the file, and a request that hung never settles: without
   * this, Try again would be given the hung load back.
   */
  abandon?(name: string): void;
}


/** Raised when a bundle cannot be loaded, carrying enough detail to retry. */
export class AssetLoadError extends Error {
  constructor(
    readonly bundle: AssetBundleName,
    override readonly cause: unknown,
  ) {
    super(`could not load the "${bundle}" asset bundle`);
    this.name = "AssetLoadError";
  }
}

/** Files the audio manager decodes and the renderer never sees. */
const AUDIO_FILE = /\.(?:m4a|wav|mp3|ogg|aac)$/i;

type Manifest = { bundles?: { assets?: { alias?: string[]; src?: string }[] }[] };

export class AssetManager implements AssetPort {
  private readonly loaded = new Set<AssetBundleName>();
  private readonly inFlight = new Map<AssetBundleName, Promise<void>>();
  /** Who is watching each in-flight load's progress; a shared load tells all. */
  private readonly listeners = new Map<AssetBundleName, Set<(fraction: number) => void>>();
  private initialised = false;
  /** The manifest fetch in flight, shared by everyone who asks while it is; see `prepare`. */
  private manifestLoad: Promise<void> | undefined;
  private readonly manifestListeners = new Set<(fraction: number) => void>();
  /** Every alias in the manifest and the URL its file is served at, for DOM images. */
  private readonly sources = new Map<string, string>();
  private readonly loads: LoadMeter;

  constructor(
    private readonly backend: AssetBackend,
    private readonly manifestUrl: string,
    options: { loads?: LoadMeter } = {},
  ) {
    this.loads = options.loads ?? new LoadMeter();
  }

  isLoaded(name: AssetBundleName): boolean {
    return this.loaded.has(name);
  }

  /**
   * Reads the manifest and hands it to the renderer, once.
   *
   * Single-flight: the splash's two bundles, the boot and a screen all ask
   * together, and they share one fetch and one `init`. A failure is shared by
   * every waiter and not remembered, so the next ask is a real retry.
   * `onProgress` hears the fraction of the manifest read.
   */
  prepare(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.initialised) {
      onProgress?.(1);
      return Promise.resolve();
    }
    if (onProgress !== undefined) this.manifestListeners.add(onProgress);
    this.manifestLoad ??= this.initialise().finally(() => {
      this.manifestLoad = undefined;
      this.manifestListeners.clear();
    });
    return this.manifestLoad;
  }

  private async initialise(): Promise<void> {
    const manifest = await this.loads.guard(async (signal) => {
      const response = await fetch(this.manifestUrl, { signal });
      if (!response.ok) throw new Error(`asset manifest ${this.manifestUrl}: ${response.status}`);
      return readJson<Manifest>(response, (received, total) => {
        this.loads.progress();
        const fraction = total === undefined ? 0 : Math.min(1, received / total);
        for (const listener of [...this.manifestListeners]) listener(fraction);
      });
    });
    for (const listener of [...this.manifestListeners]) listener(1);
    // A manifest `src` is relative to the site root, which is what precedes `assets/` in the manifest's own URL.
    const root = this.manifestUrl.replace(/assets\/manifest\.json$/, "");
    for (const bundle of manifest.bundles ?? [])
      for (const asset of bundle.assets ?? [])
        for (const alias of asset.alias ?? []) if (asset.src !== undefined) this.sources.set(alias, `${root}${asset.src}`);
    // The renderer gets everything but the audio, which it cannot parse and
    // would warn about once per file; the audio manager decodes audio itself,
    // from `srcOf` (release readiness §9.2: a production page says nothing).
    const forRenderer = {
      ...manifest,
      bundles: (manifest.bundles ?? []).map((bundle) => ({
        ...bundle,
        assets: (bundle.assets ?? []).filter((asset) => !AUDIO_FILE.test(asset.src ?? "")),
      })),
    };
    await this.backend.init({ manifest: forRenderer });
    this.initialised = true;
  }

  srcOf(alias: string): string | undefined {
    return this.sources.get(alias);
  }

  /**
   * Loads a bundle once.
   *
   * Concurrent callers share one in-flight promise, because two screens racing
   * to enter must not decode the same sheet twice. A failed load is not
   * remembered, so a retry is a real retry.
   *
   * Every caller's `onProgress` hears the one load's progress, so a second
   * screen joining a load mid-flight still sees its bar reach the end.
   */
  async loadBundle(name: AssetBundleName, onProgress?: (fraction: number) => void): Promise<void> {
    if (this.loaded.has(name)) {
      onProgress?.(1);
      return;
    }
    if (onProgress !== undefined) {
      const watching = this.listeners.get(name) ?? new Set();
      watching.add(onProgress);
      this.listeners.set(name, watching);
    }

    const existing = this.inFlight.get(name);
    if (existing !== undefined) return existing;

    const report = (fraction: number): void => {
      // A file of the bundle landing is news to the stall rule.
      this.loads.progress();
      for (const listener of [...(this.listeners.get(name) ?? [])]) listener(fraction);
    };
    const attempt = (async () => {
      try {
        await this.prepare();
        await this.loads.guard(() => this.backend.loadBundle(name, report));
        this.loaded.add(name);
        report(1);
      } catch (error) {
        this.backend.abandon?.(name);
        throw new AssetLoadError(name, error);
      } finally {
        this.inFlight.delete(name);
        this.listeners.delete(name);
      }
    })();

    this.inFlight.set(name, attempt);
    return attempt;
  }

  /**
   * Unloads a bundle, releasing its assets and textures from memory.
   */
  async unloadBundle(name: AssetBundleName): Promise<void> {
    this.loaded.delete(name);
    await this.backend.unloadBundle?.(name);
  }
}

