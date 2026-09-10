import { applyEdit, applyEdits } from "./edits";
import type { ExportFormat } from "./export";
import { inferColumnTypes, isNumeric, toNumber } from "./infer";
import { duplicateRowIndices, emptyRowIndices, mergeColumnsOps, sampleRowIndices, splitColumnOps, transposeTable } from "./transform";
import type { ColumnType, CsvTable } from "./types";
import { columnCount, columnNames } from "./types";

/**
 * Data-processing pipelines.
 *
 * A pipeline is an ordered list of steps applied to a table. Steps come in
 * three flavours:
 *
 * - **no-code**: fully described by form fields (rename, sort, dedupe…) and
 *   implemented here without any evaluation.
 * - **low-code**: a one-line expression evaluated per row (`filter`,
 *   `compute`).
 * - **code**: inline JavaScript, a script file, a SQL query, or an external
 *   command that receives the data on stdin and writes it to stdout.
 *
 * Evaluation of the last two flavours is delegated to a `PipelineEvaluator`
 * supplied by the host, which keeps this module free of Node and VS Code
 * dependencies and lets the webview reuse the step definitions for its UI.
 */

export type StepKind =
  | "filter"
  | "compute"
  | "rename"
  | "select"
  | "drop"
  | "sort"
  | "dedupe"
  | "trim"
  | "changeCase"
  | "replace"
  | "fillEmpty"
  | "limit"
  | "splitColumn"
  | "mergeColumns"
  | "transpose"
  | "removeEmptyRows"
  | "sample"
  | "script"
  | "scriptFile"
  | "sql"
  | "command";

interface StepBase {
  kind: StepKind;
  /** Optional label shown in the UI and logs. */
  label?: string;
  /** Skip this step without deleting it. */
  disabled?: boolean;
}

export type PipelineStep =
  | (StepBase & { kind: "filter"; expression: string })
  | (StepBase & { kind: "compute"; column: string; expression: string })
  | (StepBase & { kind: "rename"; from: string; to: string })
  | (StepBase & { kind: "select"; columns: string[] })
  | (StepBase & { kind: "drop"; columns: string[] })
  | (StepBase & { kind: "sort"; column: string; direction: "asc" | "desc" })
  | (StepBase & { kind: "dedupe"; columns?: string[] })
  | (StepBase & { kind: "trim"; columns?: string[] })
  | (StepBase & { kind: "changeCase"; columns?: string[]; case: "upper" | "lower" | "title" })
  | (StepBase & { kind: "replace"; columns?: string[]; find: string; replacement: string; regex?: boolean; caseSensitive?: boolean })
  | (StepBase & { kind: "fillEmpty"; columns?: string[]; value: string })
  | (StepBase & { kind: "limit"; count: number; offset?: number })
  | (StepBase & { kind: "splitColumn"; column: string; separator: string; limit?: number; regex?: boolean; removeSource?: boolean })
  | (StepBase & { kind: "mergeColumns"; columns: string[]; separator: string; name: string; removeSources?: boolean })
  | (StepBase & { kind: "transpose" })
  | (StepBase & { kind: "removeEmptyRows" })
  | (StepBase & { kind: "sample"; count: number; seed?: number })
  | (StepBase & { kind: "script"; code: string })
  | (StepBase & { kind: "scriptFile"; path: string })
  | (StepBase & { kind: "sql"; query: string })
  | (StepBase & { kind: "command"; command: string; format?: "csv" | "json" });

export type PipelineTrigger = "manual" | "onOpen" | "onSave";
export type OutputTarget = "replace" | "newDocument" | "file" | "clipboard";

export interface PipelineOutput {
  target: OutputTarget;
  format?: ExportFormat;
  /**
   * Destination for `target: "file"`. Relative to the workspace folder.
   * Supports `${name}` (source file name without extension), `${ext}`,
   * `${dir}` (source directory, workspace-relative) and `${pipeline}`.
   */
  path?: string;
}

export interface Pipeline {
  name: string;
  description?: string;
  /** Glob patterns (workspace-relative) for files this pipeline applies to. */
  applyTo?: string[];
  trigger?: PipelineTrigger;
  steps: PipelineStep[];
  output?: PipelineOutput;
}

