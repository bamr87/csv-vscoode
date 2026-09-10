import { describe, expect, it } from "vitest";
import { applyEdit } from "../src/core/edits";
import { parseCsv } from "../src/core/parse";
import { buildMatcher, findMatches, replaceAll, replaceInCell } from "../src/core/search";

const table = () => parseCsv("name,city\nAlice,Paris\nBob,paris\nCarol,London\n");

describe("findMatches", () => {
  it("finds case-insensitively by default", () => {
    expect(findMatches(table(), { query: "paris" })).toEqual([
      { row: 0, col: 1 },
      { row: 1, col: 1 }
    ]);
  });

  it("supports case sensitivity, whole cell and regex", () => {
    expect(findMatches(table(), { query: "paris", caseSensitive: true })).toEqual([{ row: 1, col: 1 }]);
    expect(findMatches(table(), { query: "Par", wholeCell: true })).toEqual([]);
    expect(findMatches(table(), { query: "^[AB]", regex: true })).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 }
    ]);
  });

  it("restricts to columns and respects limits", () => {
    expect(findMatches(table(), { query: "o", columns: [0] })).toEqual([
      { row: 1, col: 0 },
      { row: 2, col: 0 }
    ]);
    expect(findMatches(table(), { query: "o" }, 1)).toHaveLength(1);
  });

  it("returns nothing for empty or invalid queries", () => {
    expect(findMatches(table(), { query: "" })).toEqual([]);
    expect(findMatches(table(), { query: "(", regex: true })).toEqual([]);
    expect(buildMatcher({ query: "(", regex: true })).toBeUndefined();
  });
});

describe("replace", () => {
  it("replaces all matches and produces an edit op", () => {
    const t = table();
    const op = replaceAll(t, { query: "paris" }, "Lyon");
    expect(op?.kind).toBe("setCells");
    applyEdit(t, op!);
    expect(t.rows.map((r) => r[1])).toEqual(["Lyon", "Lyon", "London"]);
  });

  it("supports regex capture groups", () => {
    expect(replaceInCell("Alice Smith", { query: "(\\w+) (\\w+)", regex: true }, "$2, $1")).toBe("Smith, Alice");
  });

  it("treats replacement literally in plain mode", () => {
    expect(replaceInCell("a-b", { query: "-" }, "$&$1")).toBe("a$&$1b");
  });

  it("returns undefined when nothing changes", () => {
    expect(replaceAll(table(), { query: "zzz" }, "x")).toBeUndefined();
  });
});
