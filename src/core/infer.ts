import type { ColumnType, CsvTable } from "./types";
import { columnCount } from "./types";

const NUMBER_RE = /^[+-]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][+-]?\d+)?$/;
const INTEGER_RE = /^[+-]?(\d{1,3}(,\d{3})+|\d+)$/;
const BOOLEAN_RE = /^(true|false|yes|no|y|n|t|f)$/i;
const DATE_RE =
  /^(\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{4}|\d{4}\/\d{2}\/\d{2})$/;

export function isNumeric(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v !== "+" && v !== "-" && v !== "." && NUMBER_RE.test(v);
}

export function isInteger(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && INTEGER_RE.test(v);
}

export function isBoolean(value: string): boolean {
  return BOOLEAN_RE.test(value.trim());
}

export function isDate(value: string): boolean {
  const v = value.trim();
  return DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
}

/** Parse a numeric cell, tolerating thousands separators. Returns NaN when not numeric. */
export function toNumber(value: string): number {
  if (!isNumeric(value)) {
    return Number.NaN;
  }
  return Number(value.trim().replace(/,/g, ""));
}

/** Infer the type of one column from a sample of its values. */
export function inferColumnType(values: Iterable<string>, sampleLimit = 5000): ColumnType {
  let total = 0;
  let numbers = 0;
  let integers = 0;
  let booleans = 0;
  let dates = 0;

  for (const raw of values) {
    const value = raw.trim();
    if (value.length === 0) {
      continue;
    }
    total += 1;
    if (isNumeric(value)) {
      numbers += 1;
      if (isInteger(value)) {
        integers += 1;
      }
    } else if (isBoolean(value)) {
      booleans += 1;
    } else if (isDate(value)) {
      dates += 1;
    }
    if (total >= sampleLimit) {
      break;
    }
  }

  if (total === 0) {
    return "empty";
  }
  const threshold = Math.max(1, Math.floor(total * 0.95));
  if (numbers >= threshold) {
    return integers === numbers ? "integer" : "number";
  }
  if (booleans >= threshold) {
    return "boolean";
  }
  if (dates >= threshold) {
    return "date";
  }
  return "string";
}

/** Infer a type for every column of the table. */
export function inferColumnTypes(table: Pick<CsvTable, "headers" | "rows">, sampleLimit = 5000): ColumnType[] {
  const count = columnCount(table);
  const types: ColumnType[] = [];
  for (let c = 0; c < count; c += 1) {
    types.push(inferColumnType(columnValues(table, c), sampleLimit));
  }
  return types;
}

export function* columnValues(table: Pick<CsvTable, "rows">, col: number): Generator<string> {
  for (const row of table.rows) {
    yield row[col] ?? "";
  }
}