/** Rows as objects: the shape scripts and expressions see. */
export interface ObjectTable {
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
}

/** Host-provided evaluation of the code/low-code steps. */
export interface PipelineEvaluator {
  /** Evaluate an expression for each row; returns one value per row. */
  evaluateRows(expression: string, table: ObjectTable, types: ColumnType[]): Promise<unknown[]>;
  runScript(code: string, table: ObjectTable): Promise<ObjectTable>;
  runScriptFile(path: string, table: ObjectTable): Promise<ObjectTable>;
  runSql(query: string, table: CsvTable): Promise<CsvTable>;
  runCommand(command: string, table: CsvTable, format: "csv" | "json"): Promise<CsvTable>;
  log?(message: string): void;
}

export interface StepReport {
  index: number;
  kind: StepKind;
  label: string;
  rowsIn: number;
  rowsOut: number;
  columnsOut: number;
  durationMs: number;
  error?: string;
  skipped?: boolean;
}

export interface PipelineResult {
  table: CsvTable;
  steps: StepReport[];
  ok: boolean;
}

/** UI metadata describing each step kind and its fields. */
export interface StepFieldDef {
  key: string;
  label: string;
  type: "text" | "expression" | "column" | "columns" | "select" | "code" | "number" | "boolean";
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  hint?: string;
}

export interface StepDef {
  kind: StepKind;
  label: string;
  tier: "no-code" | "low-code" | "code";
  description: string;
  fields: StepFieldDef[];
}

