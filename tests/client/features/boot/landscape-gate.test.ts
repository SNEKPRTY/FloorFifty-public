/**
 * The landscape gate: a phone held sideways plays fullscreen, or is told how.
 */

import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import LandscapeGate from "../../../../apps/client/src/features/boot/LandscapeGate.svelte";
import { landscapeGate, type GateInputs } from "../../../../apps/client/src/features/boot/landscape-gate";
import { setReducedMotion } from "../../support/motion";
import { formFactor } from "../../../../apps/client/src/features/platform/viewport-tracking.svelte";

const phone: GateInputs = { formFactor: "phone-landscape", coarse: true, support: "element", fullscreen: false, installed: false };

describe("landscapeGate", () => {
  it("asks a sideways phone to go fullscreen", () => {
    expect(landscapeGate(phone)).toBe("fullscreen");
  });

  it("opens once fullscreen", () => {
    expect(landscapeGate({ ...phone, fullscreen: true })).toBe("none");
  });

  it("sends a sideways iPhone in Safari upright or to the Home Screen", () => {
    expect(landscapeGate({ ...phone, support: "ios-home-screen" })).toBe("rotate-or-install");
  });

  it("leaves an installed app alone", () => {
    expect(landscapeGate({ ...phone, installed: true })).toBe("none");
    expect(landscapeGate({ ...phone, support: "none" })).toBe("none");
  });

  it("leaves a short desktop window alone", () => {
    expect(landscapeGate({ ...phone, coarse: false })).toBe("none");
  });

  it("leaves every other form factor alone", () => {
    for (const other of ["phone-portrait", "tablet-portrait", "desktop"] as const) {
      expect(landscapeGate({ ...phone, formFactor: other })).toBe("none");
    }
  });
});

describe("LandscapeGate", () => {
  // The cover is a kit panel that falls out as it opens; these tests ask whether it is gone, so it leaves at once.
  beforeEach(() => setReducedMotion(true));

  let component: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (component !== undefined) unmount(component);
    component = undefined;
    formFactor.current = "desktop";
  });

  const media = (coarse: boolean) => (query: string) =>
    ({
      matches: query === "(pointer: coarse)" ? coarse : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;

  it("covers a sideways phone and follows the form factor", () => {
    formFactor.current = "phone-landscape";
    component = mount(LandscapeGate, { target: document.body, props: { support: "element", media: media(true) } });
    flushSync();
    const gate = document.querySelector<HTMLElement>("[data-testid='landscape-gate']");
    expect(gate?.dataset["gate"]).toBe("fullscreen");
    expect(document.activeElement?.getAttribute("data-testid")).toBe("landscape-gate-fullscreen");

    formFactor.current = "phone-portrait";
    flushSync();
    expect(document.querySelector("[data-testid='landscape-gate']")).toBeNull();
  });

  it("tells an iPhone how to play sideways, with nothing to press", () => {
    formFactor.current = "phone-landscape";
    component = mount(LandscapeGate, { target: document.body, props: { support: "ios-home-screen", media: media(true) } });
    flushSync();
    expect(document.querySelector<HTMLElement>("[data-testid='landscape-gate']")?.dataset["gate"]).toBe("rotate-or-install");
    expect(document.querySelector("[data-testid='landscape-gate-fullscreen']")).toBeNull();
  });

  it("shows the turn and the three Home Screen steps", () => {
    formFactor.current = "phone-landscape";
    component = mount(LandscapeGate, { target: document.body, props: { support: "ios-home-screen", media: media(true) } });
    flushSync();
    const gate = document.querySelector<HTMLElement>("[data-testid='landscape-gate']")!;
    expect(gate.querySelector("[data-testid='landscape-gate-phone']")).not.toBeNull();
    expect(gate.querySelector("h2")?.textContent).toBe("Turn your phone upright");
    const steps = [...gate.querySelectorAll("ol > li")].map((li) => li.textContent?.trim());
    expect(steps).toEqual(["Tap Share.", "Tap “Add to Home Screen”.", "Open Floor Fifty from your Home Screen."]);
  });

  it("says the Home Screen steps are the other way to play sideways, so they match the title", () => {
    // The walk of 2026-11-19 (review R34): "Turn your phone upright" stood straight over three
    // Home Screen steps, as if the steps were how to turn the phone.
    formFactor.current = "phone-landscape";
    component = mount(LandscapeGate, { target: document.body, props: { support: "ios-home-screen", media: media(true) } });
    flushSync();
    const lead = document.querySelector("[data-testid='landscape-gate-home-lead']");
    expect(lead?.textContent?.trim()).toBe("Or, to play sideways, add it to your Home Screen:");
    expect(lead?.nextElementSibling?.tagName).toBe("OL");
  });

  it("stays out of the way of a mouse", () => {
    formFactor.current = "phone-landscape";
    component = mount(LandscapeGate, { target: document.body, props: { support: "element", media: media(false) } });
    flushSync();
    expect(document.querySelector("[data-testid='landscape-gate']")).toBeNull();
  });
});
