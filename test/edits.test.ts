import { describe, expect, it } from "vitest";
import { applyEdit, applyEdits, cloneTable } from "../src/core/edits";
import { parseCsv } from "../src/core/parse";
import { columnCount, columnName, columnNames } from "../src/core/types";

const base = () => parseCsv("name,qty,price\nfoo,2,1.5\nbar,10,0.25\nbaz,1,9\n");

describe("applyEdit", () => {
  it("sets a cell and pads ragged rows", () => {
    const t = parseCsv("a,b\n1\n");
    applyEdit(t, { kind: "setCell", row: 0, col: 3, value: "x" });
    expect(t.rows[0]).toEqual(["1", "", "", "x"]);
  });

  it("inserts and deletes rows", () => {
    const t = base();
    applyEdit(t, { kind: "insertRows", index: 1, count: 2 });
    expect(t.rows).toHaveLength(5);
    expect(t.rows[1]).toEqual(["", "", ""]);
    applyEdit(t, { kind: "deleteRows", indices: [1, 2] });
    expect(t.rows.map((r) => r[0])).toEqual(["foo", "bar", "baz"]);
  });

  it("inserts rows with provided content (duplicate)", () => {
    const t = base();
    applyEdit(t, { kind: "insertRows", index: 3, count: 1, rows: [t.rows[0]] });
    expect(t.rows[3]).toEqual(["foo", "2", "1.5"]);
    t.rows[3][0] = "changed";
    expect(t.rows[0][0]).toBe("foo");
  });

  it("moves rows", () => {
    const t = base();
    applyEdit(t, { kind: "moveRow", from: 0, to: 2 });
    expect(t.rows.map((r) => r[0])).toEqual(["bar", "baz", "foo"]);
  });

  it("inserts, renames, moves and deletes columns", () => {
    const t = base();
    applyEdit(t, { kind: "insertColumn", index: 1, name: "sku" });
    expect(t.headers).toEqual(["name", "sku", "qty", "price"]);
    expect(t.rows[0]).toEqual(["foo", "", "2", "1.5"]);
    applyEdit(t, { kind: "renameColumn", index: 1, name: "code" });
    expect(t.headers[1]).toBe("code");
    applyEdit(t, { kind: "moveColumn", from: 1, to: 3 });
    expect(t.headers).toEqual(["name", "qty", "price", "code"]);
    applyEdit(t, { kind: "deleteColumns", indices: [3] });
    expect(t.headers).toEqual(["name", "qty", "price"]);
    expect(t.rows[0]).toEqual(["foo", "2", "1.5"]);
  });

  it("ignores rename when there is no header row", () => {
    const t = parseCsv("1,2\n", { hasHeader: false });
    applyEdit(t, { kind: "renameColumn", index: 0, name: "x" });
    expect(t.headers).toEqual([]);
  });

  it("sorts numerically and textually, keeping blanks last", () => {
    const t = base();
    applyEdit(t, { kind: "insertRows", index: 0, count: 1 });
    applyEdit(t, { kind: "sortRows", col: 1, direction: "asc", numeric: true });
    expect(t.rows.map((r) => r[1])).toEqual(["1", "2", "10", ""]);
    applyEdit(t, { kind: "sortRows", col: 0, direction: "desc", numeric: false });
    expect(t.rows.map((r) => r[0])).toEqual(["foo", "baz", "bar", ""]);
  });

  it("replaces everything", () => {
    const t = base();
    applyEdits(t, [{ kind: "replaceAll", headers: ["x"], rows: [["1"], ["2"]] }]);
    expect(t.headers).toEqual(["x"]);
    expect(t.rows).toHaveLength(2);
  });

  it("clones deeply", () => {
    const t = base();
    const c = cloneTable(t);
    c.rows[0][0] = "zzz";
    expect(t.rows[0][0]).toBe("foo");
  });
});

describe("column helpers", () => {
  it("counts columns from ragged data", () => {
    expect(columnCount(parseCsv("a\n1,2,3\n"))).toBe(3);
  });

  it("names columns with fallbacks and de-duplicates", () => {
    const t = parseCsv("id,,id,x\n1,2,3,4\n");
    expect(columnName(t, 1)).toBe("Column 2");
    expect(columnNames(t)).toEqual(["id", "Column 2", "id (2)", "x"]);
    const noHeader = parseCsv("1,2\n", { hasHeader: false });
    expect(columnNames(noHeader)).toEqual(["Column 1", "Column 2"]);
  });
});
