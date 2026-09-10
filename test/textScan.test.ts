import { describe, expect, it } from "vitest";
import { columnAtOffset, scanLine } from "../src/core/textScan";

describe("scanLine", () => {
  it("splits fields and reports offsets", () => {
    const scan = scanLine("a,bb,ccc", ",");
    expect(scan.fields).toEqual([
      { col: 0, start: 0, end: 1 },
      { col: 1, start: 2, end: 4 },
      { col: 2, start: 5, end: 8 }
    ]);
    expect(scan.openQuote).toBe(false);
  });

  it("ignores delimiters inside quotes and tracks open quotes", () => {
    const scan = scanLine('"a,b",c,"open', ",");
    expect(scan.fields.map((f) => f.col)).toEqual([0, 1, 2]);
    expect(scan.openQuote).toBe(true);
    const next = scanLine('still",d', ",", 2, true);
    expect(next.fields.map((f) => f.col)).toEqual([2, 3]);
    expect(next.openQuote).toBe(false);
  });

  it("treats doubled quotes as escapes", () => {
    const scan = scanLine('"say ""hi""",x', ",");
    expect(scan.fields).toHaveLength(2);
  });

  it("maps offsets to columns", () => {
    const scan = scanLine("ab,cd,ef", ",");
    expect(columnAtOffset(scan, 0)).toBe(0);
    expect(columnAtOffset(scan, 3)).toBe(1);
    expect(columnAtOffset(scan, 8)).toBe(2);
  });
});
