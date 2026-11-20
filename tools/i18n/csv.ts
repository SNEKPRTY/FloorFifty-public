/**
 * The review sheets' CSV (languages spec §7.3), RFC 4180: a field holding a
 * comma, a quote or a line break is quoted, with inner quotes doubled. Rows
 * end in CRLF, which every spreadsheet app reads; LF is read too. A BOM is
 * written on request so Excel opens CJK text as UTF-8, and dropped on reading.
 */

const NEEDS_QUOTES = /[",\r\n]/;

export function toCsv(rows: readonly (readonly string[])[], options: { bom?: boolean } = {}): string {
  const body = rows
    .map((row) => row.map((field) => (NEEDS_QUOTES.test(field) ? `"${field.replaceAll('"', '""')}"` : field)).join(","))
    .map((line) => `${line}\r\n`)
    .join("");
  return options.bom === true ? `﻿${body}` : body;
}

export function parseCsv(text: string): string[][] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < source.length) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
      else field += char;
      index += 1;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") endField();
    else if (char === "\r" && source[index + 1] === "\n") {
      endRow();
      index += 1;
    } else if (char === "\n") endRow();
    else field += char;
    index += 1;
  }
  // A last line with no line ending is still a row.
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
