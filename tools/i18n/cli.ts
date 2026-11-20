/**
 * `pnpm i18n:draft | i18n:export | i18n:import | i18n:check` (languages spec §7.3).
 *
 * - `draft <locale>` lists the EN keys a locale lacks: the work for a machine
 *   draft, written in the session. It never writes a file.
 * - `export <locale>` writes `docs/i18n/review/<locale>.csv` for a reviewer.
 * - `import <locale> <file.csv> --reviewer <name>` applies their corrections,
 *   records a review hash for each approved row, and appends the evidence to
 *   `docs/i18n/reviews.md`. A row naming no EN key refuses the whole file.
 * - `check` holds every locale that has a catalogue to parity with EN;
 *   `check --release` also refuses a missing locale or any unreviewed string.
 * - `lengths` ranks every locale by how much text it puts on screen, longest
 *   first (`lengths --by columns` counts a wide character twice). `lengths
 *   --longest` prints only the longest locale's tag: the screens walk's
 *   default language.
 *
 * Exit codes: 0 fine, 1 a check failed, 2 a usage or input error.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCALE_TAGS, isLocaleTag, type LocaleTag } from "../../apps/client/src/features/i18n/locales";
import {
  messageText,
  parityProblems,
  readCatalogue,
  readContext,
  readMessages,
  type Catalogue,
  type MessageValue,
} from "./catalogue";
import { parseCsv, toCsv } from "./csv";
import { measureLocales, rankingLines, type Measure } from "./lengths";
import { reviewHash, reviewState } from "./review";

export type I18nIo = { readonly root: string; readonly now: () => Date; readonly log: (line: string) => void };

const SCHEMA = "https://inlang.com/schema/inlang-message-format";
const HEADER = ["key", "en", "translation", "note", "maxChars", "screenshot", "approved"];
const APPROVED = new Set(["yes", "y", "x", "1", "true"]);

const messagesDir = (io: I18nIo) => join(io.root, "apps/client/messages");
const part = (key: string): "ui" | "content" => (key.startsWith("content_") ? "content" : "ui");

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** A locale has a catalogue once either of its files exists. */
async function hasCatalogue(io: I18nIo, locale: LocaleTag): Promise<boolean> {
  const dir = messagesDir(io);
  return (await exists(join(dir, "ui", `${locale}.json`))) || (await exists(join(dir, "content", `${locale}.json`)));
}

