/** Tiny DOM helpers so the UI code stays readable without a framework. */

type Attrs = Record<string, string | boolean | number | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) {
      continue;
    }
    if (typeof value === "function") {
      el.addEventListener(key.replace(/^on/, "").toLowerCase(), value);
    } else if (key === "class") {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function button(label: string, onClick: (e: MouseEvent) => void, attrs: Attrs = {}): HTMLButtonElement {
  const el = h("button", { type: "button", ...attrs }, label);
  el.addEventListener("click", onClick);
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function openDialog(title: string, body: Node | undefined, onKey: (e: KeyboardEvent, finish: (ok: boolean) => void) => void) {
  return new Promise<boolean>((resolve) => {
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
        { class: "dialog" },
        h("div", { class: "dialog-title" }, title),
        body,
        h(
          "div",
          { class: "dialog-actions" },
          button("Cancel", () => finish(false), { class: "secondary" }),
          button("OK", () => finish(true))
        )
      )
    );
    overlay.addEventListener("keydown", (e) => onKey(e, finish));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) {
        finish(false);
      }
    });
    document.body.append(overlay);
    const focusTarget = body instanceof HTMLElement ? body : overlay.querySelector<HTMLElement>("button:last-child");
    focusTarget?.focus();
    if (body instanceof HTMLInputElement) {
      body.select();
    }
  });
}

/**
 * Modal prompt replacement for `window.prompt`, which VS Code webviews block.
 * Resolves with `undefined` when cancelled.
 */
export async function promptDialog(title: string, defaultValue = "", placeholder = ""): Promise<string | undefined> {
  const input = h("input", { type: "text", value: defaultValue, placeholder, class: "dialog-input" });
  const ok = await openDialog(title, input, (e, finish) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  return ok ? input.value : undefined;
}

export function confirmDialog(message: string): Promise<boolean> {
  return openDialog(message, undefined, (e, finish) => {
    if (e.key === "Escape") {
      finish(false);
    } else if (e.key === "Enter") {
      finish(true);
    }
  });
}