export const STEP_DEFINITIONS: StepDef[] = [
  {
    kind: "filter",
    label: "Filter rows",
    tier: "low-code",
    description: "Keep rows where the expression is true.",
    fields: [{ key: "expression", label: "Expression", type: "expression", placeholder: "price > 5 && category != 'Gizmos'", required: true }]
  },
  {
    kind: "compute",
    label: "Compute column",
    tier: "low-code",
    description: "Add or overwrite a column with the value of an expression.",
    fields: [
      { key: "column", label: "Column", type: "column", placeholder: "total", required: true },
      { key: "expression", label: "Expression", type: "expression", placeholder: "round(price * qty, 2)", required: true }
    ]
  },
  {
    kind: "rename",
    label: "Rename column",
    tier: "no-code",
    description: "Rename one column.",
    fields: [
      { key: "from", label: "From", type: "column", required: true },
      { key: "to", label: "To", type: "text", required: true }
    ]
  },
  {
    kind: "select",
    label: "Select columns",
    tier: "no-code",
    description: "Keep only these columns, in this order.",
    fields: [{ key: "columns", label: "Columns", type: "columns", required: true }]
  },
  {
    kind: "drop",
    label: "Drop columns",
    tier: "no-code",
    description: "Remove these columns.",
    fields: [{ key: "columns", label: "Columns", type: "columns", required: true }]
  },
  {
    kind: "sort",
    label: "Sort rows",
    tier: "no-code",
    description: "Sort by a column (numeric columns sort numerically).",
    fields: [
      { key: "column", label: "Column", type: "column", required: true },
      {
        key: "direction",
        label: "Direction",
        type: "select",
        options: [
          { value: "asc", label: "Ascending" },
          { value: "desc", label: "Descending" }
        ]
      }
    ]
  },
  {
    kind: "dedupe",
    label: "Remove duplicates",
    tier: "no-code",
    description: "Keep the first row for each distinct combination of the chosen columns (all columns when empty).",
    fields: [{ key: "columns", label: "Columns", type: "columns", hint: "Leave empty to compare whole rows" }]
  },
  {
    kind: "trim",
    label: "Trim whitespace",
    tier: "no-code",
    description: "Strip leading and trailing whitespace.",
    fields: [{ key: "columns", label: "Columns", type: "columns", hint: "Leave empty for all columns" }]
  },
  {
    kind: "changeCase",
    label: "Change case",
    tier: "no-code",
    description: "Upper-case, lower-case or title-case text.",
    fields: [
      { key: "columns", label: "Columns", type: "columns", hint: "Leave empty for all columns" },
      {
        key: "case",
        label: "Case",
        type: "select",
        options: [
          { value: "upper", label: "UPPER" },
          { value: "lower", label: "lower" },
          { value: "title", label: "Title" }
        ]
      }
    ]
  },
  {
    kind: "replace",
    label: "Find and replace",
    tier: "no-code",
    description: "Replace text in cells.",
    fields: [
      { key: "columns", label: "Columns", type: "columns", hint: "Leave empty for all columns" },
      { key: "find", label: "Find", type: "text", required: true },
      { key: "replacement", label: "Replace with", type: "text" },
      { key: "regex", label: "Regular expression", type: "boolean" },
      { key: "caseSensitive", label: "Match case", type: "boolean" }
    ]
  },
  {
    kind: "fillEmpty",
    label: "Fill empty cells",
    tier: "no-code",
    description: "Replace empty cells with a value.",
    fields: [
      { key: "columns", label: "Columns", type: "columns", hint: "Leave empty for all columns" },
      { key: "value", label: "Value", type: "text", required: true }
    ]
  },
  {
    kind: "limit",
    label: "Limit rows",
    tier: "no-code",
    description: "Keep at most N rows, optionally skipping some first.",
    fields: [
      { key: "count", label: "Count", type: "number", required: true },
      { key: "offset", label: "Offset", type: "number" }
    ]
  },
  {
    kind: "splitColumn",
    label: "Split column",
    tier: "no-code",
    description: "Split one column into several on a separator (Excel \"Text to Columns\").",
    fields: [
      { key: "column", label: "Column", type: "column", required: true },
      { key: "separator", label: "Separator", type: "text", placeholder: ", ", required: true },
      { key: "limit", label: "Max parts", type: "number", hint: "0 = unlimited" },
      { key: "regex", label: "Regular expression", type: "boolean" },
      { key: "removeSource", label: "Remove source column", type: "boolean" }
    ]
  },
  {
    kind: "mergeColumns",
    label: "Merge columns",
    tier: "no-code",
    description: "Concatenate columns into a new column.",
    fields: [
      { key: "columns", label: "Columns", type: "columns", required: true },
      { key: "separator", label: "Separator", type: "text", placeholder: " " },
      { key: "name", label: "New column", type: "text", required: true },
      { key: "removeSources", label: "Remove source columns", type: "boolean" }
    ]
  },
  {
    kind: "transpose",
    label: "Transpose",
    tier: "no-code",
    description: "Swap rows and columns.",
    fields: []
  },
  {
    kind: "removeEmptyRows",
    label: "Remove empty rows",
    tier: "no-code",
    description: "Drop rows whose cells are all blank.",
    fields: []
  },
  {
    kind: "sample",
    label: "Random sample",
    tier: "no-code",
    description: "Keep a random subset of rows (deterministic for a given seed).",
    fields: [
      { key: "count", label: "Rows", type: "number", required: true },
      { key: "seed", label: "Seed", type: "number" }
    ]
  },
  {
    kind: "script",
    label: "JavaScript",
    tier: "code",
    description: "Inline JavaScript. Receives { columns, rows } and returns rows (array of objects) or { columns, rows }.",
    fields: [
      {
        key: "code",
        label: "Code",
        type: "code",
        placeholder: "return rows.map((r) => ({ ...r, total: Number(r.price) * Number(r.qty) }));",
        required: true
      }
    ]
  },
  {
    kind: "scriptFile",
    label: "Script file",
    tier: "code",
    description: "A workspace .js/.mjs file exporting a function (table, helpers) => table.",
    fields: [{ key: "path", label: "Path", type: "text", placeholder: "scripts/clean.js", required: true }]
  },
  {
    kind: "sql",
    label: "SQL",
    tier: "code",
    description: "SQLite query over the current data (table name: csv). The result becomes the new data.",
    fields: [{ key: "query", label: "Query", type: "code", placeholder: "SELECT category, SUM(price) AS total FROM csv GROUP BY category", required: true }]
  },
  {
    kind: "command",
    label: "External command",
    tier: "code",
    description: "Run a shell command (Python, R, jq…). Data is written to stdin and read back from stdout.",
    fields: [
      { key: "command", label: "Command", type: "text", placeholder: "python3 scripts/clean.py", required: true },
      {
        key: "format",
        label: "Data format",
        type: "select",
        options: [
          { value: "csv", label: "CSV" },
          { value: "json", label: "JSON" }
        ]
      }
    ]
  }
];

