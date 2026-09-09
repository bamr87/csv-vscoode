import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import * as vm from "node:vm";
import Papa from "papaparse";
import { toJson } from "./core/export";
import { isNumeric, toNumber } from "./core/infer";
import { parseCsv } from "./core/parse";
import { fromObjectTable, identifierFor, stringifyValue, type ObjectTable, type PipelineEvaluator } from "./core/pipeline";
import { serializeCsv } from "./core/serialize";
import type { ColumnType, CsvTable } from "./core/types";
import type { SqlEngine } from "./sqlEngine";

/**
 * Node implementation of the pipeline evaluator: expressions and inline
 * scripts run in a fresh `vm` context, script files are loaded as CommonJS
 * modules in that context, SQL goes through the sql.js engine, and commands
 * spawn a shell with the data on stdin.
 *
 * `vm` is not a security boundary. Pipelines are workspace files, so they
 * are treated like tasks: they only run in trusted workspaces.
 */
export interface EvaluatorOptions {
  workspaceRoot: string;
  sql?: () => Promise<SqlEngine>;
  log?: (message: string) => void;
  /** Milliseconds allowed for a synchronous expression batch or script. */
  timeoutMs?: number;
}

/** Helper functions exposed to expressions and scripts as globals and as `helpers`. */
export function createHelpers(): Record<string, unknown> {
  const num = (v: unknown): number => {
    if (typeof v === "number") {
      return v;
    }
    const s = stringifyValue(v);
    return isNumeric(s) ? toNumber(s) : Number.NaN;
  };
  const str = (v: unknown): string => stringifyValue(v);
  return {
    num,
    str,
    upper: (v: unknown) => str(v).toUpperCase(),
    lower: (v: unknown) => str(v).toLowerCase(),
    title: (v: unknown) => str(v).toLowerCase().replace(/(^|[\s\-_/])(\p{L})/gu, (m) => m.toUpperCase()),
    trim: (v: unknown) => str(v).trim(),
    len: (v: unknown) => (Array.isArray(v) ? v.length : str(v).length),
    round: (v: unknown, digits = 0) => {
      const f = 10 ** digits;
      return Math.round(num(v) * f) / f;
    },
    abs: (v: unknown) => Math.abs(num(v)),
    floor: (v: unknown) => Math.floor(num(v)),
    ceil: (v: unknown) => Math.ceil(num(v)),
    min: (...v: unknown[]) => Math.min(...v.map(num)),
    max: (...v: unknown[]) => Math.max(...v.map(num)),
    isEmpty: (v: unknown) => v === null || v === undefined || str(v).trim() === "",
    isNumber: (v: unknown) => !Number.isNaN(num(v)),
    iif: (cond: unknown, a: unknown, b: unknown) => (cond ? a : b),
    coalesce: (...v: unknown[]) => v.find((x) => x !== null && x !== undefined && str(x) !== "") ?? "",
    contains: (v: unknown, sub: unknown) => str(v).toLowerCase().includes(str(sub).toLowerCase()),
    startsWith: (v: unknown, p: unknown) => str(v).startsWith(str(p)),
    endsWith: (v: unknown, p: unknown) => str(v).endsWith(str(p)),
    replace: (v: unknown, find: unknown, repl: unknown) => str(v).split(str(find)).join(str(repl)),
    regexReplace: (v: unknown, pattern: unknown, repl: unknown, flags = "g") => str(v).replace(new RegExp(str(pattern), flags), str(repl)),
    matches: (v: unknown, pattern: unknown, flags = "") => new RegExp(str(pattern), flags).test(str(v)),
    split: (v: unknown, sep: unknown) => str(v).split(str(sep)),
    join: (v: unknown, sep: unknown = ",") => (Array.isArray(v) ? v.map(str).join(str(sep)) : str(v)),
    left: (v: unknown, n: unknown) => str(v).slice(0, num(n)),
    right: (v: unknown, n: unknown) => str(v).slice(-num(n)),
    substr: (v: unknown, start: unknown, length?: unknown) => str(v).substr(num(start), length === undefined ? undefined : num(length)),
    pad: (v: unknown, width: unknown, ch: unknown = " ", left = true) => (left ? str(v).padStart(num(width), str(ch)) : str(v).padEnd(num(width), str(ch))),
    format: (v: unknown, digits = 2) => (Number.isNaN(num(v)) ? str(v) : num(v).toFixed(digits)),
    date: (v: unknown) => (v instanceof Date ? v : new Date(str(v))),
    isoDate: (v: unknown) => {
      const d = v instanceof Date ? v : new Date(str(v));
      return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
    },
    year: (v: unknown) => new Date(str(v)).getFullYear(),
    month: (v: unknown) => new Date(str(v)).getMonth() + 1,
    day: (v: unknown) => new Date(str(v)).getDate(),
    today: () => new Date().toISOString().slice(0, 10),
    now: () => new Date().toISOString(),
    daysBetween: (a: unknown, b: unknown) => Math.round((new Date(str(b)).getTime() - new Date(str(a)).getTime()) / 86400000),
    hash: (v: unknown) => {
      let h = 0;
      for (const ch of str(v)) {
        h = (h * 31 + ch.charCodeAt(0)) | 0;
      }
      return (h >>> 0).toString(16);
    },
    uuid: () => crypto.randomUUID()
  };
}

