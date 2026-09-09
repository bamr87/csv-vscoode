import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, Title, Tooltip } from "chart.js";
import { computeColumnStats, formatNumber, type ColumnStats } from "../src/core/stats";
import type { CsvTable } from "../src/core/types";
import { columnCount, columnName } from "../src/core/types";
import { button, clear, h } from "./dom";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, Title);

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

/** Column statistics + chart panel. */
export class StatsPanel {
  readonly element: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly statsBody: HTMLElement;
  private readonly chartBody: HTMLElement;
  private readonly chartType: HTMLSelectElement;
  private chart: Chart | undefined;
  private mode: "stats" | "chart" = "stats";
  private model: CsvTable;

  constructor(model: CsvTable, private readonly note: () => string | undefined) {
    this.model = model;
    this.select = h("select", { class: "panel-select", "aria-label": "Column" });
    this.chartType = h(
      "select",
      { class: "panel-select", "aria-label": "Chart type" },
      h("option", { value: "auto" }, "Auto"),
      h("option", { value: "histogram" }, "Histogram (numeric)"),
      h("option", { value: "top" }, "Top values")
    );
    this.statsBody = h("div", { class: "stats-body" });
    this.chartBody = h("div", { class: "chart-body" });
    this.element = h(
      "div",
      { class: "panel-content" },
      h("div", { class: "panel-row" }, h("label", {}, "Column "), this.select),
      this.statsBody,
      this.chartBody
    );
    this.select.addEventListener("change", () => this.render());
    this.chartType.addEventListener("change", () => this.render());
    this.populateColumns();
  }

  setModel(model: CsvTable): void {
    this.model = model;
    this.populateColumns();
    this.render();
  }

  show(mode: "stats" | "chart", col?: number): void {
    this.mode = mode;
    if (col !== undefined) {
      this.select.value = String(col);
    }
    this.render();
  }

  private populateColumns(): void {
    const current = this.select.value;
    clear(this.select);
    const width = columnCount(this.model);
    for (let c = 0; c < width; c += 1) {
      this.select.append(h("option", { value: String(c) }, columnName(this.model, c)));
    }
    if (current && Number(current) < width) {
      this.select.value = current;
    }
  }

  private render(): void {
    clear(this.statsBody);
    clear(this.chartBody);
    const col = Number(this.select.value);
    if (!Number.isFinite(col) || columnCount(this.model) === 0) {
      this.statsBody.append(h("p", { class: "muted" }, "No columns."));
      return;
    }
    const stats = computeColumnStats(this.model, col);
    const note = this.note();
    if (note) {
      this.statsBody.append(h("p", { class: "muted small" }, note));
    }
    if (this.mode === "stats") {
      this.renderStats(stats);
    } else {
      this.renderChart(stats);
    }
  }

  private renderStats(stats: ColumnStats): void {
    const rows: [string, string][] = [
      ["Type", stats.type],
      ["Non-empty", formatNumber(stats.count)],
      ["Empty", formatNumber(stats.empty)],
      ["Distinct", formatNumber(stats.distinct)],
      ["Min length", formatNumber(stats.minLength)],
      ["Max length", formatNumber(stats.maxLength)]
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
        ["Max", formatNumber(n.max)]
      );
    } else if (stats.minValue !== undefined && stats.maxValue !== undefined) {
      rows.push(["Min value", stats.minValue], ["Max value", stats.maxValue]);
    }
    const table = h(
      "table",
      { class: "kv" },
      h("tbody", {}, ...rows.map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, v))))
    );
    const top = h(
      "table",
      { class: "kv top-values" },
      h("thead", {}, h("tr", {}, h("th", {}, "Value"), h("th", {}, "Count"), h("th", {}, "%"))),
      h(
        "tbody",
        {},
        ...stats.topValues.map((tv) =>
          h(
            "tr",
            {},
            h("td", { title: tv.value }, tv.value.length > 40 ? `${tv.value.slice(0, 40)}…` : tv.value),
            h("td", {}, formatNumber(tv.count)),
            h("td", {}, stats.count > 0 ? `${((tv.count / stats.count) * 100).toFixed(1)}%` : "")
          )
        )
      )
    );
    this.statsBody.append(
      h("h3", {}, stats.name),
      table,
      h("h4", {}, "Top values"),
      top,
      h("div", { class: "panel-row" }, button("Chart this column", () => this.show("chart")))
    );
  }

  private renderChart(stats: ColumnStats): void {
    this.chart?.destroy();
    this.chart = undefined;
    const requested = this.chartType.value;
    const useHistogram = requested === "histogram" || (requested === "auto" && stats.histogram && stats.histogram.length > 1);
    const data = useHistogram && stats.histogram ? stats.histogram : stats.topValues.map((tv) => ({ label: tv.value, count: tv.count }));
    const canvas = h("canvas", { class: "chart-canvas", role: "img", "aria-label": `Chart of ${stats.name}` });
    this.chartBody.append(
      h("div", { class: "panel-row" }, h("label", {}, "Chart "), this.chartType),
      h("h3", {}, stats.name),
      h("div", { class: "chart-wrap" }, canvas),
      h("div", { class: "panel-row" }, button("Show statistics", () => this.show("stats")))
    );
    if (data.length === 0) {
      this.chartBody.append(h("p", { class: "muted" }, "Nothing to chart."));
      return;
    }
    const foreground = cssVar("--vscode-foreground", "#ccc");
    const accent = cssVar("--vscode-charts-blue", "#3794ff");
    const gridColor = cssVar("--vscode-editorWidget-border", "#444");
    this.chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: data.map((d) => (d.label.length > 24 ? `${d.label.slice(0, 24)}…` : d.label)),
        datasets: [{ label: useHistogram ? "Rows in range" : "Count", data: data.map((d) => d.count), backgroundColor: accent }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: useHistogram ? "x" : "y",
        plugins: {
          legend: { display: false },
          title: { display: true, text: useHistogram ? "Distribution" : "Most frequent values", color: foreground }
        },
        scales: {
          x: { ticks: { color: foreground, maxRotation: 45 }, grid: { color: gridColor } },
          y: { ticks: { color: foreground }, grid: { color: gridColor } }
        }
      }
    });
  }
}
