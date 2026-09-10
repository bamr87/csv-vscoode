/**
 * The live demo.
 *
 * The point of this page is that it is not a re-implementation: it imports the
 * extension's own `src/core` modules — the same parser, type inference,
 * statistics and column filters that run inside VS Code — and puts a browser
 * UI on top of them. `src/core` is pure TypeScript with no `vscode` and no DOM
 * dependency precisely so it can run here, in the webview, and under Vitest.
 */
import { TabulatorFull as Tabulator, type CellComponent, type ColumnDefinition } from "tabulator-tables";
import Chart from "chart.js/auto";
import type { Database } from "sql.js";

import { parseCsv, detectDelimiter } from "../../../src/core/parse";
import { inferColumnTypes, isNumeric, toNumber } from "../../../src/core/infer";
import { computeColumnStats, formatNumber, summarizeValues } from "../../../src/core/stats";
import { columnCount, columnNames, type CsvTable, type ColumnType } from "../../../src/core/types";

const BASE = import.meta.env.BASE_URL;

const SAMPLES = [
  { id: "sales.csv", label: "sales.csv — 42 rows, 10 columns" },
  { id: "products.csv", label: "products.csv — 9 rows, 8 columns" },
  { id: "cities.tsv", label: "cities.tsv — tab-delimited" },
];

const DEFAULT_QUERY = `SELECT category,
       COUNT(*)               AS products,
       ROUND(AVG(unit_price), 2) AS avg_price,
       SUM(units_sold)        AS units
FROM csv
GROUP BY category
ORDER BY units DESC;`;

interface DemoState {
  table: CsvTable;
  types: ColumnType[];
  names: string[];
  fileName: string;
}

let state: DemoState | undefined;
let grid: Tabulator | undefined;
let chart: Chart | undefined;
let sqlPromise: Promise<Database> | undefined;

/** Narrow `document.querySelector` that throws rather than returning null. */
function need<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`demo: ${selector} is missing from the page`);
  }
  return element;
}

function buildState(text: string, fileName: string, hasHeader: boolean, delimiter: string): DemoState {
  const table = parseCsv(text, {
    hasHeader,
    delimiter: delimiter === "auto" ? "auto" : delimiter,
    preferredDelimiter: fileName.endsWith(".tsv") ? "\t" : undefined,
  });
  return {
    table,
    types: inferColumnTypes(table),
    names: columnNames(table),
    fileName,
  };
}

function columnDefinitions(current: DemoState): ColumnDefinition[] {
  return current.names.map((name, index) => {
    const type = current.types[index];
    const numeric = type === "number" || type === "integer";
    return {
      title: name,
      field: String(index),
      // The extension sorts numerically when it inferred a numeric column;
      // lexical sorting on "10" < "9" is exactly the spreadsheet bug this
      // avoids.
      sorter: numeric ? "number" : type === "date" ? "date" : "string",
      sorterParams: type === "date" ? ({ format: "iso" } as never) : undefined,
      headerFilter: "input",
      headerFilterPlaceholder: "filter…",
      editor: "input",
      cssClass: numeric ? "numeric" : undefined,
      minWidth: 90,
      headerTooltip: `${name} — inferred as ${type}`,
    } satisfies ColumnDefinition;
  });
}

function gridRows(current: DemoState): Record<string, string>[] {
  const width = columnCount(current.table);
  return current.table.rows.map((row) => {
    const record: Record<string, string> = {};
    for (let index = 0; index < width; index += 1) {
      record[String(index)] = row[index] ?? "";
    }
    return record;
  });
}

