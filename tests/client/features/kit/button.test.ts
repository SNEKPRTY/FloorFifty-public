import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Button from "../../../../apps/client/src/features/kit/Button.svelte";
import IconButton from "../../../../apps/client/src/features/kit/IconButton.svelte";
import { installUiMotion } from "../../../../apps/client/src/features/kit/ui-motion";
import ButtonHarness from "../../support/ButtonHarness.svelte";

afterEach(() => document.body.replaceChildren());

function render(props: Record<string, unknown>) {
  const host = document.body.appendChild(document.createElement("div"));
  const component = mount(ButtonHarness, { target: host, props });
  flushSync();
  return { host, component, button: host.querySelector<HTMLButtonElement>("button")! };
}

describe("Button", () => {
  it.each([
    ["go", "ff-aq-control--go"],
    ["stop", "ff-aq-control--stop"],
    ["ghost", "ff-aq-control--ghost"],
  ])("kind %s wears %s", (kind, cls) => {
    const { button, component } = render({ kind });
    expect(button.classList.contains("ff-aq-control")).toBe(true);
    expect(button.classList.contains(cls)).toBe(true);
    unmount(component);
  });

  it("plain adds no modifier, and a button is a button, not a submit, unless asked", () => {
    const { button, component } = render({});
    expect([...button.classList].filter((name) => name.startsWith("ff-aq-control--"))).toEqual([]);
    expect(button.type).toBe("button");
    unmount(component);
  });

  it("selected marks a chosen tab or option, and says nothing when it is not", () => {
    const chosen = render({ selected: true, role: "tab" });
    expect(chosen.button.classList.contains("ff-aq-control--selected")).toBe(true);
    unmount(chosen.component);
    const other = render({ role: "tab" });
    expect(other.button.classList.contains("ff-aq-control--selected")).toBe(false);
    unmount(other.component);
  });

  it("with an href it is a link that opens outside the game, drawn as the same button", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const component = mount(ButtonHarness, {
      target: host,
      props: { kind: "ghost", href: "https://example.com/x", "data-pad-guard": "" },
    });
    flushSync();
    expect(host.querySelector("button")).toBeNull();
    const link = host.querySelector<HTMLAnchorElement>("a")!;
    expect(link.classList.contains("ff-aq-control")).toBe(true);
    expect(link.classList.contains("ff-aq-control--ghost")).toBe(true);
    expect(link.href).toBe("https://example.com/x");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.hasAttribute("data-pad-guard")).toBe(true);
    unmount(component);
  });

  it("split adds the split modifier, and an icon is drawn before the words", () => {
    const { button, component } = render({ split: true, icon: "play" });
    expect(button.classList.contains("ff-aq-control--split")).toBe(true);
    expect(button.querySelector("svg.ff-icon")).not.toBeNull();
    unmount(component);
  });

  it("a press calls onclick, and a press while disabled refuses and calls nothing", () => {
    const onclick = vi.fn();
    const live = render({ onclick });
    live.button.click();
    expect(onclick).toHaveBeenCalledTimes(1);
    unmount(live.component);

    const refused = vi.fn();
    const off = render({ onclick: refused, disabled: true });
    const release = installUiMotion(off.host);
    off.button.click();
    off.button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(refused).not.toHaveBeenCalled();
    // Refusal nudges it sideways: the tween is on the button.
    expect(off.button.style.transform).not.toBe("");
    release();
    unmount(off.component);
  });
});

describe("IconButton", () => {
  function icon(props: Record<string, unknown>) {
    const host = document.body.appendChild(document.createElement("div"));
    const component = mount(IconButton, { target: host, props: { icon: "download", label: "Save video", ...props } });
    flushSync();
    return { host, component, button: host.querySelector<HTMLButtonElement>("button")! };
  }

  it("is named by its label and shows no words", () => {
    const { button, component } = icon({});
    expect(button.getAttribute("aria-label")).toBe("Save video");
    expect(button.getAttribute("title")).toBe("Save video");
    expect(button.textContent!.trim()).toBe("");
    expect(button.querySelector("svg.ff-icon")).not.toBeNull();
    unmount(component);
  });

  it("shows a tick in place of the picture once done", () => {
    const { button, component } = icon({ done: true });
    const cells = [...button.querySelectorAll<HTMLElement>("[data-confirm-label]")];
    const visible = cells.filter((cell) => cell.style.visibility === "visible");
    expect(visible.map((cell) => cell.dataset["confirmLabel"])).toEqual(["done"]);
    unmount(component);
  });

  it("with an href it is a link with no words, still named", () => {
    const { host, component } = icon({ href: "https://example.com/y" });
    const link = host.querySelector<HTMLAnchorElement>("a")!;
    expect(host.querySelector("button")).toBeNull();
    expect(link.getAttribute("aria-label")).toBe("Save video");
    expect(link.title).toBe("Save video");
    expect(link.textContent!.trim()).toBe("");
    expect(link.rel).toBe("noopener noreferrer");
    unmount(component);
  });

  it("is a Button underneath", () => {
    expect(typeof Button).toBe("function");
    const { button, component } = icon({ kind: "go" });
    expect(button.classList.contains("ff-aq-control--go")).toBe(true);
    unmount(component);
  });
});
