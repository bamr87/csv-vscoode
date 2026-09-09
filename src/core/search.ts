import type { EditOp } from "./edits";
import type { CsvTable } from "./types";

export interface SearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeCell?: boolean;
  /** Restrict the search to these column indices. */
  columns?: number[];
}

export interface CellMatch {
  row: number;
  col: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a RegExp for the given options, or `undefined` for an empty query. */
export function buildMatcher(options: SearchOptions): RegExp | undefined {
  if (options.query.length === 0) {
    return undefined;
  }
  const source = options.regex ? options.query : escapeRegExp(options.query);
  const anchored = options.wholeCell ? `^(?:${source})$` : source;
  const flags = options.caseSensitive ? "g" : "gi";
  try {
    return new RegExp(anchored, flags);
  } catch {
    return undefined;
  }
}

/** Find every cell whose text matches. Rows are scanned in order. */
export function findMatches(table: Pick<CsvTable, "rows">, options: SearchOptions, limit = 100000): CellMatch[] {
  const matcher = buildMatcher(options);
  const matches: CellMatch[] = [];
  if (!matcher) {
    return matches;
  }
  const columns = options.columns ? new Set(options.columns) : undefined;

  for (let r = 0; r < table.rows.length; r += 1) {
    const row = table.rows[r];
    for (let c = 0; c < row.length; c += 1) {
      if (columns && !columns.has(c)) {
        continue;
      }
      matcher.lastIndex = 0;
      if (matcher.test(row[c])) {
        matches.push({ row: r, col: c });
        if (matches.length >= limit) {
          return matches;
        }
      }
    }
  }
  return matches;
}

/** Produce the edit operation that replaces every match, without mutating. */
export function replaceAll(table: Pick<CsvTable, "rows">, options: SearchOptions, replacement: string): EditOp | undefined {
  const matcher = buildMatcher(options);
  if (!matcher) {
    return undefined;
  }
  const columns = options.columns ? new Set(options.columns) : undefined;
  const cells: { row: number; col: number; value: string }[] = [];
  for (let r = 0; r < table.rows.length; r += 1) {
    const row = table.rows[r];
    for (let c = 0; c < row.length; c += 1) {
      if (columns && !columns.has(c)) {
        continue;
      }
      matcher.lastIndex = 0;
      if (!matcher.test(row[c])) {
        continue;
      }
      matcher.lastIndex = 0;
      const value = options.regex ? row[c].replace(matcher, replacement) : row[c].replace(matcher, () => replacement);
      if (value !== row[c]) {
        cells.push({ row: r, col: c, value });
      }
    }
  }
  return cells.length > 0 ? { kind: "setCells", cells } : undefined;
}

/** Replace within a single cell (used for "replace next"). */
export function replaceInCell(value: string, options: SearchOptions, replacement: string): string {
  const matcher = buildMatcher(options);
  if (!matcher) {
    return value;
  }
  return options.regex ? value.replace(matcher, replacement) : value.replace(matcher, () => replacement);
}
