import { describe, expect, it } from "vitest";
import { inferColumnType, inferColumnTypes, isBoolean, isDate, isNumeric, toNumber } from "../src/core/infer";
import { parseCsv } from "../src/core/parse";
import { computeColumnStats, histogram, summarizeValues } from "../src/core/stats";

describe("value predicates", () => {
  it("recognises numbers including thousands separators and exponents", () => {
    expect(isNumeric("42")).toBe(true);
    expect(isNumeric("-3.5")).toBe(true);
    expect(isNumeric("1,234,567.89")).toBe(true);
    expect(isNumeric("1e10")).toBe(true);
    expect(isNumeric("")).toBe(false);
    expect(isNumeric("abc")).toBe(false);
    expect(isNumeric("12abc")).toBe(false);
    expect(toNumber("1,234.5")).toBe(1234.5);
    expect(Number.isNaN(toNumber("x"))).toBe(true);
  });

  it("recognises booleans and dates", () => {
    expect(isBoolean("TRUE")).toBe(true);
    expect(isBoolean("no")).toBe(true);
    expect(isBoolean("maybe")).toBe(false);
    expect(isDate("2024-01-31")).toBe(true);
    expect(isDate("2024-01-31T10:00:00Z")).toBe(true);
    expect(isDate("1/31/2024")).toBe(true);
    expect(isDate("31st")).toBe(false);
  });
});

describe("inferColumnType", () => {
  it("infers integer, number, boolean, date, string and empty", () => {
    expect(inferColumnType(["1", "2", "3"])).toBe("integer");
    expect(inferColumnType(["1.5", "2", "3"])).toBe("number");
    expect(inferColumnType(["true", "false", ""])).toBe("boolean");
    expect(inferColumnType(["2024-01-01", "2024-02-01"])).toBe("date");
    expect(inferColumnType(["a", "b"])).toBe("string");
    expect(inferColumnType(["", " "])).toBe("empty");
  });

  it("tolerates a few dirty values", () => {
    const values = Array.from({ length: 100 }, (_, i) => String(i));
    values[3] = "n/a";
    expect(inferColumnType(values)).toBe("integer");
  });

  it("infers every column of a table", () => {
    const t = parseCsv("id,price,ok,when,label\n1,1.5,true,2024-01-01,a\n2,2.5,false,2024-01-02,b\n");
    expect(inferColumnTypes(t)).toEqual(["integer", "number", "boolean", "date", "string"]);
  });
});

describe("stats", () => {
  it("computes numeric statistics", () => {
    const t = parseCsv("v,w\n1,a\n2,b\n3,c\n4,d\n,e\n");
    const s = computeColumnStats(t, 0);
    expect(s.type).toBe("integer");
    expect(s.count).toBe(4);
    expect(s.empty).toBe(1);
    expect(s.distinct).toBe(4);
    expect(s.numeric?.sum).toBe(10);
    expect(s.numeric?.mean).toBe(2.5);
    expect(s.numeric?.median).toBe(2.5);
    expect(s.numeric?.min).toBe(1);
    expect(s.numeric?.max).toBe(4);
    expect(s.histogram?.reduce((a, b) => a + b.count, 0)).toBe(4);
    // Bucket bounds use a precision derived from the bucket width (0.25 here).
    expect(s.histogram?.[0].label).toBe("1.00\u20131.25");
  });

  it("computes top values for strings", () => {
    const t = parseCsv("c\nx\ny\nx\nz\nx\ny\n");
    const s = computeColumnStats(t, 0, 2);
    expect(s.type).toBe("string");
    expect(s.topValues).toEqual([
      { value: "x", count: 3 },
      { value: "y", count: 2 }
    ]);
    expect(s.minValue).toBe("x");
    expect(s.maxValue).toBe("z");
    expect(s.numeric).toBeUndefined();
  });

  it("builds histograms and summaries", () => {
    expect(histogram([5, 5, 5], 4)).toEqual([{ label: "5", count: 3 }]);
    expect(histogram([], 4)).toEqual([]);
    const sum = summarizeValues(["1", "2", "x", ""]);
    expect(sum.cells).toBe(4);
    expect(sum.numeric).toBe(2);
    expect(sum.sum).toBe(3);
    expect(sum.mean).toBe(1.5);
    expect(sum.min).toBe(1);
    expect(sum.max).toBe(2);
  });
});
