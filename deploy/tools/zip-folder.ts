/**
 * Zips a folder in Node, with no `zip` program (Ruken M1.7d).
 *
 * `tools/ruken-pack` used to run Info-ZIP's `zip`, which Git for Windows does not include, so Ruken's playthrough on
 * the Owner's Windows runner could not pack the game. This writes the same kind of archive Ruken's intake reads:
 *
 * - one entry per file, named by its path inside the folder with `/` separators, sorted, and no entries for folders;
 * - each file deflated, or stored as it is when deflate would not make it smaller;
 * - the same timestamp (1980-01-01) and mode (-rw-r--r--) on every entry, UTF-8 names, no extra fields, so the same
 *   files always give the same bytes whatever the clock, the disk's listing order or the user's umask;
 * - no zip64: an archive of 65535 files or 4 GiB is refused instead of written wrong. A game build is far smaller.
 *
 * It follows the zip format's APPNOTE.TXT: a local header and the data for each file, then a central directory that
 * lists them again, then an end-of-central-directory record. Everything is little-endian.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const STORED = 0;
const DEFLATED = 8;
/** General purpose bit 11: names are UTF-8. */
const UTF8_NAMES = 0x0800;
/** 2.0 is the version that introduced deflate; any reader of a deflated zip knows it. */
const VERSION_NEEDED = 20;
/** Made by "Unix" (3), version 2.0: the external attributes below then hold a Unix mode. */
const VERSION_MADE_BY = (3 << 8) | 20;
/** 1980-01-01 00:00:00, the earliest time a zip can hold, in MS-DOS date and time fields. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
/** `-rw-r--r--` in the high 16 bits of the external attributes. */
const FILE_ATTRIBUTES = (0o100644 << 16) >>> 0;
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

interface Entry {
  readonly name: Buffer;
  readonly method: number;
  readonly crc: number;
  readonly stored: Buffer;
  readonly size: number;
}

/** Every file under `folder` as `/`-separated paths, sorted. Throws on anything that is not a plain file or folder. */
function filesIn(folder: string, prefix = ""): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(join(folder, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...filesIn(folder, path));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`cannot zip ${path}: only plain files and folders can go in a build (it is a link or a special file)`);
  }
  // Compared as UTF-8 bytes, not as UTF-16 text, so the order does not depend on the platform's locale.
  return paths.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

function entryFor(folder: string, path: string): Entry {
  const data = readFileSync(join(folder, path));
  const deflated = deflateRawSync(data);
  const shrinks = deflated.length < data.length;
  const entry = {
    name: Buffer.from(path, "utf8"),
    method: shrinks ? DEFLATED : STORED,
    crc: crc32(data),
    stored: shrinks ? deflated : data,
    size: data.length,
  };
  if (entry.size > MAX_SIZE) throw new Error(`cannot zip ${path}: it is larger than 4 GiB`);
  return entry;
}

function localHeader(entry: Entry): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_HEADER, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(UTF8_NAMES, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.stored.length, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28); // no extra field
  return header;
}

function centralHeader(entry: Entry, localOffset: number): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_HEADER, 0);
  header.writeUInt16LE(VERSION_MADE_BY, 4);
  header.writeUInt16LE(VERSION_NEEDED, 6);
  header.writeUInt16LE(UTF8_NAMES, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.stored.length, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  // 30 extra field length, 32 comment length, 34 disk number, 36 internal attributes: all zero
  header.writeUInt32LE(FILE_ATTRIBUTES, 38);
  header.writeUInt32LE(localOffset, 42);
  return header;
}

/** Writes the files under `folder` to the zip `outFile`, replacing it. Put `outFile` outside `folder`. */
export function zipFolder(folder: string, outFile: string): void {
  const paths = filesIn(folder);
  if (paths.length > MAX_ENTRIES) throw new Error(`cannot zip ${String(paths.length)} files: a zip holds at most ${String(MAX_ENTRIES)}`);

  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const path of paths) {
    const entry = entryFor(folder, path);
    const header = localHeader(entry);
    central.push(centralHeader(entry, offset), entry.name);
    parts.push(header, entry.name, entry.stored);
    offset += header.length + entry.name.length + entry.stored.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  // 4 disk number and 6 disk with the directory: zero. Then the entry count (this disk, then in all).
  end.writeUInt16LE(paths.length, 8);
  end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  // 20 comment length: zero
  if (offset + directory.length > MAX_SIZE) throw new Error("cannot zip: the archive would be larger than 4 GiB");

  writeFileSync(outFile, Buffer.concat([...parts, directory, end]));
}
