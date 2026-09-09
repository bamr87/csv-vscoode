import * as vscode from "vscode";
import { applyEdits, type EditOp } from "./core/edits";
import { delimiterForPath, parseCsv } from "./core/parse";
import { serializeCsv } from "./core/serialize";
import type { CsvTable } from "./core/types";
import { getDocumentOverrides, getSettings, setDocumentOverrides } from "./settings";

/**
 * Bridges a `vscode.TextDocument` and the parsed `CsvTable`.
 *
 * The text document is the source of truth (so VS Code owns save, undo, dirty
 * state and external changes). The model re-parses lazily whenever the
 * document version changes, and writes back by replacing the full text.
 */
export class CsvDocumentModel {
  private table: CsvTable | undefined;
  private parsedVersion = -1;
  /** Text we last wrote ourselves; changes matching it are echoes of our own edit. */
  private lastWrittenText: string | undefined;

  constructor(
    public readonly document: vscode.TextDocument,
    private readonly state: vscode.Memento
  ) {}

  get uri(): vscode.Uri {
    return this.document.uri;
  }

  get hasHeader(): boolean {
    return this.getTable().hasHeader;
  }

  get delimiter(): string {
    return this.getTable().delimiter;
  }

  /** Whether a document change event reflects an edit this model made. */
  consumeEcho(text: string): boolean {
    if (this.lastWrittenText !== undefined && this.lastWrittenText === text) {
      this.lastWrittenText = undefined;
      return true;
    }
    this.lastWrittenText = undefined;
    return false;
  }

  invalidate(): void {
    this.parsedVersion = -1;
  }

  getTable(): CsvTable {
    if (!this.table || this.parsedVersion !== this.document.version) {
      const settings = getSettings(this.document);
      const overrides = getDocumentOverrides(this.state, this.document.uri);
      const delimiter = overrides.delimiter ?? settings.delimiter;
      this.table = parseCsv(this.document.getText(), {
        hasHeader: overrides.hasHeader ?? settings.hasHeaderRow,
        delimiter: delimiter === "auto" ? "auto" : delimiter,
        preferredDelimiter: delimiterForPath(this.document.uri.path)
      });
      this.parsedVersion = this.document.version;
    }
    return this.table;
  }

  async setHasHeader(hasHeader: boolean): Promise<void> {
    await setDocumentOverrides(this.state, this.document.uri, { hasHeader });
    this.invalidate();
  }

  async setDelimiter(delimiter: string): Promise<void> {
    await setDocumentOverrides(this.state, this.document.uri, { delimiter: delimiter === "auto" ? undefined : delimiter });
    this.invalidate();
  }

  /** Apply edit operations and write the result back to the text document. */
  async applyEdits(ops: EditOp[]): Promise<boolean> {
    const table = this.getTable();
    applyEdits(table, ops);
    return this.writeTable(table);
  }

  /** Replace the document with the given table's serialization. */
  async writeTable(table: CsvTable): Promise<boolean> {
    const text = serializeCsv(table);
    if (text === this.document.getText()) {
      return true;
    }
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      this.document.positionAt(0),
      this.document.positionAt(this.document.getText().length)
    );
    edit.replace(this.document.uri, fullRange, text);
    this.lastWrittenText = text;
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) {
      // Keep the already-mutated table; it matches the new document version.
      this.table = table;
      this.parsedVersion = this.document.version;
    } else {
      this.lastWrittenText = undefined;
      this.invalidate();
    }
    return ok;
  }
}
