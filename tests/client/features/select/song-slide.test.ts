import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import SongSlide from "../../../../apps/client/src/features/select/SongSlide.svelte";
import type { PickerItem } from "../../../../apps/client/src/features/select/picker-model";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const MOVING_ON: PickerItem = { id: "moving-on", label: "Moving On", state: "open", art: "/assets/cover.movingOnLarge" };
const quiet = () => ({ bins: new Uint8Array(512), decibels: new Float32Array(512).fill(-Infinity), binHz: 46.875 });

function render(props: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(SongSlide, { target: host, props: { item: MOVING_ON, spectrum: quiet, live: true, ...props } });
  flushSync();
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { host, q };
}

describe("SongSlide", () => {
  it("shows the cover large and an equaliser, and no tempo, and no title of its own", () => {
    const { q } = render();
    expect(q("song-slide-cover")!.querySelector("img")!.getAttribute("src")).toBe("/assets/cover.movingOnLarge");
    expect(q("song-slide-bpm")).toBeNull();
    expect(q("equaliser")).not.toBeNull();
    // The panel's headline names the song.
    expect(q("song-slide-title")).toBeNull();
  });

  it("a missing cover still shows the title", () => {
    // Review Focus 5: no cover at all, and a cover that fails to load.
    const bare = render({ item: { id: "moving-on", label: "Moving On", state: "open" } });
    expect(bare.q("song-slide-title")!.textContent).toBe("Moving On");
    unmount(component!);
    component = undefined;

    // Every request fails, the first and each retry (`AsyncImage`).
    vi.useFakeTimers();
    const broken = render();
    for (let request = 0; request < 4; request += 1) {
      broken.q("song-slide-cover")!.querySelector("img")!.dispatchEvent(new Event("error"));
      vi.advanceTimersByTime(2000);
      flushSync();
    }
    expect(broken.q("song-slide-title")!.textContent).toBe("Moving On");
    expect(broken.q("song-slide-cover")!.querySelector("img")).toBeNull();
  });

  it("tones the cover until it loads", () => {
    const { q } = render();
    const frame = q("song-slide-cover")!.querySelector<HTMLElement>(".ff-async")!;
    expect(frame.dataset["load"]).toBe("pending");
    expect(frame.querySelector("img")!.getAttribute("src")).toBe("/assets/cover.movingOnLarge");
  });

  it("leaves a failed cover's plate on the cover's own navy, not the loading tone", () => {
    const { q } = render();
    expect(q("song-slide-cover")!.querySelector<HTMLElement>(".ff-async")!.dataset["tone"]).toBe("none");
  });

  it("draws a locked song as a silhouette with a padlock and its hint, and no equaliser", () => {
    const { q } = render({ item: { id: "unseen", label: "Unseen", state: "locked", art: "/assets/cover.unseenLarge", reason: "Save a replay" } });
    expect(q("song-slide")!.dataset["state"]).toBe("locked");
    expect(q("song-slide")!.textContent).toContain("🔒");
    expect(q("song-slide-hint")!.textContent).toBe("Save a replay");
    expect(q("equaliser")).toBeNull();
  });

  it("pills a DLC song", () => {
    const { q } = render({ item: { ...MOVING_ON, state: "dlc", reason: "DLC · Far pack" } });
    expect(q("song-slide")!.dataset["state"]).toBe("dlc");
    expect(q("song-slide")!.textContent).toContain("DLC");
  });

  it("is a quiet ? for Random, with no tempo", () => {
    const { q } = render({ item: { id: "?", label: "Random song", state: "open" } });
    expect(q("song-slide")!.textContent).toContain("?");
    expect(q("song-slide-bpm")).toBeNull();
    expect(q("equaliser")).toBeNull();
  });

  it("shows static bars under reduced motion", () => {
    const { q } = render({ live: false });
    expect(q("equaliser")!.dataset["static"]).toBe("true");
  });

  it("lifts its bars from the analyser's reading", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frame = run;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const bins = new Uint8Array(512);
    bins.fill(255, 0, 4); // loud below about 190 Hz
    const { q } = render({ spectrum: () => ({ bins, decibels: new Float32Array(512).fill(-Infinity), binHz: 46.875 }) });
    frame!(0);
    const levels = [...q("equaliser")!.children].map((bar) => Number((bar as HTMLElement).style.getPropertyValue("--ff-eq-level")));
    expect(levels[0]).toBe(1);
    expect(levels.at(-1)).toBeCloseTo(0.08);
  });

  it("an earned song wears NEW and flips in, or fades under reduced motion", () => {
    const { q, host } = render({ item: { ...MOVING_ON, isNew: true } });
    expect(q("song-slide-new")!.textContent).toBe("NEW");
    expect(host.querySelector<HTMLElement>("[data-testid=song-slide]")!.dataset["reveal"]).toBe("flip");
    unmount(component!);
    component = undefined;
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const again = render({ item: { ...MOVING_ON, isNew: true } });
    expect(again.host.querySelector<HTMLElement>("[data-testid=song-slide]")!.dataset["reveal"]).toBe("fade");
  });

  it("a song that is not new wears no pill", () => {
    const { q } = render();
    expect(q("song-slide-new")).toBeNull();
  });
});
