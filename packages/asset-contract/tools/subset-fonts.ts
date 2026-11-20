/**
 * `pnpm fonts:subset` (languages spec §6.1): each Fusion Pixel 12px proportional
 * family (renamed "FF Pixel", see `renameFamily`) cut to its locale's characters, a Latin face for English, Spanish and
 * Portuguese, and a few-KB endonym file for the language picker.
 *
 * The sources are pinned in `fonts-src/sources.json`. A missing one is
 * fetched; a hash that does not match is refused rather than subset, so the
 * committed files can always be cut again from the same bytes.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import subsetFont from "subset-font";
import { ENDONYMS, type LocaleTag } from "../../../apps/client/src/features/i18n/locales";
import { localeCharacters } from "../../../tools/i18n/characters";

type Source = { family: string; url: string; file: string; sha256: string };

const SRC = resolve(import.meta.dirname, "../fonts-src");
const OUT = resolve(import.meta.dirname, "../../../apps/client/public/fonts");
const FAMILIES: readonly { key: string; code: string; locale: LocaleTag }[] = [
  { key: "fusion-pixel-jp", code: "jp", locale: "ja" },
  { key: "fusion-pixel-kr", code: "kr", locale: "ko" },
  { key: "fusion-pixel-sc", code: "sc", locale: "zh-Hans" },
];


/**
 * The OFL reserves the name "Fusion Pixel", and a subset is a Modified Version
 * (OFL 1.1 section 3), so the cuts carry our own name: "FF Pixel". The copyright
 * notice and the licence stay as they are; only the family names (nameIDs 1, 4,
 * 6, and 3 for the unique id) are rewritten, in the sfnt before it is packed.
 */
const NEW_FAMILY = "FF Pixel";
function utf16be(text: string): Buffer {
  const out = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i += 1) out.writeUInt16BE(text.charCodeAt(i), i * 2);
  return out;
}
function checksum(buf: Buffer): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const word = Buffer.concat([buf.subarray(i, i + 4), Buffer.alloc(4)]).readUInt32BE(0);
    sum = (sum + word) >>> 0;
  }
  return sum;
}
function renameFamily(sfnt: Buffer, family: string): Buffer {
  const count = sfnt.readUInt16BE(4);
  const tables = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    const tag = sfnt.toString("latin1", at, at + 4);
    const offset = sfnt.readUInt32BE(at + 8);
    tables.set(tag, Buffer.from(sfnt.subarray(offset, offset + sfnt.readUInt32BE(at + 12))));
  }
  const oldName = tables.get("name")!;
  const stringsAt = oldName.readUInt16BE(4);
  const kept = new Map<number, string>();
  for (let i = 0; i < oldName.readUInt16BE(2); i += 1) {
    const rec = 6 + i * 12;
    if (oldName.readUInt16BE(rec) !== 3) continue;
    const length = oldName.readUInt16BE(rec + 8);
    const start = stringsAt + oldName.readUInt16BE(rec + 10);
    const bytes = Buffer.from(oldName.subarray(start, start + length));
    kept.set(oldName.readUInt16BE(rec + 6), bytes.swap16().toString("utf16le"));
  }
  const version = kept.get(5) ?? "Version 1.0";
  const names = new Map<number, string>([
    [0, kept.get(0) ?? ""],
    [1, family],
    [2, "Regular"],
    [3, `${family.replaceAll(" ", "-")}-Regular;${version.replace(/^Version\s*/, "")}`],
    [4, `${family} Regular`],
    [5, version],
    [6, `${family.replaceAll(" ", "-")}-Regular`],
  ]);
  const ids = [...names.keys()].sort((a, b) => a - b);
  const strings = ids.map((id) => utf16be(names.get(id)!));
  const header = Buffer.alloc(6 + ids.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(ids.length, 2);
  header.writeUInt16BE(header.length, 4);
  let offset = 0;
  ids.forEach((id, i) => {
    const rec = 6 + i * 12;
    header.writeUInt16BE(3, rec);
    header.writeUInt16BE(1, rec + 2);
    header.writeUInt16BE(0x409, rec + 4);
    header.writeUInt16BE(id, rec + 6);
    header.writeUInt16BE(strings[i]!.length, rec + 8);
    header.writeUInt16BE(offset, rec + 10);
    offset += strings[i]!.length;
  });
  tables.set("name", Buffer.concat([header, ...strings]));
  const head = tables.get("head")!;
  head.writeUInt32BE(0, 8);
  const tags = [...tables.keys()].sort();
  const dirLength = 12 + tags.length * 16;
  const directory = Buffer.alloc(dirLength);
  sfnt.copy(directory, 0, 0, 4);
  directory.writeUInt16BE(tags.length, 4);
  const entrySelector = Math.floor(Math.log2(tags.length));
  directory.writeUInt16BE((2 ** entrySelector) * 16, 6);
  directory.writeUInt16BE(entrySelector, 8);
  directory.writeUInt16BE(tags.length * 16 - (2 ** entrySelector) * 16, 10);
  const bodies: Buffer[] = [];
  let at = dirLength;
  tags.forEach((tag, i) => {
    const data = tables.get(tag)!;
    const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
    directory.write(tag, 12 + i * 16, "latin1");
    directory.writeUInt32BE(checksum(padded), 12 + i * 16 + 4);
    directory.writeUInt32BE(at, 12 + i * 16 + 8);
    directory.writeUInt32BE(data.length, 12 + i * 16 + 12);
    bodies.push(padded);
    at += padded.length;
  });
  const whole = Buffer.concat([directory, ...bodies]);
  const headAt = whole.readUInt32BE(12 + tags.indexOf("head") * 16 + 8);
  whole.writeUInt32BE((0xb1b0afba - checksum(whole)) >>> 0, headAt + 8);
  return whole;
}

