import { describe, expect, it } from "vitest";
import { FINISH_CUT_MS, MIN_LINE_MS, StoryTalk, type TalkLine } from "../../../../apps/client/src/features/story/story-talk";

const line = (text: string): TalkLine => ({ speaker: undefined, text });

describe("story talk", () => {
  it("drops the unshown lines of an older beat when a newer one fires", () => {
    const talk = new StoryTalk();
    talk.say([line("a1"), line("a2")]);
    expect(talk.update(0)?.text).toBe("a1");
    talk.say([line("b1")]);
    expect(talk.update(MIN_LINE_MS)?.text).toBe("b1");
  });

  it("keeps the waiting lines of a beat that teaches, ahead of the newer beat's", () => {
    const talk = new StoryTalk();
    talk.say([line("t1"), line("t2")], true);
    expect(talk.update(0)?.text).toBe("t1");
    talk.say([line("b1")]);
    expect(talk.update(MIN_LINE_MS)?.text).toBe("t2");
    expect(talk.update(MIN_LINE_MS * 2)?.text).toBe("b1");
    expect(talk.update(MIN_LINE_MS * 3)).toBeUndefined();
    expect(talk.idle).toBe(true);
  });

  it("at the goal drops every waiting line and cuts the one showing short, so the results come on time", () => {
    const talk = new StoryTalk();
    talk.say([line("old1"), line("old2")], true);
    expect(talk.update(0)?.text).toBe("old1");
    talk.finish(100);
    talk.say([line("goal")], true);
    expect(talk.update(100 + FINISH_CUT_MS - 1)?.text).toBe("old1");
    expect(talk.update(100 + FINISH_CUT_MS)?.text).toBe("goal");
    expect(talk.update(100 + FINISH_CUT_MS + MIN_LINE_MS)).toBeUndefined();
    expect(talk.idle).toBe(true);
  });
});
