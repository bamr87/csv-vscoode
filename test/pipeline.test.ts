import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/core/parse";
import {
  applyPureStep,
  defaultStep,
  fromObjectTable,
  globToRegExp,
  matchesGlobs,
  resolveOutputPath,
  runPipeline,
  STEP_DEFINITIONS,
  toObjectTable,
  validatePipeline,
  type PipelineEvaluator
} from "../src/core/pipeline";
import { NodePipelineEvaluator } from "../src/pipelineEvaluator";

const table = () => parseCsv("name,category,price,qty,in_stock\n Widget ,widgets,1.5,2,true\nGadget,GADGETS,12,,false\nWidget,widgets,1.5,2,true\nGizmo,gizmos,7.25,8,yes\n");

describe("pure steps", () => {
  it("trims, changes case, fills, dedupes, sorts, limits", () => {
    let t = applyPureStep(table(), { kind: "trim" });
    expect(t.rows[0][0]).toBe("Widget");
    t = applyPureStep(t, { kind: "changeCase", columns: ["category"], case: "title" });
    expect(t.rows.map((r) => r[1])).toEqual(["Widgets", "Gadgets", "Widgets", "Gizmos"]);
    t = applyPureStep(t, { kind: "fillEmpty", columns: ["qty"], value: "0" });
    expect(t.rows[1][3]).toBe("0");
    t = applyPureStep(t, { kind: "dedupe" });
    expect(t.rows).toHaveLength(3);
    t = applyPureStep(t, { kind: "sort", column: "price", direction: "desc" });
    expect(t.rows.map((r) => r[0])).toEqual(["Gadget", "Gizmo", "Widget"]);
    t = applyPureStep(t, { kind: "limit", count: 1, offset: 1 });
    expect(t.rows.map((r) => r[0])).toEqual(["Gizmo"]);
  });

  it("renames, selects, drops and replaces", () => {
    let t = applyPureStep(table(), { kind: "rename", from: "qty", to: "quantity" });
    expect(t.headers).toEqual(["name", "category", "price", "quantity", "in_stock"]);
    t = applyPureStep(t, { kind: "select", columns: ["quantity", "name"] });
    expect(t.headers).toEqual(["quantity", "name"]);
    expect(t.rows[0]).toEqual(["2", " Widget "]);
    t = applyPureStep(t, { kind: "drop", columns: ["quantity"] });
    expect(t.headers).toEqual(["name"]);
    t = applyPureStep(t, { kind: "replace", find: "widget", replacement: "W", regex: false });
    expect(t.rows[0][0]).toBe(" W ");
    t = applyPureStep(t, { kind: "replace", find: "^\\s+|\\s+$", replacement: "", regex: true });
    expect(t.rows[0][0]).toBe("W");
  });

  it("rejects unknown columns", () => {
    expect(() => applyPureStep(table(), { kind: "drop", columns: ["nope"] })).toThrow(/Unknown column "nope"/);
  });

  it("dedupes on selected columns and works without a header row", () => {
    const t = applyPureStep(table(), { kind: "dedupe", columns: ["price"] });
    expect(t.rows).toHaveLength(3);
    const noHeader = parseCsv("b\na\n", { hasHeader: false });
    const sorted = applyPureStep(noHeader, { kind: "sort", column: "Column 1", direction: "asc" });
    expect(sorted.rows.map((r) => r[0])).toEqual(["a", "b"]);
  });
});

describe("object conversion", () => {
  it("coerces numeric and boolean columns", () => {
    const obj = toObjectTable(table());
    expect(obj.columns).toEqual(["name", "category", "price", "qty", "in_stock"]);
    expect(obj.rows[0]).toEqual({ name: " Widget ", category: "widgets", price: 1.5, qty: 2, in_stock: true });
    expect(obj.rows[1].qty).toBeNull();
  });

  it("converts back, adding new columns and stringifying values", () => {
    const t = fromObjectTable([{ a: 1, b: null }, { a: "x", c: new Date("2024-01-01T00:00:00Z") }], table());
    expect(t.headers).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual([
      ["1", "", ""],
      ["x", "", "2024-01-01T00:00:00.000Z"]
    ]);
  });
});

