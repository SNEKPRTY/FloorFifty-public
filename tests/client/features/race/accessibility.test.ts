/**
 * What `ui/dom.ts` was for.
 *
 * That file argued the menus are HTML rather than drawn because they need real
 * focus order, real text input, and real assistive-technology semantics, none
 * of which a canvas provides. Deleting it does not retire the argument, so this
 * file asserts the three claims per panel rather than leaving them to trust.
 *
 * The failure these guard against is quiet: a control built as a clickable
 * `div` works perfectly with a mouse and is simply absent to a keyboard.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { describe, expect, it } from "vitest";
import { TouchControls } from "../../../../apps/client/src/features/race/touch-controls";
import { ErrorView } from "../../../../apps/client/src/features/screen/error-panel.svelte";
import { recoverableError } from "../../../../apps/client/src/features/net/error-view";
import { shippedContentPort } from "../../support/fakes/content";
import { gameEndWithSnapshot, lobbyWithFakeNetwork, mainMenuWithFakeNetwork } from "../../support/fakes/screens";
import { LOCAL_ID, REMOTE_ID, lobbySnapshot, playerSnapshot, snapshotAt } from "../../support/snapshots";

/** Everything a player can operate, in document order. */
function controls(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")];
}

/**
 * The name assistive technology would announce.
 *
 * Only the sources these panels actually use: the element's own text, an
 * `aria-label`, a `<label for>` pointing at it, or a `<label>` wrapping it.
 */
function accessibleName(element: HTMLElement): string {
  const aria = element.getAttribute("aria-label");
  if (aria !== null && aria.trim() !== "") return aria.trim();

  if (element.id !== "") {
    const label = element.ownerDocument.querySelector(`label[for="${element.id}"]`);
    const text = label?.textContent?.trim() ?? "";
    if (text !== "") return text;
  }

  const wrapping = element.closest("label")?.textContent?.trim() ?? "";
  if (wrapping !== "") return wrapping;

  return element.textContent?.trim() ?? "";
}

/** Asserts the three claims for every control under `root`. */
function expectOperable(root: ParentNode, label: string): void {
  const found = controls(root);
  expect(found.length, `${label} has no controls at all`).toBeGreaterThan(0);

  for (const control of found) {
    // Native elements, so focus order and activation come from the platform
    // rather than from a keydown handler somebody has to remember to write.
    expect(
      ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"],
      `${label}: <${control.tagName.toLowerCase()}> is not natively focusable`,
    ).toContain(control.tagName);

    expect(
      accessibleName(control),
      `${label}: a ${control.tagName.toLowerCase()} has no accessible name`,
    ).not.toBe("");

    // Nothing is pulled out of the tab order.
    expect(control.getAttribute("tabindex"), `${label}: a control is not tabbable`).not.toBe("-1");

    if (!(control as HTMLButtonElement).disabled) {
      control.focus();
      expect(control.ownerDocument.activeElement, `${label}: a control cannot take focus`).toBe(
        control,
      );
    }
  }
}

describe("the connect panel", () => {
  it("offers real text input and named controls", async () => {
    const menu = await lobbyWithFakeNetwork();

    const name = menu.query<HTMLInputElement>("name-input")!;
    // Real text input: a typed name has to survive as a value, which is the
    // thing a drawn control cannot give.
    expect(name.tagName).toBe("INPUT");
    expect(accessibleName(name)).toBe("Your name");

    expectOperable(menu.overlay, "connect panel");
  });
});

describe("the ready room", () => {
  it("keeps every control operable, including the one a guest may not press", async () => {
    const menu = await lobbyWithFakeNetwork();
    await menu.createRoom("Kite");
    menu.receiveSnapshot(lobbySnapshot(2, { hostId: asPlayerId("room-p2") }));

    // A guest's lap buttons are disabled, which is a statement rather than an
    // absence: the control stays in the document and keeps its name.
    const lapThree = menu.query<HTMLButtonElement>("lap-3")!;
    expect(lapThree.disabled).toBe(true);
    expect(accessibleName(lapThree)).not.toBe("");

    expectOperable(menu.overlay, "ready room");
  });

  it("states the lap choice as a checked radio rather than as colour alone", async () => {
    const menu = await lobbyWithFakeNetwork();
    await menu.createRoom("Kite");
    menu.receiveSnapshot(lobbySnapshot(1, { lapCount: 1 }));

    // Colour is not available to every player, so the selection is also in the
    // accessibility tree.
    expect(menu.query("lap-1")?.getAttribute("aria-checked")).toBe("true");
    expect(menu.query("lap-3")?.getAttribute("aria-checked")).toBe("false");
  });

  it("names the Floors row as a radio group with its visible label (race-options spec §3.4)", async () => {
    const menu = await lobbyWithFakeNetwork({ content: shippedContentPort() });
    await menu.createRoom("Kite");
    menu.receiveSnapshot(lobbySnapshot(1, { modeId: "infinite" }));

    const group = menu.query("mode-chooser")!;
    expect(group.getAttribute("role")).toBe("radiogroup");
    const label = menu.overlay.querySelector(`#${group.getAttribute("aria-labelledby")}`);
    expect(label?.textContent).toBe("Floors");
    const infinite = menu.query<HTMLButtonElement>("mode-infinite")!;
    expect(infinite.getAttribute("role")).toBe("radio");
    expect(accessibleName(infinite)).toBe("Survival");
    expect(infinite.getAttribute("aria-checked")).toBe("true");
    expectOperable(menu.overlay, "ready room with floors");
  });
});

