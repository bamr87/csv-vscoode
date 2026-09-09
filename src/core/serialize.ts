import Papa from "papaparse";
import type { CsvTable } from "./types";

export interface SerializeOptions {
  delimiter?: string;
  newline?: string;
  /** Quote every field regardless of content. */
  quoteAll?: boolean;
  /** Include the header row (defaults to `table.hasHeader`). */
  includeHeader?: boolean;
}

/** Serialize a table back to text, preserving delimiter and line endings. */
export function serializeCsv(table: CsvTable, options: SerializeOptions = {}): string {
  const delimiter = options.delimiter ?? table.delimiter;
  const newline = options.newline ?? table.newline;
  const includeHeader = options.includeHeader ?? table.hasHeader;
  const records = includeHeader ? [table.headers, ...table.rows] : table.rows;

  if (records.length === 0) {
    return "";
  }

  const body = Papa.unparse(records, {
    delimiter,
    newline,
    quotes: options.quoteAll ?? false,
    quoteChar: table.quoteChar,
    escapeChar: table.quoteChar,
    skipEmptyLines: false
  });

  return table.trailingNewline ? body + newline : body;
}

/** Serialize a single record using the table's delimiter rules. */
export function serializeRecord(table: Pick<CsvTable, "delimiter" | "quoteChar">, record: string[]): string {
  return Papa.unparse([record], {
    delimiter: table.delimiter,
    quotes: false,
    quoteChar: table.quoteChar,
    escapeChar: table.quoteChar
  });
}