export function stepDefinition(kind: StepKind): StepDef {
  const def = STEP_DEFINITIONS.find((d) => d.kind === kind);
  if (!def) {
    throw new Error(`Unknown step kind: ${kind}`);
  }
  return def;
}

/** Create a step with empty/default fields. */
export function defaultStep(kind: StepKind): PipelineStep {
  switch (kind) {
    case "filter":
      return { kind, expression: "" };
    case "compute":
      return { kind, column: "", expression: "" };
    case "rename":
      return { kind, from: "", to: "" };
    case "select":
    case "drop":
      return { kind, columns: [] };
    case "sort":
      return { kind, column: "", direction: "asc" };
    case "dedupe":
    case "trim":
      return { kind, columns: [] };
    case "changeCase":
      return { kind, columns: [], case: "upper" };
    case "replace":
      return { kind, columns: [], find: "", replacement: "" };
    case "fillEmpty":
      return { kind, columns: [], value: "" };
    case "limit":
      return { kind, count: 100, offset: 0 };
    case "splitColumn":
      return { kind, column: "", separator: ",", limit: 0 };
    case "mergeColumns":
      return { kind, columns: [], separator: " ", name: "merged" };
    case "transpose":
    case "removeEmptyRows":
      return { kind };
    case "sample":
      return { kind, count: 100, seed: 42 };
    case "script":
      return { kind, code: "" };
    case "scriptFile":
      return { kind, path: "" };
    case "sql":
      return { kind, query: "" };
    case "command":
      return { kind, command: "", format: "csv" };
  }
}

// --- Table conversions --------------------------------------------------------

/** Make a column name usable as a JavaScript identifier. */
export function identifierFor(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function coerce(value: string, type: ColumnType): string | number | boolean | null {
  if (value === "") {
    return type === "string" || type === "empty" ? "" : null;
  }
  if ((type === "number" || type === "integer") && isNumeric(value)) {
    return toNumber(value);
  }
  if (type === "boolean") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "y", "t"].includes(v)) {
      return true;
    }
    if (["false", "no", "n", "f"].includes(v)) {
      return false;
    }
  }
  return value;
}

/** Convert to object rows, coercing numeric and boolean columns by inferred type. */
export function toObjectTable(table: CsvTable, types: ColumnType[] = inferColumnTypes(table)): ObjectTable {
  const columns = columnNames(table);
  const width = columns.length;
  const rows = table.rows.map((row) => {
    const obj: Record<string, string | number | boolean | null> = {};
    for (let c = 0; c < width; c += 1) {
      obj[columns[c]] = coerce(row[c] ?? "", types[c] ?? "string");
    }
    return obj;
  });
  return { columns, rows };
}

