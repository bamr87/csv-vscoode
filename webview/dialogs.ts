import type { SortKey } from "../src/core/edits";
import type { CsvTable } from "../src/core/types";
import { columnNames } from "../src/core/types";
import { button, h } from "./dom";

/** Generic modal with arbitrary body; resolves true on OK. */
export function formDialog(title: string, body: HTMLElement, okLabel = "OK"): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      overlay.remove();
      resolve(ok);
    };
    const overlay = h(
      "div",
      { class: "dialog-overlay" },
      h(
        "div",
        { class: "dialog wide" },
        h("div", { class: "dialog-title" }, title),
        body,
        h("div", { class: "dialog-actions" }, button("Cancel", () => finish(false), { class: "secondary" }), button(okLabel, () => finish(true), { class: "primary" }))
      )
    );
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      } else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        finish(true);
      }
    });
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) {
        finish(false);
      }
    });
    document.body.append(overlay);
    overlay.querySelector<HTMLElement>("input, select, textarea")?.focus();
  });
}

function columnSelect(table: CsvTable, selected?: number, allowNone = false): HTMLSelectElement {
  const select = h("select", {});
  if (allowNone) {
    select.append(h("option", { value: "" }, "(none)"));
  }
  columnNames(table).forEach((name, i) => select.append(h("option", { value: String(i) }, name)));
  if (selected !== undefined) {
    select.value = String(selected);
  }
  return select;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h("div", { class: "field" }, h("label", { class: "field-label" }, label), control);
}

export interface SortDialogResult {
  keys: SortKey[];
  applyToFile: boolean;
}

/** Excel "Sort" dialog: up to three levels, view-only or written to the file. */
export async function sortDialog(table: CsvTable, numericColumns: Set<number>, initialCol?: number): Promise<SortDialogResult | undefined> {
  const levels = [0, 1, 2].map((i) => {
    const col = columnSelect(table, i === 0 ? initialCol : undefined, i > 0);
    const dir = h("select", {}, h("option", { value: "asc" }, "A to Z / smallest first"), h("option", { value: "desc" }, "Z to A / largest first"));
    return { col, dir, row: h("div", { class: "field" }, h("label", { class: "field-label" }, i === 0 ? "Sort by" : "Then by"), col, dir) };
  });
  const applyToFile = h("input", { type: "checkbox", id: "sort-file" });
  const body = h(
    "div",
    { class: "dialog-body" },
    ...levels.map((l) => l.row),
    h("label", { class: "check" }, applyToFile, " Write the sorted order to the file (otherwise only the view is sorted)")
  );
  if (!(await formDialog("Sort", body, "Sort"))) {
    return undefined;
  }
  const keys: SortKey[] = [];
  for (const level of levels) {
    if (level.col.value === "") {
      continue;
    }
    const col = Number(level.col.value);
    keys.push({ col, direction: level.dir.value as "asc" | "desc", numeric: numericColumns.has(col) });
  }
  return keys.length > 0 ? { keys, applyToFile: applyToFile.checked } : undefined;
}

export interface SplitDialogResult {
  col: number;
  separator: string;
  limit: number;
  regex: boolean;
  removeSource: boolean;
}

/** Excel "Text to Columns". */
export async function splitDialog(table: CsvTable, col: number): Promise<SplitDialogResult | undefined> {
  const colSelect = columnSelect(table, col);
  const separator = h("input", { type: "text", value: ",", placeholder: "separator" });
  const limit = h("input", { type: "number", value: "0", min: "0" });
  const regex = h("input", { type: "checkbox" });
  const remove = h("input", { type: "checkbox" });
  const body = h(
    "div",
    { class: "dialog-body" },
    field("Column", colSelect),
    field("Separator", separator),
    field("Max parts", limit),
    h("label", { class: "check" }, regex, " Separator is a regular expression"),
    h("label", { class: "check" }, remove, " Remove the source column"),
    h("div", { class: "muted small" }, "0 parts = unlimited. New columns are inserted after the source column.")
  );
  if (!(await formDialog("Split column", body, "Split"))) {
    return undefined;
  }
  if (separator.value.length === 0) {
    return undefined;
  }
  return { col: Number(colSelect.value), separator: separator.value, limit: Number(limit.value) || 0, regex: regex.checked, removeSource: remove.checked };
}

