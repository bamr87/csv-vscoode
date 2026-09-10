import Papa from "papaparse";
import type { CsvTable, ParseOptions } from "./types";

const CANDIDATE_DELIMITERS = [",", "\t", ";", "|"];

/** Guess a delimiter from a file extension. */
export function delimiterForPath(path: string): string | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsv") || lower.endsWith(".tab")) {
    return "\t";
  }
  if (lower.endsWith(".psv")) {
    return "|";
  }
  return undefined;
}

/**
 * Detect the delimiter by scoring candidates on the first few records:
 * a good delimiter yields the same field count on every line and more than
 * one field per line.
 */
export function detectDelimiter(text: string, preferred?: string): string {
  const sample = text.slice(0, 64 * 1024);
  let best: { delimiter: string; score: number } | undefined;
  const candidates = preferred ? [preferred, ...CANDIDATE_DELIMITERS.filter((d) => d !== preferred)] : CANDIDATE_DELIMITERS;

  for (const delimiter of candidates) {
    const result = Papa.parse<string[]>(sample, { delimiter, preview: 20, skipEmptyLines: true });
    const rows = result.data.filter((r) => r.length > 0);
    if (rows.length === 0) {
      continue;
    }
    const counts = rows.map((r) => r.length);
    const first = counts[0];
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const fields = first;
    if (fields < 2) {
      continue;
    }
    // Favour consistency, then wider tables. A preferred delimiter (from the
    // file extension) wins ties.
    const score = consistent * 1000 + Math.min(fields, 50) + (delimiter === preferred ? 0.5 : 0);
    if (!best || score > best.score) {
      best = { delimiter, score };
    }
  }

  return best?.delimiter ?? preferred ?? ",";
}

export function detectNewline(text: string): CsvTable["newline"] {
  const idx = text.indexOf("\n");
  if (idx === -1) {
    return text.includes("\r") ? "\r" : "\n";
  }
  return idx > 0 && text[idx - 1] === "\r" ? "\r\n" : "\n";
}

/** Parse CSV text into the shared table model. */
export function parseCsv(text: string, options: ParseOptions = {}): CsvTable {
  const hasHeader = options.hasHeader ?? true;
  const delimiter =
    options.delimiter && options.delimiter !== "auto" ? options.delimiter : detectDelimiter(text, options.preferredDelimiter);
  const newline = detectNewline(text);

  const result = Papa.parse<string[]>(text, {
    delimiter,
    quoteChar: "\"",
    escapeChar: "\"",
    skipEmptyLines: true,
    dynamicTyping: false,
    header: false
  });

  const records = result.data;
  const headers = hasHeader && records.length > 0 ? records[0] : [];
  const rows = hasHeader ? records.slice(1) : records;

  return {
    headers,
    rows,
    delimiter,
    newline,
    hasHeader,
    trailingNewline: /(\r\n|\n|\r)$/.test(text),
    quoteChar: "\""
  };
}