export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/** Convert object rows back to a CsvTable, keeping the base table's formatting. */
export function fromObjectTable(objects: ObjectTable | Record<string, unknown>[], base: CsvTable): CsvTable {
  const rowsIn = Array.isArray(objects) ? objects : objects.rows;
  let columns = Array.isArray(objects) ? [] : [...objects.columns];
  if (!Array.isArray(rowsIn)) {
    throw new Error("Script must return an array of rows or { columns, rows }.");
  }
  const seen = new Set(columns);
  for (const row of rowsIn) {
    if (row === null || typeof row !== "object") {
      throw new Error("Every row must be an object.");
    }
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  if (columns.length === 0 && rowsIn.length === 0) {
    columns = columnNames(base);
  }
  return {
    ...base,
    headers: columns,
    hasHeader: true,
    rows: rowsIn.map((row) => columns.map((c) => stringifyValue((row as Record<string, unknown>)[c])))
  };
}

// --- Pure step implementations ------------------------------------------------

function resolveColumns(table: CsvTable, names: string[] | undefined): number[] {
  const all = columnNames(table);
  if (!names || names.length === 0) {
    return all.map((_, i) => i);
  }
  const indices: number[] = [];
  for (const name of names) {
    const idx = all.indexOf(name);
    if (idx === -1) {
      throw new Error(`Unknown column "${name}". Available: ${all.join(", ")}`);
    }
    indices.push(idx);
  }
  return indices;
}

/** Deep copy with explicit headers so column ops behave the same with or without a header row. */
function withHeaders(table: CsvTable): CsvTable {
  return { ...table, hasHeader: true, headers: table.hasHeader ? [...table.headers] : columnNames(table), rows: table.rows.map((r) => [...r]) };
}

function mapCells(table: CsvTable, columns: number[], fn: (value: string) => string): CsvTable {
  const rows = table.rows.map((row) => {
    const copy = [...row];
    for (const c of columns) {
      copy[c] = fn(copy[c] ?? "");
    }
    return copy;
  });
  return { ...table, rows };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-_/])(\p{L})/gu, (m) => m.toUpperCase());
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Apply a no-code step. Throws for steps that need the evaluator. */
export function applyPureStep(table: CsvTable, step: PipelineStep): CsvTable {
  switch (step.kind) {
    case "rename": {
      const [idx] = resolveColumns(table, [step.from]);
      const copy = { ...table, headers: [...table.headers], hasHeader: true };
      if (!table.hasHeader) {
        copy.headers = columnNames(table);
      }
      applyEdit(copy, { kind: "renameColumn", index: idx, name: step.to });
      return copy;
    }
    case "select": {
      const indices = resolveColumns(table, step.columns);
      const names = columnNames(table);
      return {
        ...table,
        hasHeader: true,
        headers: indices.map((i) => names[i]),
        rows: table.rows.map((row) => indices.map((i) => row[i] ?? ""))
      };
    }
    case "drop": {
      const remove = new Set(resolveColumns(table, step.columns));
      const names = columnNames(table);
      const keep = names.map((_, i) => i).filter((i) => !remove.has(i));
      return {
        ...table,
        hasHeader: true,
        headers: keep.map((i) => names[i]),
        rows: table.rows.map((row) => keep.map((i) => row[i] ?? ""))
      };
    }
    case "sort": {
      const [col] = resolveColumns(table, [step.column]);
      const type = inferColumnTypes(table)[col];
      const copy = { ...table, rows: table.rows.map((r) => [...r]) };
      applyEdit(copy, { kind: "sortRows", col, direction: step.direction ?? "asc", numeric: type === "number" || type === "integer" });
      return copy;
    }
    case "dedupe": {
      const cols = step.columns && step.columns.length > 0 ? resolveColumns(table, step.columns) : undefined;
      const remove = new Set(duplicateRowIndices(table, cols));
      return { ...table, rows: table.rows.filter((_, i) => !remove.has(i)) };
    }
    case "trim":
      return mapCells(table, resolveColumns(table, step.columns), (v) => v.trim());
    case "changeCase": {
      const fn = step.case === "lower" ? (v: string) => v.toLowerCase() : step.case === "title" ? titleCase : (v: string) => v.toUpperCase();
      return mapCells(table, resolveColumns(table, step.columns), fn);
    }
    case "replace": {
      const source = step.regex ? step.find : escapeRegExp(step.find);
      const re = new RegExp(source, step.caseSensitive ? "g" : "gi");
      const replacement = step.replacement ?? "";
      return mapCells(table, resolveColumns(table, step.columns), (v) =>
        step.regex ? v.replace(re, replacement) : v.replace(re, () => replacement)
      );
    }
    case "fillEmpty":
      return mapCells(table, resolveColumns(table, step.columns), (v) => (v.trim() === "" ? step.value : v));
    case "limit": {
      const offset = Math.max(0, step.offset ?? 0);
      return { ...table, rows: table.rows.slice(offset, offset + Math.max(0, step.count)) };
    }
    case "splitColumn": {
      const [col] = resolveColumns(table, [step.column]);
      const copy = withHeaders(table);
      return applyEdits(copy, splitColumnOps(copy, col, { separator: step.separator, limit: step.limit, regex: step.regex, removeSource: step.removeSource }));
    }
    case "mergeColumns": {
      const cols = resolveColumns(table, step.columns);
      const copy = withHeaders(table);
      return applyEdits(copy, mergeColumnsOps(copy, cols, step.separator ?? "", step.name, step.removeSources));
    }
    case "transpose": {
      const copy = withHeaders(table);
      return applyEdit(copy, transposeTable(copy));
    }
    case "removeEmptyRows":
      return applyEdit({ ...table, rows: table.rows.map((r) => [...r]) }, { kind: "deleteRows", indices: emptyRowIndices(table) });
    case "sample": {
      const keep = new Set(sampleRowIndices(table.rows.length, Math.max(0, step.count), step.seed ?? 42));
      return { ...table, rows: table.rows.filter((_, i) => keep.has(i)) };
    }
    default:
      throw new Error(`Step "${step.kind}" requires an evaluator.`);
  }
}

