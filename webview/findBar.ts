import type { EditOp } from "../src/core/edits";
import { findMatches, replaceAll, replaceInCell, type CellMatch, type SearchOptions } from "../src/core/search";
import type { CsvTable } from "../src/core/types";
import { button, h } from "./dom";

export interface FindBarHost {
  getModel(): CsvTable;
  highlight(keys: Set<string>, current: string | undefined): void;
  reveal(row: number, col: number): Promise<void>;
  applyEdits(ops: EditOp[]): Promise<void>;
}

/** Find/replace bar shown above the grid (Ctrl+F). */
export class FindBar {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly countLabel: HTMLElement;
  private readonly regexToggle: HTMLButtonElement;
  private readonly caseToggle: HTMLButtonElement;
  private readonly wholeToggle: HTMLButtonElement;
  private matches: CellMatch[] = [];
  private index = -1;
  private debounce: number | undefined;

  constructor(private readonly host: FindBarHost) {
    this.input = h("input", { type: "text", placeholder: "Find", class: "find-input", "aria-label": "Find" });
    this.replaceInput = h("input", { type: "text", placeholder: "Replace", class: "find-input", "aria-label": "Replace" });
    this.countLabel = h("span", { class: "find-count" }, "No results");
    this.regexToggle = this.toggle(".*", "Use regular expression");
    this.caseToggle = this.toggle("Aa", "Match case");
    this.wholeToggle = this.toggle("[ ]", "Match whole cell");

    this.element = h(
      "div",
      { class: "find-bar", hidden: true },
      h(
        "div",
        { class: "find-row" },
        this.input,
        this.caseToggle,
        this.wholeToggle,
        this.regexToggle,
        this.countLabel,
        button("↑", () => this.step(-1), { title: "Previous match (Shift+Enter)", class: "icon" }),
        button("↓", () => this.step(1), { title: "Next match (Enter)", class: "icon" }),
        button("✕", () => this.hide(), { title: "Close (Escape)", class: "icon" })
      ),
      h(
        "div",
        { class: "find-row" },
        this.replaceInput,
        button("Replace", () => void this.replaceCurrent(), { title: "Replace current match" }),
        button("Replace all", () => void this.replaceEverything(), { title: "Replace every match" })
      )
    );

    this.input.addEventListener("input", () => this.schedule());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });
    this.replaceInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void this.replaceCurrent();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });
  }

  private toggle(label: string, title: string): HTMLButtonElement {
    const el = button(label, () => {
      el.classList.toggle("active");
      el.setAttribute("aria-pressed", String(el.classList.contains("active")));
      this.search();
    }, { title, class: "toggle", "aria-pressed": "false" });
    return el;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(initial?: string): void {
    this.element.hidden = false;
    if (initial !== undefined && initial.length > 0) {
      this.input.value = initial;
    }
    this.input.focus();
    this.input.select();
    this.search();
  }

  hide(): void {
    this.element.hidden = true;
    this.matches = [];
    this.index = -1;
    this.host.highlight(new Set(), undefined);
  }

  /** Re-run the search after the model changed underneath us. */
  refresh(): void {
    if (this.visible) {
      this.search(true);
    }
  }

  private options(): SearchOptions {
    return {
      query: this.input.value,
      regex: this.regexToggle.classList.contains("active"),
      caseSensitive: this.caseToggle.classList.contains("active"),
      wholeCell: this.wholeToggle.classList.contains("active")
    };
  }

  private schedule(): void {
    if (this.debounce !== undefined) {
      window.clearTimeout(this.debounce);
    }
    this.debounce = window.setTimeout(() => this.search(), 150);
  }

  private search(keepIndex = false): void {
    const previous = keepIndex && this.index >= 0 ? this.matches[this.index] : undefined;
    this.matches = findMatches(this.host.getModel(), this.options());
    this.index = this.matches.length > 0 ? 0 : -1;
    if (previous) {
      const found = this.matches.findIndex((m) => m.row === previous.row && m.col === previous.col);
      if (found >= 0) {
        this.index = found;
      }
    }
    this.publish(!keepIndex);
  }

  private publish(scroll: boolean): void {
    const keys = new Set(this.matches.map((m) => `${m.row}:${m.col}`));
    const current = this.index >= 0 ? this.matches[this.index] : undefined;
    this.host.highlight(keys, current ? `${current.row}:${current.col}` : undefined);
    this.countLabel.textContent =
      this.matches.length === 0
        ? this.input.value.length > 0
          ? "No results"
          : ""
        : `${this.index + 1} of ${this.matches.length.toLocaleString()}`;
    if (scroll && current) {
      void this.host.reveal(current.row, current.col);
    }
  }

  private step(delta: number): void {
    if (this.matches.length === 0) {
      this.search();
      return;
    }
    this.index = (this.index + delta + this.matches.length) % this.matches.length;
    this.publish(true);
  }

  private async replaceCurrent(): Promise<void> {
    if (this.index < 0 || this.matches.length === 0) {
      this.search();
      return;
    }
    const match = this.matches[this.index];
    const model = this.host.getModel();
    const before = model.rows[match.row]?.[match.col] ?? "";
    const after = replaceInCell(before, this.options(), this.replaceInput.value);
    if (after !== before) {
      await this.host.applyEdits([{ kind: "setCell", row: match.row, col: match.col, value: after }]);
    }
    // Recompute: the replaced cell may no longer match, so keep the position.
    const keepIndex = this.index;
    this.matches = findMatches(model, this.options());
    this.index = this.matches.length === 0 ? -1 : Math.min(keepIndex, this.matches.length - 1);
    this.publish(true);
  }

  private async replaceEverything(): Promise<void> {
    const op = replaceAll(this.host.getModel(), this.options(), this.replaceInput.value);
    if (!op) {
      return;
    }
    await this.host.applyEdits([op]);
    this.search();
  }
}
