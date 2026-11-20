import { beforeEach, describe, expect, it, vi } from "vitest";
import { FocusNavigator, arrowKeyNav, focusControl, landing, scrollWithin, tabbables } from "../../../../apps/client/src/features/platform/focus-nav";

beforeEach(() => {
  document.body.innerHTML = `
    <button id="a">A</button>
    <button id="b" disabled>B</button>
    <div inert><button id="c">C</button></div>
    <input id="d" />
    <a id="e" href="#">E</a>
    <button id="f" tabindex="-1">F</button>`;
});

describe("focus navigation", () => {
  it("offers a direction to the focused element, and reports whether it was taken", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const navigator = new FocusNavigator();
    button.addEventListener("ff-steer", (event) => {
      if ((event as CustomEvent<{ direction: string }>).detail.direction === "right") event.preventDefault();
    });
    expect(navigator.steer("right")).toBe(true);
    expect(navigator.steer("left")).toBe(false);
    button.addEventListener("ff-page", (event) => event.preventDefault());
    expect(navigator.page("next")).toBe(true);
  });

  it("walks tabbable elements in DOM order, skipping disabled, inert and untabbable ones", () => {
    expect(tabbables(document).map((element) => element.id)).toEqual(["a", "d", "e"]);
  });

  it("moves next and previous, wrapping at the ends", () => {
    const nav = new FocusNavigator();
    nav.move("next");
    expect(document.activeElement?.id).toBe("a");
    nav.move("next");
    nav.move("next");
    nav.move("next");
    expect(document.activeElement?.id).toBe("a");
    nav.move("previous");
    expect(document.activeElement?.id).toBe("e");
  });

  it("does nothing while paused under the transition veil, and resumes where it was", () => {
    const nav = new FocusNavigator();
    nav.move("next");
    expect(document.activeElement?.id).toBe("a");
    nav.setPaused(true);
    nav.move("next");
    const click = vi.fn();
    document.getElementById("a")!.addEventListener("click", click);
    nav.confirm();
    expect(document.activeElement?.id).toBe("a");
    expect(click).not.toHaveBeenCalled();
    nav.setPaused(false);
    nav.move("next");
    expect(document.activeElement?.id).toBe("d");
  });

  it("stays inside an open modal", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="dialog" aria-modal="true"><button id="m1">1</button><button id="m2">2</button></div>`,
    );
    const nav = new FocusNavigator();
    nav.move("next");
    nav.move("next");
    nav.move("next");
    expect(document.activeElement?.id).toBe("m1");
  });

  it("stays inside the topmost of two stacked modals", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="dialog" aria-modal="true"><button id="under">under</button></div>` +
        `<div role="dialog" aria-modal="true"><button id="top1">1</button><button id="top2">2</button></div>`,
    );
    const nav = new FocusNavigator();
    nav.move("next");
    nav.move("next");
    nav.move("next");
    expect(document.activeElement?.id).toBe("top1");
  });

  it("passes over a modal that is leaving (inert) to the page beneath it", () => {
    document.body.insertAdjacentHTML("beforeend", `<div inert><div role="dialog" aria-modal="true"><button id="gone">gone</button></div></div>`);
    const nav = new FocusNavigator();
    nav.move("next");
    expect(document.activeElement?.id).toBe("a");
  });

  it("confirms by clicking, and backs out with Escape", () => {
    const nav = new FocusNavigator();
    nav.move("next");
    const click = vi.fn();
    document.getElementById("a")!.addEventListener("click", click);
    const escape = vi.fn();
    document.addEventListener("keydown", (event) => event.key === "Escape" && escape());
    nav.confirm();
    nav.back();
    expect(click).toHaveBeenCalledOnce();
    expect(escape).toHaveBeenCalledOnce();
  });
});

describe("what a controller player sees", () => {
  it("asks for the focus ring, which a browser withholds from script focus after a click", () => {
    // Chromium shows :focus-visible for a script's focus() only when the
    // last interaction was a key; after any click or tap, a pad walked the
    // menu with no ring at all.
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    new FocusNavigator().move("next");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true, focusVisible: true });
    focus.mockRestore();
  });

  it("adjusts a focused slider sideways instead of leaving it", () => {
    document.body.innerHTML = `<button id="a">A</button><input id="v" type="range" min="0" max="1" step="0.05" value="0.5" />`;
    const slider = document.getElementById("v") as HTMLInputElement;
    const heard: string[] = [];
    slider.addEventListener("input", () => heard.push(slider.value));
    slider.focus();
    const nav = new FocusNavigator();

    expect(nav.adjust("right")).toBe(true);
    expect(nav.adjust("left")).toBe(true);
    expect(nav.adjust("left")).toBe(true);

    expect(heard).toEqual(["0.55", "0.5", "0.45"]);
    expect(document.activeElement).toBe(slider);
  });

  it("leaves anything but a slider to ordinary movement", () => {
    (document.getElementById("a") as HTMLElement).focus();
    expect(new FocusNavigator().adjust("right")).toBe(false);
  });

  it("keeps a slider at the end of its range where it is", () => {
    document.body.innerHTML = `<input id="v" type="range" min="0" max="1" step="0.05" value="1" /><button id="z">Z</button>`;
    const slider = document.getElementById("v") as HTMLInputElement;
    slider.focus();
    expect(new FocusNavigator().adjust("right")).toBe(true);
    expect(slider.value).toBe("1");
    expect(document.activeElement).toBe(slider);
  });
});

