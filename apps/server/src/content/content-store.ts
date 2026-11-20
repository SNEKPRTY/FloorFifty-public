/**
 * The server's current content.
 *
 * One mutable cell, deliberately. A room reads it exactly once, at creation,
 * and never again; everything else about content reload follows from that.
 * Replacing the value affects menus and rooms created afterwards, and cannot
 * reach a race already under way.
 */

import type { GameContent } from "@floor-fifty/shared/content/game-content";

export class ContentStore {
  constructor(private value: GameContent) {}

  current(): GameContent {
    return this.value;
  }

  replace(next: GameContent): void {
    this.value = next;
  }
}
