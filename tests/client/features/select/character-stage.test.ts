import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import CharacterStage from "../../../../apps/client/src/features/select/CharacterStage.svelte";

let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (component !== undefined) unmount(component);
  component = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render(props: Partial<Record<string, unknown>> = {}) {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  component = mount(CharacterStage, { target: host, props: { sheet: "/assets/frog.scarlet", scale: 4, ...props } });
  flushSync();
  const sprite = () => host.querySelector<HTMLElement>("[data-testid=stage-sprite]");
  const later = (ms: number) => {
    vi.advanceTimersByTime(ms);
    flushSync();
  };
  return { host, sprite, later };
}

describe("CharacterStage", () => {
  it("idles on its sheet, drawn at its scale", () => {
    const { sprite, later } = render();
    expect(sprite()!.dataset["frame"]).toBe("0:0");
    expect(sprite()!.style.backgroundImage).toContain("/assets/frog.scarlet");
    expect(sprite()!.style.backgroundSize).toBe("512px 896px");
    later(450);
    expect(sprite()!.dataset["frame"]).toBe("0:1");
    later(450);
    expect(sprite()!.dataset["frame"]).toBe("0:0");
  });

  it("drops in on a cue: falls, lands with dust, then idles", () => {
    const { host, sprite, later } = render({ cue: 1, move: "drop" });
    expect(sprite()!.dataset["frame"]).toBe("3:0");
    expect(sprite()!.style.backgroundPosition).toBe("0px -384px");
    later(170);
    expect(sprite()!.dataset["frame"]).toBe("4:0");
    expect(host.querySelector("[data-testid=stage-dust]")).not.toBeNull();
    later(180);
    expect(sprite()!.dataset["frame"]).toBe("0:0");
    expect(host.querySelector("[data-testid=stage-dust]")).toBeNull();
  });

  it("holds on idle's first frame when held, dimmed or grey", () => {
    const { host, sprite, later } = render({ held: true, tone: "dimmed" });
    later(2000);
    expect(sprite()!.dataset["frame"]).toBe("0:0");
    expect(host.querySelector<HTMLElement>("[data-testid=character-stage]")!.dataset["tone"]).toBe("dimmed");
  });

  it("cuts with reduced motion, and keeps idling", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { sprite, later } = render({ cue: 1, move: "hop" });
    expect(sprite()!.dataset["frame"]).toBe("0:0");
    later(450);
    expect(sprite()!.dataset["frame"]).toBe("0:1");
  });

  it("draws a sheet whose request drops again from its retry", () => {
    const probes: HTMLImageElement[] = [];
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        onerror: (() => void) | null = null;
        constructor() {
          probes.push(this as unknown as HTMLImageElement);
        }
      },
    );
    const { sprite, later } = render({ sheet: "/assets/production/frog-scarlet.png" });
    expect(probes[0]!.src).toBe("/assets/production/frog-scarlet.png");
    probes[0]!.onerror!(new Event("error"));
    later(249);
    expect(sprite()!.style.backgroundImage).not.toContain("retry");
    later(1);
    expect(sprite()!.style.backgroundImage).toContain("/assets/production/frog-scarlet.png?retry=1");
    expect(probes[1]!.src).toBe("/assets/production/frog-scarlet.png?retry=1");
  });

  it("draws ? for Random, and no sprite", () => {
    const { host, sprite } = render({ random: true });
    expect(sprite()).toBeNull();
    expect(host.querySelector("[data-testid=stage-random]")!.textContent).toBe("?");
  });
});
