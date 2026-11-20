import { describe, expect, it } from "vitest";
import { nextStep, pickKindOf, PICK_STEP, REVEAL_STEP, STEP_ORDER, type SelectStep } from "@floor-fifty/shared/room/select";

describe("the select steps", () => {
  it("walk stage, its reveal, song, its reveal, then loading", () => {
    expect(STEP_ORDER).toEqual(["stage", "stageReveal", "song", "songReveal", "loading"]);
  });

  it("each lead to the next, and loading leads to the countdown, which is not a select step", () => {
    const walked: SelectStep[] = [];
    let step: SelectStep | undefined = "stage";
    while (step !== undefined) {
      walked.push(step);
      step = nextStep(step);
    }
    expect(walked).toEqual([...STEP_ORDER]);
    expect(nextStep("loading")).toBeUndefined();
  });

  it("collect a pick only in the pick steps", () => {
    expect(pickKindOf("stage")).toBe("stage");
    expect(pickKindOf("song")).toBe("song");
    expect(pickKindOf("stageReveal")).toBeUndefined();
    expect(pickKindOf("songReveal")).toBeUndefined();
    expect(pickKindOf("loading")).toBeUndefined();
  });

  it("reveal each kind straight after its pick step", () => {
    for (const kind of ["stage", "song"] as const) {
      expect(pickKindOf(PICK_STEP[kind])).toBe(kind);
      expect(nextStep(PICK_STEP[kind])).toBe(REVEAL_STEP[kind]);
    }
  });
});
