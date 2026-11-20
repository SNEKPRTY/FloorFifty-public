/**
 * Mounting the connection indicator from imperative code.
 *
 * `features/race/gameplay.ts` owns this the way it owns everything else it creates,
 * so the seam is a class rather than a component in a tree. The view itself is
 * `features/net/ConnectionIndicator.svelte`.
 *
 * `.svelte.ts` because the state is a rune: `set` writes to it and the mounted
 * component patches the text in place. Remounting on each change would take the
 * live region out of the document and put a new one back, and a screen reader
 * announces nothing when the element it was observing disappears.
 */

import { mount, unmount } from "svelte";
import type { ConnectionState } from "./network";
import ConnectionIndicator from "./ConnectionIndicator.svelte";
import { CONNECTION_LABELS } from "./connection-labels";

export { CONNECTION_LABELS };

/** States worth interrupting a player for. A healthy connection says nothing. */
const VISIBLE: readonly ConnectionState[] = ["connecting", "reconnecting", "offline"];

export class ConnectionStateView {
  private state = $state<ConnectionState>("connected");
  private readonly app: Record<string, unknown>;

  constructor(host: HTMLElement) {
    const view = this;
    this.app = mount(ConnectionIndicator, {
      target: host,
      props: {
        get state() {
          return view.state;
        },
      },
    });
  }

  set(state: ConnectionState): void {
    this.state = state;
  }

  text(): string {
    return CONNECTION_LABELS[this.state]();
  }

  get isVisible(): boolean {
    return VISIBLE.includes(this.state);
  }

  destroy(): void {
    void unmount(this.app);
  }
}
