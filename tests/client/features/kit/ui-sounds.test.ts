/**
 * The interface, heard: a control that takes focus ticks, a press confirms,
 * and a control that says what kind of press it is sounds that instead.
 */

import { afterEach, describe, expect, it } from "vitest";
import { installUiSounds, requestUiSound } from "../../../../apps/client/src/features/kit/ui-sounds";
import { FakeAudio } from "../../support/fakes/audio";

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
  document.body.innerHTML = "";
});

function setUp(markup: string): { root: HTMLElement; audio: FakeAudio; now: { value: number } } {
  const root = document.createElement("div");
  root.innerHTML = markup;
  document.body.append(root);
  const audio = new FakeAudio();
  const now = { value: 0 };
  release = installUiSounds(root, audio, () => now.value);
  return { root, audio, now };
}

const cues = (audio: FakeAudio) => audio.calls.filter((call) => call.startsWith("cue:"));

describe("pressing", () => {
  it("confirms an ordinary button", () => {
    const { root, audio } = setUp(`<button type="button">Play</button>`);
    root.querySelector("button")!.click();
    expect(cues(audio)).toEqual(["cue:ui.confirm:ui:"]);
  });

  it("sounds what a control declares: back, ready, or nothing", () => {
    const { root, audio } = setUp(`
      <button data-sfx="back">Back</button>
      <button data-sfx="ready">Ready</button>
      <button data-sfx="none">Quiet</button>`);
    for (const button of root.querySelectorAll("button")) button.click();
    expect(cues(audio)).toEqual(["cue:ui.back:ui:", "cue:ui.ready:ui:"]);
  });

  it("confirms a press on something inside a button, once", () => {
    const { root, audio } = setUp(`<button><span>Play</span></button>`);
    root.querySelector("span")!.click();
    expect(cues(audio)).toEqual(["cue:ui.confirm:ui:"]);
  });

  it("leaves a slider and plain text alone", () => {
    const { root, audio } = setUp(`<input type="range" /><p>words</p>`);
    root.querySelector("input")!.click();
    root.querySelector("p")!.click();
    expect(cues(audio)).toEqual([]);
  });
});

describe("focus", () => {
  it("ticks when the mouse moves onto a new control, not while it stays there", () => {
    const { root, audio, now } = setUp(`<button>A</button><button>B</button>`);
    const [a, b] = root.querySelectorAll("button");
    const over = (target: Element) =>
      target.dispatchEvent(Object.assign(new Event("pointerover", { bubbles: true }), { pointerType: "mouse" }));
    over(a!);
    now.value = 10;
    over(a!);
    now.value = 100;
    over(b!);
    expect(cues(audio)).toEqual(["cue:ui.hover:ui:", "cue:ui.hover:ui:"]);
  });

  it("does not tick for a finger, which taps rather than hovers", () => {
    const { root, audio } = setUp(`<button>A</button>`);
    root
      .querySelector("button")!
      .dispatchEvent(Object.assign(new Event("pointerover", { bubbles: true }), { pointerType: "touch" }));
    expect(cues(audio)).toEqual([]);
  });

  it("does not tick while a scroll slides controls under a still mouse", () => {
    const { root, audio, now } = setUp(`<button>A</button><button>B</button><button>C</button>`);
    const [a, b, c] = root.querySelectorAll("button");
    const over = (target: Element) =>
      target.dispatchEvent(Object.assign(new Event("pointerover", { bubbles: true }), { pointerType: "mouse" }));
    now.value = 1_000;
    root.dispatchEvent(new Event("wheel", { bubbles: true }));
    now.value = 1_050;
    over(a!);
    now.value = 1_150;
    root.dispatchEvent(new Event("scroll"));
    now.value = 1_200;
    over(b!);
    expect(cues(audio)).toEqual([]);
    // Once the page settles, moving onto a control is a choice again.
    now.value = 2_000;
    over(c!);
    expect(cues(audio)).toEqual(["cue:ui.hover:ui:"]);
  });

  it("ticks at most once a beat while focus runs through a list", () => {
    const { root, audio, now } = setUp(`<button>A</button><button>B</button><button>C</button>`);
    const [a, b, c] = root.querySelectorAll("button");
    const focus = (target: Element) => target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    now.value = 1_000;
    focus(a!);
    now.value = 1_030;
    focus(b!);
    now.value = 1_200;
    focus(c!);
    expect(cues(audio)).toEqual(["cue:ui.hover:ui:", "cue:ui.hover:ui:"]);
  });

  it("plays ui.tick through the same 90 ms gap, so a fast reveal never stacks ticks (polish spec §8.3)", () => {
    const { root, audio, now } = setUp(`<ol><li>1</li><li>2</li><li>3</li></ol>`);
    const [first, second, third] = root.querySelectorAll("li");
    now.value = 0;
    requestUiSound(first!, "tick");
    now.value = 50;
    requestUiSound(second!, "tick");
    now.value = 120;
    requestUiSound(third!, "tick");
    expect(cues(audio)).toEqual(["cue:ui.tick:ui:", "cue:ui.tick:ui:"]);
  });

  it("plays ui.unlock under the key it is given, so one grant is heard once however often its banner mounts", () => {
    const { root, audio } = setUp(`<div>NEW CHALLENGER</div>`);
    requestUiSound(root.querySelector("div")!, "unlock", "unlock:games-5");
    expect(cues(audio)).toEqual(["cue:ui.unlock:ui:unlock:games-5"]);
  });

  it("asks only for sounds the shipped manifest carries", async () => {
    const [{ readFileSync }, { resolve }] = await Promise.all([import("node:fs"), import("node:path")]);
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "packages/asset-contract/assets/art-manifest.json"), "utf8")) as {
      bundles: Record<string, { alias: string }[]>;
    };
    const shipped = new Set(Object.values(manifest.bundles).flat().map((row) => row.alias));
    const { root, audio, now } = setUp(`<div></div>`);
    const sounds = [
      "hover",
      "confirm",
      "back",
      "ready",
      "error",
      "open",
      "close",
      "tick",
      "copied",
      "unlock",
      "effectsSample",
      "voiceSample",
      "stamp",
    ] as const;
    for (const [index, sound] of sounds.entries()) {
      now.value = index * 1_000;
      requestUiSound(root.querySelector("div")!, sound);
    }
    const asked = cues(audio).map((call) => call.split(":")[1]!);
    expect(asked).toHaveLength(sounds.length);
    expect(asked.filter((alias) => !shipped.has(alias))).toEqual([]);
  });

  it("plays ui.copied when asked", () => {
    const { root, audio } = setUp(`<button data-sfx="none">Copy</button>`);
    requestUiSound(root.querySelector("button")!, "copied");
    expect(cues(audio)).toEqual(["cue:ui.copied:ui:"]);
  });

  it("ticks when a keyboard or a pad moves focus onto a control", () => {
    const { root, audio } = setUp(`<button>A</button>`);
    root.querySelector("button")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(cues(audio)).toEqual(["cue:ui.hover:ui:"]);
  });
});

