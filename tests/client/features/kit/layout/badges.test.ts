import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import BadgeRow from "../../../../../apps/client/src/features/kit/layout/BadgeRow.svelte";
import NamePill from "../../../../../apps/client/src/features/kit/layout/NamePill.svelte";
import DialogHeading from "../../../../../apps/client/src/features/kit/layout/DialogHeading.svelte";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
});

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

describe("BadgeRow (UI layout system §5, audit M12)", () => {
  it("sets status badges as pills and an action badge with a handler as a real button", () => {
    const change = vi.fn();
    const target = host();
    component = mount(BadgeRow, {
      target,
      props: {
        badges: [
          { text: "You", kind: "status", testId: "seat-you" },
          { text: "Host", kind: "status", testId: "seat-host" },
          { text: "Change", kind: "action", onSelect: change, testId: "seat-change-tag" },
        ],
      },
    });
    flushSync();
    expect(target.querySelector("[data-badge-row]")).not.toBeNull();
    const you = target.querySelector('[data-testid="seat-you"]')!;
    expect(you.tagName).toBe("SPAN");
    expect(you.classList.contains("ff-badge")).toBe(true);
    const action = target.querySelector<HTMLButtonElement>('[data-testid="seat-change-tag"]')!;
    expect(action.tagName).toBe("BUTTON");
    expect(action.classList.contains("ff-badge--action")).toBe(true);
    action.click();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("draws an action badge without a handler as a span, so the row it sits in stays the one control", () => {
    const target = host();
    component = mount(BadgeRow, {
      target,
      props: { badges: [{ text: "Change", kind: "action", testId: "seat-change-tag" }] },
    });
    flushSync();
    const tag = target.querySelector<HTMLElement>('[data-testid="seat-change-tag"]')!;
    expect(tag.tagName).toBe("SPAN");
    expect(tag.classList.contains("ff-badge--action")).toBe(true);
    expect(target.querySelector("button")).toBeNull();
  });
});

describe("NamePill (UI layout system §5)", () => {
  it("is the one place a name may be cut, dotted in its player's colour, with the full name kept", () => {
    const target = host();
    component = mount(NamePill, {
      target,
      props: { name: "Wolfgang-Amadeus", colour: "scarlet", self: true, testId: "pill" },
    });
    flushSync();
    const pill = target.querySelector<HTMLElement>('[data-testid="pill"]')!;
    expect(pill.dataset["self"]).toBe("true");
    expect(pill.textContent).toBe("Wolfgang-Amadeus");
    expect(pill.querySelector(".ff-namepill__dot")!.classList.contains("ff-colour-scarlet")).toBe(true);
    const name = pill.querySelector<HTMLElement>("[data-truncatable]")!;
    expect(name.textContent).toBe("Wolfgang-Amadeus");
    expect(name.getAttribute("title")).toBe("Wolfgang-Amadeus");
  });

  it("draws no dot for an open seat, and marks only the local racer's pill as theirs", () => {
    const target = host();
    component = mount(NamePill, { target, props: { name: "Open", testId: "pill" } });
    flushSync();
    const pill = target.querySelector<HTMLElement>('[data-testid="pill"]')!;
    expect(pill.querySelector(".ff-namepill__dot")).toBeNull();
    expect(pill.dataset["self"]).toBeUndefined();
  });
});

describe("DialogHeading (UI layout system §5, audit m6)", () => {
  it("makes the title the heading, under its id, with any eyebrow above it and smaller", () => {
    const target = host();
    component = mount(DialogHeading, { target, props: { id: "pause-title", title: "Paused", eyebrow: "Race" } });
    flushSync();
    const heading = target.querySelector("h2")!;
    expect(heading.id).toBe("pause-title");
    expect(heading.textContent).toBe("Paused");
    expect(heading.classList.contains("ff-dialog-heading__title")).toBe(true);
    const eyebrow = target.querySelector(".ff-dialog-heading__eyebrow")!;
    expect(eyebrow.textContent).toBe("Race");
    expect(eyebrow.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
