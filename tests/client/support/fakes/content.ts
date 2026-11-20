import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
import { parseGameContentArtifact, type GameContent } from "@floor-fifty/shared/content/game-content";
import type { ContentPort } from "../../../../apps/client/src/features/net/content";

/**
 * A content port that records what was asked of it.
 *
 * `refresh` is a spy rather than a counter because the assertions that matter
 * are about how many times a screen asked, not about what it got back, and
 * `set` is the other half: it swaps what the next `current()` and `refresh()`
 * answer with, which is how a test models a server rebuild arriving under a
 * screen that is already mounted.
 */
export function fakeContentPort(content?: GameContent): ContentPort & {
  refresh: ReturnType<typeof vi.fn>;
  set(next: GameContent): void;
} {
  let cache = content;
  const listeners = new Set<(next: GameContent) => void>();
  const refresh = vi.fn(async () => {
    if (cache === undefined) throw new Error("this fake has no content to serve");
    for (const listener of [...listeners]) listener(cache);
    return cache;
  });

  return {
    refresh,
    current: () => cache,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Replaces what the next refresh resolves with. */
    set(next: GameContent) {
      cache = next;
    },
  };
}

/** The shipped artifact, for screens that draw the catalog. */
export function shippedContentPort(): ReturnType<typeof fakeContentPort> {
  return fakeContentPort(
    parseGameContentArtifact(JSON.parse(readFileSync(resolve(process.cwd(), "content/generated/content.json"), "utf8"))),
  );
}
