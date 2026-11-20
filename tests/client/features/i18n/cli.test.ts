// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runI18n } from "../../../../tools/i18n/cli";
import { parseCsv, toCsv } from "../../../../tools/i18n/csv";
import { reviewHash } from "../../../../tools/i18n/review";

// These tests copy and write temporary file trees. In the gate's CPU pod the disk stalled for more than the 5 s
// default now and then (2026-11-18, run 44413282784), though each takes 3 to 100 ms in a container; 30 s is a
// ceiling for a stalled disk, and a test that really hangs still fails.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let root: string;
let lines: string[];
const io = () => ({ root, now: () => new Date("2026-10-01T12:00:00Z"), log: (line: string) => lines.push(line) });
const json = async (path: string) => JSON.parse(await readFile(join(root, path), "utf8")) as Record<string, unknown>;

/** A small world: two UI keys, one content key, one plural, and a Japanese file with one of them. */
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "floor-fifty-i18n-"));
  lines = [];
  const messages = join(root, "apps/client/messages");
  await mkdir(join(messages, "ui"), { recursive: true });
  await mkdir(join(messages, "content"), { recursive: true });
  const schema = "https://inlang.com/schema/inlang-message-format";
  const plural = [{ declarations: ["input n", "local c = n: plural"], selectors: ["c"], match: { "c=one": "{n} lap", "c=*": "{n} laps" } }];
  await writeFile(join(messages, "ui/en.json"), JSON.stringify({ $schema: schema, title_play: "Play", race_laps: plural }));
  await writeFile(join(messages, "content/en.json"), JSON.stringify({ $schema: schema, content_stage_rooftops_name: "Rooftops" }));
  await writeFile(join(messages, "ui/ja.json"), JSON.stringify({ $schema: schema, title_play: "プレイ" }));
  await writeFile(
    join(messages, "context.json"),
    JSON.stringify({
      title_play: { note: "Title button", maxChars: 16 },
      race_laps: { note: "Lap count" },
      content_stage_rooftops_name: { note: "Stage name", screenshot: "docs/i18n/screens/en/select.png" },
    }),
  );
});

describe("pnpm i18n:* (languages spec §7.3)", () => {
  it("draft lists the keys a locale lacks, and writes nothing", async () => {
    const before = await readFile(join(root, "apps/client/messages/ui/ja.json"), "utf8");
    expect(await runI18n(["draft", "ja"], io())).toBe(0);
    expect(lines.join("\n")).toContain("content_stage_rooftops_name");
    expect(lines.join("\n")).toContain("race_laps");
    expect(lines.join("\n")).not.toContain("title_play\n");
    expect(await readFile(join(root, "apps/client/messages/ui/ja.json"), "utf8")).toBe(before);
  });

  it("export writes one row per EN key with the reviewer's columns and an empty approved column", async () => {
    expect(await runI18n(["export", "ja"], io())).toBe(0);
    const rows = parseCsv(await readFile(join(root, "docs/i18n/review/ja.csv"), "utf8"));
    expect(rows[0]).toEqual(["key", "en", "translation", "note", "maxChars", "screenshot", "approved"]);
    const byKey = new Map(rows.slice(1).map((row) => [row[0], row]));
    expect([...byKey.keys()].sort()).toEqual(["content_stage_rooftops_name", "race_laps", "title_play"]);
    expect(byKey.get("title_play")).toEqual(["title_play", "Play", "プレイ", "Title button", "16", "", ""]);
    expect(byKey.get("content_stage_rooftops_name")?.[5]).toBe("docs/i18n/screens/en/select.png");
  });

  it("import applies corrections to the right file, records approved rows, and logs the evidence", async () => {
    const csv = toCsv([
      ["key", "en", "translation", "note", "maxChars", "screenshot", "approved"],
      ["title_play", "Play", "遊ぶ", "", "", "", "yes"],
      ["content_stage_rooftops_name", "Rooftops", "屋上", "", "", "", ""],
    ]);
    await writeFile(join(root, "ja.csv"), csv);
    expect(await runI18n(["import", "ja", join(root, "ja.csv"), "--reviewer", "Aiko"], io())).toBe(0);

    expect((await json("apps/client/messages/ui/ja.json"))["title_play"]).toBe("遊ぶ");
    expect((await json("apps/client/messages/content/ja.json"))["content_stage_rooftops_name"]).toBe("屋上");
    const review = await json("apps/client/messages/review/ja.json");
    expect(review).toEqual({ title_play: reviewHash("Play", "遊ぶ") });
    expect(await readFile(join(root, "docs/i18n/reviews.md"), "utf8")).toContain("| 2026-10-01 | ja | Aiko | 1 approved |");
  });

  it("import refuses a row whose key is not an EN key, and writes nothing", async () => {
    const csv = toCsv([
      ["key", "en", "translation", "note", "maxChars", "screenshot", "approved"],
      ["title_play", "Play", "遊ぶ", "", "", "", "yes"],
      ["no_such_key", "", "x", "", "", "", "yes"],
    ]);
    await writeFile(join(root, "bad.csv"), csv);
    expect(await runI18n(["import", "ja", join(root, "bad.csv"), "--reviewer", "Aiko"], io())).toBe(2);
    expect((await json("apps/client/messages/ui/ja.json"))["title_play"]).toBe("プレイ");
  });

  it("check fails a locale that lacks keys, passes complete unreviewed drafts, and --release refuses them by name", async () => {
    expect(await runI18n(["check"], io())).toBe(1);
    expect(lines.join("\n")).toContain("ja race_laps: missing");

    const plural = [{ declarations: ["input n", "local c = n: plural"], selectors: ["c"], match: { "c=*": "{n}周" } }];
    await writeFile(join(root, "apps/client/messages/ui/ja.json"), JSON.stringify({ title_play: "プレイ", race_laps: plural }));
    await writeFile(join(root, "apps/client/messages/content/ja.json"), JSON.stringify({ content_stage_rooftops_name: "屋上" }));
    await cp(join(root, "apps/client/messages/ui/en.json"), join(root, "apps/client/messages/ui/ko.json"));
    await cp(join(root, "apps/client/messages/content/en.json"), join(root, "apps/client/messages/content/ko.json"));
    lines = [];
    expect(await runI18n(["check"], io())).toBe(0);
    lines = [];
    expect(await runI18n(["check", "--release"], io())).toBe(1);
    expect(lines.join("\n")).toMatch(/ja: \d+ unreviewed/);
    expect(lines.join("\n")).toContain("title_play");
  });

  it("refuses en as a target, and an unknown command", async () => {
    expect(await runI18n(["draft", "en"], io())).toBe(2);
    expect(await runI18n(["translate", "ja"], io())).toBe(2);
  });
});