export interface MergeDialogResult {
  columns: number[];
  separator: string;
  name: string;
  removeSources: boolean;
}

/** Concatenate columns (Excel CONCAT / Flash Fill stand-in). */
export async function mergeDialog(table: CsvTable, preselected: number[]): Promise<MergeDialogResult | undefined> {
  const names = columnNames(table);
  const boxes = names.map((name, i) => {
    const cb = h("input", { type: "checkbox", value: String(i) });
    cb.checked = preselected.includes(i);
    return h("label", { class: "check merge-col" }, cb, ` ${name}`);
  });
  const separator = h("input", { type: "text", value: " ", placeholder: "separator" });
  const name = h("input", { type: "text", value: "merged", placeholder: "new column name" });
  const remove = h("input", { type: "checkbox" });
  const body = h(
    "div",
    { class: "dialog-body" },
    h("div", { class: "merge-cols" }, ...boxes),
    field("Separator", separator),
    field("New column", name),
    h("label", { class: "check" }, remove, " Remove the source columns")
  );
  if (!(await formDialog("Merge columns", body, "Merge"))) {
    return undefined;
  }
  const columns = boxes.map((l) => l.querySelector("input") as HTMLInputElement).filter((cb) => cb.checked).map((cb) => Number(cb.value));
  if (columns.length < 1 || name.value.trim().length === 0) {
    return undefined;
  }
  return { columns, separator: separator.value, name: name.value.trim(), removeSources: remove.checked };
}

/** Excel "Remove Duplicates": choose the columns that define a duplicate. */
export async function dedupeDialog(table: CsvTable): Promise<number[] | undefined> {
  const names = columnNames(table);
  const boxes = names.map((name, i) => {
    const cb = h("input", { type: "checkbox", value: String(i) });
    cb.checked = true;
    return h("label", { class: "check merge-col" }, cb, ` ${name}`);
  });
  const all = h("input", { type: "checkbox" });
  all.checked = true;
  all.addEventListener("change", () => boxes.forEach((l) => ((l.querySelector("input") as HTMLInputElement).checked = all.checked)));
  const body = h(
    "div",
    { class: "dialog-body" },
    h("div", { class: "muted small" }, "Rows with the same values in the selected columns are duplicates; the first occurrence is kept."),
    h("label", { class: "check" }, all, " Select all"),
    h("div", { class: "merge-cols" }, ...boxes)
  );
  if (!(await formDialog("Remove duplicates", body, "Remove"))) {
    return undefined;
  }
  return boxes.map((l) => l.querySelector("input") as HTMLInputElement).filter((cb) => cb.checked).map((cb) => Number(cb.value));
}

/** Excel Ctrl+G: "row" or "row:column" (1-based; column may be a name). */
export async function goToDialog(table: CsvTable): Promise<{ row: number; col: number } | undefined> {
  const input = h("input", { type: "text", placeholder: "row  or  row:column   e.g. 120:price", class: "dialog-input" });
  const body = h("div", { class: "dialog-body" }, input);
  if (!(await formDialog("Go to cell", body, "Go"))) {
    return undefined;
  }
  const m = /^\s*(\d+)\s*(?:[:,\s]\s*(.+?))?\s*$/.exec(input.value);
  if (!m) {
    return undefined;
  }
  const row = Math.max(0, Number(m[1]) - 1);
  let col = 0;
  if (m[2]) {
    const names = columnNames(table);
    const byName = names.findIndex((n) => n.toLowerCase() === m[2].trim().toLowerCase());
    col = byName >= 0 ? byName : Math.max(0, Number(m[2]) - 1 || 0);
  }
  return { row, col };
}
