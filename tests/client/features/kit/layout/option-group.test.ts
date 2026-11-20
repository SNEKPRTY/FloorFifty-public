import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import OptionGroup from "../../../../../apps/client/src/features/kit/layout/OptionGroup.svelte";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

/** `null` for no value: an `undefined` argument would take the default. */
function open(onChange = vi.fn(), disabled = false, value: string | null = "20") {
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(OptionGroup, {
    target: host,
    props: {
      label: "Floors",
      value: value ?? undefined,
      disabled,
      onChange,
      testId: "mode-chooser",
      options: [
        { value: "20", label: "20", testId: "floors-20", ariaLabel: "20 floors" },
        { value: "50", label: "50", testId: "floors-50", ariaLabel: "50 floors" },
        { value: "infinite", label: "∞", testId: "floors-infinite", ariaLabel: "Infinite" },
      ],
    },
  });
  flushSync();
  return host;
}

describe("an option drawn as an icon (survival spec S4)", () => {
  it("shows the icon, keeps the option's name, and still chooses", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    component = mount(OptionGroup, {
      target: host,
      props: {
        label: "Floors",
        value: "20",
        onChange,
        options: [{ value: "infinite", label: "", icon: "stopwatch", testId: "mode-infinite", ariaLabel: "Survival" }],
      },
    });
    flushSync();
    const button = host.querySelector<HTMLButtonElement>('[data-testid="mode-infinite"]')!;
    expect(button.querySelector("svg.ff-icon")).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Survival");
    button.click();
    expect(onChange).toHaveBeenCalledWith("infinite");
  });
});

describe("OptionGroup (UI layout system §5, audit m1)", () => {
  it("is a labelled radio group whose chosen option is checked and filled, not underlined", () => {
    const host = open();
    const group = host.querySelector<HTMLElement>('[data-testid="mode-chooser"]')!;
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent).toBe("Floors");

    const chosen = host.querySelector<HTMLElement>('[data-testid="floors-20"]')!;
    expect(chosen.getAttribute("role")).toBe("radio");
    expect(chosen.getAttribute("aria-checked")).toBe("true");
    expect(chosen.dataset["selected"]).toBe("true");
    expect(chosen.classList.contains("ff-option--selected")).toBe(true);
    expect(chosen.classList.contains("ff-aq-control--selected")).toBe(false);
    expect(chosen.hasAttribute("aria-pressed")).toBe(false);

    const other = host.querySelector<HTMLElement>('[data-testid="floors-50"]')!;
    expect(other.getAttribute("aria-checked")).toBe("false");
    expect(other.dataset["selected"]).toBe("false");
  });

  it("names an option by its own label where its face is a symbol", () => {
    const host = open();
    expect(host.querySelector('[data-testid="floors-infinite"]')!.getAttribute("aria-label")).toBe("Infinite");
  });

  it("reports a choice and leaves the value to its owner", () => {
    const onChange = vi.fn();
    const host = open(onChange);
    host.querySelector<HTMLButtonElement>('[data-testid="floors-50"]')!.click();
    expect(onChange).toHaveBeenCalledWith("50");
    // Controlled: the checked option moves only when the owner passes a new value.
    expect(host.querySelector('[data-testid="floors-20"]')!.getAttribute("aria-checked")).toBe("true");
  });

  it("checks nothing while the value is unknown", () => {
    const host = open(vi.fn(), false, null);
    for (const option of host.querySelectorAll('[role="radio"]')) expect(option.getAttribute("aria-checked")).toBe("false");
  });

  it("disables every option together, for a racer who is not the host", () => {
    const host = open(vi.fn(), true);
    for (const button of host.querySelectorAll("button")) expect(button.disabled).toBe(true);
  });
});
