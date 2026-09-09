import {
  BLANK,
  isFilterActive,
  opsForKind,
  type ColumnFilter,
  type Condition,
  type ConditionOp,
  type DistinctValue,
  type FilterKind
} from "../src/core/columnFilter";
import { button, clear, h } from "./dom";

export interface FilterPopupOptions {
  columnName: string;
  kind: FilterKind;
  current: ColumnFilter | undefined;
  /** Distinct values available given the other columns' filters. */
  values: DistinctValue[];
  truncated: boolean;
  anchor: HTMLElement;
  onSort(direction: "asc" | "desc"): void;
  onApply(filter: ColumnFilter | undefined): void;
  onClose(): void;
}

let openPopup: HTMLElement | undefined;
let openCleanup: (() => void) | undefined;

export function closeFilterPopup(): void {
  openCleanup?.();
  openCleanup = undefined;
  openPopup?.remove();
  openPopup = undefined;
}

/**
 * Excel-style AutoFilter dropdown: sort, clear, custom conditions
 * (Text/Number/Date Filters), a search box, and a checkbox list of values
 * with "(Select All)" and "(Blanks)".
 */
export function openFilterPopup(options: FilterPopupOptions): void {
  closeFilterPopup();
  const { kind, values } = options;
  const current = options.current ?? {};
  const kindLabel = kind === "number" ? "Number" : kind === "date" ? "Date" : "Text";

  // --- Sort + clear ---------------------------------------------------------
  const sortAsc = menuItem(kind === "number" ? "Sort Smallest to Largest" : kind === "date" ? "Sort Oldest to Newest" : "Sort A to Z", () => {
    options.onSort("asc");
    closeFilterPopup();
  });
  const sortDesc = menuItem(kind === "number" ? "Sort Largest to Smallest" : kind === "date" ? "Sort Newest to Oldest" : "Sort Z to A", () => {
    options.onSort("desc");
    closeFilterPopup();
  });
  const clearItem = menuItem(`Clear Filter From "${options.columnName}"`, () => {
    options.onApply(undefined);
    closeFilterPopup();
  });
  clearItem.disabled = !isFilterActive(options.current);

  // --- Custom conditions ---------------------------------------------------
  const ops = opsForKind(kind);
  const conditionRow = (initial: Condition | undefined): { element: HTMLElement; read: () => Condition | undefined } => {
    const select = h("select", { "aria-label": "Condition" }, h("option", { value: "" }, "(none)"));
    for (const def of ops) {
      select.append(h("option", { value: def.op }, def.label));
    }
    const input = h("input", { type: kind === "number" ? "text" : kind === "date" ? "date" : "text", placeholder: "value", "aria-label": "Value" });
    const input2 = h("input", { type: kind === "date" ? "date" : "text", placeholder: "and", "aria-label": "Upper value", hidden: true });
    const sync = (): void => {
      const def = ops.find((d) => d.op === select.value);
      input.hidden = !def || def.inputs === 0;
      input2.hidden = !def || def.inputs < 2;
    };
    select.addEventListener("change", sync);
    if (initial) {
      select.value = initial.op;
      input.value = initial.value;
      input2.value = initial.value2 ?? "";
    }
    sync();
    return {
      element: h("div", { class: "filter-condition" }, select, input, input2),
      read: () => {
        const def = ops.find((d) => d.op === select.value);
        if (!def) {
          return undefined;
        }
        return { op: def.op as ConditionOp, value: input.value, value2: def.inputs === 2 ? input2.value : undefined };
      }
    };
  };
  const cond1 = conditionRow(current.condition1);
  const cond2 = conditionRow(current.condition2);
  const logicAnd = h("input", { type: "radio", name: "filter-logic", value: "and", id: "fl-and" });
  const logicOr = h("input", { type: "radio", name: "filter-logic", value: "or", id: "fl-or" });
  (current.logic === "or" ? logicOr : logicAnd).checked = true;
  const customSection = h(
    "div",
    { class: "filter-custom", hidden: !(current.condition1 || current.condition2) },
    cond1.element,
    h("div", { class: "filter-logic" }, h("label", {}, logicAnd, " And"), h("label", {}, logicOr, " Or")),
    cond2.element,
    h("div", { class: "muted small" }, "Use ? for any single character and * for any series of characters.")
  );
  const customToggle = menuItem(`${kindLabel} Filters…`, () => {
    customSection.hidden = !customSection.hidden;
    customToggle.classList.toggle("open", !customSection.hidden);
  });
  customToggle.classList.toggle("open", !customSection.hidden);

  // --- Value list ------------------------------------------------------------
  const search = h("input", { type: "search", placeholder: "Search", class: "filter-search", "aria-label": "Search values" });
  const listEl = h("div", { class: "filter-values", role: "listbox" });
  const checked = new Set<string>(current.values ?? values.map((v) => v.value));
  const allValues = values.map((v) => v.value);
  let visible: DistinctValue[] = values;
  const selectAll = h("input", { type: "checkbox", id: "filter-select-all" });
  const selectAllLabel = h("label", { class: "filter-value", for: "filter-select-all" }, selectAll, h("span", {}, "(Select All)"));
  const countLabel = h("div", { class: "muted small filter-count" });

  const renderList = (): void => {
    clear(listEl);
    const q = search.value.trim().toLowerCase();
    visible = q ? values.filter((v) => (v.value === BLANK ? "(blanks)" : v.value.toLowerCase()).includes(q)) : values;
    if (q) {
      const addSel = h("input", { type: "checkbox", id: "filter-add-sel" });
      addSel.addEventListener("change", () => {
        // Excel: "Add current selection to filter" keeps previously checked items.
        if (!addSel.checked) {
          for (const v of allValues) {
            if (!visible.some((x) => x.value === v)) {
              checked.delete(v);
            }
          }
        }
      });
      listEl.append(h("label", { class: "filter-value muted", for: "filter-add-sel" }, addSel, h("span", {}, "Add current selection to filter")));
    }
    const fragment = document.createDocumentFragment();
    const max = 2000;
    visible.slice(0, max).forEach((v, i) => {
      const id = `fv-${i}`;
      const cb = h("input", { type: "checkbox", id });
      cb.checked = checked.has(v.value);
      cb.addEventListener("change", () => {
        if (cb.checked) {
          checked.add(v.value);
        } else {
          checked.delete(v.value);
        }
        syncSelectAll();
      });
      const text = v.value === BLANK ? "(Blanks)" : v.value;
      fragment.append(
        h(
          "label",
          { class: `filter-value${v.value === BLANK ? " blank" : ""}`, for: id, title: text },
          cb,
          h("span", { class: "filter-value-text" }, text),
          h("span", { class: "filter-value-count muted" }, v.count.toLocaleString())
        )
      );
    });
    listEl.append(fragment);
    if (visible.length > max) {
      listEl.append(h("div", { class: "muted small", style: "padding:4px 8px" }, `${(visible.length - max).toLocaleString()} more values not shown. Refine the search.`));
    }
    if (visible.length === 0) {
      listEl.append(h("div", { class: "muted small", style: "padding:4px 8px" }, "No items match your search."));
    }
    countLabel.textContent = `${values.length.toLocaleString()} unique value${values.length === 1 ? "" : "s"}${options.truncated ? " (list truncated)" : ""}`;
    syncSelectAll();
  };

  const syncSelectAll = (): void => {
    const total = visible.length;
    const on = visible.filter((v) => checked.has(v.value)).length;
    selectAll.checked = total > 0 && on === total;
    selectAll.indeterminate = on > 0 && on < total;
  };

  selectAll.addEventListener("change", () => {
    for (const v of visible) {
      if (selectAll.checked) {
        checked.add(v.value);
      } else {
        checked.delete(v.value);
      }
    }
    renderList();
  });
  search.addEventListener("input", () => {
    renderList();
    // Excel checks every search result by default.
    if (search.value.trim().length > 0) {
      for (const v of visible) {
        checked.add(v.value);
      }
      renderList();
    }
  });

  // --- Apply -----------------------------------------------------------------
  const apply = (): void => {
    const filter: ColumnFilter = {};
    const c1 = cond1.read();
    const c2 = cond2.read();
    if (c1) {
      filter.condition1 = c1;
    }
    if (c2) {
      filter.condition2 = c2;
    }
    if (c1 && c2) {
      filter.logic = logicOr.checked ? "or" : "and";
    }
    const everything = allValues.every((v) => checked.has(v));
    if (!everything) {
      filter.values = allValues.filter((v) => checked.has(v));
    }
    options.onApply(isFilterActive(filter) ? filter : undefined);
    closeFilterPopup();
  };

  const popup = h(
    "div",
    { class: "filter-popup", role: "dialog", "aria-label": `Filter ${options.columnName}` },
    h("div", { class: "filter-title" }, options.columnName),
    sortAsc,
    sortDesc,
    h("div", { class: "menu-sep" }),
    clearItem,
    customToggle,
    customSection,
    h("div", { class: "menu-sep" }),
    search,
    selectAllLabel,
    listEl,
    countLabel,
    h("div", { class: "dialog-actions" }, button("Cancel", () => closeFilterPopup(), { class: "secondary" }), button("OK", apply, { class: "primary" }))
  );
  popup.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeFilterPopup();
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      apply();
    }
  });
  popup.addEventListener("mousedown", (e) => e.stopPropagation());
  document.body.append(popup);
  openPopup = popup;

  // Position under the anchor, keeping the popup inside the viewport.
  const rect = options.anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top = Math.min(rect.bottom + 2, window.innerHeight - 80);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
  popup.style.width = `${width}px`;
  popup.style.maxHeight = `${window.innerHeight - top - 8}px`;

  const onDocMouseDown = (e: MouseEvent): void => {
    if (!popup.contains(e.target as Node)) {
      closeFilterPopup();
    }
  };
  const onResize = (): void => closeFilterPopup();
  document.addEventListener("mousedown", onDocMouseDown, true);
  window.addEventListener("resize", onResize);
  openCleanup = () => {
    document.removeEventListener("mousedown", onDocMouseDown, true);
    window.removeEventListener("resize", onResize);
    options.onClose();
  };

  renderList();
  search.focus();
}

function menuItem(label: string, onClick: () => void): HTMLButtonElement {
  return button(label, onClick, { class: "filter-menu-item" });
}
