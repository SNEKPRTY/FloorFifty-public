import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorChannel,
  isRetryable,
  recoverableError,
} from "../../../../apps/client/src/features/net/error-view";
import { ErrorView } from "../../../../apps/client/src/features/screen/error-panel.svelte";
import { ConnectionStateView } from "../../../../apps/client/src/features/net/connection-state.svelte";

function host(): HTMLElement {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("which failures can be retried", () => {
  it("offers a retry for an asset failure, which really can succeed twice", () => {
    expect(isRetryable("ASSET_LOAD_FAILED")).toBe(true);
    expect(recoverableError("ASSET_LOAD_FAILED").retry).toBe(true);
  });

  it("offers no retry for a failure that would fail identically", () => {
    for (const code of ["INVALID_ROOM", "ROOM_FULL", "VERSION_MISMATCH", "ROOM_CLOSED"] as const) {
      expect(isRetryable(code)).toBe(false);
    }
  });

  it("treats a failed simulation as recoverable but not retryable", () => {
    const error = recoverableError("SIMULATION_FAILURE");
    expect(error.retry).toBe(false);
    expect(isRetryable("SIMULATION_FAILURE")).toBe(false);
  });
});

describe("the error view", () => {
  it("shows the copy for its code and detail, and a retry when the failure has one", () => {
    const node = host();
    const view = new ErrorView(node);
    const onRetry = vi.fn();

    view.show(recoverableError("ASSET_LOAD_FAILED", "race-assets"), { onRetry });

    expect(view.text()).toBe("Could not load the race.");
    node.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers a reload rather than a retry on a version mismatch", () => {
    const node = host();
    const view = new ErrorView(node);
    const onRetry = vi.fn();

    view.show(recoverableError("VERSION_MISMATCH"), { onRetry });

    // A retry would send the identical request and fail the identical way.
    expect(node.querySelector('[data-testid="error-retry"]')).toBeNull();
    expect(node.querySelector('[data-testid="error-reload"]')).not.toBeNull();
  });

  it("offers a reload when the server is updating, and says so", () => {
    const node = host();
    const view = new ErrorView(node);
    view.show(recoverableError("SERVER_UPDATING"), { onRetry: vi.fn() });

    expect(node.querySelector('[data-testid="error-retry"]')).toBeNull();
    expect(node.querySelector('[data-testid="error-reload"]')).not.toBeNull();
    expect(view.text()).toMatch(/updating/i);
  });

  it("offers a retry when the server is full or the player went too fast", () => {
    for (const code of ["SERVER_BUSY", "RATE_LIMITED"] as const) {
      const node = host();
      const view = new ErrorView(node);
      view.show(recoverableError(code), { onRetry: vi.fn() });
      expect(node.querySelector('[data-testid="error-retry"]')).not.toBeNull();
      expect(node.querySelector('[data-testid="error-reload"]')).toBeNull();
    }
  });

  it("keeps a malformed or full room failure in place with no retry", () => {
    const node = host();
    const view = new ErrorView(node);
    view.show(recoverableError("ROOM_FULL"), { onRetry: vi.fn() });

    expect(node.querySelector('[data-testid="error-retry"]')).toBeNull();
    expect(view.isShowing).toBe(true);
  });

  it("replaces an earlier failure rather than stacking panels", () => {
    const node = host();
    const view = new ErrorView(node);
    view.show(recoverableError("ROOM_FULL"));
    view.show(recoverableError("INVALID_ROOM"));

    expect(node.querySelectorAll('[data-testid="error-view"]')).toHaveLength(1);
    expect(view.text()).toBe("There is no room with that code.");
  });

  it("can be dismissed", () => {
    const node = host();
    const view = new ErrorView(node);
    const onDismiss = vi.fn();
    view.show(recoverableError("ROOM_FULL"), { onDismiss });

    node.querySelector<HTMLButtonElement>('[data-testid="error-dismiss"]')!.click();
    expect(view.isShowing).toBe(false);
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("the error channel", () => {
  it("delivers a pending failure exactly once", () => {
    const channel = new ErrorChannel();
    channel.report(recoverableError("ROOM_CLOSED"));

    expect(channel.take()).toMatchObject({ code: "ROOM_CLOSED" });
    expect(channel.take()).toBeUndefined();
    expect(channel.hasPending).toBe(false);
  });
});

describe("the connection indicator", () => {
  it("says nothing while the connection is healthy", () => {
    const view = new ConnectionStateView(host());
    view.set("connected");
    expect(view.isVisible).toBe(false);
  });

  it("names each state a player needs to know about", () => {
    const view = new ConnectionStateView(host());

    view.set("reconnecting");
    expect(view.text()).toBe("Reconnecting…");
    expect(view.isVisible).toBe(true);

    view.set("offline");
    expect(view.text()).toBe("Offline");
    expect(view.isVisible).toBe(true);
  });

  it("removes itself on teardown", () => {
    const node = host();
    const view = new ConnectionStateView(node);
    view.destroy();
    expect(node.querySelector('[data-testid="connection-state"]')).toBeNull();
  });
});