describe("runPipeline", () => {
  const fake: PipelineEvaluator = {
    async evaluateRows(expression, t) {
      return t.rows.map((r) => (expression === "price > 5" ? Number(r.price) > 5 : Number(r.price) * Number(r.qty ?? 0)));
    },
    async runScript(_code, t) {
      return { columns: t.columns, rows: t.rows.map((r) => ({ ...r, tag: "s" })) };
    },
    async runScriptFile() {
      throw new Error("no files here");
    },
    async runSql(_q, t) {
      return { ...t, headers: ["n"], rows: [[String(t.rows.length)]] };
    },
    async runCommand(_c, t) {
      return t;
    }
  };

  it("runs mixed steps in order and reports each", async () => {
    const result = await runPipeline(table(), { name: "p", steps: [{ kind: "trim" }, { kind: "filter", expression: "price > 5" }, { kind: "compute", column: "total", expression: "price * qty" }, { kind: "script", code: "x" }] }, fake);
    expect(result.ok).toBe(true);
    expect(result.table.headers).toEqual(["name", "category", "price", "qty", "in_stock", "total", "tag"]);
    expect(result.table.rows.map((r) => r[0])).toEqual(["Gadget", "Gizmo"]);
    expect(result.table.rows[1][5]).toBe("58");
    expect(result.steps.map((s) => [s.rowsIn, s.rowsOut])).toEqual([
      [4, 4],
      [4, 2],
      [2, 2],
      [2, 2]
    ]);
  });

  it("stops at a failing step and skips disabled ones", async () => {
    const result = await runPipeline(table(), { name: "p", steps: [{ kind: "limit", count: 2, disabled: true }, { kind: "scriptFile", path: "x.js" }, { kind: "trim" }] }, fake);
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].skipped).toBe(true);
    expect(result.steps[1].error).toMatch(/no files/);
    expect(result.table.rows).toHaveLength(4);
  });

  it("replaces the table with SQL results", async () => {
    const result = await runPipeline(table(), { name: "p", steps: [{ kind: "sql", query: "q" }] }, fake);
    expect(result.table.headers).toEqual(["n"]);
    expect(result.table.rows).toEqual([["4"]]);
  });
});

describe("validation and helpers", () => {
  it("validates pipelines", () => {
    expect(validatePipeline({ name: "x", steps: [{ kind: "trim" }] })).toEqual([]);
    expect(validatePipeline({ steps: [] })).toContain('"name" is required.');
    expect(validatePipeline({ name: "x", steps: [{ kind: "filter" }] })[0]).toMatch(/"expression" is required/);
    expect(validatePipeline({ name: "x", steps: [{ kind: "nope" }] })[0]).toMatch(/unknown kind/);
    expect(validatePipeline({ name: "x", steps: [], trigger: "sometimes" })[0]).toMatch(/trigger/);
  });

  it("has a default for every step kind", () => {
    for (const def of STEP_DEFINITIONS) {
      expect(defaultStep(def.kind).kind).toBe(def.kind);
    }
  });

  it("matches globs", () => {
    expect(globToRegExp("data/*.csv").test("data/a.csv")).toBe(true);
    expect(globToRegExp("data/*.csv").test("data/sub/a.csv")).toBe(false);
    expect(globToRegExp("**/*.csv").test("data/sub/a.csv")).toBe(true);
    expect(globToRegExp("**/*.csv").test("a.csv")).toBe(true);
    expect(globToRegExp("*.{csv,tsv}").test("x.tsv")).toBe(true);
    expect(matchesGlobs("samples/products.csv", ["samples/products.csv"])).toBe(true);
    expect(matchesGlobs("samples/products.csv", ["*.csv"])).toBe(true);
    expect(matchesGlobs("samples/products.csv", ["other/*.csv"])).toBe(false);
    expect(matchesGlobs("x.csv", undefined)).toBe(false);
  });

  it("resolves output paths", () => {
    expect(resolveOutputPath("out/${name}.json", "data/products.csv", "My pipe")).toBe("out/products.json");
    expect(resolveOutputPath("${dir}/${name}-${pipeline}.${ext}", "data/products.csv", "My pipe")).toBe("data/products-My_pipe.csv");
    expect(resolveOutputPath("${dir}/x.csv", "products.csv", "p")).toBe("x.csv");
  });
});

