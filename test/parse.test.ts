import { describe, expect, it } from "vitest";
import { delimiterForPath, detectDelimiter, detectNewline, parseCsv } from "../src/core/parse";
import { serializeCsv } from "../src/core/serialize";

describe("detectDelimiter", () => {
  it("detects commas, tabs, semicolons and pipes", () => {
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t");
    expect(detectDelimiter("a;b;c\n1;2;3\n")).toBe(";");
    expect(detectDelimiter("a|b|c\n1|2|3\n")).toBe("|");
  });

  it("prefers a consistent delimiter over one that appears in quoted text", () => {
    const text = 'name;note\n"Smith, John";x\n"Doe, Jane";y\n';
    expect(detectDelimiter(text)).toBe(";");
  });

  it("falls back to the preferred delimiter for single-column files", () => {
    expect(detectDelimiter("only\none\ncolumn\n", "\t")).toBe("\t");
    expect(detectDelimiter("only\none\ncolumn\n")).toBe(",");
  });

  it("guesses from file extension", () => {
    expect(delimiterForPath("/x/data.tsv")).toBe("\t");
    expect(delimiterForPath("/x/data.TAB")).toBe("\t");
    expect(delimiterForPath("/x/data.psv")).toBe("|");
    expect(delimiterForPath("/x/data.csv")).toBeUndefined();
  });
});

describe("parseCsv", () => {
  it("splits headers and rows", () => {
    const table = parseCsv("a,b\n1,2\n3,4\n");
    expect(table.headers).toEqual(["a", "b"]);
    expect(table.rows).toEqual([
      ["1", "2"],
      ["3", "4"]
    ]);
    expect(table.hasHeader).toBe(true);
    expect(table.trailingNewline).toBe(true);
    expect(table.newline).toBe("\n");
  });

  it("handles quoted fields with delimiters, quotes and newlines", () => {
    const table = parseCsv('h1,h2\n"a, b","say ""hi"""\n"multi\nline",x\n');
    expect(table.rows[0]).toEqual(["a, b", 'say "hi"']);
    expect(table.rows[1]).toEqual(["multi\nline", "x"]);
  });

  it("keeps ragged rows as-is", () => {
    const table = parseCsv("a,b,c\n1\n1,2,3,4\n");
    expect(table.rows[0]).toEqual(["1"]);
    expect(table.rows[1]).toEqual(["1", "2", "3", "4"]);
  });

  it("detects CRLF and no header mode", () => {
    const table = parseCsv("1,2\r\n3,4\r\n", { hasHeader: false });
    expect(table.newline).toBe("\r\n");
    expect(table.headers).toEqual([]);
    expect(table.rows).toHaveLength(2);
    expect(detectNewline("x\r\ny")).toBe("\r\n");
    expect(detectNewline("x\ny")).toBe("\n");
  });

  it("skips blank lines", () => {
    const table = parseCsv("a,b\n\n1,2\n\n");
    expect(table.rows).toEqual([["1", "2"]]);
  });

  it("honours an explicit delimiter", () => {
    const table = parseCsv("a;b\n1;2\n", { delimiter: ";" });
    expect(table.headers).toEqual(["a", "b"]);
  });
});

describe("serializeCsv", () => {
  it("round-trips simple files byte for byte", () => {
    const text = "a,b\n1,2\n3,4\n";
    expect(serializeCsv(parseCsv(text))).toBe(text);
  });

  it("preserves CRLF and missing trailing newline", () => {
    const text = "a,b\r\n1,2";
    expect(serializeCsv(parseCsv(text))).toBe(text);
  });

  it("quotes only when needed", () => {
    const table = parseCsv("a,b\n1,2\n");
    table.rows[0][1] = 'has "quote", comma';
    expect(serializeCsv(table)).toBe('a,b\n1,"has ""quote"", comma"\n');
  });

  it("can change delimiter and drop the header", () => {
    const table = parseCsv("a,b\n1,2\n");
    expect(serializeCsv(table, { delimiter: "\t" })).toBe("a\tb\n1\t2\n");
    expect(serializeCsv(table, { includeHeader: false })).toBe("1,2\n");
  });

  it("returns an empty string for an empty table", () => {
    expect(serializeCsv(parseCsv(""))).toBe("");
  });
});
