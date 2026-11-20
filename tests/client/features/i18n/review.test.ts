// @vitest-environment node
import { describe, expect, it } from "vitest";
import { reviewHash, reviewState } from "../../../../tools/i18n/review";

describe("review state (languages spec §7.2)", () => {
  it("hashes EN and the translation together, so either changing lapses the review", () => {
    const hash = reviewHash("Play", "遊ぶ");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(reviewHash("Play!", "遊ぶ")).not.toBe(hash);
    expect(reviewHash("Play", "プレイ")).not.toBe(hash);
  });

  it("separates the two texts, so moving a character across the seam changes the hash", () => {
    expect(reviewHash("ab", "c")).not.toBe(reviewHash("a", "bc"));
  });

  it("counts a key reviewed only while its hash matches, and a missing translation as unreviewed", () => {
    const en = { a: "Play", b: "Quit", c: "Back" };
    const ja = { a: "遊ぶ", b: "終了" };
    expect(reviewState(en, ja, { a: reviewHash("Play", "遊ぶ"), b: "stale" })).toEqual({ reviewed: ["a"], unreviewed: ["b", "c"] });
  });
});