/** Cut `bytes` to `text`, name the cut `family`, and pack it as woff2. */
async function cut(bytes: Buffer, text: string, family: string): Promise<Buffer> {
  const sfnt = await subsetFont(bytes, text, { targetFormat: "sfnt" });
  // A second pass packs the renamed sfnt; it keeps every glyph and the name records.
  return subsetFont(renameFamily(Buffer.from(sfnt), family), text, { targetFormat: "woff2" });
}

async function source(entry: Source): Promise<Buffer> {
  const path = resolve(SRC, entry.file);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    const response = await fetch(entry.url);
    if (!response.ok) throw new Error(`fetch ${entry.url}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(path, bytes);
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== entry.sha256) throw new Error(`${entry.file}: sha256 ${hash} is not the recorded ${entry.sha256}`);
  return bytes;
}

const sources = JSON.parse(await readFile(resolve(SRC, "sources.json"), "utf8")) as Record<string, Source>;
for (const family of FAMILIES) {
  const bytes = await source(sources[family.key]!);
  const text = [...(await localeCharacters(family.locale))].join("");
  const subset = await cut(bytes, text, `${NEW_FAMILY} ${family.code.toUpperCase()}`);
  const endonym = await cut(bytes, ENDONYMS[family.locale], `${NEW_FAMILY} ${family.code.toUpperCase()} Endonym`);
  await writeFile(resolve(OUT, `ff-pixel-${family.code}-subset.woff2`), subset);
  await writeFile(resolve(OUT, `ff-pixel-${family.code}-endonym.woff2`), endonym);
  console.log(`${family.key}: ${[...text].length} characters, subset ${subset.length} B, endonym ${endonym.length} B`);
}

// The Latin face: the Simplified Chinese file's Latin glyphs (the four regional files draw the same Latin),
// cut to the characters the English, Spanish and Portuguese catalogues use.
const latin = new Set<string>();
for (const locale of ["en", "es-419", "pt-BR"] as const) for (const char of await localeCharacters(locale)) latin.add(char);
const latinBytes = await source(sources["fusion-pixel-sc"]!);
const latinSubset = await cut(latinBytes, [...latin].join(""), NEW_FAMILY);
await writeFile(resolve(OUT, "ff-pixel-latin.woff2"), latinSubset);
console.log(`ff-pixel-latin: ${latin.size} characters, subset ${latinSubset.length} B`);