const SAFE_GLOBALS = { Math, String, Number, Boolean, Array, Object, Date, JSON, RegExp, Map, Set, parseInt, parseFloat, isNaN, isFinite, Promise, Error };

export class NodePipelineEvaluator implements PipelineEvaluator {
  private readonly timeoutMs: number;

  constructor(private readonly options: EvaluatorOptions) {
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  log(message: string): void {
    this.options.log?.(message);
  }

  private makeContext(extra: Record<string, unknown> = {}): vm.Context {
    const helpers = createHelpers();
    const logs: unknown[][] = [];
    const consoleShim = {
      log: (...args: unknown[]) => {
        logs.push(args);
        this.log(args.map(stringifyValue).join(" "));
      }
    };
    const context = vm.createContext({ ...SAFE_GLOBALS, ...helpers, helpers, console: { ...consoleShim, info: consoleShim.log, warn: consoleShim.log, error: consoleShim.log }, ...extra });
    return context;
  }

  async evaluateRows(expression: string, table: ObjectTable, _types: ColumnType[]): Promise<unknown[]> {
    const trimmed = expression.trim();
    if (trimmed.length === 0) {
      throw new Error("Expression is empty.");
    }
    const identifiers = table.columns.map(identifierFor);
    const seen = new Set<string>();
    const params: string[] = [];
    identifiers.forEach((id, i) => {
      // Duplicate identifiers (after sanitising) are only reachable via row[...]
      if (!seen.has(id) && !(id in createHelpers()) && id !== "row" && id !== "index" && id !== "columns") {
        seen.add(id);
        params.push(`${id} = row[${JSON.stringify(table.columns[i])}]`);
      }
    });
    const source = `(function (row, index, columns) { const ${params.length > 0 ? params.join(", ") : "_unused = 0"}; return (${trimmed}); })`;
    const context = this.makeContext();
    let fn: (row: unknown, index: number, columns: string[]) => unknown;
    try {
      fn = vm.runInContext(source, context, { timeout: this.timeoutMs, filename: "expression.js" }) as typeof fn;
    } catch (error) {
      throw new Error(`Invalid expression: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const started = Date.now();
    const results: unknown[] = [];
    for (let i = 0; i < table.rows.length; i += 1) {
      try {
        results.push(fn(table.rows[i], i, table.columns));
      } catch (error) {
        throw new Error(`Row ${i + 1}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      if ((i & 1023) === 0 && Date.now() - started > this.timeoutMs) {
        throw new Error(`Expression timed out after ${this.timeoutMs} ms.`);
      }
    }
    return results;
  }

  async runScript(code: string, table: ObjectTable): Promise<ObjectTable> {
    const source = `(async function (columns, rows, helpers, table) {\n${code}\n})`;
    const context = this.makeContext();
    let fn: (columns: string[], rows: ObjectTable["rows"], helpers: unknown, table: ObjectTable) => Promise<unknown>;
    try {
      fn = vm.runInContext(source, context, { timeout: this.timeoutMs, filename: "script.js" }) as typeof fn;
    } catch (error) {
      throw new Error(`Script error: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const result = await fn(table.columns, table.rows, context.helpers, table);
    return normalizeScriptResult(result, table);
  }

  async runScriptFile(relativePath: string, table: ObjectTable): Promise<ObjectTable> {
    const full = path.isAbsolute(relativePath) ? relativePath : path.join(this.options.workspaceRoot, relativePath);
    const resolved = path.resolve(full);
    if (!resolved.startsWith(path.resolve(this.options.workspaceRoot))) {
      throw new Error(`Script must be inside the workspace: ${relativePath}`);
    }
    let code: string;
    try {
      code = await readFile(resolved, "utf8");
    } catch (error) {
      throw new Error(`Script file not found: ${relativePath}`, { cause: error });
    }
    const module = { exports: {} as Record<string, unknown> | ((t: ObjectTable, h: unknown) => unknown) };
    const context = this.makeContext({ module, exports: module.exports, __filename: resolved, __dirname: path.dirname(resolved) });
    // Support `export default` by rewriting it to a CommonJS assignment.
    const cjs = code.replace(/^\s*export\s+default\s+/m, "module.exports = ");
    try {
      vm.runInContext(cjs, context, { timeout: this.timeoutMs, filename: resolved });
    } catch (error) {
      throw new Error(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const exported = module.exports as unknown;
    const fn =
      typeof exported === "function"
        ? exported
        : exported && typeof exported === "object" && typeof (exported as Record<string, unknown>).default === "function"
          ? ((exported as Record<string, unknown>).default as (t: ObjectTable, h: unknown) => unknown)
          : exported && typeof exported === "object" && typeof (exported as Record<string, unknown>).transform === "function"
            ? ((exported as Record<string, unknown>).transform as (t: ObjectTable, h: unknown) => unknown)
            : undefined;
    if (!fn) {
      throw new Error(`${relativePath} must export a function (module.exports, export default, or exports.transform).`);
    }
    const result = await (fn as (t: ObjectTable, h: unknown) => unknown)(table, context.helpers);
    return normalizeScriptResult(result, table);
  }

  async runSql(query: string, table: CsvTable): Promise<CsvTable> {
    if (!this.options.sql) {
      throw new Error("SQL steps are not available.");
    }
    const engine = await this.options.sql();
    engine.load(table, { pipeline: true, table });
    const result = engine.query(query, Number.MAX_SAFE_INTEGER);
    return {
      ...table,
      hasHeader: true,
      headers: result.columns,
      rows: result.rows.map((r) => r.map(stringifyValue))
    };
  }

  runCommand(command: string, table: CsvTable, format: "csv" | "json"): Promise<CsvTable> {
    const input = format === "json" ? toJson(table) : serializeCsv({ ...table, trailingNewline: true }, { delimiter: ",", newline: "\n", includeHeader: true });
    return new Promise((resolve, reject) => {
      const child = spawn(command, { shell: true, cwd: this.options.workspaceRoot, env: process.env });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Command timed out after ${this.timeoutMs * 6} ms: ${command}`));
      }, this.timeoutMs * 6);
      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.stderr.on("data", (d: Buffer) => err.push(d));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`Could not start command: ${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const stderr = Buffer.concat(err).toString("utf8").trim();
        if (stderr.length > 0) {
          this.log(`[${command}] ${stderr}`);
        }
        if (code !== 0) {
          reject(new Error(`Command exited with code ${code}: ${command}${stderr ? `\n${stderr}` : ""}`));
          return;
        }
        const stdout = Buffer.concat(out).toString("utf8");
        try {
          resolve(parseCommandOutput(stdout, format, table));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.on("error", () => {
        // The command may exit before reading all input; the close handler reports it.
      });
      child.stdin.end(input);
    });
  }
}

function normalizeScriptResult(result: unknown, input: ObjectTable): ObjectTable {
  if (result === undefined) {
    // Scripts may mutate rows in place and return nothing.
    return input;
  }
  if (Array.isArray(result)) {
    return fromObjectTableToObject(result);
  }
  if (result && typeof result === "object" && Array.isArray((result as ObjectTable).rows)) {
    const r = result as ObjectTable;
    return { columns: Array.isArray(r.columns) ? r.columns.map(String) : [], rows: r.rows };
  }
  throw new Error("Script must return an array of row objects, { columns, rows }, or nothing.");
}

function fromObjectTableToObject(rows: unknown[]): ObjectTable {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      throw new Error("Every row must be an object.");
    }
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return { columns, rows: rows as ObjectTable["rows"] };
}

function parseCommandOutput(stdout: string, format: "csv" | "json", base: CsvTable): CsvTable {
  if (format === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Command output is not valid JSON:\n${stdout.slice(0, 300)}`, { cause: error });
    }
    if (!Array.isArray(parsed)) {
      throw new Error("Command output must be a JSON array of objects.");
    }
    return fromObjectTable(parsed as Record<string, unknown>[], base);
  }
  const parsed = Papa.parse<string[]>(stdout, { delimiter: ",", skipEmptyLines: true, header: false });
  const table = parseCsv(stdout, { delimiter: ",", hasHeader: true });
  if (parsed.data.length === 0) {
    return { ...base, headers: [], rows: [] };
  }
  return { ...base, hasHeader: true, headers: table.headers, rows: table.rows };
}
