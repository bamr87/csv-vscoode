import { inferColumnTypes, isNumeric, toNumber } from "./infer";
import { serializeCsv } from "./serialize";
import type { CsvTable } from "./types";
import { columnCount, columnNames } from "./types";

export type ExportFormat = "json" | "markdown" | "html" | "sql" | "tsv" | "csv" | "semicolon" | "pipe";

export const EXPORT_FORMATS: { id: ExportFormat; label: string; language: string; extension: string }[] = [
  { id: "json", label: "JSON (array of objects)", language: "json", extension: "json" },
  { id: "markdown", label: "Markdown table", language: "markdown", extension: "md" },
  { id: "html", label: "HTML table", language: "html", extension: "html" },
  { id: "sql", label: "SQL INSERT statements", language: "sql", extension: "sql" },
  { id: "csv", label: "CSV (comma-separated)", language: "csv", extension: "csv" },
  { id: "tsv", label: "TSV (tab-separated)", language: "tsv", extension: "tsv" },
  { id: "semicolon", label: "CSV (semicolon-separated)", language: "csv", extension: "csv" },
  { id: "pipe", label: "PSV (pipe-separated)", language: "csv", extension: "psv" }
];

export interface ExportOptions {
  /** Convert numeric-looking cells to numbers (JSON) — defaults to true. */
  coerceNumbers?: boolean;
  /** SQL table name. */
  tableName?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeMarkdownCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function sqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, "\"\"")}"`;
}

function sqlLiteral(value: string, numeric: boolean): string {
  if (value === "") {
    return "NULL";
  }
  if (numeric && isNumeric(value)) {
    return String(toNumber(value));
  }
  return `'${value.replace(/'/g, "''")}'`;
}

export function toJson(table: CsvTable, options: ExportOptions = {}): string {
  const names = columnNames(table);
  const coerce = options.coerceNumbers ?? true;
  const types = coerce ? inferColumnTypes(table) : [];
  const objects = table.rows.map((row) => {
    const obj: Record<string, string | number | null> = {};
    names.forEach((name, i) => {
      const value = row[i] ?? "";
      const numericColumn = types[i] === "number" || types[i] === "integer";
      if (coerce && numericColumn && isNumeric(value)) {
        obj[name] = toNumber(value);
      } else {
        obj[name] = value;
      }
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2) + "\n";
}

export function toMarkdown(table: CsvTable): string {
  const names = columnNames(table);
  const width = columnCount(table);
  const header = `| ${names.map(escapeMarkdownCell).join(" | ")} |`;
  const separator = `| ${names.map(() => "---").join(" | ")} |`;
  const body = table.rows.map((row) => {
    const cells: string[] = [];
    for (let c = 0; c < width; c += 1) {
      cells.push(escapeMarkdownCell(row[c] ?? ""));
    }
    return `| ${cells.join(" | ")} |`;
  });
  return [header, separator, ...body].join("\n") + "\n";
}

export function toHtml(table: CsvTable): string {
  const names = columnNames(table);
  const width = columnCount(table);
  const head = `    <tr>${names.map((n) => `<th>${escapeHtml(n)}</th>`).join("")}</tr>`;
  const body = table.rows.map((row) => {
    const cells: string[] = [];
    for (let c = 0; c < width; c += 1) {
      cells.push(`<td>${escapeHtml(row[c] ?? "")}</td>`);
    }
    return `    <tr>${cells.join("")}</tr>`;
  });
  return ["<table>", "  <thead>", head, "  </thead>", "  <tbody>", ...body, "  </tbody>", "</table>", ""].join("\n");
}

export function toSql(table: CsvTable, options: ExportOptions = {}): string {
  const names = columnNames(table);
  const width = columnCount(table);
  const tableName = options.tableName?.trim() || "csv_data";
  const types = inferColumnTypes(table);
  const columnDefs = names.map((n, i) => {
    const t = types[i];
    const sqlType = t === "integer" ? "INTEGER" : t === "number" ? "REAL" : "TEXT";
    return `  ${sqlIdentifier(n)} ${sqlType}`;
  });
  const lines = [`CREATE TABLE ${sqlIdentifier(tableName)} (`, columnDefs.join(",\n"), ");", ""];
  const columnList = names.map(sqlIdentifier).join(", ");
  for (const row of table.rows) {
    const values: string[] = [];
    for (let c = 0; c < width; c += 1) {
      values.push(sqlLiteral(row[c] ?? "", types[c] === "number" || types[c] === "integer"));
    }
    lines.push(`INSERT INTO ${sqlIdentifier(tableName)} (${columnList}) VALUES (${values.join(", ")});`);
  }
  return lines.join("\n") + "\n";
}

export function toDelimited(table: CsvTable, delimiter: string): string {
  return serializeCsv({ ...table, trailingNewline: true }, { delimiter, includeHeader: table.hasHeader });
}

/** Render a table in any supported export format. */
export function exportTable(table: CsvTable, format: ExportFormat, options: ExportOptions = {}): string {
  switch (format) {
    case "json":
      return toJson(table, options);
    case "markdown":
      return toMarkdown(table);
    case "html":
      return toHtml(table);
    case "sql":
      return toSql(table, options);
    case "csv":
      return toDelimited(table, ",");
    case "tsv":
      return toDelimited(table, "\t");
    case "semicolon":
      return toDelimited(table, ";");
    case "pipe":
      return toDelimited(table, "|");
  }
}
