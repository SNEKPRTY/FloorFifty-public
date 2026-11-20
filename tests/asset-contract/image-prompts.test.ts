/**
 * The generated-art prompt table (launch polish spec §2.8).
 *
 * Every new raster is generated with one model, on one chroma key, from a
 * prompt committed here -- so a source can be regenerated, and the phase 6
 * artist can see exactly what each placeholder was asked to be.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IMAGE_MODEL,
  IMAGE_PROMPTS,
  KEPT_PROMPTS,
  readApiKey,
  requestBody,
} from "../../packages/asset-contract/tools/image-prompts";

const SOURCE = resolve(process.cwd(), "packages/asset-contract/assets/source");

describe("the generated-art prompt table", () => {
  it("generates everything with gpt-image-2.5-flare, keyed on magenta unless it fills its frame", () => {
    expect(IMAGE_MODEL).toBe("gpt-image-2.5-flare");
    for (const prompt of IMAGE_PROMPTS) {
      if (prompt.fullFrame === true) expect(prompt.prompt, prompt.name).not.toMatch(/magenta/);
      else expect(prompt.prompt, prompt.name).toMatch(/flat pure magenta #FF00FF/);
      expect(requestBody(prompt)).toEqual({ model: IMAGE_MODEL, prompt: prompt.prompt, size: prompt.size, n: 1 });
    }
  });

  it("names every source the conversion tasks read, once", () => {
    const files = IMAGE_PROMPTS.map((prompt) => prompt.file).sort();
    expect(files).toEqual(
      [
        "city-mid-spires.png", "city-near-dense.png", "clouds-streaks.png",
        "dawn-mist.png", "dawn-near.png", "dawn-sky.png", "menu-city.png", "menu-facade.png",
        "menu-ledge.png", "menu-sky-clear.png", "menu-sky.png", "portrait-sheet.png", "rooftop-props.png", "sun-low.png",
        "rooftops-horizon.png", "rooftops-sky.png",
        "racer-climbs-diver.png", "racer-climbs-frog.png", "racer-climbs-kitsune.png", "racer-climbs-robo.png",
        "racer-climbs-penguin.png", "racer-climbs-oni.png", "racer-climbs-witch.png", "racer-climbs-knight.png",
        "snow-shrine-details.png", "snow-shrine-far.png", "snow-shrine-mid.png", "snow-shrine-near.png", "snow-shrine-platform.png", "snow-shrine-sky.png",
        "sunken-dome-details.png", "sunken-dome-far.png", "sunken-dome-fish.png", "sunken-dome-mantas.png",
        "sunken-dome-mid.png", "sunken-dome-near.png", "sunken-dome-platform.png", "sunken-dome-sky.png",
      ].sort(),
    );
    expect(new Set(IMAGE_PROMPTS.map((prompt) => prompt.name)).size).toBe(IMAGE_PROMPTS.length);
  });

  it("draws a referenced prompt as an edit of a committed source that no prompt overwrites", () => {
    const referenced = IMAGE_PROMPTS.filter((prompt) => prompt.reference !== undefined);
    expect(referenced.map((prompt) => prompt.name).sort()).toEqual([
      "clouds", "dawn-mist", "dawn-sky", "racer-climbs-diver", "racer-climbs-frog", "racer-climbs-kitsune",
      "racer-climbs-knight", "racer-climbs-oni", "racer-climbs-penguin", "racer-climbs-robo", "racer-climbs-witch",
      "rooftops-horizon", "rooftops-sky",
      "snow-shrine-details", "snow-shrine-far", "snow-shrine-mid", "snow-shrine-near", "snow-shrine-platform", "snow-shrine-sky",
      "sunken-dome-details", "sunken-dome-mid", "sunken-dome-near", "sunken-dome-platform", "sunken-dome-sky",
    ]);
    for (const prompt of referenced) {
      expect(existsSync(resolve(SOURCE, prompt.reference!)), prompt.name).toBe(true);
      expect(IMAGE_PROMPTS.map((each) => each.file)).not.toContain(prompt.reference);
    }
  });

  it("records what the kept characters' pose and bust sheets were asked for, without queueing them", () => {
    // Kept as files (the first four from the archived select branch, the After
    // Hours four from their pack): regenerating a pose sheet would redraw what
    // its climbs edit.
    const files = KEPT_PROMPTS.map((prompt) => prompt.file).sort();
    expect(files).toEqual(
      ["diver", "frog", "kitsune", "robo", "penguin", "oni", "witch", "knight"].flatMap((id) => [`portrait-sheet-${id}.png`, `racer-sheet-${id}.png`]).sort(),
    );
    for (const prompt of KEPT_PROMPTS) {
      expect(existsSync(resolve(SOURCE, prompt.file)), prompt.name).toBe(true);
      expect(prompt.prompt, prompt.name).toMatch(/flat pure magenta #FF00FF/);
      expect(IMAGE_PROMPTS.map((each) => each.file)).not.toContain(prompt.file);
    }
  });

  it("reads the key from the environment first, then the env file, and never invents one", () => {
    expect(readApiKey({ OPENAI_API_KEY: "sk-env" }, "OPENAI_API_KEY=sk-file")).toBe("sk-env");
    expect(readApiKey({}, 'OTHER=1\nOPENAI_API_KEY="sk-file"\n')).toBe("sk-file");
    expect(readApiKey({}, undefined)).toBeUndefined();
  });
});
