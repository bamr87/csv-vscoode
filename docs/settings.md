# Settings

All settings live under the `csv.` prefix and can be set globally, per workspace, or per language with a `[csv]` block.

## Parsing

### `csv.hasHeaderRow`

Default `true`. Treat the first row as column names. The toolbar checkbox overrides this for a single file, and that override is remembered.

### `csv.delimiter`

Default `auto`. One of `auto`, `,`, `\t`, `;` or `|`. With `auto`, the delimiter is detected by scoring each candidate on how consistently it splits the first records, with the file extension as a tie-breaker: `.tsv` and `.tab` prefer tab, `.psv` prefers pipe. The toolbar dropdown overrides this per file.

## Grid

### `csv.maxRows`

Default `100000`. How many rows are loaded into the grid view. Larger files still edit, query and export in full; only the view, find and statistics are limited. Raising this costs memory and initial render time.

### `csv.sqlResultLimit`

Default `5000`. Maximum rows returned to the SQL results panel. The query still runs over the whole file and the panel reports the true total when a result is truncated.

## Text mode

### `csv.rainbowColumns`

Default `true`. Give each column a distinct colour when a CSV file is open in the text editor. Colours come from your theme's semantic token colours, so they follow the active theme.

### `csv.rainbowMaxLines`

Default `20000`. Only colour the first N lines, which keeps very large files responsive.

### `csv.lintFieldCount`

Default `true`. Report rows whose field count differs from the header row as warnings in the Problems panel. A mismatch usually means an unescaped quote or delimiter. Multi-line quoted fields are handled correctly and are not flagged.

## Pipelines

### `csv.pipelines.folder`

Default `.vscode/csv-pipelines`. Where the pipeline builder proposes to save new pipelines. Any `*.csvpipe.json` file anywhere in the workspace is discovered regardless of this setting.

### `csv.pipelines.allowScripts`

Default `true`. Allow steps that evaluate code: `filter`, `compute`, `script`, `scriptFile`, `sql` and `command`. These never run in an untrusted workspace whatever this is set to. Setting it to `false` disables them everywhere; no-code steps continue to work.

### `csv.pipelines.timeoutMs`

Default `10000`. Time limit for expression and script steps. External commands get six times this value.

### `csv.pipelines.previewRows`

Default `1000`. Rows shown in the pipeline preview grid. Does not affect what is written when the pipeline runs for real.

## Related VS Code settings

| Setting | Why it matters |
| --- | --- |
| `workbench.editorAssociations` | Set `"*.csv": "default"` to make the text editor the default again |
| `files.encoding` | The grid reads and writes with the encoding VS Code uses for the document |
| `files.autoSave` | With `afterDelay`, grid edits save automatically, and `onSave` pipelines fire accordingly |
| `editor.semanticHighlighting.enabled` | Required for rainbow columns; the extension enables it for `csv` and `tsv` by default |

## Example configuration

```json
{
  "csv.delimiter": "auto",
  "csv.maxRows": 250000,
  "csv.pipelines.allowScripts": true,
  "[csv]": {
    "editor.semanticHighlighting.enabled": true
  },
  "workbench.editorAssociations": {
    "*.log.csv": "default"
  }
}
```
