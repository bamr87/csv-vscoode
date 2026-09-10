import type { CsvTable } from "./types";
import { columnCount } from "./types";

/**
 * Edit operations are the only way the grid mutates a document. They are
 * applied to the host's model (which owns the full file) and mirrored in the
 * webview so both sides stay in sync without re-sending the whole table.
 */
export type EditOp =
  | { kind: "setCell"; row: number; col: number; value: string }
  | { kind: "setCells"; cells: { row: number; col: number; value: string }[] }
  | { kind: "insertRows"; index: number; count: number; rows?: string[][] }
  | { kind: "deleteRows"; indices: number[] }
  | { kind: "moveRow"; from: number; to: number }
  | { kind: "insertColumn"; index: number; name: string }
  | { kind: "deleteColumns"; indices: number[] }
  | { kind: "renameColumn"; index: number; name: string }
  | { kind: "moveColumn"; from: number; to: number }
  | { kind: "sortRows"; col: number; direction: "asc" | "desc"; numeric: boolean; /** Further keys for multi-level sort. */ then?: SortKey[] }
  | { kind: "replaceAll"; headers: string[]; rows: string[][] };

export interface SortKey {
  col: number;
  direction: "asc" | "desc";
  numeric: boolean;
}

function ensureRowWidth(row: string[], width: number): void {
  while (row.length < width) {
    row.push("");
  }
}

function compareValues(a: string, b: string, numeric: boolean): number {
  if (numeric) {
    const na = a.trim() === "" ? Number.NaN : Number(a);
    const nb = b.trim() === "" ? Number.NaN : Number(b);
    const aNan = Number.isNaN(na);
    const bNan = Number.isNaN(nb);
    if (aNan && bNan) {
      return a.localeCompare(b);
    }
    if (aNan) {
      return 1;
    }
    if (bNan) {
      return -1;
    }
    return na - nb;
  }
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

/** Apply a single operation in place. Returns the same table for chaining. */
export function applyEdit(table: CsvTable, op: EditOp): CsvTable {
  switch (op.kind) {
    case "setCell": {
      setCell(table, op.row, op.col, op.value);
      break;
    }
    case "setCells": {
      for (const cell of op.cells) {
        setCell(table, cell.row, cell.col, cell.value);
      }
      break;
    }
    case "insertRows": {
      const width = columnCount(table);
      const index = Math.max(0, Math.min(op.index, table.rows.length));
      const newRows = op.rows ?? Array.from({ length: op.count }, () => Array.from({ length: width }, () => ""));
      table.rows.splice(index, 0, ...newRows.map((r) => [...r]));
      break;
    }
    case "deleteRows": {
      const remove = new Set(op.indices);
      table.rows = table.rows.filter((_, i) => !remove.has(i));
      break;
    }
    case "moveRow": {
      if (op.from < 0 || op.from >= table.rows.length) {
        break;
      }
      const [row] = table.rows.splice(op.from, 1);
      const to = Math.max(0, Math.min(op.to, table.rows.length));
      table.rows.splice(to, 0, row);
      break;
    }
    case "insertColumn": {
      const index = Math.max(0, Math.min(op.index, columnCount(table)));
      if (table.hasHeader) {
        ensureRowWidth(table.headers, index);
        table.headers.splice(index, 0, op.name);
      }
      for (const row of table.rows) {
        ensureRowWidth(row, index);
        row.splice(index, 0, "");
      }
      break;
    }
    case "deleteColumns": {
      const remove = new Set(op.indices);
      table.headers = table.headers.filter((_, i) => !remove.has(i));
      for (let r = 0; r < table.rows.length; r += 1) {
        table.rows[r] = table.rows[r].filter((_, i) => !remove.has(i));
      }
      break;
    }
    case "renameColumn": {
      if (!table.hasHeader) {
        break;
      }
      ensureRowWidth(table.headers, op.index + 1);
      table.headers[op.index] = op.name;
      break;
    }
    case "moveColumn": {
      const width = columnCount(table);
      if (op.from < 0 || op.from >= width || op.to < 0 || op.to >= width) {
        break;
      }
      const move = (row: string[]): void => {
        ensureRowWidth(row, width);
        const [cell] = row.splice(op.from, 1);
        row.splice(op.to, 0, cell);
      };
      if (table.hasHeader) {
        move(table.headers);
      }
      table.rows.forEach(move);
      break;
    }
    case "sortRows": {
      const keys: SortKey[] = [{ col: op.col, direction: op.direction, numeric: op.numeric }, ...(op.then ?? [])];
      // Stable sort: decorate with original index.
      const decorated = table.rows.map((row, i) => ({ row, i }));
      decorated.sort((a, b) => {
        for (const key of keys) {
          const sign = key.direction === "asc" ? 1 : -1;
          const cmp = compareValues(a.row[key.col] ?? "", b.row[key.col] ?? "", key.numeric) * sign;
          if (cmp !== 0) {
            return cmp;
          }
        }
        return a.i - b.i;
      });
      table.rows = decorated.map((d) => d.row);
      break;
    }
    case "replaceAll": {
      table.headers = op.headers.map(String);
      table.rows = op.rows.map((r) => r.map(String));
      break;
    }
  }
  return table;
}

export function applyEdits(table: CsvTable, ops: EditOp[]): CsvTable {
  for (const op of ops) {
    applyEdit(table, op);
  }
  return table;
}

function setCell(table: CsvTable, row: number, col: number, value: string): void {
  if (row < 0 || col < 0) {
    return;
  }
  while (table.rows.length <= row) {
    table.rows.push([]);
  }
  ensureRowWidth(table.rows[row], col + 1);
  table.rows[row][col] = value;
}

/** Deep-copy a table so edits can be applied without touching the original. */
export function cloneTable(table: CsvTable): CsvTable {
  return {
    ...table,
    headers: [...table.headers],
    rows: table.rows.map((r) => [...r])
  };
}