function renderGrid(current: DemoState): void {
  grid?.destroy();
  grid = new Tabulator("#demo-grid", {
    data: gridRows(current),
    columns: columnDefinitions(current),
    layout: "fitDataStretch",
    // Tabulator needs a resolvable height to constrain its scrolling body and
    // pin the header; a percentage against an auto-height parent leaves the
    // whole table scrolling as one block, header included.
    height: "clamp(20rem, 58vh, 40rem)",
    renderVertical: "virtual",
    selectableRange: true,
    selectableRangeColumns: true,
    selectableRangeRows: true,
    clipboard: true,
    clipboardCopyStyled: false,
    movableColumns: true,
    placeholder: "No rows",
  });
  grid.on("rangeChanged", updateSelectionSummary);
  grid.on("cellEdited", (cell: CellComponent) => {
    // Keep the underlying table in step so Stats and SQL see the edit, exactly
    // as the extension writes edits back to the text document.
    const rowIndex = cell.getRow().getPosition(true);
    const columnIndex = Number(cell.getField());
    if (typeof rowIndex === "number" && Number.isFinite(columnIndex) && state) {
      const row = state.table.rows[rowIndex - 1];
      if (row) {
        row[columnIndex] = String(cell.getValue() ?? "");
        state.types = inferColumnTypes(state.table);
        renderStats();
      }
    }
  });
}

function updateSelectionSummary(): void {
  const target = need<HTMLElement>("#demo-selection");
  const ranges = grid?.getRanges() ?? [];
  const values: string[] = [];
  for (const range of ranges) {
    // Tabulator returns the range's cells row-major and nested; flat() copes
    // with both that and the flat array the type definitions describe.
    for (const cell of (range.getCells() as unknown as CellComponent[]).flat()) {
      values.push(String(cell.getValue() ?? ""));
    }
  }
  // Tabulator always keeps one cell in range, so a single cell is not a
  // selection worth summarising — it is the cursor.
  if (values.length < 2) {
    target.textContent = "Select a range of cells for a live summary";
    return;
  }
  const summary = summarizeValues(values);
  const parts = [`Count <strong>${summary.cells}</strong>`];
  if (summary.numeric > 0) {
    parts.push(
      `Sum <strong>${formatNumber(summary.sum)}</strong>`,
      `Average <strong>${formatNumber(summary.mean)}</strong>`,
      `Min <strong>${formatNumber(summary.min)}</strong>`,
      `Max <strong>${formatNumber(summary.max)}</strong>`,
    );
  }
  target.innerHTML = parts.join(" &nbsp;·&nbsp; ");
}

function renderFileSummary(current: DemoState): void {
  const delimiterLabel =
    current.table.delimiter === "\t"
      ? "tab"
      : current.table.delimiter === ","
        ? "comma"
        : current.table.delimiter === ";"
          ? "semicolon"
          : current.table.delimiter === "|"
            ? "pipe"
            : JSON.stringify(current.table.delimiter);
  need<HTMLElement>("#demo-summary").innerHTML = [
    `<strong>${current.fileName}</strong>`,
    `${current.table.rows.length.toLocaleString()} rows`,
    `${columnCount(current.table)} columns`,
    `delimiter: <strong>${delimiterLabel}</strong>`,
    `header row: <strong>${current.table.hasHeader ? "yes" : "no"}</strong>`,
  ].join(" &nbsp;·&nbsp; ");
}

function renderStatsColumnPicker(current: DemoState): void {
  const select = need<HTMLSelectElement>("#demo-stats-column");
  const previous = select.value;
  select.innerHTML = current.names
    .map((name, index) => `<option value="${index}">${escapeHtml(name)} (${current.types[index]})</option>`)
    .join("");
  // Default to the first numeric column: that is the one with a histogram.
  const numericIndex = current.types.findIndex((t) => t === "number" || t === "integer");
  select.value = previous && Number(previous) < current.names.length ? previous : String(Math.max(numericIndex, 0));
}

