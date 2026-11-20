/**
 * Controller focus navigation over the page's own DOM.
 *
 * Deliberately DOM order, the same order Tab walks (spec §4): one order to
 * keep right, and a keyboard user and a controller user can never disagree
 * about what comes next. An open modal is the whole world while it is open.
 */

const TABBABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function tabbables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !(element as HTMLButtonElement).disabled &&
      element.closest("[inert], [hidden]") === null,
  );
}

/**
 * Keys a controller sends as keys. Back reaches the page as Escape so every
 * dialog and the pause overlay handle it once, but it is not a keyboard: the
 * input-method tracker skips these, or one press of B taught keyboard
 * controls to a controller player. A back swipe (`back-gesture.ts`) arrives
 * the same way and is not a keyboard either.
 */
export const padKeyEvents = new WeakSet<Event>();

/**
 * Said on the window for every pad press that is not already a key (confirm,
 * a direction, a shoulder), for what any press dismisses: the unlock banner.
 */
export const PAD_PRESS = "ff-pad-press";
const pressed = (): void => void window.dispatchEvent(new Event(PAD_PRESS));

/**
 * The topmost open dialog: the last in the document, as a sheet opened over a
 * page is. One that is leaving (inert from its exit's first frame) is passed
 * over, or it would hold focus through its exit.
 */