async function readReview(io: I18nIo, locale: LocaleTag): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(join(messagesDir(io), "review", `${locale}.json`), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** `$schema` first, then the keys in EN's order: a diff shows only what changed. */
async function writeCatalogue(io: I18nIo, locale: LocaleTag, which: "ui" | "content", values: Catalogue, order: readonly string[]): Promise<void> {
  const ordered: Record<string, MessageValue> = {};
  for (const key of order) if (values[key] !== undefined && part(key) === which) ordered[key] = values[key]!;
  const path = join(messagesDir(io), which, `${locale}.json`);
  await writeFile(path, `${JSON.stringify({ $schema: SCHEMA, ...ordered }, null, 2)}\n`);
}

/** A translation cell: plain text for a plain message, the variant JSON for a plural. */
function parseCell(en: MessageValue, cell: string): MessageValue {
  return typeof en === "string" ? cell : (JSON.parse(cell) as MessageValue);
}

async function draft(io: I18nIo, locale: LocaleTag): Promise<number> {
  const [en, translated] = await Promise.all([readMessages("en", messagesDir(io)), readMessages(locale, messagesDir(io))]);
  const missing = Object.keys(en).filter((key) => translated[key] === undefined);
  io.log(`${locale}: ${missing.length} keys to draft`);
  for (const key of missing) io.log(`${key}\t${messageText(en[key]!)}`);
  return 0;
}

async function exportSheet(io: I18nIo, locale: LocaleTag): Promise<number> {
  const dir = messagesDir(io);
  const [en, translated, context] = await Promise.all([readMessages("en", dir), readMessages(locale, dir), readContext(dir)]);
  const rows = [
    HEADER,
    ...Object.keys(en).map((key) => [
      key,
      messageText(en[key]!),
      translated[key] === undefined ? "" : messageText(translated[key]!),
      context[key]?.note ?? "",
      context[key]?.maxChars === undefined ? "" : String(context[key]!.maxChars),
      context[key]?.screenshot ?? "",
      "",
    ]),
  ];
  const out = join(io.root, "docs/i18n/review");
  await mkdir(out, { recursive: true });
  await writeFile(join(out, `${locale}.csv`), toCsv(rows, { bom: true }));
  io.log(`docs/i18n/review/${locale}.csv: ${rows.length - 1} strings`);
  return 0;
}

async function importSheet(io: I18nIo, locale: LocaleTag, file: string, reviewer: string): Promise<number> {
  const dir = messagesDir(io);
  const en = await readMessages("en", dir);
  const [header, ...rows] = parseCsv(await readFile(file, "utf8"));
  const column = (name: string) => header?.indexOf(name) ?? -1;
  const [keyAt, translationAt, approvedAt] = [column("key"), column("translation"), column("approved")];
  if (keyAt < 0 || translationAt < 0 || approvedAt < 0) {
    io.log(`${file}: needs the columns key, translation and approved`);
    return 2;
  }
  const unknown = rows.filter((row) => row.length > 1 && en[row[keyAt] ?? ""] === undefined).map((row) => row[keyAt]);
  if (unknown.length > 0) {
    io.log(`${file}: not EN keys, nothing imported: ${unknown.join(", ")}`);
    return 2;
  }

  const ui = { ...(await readCatalogue(locale, "ui", dir)) } as Record<string, MessageValue>;
  const content = { ...(await readCatalogue(locale, "content", dir)) } as Record<string, MessageValue>;
  const review = await readReview(io, locale);
  let approved = 0;
  for (const row of rows) {
    const key = row[keyAt];
    if (key === undefined || row.length <= 1) continue;
    const cell = row[translationAt] ?? "";
    const target = part(key) === "ui" ? ui : content;
    if (cell !== "") target[key] = parseCell(en[key]!, cell);
    const translation = target[key];
    if (APPROVED.has((row[approvedAt] ?? "").trim().toLowerCase()) && translation !== undefined) {
      review[key] = reviewHash(en[key]!, translation);
      approved += 1;
    }
  }

  const order = Object.keys(en);
  await writeCatalogue(io, locale, "ui", ui, order);
  await writeCatalogue(io, locale, "content", content, order);
  await mkdir(join(dir, "review"), { recursive: true });
  const sortedReview = Object.fromEntries(Object.entries(review).sort(([a], [b]) => (a < b ? -1 : 1)));
  await writeFile(join(dir, "review", `${locale}.json`), `${JSON.stringify(sortedReview, null, 2)}\n`);

  const evidence = join(io.root, "docs/i18n/reviews.md");
  await mkdir(join(io.root, "docs/i18n"), { recursive: true });
  if (!(await exists(evidence))) {
    await writeFile(evidence, "# Translation reviews\n\n| Date | Locale | Reviewer | Approved |\n| --- | --- | --- | --- |\n");
  }
  await appendFile(evidence, `| ${io.now().toISOString().slice(0, 10)} | ${locale} | ${reviewer} | ${approved} approved |\n`);
  io.log(`${locale}: imported ${rows.length} rows, ${approved} approved by ${reviewer}`);
  return 0;
}

async function check(io: I18nIo, release: boolean): Promise<number> {
  const dir = messagesDir(io);
  const [en, context] = await Promise.all([readMessages("en", dir), readContext(dir)]);
  let failed = false;
  for (const locale of LOCALE_TAGS.filter((tag) => tag !== "en")) {
    if (!(await hasCatalogue(io, locale))) {
      if (release) {
        io.log(`${locale}: no catalogue`);
        failed = true;
      }
      continue;
    }
    const translated = await readMessages(locale, dir);
    const problems = parityProblems(locale, en, translated, context);
    for (const problem of problems) io.log(problem);
    if (problems.length > 0) failed = true;
    if (release) {
      const { unreviewed } = reviewState(en, translated, await readReview(io, locale));
      if (unreviewed.length > 0) {
        io.log(`${locale}: ${unreviewed.length} unreviewed`);
        for (const key of unreviewed.slice(0, 20)) io.log(`  ${key}`);
        failed = true;
      }
    }
  }
  if (!failed) io.log(release ? "every locale complete and reviewed" : "every catalogue in parity with EN");
  return failed ? 1 : 0;
}

async function lengths(io: I18nIo, args: readonly string[]): Promise<number> {
  const byAt = args.indexOf("--by");
  const by = (byAt >= 0 ? args[byAt + 1] : "characters") as Measure;
  if (by !== "characters" && by !== "columns") {
    io.log("usage: i18n lengths [--by characters|columns] [--longest]");
    return 2;
  }
  const ranking = await measureLocales(messagesDir(io), by);
  if (args.includes("--longest")) {
    io.log(ranking[0]?.locale ?? "en");
    return 0;
  }
  for (const line of rankingLines(ranking, by)) io.log(line);
  return 0;
}

export async function runI18n(argv: readonly string[], io: I18nIo): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "check") return check(io, rest.includes("--release"));
  if (command === "lengths") return lengths(io, rest);

  const locale = rest[0];
  if (!isLocaleTag(locale) || locale === "en") {
    io.log(`usage: i18n <draft|export|import|check|lengths> <${LOCALE_TAGS.filter((tag) => tag !== "en").join("|")}> …`);
    return 2;
  }
  if (command === "draft") return draft(io, locale);
  if (command === "export") return exportSheet(io, locale);
  if (command === "import") {
    const file = rest[1];
    const reviewerAt = rest.indexOf("--reviewer");
    const reviewer = reviewerAt >= 0 ? rest.slice(reviewerAt + 1).join(" ") : "";
    if (file === undefined || reviewer === "") {
      io.log("usage: i18n import <locale> <file.csv> --reviewer <name>");
      return 2;
    }
    return importSheet(io, locale, file, reviewer);
  }
  io.log(`unknown command: ${command ?? "(none)"}`);
  return 2;
}