export function isPureStep(step: PipelineStep): boolean {
  return !["filter", "compute", "script", "scriptFile", "sql", "command"].includes(step.kind);
}

// --- Runner --------------------------------------------------------------------

async function applyStep(table: CsvTable, step: PipelineStep, evaluator: PipelineEvaluator): Promise<CsvTable> {
  switch (step.kind) {
    case "filter": {
      const types = inferColumnTypes(table);
      const objects = toObjectTable(table, types);
      const results = await evaluator.evaluateRows(step.expression, objects, types);
      return { ...table, rows: table.rows.filter((_, i) => Boolean(results[i])) };
    }
    case "compute": {
      const types = inferColumnTypes(table);
      const objects = toObjectTable(table, types);
      const results = await evaluator.evaluateRows(step.expression, objects, types);
      const names = columnNames(table);
      let idx = names.indexOf(step.column);
      const headers = table.hasHeader ? [...table.headers] : names;
      if (idx === -1) {
        idx = columnCount(table);
        headers.push(step.column);
      }
      const rows = table.rows.map((row, i) => {
        const copy = [...row];
        while (copy.length < idx) {
          copy.push("");
        }
        copy[idx] = stringifyValue(results[i]);
        return copy;
      });
      return { ...table, hasHeader: true, headers, rows };
    }
    case "script":
      return fromObjectTable(await evaluator.runScript(step.code, toObjectTable(table)), table);
    case "scriptFile":
      return fromObjectTable(await evaluator.runScriptFile(step.path, toObjectTable(table)), table);
    case "sql":
      return evaluator.runSql(step.query, table);
    case "command":
      return evaluator.runCommand(step.command, table, step.format ?? "csv");
    default:
      return applyPureStep(table, step);
  }
}

export function stepLabel(step: PipelineStep): string {
  if (step.label) {
    return step.label;
  }
  const def = stepDefinition(step.kind);
  switch (step.kind) {
    case "filter":
      return `${def.label}: ${step.expression}`;
    case "compute":
      return `${def.label}: ${step.column} = ${step.expression}`;
    case "rename":
      return `${def.label}: ${step.from} → ${step.to}`;
    case "select":
    case "drop":
      return `${def.label}: ${step.columns.join(", ")}`;
    case "sort":
      return `${def.label}: ${step.column} ${step.direction}`;
    case "scriptFile":
      return `${def.label}: ${step.path}`;
    case "command":
      return `${def.label}: ${step.command}`;
    default:
      return def.label;
  }
}