describe("a volume's sample", () => {
  it("plays a landing on the effects bus and a call on the announcer's, so a slider is set by ear", () => {
    const { root, audio, now } = setUp(`<input type="range" />`);
    const slider = root.querySelector("input")!;
    requestUiSound(slider, "effectsSample");
    now.value = 1_000;
    requestUiSound(slider, "voiceSample");
    expect(cues(audio)).toEqual(["cue:sfx.landMid:effects:", "cue:vo.title:voice:"]);
  });

  it("plays one sample for a run of arrow presses, not a pile of calls", () => {
    const { root, audio, now } = setUp(`<input type="range" />`);
    const slider = root.querySelector("input")!;
    for (const at of [0, 100, 200, 300]) {
      now.value = at;
      requestUiSound(slider, "voiceSample");
    }
    now.value = 2_000;
    requestUiSound(slider, "voiceSample");
    expect(cues(audio)).toEqual(["cue:vo.title:voice:", "cue:vo.title:voice:"]);
  });
});

describe("a pitched request (A/V polish plan, G7)", () => {
  it("plays a request at the rate it asks for, and at the sound's own without one", () => {
    const root = document.createElement("div");
    root.innerHTML = `<ol><li>1</li><li>2</li></ol>`;
    document.body.append(root);
    const asked: { alias: string; rate: number | undefined }[] = [];
    let now = 0;
    release = installUiSounds(root, { cue: (alias, options) => void asked.push({ alias, rate: options.rate }) }, () => now);
    const [first, second] = root.querySelectorAll("li");
    requestUiSound(first!, "tick", undefined, 1.5);
    now = 1_000;
    requestUiSound(second!, "stamp");
    expect(asked).toEqual([
      { alias: "ui.tick", rate: 1.5 },
      { alias: "sfx.stamp", rate: undefined },
    ]);
  });
});

describe("requests from a component", () => {
  it("plays the sound a component asks for by event, such as an error appearing", () => {
    const { root, audio } = setUp(`<div role="alert"></div>`);
    requestUiSound(root.querySelector("div")!, "error");
    expect(cues(audio)).toEqual(["cue:ui.error:ui:"]);
  });

  it("stops listening once released", () => {
    const { root, audio } = setUp(`<button>A</button>`);
    release?.();
    release = undefined;
    root.querySelector("button")!.click();
    expect(cues(audio)).toEqual([]);
  });
});
