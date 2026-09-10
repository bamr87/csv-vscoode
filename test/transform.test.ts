import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/core/edits";
import { parseCsv } from "../src/core/parse";
import { applyPureStep } from "../src/core/pipeline";
import {
  duplicateColumnOps,
  duplicateRowIndices,
  emptyRowIndices,
  fillDownOps,
  fillRightOps,
  fillSeriesOps,
  mergeColumnsOps,
  normalizeRows,
  raggedRowIndices,
  sampleRowIndices,
  splitColumnOps,
  transposeTable
} from "../src/core/transform";

const t = () => parseCsv("first,last,n\nAda,Lovelace,1\n , ,\nAda,Lovelace,1\nAlan,Turing,3\n");

describe("row helpers", () => {
  it("finds empty, duplicate and ragged rows", () => {
    expect(emptyRowIndices(t())).toEqual([1]);
    expect(duplicateRowIndices(t())).toEqual([2]);
    expect(duplicateRowIndices(t(), [0])).toEqual([2, 3].filter((i) => i === 2).concat([]));
    const ragged = parseCsv("a,b,c\n1,2\n1,2,3\n1,2,3,4\n");
    expect(raggedRowIndices(ragged)).toEqual({ indices: [0, 2], expected: 3 });
    const fixed = applyEdits(ragged, [normalizeRows(ragged, 3)]);
    expect(fixed.rows).toEqual([
      ["1", "2", ""],
      ["1", "2", "3"],
      ["1", "2", "3", "4"]
    ]);
  });

  it("samples deterministically", () => {
    const a = sampleRowIndices(100, 5, 7);
    const b = sampleRowIndices(100, 5, 7);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(new Set(a).size).toBe(5);
    expect(sampleRowIndices(3, 10)).toEqual([0, 1, 2]);
  });
});

describe("column transforms", () => {
  it("transposes with and without headers", () => {
    const table = parseCsv("a,b\n1,2\n3,4\n");
    const out = applyEdits(table, [transposeTable(table)]);
    expect(out.headers).toEqual(["a", "1", "3"]);
    expect(out.rows).toEqual([["b", "2", "4"]]);
    const noHeader = parseCsv("1,2\n3,4\n", { hasHeader: false });
    expect(applyEdits(noHeader, [transposeTable(noHeader)]).rows).toEqual([
      ["1", "3"],
      ["2", "4"]
    ]);
  });

  it("splits columns like Text to Columns", () => {
    const table = parseCsv("name\nAda Lovelace\nAlan\n");
    const out = applyEdits(table, splitColumnOps(table, 0, { separator: " " }));
    expect(out.headers).toEqual(["name", "name 1", "name 2"]);
    expect(out.rows).toEqual([
      ["Ada Lovelace", "Ada", "Lovelace"],
      ["Alan", "Alan", ""]
    ]);
    const limited = applyEdits(parseCsv("x\na-b-c\n"), splitColumnOps(parseCsv("x\na-b-c\n"), 0, { separator: "-", limit: 2, removeSource: true }));
    expect(limited.headers).toEqual(["x 1", "x 2"]);
    expect(limited.rows).toEqual([["a", "b-c"]]);
    const re = applyEdits(parseCsv("x\na1b22c\n"), splitColumnOps(parseCsv("x\na1b22c\n"), 0, { separator: "\\d+", regex: true }));
    expect(re.rows[0].slice(1)).toEqual(["a", "b", "c"]);
  });

  it("merges and duplicates columns", () => {
    const table = t();
    const merged = applyEdits(table, mergeColumnsOps(table, [0, 1], " ", "full", true));
    expect(merged.headers).toEqual(["full", "n"]);
    expect(merged.rows[0]).toEqual(["Ada Lovelace", "1"]);
    const dup = applyEdits(t(), duplicateColumnOps(t(), 2));
    expect(dup.headers).toEqual(["first", "last", "n", "n (copy)"]);
    expect(dup.rows[3]).toEqual(["Alan", "Turing", "3", "3"]);
  });
});

describe("fill", () => {
  it("fills down and right", () => {
    const table = parseCsv("a,b\nx,1\n,\n,\n");
    const down = applyEdits(table, [fillDownOps(table, { top: 0, bottom: 2, left: 0, right: 1 })!]);
    expect(down.rows).toEqual([
      ["x", "1"],
      ["x", "1"],
      ["x", "1"]
    ]);
    const right = applyEdits(parseCsv("a,b,c\nx,,\n"), [fillRightOps(parseCsv("a,b,c\nx,,\n"), { top: 0, bottom: 0, left: 0, right: 2 })!]);
    expect(right.rows[0]).toEqual(["x", "x", "x"]);
    expect(fillDownOps(parseCsv("a\nx\nx\n"), { top: 0, bottom: 1, left: 0, right: 0 })).toBeUndefined();
  });

  it("continues numeric, numbered-text and constant series", () => {
    const table = parseCsv("n,d,id,k\n1,1.5,item01,x\n3,2.0,,\n,,,\n,,,\n");
    const out = applyEdits(table, [fillSeriesOps(table, { top: 0, bottom: 3, left: 0, right: 3 })!]);
    expect(out.rows.map((r) => r[0])).toEqual(["1", "3", "5", "7"]);
    expect(out.rows.map((r) => r[1])).toEqual(["1.5", "2.0", "2.5", "3.0"]);
    expect(out.rows.map((r) => r[2])).toEqual(["item01", "item02", "item03", "item04"]);
    expect(out.rows.map((r) => r[3])).toEqual(["x", "x", "x", "x"]);
  });
});

describe("new pipeline steps", () => {
  it("split, merge, transpose, removeEmptyRows and sample", () => {
    const base = t();
    expect(applyPureStep(base, { kind: "removeEmptyRows" }).rows).toHaveLength(3);
    expect(applyPureStep(base, { kind: "sample", count: 2, seed: 1 }).rows).toHaveLength(2);
    expect(applyPureStep(base, { kind: "transpose" }).headers).toEqual(["first", "Ada", " ", "Ada", "Alan"]);
    const merged = applyPureStep(base, { kind: "mergeColumns", columns: ["first", "last"], separator: "_", name: "id" });
    expect(merged.headers).toEqual(["first", "last", "id", "n"]);
    const split = applyPureStep(merged, { kind: "splitColumn", column: "id", separator: "_", removeSource: true });
    expect(split.headers).toEqual(["first", "last", "id 1", "id 2", "n"]);
    expect(applyPureStep(base, { kind: "dedupe", columns: ["first"] }).rows).toHaveLength(3);
  });
});
