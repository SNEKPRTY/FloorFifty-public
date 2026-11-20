import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { accessRuleOf, accessibleSets, intersectAccess, openSets, packOf } from "@floor-fifty/shared/content/access";
import { parseGameContentArtifact } from "@floor-fifty/shared/content/game-content";

const { content } = parseGameContentArtifact(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../content/generated/content.json"), "utf8")),
);

describe("access", () => {
  it("files every character in exactly one pack", () => {
    for (const character of content.characters) expect(packOf(content, "character", character.id)).toBeDefined();
  });

  it("opens the ninja, locks everything else outside After Hours behind play, and sells After Hours", () => {
    expect(accessRuleOf(content, "character", "ninja")).toEqual({ kind: "open" });
    expect(accessRuleOf(content, "character", "frog")).toMatchObject({ kind: "unlock", condition: { id: "games-5", goal: 5 } });
    expect(accessRuleOf(content, "character", "diver")).toMatchObject({ kind: "unlock", condition: { id: "games-8" } });
    expect(accessRuleOf(content, "character", "robo")).toMatchObject({ kind: "unlock", condition: { id: "games-7" } });
    expect(accessRuleOf(content, "character", "kitsune")).toMatchObject({ kind: "unlock", condition: { id: "games-10" } });
    for (const id of ["penguin", "oni", "witch", "knight"])
      expect(accessRuleOf(content, "character", id), id).toMatchObject({ kind: "dlc", pack: { id: "after-hours" } });
  });

  it("puts nothing but After Hours behind a purchase", () => {
    expect(content.packs.filter((pack) => pack.dlc).map((pack) => pack.id)).toEqual(["after-hours"]);
    for (const kind of ["stage", "song", "character"] as const)
      for (const item of content[`${kind}s`])
        if (packOf(content, kind, item.id)?.id !== "after-hours")
          expect(accessRuleOf(content, kind, item.id)?.kind, `${kind} ${item.id}`).not.toBe("dlc");
  });

  it("gives nothing beyond the open set when nothing is granted", () => {
    const open = openSets(content);
    expect(open.characters).toEqual(["ninja"]);
    expect(open.stages).toContain("rooftops");
    expect(open.songs).toContain("chrome-in-the-rain");
  });

  it("grants unlocked and owned items, in catalog order", () => {
    const all = accessibleSets(content, { unlocked: () => true, owns: () => true });
    expect(all.characters).toEqual(content.characters.map((character) => character.id));
  });

  it("drops IDs the catalog does not know and keeps catalog order", () => {
    const report = { stages: ["nowhere", "rooftops"], songs: [], characters: ["robo", "ninja", "ghost"] };
    expect(intersectAccess(content, report)).toEqual({ stages: ["rooftops"], songs: [], characters: ["ninja", "robo"] });
  });
});
