// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../../../../tools/i18n/csv";

describe("CSV for the review sheets (languages spec §7.3)", () => {
  it("round-trips commas, quotes, newlines and CJK", () => {
    const rows = [
      ["key", "en", "translation"],
      ["a", 'Say "hi", then go', "「やあ」と言って\n行こう"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("ends rows with CRLF for spreadsheet apps, and reads LF too", () => {
    expect(toCsv([["a", "b"]])).toBe("a,b\r\n");
    expect(parseCsv("a,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("starts with a UTF-8 BOM when asked, so Excel reads the CJK, and strips one on reading", () => {
    expect(toCsv([["a"]], { bom: true }).startsWith("﻿")).toBe(true);
    expect(parseCsv("﻿a\r\n")).toEqual([["a"]]);
  });

  it("keeps empty fields, and a quoted empty field", () => {
    expect(parseCsv('a,,""\r\n')).toEqual([["a", "", ""]]);
  });
});
