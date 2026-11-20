import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formFactor, heightTier, trackViewport, type ViewportWindow } from "../../../../apps/client/src/features/platform/viewport-tracking.svelte";

/** A window whose sizes a test sets, firing the listeners the tracker added. */
function fakeWindow(width: number, height: number) {
  const listeners = new Map<string, Set<() => void>>();
  const visualListeners = new Map<string, Set<() => void>>();
  const on = (map: Map<string, Set<() => void>>) => (type: string, listener: () => void) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type)!.add(listener);
  };
  const off = (map: Map<string, Set<() => void>>) => (type: string, listener: () => void) => map.get(type)?.delete(listener);
  const visual = { height, offsetTop: 0, addEventListener: on(visualListeners), removeEventListener: off(visualListeners) };
  const win = {
    innerWidth: width,
    innerHeight: height,
    visualViewport: visual,
    addEventListener: on(listeners),
    removeEventListener: off(listeners),
  };
  return {
    win: win as unknown as ViewportWindow,
    resize(nextWidth: number, nextHeight: number) {
      win.innerWidth = nextWidth;
      win.innerHeight = nextHeight;
      visual.height = nextHeight;
      for (const listener of listeners.get("resize") ?? []) listener();
    },
    /** The on-screen keyboard: the visual viewport shrinks, the layout one does not. */
    keyboard(visibleHeight: number) {
      visual.height = visibleHeight;
      for (const listener of visualListeners.get("resize") ?? []) listener();
    },
    /** A browser that changes its sizes without telling the page. */
    settleSilently(layoutHeight: number, visibleHeight: number) {
      win.innerHeight = layoutHeight;
      visual.height = visibleHeight;
    },
    listenerCount: () => [...listeners.values(), ...visualListeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe("trackViewport", () => {
  it("tags the root and the rune on start", () => {
    const root = document.createElement("html");
    const { win } = fakeWindow(390, 844);
    stop = trackViewport(win, root);
    expect(root.dataset["formFactor"]).toBe("phone-portrait");
    expect(formFactor.current).toBe("phone-portrait");
  });

  it("follows a rotation without a reload (Review focus 2)", () => {
    const root = document.createElement("html");
    const view = fakeWindow(390, 844);
    stop = trackViewport(view.win, root);
    view.resize(844, 390);
    expect(root.dataset["formFactor"]).toBe("phone-landscape");
    expect(formFactor.current).toBe("phone-landscape");
  });

  it("keeps the form factor while the keyboard is open, and publishes its inset (Review focus 1)", () => {
    const root = document.createElement("html");
    const view = fakeWindow(390, 844);
    stop = trackViewport(view.win, root);
    view.keyboard(500);
    expect(root.dataset["formFactor"]).toBe("phone-portrait");
    expect(root.style.getPropertyValue("--ff-visual-inset-bottom")).toBe("344px");
    view.keyboard(844);
    expect(root.style.getPropertyValue("--ff-visual-inset-bottom")).toBe("0px");
  });

  it("measures again after an event, so a bar that settles without one is still seen", () => {
    // Measured on an Android emulator: the keyboard closes, the last event
    // fires while the sizes are still moving, and the inset is left at the
    // keyboard's height with nothing to correct it.
    vi.useFakeTimers();
    try {
      const root = document.createElement("html");
      const view = fakeWindow(411, 749);
      stop = trackViewport(view.win, root);
      view.keyboard(437);
      expect(root.style.getPropertyValue("--ff-visual-inset-bottom")).toBe("312px");
      view.settleSilently(749, 749);
      vi.advanceTimersByTime(1000);
      expect(root.style.getPropertyValue("--ff-visual-inset-bottom")).toBe("0px");
    } finally {
      vi.useRealTimers();
    }
  });

  describe("DuckDuckGo's forgotten bottom bar", () => {
    /** The emulator's DuckDuckGo: a 915 px screen, 802 px of page while the bar is counted. */
    function duckDuckGo(height: number) {
      const view = fakeWindow(411, height);
      Object.assign(view.win, {
        screen: { width: 412, height: 915 },
        navigator: { userAgentData: { brands: [{ brand: "Chromium" }, { brand: "DuckDuckGo" }] } },
      });
      return view;
    }

    it("keeps the page and the screens above a bar the browser grew the page under", () => {
      vi.useFakeTimers();
      try {
        const root = document.createElement("html");
        const view = duckDuckGo(802);
        stop = trackViewport(view.win, root);
        vi.advanceTimersByTime(1000);
        expect(root.style.getPropertyValue("--ff-hidden-bar-bottom")).toBe("0px");
        view.resize(411, 866);
        vi.advanceTimersByTime(1000);
        expect(root.style.getPropertyValue("--ff-hidden-bar-bottom")).toBe("64px");
        expect(root.style.getPropertyValue("--ff-visual-inset-bottom")).toBe("64px");
      } finally {
        vi.useRealTimers();
      }
    });

    it("catches a page that loads already grown", () => {
      const root = document.createElement("html");
      stop = trackViewport(duckDuckGo(866).win, root);
      expect(root.style.getPropertyValue("--ff-hidden-bar-bottom")).toBe("64px");
    });

    it("leaves every other browser alone, however little room the page is given", () => {
      const root = document.createElement("html");
      const view = fakeWindow(411, 866);
      Object.assign(view.win, { screen: { width: 412, height: 915 }, navigator: {} });
      stop = trackViewport(view.win, root);
      expect(root.style.getPropertyValue("--ff-hidden-bar-bottom")).toBe("0px");
      expect(root.style.getPropertyValue("--ff-visual-inset-bottom")).toBe("0px");
    });
  });

  it("removes every listener it added", () => {
    const root = document.createElement("html");
    const view = fakeWindow(1280, 720);
    const release = trackViewport(view.win, root);
    expect(view.listenerCount()).toBeGreaterThan(0);
    release();
    expect(view.listenerCount()).toBe(0);
  });

  it("tags the height tier beside the form factor, and clears it when there is room (UI layout system §3.2)", () => {
    const root = document.createElement("html");
    const view = fakeWindow(1280, 720);
    stop = trackViewport(view.win, root);
    expect(root.dataset["height"]).toBeUndefined();

    view.resize(900, 600);
    expect(root.dataset["formFactor"]).toBe("desktop");
    expect(root.dataset["height"]).toBe("short");

    view.resize(780, 270);
    expect(root.dataset["height"]).toBe("compact");

    view.resize(390, 844);
    expect(root.dataset["height"]).toBeUndefined();
    expect(root.hasAttribute("data-height")).toBe(false);
  });

  it("publishes the tier for screen roots that pick an arrangement in script", () => {
    const root = document.createElement("html");
    const view = fakeWindow(900, 600);
    stop = trackViewport(view.win, root);
    expect(heightTier.current).toBe("short");
    view.resize(1440, 900);
    expect(heightTier.current).toBeUndefined();
  });

  it("marks the root while something covers the page's foot, so a screen can scroll what it hides", () => {
    const root = document.createElement("html");
    const view = fakeWindow(780, 270);
    stop = trackViewport(view.win, root);
    expect(root.hasAttribute("data-visual-inset")).toBe(false);
    view.keyboard(180);
    expect(root.hasAttribute("data-visual-inset")).toBe(true);
    view.keyboard(270);
    expect(root.hasAttribute("data-visual-inset")).toBe(false);
  });

  it("re-tiers live as a window is dragged across the short line", () => {
    const root = document.createElement("html");
    // 1400 wide, so the band is taller than the window and the window decides.
    const view = fakeWindow(1400, 601);
    stop = trackViewport(view.win, root);
    expect(heightTier.current).toBeUndefined();
    view.resize(1400, 600);
    expect(root.dataset["height"]).toBe("short");
    expect(heightTier.current).toBe("short");
    view.resize(900, 340);
    expect(heightTier.current).toBe("short");
    view.resize(900, 339);
    expect(heightTier.current).toBe("compact");
  });

  it("tiers a tablet held sideways by its band, between the letterbox bars", () => {
    const root = document.createElement("html");
    root.dataset["bandMode"] = "field";
    const view = fakeWindow(1180, 820);
    stop = trackViewport(view.win, root);
    expect(root.dataset["formFactor"]).toBe("desktop");
    expect(heightTier.current).toBe("short");
    view.resize(820, 1180);
    expect(heightTier.current).toBeUndefined();
  });

  it("tiers a menu by the whole window, so iPad sideways is not short", () => {
    const root = document.createElement("html");
    const view = fakeWindow(1080, 810);
    stop = trackViewport(view.win, root);
    expect(heightTier.current).toBeUndefined();
    root.dataset["bandMode"] = "field";
    view.resize(1080, 810);
    expect(heightTier.current).toBe("short");
    delete root.dataset["bandMode"];
    view.resize(1080, 810);
    expect(heightTier.current).toBeUndefined();
  });
});

describe("the viewport meta (Review focus 1)", () => {
  it("states that the keyboard resizes only the visual viewport", () => {
    // Left to the default, an Android WebView can shrink the layout viewport
    // for the keyboard, and the classifier would swap the layout mid-typing.
    const html = readFileSync(resolve(import.meta.dirname, "../../../../apps/client/index.html"), "utf8");
    expect(html).toMatch(/name="viewport"[^>]*interactive-widget=resizes-visual/);
  });
});
