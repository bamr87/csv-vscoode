import * as vscode from "vscode";
import { CsvEditorProvider, GridSession, VIEW_TYPE } from "./csvEditorProvider";
import { pickFormatAndExport } from "./exportCommands";
import { CsvHoverProvider, CSV_SELECTOR, RainbowTokensProvider, registerFieldCountLinter } from "./textMode";
import { DELIMITER_CHOICES, describeDelimiter, isCsvLikeUri } from "./settings";
import { registerStatusBar } from "./statusBar";
import { CsvDocumentModel } from "./documentModel";
import type { PanelId } from "./core/messages";
import { PipelineService } from "./pipelines";

export function activate(context: vscode.ExtensionContext): void {
  const pipelines = new PipelineService(context);
  const provider = CsvEditorProvider.register(context, pipelines);
  registerStatusBar(context, provider);

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      CSV_SELECTOR,
      new RainbowTokensProvider(),
      RainbowTokensProvider.legend
    ),
    vscode.languages.registerHoverProvider(CSV_SELECTOR, new CsvHoverProvider())
  );
  registerFieldCountLinter(context);

  /** Resolve the CSV the user means: explicit URI, active grid, or active text editor. */
  const resolveUri = (uri?: vscode.Uri): vscode.Uri | undefined => {
    if (uri) {
      return uri;
    }
    if (provider.active) {
      return provider.active.document.uri;
    }
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    if (editorUri && (isCsvLikeUri(editorUri) || vscode.window.activeTextEditor?.document.languageId === "csv")) {
      return editorUri;
    }
    return undefined;
  };

  /** Open (or reveal) the grid for a URI and return its session once ready. */
  const openGrid = async (uri?: vscode.Uri): Promise<GridSession | undefined> => {
    const target = resolveUri(uri);
    if (!target) {
      vscode.window.showErrorMessage("Open a CSV file first.");
      return undefined;
    }
    const existing = provider.sessionFor(target);
    if (existing) {
      existing.panel.reveal();
      return existing;
    }
    await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
    return provider.sessionFor(target);
  };

  const withGridPanel = (panel: PanelId) => async (uri?: unknown) => {
    const session = await openGrid(uri instanceof vscode.Uri ? uri : undefined);
    session?.focusPanel(panel);
  };

  const register = (command: string, callback: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };

  register("csv.openGrid", (uri?: unknown) => openGrid(uri instanceof vscode.Uri ? uri : undefined));

  register("csv.openAsText", async (uri?: unknown) => {
    const target = resolveUri(uri instanceof vscode.Uri ? uri : undefined);
    if (target) {
      await vscode.commands.executeCommand("vscode.openWith", target, "default");
    }
  });

  register("csv.runSql", withGridPanel("sql"));
  register("csv.columnStats", withGridPanel("stats"));
  register("csv.chart", withGridPanel("chart"));

  register("csv.find", async (uri?: unknown) => {
    const session = await openGrid(uri instanceof vscode.Uri ? uri : undefined);
    session?.focusFind();
  });

  register("csv.export", async (uri?: unknown) => {
    const target = resolveUri(uri instanceof vscode.Uri ? uri : undefined);
    if (!target) {
      vscode.window.showErrorMessage("Open a CSV file first.");
      return;
    }
    const session = provider.sessionFor(target);
    const model = session?.model ?? new CsvDocumentModel(await vscode.workspace.openTextDocument(target), context.workspaceState);
    await pickFormatAndExport(model.getTable(), target);
  });

  register("csv.toggleHeaderRow", async () => {
    const session = provider.active ?? (await openGrid());
    if (!session) {
      return;
    }
    const next = !session.model.hasHeader;
    await session.model.setHasHeader(next);
    session.sendTable();
    session.post({ type: "setHeader", hasHeader: next });
  });

  register("csv.setDelimiter", async () => {
    const session = provider.active ?? (await openGrid());
    if (!session) {
      return;
    }
    const pick = await vscode.window.showQuickPick(
      DELIMITER_CHOICES.map((c) => ({
        label: c.label,
        description: c.value !== "auto" && c.value === session.model.delimiter ? "current" : undefined,
        value: c.value
      })),
      { placeHolder: `Delimiter (currently ${describeDelimiter(session.model.delimiter)})` }
    );
    if (!pick) {
      return;
    }
    await session.model.setDelimiter(pick.value);
    session.sendTable();
  });

  register("csv.openPipelinePanel", withGridPanel("pipeline"));
  register("csv.showPipelineLog", () => pipelines.showLog());

  register("csv.runPipeline", async (arg?: unknown) => {
    const argUri = arg instanceof vscode.Uri ? arg : undefined;
    let pipelinePath: string | undefined;
    let target: vscode.Uri | undefined;
    if (argUri && argUri.path.endsWith(".csvpipe.json")) {
      pipelinePath = vscode.workspace.asRelativePath(argUri, false);
      target = resolveUri();
      if (!target) {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { "Delimited files": ["csv", "tsv", "tab", "psv"] }, title: "CSV file to process" });
        target = picked?.[0];
      }
    } else {
      target = resolveUri(argUri);
    }
    if (!target) {
      vscode.window.showErrorMessage("Open a CSV file first.");
      return;
    }
    if (!pipelinePath) {
      const items = await pipelines.list(target);
      if (items.length === 0) {
        const create = await vscode.window.showInformationMessage("No *.csvpipe.json pipelines found in the workspace.", "Create one", "Open pipeline panel");
        if (create === "Create one") {
          await vscode.commands.executeCommand("csv.newPipeline");
        } else if (create) {
          await vscode.commands.executeCommand("csv.openPipelinePanel", target);
        }
        return;
      }
      const pick = await vscode.window.showQuickPick(
        items.map((i) => ({ label: `${i.matches ? "$(star-full) " : ""}${i.name}`, description: i.path, detail: `trigger: ${i.trigger}`, path: i.path })),
        { placeHolder: `Run a pipeline on ${vscode.workspace.asRelativePath(target, false)}` }
      );
      if (!pick) {
        return;
      }
      pipelinePath = pick.path;
    }
    try {
      const { pipeline } = await pipelines.load(pipelinePath);
      const session = provider.sessionFor(target);
      const model = session?.model ?? new CsvDocumentModel(await vscode.workspace.openTextDocument(target), context.workspaceState);
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `CSV pipeline: ${pipeline.name}` }, () =>
        pipelines.run(pipeline, model.getTable(), target)
      );
      if (!result.ok) {
        const failed = result.steps.find((s) => s.error);
        void vscode.window.showErrorMessage(`Pipeline stopped: ${failed?.label}: ${failed?.error}`, "Show log").then((c) => c && pipelines.showLog());
        return;
      }
      const info = await pipelines.deliver(result, pipeline, target, session?.model);
      vscode.window.showInformationMessage(`Pipeline "${pipeline.name}": ${result.table.rows.length.toLocaleString()} rows. ${info}`);
    } catch (error) {
      void vscode.window.showErrorMessage(`CSV pipeline: ${error instanceof Error ? error.message : String(error)}`, "Show log").then((c) => c && pipelines.showLog());
    }
  });

  register("csv.newPipeline", async () => {
    const name = await vscode.window.showInputBox({ prompt: "Pipeline name", value: "My pipeline" });
    if (!name) {
      return;
    }
    const current = resolveUri();
    try {
      const uri = await pipelines.createFromTemplate(name, current ? vscode.workspace.asRelativePath(current, false) : undefined);
      if (uri) {
        await vscode.window.showTextDocument(uri);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`CSV pipeline: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  register("csv.newPipelineScript", async () => {
    const path = await vscode.window.showInputBox({ prompt: "Script path (workspace-relative)", value: "scripts/transform.js" });
    if (!path) {
      return;
    }
    try {
      const uri = await pipelines.createScript(path);
      await vscode.window.showTextDocument(uri);
    } catch (error) {
      vscode.window.showErrorMessage(`CSV pipeline: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  register("csv.showActions", async () => {
    const actions: { label: string; command: string }[] = [
      { label: "$(search) Find and replace", command: "csv.find" },
      { label: "$(graph) Column statistics", command: "csv.columnStats" },
      { label: "$(pie-chart) Chart a column", command: "csv.chart" },
      { label: "$(database) Run SQL query", command: "csv.runSql" },
      { label: "$(export) Export as…", command: "csv.export" },
      { label: "$(run-all) Run pipeline…", command: "csv.runPipeline" },
      { label: "$(tools) Pipeline builder", command: "csv.openPipelinePanel" },
      { label: "$(list-flat) Toggle header row", command: "csv.toggleHeaderRow" },
      { label: "$(symbol-operator) Set delimiter", command: "csv.setDelimiter" },
      { label: "$(file-code) Open as text", command: "csv.openAsText" }
    ];
    const pick = await vscode.window.showQuickPick(actions, { placeHolder: "CSV actions" });
    if (pick) {
      await vscode.commands.executeCommand(pick.command);
    }
  });
}

export function deactivate(): void {
  // Disposables are released through context.subscriptions.
}