const modalOrDocument = (): ParentNode =>
  [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter((dialog) => dialog.closest("[inert]") === null).at(-1) ??
  document;

/**
 * How the pad focuses: with a ring, and without scrolling the page.
 * `focusVisible` because a browser draws no ring for script focus after a
 * click or tap; `preventScroll` because the game owns the viewport, and a
 * browser scrolling the document to reach a button moved the whole game.
 * (`focusVisible` is not yet in TypeScript's DOM types; Chromium, Firefox and
 * Safari take it.)
 */
export const PAD_FOCUS = { preventScroll: true, focusVisible: true } as FocusOptions;

/**
 * Brings `element` into view by scrolling its nearest scroll box -- a long
 * settings panel, say -- and never the document.
 */
export function scrollWithin(element: HTMLElement): void {
  for (let box = element.parentElement; box !== null; box = box.parentElement) {
    if (box === document.body || box === document.documentElement) return;
    const { overflowY } = getComputedStyle(box);
    if ((overflowY !== "auto" && overflowY !== "scroll") || box.scrollHeight <= box.clientHeight) continue;
    const outer = box.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    if (inner.top < outer.top) box.scrollTop -= outer.top - inner.top;
    else if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom;
    return;
  }
}

/**
 * Whether the pad (or the arrow keys, which walk as the d-pad does) moved
 * focus last. A browser draws no ring for script focus after a pad press --
 * a pad press is not a key -- so a dialog that moves focus as it opens or
 * closes asks for the ring itself while this holds (`focusControl`).
 */
let padDriving = false;

/**
 * Focuses a control the way the menus do: without scrolling the page, its own
 * scroll box brought round to it, and with a ring when the pad is driving.
 * For focus a screen or dialog moves for the player (opening, closing, Tab
 * inside a dialog), so what has focus can always be seen.
 */
export function focusControl(element: HTMLElement | null | undefined, options: { within?: boolean } = {}): void {
  if (element === null || element === undefined) return;
  element.focus(padDriving ? PAD_FOCUS : { preventScroll: true });
  // A grid that pages itself keeps its own scroll (`within: false`).
  if (options.within !== false) scrollWithin(element);
}

/** A green button (`Button kind="go"`): the one step forward on its screen. */
const MAIN_ACTION = "[data-main-action]";
/** A dialog's own Close, which A should not press by landing on it. */
const CLOSE = "[data-close]";

/**
 * Where focus lands on a screen or in a dialog: its green button, else its
 * first control that is not Close, else whatever comes first. Landing on the
 * first control in page order put the pad on Mute or Back, which one press
 * of A then pressed.
 */
export function landing(root: ParentNode): HTMLElement | undefined {
  const items = tabbables(root);
  return items.find((element) => element.matches(MAIN_ACTION)) ?? items.find((element) => !element.matches(CLOSE)) ?? items[0];
}

const ARROWS: Readonly<Record<string, "up" | "down" | "left" | "right">> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Inputs that take Left and Right for themselves: a slider's step, a radio group's choice. */
const SIDEWAYS_INPUTS = new Set(["range", "radio"]);

/** Inputs with a caret, which Left and Right move until it reaches an end. */
const CARET_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

/**
 * The menu direction an arrow key walks, as the d-pad would, or undefined
 * when the key is not a bare arrow or its target keeps that arrow. Up and
 * Down always walk off an input, so no slider, radio group or text field
 * can hold focus; Left and Right stay with a slider or radio group, and with
 * a text field until its caret meets the end the arrow points at. Multi-line
 * and rich text keep every arrow.
 */
export function arrowKeyNav(event: KeyboardEvent): "up" | "down" | "left" | "right" | undefined {
  const nav = ARROWS[event.code];
  if (nav === undefined || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  const target = event.target;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return undefined;
  if (target instanceof HTMLElement && target.isContentEditable) return undefined;
  if (!(target instanceof HTMLInputElement) || nav === "up" || nav === "down") return nav;
  if (SIDEWAYS_INPUTS.has(target.type)) return undefined;
  if (CARET_INPUTS.has(target.type)) {
    const { selectionStart, selectionEnd, value } = target;
    // `number` reports no selection; its caret is out of reach, so it walks.
    if (selectionStart === null || selectionEnd === null) return nav;
    if (selectionStart !== selectionEnd) return undefined;
    const atEnd = nav === "left" ? selectionStart === 0 : selectionEnd === value.length;
    return atEnd ? nav : undefined;
  }
  return nav;
}

export class FocusNavigator {
  /**
   * The element the pad itself last focused, while it still holds focus.
   * A `data-pad-guard` element -- one that reaches past the game, like Full
   * screen -- is clicked by A only when it is this: focus a mouse click left
   * behind, or a closing modal restored, is not the pad's choice.
   */
  private padFocused: HTMLElement | undefined;
  /**
   * Whether the pad is the one moving focus: set by any pad action, cleared by
   * a mouse, touch or keyboard press. Only then does `recover` step in, so a
   * mouse or keyboard player's focus is never moved for them.
   */
  private engagedNow = false;
  private get engaged(): boolean {
    return this.engagedNow;
  }
  private set engaged(engaged: boolean) {
    this.engagedNow = engaged;
    padDriving = engaged;
  }

  constructor(private readonly root: () => ParentNode = modalOrDocument) {}

  /** Stops `recover` once the player presses anything that is not the pad. */
  attach(target: EventTarget = window): () => void {
    const onPointer = (): void => void (this.engaged = false);
    // The pad's own Back arrives here as Escape; it is still the pad.
    const onKey = (event: Event): void => {
      if (padKeyEvents.has(event)) return;
      this.engaged = false;
      if (event instanceof KeyboardEvent) this.tabFromNothing(event);
    };
    const onFocusIn = (event: Event): void => {
      if (event.target instanceof HTMLElement) this.lastFocused = event.target;
    };
    target.addEventListener("pointerdown", onPointer, { capture: true });
    target.addEventListener("keydown", onKey, { capture: true });
    target.addEventListener("focusin", onFocusIn, { capture: true });
    return () => {
      target.removeEventListener("pointerdown", onPointer, { capture: true });
      target.removeEventListener("keydown", onKey, { capture: true });
      target.removeEventListener("focusin", onFocusIn, { capture: true });
    };
  }

  /**
   * The control that last had focus. Gone from the page, the screen took it
   * away and the next Tab lands on the screen's green button; still there,
   * the player tabbed out of the page or clicked empty space, and Tab goes
   * on round the page from its top, so Back and Mute stay in the Tab order.
   */
  private lastFocused: HTMLElement | undefined;

  /**
   * The first Tab after a screen change goes to the screen's green button,
   * as the pad's first press does. The screen it stood on was replaced, so
   * focus rests on the page, and the browser's next Tab took the first
   * control in page order: Back or Mute in the corner.
   */
  private tabFromNothing(event: KeyboardEvent): void {
    if (this.paused || event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (this.lastFocused?.isConnected === true) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const first = landing(this.root());
    if (first === undefined) return;
    event.preventDefault();
    focusControl(first);
  }

  private paused = false;
  /** The control `recover` last put focus on, until the player moves it. */
  private recovered: HTMLElement | undefined;

  /** Paused while the transition veil covers the screen (race-flow spec §7.2). */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /**
   * Puts focus on the screen's landing control (`landing`), when it has fallen
   * to the page -- the screen it stood on was replaced -- or out of an open
   * dialog. Called every frame the pad is in the menus; a pad player
   * otherwise saw nothing selected after every screen change. Not the pad's
   * choice of element, so a guarded one stays guarded until walked onto.
   */
  recover(): void {
    if (this.paused) return;
    if (!this.engaged) return;
    const root = this.root();
    const active = document.activeElement;
    const held = active instanceof HTMLElement && active !== document.body && root.contains(active);
    // Held by the player's own choice, it stays. Held only because this put it
    // there, it moves on once the screen's green button can take it: a screen
    // arrives with its button still disabled (the select step's Lock in waits
    // for the room), and the pad stood on Mute for the whole step.
    if (held && (active !== this.recovered || active.matches(MAIN_ACTION))) return;
    const first = landing(root);
    if (first === undefined || first === active) return;
    first.focus(PAD_FOCUS);
    scrollWithin(first);
    this.recovered = first;
  }

  move(direction: "next" | "previous"): void {
    if (this.paused) return;
    this.engaged = true;
    const items = tabbables(this.root());
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = direction === "next" ? 1 : -1;
    this.recovered = undefined;
    // From nothing, the first press lands where `recover` would, either way.
    const target = at === -1 ? (landing(this.root()) ?? items[0]!) : items[(at + step + items.length) % items.length]!;
    target.focus(PAD_FOCUS);
    scrollWithin(target);
    this.padFocused = target;
    target.addEventListener(
      "blur",
      () => {
        if (this.padFocused === target) this.padFocused = undefined;
      },
      { once: true },
    );
  }

  /**
   * Nudges a focused slider one step, as the arrow keys would. Returns false
   * when nothing adjustable has focus, so the caller moves focus instead.
   */
  adjust(direction: "left" | "right"): boolean {
    if (this.paused) return false;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLInputElement) || focused.type !== "range") return false;
    if (direction === "right") focused.stepUp();
    else focused.stepDown();
    focused.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  /**
   * Offers a direction to the focused element before focus walks: a grid
   * takes it (`preventDefault`) to move within a page or turn one. Returns
   * true when it was taken.
   */
  steer(direction: "up" | "down" | "left" | "right"): boolean {
    if (this.paused) return false;
    pressed();
    return this.offer("ff-steer", { direction });
  }

  /** Offers a page turn (Page Up/Down, Q/E, the shoulder buttons) to the focused element. */
  page(direction: "previous" | "next"): boolean {
    if (this.paused) return false;
    pressed();
    return this.offer("ff-page", { direction });
  }

  private offer(type: string, detail: object): boolean {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || focused === document.body) return false;
    const event = new CustomEvent(type, { detail, bubbles: true, cancelable: true });
    focused.dispatchEvent(event);
    return event.defaultPrevented;
  }

  confirm(): void {
    if (this.paused) return;
    this.engaged = true;
    // Pressed, it is the player's choice now: `recover` leaves it be.
    this.recovered = undefined;
    pressed();
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || focused === document.body) return;
    if (focused.hasAttribute("data-pad-guard") && focused !== this.padFocused) return;
    focused.click();
  }

  back(): void {
    if (this.paused) return;
    this.engaged = true;
    const target = document.activeElement ?? document;
    const event = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true });
    padKeyEvents.add(event);
    target.dispatchEvent(event);
  }
}