function renderStats(): void {
  if (!state) {
    return;
  }
  const index = Number(need<HTMLSelectElement>("#demo-stats-column").value || 0);
  const stats = computeColumnStats(state.table, index);
  const rows: [string, string][] = [
    ["Type", stats.type],
    ["Count", stats.count.toLocaleString()],
    ["Blank", stats.empty.toLocaleString()],
    ["Distinct", stats.distinct.toLocaleString()],
  ];
  if (stats.numeric) {
    const n = stats.numeric;
    rows.push(
      ["Sum", formatNumber(n.sum)],
      ["Mean", formatNumber(n.mean)],
      ["Median", formatNumber(n.median)],
      ["Std dev", formatNumber(n.stddev)],
      ["Min", formatNumber(n.min)],
      ["Q1", formatNumber(n.q1)],
      ["Q3", formatNumber(n.q3)],
      ["Max", formatNumber(n.max)],
    );
  } else {
    rows.push(
      ["Shortest", String(stats.minLength)],
      ["Longest", String(stats.maxLength)],
    );
  }

  need<HTMLElement>("#demo-stats-table").innerHTML =
    `<table><tbody>${rows
      .map(([label, value]) => `<tr><th>${label}</th><td>${escapeHtml(value)}</td></tr>`)
      .join("")}</tbody></table>`;

  const top = stats.topValues
    .slice(0, 8)
    .map((v) => `<tr><td>${escapeHtml(v.value || "(blank)")}</td><td>${v.count.toLocaleString()}</td></tr>`)
    .join("");
  need<HTMLElement>("#demo-top-values").innerHTML =
    `<table><thead><tr><th>Most frequent</th><th>Rows</th></tr></thead><tbody>${top}</tbody></table>`;

  renderChart(stats);
}

function renderChart(stats: ReturnType<typeof computeColumnStats>): void {
  const canvas = need<HTMLCanvasElement>("#demo-chart");
  chart?.destroy();

  let labels: string[];
  let data: number[];
  let label: string;

  if (stats.histogram && stats.histogram.length > 0) {
    labels = stats.histogram.map((b) => b.label);
    data = stats.histogram.map((b) => b.count);
    label = `${stats.name} — distribution`;
  } else {
    const top = stats.topValues.slice(0, 10);
    labels = top.map((v) => v.value || "(blank)");
    data = top.map((v) => v.count);
    label = `${stats.name} — top values`;
  }

  const accent =
    getComputedStyle(document.documentElement).getPropertyValue("--csv-teal").trim() || "#4fc3b2";
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--sl-color-gray-5").trim();
  const text = getComputedStyle(document.documentElement).getPropertyValue("--sl-color-gray-2").trim();

  chart = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ label, data, backgroundColor: accent, borderRadius: 3 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: label, color: text } },
      scales: {
        x: { ticks: { color: text, maxRotation: 60, minRotation: 0 }, grid: { color: gridColor } },
        y: { ticks: { color: text }, grid: { color: gridColor }, beginAtZero: true },
      },
    },
  });
}

/** SQLite is loaded on first use: the WebAssembly binary is ~1.5 MB. */
async function sqlite(): Promise<Database> {
  if (!sqlPromise) {
    sqlPromise = import("sql.js")
      .then((module) => module.default({ locateFile: (file: string) => `${BASE}${file}` }))
      .then((SQL) => new SQL.Database());
  }
  return sqlPromise;
}

