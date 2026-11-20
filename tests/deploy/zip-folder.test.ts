import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { zipFolder } from "../../deploy/tools/zip-folder";

// Ruken's pack used to call the `zip` program, which Git for Windows does not have, so the Windows runner
// could not pack the game (Ruken M1.7d). zipFolder writes the same kind of zip in Node. `unzip` (the program,
// as on the Mac and Ubuntu) is the independent reader that proves the bytes are a real zip.
describe("zipFolder", () => {
  const folder = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "ff-zip-folder-"));
    mkdirSync(join(dir, "assets/img"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<!doctype html>");
    writeFileSync(join(dir, "assets/app.js"), "console.log(1)\n".repeat(5000)); // compresses well
    writeFileSync(join(dir, "assets/img/noise.bin"), randomBytes(70_000)); // does not compress
    writeFileSync(join(dir, "empty.txt"), "");
    writeFileSync(join(dir, "assets/Ünï.txt"), "non-ASCII name");
    return dir;
  };
  /** A path for a zip in a folder of its own, so a zip is never inside the folder it packs. */
  const zipPath = (name: string): string => join(mkdtempSync(join(tmpdir(), "ff-zip-out-")), name);
  const unzip = (...args: string[]): string => execFileSync("unzip", args, { encoding: "utf8" });

  it("lists every file once by its relative path with forward slashes, in order, and no folders", () => {
    const dir = folder();
    const out = zipPath("out.zip");
    zipFolder(dir, out);
    const listing = unzip("-Z1", out).split("\n").filter(Boolean);
    expect(listing).toEqual(["assets/app.js", "assets/img/noise.bin", "assets/Ünï.txt", "empty.txt", "index.html"]);
  });

  it("reads back to the same bytes, for text, noise, an empty file and a non-ASCII name", () => {
    const dir = folder();
    const out = zipPath("out.zip");
    zipFolder(dir, out);
    expect(unzip("-t", out)).toContain("No errors detected");
    for (const path of ["assets/app.js", "assets/img/noise.bin", "assets/Ünï.txt", "empty.txt", "index.html"]) {
      const stored = execFileSync("unzip", ["-p", out, path]);
      expect(stored.equals(readFileSync(join(dir, path))), path).toBe(true);
    }
  });

  it("compresses what shrinks and stores what does not", () => {
    const dir = folder();
    const out = zipPath("out.zip");
    zipFolder(dir, out);
    const methods = Object.fromEntries(
      unzip("-v", out)
        .split("\n")
        .map((line) => /^\s*\d+\s+(\S+)\s+\d+\s+-?\d+%\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(line))
        .filter((match) => match !== null)
        .map((match) => [match[2], match[1]]),
    );
    expect(methods["assets/app.js"]).toBe("Defl:N");
    expect(methods["assets/img/noise.bin"]).toBe("Stored");
  });

  // The same files always give the same zip, so a cached build is the build that was cached: the clock and the
  // order the disk lists files in do not reach the bytes.
  it("writes the same bytes whatever the files' timestamps", () => {
    const dir = folder();
    const [a, b] = [zipPath("a.zip"), zipPath("b.zip")];
    zipFolder(dir, a);
    utimesSync(join(dir, "index.html"), new Date(2001, 1, 1), new Date(2001, 1, 1));
    zipFolder(dir, b);
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
  });

  it("replaces a zip that is already there", () => {
    const dir = folder();
    const out = zipPath("replace.zip");
    writeFileSync(out, "not a zip");
    zipFolder(dir, out);
    expect(unzip("-t", out)).toContain("No errors detected");
  });

  it("refuses a symbolic link instead of leaving it out or following it", () => {
    const dir = folder();
    symlinkSync("index.html", join(dir, "link.html"));
    expect(() => zipFolder(dir, zipPath("link.zip"))).toThrow(/link\.html/);
  });
});
