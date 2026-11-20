// @vitest-environment node
import { describe, expect, it } from "vitest";
import { startBarFade, stepBarFade } from "../../../../apps/client/src/features/platform/bar-fade";

describe("the bars' fade", () => {
  it("walks from where the bars are to where they are headed, and says when it is done", () => {
    let fade = startBarFade(1, 0, 900);
    let step = stepBarFade(fade, 450);
    expect(step.value).toBeCloseTo(0.5);
    expect(step.done).toBe(false);
    fade = step.fade;
    step = stepBarFade(fade, 450);
    expect(step.value).toBe(0);
    expect(step.done).toBe(true);
  });

  it("never overshoots on a long frame", () => {
    const step = stepBarFade(startBarFade(0, 1, 900), 5000);
    expect(step.value).toBe(1);
    expect(step.done).toBe(true);
  });
});
