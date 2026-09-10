import { describe, expect, it } from "vitest";
import {
  buildRowPredicate,
  describeFilter,
  distinctValues,
  filterKindFor,
  isFilterActive,
  matchesCondition,
  matchesFilter,
  opsForKind,
  type ColumnFilter
} from "../src/core/columnFilter";
import { parseCsv } from "../src/core/parse";

describe("matchesCondition", () => {
  it("handles text operators with Excel wildcards, case-insensitively", () => {
    expect(matchesCondition("Widget, small", { op: "equals", value: "widget, small" }, "text")).toBe(true);
    expect(matchesCondition("Widget", { op: "equals", value: "W*t" }, "text")).toBe(true);
    expect(matchesCondition("Widget", { op: "equals", value: "W?dget" }, "text")).toBe(true);
    expect(matchesCondition("Widget", { op: "equals", value: "Wid" }, "text")).toBe(false);
    expect(matchesCondition("Widget", { op: "notEquals", value: "widget" }, "text")).toBe(false);
    expect(matchesCondition("Widget", { op: "contains", value: "DGE" }, "text")).toBe(true);
    expect(matchesCondition("Widget", { op: "notContains", value: "x" }, "text")).toBe(true);
    expect(matchesCondition("Widget", { op: "beginsWith", value: "wi" }, "text")).toBe(true);
    expect(matchesCondition("Widget", { op: "endsWith", value: "get" }, "text")).toBe(true);
    expect(matchesCondition("a.b", { op: "contains", value: "." }, "text")).toBe(true);
    expect(matchesCondition("axb", { op: "contains", value: "." }, "text")).toBe(false);
  });

  it("handles number operators", () => {
    expect(matchesCondition("12.5", { op: "greaterThan", value: "12" }, "number")).toBe(true);
    expect(matchesCondition("12", { op: "greaterOrEqual", value: "12" }, "number")).toBe(true);
    expect(matchesCondition("1,200", { op: "lessThan", value: "1300" }, "number")).toBe(true);
    expect(matchesCondition("5", { op: "lessOrEqual", value: "4" }, "number")).toBe(false);
    expect(matchesCondition("5", { op: "between", value: "1", value2: "5" }, "number")).toBe(true);
    expect(matchesCondition("abc", { op: "greaterThan", value: "1" }, "number")).toBe(false);
    expect(matchesCondition("10", { op: "equals", value: "10.0" }, "number")).toBe(true);
  });

  it("handles date operators and empties", () => {
    expect(matchesCondition("2024-03-01", { op: "after", value: "2024-02-29" }, "date")).toBe(true);
    expect(matchesCondition("2024-03-01", { op: "before", value: "2024-02-29" }, "date")).toBe(false);
    expect(matchesCondition("2024-03-01", { op: "between", value: "2024-01-01", value2: "2024-12-31" }, "date")).toBe(true);
    expect(matchesCondition("2024-03-01", { op: "equals", value: "2024-03-01" }, "date")).toBe(true);
    expect(matchesCondition("  ", { op: "isEmpty", value: "" }, "text")).toBe(true);
    expect(matchesCondition("x", { op: "isNotEmpty", value: "" }, "text")).toBe(true);
  });
});

describe("matchesFilter and predicates", () => {
  const t = parseCsv("name,qty\nWidget,2\nGadget,10\nGizmo,\nWidget,7\n");

  it("combines value lists with AND/OR conditions", () => {
    const f: ColumnFilter = { values: ["2", "10", ""], condition1: { op: "greaterThan", value: "1" }, logic: "or", condition2: { op: "isEmpty", value: "" } };
    expect(matchesFilter("2", f, "number")).toBe(true);
    expect(matchesFilter("", f, "number")).toBe(true);
    expect(matchesFilter("7", f, "number")).toBe(false);
    const and: ColumnFilter = { condition1: { op: "greaterThan", value: "1" }, logic: "and", condition2: { op: "lessThan", value: "5" } };
    expect(matchesFilter("2", and, "number")).toBe(true);
    expect(matchesFilter("10", and, "number")).toBe(false);
    expect(matchesFilter("anything", undefined, "text")).toBe(true);
    expect(matchesFilter("x", {}, "text")).toBe(true);
  });

  it("builds a row predicate across columns", () => {
    const filters = new Map<number, ColumnFilter>([
      [0, { values: ["Widget", "Gizmo"] }],
      [1, { condition1: { op: "isNotEmpty", value: "" } }]
    ]);
    const pred = buildRowPredicate(filters, ["string", "integer"]);
    expect(t.rows.filter(pred).map((r) => r.join("/"))).toEqual(["Widget/2", "Widget/7"]);
    expect(buildRowPredicate(new Map(), [])(["x"])).toBe(true);
    expect(isFilterActive({})).toBe(false);
    expect(isFilterActive({ values: [] })).toBe(true);
  });

  it("lists distinct values with counts, sorted per kind, blanks last, cascaded", () => {
    const names = distinctValues(t, 0, "text");
    expect(names.values).toEqual([
      { value: "Gadget", count: 1 },
      { value: "Gizmo", count: 1 },
      { value: "Widget", count: 2 }
    ]);
    const qty = distinctValues(t, 1, "number");
    expect(qty.values.map((v) => v.value)).toEqual(["2", "7", "10", ""]);
    const cascaded = distinctValues(t, 1, "number", (row) => row[0] === "Widget");
    expect(cascaded.values.map((v) => v.value)).toEqual(["2", "7"]);
    expect(distinctValues(t, 0, "text", () => true, 2).truncated).toBe(true);
  });

  it("maps types to filter kinds and operators", () => {
    expect(filterKindFor("integer")).toBe("number");
    expect(filterKindFor("date")).toBe("date");
    expect(filterKindFor("boolean")).toBe("text");
    expect(opsForKind("number").map((o) => o.op)).toContain("between");
    expect(opsForKind("text").map((o) => o.op)).not.toContain("greaterThan");
    expect(opsForKind("date").map((o) => o.op)).toContain("before");
  });

  it("describes filters", () => {
    expect(describeFilter(undefined, "text")).toBe("");
    expect(describeFilter({ values: ["a", ""] }, "text")).toBe("Text filter: 2 values: a, (Blanks)");
    expect(describeFilter({ condition1: { op: "greaterThan", value: "5" }, logic: "or", condition2: { op: "isEmpty", value: "" } }, "number")).toBe(
      'Number filter: greater than "5" or is empty'
    );
    expect(describeFilter({ condition1: { op: "between", value: "1", value2: "9" } }, "number")).toBe("Number filter: between 1 and 9");
  });
});
