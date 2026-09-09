import * as vscode from "vscode";
import { EXPORT_FORMATS, exportTable, type ExportFormat } from "./core/export";
import { serializeCsv } from "./core/serialize";
import type { CsvTable } from "./core/types";

function formatInfo(format: ExportFormat) {
  return EXPORT_FORMATS.find((f) => f.id === format) ?? EXPORT_FORMATS[0];
}

function baseName(uri: vscode.Uri | undefined): string {
  if (!uri) {
    return "csv_data";
  }
  const file = uri.path.split("/").pop() ?? "csv_data";
  return file.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "_") || "csv_data";
}

/** Render the table and open the result in a new untitled editor beside the source. */
export async function exportToNewDocument(table: CsvTable, format: ExportFormat, source?: vscode.Uri): Promise<void> {
  let tableName: string | undefined;
  if (format === "sql") {
    tableName = await vscode.window.showInputBox({
      prompt: "SQL table name",
      value: baseName(source),
      validateInput: (v) => (v.trim().length === 0 ? "Enter a table name" : undefined)
    });
    if (tableName === undefined) {
      return;
    }
  }
  const content = exportTable(table, format, { tableName });
  const info = formatInfo(format);
  const doc = await vscode.workspace.openTextDocument({ content, language: info.language });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

/** Ask for a format, then export. */
export async function pickFormatAndExport(table: CsvTable, source?: vscode.Uri): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    EXPORT_FORMATS.map((f) => ({ label: f.label, description: `.${f.extension}`, id: f.id })),
    { placeHolder: "Export CSV as…" }
  );
  if (!pick) {
    return;
  }
  await exportToNewDocument(table, pick.id, source);
}

/** Open an ad-hoc result set (e.g. a SQL query) as a new CSV document. */
export async function openTableAsCsv(columns: string[], rows: (string | number | null)[][]): Promise<void> {
  const table: CsvTable = {
    headers: columns,
    rows: rows.map((r) => r.map((v) => (v === null ? "" : String(v)))),
    delimiter: ",",
    newline: "\n",
    hasHeader: true,
    trailingNewline: true,
    quoteChar: "\""
  };
  const doc = await vscode.workspace.openTextDocument({ content: serializeCsv(table), language: "csv" });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}
