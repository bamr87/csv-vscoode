import type { EditOp } from "./edits";
import { isNumeric, toNumber } from "./infer";
import type { CsvTable } from "./types";
import { columnCount, columnName, columnNames } from "./types";

/**
 * Table-level transformations expressed as edit operations (so they go
 * through the normal undoable document write path) or as pure functions.
 * Shared by the grid's Rows/Columns/Data menus and the pipeline steps.
 */

/** Indices of rows whose cells are all blank. */
export function emptyRowIndices(table: Pick<CsvTable, "rows">): number[] {
  const result: number[] = [];
  table.rows.forEach((row, i) => {
    if (row.every((cell) => cell.trim().length === 0)) {
      result.push(i);
    }
  });
  return result;
}

/** Indices of rows that repeat an earlier row (compared on `columns`, or all). */
export function duplicateRowIndices(table: Pick<CsvTable, "rows">, columns?: number[]): number[] {
  const seen = new Set<string>();
  const result: number[] = [];
  table.rows.forEach((row, i) => {
    const key = JSON.stringify(columns && columns.length > 0 ? columns.map((c) => row[c] ?? "") : row);
    if (seen.has(key)) {
      result.push(i);
    } else {
      seen.add(key);
    }
  });
  return result;
}

/** Rows whose field count differs from the header (or the widest row when there is no header). */
export function raggedRowIndices(table: Pick<CsvTable, "headers" | "rows" | "hasHeader">): { indices: number[]; expected: number } {
  const expected = table.hasHeader && table.headers.length > 0 ? table.headers.length : columnCount(table);
  const indices: number[] = [];
  table.rows.forEach((row, i) => {
    if (row.length !== expected) {
      indices.push(i);
    }
  });
  return { indices, expected };
}

/** Pad short rows with blanks and trim extra trailing blank cells so every row has `width` fields. */
export function normalizeRows(table: CsvTable, width = columnCount(table)): EditOp {
  const rows = table.rows.map((row) => {
    const copy = row.slice(0, Math.max(width, row.length));
    while (copy.length < width) {
      copy.push("");
    }
    // Only drop surplus cells when they are blank; never lose data silently.
    while (copy.length > width && copy[copy.length - 1].trim() === "") {
      copy.pop();
    }
    return copy;
  });
  return { kind: "replaceAll", headers: table.headers, rows };
}

/** Transpose the whole table (header row included when present). */
export function transposeTable(table: CsvTable): EditOp {
  const records = table.hasHeader ? [table.headers, ...table.rows] : table.rows;
  const height = records.length;
  const width = records.reduce((m, r) => Math.max(m, r.length), 0);
  const transposed: string[][] = [];
  for (let c = 0; c < width; c += 1) {
    const row: string[] = [];
    for (let r = 0; r < height; r += 1) {
      row.push(records[r][c] ?? "");
    }
    transposed.push(row);
  }
  if (table.hasHeader) {
    const [headers = [], ...rows] = transposed;
    return { kind: "replaceAll", headers, rows };
  }
  return { kind: "replaceAll", headers: [], rows: transposed };
}

export interface SplitOptions {
  separator: string;
  /** Maximum number of parts (remaining text stays in the last part). 0 = unlimited. */
  limit?: number;
  /** Treat `separator` as a regular expression. */
  regex?: boolean;
  /** Remove the source column afterwards. */
  removeSource?: boolean;
}

/** Split one column into several (Excel "Text to Columns"). */
export function splitColumnOps(table: CsvTable, col: number, options: SplitOptions): EditOp[] {
  const splitter = options.regex ? new RegExp(options.separator) : options.separator;
  const limit = options.limit && options.limit > 0 ? options.limit : 0;
  const parts = table.rows.map((row) => {
    const value = row[col] ?? "";
    if (value.length === 0) {
      return [""];
    }
    const pieces = value.split(splitter);
    if (limit > 0 && pieces.length > limit) {
      const head = pieces.slice(0, limit - 1);
      const tail = options.regex ? pieces.slice(limit - 1).join(" ") : value.split(splitter).slice(limit - 1).join(options.separator);
      return [...head, tail];
    }
    return pieces;
  });
  const width = parts.reduce((m, p) => Math.max(m, p.length), 1);
  const base = columnName(table, col);
  const ops: EditOp[] = [];
  for (let i = 0; i < width; i += 1) {
    ops.push({ kind: "insertColumn", index: col + 1 + i, name: `${base} ${i + 1}` });
  }
  const cells: { row: number; col: number; value: string }[] = [];
  parts.forEach((p, r) => {
    for (let i = 0; i < width; i += 1) {
      cells.push({ row: r, col: col + 1 + i, value: p[i] ?? "" });
    }
  });
  ops.push({ kind: "setCells", cells });
  if (options.removeSource) {
    ops.push({ kind: "deleteColumns", indices: [col] });
  }
  return ops;
}

