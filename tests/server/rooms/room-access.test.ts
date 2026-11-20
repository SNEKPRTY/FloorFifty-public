import { describe, expect, it } from "vitest";
import { asPlayerId } from "@floor-fifty/shared/common/ids";
import { openSets } from "@floor-fifty/shared/content/access";
import { GENERATED_CONTENT } from "../../../apps/server/src/content/generated-content";
import { AccessBook } from "../../../apps/server/src/rooms/room-access";

const content = GENERATED_CONTENT.content;
const OPEN = openSets(content);
const SEAT = asPlayerId("room-p1");

describe("a seat's access", () => {
  it("is the open set when the seat reports nothing", () => {
    const book = new AccessBook(content);
    expect(book.set(SEAT, undefined)).toEqual(OPEN);
    expect(book.of(asPlayerId("room-p2"))).toEqual(OPEN);
  });

  it("is the report cut to the catalog", () => {
    const access = new AccessBook(content).set(SEAT, { stages: ["snow-shrine", "nowhere"], songs: ["whats-next"], characters: ["ninja"] });
    expect(access).toEqual({ stages: ["snow-shrine"], songs: ["whats-next"], characters: ["ninja"] });
  });

  it("falls back to the open set for a kind the cut leaves empty, so every pick step has something to land on", () => {
    expect(OPEN.stages.length).toBeGreaterThan(0);
    expect(OPEN.songs.length).toBeGreaterThan(0);
    const book = new AccessBook(content);
    const access = book.set(SEAT, { stages: [], songs: ["nowhere"], characters: ["ninja"] });
    expect(access.stages).toEqual(OPEN.stages);
    expect(access.songs).toEqual(OPEN.songs);
    expect(access.characters).toEqual(["ninja"]);
    expect(book.of(SEAT)).toEqual(access);
  });
});
