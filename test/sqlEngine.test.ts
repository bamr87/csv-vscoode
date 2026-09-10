import initSqlJs from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "../src/core/parse";
import { SqlEngine } from "../src/sqlEngine";

let engine: SqlEngine;

beforeAll(async () => {
  const SQL = await initSqlJs();
  engine = new SqlEngine(SQL);
});

const table = () => parseCsv('id,name,price,"odd ""name"""\n1,foo,1.5,a\n2,bar,,b\n3,foo,2.5,c\n');

describe("SqlEngine", () => {
  it("loads the table with typed columns and runs aggregate queries", () => {
    engine.load(table(), "v1");
    const result = engine.query('SELECT name, COUNT(*) AS n, SUM(price) AS total FROM csv GROUP BY name ORDER BY name', 100);
    expect(result.columns).toEqual(["name", "n", "total"]);
    expect(result.rows).toEqual([
      ["bar", 1, null],
      ["foo", 2, 4]
    ]);
    expect(result.truncated).toBe(false);
    expect(result.totalRows).toBe(2);
  });

  it("quotes awkward column names", () => {
    engine.load(table(), "v1");
    const result = engine.query('SELECT "odd ""name""" FROM csv WHERE id = 2', 100);
    expect(result.rows).toEqual([["b"]]);
  });

  it("truncates large results but reports the total", () => {
    engine.load(table(), "v1");
    const result = engine.query("SELECT * FROM csv", 2);
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.totalRows).toBe(3);
  });

  it("reloads when the version changes", () => {
    const t = table();
    t.rows.push(["4", "new", "9", "d"]);
    engine.load(t, "v2");
    expect(engine.query("SELECT COUNT(*) FROM csv", 10).rows[0][0]).toBe(4);
  });

  it("surfaces SQL errors", () => {
    engine.load(table(), "v3");
    expect(() => engine.query("SELECT nope FROM csv", 10)).toThrow(/no such column/);
  });

  it("does not write to the source table between runs", () => {
    engine.load(table(), "v4");
    engine.query("DELETE FROM csv", 10);
    engine.load(table(), "v5");
    expect(engine.query("SELECT COUNT(*) FROM csv", 10).rows[0][0]).toBe(3);
  });
});
