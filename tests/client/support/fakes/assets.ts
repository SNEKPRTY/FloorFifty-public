import { AssetLoadError, type AssetBundleName, type AssetPort } from "../../../../apps/client/src/features/render/assets";

export class FakeAssets implements AssetPort {
  readonly loadedBundles: AssetBundleName[] = [];
  /** Bundles that should reject, to exercise the retry path. */
  readonly failing = new Set<AssetBundleName>();
  /** Runs while a bundle loads: the moment a real load spends on the network. */
  whileLoading: ((name: AssetBundleName) => void) | undefined;
  /** Holds a bundle's load open until the returned promise settles. */
  gate: ((name: AssetBundleName) => Promise<void> | undefined) | undefined;
  /** Fails this bundle's first load only, as a dropped connection would. */
  failOnce: AssetBundleName | undefined;
  /** Fractions reported before a load completes, as a backend would. */
  progressSteps: readonly number[] = [];

  /** The URL a real manager would resolve: the alias itself, under `/assets/`. */
  srcOf(alias: string): string | undefined {
    return `/assets/${alias}`;
  }

  async loadBundle(name: AssetBundleName, onProgress?: (fraction: number) => void): Promise<void> {
    if (this.loadedBundles.includes(name)) {
      onProgress?.(1);
      return;
    }
    this.whileLoading?.(name);
    await this.gate?.(name);
    if (this.failing.has(name)) throw new Error(`asset bundle "${name}" failed`);
    if (this.failOnce === name) {
      this.failOnce = undefined;
      throw new AssetLoadError(name, new Error("the connection dropped"));
    }
    for (const fraction of this.progressSteps) onProgress?.(fraction);
    this.loadedBundles.push(name);
    onProgress?.(1);
  }

  async unloadBundle(name: AssetBundleName): Promise<void> {
    const idx = this.loadedBundles.indexOf(name);
    if (idx !== -1) this.loadedBundles.splice(idx, 1);
  }

  isLoaded(name: AssetBundleName): boolean {
    return this.loadedBundles.includes(name);
  }
}

