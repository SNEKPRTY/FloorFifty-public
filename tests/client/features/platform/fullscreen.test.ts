import { describe, expect, it, vi } from "vitest";
import { fullscreenSupport, toggleFullscreen } from "../../../../apps/client/src/features/platform/fullscreen";

const doc = (overrides: Record<string, unknown> = {}) =>
  ({ fullscreenEnabled: true, fullscreenElement: null, documentElement: { requestFullscreen: vi.fn(async () => {}) }, exitFullscreen: vi.fn(async () => {}), ...overrides }) as unknown as Document;

describe("fullscreen", () => {
  it("is element fullscreen where the API exists", () => {
    expect(fullscreenSupport(doc(), { userAgent: "Mozilla/5.0 (Windows NT 10.0)", maxTouchPoints: 0 } as Navigator)).toBe("element");
  });

  it("points iPhone Safari to Add to Home Screen instead", () => {
    const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", maxTouchPoints: 5 } as Navigator;
    expect(fullscreenSupport(doc({ fullscreenEnabled: false }), iphone)).toBe("ios-home-screen");
  });

  it("points iPad to Add to Home Screen even where element fullscreen exists", () => {
    // Safari on iPad has element fullscreen, but warns "It looks like you are
    // typing" over fast taps in it; the Home Screen app never does.
    const ipad = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 } as Navigator;
    expect(fullscreenSupport(doc(), ipad)).toBe("ios-home-screen");
  });

  it("points an iPad that names itself to Add to Home Screen too", () => {
    // iPadOS 12, "Request Mobile Website" and in-app browsers say "iPad".
    const ipad = { userAgent: "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X)", maxTouchPoints: 5 } as Navigator;
    expect(fullscreenSupport(doc(), ipad)).toBe("ios-home-screen");
  });

  it("never sends an iPhone or iPad in a frame to the Home Screen, which would install the host's page", () => {
    const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", maxTouchPoints: 5 } as Navigator;
    const ipad = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 } as Navigator;
    expect(fullscreenSupport(doc({ fullscreenEnabled: false }), iphone, true)).toBe("none");
    expect(fullscreenSupport(doc(), ipad, true)).toBe("none");
  });

  it("keeps element fullscreen in a frame that allows it, and none where it does not", () => {
    const pc = { userAgent: "Mozilla/5.0 (Windows NT 10.0)", maxTouchPoints: 0 } as Navigator;
    expect(fullscreenSupport(doc(), pc, true)).toBe("element");
    expect(fullscreenSupport(doc({ fullscreenEnabled: false }), pc, true)).toBe("none");
  });

  it("offers nothing once opened from the Home Screen", () => {
    const app = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5, standalone: true } as unknown as Navigator;
    expect(fullscreenSupport(doc(), app)).toBe("none");
  });

  it("keeps element fullscreen for a Mac with no touch", () => {
    const mac = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 } as Navigator;
    expect(fullscreenSupport(doc(), mac)).toBe("element");
  });

  it("offers nothing where neither exists", () => {
    expect(fullscreenSupport(doc({ fullscreenEnabled: false }), { userAgent: "x", maxTouchPoints: 0 } as Navigator)).toBe("none");
  });

  it("enters, tries a landscape lock, and survives the lock being refused", async () => {
    const d = doc();
    const lock = vi.fn(async () => {
      throw new Error("NotSupportedError");
    });
    vi.stubGlobal("screen", { orientation: { lock } });
    await expect(toggleFullscreen(d)).resolves.toBeUndefined();
    expect((d.documentElement as unknown as { requestFullscreen: () => void }).requestFullscreen).toHaveBeenCalled();
    expect(lock).toHaveBeenCalledWith("landscape");
    vi.unstubAllGlobals();
  });

  it("exits when already fullscreen", async () => {
    const d = doc({ fullscreenElement: {} });
    await toggleFullscreen(d);
    expect(d.exitFullscreen).toHaveBeenCalled();
  });
});
