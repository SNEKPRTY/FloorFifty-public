/**
 * Canonical bytes.
 *
 * The generated file is committed, so two people running the compiler on the
 * same content must produce the same bytes. These tests pin the ways a tree
 * can differ on disk without differing in meaning: file order, key order,
 * declaration order, line endings, and drafts.
 */

import { describe, expect, it } from "vitest";
import { canonicalizeValue, buildPayload, serializeArtifact } from "@floor-fifty/content/canonicalize";
import { artifactFrom, changedDraftParsed, parsedWithRouteDeclarationOrder, validParsed } from "./support";

describe("canonicalizeValue", () => {
  it("sorts keys recursively, keeps array order, and ends with one newline", () => {
    const { json } = canonicalizeValue({ b: 1, a: { d: [3, 1, 2], c: 4 } });
    expect(json).toBe('{\n  "a": {\n    "c": 4,\n    "d": [\n      3,\n      1,\n      2\n    ]\n  },\n  "b": 1\n}\n');
  });

  it("encodes the bytes it printed", () => {
    const canonical = canonicalizeValue({ a: 1 });
    expect(new TextDecoder().decode(canonical.bytes)).toBe(canonical.json);
  });
});

describe("equivalent trees", () => {
  it("emits byte-identical artifacts from equivalent TOML trees", async () => {
    const [a, b] = await Promise.all([artifactFrom("equivalent-a"), artifactFrom("equivalent-b")]);
    expect(serializeArtifact(b).bytes).toEqual(serializeArtifact(a).bytes);
  });
});

describe("buildPayload", () => {
  it("omits drafts, so editing one changes nothing", () => {
    expect(buildPayload(changedDraftParsed())).toEqual(buildPayload(validParsed()));
  });

  it("emits only catalogued items, in catalog order", () => {
    const built = buildPayload(validParsed());
    expect(built.characters.map((character) => character.id)).toEqual([
      "scarlet",
      "cyan",
      "gold",
      "violet",
    ]);
    expect(built.modes).toEqual([]);
  });

  it("uses explicit route order rather than TOML declaration order", () => {
    expect(buildPayload(parsedWithRouteDeclarationOrder([20, 10])).presentation.routing.routes).toEqual(
      buildPayload(parsedWithRouteDeclarationOrder([10, 20])).presentation.routing.routes,
    );
  });

  it("sorts flow transitions by from, event, then destination", () => {
    const { transitions } = buildPayload(validParsed()).presentation.flow;
    const keys = transitions.map((transition) => `${transition.from}.${transition.event}`);
    expect(keys).toEqual([...keys].sort());
  });
});