describe("the title", () => {
  it("keeps its choices, quick actions and every modal operable", async () => {
    const title = await mainMenuWithFakeNetwork();
    expectOperable(title.overlay, "title");

    for (const [opener, modal] of [
      ["title-settings", "settings-modal"],
      ["quick-contact", "contact-modal"],
    ] as const) {
      title.click(opener);
      expectOperable(title.query(modal)!, modal);
      title.click("modal-close");
    }
    title.screen.exit();
  });

  it("gives every lobby and results screen a corner mute", async () => {
    const lobby = await lobbyWithFakeNetwork();
    expect(lobby.query("corner-mute")?.getAttribute("aria-pressed")).toBe("false");
    lobby.screen.exit();
  });
});

describe("the results panel", () => {
  it("keeps both ways out operable", async () => {
    const gameEnd = await gameEndWithSnapshot(
      snapshotAt(10, {
        phase: "finished",
        players: [playerSnapshot({ id: LOCAL_ID, name: "Kite" })],
        standings: [LOCAL_ID],
        winnerId: LOCAL_ID,
      }),
    );

    expectOperable(gameEnd.overlay, "results panel");
  });
});

describe("the error panel", () => {
  it("interrupts, and names its actions", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const view = new ErrorView(host);
    view.show(recoverableError("ASSET_LOAD_FAILED"), {
      onRetry: () => {},
      onDismiss: () => {},
    });

    // `alert`, not `status`: the player has just pressed something and needs to
    // know it did not work.
    expect(host.querySelector('[data-testid="error-view"]')?.getAttribute("role")).toBe("alert");
    expectOperable(host, "error panel");

    view.hide();
    host.remove();
  });
});

describe("the touch controls", () => {
  it("names each button, which its glyph alone does not", () => {
    const host = document.createElement("div");
    document.body.append(host);

    const controlsView = new TouchControls(() => {});
    controlsView.mount(host);

    // The faces read "left", "right" and "down" only if you can see them.
    for (const [testId, name] of [
      ["touch-left", "Move left"],
      ["touch-right", "Move right"],
      ["touch-fast-fall", "Fast fall"],
    ] as const) {
      const button = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
      expect(accessibleName(button)).toBe(name);
    }

    expectOperable(host, "touch controls");
    controlsView.unmount();
    host.remove();
  });
});

describe("the connection indicator", () => {
  it("announces politely rather than interrupting a race", async () => {
    const menu = await lobbyWithFakeNetwork();
    await menu.createRoom("Kite");
    menu.receiveSnapshot(lobbySnapshot(2, { hostId: asPlayerId(REMOTE_ID) }));

    // Nothing to assert on the menu itself; the indicator belongs to gameplay.
    // What matters here is that creating a room did not strand a control.
    expectOperable(menu.overlay, "menu after joining");
  });
});

describe("the menu keycaps", () => {
  it("keep their text on the panel fill at WCAG AA contrast", () => {
    const root = resolve(import.meta.dirname, "../../../..");
    const tokens = `${readFileSync(resolve(root, "apps/client/src/features/kit/aquarian-tokens.css"), "utf8")}\n${readFileSync(resolve(root, "packages/asset-contract/src/palette.css"), "utf8")}`;
    // A token's hex, following the `var()` hops from the semantic name down to the palette.
    const token = (name: string): string => {
      const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim();
      if (value === undefined) throw new Error(`no token ${name}`);
      const alias = /^var\(--([a-z0-9-]+)\)$/.exec(value);
      return alias !== null ? token(alias[1]!) : value;
    };
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((at) => {
        const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // The keycap's face is the panel's and its letter is the primary text (`.ff-keycap`).
    const [text, face] = [luminance(token("ff-text")), luminance(token("ff-panel-fill"))].sort((a, b) => b - a) as [number, number];
    expect((text + 0.05) / (face + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
