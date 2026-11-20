// @vitest-environment node
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALE_TAGS } from "../../../../apps/client/src/features/i18n/locales";
import { runI18n } from "../../../../tools/i18n/cli";
import { columnsOf, rankLocales } from "../../../../tools/i18n/lengths";

const plural = [{ declarations: ["input n", "local c = n: plural"], selectors: ["c"], match: { "c=one": "{n} lap", "c=*": "{n} laps" } }];

describe("the locales ranked by how much text they show (tools/i18n/lengths.ts)", () => {
  it("counts wide characters as two columns and everything else as one", () => {
    expect(columnsOf("Play")).toBe(4);
    expect(columnsOf("プレイ")).toBe(6);
    expect(columnsOf("简体中文 ok")).toBe(11);
  });

  it("ranks the locale with the most characters first, and says where each is widest", () => {
    const ranking = rankLocales({
      en: { title_play: "Play", race_laps: plural },
      "es-419": { title_play: "Jugar ahora", race_laps: plural },
      ja: { title_play: "プレイ", race_laps: plural },
    });
    expect(ranking.map((row) => row.locale)).toEqual(["es-419", "en", "ja"]);
    const spanish = ranking[0]!;
    // Two keys; the plural counts both its variants, "{n} lap" and "{n} laps".
    expect(spanish).toMatchObject({ keys: 2, strings: 3, characters: 11 + 7 + 8, widest: { key: "title_play", characters: 11 } });
    expect(spanish.widestOn).toBe(1);
  });

  it("ranks by columns when asked, where a wide script weighs more", () => {
    const catalogues = { en: { a: "abcdef" }, ja: { a: "あいうえ" } } as const;
    expect(rankLocales(catalogues).map((row) => row.locale)).toEqual(["en", "ja"]);
    expect(rankLocales(catalogues, "columns").map((row) => row.locale)).toEqual(["ja", "en"]);
  });

  it("is `pnpm i18n:lengths`: the table, and with --longest only the tag the walk takes", async () => {
    const root = await mkdtemp(join(tmpdir(), "floor-fifty-lengths-"));
    const messages = join(root, "apps/client/messages");
    await mkdir(join(messages, "ui"), { recursive: true });
    await mkdir(join(messages, "content"), { recursive: true });
    await writeFile(join(messages, "ui/en.json"), JSON.stringify({ title_play: "Play" }));
    await writeFile(join(messages, "ui/pt-BR.json"), JSON.stringify({ title_play: "Jogar agora mesmo" }));
    const lines: string[] = [];
    const io = { root, now: () => new Date("2026-11-14T12:00:00Z"), log: (line: string) => lines.push(line) };

    expect(await runI18n(["lengths"], io)).toBe(0);
    expect(lines.join("\n")).toMatch(/pt-BR\s+17/);
    lines.length = 0;
    expect(await runI18n(["lengths", "--longest"], io)).toBe(0);
    expect(lines).toEqual(["pt-BR"]);
    lines.length = 0;
    expect(await runI18n(["lengths", "--by", "sideways"], io)).toBe(2);
  });

  // The ranking the screens walk's default language comes from, on the game's
  // own catalogues. Printed so a run's log is the record of it: nothing in the
  // PR or the docs states a figure by hand.
  it("ranks the game's own catalogues and prints the ranking", async () => {
    const lines: string[] = [];
    const io = { root: resolve(import.meta.dirname, "../../../.."), now: () => new Date(), log: (line: string) => lines.push(line) };

    expect(await runI18n(["lengths"], io)).toBe(0);
    expect(await runI18n(["lengths", "--by", "columns"], io)).toBe(0);
    console.log(lines.join("\n"));
    // Every locale the game ships in is ranked, in each of the two tables.
    for (const tag of LOCALE_TAGS) expect(lines.filter((line) => line.includes(` ${tag} `))).toHaveLength(2);

    const table: string[] = [];
    await runI18n(["lengths", "--longest"], { ...io, log: (line) => table.push(line) });
    const firstRow = lines.find((line) => line.startsWith("1 "));
    expect(firstRow).toContain(` ${table[0]} `);
  });
});
