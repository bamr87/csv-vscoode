/**
 * Shared data model for CSV documents.
 *
 * Everything in `src/core` is pure TypeScript with no dependency on the
 * `vscode` module or the DOM so it can run in the extension host, in the
 * webview bundle, and under Vitest.
 */

export type Delimiter = "," | "\t" | ";" | "|" | string;

export type ColumnType = "number" | "integer" | "boolean" | "date" | "string" | "empty";

export interface ParseOptions {
  /** Explicit delimiter; `undefined` or `"auto"` enables detection. */
  delimiter?: Delimiter | "auto";
  /** Treat the first record as the header row. Defaults to `true`. */
  hasHeader?: boolean;
  /** Hint used when auto-detection is ambiguous (e.g. file extension). */
  preferredDelimiter?: Delimiter;
}

export interface CsvTable {
  /** Header cells exactly as found in the file. Empty when `hasHeader` is false. */
  headers: string[];
  /** Data rows, possibly ragged. Never includes the header row. */
  rows: string[][];
  delimiter: string;
  /** Line terminator detected in the source, used when serializing. */
  newline: "\n" | "\r\n" | "\r";
  hasHeader: boolean;
  /** Whether the original text ended with a line terminator. */
  trailingNewline: boolean;
  quoteChar: string;
}

export interface ColumnInfo {
  index: number;
  name: string;
  type: ColumnType;
}

/** Number of columns, taking ragged rows into account. */
export function columnCount(table: Pick<CsvTable, "headers" | "rows">): number {
  let max = table.headers.length;
  for (const row of table.rows) {
    if (row.length > max) {
      max = row.length;
    }
  }
  return max;
}

/** Display name for a column: header text or a generated fallback. */
export function columnName(table: Pick<CsvTable, "headers" | "hasHeader">, index: number): string {
  const header = table.hasHeader ? table.headers[index] : undefined;
  if (header !== undefined && header.trim().length > 0) {
    return header;
  }
  return `Column ${index + 1}`;
}

/** All column names, de-duplicated so they can be used as object keys. */
export function columnNames(table: Pick<CsvTable, "headers" | "rows" | "hasHeader">): string[] {
  const count = columnCount(table);
  const seen = new Map<string, number>();
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let name = columnName(table, i);
    const dup = seen.get(name);
    if (dup !== undefined) {
      seen.set(name, dup + 1);
      name = `${name} (${dup + 1})`;
    }
    seen.set(name, seen.get(name) ?? 1);
    names.push(name);
  }
  return names;
}

/** Cell value with ragged rows padded as empty strings. */
export function cellAt(table: Pick<CsvTable, "rows">, row: number, col: number): string {
  return table.rows[row]?.[col] ?? "";
}