/** Run every enabled step in order. Stops at the first failing step. */
export async function runPipeline(input: CsvTable, pipeline: Pipeline, evaluator: PipelineEvaluator): Promise<PipelineResult> {
  let table = input;
  const reports: StepReport[] = [];
  let ok = true;
  for (let i = 0; i < pipeline.steps.length; i += 1) {
    const step = pipeline.steps[i];
    const label = stepLabel(step);
    const rowsIn = table.rows.length;
    if (step.disabled) {
      reports.push({ index: i, kind: step.kind, label, rowsIn, rowsOut: rowsIn, columnsOut: columnCount(table), durationMs: 0, skipped: true });
      continue;
    }
    const started = Date.now();
    try {
      table = await applyStep(table, step, evaluator);
      reports.push({ index: i, kind: step.kind, label, rowsIn, rowsOut: table.rows.length, columnsOut: columnCount(table), durationMs: Date.now() - started });
      evaluator.log?.(`step ${i + 1} ${label}: ${rowsIn} → ${table.rows.length} rows (${Date.now() - started} ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reports.push({ index: i, kind: step.kind, label, rowsIn, rowsOut: rowsIn, columnsOut: columnCount(table), durationMs: Date.now() - started, error: message });
      evaluator.log?.(`step ${i + 1} ${label}: ERROR ${message}`);
      ok = false;
      break;
    }
  }
  return { table, steps: reports, ok };
}

// --- Validation and helpers ----------------------------------------------------

/** Validate a parsed JSON value as a pipeline; returns error messages. */
export function validatePipeline(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return ["Pipeline must be a JSON object."];
  }
  const p = value as Record<string, unknown>;
  if (typeof p.name !== "string" || p.name.trim().length === 0) {
    errors.push('"name" is required.');
  }
  if (!Array.isArray(p.steps)) {
    errors.push('"steps" must be an array.');
    return errors;
  }
  p.steps.forEach((s, i) => {
    if (!s || typeof s !== "object" || typeof (s as Record<string, unknown>).kind !== "string") {
      errors.push(`Step ${i + 1}: missing "kind".`);
      return;
    }
    const step = s as Record<string, unknown>;
    const def = STEP_DEFINITIONS.find((d) => d.kind === step.kind);
    if (!def) {
      errors.push(`Step ${i + 1}: unknown kind "${String(step.kind)}".`);
      return;
    }
    for (const field of def.fields) {
      const v = step[field.key];
      if (field.required && (v === undefined || v === "" || (Array.isArray(v) && v.length === 0))) {
        errors.push(`Step ${i + 1} (${def.label}): "${field.key}" is required.`);
      }
    }
  });
  if (p.trigger !== undefined && !["manual", "onOpen", "onSave"].includes(String(p.trigger))) {
    errors.push('"trigger" must be manual, onOpen or onSave.');
  }
  return errors;
}

/** Minimal glob matcher supporting `**`, `*`, `?` and `{a,b}`; matches forward-slash paths. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        i += 1;
        if (glob[i + 1] === "/") {
          i += 1;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (ch === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
      } else {
        re += `(?:${glob.slice(i + 1, end).split(",").map(escapeRegExp).join("|")})`;
        i = end;
      }
    } else {
      re += escapeRegExp(ch);
    }
  }
  return new RegExp(`^${re}$`, "i");
}

export function matchesGlobs(path: string, globs: string[] | undefined): boolean {
  if (!globs || globs.length === 0) {
    return false;
  }
  const normalized = path.replace(/\\/g, "/");
  return globs.some((g) => {
    const re = globToRegExp(g.replace(/\\/g, "/").replace(/^\.\//, ""));
    return re.test(normalized) || re.test(normalized.split("/").pop() ?? "");
  });
}

/** Substitute `${name}`, `${ext}`, `${dir}`, `${pipeline}` in an output path. */
export function resolveOutputPath(template: string, sourceRelativePath: string, pipelineName: string): string {
  const normalized = sourceRelativePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash === -1 ? "" : normalized.slice(0, slash);
  const file = slash === -1 ? normalized : normalized.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const name = dot === -1 ? file : file.slice(0, dot);
  const ext = dot === -1 ? "" : file.slice(dot + 1);
  return template
    .replace(/\$\{name\}/g, name)
    .replace(/\$\{ext\}/g, ext)
    .replace(/\$\{dir\}/g, dir)
    .replace(/\$\{pipeline\}/g, pipelineName.replace(/[^A-Za-z0-9_.-]+/g, "_"))
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}
