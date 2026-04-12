import * as vscode from "vscode";

type CsvCell = {
  display: string;
  numericValue: number | null;
};

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand("csvGridViewer.openGrid", async (uri?: vscode.Uri) => {
    const targetUri = resolveTargetUri(uri);
    if (!targetUri) {
      vscode.window.showErrorMessage("Open a CSV file first, then run 'CSV: Open Grid View'.");
      return;
    }

    if (!isCsvFile(targetUri)) {
      vscode.window.showErrorMessage("This command supports only .csv files.");
      return;
    }

    let text: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(targetUri);
      text = Buffer.from(bytes).toString("utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown file read error.";
      vscode.window.showErrorMessage(`Could not read CSV file: ${message}`);
      return;
    }

    const rows = parseCsv(text);
    const panel = vscode.window.createWebviewPanel(
      "csvGridViewer.panel",
      `CSV Grid: ${vscode.workspace.asRelativePath(targetUri, false)}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true
      }
    );

    panel.webview.html = getWebviewHtml(rows, panel.webview);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // no-op
}

function resolveTargetUri(uri?: vscode.Uri): vscode.Uri | undefined {
  if (uri) {
    return uri;
  }

  const editorUri = vscode.window.activeTextEditor?.document.uri;
  if (editorUri) {
    return editorUri;
  }

  return undefined;
}

function isCsvFile(uri: vscode.Uri): boolean {
  return uri.path.toLowerCase().endsWith(".csv");
}

function parseCsv(content: string): CsvCell[][] {
  const rows: CsvCell[][] = [];
  let row: CsvCell[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = (): void => {
    const trimmed = field.trim();
    const parsed = trimmed.length > 0 ? Number(trimmed) : Number.NaN;
    row.push({
      display: field,
      numericValue: Number.isFinite(parsed) ? parsed : null
    });
    field = "";
  };

  const pushRow = (): void => {
    if (row.length > 0 || rows.length > 0) {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];

    if (ch === "\"") {
      if (inQuotes && content[i + 1] === "\"") {
        field += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      pushField();
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && content[i + 1] === "\n") {
        i += 1;
      }
      pushField();
      pushRow();
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    pushField();
  }

  if (row.length > 0) {
    pushRow();
  }

  return rows;
}

function getWebviewHtml(rows: CsvCell[][], webview: vscode.Webview): string {
  const nonce = String(Date.now());
  const safeRows = JSON.stringify(rows).replace(/</g, "\\u003c");
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CSV Grid Viewer</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 12px;
    }
    .toolbar {
      display: flex;
      gap: 16px;
      align-items: center;
      margin-bottom: 10px;
      position: sticky;
      top: 0;
      padding: 8px 0;
      background: var(--vscode-editor-background);
      z-index: 10;
    }
    .metric {
      font-size: 13px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 4px 10px;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .grid-wrap {
      overflow: auto;
      max-height: calc(100vh - 84px);
      border: 1px solid var(--vscode-panel-border);
    }
    table {
      border-collapse: collapse;
      width: max-content;
      min-width: 100%;
    }
    td, th {
      border: 1px solid var(--vscode-panel-border);
      padding: 6px 10px;
      white-space: nowrap;
      user-select: none;
      cursor: pointer;
    }
    th {
      background: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-editor-foreground));
      position: sticky;
      top: 0;
      z-index: 5;
    }
    td.selected {
      background: color-mix(in srgb, var(--vscode-focusBorder) 25%, transparent);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    td.numeric::after {
      content: "";
      display: inline-block;
      width: 6px;
      height: 6px;
      margin-left: 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--vscode-editorInfo-foreground) 60%, transparent);
      vertical-align: middle;
    }
    .empty {
      opacity: 0.8;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="clearBtn" type="button">Clear Selection</button>
    <div class="metric" id="countLabel">Selected Cells: 0</div>
    <div class="metric" id="sumLabel">Numeric Sum: 0</div>
  </div>
  <div class="grid-wrap" id="gridWrap"></div>

  <script nonce="${nonce}">
    const rows = ${safeRows};
    const selected = new Set();
    const numericValues = new Map();

    const gridWrap = document.getElementById("gridWrap");
    const countLabel = document.getElementById("countLabel");
    const sumLabel = document.getElementById("sumLabel");
    const clearBtn = document.getElementById("clearBtn");

    if (!Array.isArray(rows) || rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No rows found in this CSV.";
      gridWrap.appendChild(empty);
    } else {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const tbody = document.createElement("tbody");

      const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
      const headerRow = document.createElement("tr");
      const topLeft = document.createElement("th");
      topLeft.textContent = "#";
      headerRow.appendChild(topLeft);
      for (let c = 0; c < maxCols; c += 1) {
        const th = document.createElement("th");
        th.textContent = "Col " + (c + 1);
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);

      rows.forEach((row, r) => {
        const tr = document.createElement("tr");
        const rowIndex = document.createElement("th");
        rowIndex.textContent = String(r + 1);
        tr.appendChild(rowIndex);

        for (let c = 0; c < maxCols; c += 1) {
          const cell = row[c] || { display: "", numericValue: null };
          const td = document.createElement("td");
          td.textContent = cell.display;
          const key = r + ":" + c;
          td.dataset.key = key;

          if (typeof cell.numericValue === "number" && Number.isFinite(cell.numericValue)) {
            numericValues.set(key, cell.numericValue);
            td.classList.add("numeric");
          }

          td.addEventListener("click", () => {
            if (selected.has(key)) {
              selected.delete(key);
              td.classList.remove("selected");
            } else {
              selected.add(key);
              td.classList.add("selected");
            }
            refreshMetrics();
          });

          tr.appendChild(td);
        }

        tbody.appendChild(tr);
      });

      table.appendChild(thead);
      table.appendChild(tbody);
      gridWrap.appendChild(table);
    }

    clearBtn.addEventListener("click", () => {
      for (const key of selected) {
        const el = document.querySelector('td[data-key="' + key + '"]');
        if (el) {
          el.classList.remove("selected");
        }
      }
      selected.clear();
      refreshMetrics();
    });

    function refreshMetrics() {
      countLabel.textContent = "Selected Cells: " + selected.size;
      let sum = 0;
      for (const key of selected) {
        const value = numericValues.get(key);
        if (typeof value === "number") {
          sum += value;
        }
      }
      sumLabel.textContent = "Numeric Sum: " + sum;
    }
  </script>
</body>
</html>`;
}
