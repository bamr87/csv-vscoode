import { isNumeric, toNumber } from "./infer";
import type { ColumnType, CsvTable } from "./types";

/**
 * Excel-style AutoFilter state for one column: an optional set of allowed
 * values (the checkbox list) and up to two custom conditions joined by
 * AND/OR (the "Text Filters" / "Number Filters" dialog).
 */
export type ConditionOp =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "beginsWith"
  | "endsWith"
  | "greaterThan"
  | "greaterOrEqual"
  | "lessThan"
  | "lessOrEqual"
  | "between"
  | "before"
  | "after"
  | "isEmpty"
  | "isNotEmpty";

export interface Condition {
  op: ConditionOp;
  value: string;
  /** Upper bound for `between`. */
  value2?: string;
}

export interface ColumnFilter {
  /** Values that pass the checkbox list; `undefined` means "all". Blanks are represented by "". */
  values?: string[];
  condition1?: Condition;
  logic?: "and" | "or";
  condition2?: Condition;
}

export const BLANK = "";

export interface ConditionOpDef {
  op: ConditionOp;
  label: string;
  /** Number of value inputs (0, 1 or 2). */
  inputs: 0 | 1 | 2;
  kinds: ("text" | "number" | "date")[];
}

export const CONDITION_OPS: ConditionOpDef[] = [
  { op: "equals", label: "Equals", inputs: 1, kinds: ["text", "number", "date"] },
  { op: "notEquals", label: "Does not equal", inputs: 1, kinds: ["text", "number", "date"] },
  { op: "contains", label: "Contains", inputs: 1, kinds: ["text"] },
  { op: "notContains", label: "Does not contain", inputs: 1, kinds: ["text"] },
  { op: "beginsWith", label: "Begins with", inputs: 1, kinds: ["text"] },
  { op: "endsWith", label: "Ends with", inputs: 1, kinds: ["text"] },
  { op: "greaterThan", label: "Greater than", inputs: 1, kinds: ["number"] },
  { op: "greaterOrEqual", label: "Greater than or equal to", inputs: 1, kinds: ["number"] },
  { op: "lessThan", label: "Less than", inputs: 1, kinds: ["number"] },
  { op: "lessOrEqual", label: "Less than or equal to", inputs: 1, kinds: ["number"] },
  { op: "between", label: "Between", inputs: 2, kinds: ["number", "date"] },
  { op: "after", label: "After", inputs: 1, kinds: ["date"] },
  { op: "before", label: "Before", inputs: 1, kinds: ["date"] },
  { op: "isEmpty", label: "Is empty", inputs: 0, kinds: ["text", "number", "date"] },
  { op: "isNotEmpty", label: "Is not empty", inputs: 0, kinds: ["text", "number", "date"] }
];

export type FilterKind = "text" | "number" | "date";

export function filterKindFor(type: ColumnType): FilterKind {
  if (type === "number" || type === "integer") {
    return "number";
  }
  if (type === "date") {
    return "date";
  }
  return "text";
}

/** Operators applicable to a column kind, in Excel's order. */
export function opsForKind(kind: FilterKind): ConditionOpDef[] {
  return CONDITION_OPS.filter((d) => d.kinds.includes(kind));
}

/** Excel wildcards: `*` any run, `?` one character. Case-insensitive. */
function wildcardToRegExp(pattern: string, anchorStart: boolean, anchorEnd: boolean): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`${anchorStart ? "^" : ""}${escaped}${anchorEnd ? "$" : ""}`, "i");
}

function compareNumbers(value: string, target: string, test: (a: number, b: number) => boolean): boolean {
  if (!isNumeric(value) || !isNumeric(target)) {
    return false;
  }
  return test(toNumber(value), toNumber(target));
}

function parseDate(value: string): number {
  const t = Date.parse(value.trim());
  return Number.isNaN(t) ? Number.NaN : t;
}

function compareDates(value: string, target: string, test: (a: number, b: number) => boolean): boolean {
  const a = parseDate(value);
  const b = parseDate(target);
  return !Number.isNaN(a) && !Number.isNaN(b) && test(a, b);
}

/** Evaluate a single condition against a cell value. */
export function matchesCondition(value: string, condition: Condition, kind: FilterKind): boolean {
  const v = value;
  const target = condition.value ?? "";
  switch (condition.op) {
    case "isEmpty":
      return v.trim() === "";
    case "isNotEmpty":
      return v.trim() !== "";
    case "equals":
      if (kind === "number" && isNumeric(v) && isNumeric(target)) {
        return toNumber(v) === toNumber(target);
      }
      if (kind === "date" && !Number.isNaN(parseDate(v)) && !Number.isNaN(parseDate(target))) {
        return parseDate(v) === parseDate(target);
      }
      return wildcardToRegExp(target, true, true).test(v);
    case "notEquals":
      return !matchesCondition(v, { ...condition, op: "equals" }, kind);
    case "contains":
      return wildcardToRegExp(target, false, false).test(v);
    case "notContains":
      return !wildcardToRegExp(target, false, false).test(v);
    case "beginsWith":
      return wildcardToRegExp(target, true, false).test(v);
    case "endsWith":
      return wildcardToRegExp(target, false, true).test(v);
    case "greaterThan":
      return compareNumbers(v, target, (a, b) => a > b);
    case "greaterOrEqual":
      return compareNumbers(v, target, (a, b) => a >= b);
    case "lessThan":
      return compareNumbers(v, target, (a, b) => a < b);
    case "lessOrEqual":
      return compareNumbers(v, target, (a, b) => a <= b);
    case "between": {
      const hi = condition.value2 ?? "";
      if (kind === "date") {
        return compareDates(v, target, (a, b) => a >= b) && compareDates(v, hi, (a, b) => a <= b);
      }
      return compareNumbers(v, target, (a, b) => a >= b) && compareNumbers(v, hi, (a, b) => a <= b);
    }
    case "after":
      return compareDates(v, target, (a, b) => a > b);
    case "before":
      return compareDates(v, target, (a, b) => a < b);
  }
}