describe("the page around the game", () => {
  it("never scrolls the document to reach an element", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const into = vi.fn();
    HTMLElement.prototype.scrollIntoView = into;
    new FocusNavigator().move("next");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(into).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  it("scrolls the element's own scroll box instead", () => {
    document.body.innerHTML = `<div id="box" style="overflow-y: auto"><button id="deep">Deep</button></div>`;
    const box = document.getElementById("box")!;
    const deep = document.getElementById("deep")!;
    Object.defineProperty(box, "scrollHeight", { value: 500 });
    Object.defineProperty(box, "clientHeight", { value: 100 });
    box.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect;
    deep.getBoundingClientRect = () => ({ top: 150, bottom: 190 }) as DOMRect;
    scrollWithin(deep);
    expect(box.scrollTop).toBe(90);
  });

  it("clicks a guarded button only when the pad put focus on it", () => {
    document.body.innerHTML = `<button id="fs" data-pad-guard>Full screen</button><button id="b">B</button>`;
    const fs = document.getElementById("fs")!;
    const click = vi.fn();
    fs.addEventListener("click", click);
    const nav = new FocusNavigator();

    fs.focus(); // as a mouse click leaves it
    nav.confirm();
    expect(click).not.toHaveBeenCalled();

    nav.move("next");
    nav.move("previous"); // the pad walks back onto it
    nav.confirm();
    expect(click).toHaveBeenCalledOnce();
  });

  it("forgets the pad put focus there once focus leaves and comes back by script", () => {
    document.body.innerHTML = `<button id="fs" data-pad-guard>Full screen</button><button id="b">B</button>`;
    const fs = document.getElementById("fs")!;
    const click = vi.fn();
    fs.addEventListener("click", click);
    const nav = new FocusNavigator();
    nav.move("next");
    document.getElementById("b")!.focus();
    fs.focus(); // a closing modal restores focus to its opener
    nav.confirm();
    expect(click).not.toHaveBeenCalled();
  });

  it("clicks unguarded buttons however they got focus", () => {
    const click = vi.fn();
    document.getElementById("a")!.addEventListener("click", click);
    document.getElementById("a")!.focus();
    new FocusNavigator().confirm();
    expect(click).toHaveBeenCalledOnce();
  });

  it("sends Back as an untrusted, pad-tagged Escape the browser takes no action on", async () => {
    const { padKeyEvents } = await import("../../../../apps/client/src/features/platform/focus-nav");
    let heard: KeyboardEvent | undefined;
    document.addEventListener("keydown", (event) => (heard = event), { once: true });
    new FocusNavigator().back();
    expect(heard?.isTrusted).toBe(false);
    expect(padKeyEvents.has(heard!)).toBe(true);
  });
});

describe("when the screen changes under the pad", () => {
  /** A navigator the pad has used, whose focused element then left the page. */
  const afterScreenChange = () => {
    const nav = new FocusNavigator();
    nav.move("next");
    document.body.innerHTML = `<button id="n1">Next 1</button><button id="n2">Next 2</button>`;
    return nav;
  };

  it("puts focus on the new screen's landing control, with a ring, rather than leaving it on the page", () => {
    const nav = afterScreenChange();
    expect(document.activeElement).toBe(document.body);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    nav.recover();
    expect(document.activeElement?.id).toBe("n1");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true, focusVisible: true });
    focus.mockRestore();
  });

  it("leaves focus where it is while something holds it", () => {
    const nav = afterScreenChange();
    document.getElementById("n2")!.focus();
    nav.recover();
    expect(document.activeElement?.id).toBe("n2");
  });

  it("brings focus into a dialog it has strayed out of", () => {
    const nav = afterScreenChange();
    document.getElementById("n1")!.focus();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="dialog" aria-modal="true"><button id="m1">1</button></div>`,
    );
    nav.recover();
    expect(document.activeElement?.id).toBe("m1");
  });

  it("does nothing before the pad has moved focus at all", () => {
    new FocusNavigator().recover();
    expect(document.activeElement).toBe(document.body);
  });

  it("hands focus back to the page after a mouse, touch or keyboard press, but not the pad's own Back", () => {
    for (const press of [
      () => window.dispatchEvent(new Event("pointerdown")),
      // Any key but Tab: a Tab from the page now lands on the screen's own control.
      () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })),
    ]) {
      const nav = afterScreenChange();
      const detach = nav.attach(window);
      press();
      nav.recover();
      expect(document.activeElement).toBe(document.body);
      detach();
    }

    const nav = afterScreenChange();
    const detach = nav.attach(window);
    nav.back(); // the pad's Escape reaches window too
    nav.recover();
    expect(document.activeElement?.id).toBe("n1");
    detach();
  });

  it("does not count a recovered guarded button as the pad's choice", () => {
    const nav = new FocusNavigator();
    nav.move("next");
    document.body.innerHTML = `<button id="fs" data-pad-guard>Full screen</button><button id="b">B</button>`;
    const click = vi.fn();
    document.getElementById("fs")!.addEventListener("click", click);
    nav.recover();
    expect(document.activeElement?.id).toBe("fs");
    nav.confirm();
    expect(click).not.toHaveBeenCalled();
  });
});

describe("the arrow keys in the menus", () => {
  const key = (code: string, init: KeyboardEventInit = {}): KeyboardEvent =>
    new KeyboardEvent("keydown", { code, key: code, ...init });

  it("walk the menus as the d-pad does", () => {
    expect(arrowKeyNav(key("ArrowUp"))).toBe("up");
    expect(arrowKeyNav(key("ArrowDown"))).toBe("down");
    expect(arrowKeyNav(key("ArrowLeft"))).toBe("left");
    expect(arrowKeyNav(key("ArrowRight"))).toBe("right");
  });

  it("leave other keys and modified arrows alone", () => {
    expect(arrowKeyNav(key("KeyA"))).toBeUndefined();
    expect(arrowKeyNav(key("ArrowUp", { shiftKey: true }))).toBeUndefined();
    expect(arrowKeyNav(key("ArrowUp", { altKey: true }))).toBeUndefined();
  });

  const pressOn = (id: string, code: string): ReturnType<typeof arrowKeyNav> => {
    const event = key(code);
    document.getElementById(id)!.dispatchEvent(event);
    return arrowKeyNav(event);
  };

  it("never let an input hold focus: Up and Down always walk off it", () => {
    document.body.innerHTML = `<input id="t" value="abc" /><input id="r" type="range" /><input id="o" type="radio" />`;
    for (const id of ["t", "r", "o"]) {
      expect(pressOn(id, "ArrowUp")).toBe("up");
      expect(pressOn(id, "ArrowDown")).toBe("down");
    }
  });

  it("leave a slider and a radio group their sideways arrows", () => {
    document.body.innerHTML = `<input id="r" type="range" /><input id="o" type="radio" /><input id="c" type="checkbox" />`;
    expect(pressOn("r", "ArrowRight")).toBeUndefined();
    expect(pressOn("o", "ArrowLeft")).toBeUndefined();
    expect(pressOn("c", "ArrowRight")).toBe("right");
  });

  it("move a text field's caret sideways until it reaches the end", () => {
    document.body.innerHTML = `<input id="t" value="abc" />`;
    const input = document.getElementById("t") as HTMLInputElement;
    input.setSelectionRange(1, 1);
    expect(pressOn("t", "ArrowLeft")).toBeUndefined();
    expect(pressOn("t", "ArrowRight")).toBeUndefined();
    input.setSelectionRange(0, 0);
    expect(pressOn("t", "ArrowLeft")).toBe("left");
    input.setSelectionRange(3, 3);
    expect(pressOn("t", "ArrowRight")).toBe("right");
    input.setSelectionRange(0, 3);
    expect(pressOn("t", "ArrowLeft")).toBeUndefined();
  });

  it("leave multi-line text and dropdowns every arrow", () => {
    document.body.innerHTML = `<textarea id="a"></textarea><select id="s"></select>`;
    expect(pressOn("a", "ArrowDown")).toBeUndefined();
    expect(pressOn("s", "ArrowDown")).toBeUndefined();
  });
});

describe("where the pad lands", () => {
  it("lands on the green button, wherever it stands in page order", () => {
    document.body.innerHTML = `<button id="mute">Mute</button><button id="back">Back</button><button id="play" data-main-action>Play</button>`;
    expect(landing(document)?.id).toBe("play");
  });

  it("without one, on the first control that is not a dialog's Close", () => {
    document.body.innerHTML = `<button id="x" data-close>Close</button><button id="tab">Settings</button>`;
    expect(landing(document)?.id).toBe("tab");
    document.body.innerHTML = `<button id="x" data-close>Close</button>`;
    expect(landing(document)?.id).toBe("x");
  });

  it("passes over a green button that is disabled", () => {
    document.body.innerHTML = `<button id="a">A</button><button id="go" data-main-action disabled>Go</button>`;
    expect(landing(document)?.id).toBe("a");
  });

  it("starts the first press there, and a screen change returns there", () => {
    document.body.innerHTML = `<button id="mute">Mute</button><button id="play" data-main-action>Play</button><button id="more">More</button>`;
    const nav = new FocusNavigator();
    nav.move("previous");
    expect(document.activeElement?.id).toBe("play");
    document.body.innerHTML = `<button id="copy">Copy</button><button id="ready" data-main-action>Ready</button>`;
    nav.recover();
    expect(document.activeElement?.id).toBe("ready");
  });
});

describe("a green button that arrives late", () => {
  it("takes focus from the control the pad was put on while it waited", () => {
    document.body.innerHTML = `<button id="mute">Mute</button><button id="lock" data-main-action disabled>Lock in</button>`;
    const nav = new FocusNavigator();
    nav.move("next");
    document.body.innerHTML = `<button id="mute">Mute</button><button id="lock" data-main-action disabled>Lock in</button>`;
    nav.recover();
    expect(document.activeElement?.id).toBe("mute");
    (document.getElementById("lock") as HTMLButtonElement).disabled = false;
    nav.recover();
    expect(document.activeElement?.id).toBe("lock");
  });

  it("leaves the player's own choice alone", () => {
    document.body.innerHTML = `<button id="mute">Mute</button><button id="lock" data-main-action disabled>Lock in</button>`;
    const nav = new FocusNavigator();
    nav.move("next");
    expect(document.activeElement?.id).toBe("mute");
    (document.getElementById("lock") as HTMLButtonElement).disabled = false;
    nav.recover();
    expect(document.activeElement?.id).toBe("mute");
  });
});

describe("focus a screen moves for the player", () => {
  it("asks for the ring while the pad is driving, and leaves it to the browser otherwise", () => {
    document.body.innerHTML = `<button id="a">A</button><button id="b">B</button>`;
    const nav = new FocusNavigator();
    const detach = nav.attach(window);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    nav.move("next");
    focusControl(document.getElementById("b"));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true, focusVisible: true });
    window.dispatchEvent(new Event("pointerdown"));
    focusControl(document.getElementById("a"));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    focus.mockRestore();
    detach();
  });
});

describe("the first Tab on a new screen", () => {
  const tab = (init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(event);
    return event;
  };

  it("goes to the green button, not the corner's Mute", () => {
    document.body.innerHTML = `<button id="mute">Mute</button><button id="play" data-main-action>Play</button>`;
    const nav = new FocusNavigator();
    const detach = nav.attach(window);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("play");
    detach();
  });

  it("goes there again after the screen takes the focused control away", async () => {
    document.body.innerHTML = `<button id="mute">Mute</button><button id="play" data-main-action>Play</button>`;
    const nav = new FocusNavigator();
    const detach = nav.attach(window);
    document.getElementById("play")!.focus();
    document.body.innerHTML = `<button id="back">Back</button><button id="find" data-main-action>Find a race</button>`;
    await Promise.resolve();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("find");
    detach();
  });

  it("goes round from the top after the player tabs out of the page, so Back and Mute stay reachable", async () => {
    document.body.innerHTML = `<button id="mute">Mute</button><button id="play" data-main-action>Play</button>`;
    const nav = new FocusNavigator();
    const detach = nav.attach(window);
    document.getElementById("play")!.focus();
    document.getElementById("play")!.blur();
    await Promise.resolve();
    expect(tab().defaultPrevented).toBe(false);
    detach();
  });

  it("leaves Tab to the browser once a control has focus, and Shift+Tab always", () => {
    document.body.innerHTML = `<button id="mute">Mute</button><button id="play" data-main-action>Play</button>`;
    const nav = new FocusNavigator();
    const detach = nav.attach(window);
    document.getElementById("mute")!.focus();
    expect(tab().defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe("mute");
    document.getElementById("mute")!.blur();
    expect(tab({ shiftKey: true }).defaultPrevented).toBe(false);
    detach();
  });
});
