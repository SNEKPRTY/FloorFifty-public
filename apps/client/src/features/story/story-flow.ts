/**
 * The story's order of things (story mode v2 spec, "Screens"), as one small
 * state machine the screen follows: the hub (chapter select); a chapter's
 * cutscene, then its climb (which opens on the chapter card), then its
 * results, then the next chapter's cutscene; after the last chapter's
 * results, the ending's cutscene, then the finale: the thesis card, the
 * credits and Frog's last line.
 *
 * The ways off this path are the player's buttons, and each names its step:
 * "Again" on the results is `{ kind: "climb" }` of the same chapter, and
 * "Chapters", Leave story and the finale's "Chapters" are `{ kind: "hub" }`.
 */

export type FlowStep =
  /** The chapter select, its focus on `focus`. */
  | { readonly kind: "hub"; readonly focus: number }
  | { readonly kind: "cutscene"; readonly cutscene: string; readonly chapter: number }
  | { readonly kind: "climb"; readonly chapter: number }
  | { readonly kind: "results"; readonly chapter: number }
  | { readonly kind: "ending"; readonly cutscene: string }
  /** The thesis card, the credits and Frog's last line. */
  | { readonly kind: "finale" };

export type FlowStory = {
  readonly chapters: readonly { readonly before: string }[];
  readonly ending: { readonly cutscene: string };
};

/** Where playing chapter `chapter` starts: its cutscene. */
export function startOf(story: FlowStory, chapter: number): FlowStep {
  return { kind: "cutscene", cutscene: story.chapters[chapter]!.before, chapter };
}

/** The step after `step` on the story's own path ("Play", "Next", a cutscene's end), or undefined after the last. */
export function after(story: FlowStory, step: FlowStep): FlowStep | undefined {
  switch (step.kind) {
    case "hub":
      return startOf(story, step.focus);
    case "cutscene":
      return { kind: "climb", chapter: step.chapter };
    case "climb":
      return { kind: "results", chapter: step.chapter };
    case "results":
      return step.chapter + 1 < story.chapters.length ? startOf(story, step.chapter + 1) : { kind: "ending", cutscene: story.ending.cutscene };
    case "ending":
      return { kind: "finale" };
    case "finale":
      return undefined;
  }
}