/** Whether a filter has any effect. */
export function isFilterActive(filter: ColumnFilter | undefined): boolean {
  if (!filter) {
    return false;
  }
  return filter.values !== undefined || filter.condition1 !== undefined || filter.condition2 !== undefined;
}

/** Evaluate the whole column filter (value list AND custom conditions). */
export function matchesFilter(value: string, filter: ColumnFilter | undefined, kind: FilterKind, valueSet?: Set<string>): boolean {
  if (!filter) {
    return true;
  }
  if (filter.values !== undefined) {
    const set = valueSet ?? new Set(filter.values);
    if (!set.has(value)) {
      return false;
    }
  }
  const c1 = filter.condition1;
  const c2 = filter.condition2;
  if (!c1 && !c2) {
    return true;
  }
  const r1 = c1 ? matchesCondition(value, c1, kind) : undefined;
  const r2 = c2 ? matchesCondition(value, c2, kind) : undefined;
  if (r1 === undefined) {
    return r2 as boolean;
  }
  if (r2 === undefined) {
    return r1;
  }
  return filter.logic === "or" ? r1 || r2 : r1 && r2;
}

/** Compiled predicate for a set of column filters, to run once per row. */
export function buildRowPredicate(filters: Map<number, ColumnFilter>, types: ColumnType[]): (row: string[]) => boolean {
  const compiled: { col: number; filter: ColumnFilter; kind: FilterKind; set?: Set<string> }[] = [];
  for (const [col, filter] of filters) {
    if (isFilterActive(filter)) {
      compiled.push({ col, filter, kind: filterKindFor(types[col] ?? "string"), set: filter.values ? new Set(filter.values) : undefined });
    }
  }
  if (compiled.length === 0) {
    return () => true;
  }
  return (row) => {
    for (const c of compiled) {
      if (!matchesFilter(row[c.col] ?? "", c.filter, c.kind, c.set)) {
        return false;
      }
    }
    return true;
  };
}

export interface DistinctValue {
  value: string;
  count: number;
}

/**
 * Distinct values of a column with counts, sorted like Excel (numbers
 * numerically, text alphabetically, blanks last). Only rows accepted by
 * `include` are considered, which is how the list cascades from the other
 * columns' filters.
 */
export function distinctValues(
  table: Pick<CsvTable, "rows">,
  col: number,
  kind: FilterKind,
  include: (row: string[]) => boolean = () => true,
  limit = 10000
): { values: DistinctValue[]; truncated: boolean } {
  const counts = new Map<string, number>();
  for (const row of table.rows) {
    if (!include(row)) {
      continue;
    }
    const value = row[col] ?? "";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const values = [...counts.entries()].map(([value, count]) => ({ value, count }));
  values.sort((a, b) => {
    const aBlank = a.value.trim() === "";
    const bBlank = b.value.trim() === "";
    if (aBlank !== bBlank) {
      return aBlank ? 1 : -1;
    }
    if (kind === "number") {
      const na = toNumber(a.value);
      const nb = toNumber(b.value);
      const aNan = Number.isNaN(na);
      const bNan = Number.isNaN(nb);
      if (!aNan && !bNan) {
        return na - nb;
      }
      if (aNan !== bNan) {
        return aNan ? 1 : -1;
      }
    }
    if (kind === "date") {
      const da = parseDate(a.value);
      const db = parseDate(b.value);
      if (!Number.isNaN(da) && !Number.isNaN(db) && da !== db) {
        return da - db;
      }
    }
    return a.value.localeCompare(b.value, undefined, { sensitivity: "base", numeric: true });
  });
  const truncated = values.length > limit;
  return { values: truncated ? values.slice(0, limit) : values, truncated };
}

/** Human-readable description of an active filter, for tooltips and status. */
export function describeFilter(filter: ColumnFilter | undefined, kind: FilterKind): string {
  if (!isFilterActive(filter) || !filter) {
    return "";
  }
  const parts: string[] = [];
  if (filter.values !== undefined) {
    const shown = filter.values.slice(0, 3).map((v) => (v === "" ? "(Blanks)" : v));
    parts.push(`${filter.values.length} value${filter.values.length === 1 ? "" : "s"}${shown.length > 0 ? `: ${shown.join(", ")}${filter.values.length > 3 ? ", …" : ""}` : ""}`);
  }
  const describe = (c: Condition): string => {
    const def = CONDITION_OPS.find((d) => d.op === c.op);
    const label = def?.label ?? c.op;
    if (def?.inputs === 0) {
      return label.toLowerCase();
    }
    if (def?.inputs === 2) {
      return `${label.toLowerCase()} ${c.value} and ${c.value2 ?? ""}`;
    }
    return `${label.toLowerCase()} "${c.value}"`;
  };
  if (filter.condition1 && filter.condition2) {
    parts.push(`${describe(filter.condition1)} ${filter.logic === "or" ? "or" : "and"} ${describe(filter.condition2)}`);
  } else if (filter.condition1) {
    parts.push(describe(filter.condition1));
  } else if (filter.condition2) {
    parts.push(describe(filter.condition2));
  }
  return `${kind === "number" ? "Number" : kind === "date" ? "Date" : "Text"} filter: ${parts.join("; ")}`;
}
