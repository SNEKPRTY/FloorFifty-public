// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION_TAG } from "../../../apps/client/src/lib/version";

const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../apps/client/package.json"), "utf8")) as {
  version: string;
};

describe("the version tag", () => {
  it("is the client package's version, with a v", () => {
    expect(VERSION_TAG).toBe(`v${version}`);
    expect(VERSION_TAG).toMatch(/^v\d+\.\d+\.\d+(-rc\.\d+)?$/);
  });
});
