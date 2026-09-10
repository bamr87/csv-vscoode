# Contributing

## Setup

```bash
git clone https://github.com/bamr87/csv-vscoode.git
cd csv-vscoode
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host with the `samples/` folder open. `npm run watch` rebuilds on change; reload the host window to pick up host-side changes.

## Commands

| Command | What it does |
| --- | --- |
| `npm run compile` | Development build: both bundles plus the sql.js copy |
| `npm run watch` | Rebuild on change |
| `npm run typecheck` | `tsc --noEmit` for the extension host and the webview |
| `npm run lint` | ESLint over the whole repository |
| `npm test` | Vitest unit tests |
| `npm run build` | Typecheck plus production bundles. What CI runs. |
| `npm run package:vsix` | Build and produce a `.vsix` |
| `npm run publish:check` | Verify publishing tokens without publishing |

## Secrets

Publishing tokens live in a git-ignored `.env`, created from `.env.example`. Nothing else in the repository should ever contain a real token. A `.env` at the repo root would otherwise be packaged into the VSIX, so `.vscodeignore` excludes it explicitly; if you add another secrets file, exclude it in both `.gitignore` and `.vscodeignore`.

## Architecture

The code is in three layers, and the split is deliberate.

| Directory | Runs in | Rules |
| --- | --- | --- |
| `src/core/` | Everywhere | Pure TypeScript. No `vscode` import, no DOM. |
| `src/` | Extension host (Node) | May use `vscode` and Node APIs |
| `webview/` | Webview (browser) | May use the DOM. No Node APIs. |

`src/core/` is shared by the host, the webview bundle and the tests. Keeping it free of both `vscode` and the DOM is what makes the logic testable without a VS Code instance, and it is why the test suite runs in milliseconds. Anything that can be expressed as a pure function on a `CsvTable` belongs there.

### Data flow

The text document is the single source of truth. `CsvDocumentModel` parses it into a `CsvTable` and writes changes back with a `WorkspaceEdit`, which is what makes save, undo and redo work without any custom bookkeeping.

The webview never touches the file. It sends typed `EditOp` values to the host, which applies them to the model and writes the document. When the document changes for any other reason, the host re-parses and pushes a fresh table to the webview.

`EditOp` is the whole vocabulary of change: `setCell`, `setCells`, `insertRows`, `deleteRows`, `moveRow`, `insertColumn`, `deleteColumns`, `renameColumn`, `moveColumn`, `sortRows` and `replaceAll`. Adding an operation means adding a case in `applyEdit` and a test.

### Key modules

| Module | Responsibility |
| --- | --- |
| `core/parse.ts`, `core/serialize.ts` | PapaParse wrappers preserving delimiter, quoting and line endings |
| `core/edits.ts` | The `EditOp` vocabulary and its application |
| `core/transform.ts` | Table transformations: split, merge, transpose, fill, dedupe |
| `core/columnFilter.ts` | AutoFilter model, conditions and distinct-value listing |
| `core/pipeline.ts` | Pipeline model, step definitions and the runner |
| `core/infer.ts`, `core/stats.ts` | Type inference and descriptive statistics |
| `csvEditorProvider.ts` | The custom editor, and the webview message loop |
| `pipelineEvaluator.ts` | Node-side evaluation of expressions, scripts, SQL and commands |
| `webview/grid.ts` | Tabulator wrapper: rendering, selection, menus |

## Adding a feature

1. Put the logic in `src/core/` as a pure function and write a test for it.
2. If it changes data, express it as an `EditOp` so undo works for free.
3. Wire it into the webview as a `GridAction`, and add it to the relevant toolbar or context menu.
4. If it makes sense as a repeatable transformation, add it as a pipeline step: a `StepDef` entry, a case in `applyPureStep` or `applyStep`, and an entry in `schemas/csvpipe.schema.json`.
5. Update the documentation in `docs/` and add a `CHANGELOG.md` entry.

## Testing

Tests live in `test/` and run under Vitest. They cover `src/core/` plus the Node pipeline evaluator, which is tested against real scripts and real subprocesses rather than mocks.

There is no automated UI test for the webview. Changes to the grid are verified by hand in the Extension Development Host. When touching the webview, exercise at least: cell edit and undo, range selection and copy, a filter, and a save.

## Conventions

- Conventional Commits: `type(scope): description`, using `feat`, `fix`, `docs`, `refactor`, `test`, `chore` or `ci`.
- Branch from `main` and open a pull request. Never push to `main`.
- Read the nearest `README.md` before changing a directory, and update it afterwards.
- Do not suppress type errors with `as any` or `@ts-ignore`, and do not leave empty catch blocks. A catch that intentionally ignores an error carries a comment saying why.
- Markdown is one paragraph per line. `python3 tools/unwrap-prose.py --write` fixes soft wrapping, and CI enforces it.

## Dependencies

Four runtime dependencies, each carrying real weight: PapaParse for parsing, Tabulator for the grid, sql.js for SQL, and Chart.js for charts. The host bundle excludes sql.js so the WebAssembly loader can find its `.wasm` next to it in `out/sqljs`.

CI runs on Node 20, so development dependencies must stay compatible with it. That is why Vitest is pinned to the 4.x line.
