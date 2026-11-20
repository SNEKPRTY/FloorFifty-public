import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../../deploy/tools/release-manifest";

describe("the release manifest", () => {
  it("hashes every file but itself, by POSIX path, in order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ff-manifest-"));
    mkdirSync(join(dir, "client"));
    writeFileSync(join(dir, "client/b.txt"), "b");
    writeFileSync(join(dir, "a.txt"), "a");
    writeFileSync(join(dir, "release.json"), "{}");

    const manifest = await buildManifest(dir, { buildId: "202609261200-aaaaaaa", environment: "staging", commit: "aaaaaaa" });

    expect(manifest).toEqual({
      buildId: "202609261200-aaaaaaa",
      environment: "staging",
      commit: "aaaaaaa",
      nodeVersion: process.version,
      files: {
        "a.txt": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
        "client/b.txt": "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
      },
    });
  });

  it("records a symlink by its target instead of following it", async () => {
    // `pnpm deploy` lays the server's node_modules out as links into its
    // store, and a link to a directory read as a file failed the first real
    // staging build with EISDIR.
    const dir = mkdtempSync(join(tmpdir(), "ff-manifest-"));
    mkdirSync(join(dir, "store/pkg"), { recursive: true });
    writeFileSync(join(dir, "store/pkg/index.js"), "x");
    mkdirSync(join(dir, "node_modules"));
    // A junction on Windows, where a directory symlink needs elevation.
    if (process.platform === "win32") symlinkSync(join(dir, "store/pkg"), join(dir, "node_modules/pkg"), "junction");
    else symlinkSync("../store/pkg", join(dir, "node_modules/pkg"));
    const target = readlinkSync(join(dir, "node_modules/pkg"));

    const manifest = await buildManifest(dir, { buildId: "202609261200-aaaaaaa", environment: "staging", commit: "aaaaaaa" });

    expect(manifest.files).toEqual({
      "node_modules/pkg": createHash("sha256").update(`symlink:${target}`).digest("hex"),
      "store/pkg/index.js": createHash("sha256").update("x").digest("hex"),
    });
  });
});