describe("NodePipelineEvaluator", () => {
  const evaluator = new NodePipelineEvaluator({ workspaceRoot: process.cwd(), timeoutMs: 2000 });

  it("evaluates expressions with columns as variables and helpers", async () => {
    const t = toObjectTable(table());
    const results = await evaluator.evaluateRows("in_stock && price * (qty ?? 0) > 5", t, []);
    expect(results).toEqual([false, false, false, true]);
    const totals = await evaluator.evaluateRows("round(price * coalesce(qty, 0), 1) + ' ' + upper(trim(name))", t, []);
    expect(totals[0]).toBe("3 WIDGET");
    const rowAccess = await evaluator.evaluateRows('row["in_stock"] === true ? index : -1', t, []);
    expect(rowAccess).toEqual([0, -1, 2, 3]);
  });

  it("sanitises awkward column names", async () => {
    const t = { columns: ["unit price", "2nd"], rows: [{ "unit price": 2, "2nd": 3 }] };
    expect(await evaluator.evaluateRows("unit_price * _2nd", t, [])).toEqual([6]);
  });

  it("reports invalid expressions and runtime errors", async () => {
    const t = toObjectTable(table());
    await expect(evaluator.evaluateRows("price >", t, [])).rejects.toThrow(/Invalid expression/);
    await expect(evaluator.evaluateRows("nope.x", t, [])).rejects.toThrow(/Row 1/);
    await expect(evaluator.evaluateRows("", t, [])).rejects.toThrow(/empty/);
  });

  it("does not expose Node globals to expressions", async () => {
    const t = toObjectTable(table());
    await expect(evaluator.evaluateRows("typeof process", t, [])).resolves.toEqual(["undefined", "undefined", "undefined", "undefined"]);
    await expect(evaluator.evaluateRows("require('fs')", t, [])).rejects.toThrow();
  });

  it("runs inline scripts returning rows, tables, or nothing", async () => {
    const t = toObjectTable(table());
    const rows = await evaluator.runScript("return rows.filter((r) => r.in_stock).map((r) => ({ name: trim(r.name), total: r.price * r.qty }));", t);
    expect(rows.columns).toEqual(["name", "total"]);
    expect(rows.rows).toHaveLength(3);
    const tbl = await evaluator.runScript("return { columns: ['n'], rows: [{ n: rows.length }] };", t);
    expect(tbl.rows).toEqual([{ n: 4 }]);
    const mutated = await evaluator.runScript("for (const r of rows) r.name = r.name.trim();", t);
    expect(mutated.rows[0].name).toBe("Widget");
    await expect(evaluator.runScript("return 42;", t)).rejects.toThrow(/must return/);
    await expect(evaluator.runScript("this is not js", t)).rejects.toThrow(/Script error/);
  });

  it("runs script files from the workspace", async () => {
    const t = { columns: ["category", "stock_value"], rows: [{ category: "a", stock_value: 1.234 }] };
    const out = await evaluator.runScriptFile("samples/scripts/add-rank.js", t);
    expect(out.columns).toEqual(["rank", "category", "stock_value"]);
    expect(out.rows[0]).toEqual({ rank: 1, category: "a", stock_value: "1.23" });
    await expect(evaluator.runScriptFile("../outside.js", t)).rejects.toThrow(/inside the workspace/);
    await expect(evaluator.runScriptFile("samples/scripts/missing.js", t)).rejects.toThrow(/not found/);
  });

  it("pipes CSV and JSON through external commands", async () => {
    const t = table();
    const echoed = await evaluator.runCommand("node -e \"process.stdin.pipe(process.stdout)\"", t, "csv");
    expect(echoed.headers).toEqual(t.headers);
    expect(echoed.rows).toEqual(t.rows);
    const json = await evaluator.runCommand(
      "node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s).map(r=>({n:r.name.trim()})))))\"",
      t,
      "json"
    );
    expect(json.headers).toEqual(["n"]);
    expect(json.rows[0]).toEqual(["Widget"]);
    await expect(evaluator.runCommand("node -e \"process.exit(3)\"", t, "csv")).rejects.toThrow(/exited with code 3/);
  });
});