async function runQuery(): Promise<void> {
  if (!state) {
    return;
  }
  const output = need<HTMLElement>("#demo-sql-output");
  const query = need<HTMLTextAreaElement>("#demo-sql-input").value.trim();
  if (!query) {
    output.innerHTML = "";
    return;
  }
  output.innerHTML = '<p class="demo-hint">Running…</p>';
  try {
    const db = await sqlite();
    loadTable(db, state);
    const results = db.exec(query);
    if (results.length === 0) {
      output.innerHTML = '<p class="demo-hint">The statement ran and returned no rows.</p>';
      return;
    }
    const { columns, values } = results[results.length - 1];
    const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
    const body = values
      .slice(0, 200)
      .map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(v === null ? "" : String(v))}</td>`).join("")}</tr>`)
      .join("");
    const truncated =
      values.length > 200 ? `<p class="demo-hint">Showing 200 of ${values.length.toLocaleString()} rows.</p>` : "";
    output.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${truncated}`;
  } catch (error) {
    output.innerHTML = `<p class="demo-error">${escapeHtml(String(error))}</p>`;
  }
}

/**
 * Rebuilds the `csv` table from the current data. Columns inferred as numeric
 * are declared REAL so `ORDER BY` and `AVG` behave, which is what the
 * extension's SQL loader does too.
 */
function loadTable(db: Database, current: DemoState): void {
  const width = columnCount(current.table);
  const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const unique = new Set<string>();
  const columns = current.names.slice(0, width).map((name, index) => {
    let candidate = name.trim() || `column_${index + 1}`;
    while (unique.has(candidate.toLowerCase())) {
      candidate = `${candidate}_${index + 1}`;
    }
    unique.add(candidate.toLowerCase());
    const type = current.types[index];
    return { name: candidate, numeric: type === "number" || type === "integer" };
  });

  db.exec("DROP TABLE IF EXISTS csv;");
  db.exec(
    `CREATE TABLE csv (${columns
      .map((c) => `${quoted(c.name)} ${c.numeric ? "REAL" : "TEXT"}`)
      .join(", ")});`,
  );
  const insert = db.prepare(
    `INSERT INTO csv VALUES (${columns.map(() => "?").join(", ")});`,
  );
  db.exec("BEGIN;");
  for (const row of current.table.rows) {
    insert.run(
      columns.map((column, index) => {
        const value = row[index] ?? "";
        if (column.numeric) {
          return isNumeric(value) ? toNumber(value) : null;
        }
        return value;
      }),
    );
  }
  db.exec("COMMIT;");
  insert.free();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function load(text: string, fileName: string): void {
  const hasHeader = need<HTMLInputElement>("#demo-header").checked;
  const delimiter = need<HTMLSelectElement>("#demo-delimiter").value;
  state = buildState(text, fileName, hasHeader, delimiter);
  renderFileSummary(state);
  renderGrid(state);
  renderStatsColumnPicker(state);
  renderStats();
  updateSelectionSummary();
  need<HTMLElement>("#demo-detected").textContent =
    delimiter === "auto" ? `auto-detected "${detectDelimiter(text).replace("\t", "\\t")}"` : "";
}

async function loadSample(id: string): Promise<void> {
  const response = await fetch(`${BASE}samples/${id}`);
  if (!response.ok) {
    throw new Error(`Could not load ${id} (${response.status})`);
  }
  load(await response.text(), id);
}

export function mountDemo(): void {
  const root = document.querySelector("#demo-root");
  if (!root) {
    return;
  }

  const sampleSelect = need<HTMLSelectElement>("#demo-sample");
  sampleSelect.innerHTML = SAMPLES.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  need<HTMLTextAreaElement>("#demo-sql-input").value = DEFAULT_QUERY;

  sampleSelect.addEventListener("change", () => void loadSample(sampleSelect.value));
  need<HTMLInputElement>("#demo-header").addEventListener("change", () => void loadSample(sampleSelect.value));
  need<HTMLSelectElement>("#demo-delimiter").addEventListener("change", () => void loadSample(sampleSelect.value));
  need<HTMLSelectElement>("#demo-stats-column").addEventListener("change", renderStats);
  need<HTMLButtonElement>("#demo-run-sql").addEventListener("click", () => void runQuery());

  // Files chosen here are read with the FileReader API and never leave the
  // browser — there is no server to send them to.
  need<HTMLInputElement>("#demo-file").addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    void file.text().then((text) => load(text, file.name));
  });

  void loadSample(SAMPLES[0].id).catch((error: unknown) => {
    need<HTMLElement>("#demo-summary").innerHTML =
      `<span class="demo-error">${escapeHtml(String(error))}</span>`;
  });
}
