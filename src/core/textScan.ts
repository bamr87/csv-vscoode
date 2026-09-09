/**
 * Lightweight, quote-aware scanning of raw CSV text. Used by the text-mode
 * features (rainbow columns, hover, status bar) where a full parse of the
 * document on every keystroke would be wasteful.
 */

export interface FieldSpan {
  /** Column index of the field. */
  col: number;
  /** Start offset within the line. */
  start: number;
  /** End offset (exclusive) within the line. */
  end: number;
}

export interface LineScan {
  fields: FieldSpan[];
  /** Whether the line ends inside an open quoted field. */
  openQuote: boolean;
}

/**
 * Split one physical line into field spans. `startCol` and `startInQuote`
 * carry state across lines so multi-line quoted fields keep their column.
 */
export function scanLine(line: string, delimiter: string, startCol = 0, startInQuote = false, quote = "\""): LineScan {
  const fields: FieldSpan[] = [];
  let col = startCol;
  let inQuote = startInQuote;
  let fieldStart = 0;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === quote) {
      if (inQuote && line[i + 1] === quote) {
        i += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (ch === delimiter && !inQuote) {
      fields.push({ col, start: fieldStart, end: i });
      col += 1;
      fieldStart = i + 1;
    }
  }
  fields.push({ col, start: fieldStart, end: line.length });
  return { fields, openQuote: inQuote };
}

/** Find the column index at a character offset on a scanned line. */
export function columnAtOffset(scan: LineScan, offset: number): number | undefined {
  for (const field of scan.fields) {
    if (offset >= field.start && offset <= field.end) {
      return field.col;
    }
  }
  return scan.fields.length > 0 ? scan.fields[scan.fields.length - 1].col : undefined;
}
