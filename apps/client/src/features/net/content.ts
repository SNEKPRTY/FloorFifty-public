/**
 * The content port.
 *
 * Public content arrives over HTTP, is decoded strictly, and is cached. The
 * cache is only ever replaced by a response that decoded, so a server that
 * answers with something this build cannot read leaves the client running on
 * the last artifact it understood rather than on nothing.
 *
 * Nothing here parses TOML or imports the compiler. The client reads the
 * server's output and has no opinion about how it was produced.
 */

import {
  parseGameContentArtifact,
  type GameContent,
} from "@floor-fifty/shared/content/game-content";
import { readJson } from "../../lib/fetch-progress";
import { LoadMeter } from "../../lib/load-meter";

export interface ContentPort {
  /** The last successfully decoded artifact, if one has arrived. */
  current(): GameContent | undefined;
  /** `onProgress` hears the fraction of the artifact read, for a loader's bar. */
  refresh(onProgress?: (fraction: number) => void): Promise<GameContent>;
  subscribe(listener: (content: GameContent) => void): () => void;
}

/**
 * Narrowed from `fetch` so a test can supply a response without a server.
 * The signal is how the stall rule lets go of a request that went quiet.
 */
export type FetchLike = (url: string, signal?: AbortSignal) => Promise<Response>;

export class HttpContentManager implements ContentPort {
  private cache: GameContent | undefined;
  private readonly listeners = new Set<(content: GameContent) => void>();
  private readonly loads: LoadMeter;

  constructor(
    private readonly baseUrl: string,
    // Wrapped rather than passed by reference: an unbound `fetch` throws in a
    // browser.
    private readonly request: FetchLike = (url, signal) => fetch(url, { signal: signal ?? null }),
    options: { loads?: LoadMeter } = {},
  ) {
    this.loads = options.loads ?? new LoadMeter();
  }

  current(): GameContent | undefined {
    return this.cache;
  }

  /**
   * Fetches and decodes, replacing the cache only on success.
   *
   * Subscribers are notified from a snapshot of the set, so a listener that
   * unsubscribes while being notified cannot disturb the others.
   */
  async refresh(onProgress?: (fraction: number) => void): Promise<GameContent> {
    // One stall rule over the request and the read: 30 s of nothing fails it,
    // and the cache stays as it was. A slow server that keeps sending does not.
    const body = await this.loads.guard(async (signal) => {
      const response = await this.request(`${this.baseUrl.replace(/\/+$/, "")}/content`, signal);
      if (!response.ok) throw new Error(`content request failed with ${response.status}`);
      return readJson<unknown>(response, (received, total) => {
        this.loads.progress();
        if (total !== undefined) onProgress?.(Math.min(1, received / total));
      });
    });
    onProgress?.(1);

    const content = parseGameContentArtifact(body);
    this.cache = content;
    for (const listener of [...this.listeners]) listener(content);
    return content;
  }

  subscribe(listener: (content: GameContent) => void): () => void {
    this.listeners.add(listener);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.listeners.delete(listener);
    };
  }
}
