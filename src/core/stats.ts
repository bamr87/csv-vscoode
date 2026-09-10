import { inferColumnType, isNumeric, toNumber } from "./infer";
import type { ColumnType, CsvTable } from "./types";
import { columnName } from "./types";

export interface ValueCount {
  value: string;
  count: number;
}

export interface ColumnStats {
  index: number;
  name: string;
  type: ColumnType;
  count: number;
  empty: number;
  distinct: number;
  topValues: ValueCount[];
  minLength: number;
  maxLength: number;
  numeric?: {
    count: number;
    sum: number;
    mean: number;
    median: number;
    min: number;
    max: number;
    stddev: number;
    q1: number;
    q3: number;
  };
  /** Lexical min/max for dates and strings. */
  minValue?: string;
  maxValue?: string;
  /** Histogram buckets for numeric columns. */
  histogram?: { label: string; count: number }[];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

/** Compute descriptive statistics for one column. */
export function computeColumnStats(table: CsvTable, col: number, topN = 10): ColumnStats {
  const counts = new Map<string, number>();
  const numbers: number[] = [];
  let count = 0;
  let empty = 0;
  let minLength = Number.POSITIVE_INFINITY;
  let maxLength = 0;
  let minValue: string | undefined;
  let maxValue: string | undefined;

  for (const row of table.rows) {
    const value = row[col] ?? "";
    if (value.trim().length === 0) {
      empty += 1;
      continue;
    }
    count += 1;
    counts.set(value, (counts.get(value) ?? 0) + 1);
    minLength = Math.min(minLength, value.length);
    maxLength = Math.max(maxLength, value.length);
    if (minValue === undefined || value < minValue) {
      minValue = value;
    }
    if (maxValue === undefined || value > maxValue) {
      maxValue = value;
    }
    if (isNumeric(value)) {
      numbers.push(toNumber(value));
    }
  }

  const topValues = [...counts.entries()]
    .map(([value, c]) => ({ value, count: c }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, topN);

  const type = inferColumnType(counts.keys());
  const stats: ColumnStats = {
    index: col,
    name: columnName(table, col),
    type,
    count,
    empty,
    distinct: counts.size,
    topValues,
    minLength: count === 0 ? 0 : minLength,
    maxLength,
    minValue,
    maxValue
  };

  if ((type === "number" || type === "integer") && numbers.length > 0) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, n) => acc + n, 0);
    const mean = sum / sorted.length;
    const variance = sorted.reduce((acc, n) => acc + (n - mean) ** 2, 0) / sorted.length;
    stats.numeric = {
      count: sorted.length,
      sum,
      mean,
      median: quantile(sorted, 0.5),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      stddev: Math.sqrt(variance),
      q1: quantile(sorted, 0.25),
      q3: quantile(sorted, 0.75)
    };
    stats.histogram = histogram(sorted, 12);
  }

  return stats;
}

export function histogram(sorted: number[], buckets: number): { label: string; count: number }[] {
  if (sorted.length === 0) {
    return [];
  }
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === max) {
    return [{ label: formatNumber(min), count: sorted.length }];
  }
  const width = (max - min) / buckets;
  // Label precision follows the bucket width, so wide buckets do not print
  // four decimal places of noise.
  const decimals = width >= 10 ? 0 : width >= 1 ? 1 : width >= 0.1 ? 2 : 3;
  const bound = (n: number): string => n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const result = Array.from({ length: buckets }, (_, i) => ({
    label: `${bound(min + i * width)}–${bound(min + (i + 1) * width)}`,
    count: 0
  }));
  for (const n of sorted) {
    const idx = Math.min(buckets - 1, Math.floor((n - min) / width));
    result[idx].count += 1;
  }
  return result;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) {
    return "";
  }
  if (Number.isInteger(n)) {
    return n.toLocaleString();
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Aggregate a set of cell values (used for the selection summary). */
export interface SelectionSummary {
  cells: number;
  numeric: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
}

export function summarizeValues(values: Iterable<string>): SelectionSummary {
  let cells = 0;
  let numeric = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    cells += 1;
    if (isNumeric(value)) {
      const n = toNumber(value);
      numeric += 1;
      sum += n;
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
  }
  return {
    cells,
    numeric,
    sum,
    mean: numeric > 0 ? sum / numeric : Number.NaN,
    min: numeric > 0 ? min : Number.NaN,
    max: numeric > 0 ? max : Number.NaN
  };
}