/** Concatenate several columns into a new one placed after the last of them. */
export function mergeColumnsOps(table: CsvTable, columns: number[], separator: string, name: string, removeSources = false): EditOp[] {
  const sorted = [...columns].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return [];
  }
  const target = sorted[sorted.length - 1] + 1;
  const ops: EditOp[] = [{ kind: "insertColumn", index: target, name }];
  const cells = table.rows.map((row, r) => ({
    row: r,
    col: target,
    value: sorted.map((c) => row[c] ?? "").join(separator)
  }));
  ops.push({ kind: "setCells", cells });
  if (removeSources) {
    ops.push({ kind: "deleteColumns", indices: sorted });
  }
  return ops;
}

/** Duplicate a column right after itself. */
export function duplicateColumnOps(table: CsvTable, col: number): EditOp[] {
  const name = `${columnName(table, col)} (copy)`;
  return [
    { kind: "insertColumn", index: col + 1, name },
    { kind: "setCells", cells: table.rows.map((row, r) => ({ row: r, col: col + 1, value: row[col] ?? "" })) }
  ];
}

export interface CellRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Excel Ctrl+D: copy the top cell of each column in the rectangle downwards. */
export function fillDownOps(table: Pick<CsvTable, "rows">, rect: CellRect): EditOp | undefined {
  const cells: { row: number; col: number; value: string }[] = [];
  for (let c = rect.left; c <= rect.right; c += 1) {
    const value = table.rows[rect.top]?.[c] ?? "";
    for (let r = rect.top + 1; r <= rect.bottom; r += 1) {
      if ((table.rows[r]?.[c] ?? "") !== value) {
        cells.push({ row: r, col: c, value });
      }
    }
  }
  return cells.length > 0 ? { kind: "setCells", cells } : undefined;
}

/** Excel Ctrl+R: copy the leftmost cell of each row in the rectangle to the right. */
export function fillRightOps(table: Pick<CsvTable, "rows">, rect: CellRect): EditOp | undefined {
  const cells: { row: number; col: number; value: string }[] = [];
  for (let r = rect.top; r <= rect.bottom; r += 1) {
    const value = table.rows[r]?.[rect.left] ?? "";
    for (let c = rect.left + 1; c <= rect.right; c += 1) {
      if ((table.rows[r]?.[c] ?? "") !== value) {
        cells.push({ row: r, col: c, value });
      }
    }
  }
  return cells.length > 0 ? { kind: "setCells", cells } : undefined;
}

/**
 * Excel fill-handle "series": continue each column of the rectangle using the
 * step between its first two cells (or +1 from a single numeric cell).
 * Non-numeric starts fall back to repeating the value with a trailing counter.
 */
export function fillSeriesOps(table: Pick<CsvTable, "rows">, rect: CellRect): EditOp | undefined {
  const cells: { row: number; col: number; value: string }[] = [];
  for (let c = rect.left; c <= rect.right; c += 1) {
    const first = table.rows[rect.top]?.[c] ?? "";
    const second = table.rows[rect.top + 1]?.[c] ?? "";
    if (isNumeric(first)) {
      const start = toNumber(first);
      const step = isNumeric(second) ? toNumber(second) - start : 1;
      const decimals = Math.max(decimalsOf(first), decimalsOf(second));
      for (let r = rect.top + 1; r <= rect.bottom; r += 1) {
        const value = (start + step * (r - rect.top)).toFixed(decimals);
        if ((table.rows[r]?.[c] ?? "") !== value) {
          cells.push({ row: r, col: c, value });
        }
      }
      continue;
    }
    const match = /^(.*?)(\d+)$/.exec(first);
    if (match) {
      const prefix = match[1];
      const start = Number(match[2]);
      const pad = match[2].length;
      for (let r = rect.top + 1; r <= rect.bottom; r += 1) {
        const value = `${prefix}${String(start + (r - rect.top)).padStart(pad, "0")}`;
        if ((table.rows[r]?.[c] ?? "") !== value) {
          cells.push({ row: r, col: c, value });
        }
      }
      continue;
    }
    for (let r = rect.top + 1; r <= rect.bottom; r += 1) {
      if ((table.rows[r]?.[c] ?? "") !== first) {
        cells.push({ row: r, col: c, value: first });
      }
    }
  }
  return cells.length > 0 ? { kind: "setCells", cells } : undefined;
}

function decimalsOf(value: string): number {
  const m = /\.(\d+)$/.exec(value.trim());
  return m ? m[1].length : 0;
}

/** Deterministic pseudo-random sample of row indices (Park–Miller LCG). */
export function sampleRowIndices(rowCount: number, count: number, seed = 42): number[] {
  const n = Math.min(count, rowCount);
  const indices = Array.from({ length: rowCount }, (_, i) => i);
  let state = (seed >>> 0) % 2147483647 || 1;
  const next = (): number => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  for (let i = rowCount - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, n).sort((a, b) => a - b);
}

/** Column names shown in dialogs, paired with their indices. */
export function columnChoices(table: CsvTable): { index: number; name: string }[] {
  return columnNames(table).map((name, index) => ({ index, name }));
}
