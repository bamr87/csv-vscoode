# Troubleshooting

## The file opens as text instead of a grid

Another editor association is winning. Check `workbench.editorAssociations` in your settings for an entry covering the file, or right-click the file and choose **Open With** to pick the CSV Grid Editor and set it as default.

## Columns are split in the wrong places

The delimiter was detected incorrectly, which happens on files with very few rows or an unusual mix of punctuation. Override it from the toolbar dropdown, or set `csv.delimiter` for the workspace. The override is remembered per file.

## The first data row is being used as headers

Uncheck **Header row** in the toolbar. If most of your files have no header, set `csv.hasHeaderRow` to `false` for the workspace.

## Numbers sort or aggregate as text

Column types are inferred from the data. A column is only numeric when at least 95 percent of its non-empty values parse as numbers, so a single stray value such as `n/a` or `1,2` can tip it to text.

Find the offending values with the Statistics panel's frequency table, or filter the column with **Is not empty** plus a text condition. Clean them with a find and replace, or a `replace` pipeline step.

## Rows are flagged as ragged

A row has a different number of fields than the header. Almost always this is an unescaped quote or delimiter earlier in the file. Click the ragged-row count in the status bar to normalize, which pads short rows and trims trailing blank cells, or open the file as text where the offending lines are marked in the Problems panel.

Normalizing never discards non-empty data: extra cells beyond the header width are kept.

## Only some of my rows are shown

Two possibilities. Either a filter is active, in which case the status bar reports it and offers a link to clear it, or the file is larger than `csv.maxRows` and a banner says so.

## Find does not match rows I know exist

Find covers the rows loaded in the grid. On a file larger than `csv.maxRows`, raise that setting or use the SQL panel, which always queries the whole file.

## A pipeline step will not run

Steps that evaluate code require a trusted workspace. Check the trust banner, and check `csv.pipelines.allowScripts`. The pipeline panel says explicitly when these steps are disabled.

## A pipeline fails and I cannot see why

Open the **CSV Pipelines** output channel with **CSV: Show Pipeline Log**. It records each step's row counts, timing and the full error text, including anything an external command wrote to standard error.

## An external command step produces nothing

The command must read from standard input and write the result to standard output. Anything written to standard error is logged but not treated as data. A non-zero exit code fails the step. Test it in a terminal first:

```bash
cat data.csv | python3 scripts/clean.py | head
```

## A script file is not found

Script paths are workspace-relative and must resolve inside the workspace folder. Paths escaping the workspace are refused.

## Editing feels slow on a very large file

Every edit rewrites the document text, which is proportional to file size. For bulk changes on large files, prefer a pipeline: it applies the whole transformation in one pass and one undo step, rather than one edit per cell.

## The grid is empty but the file has content

If the file uses an encoding VS Code did not detect, the text document itself will look wrong too. Use **Reopen with Encoding** from the Command Palette.

## Reporting a bug

Open an issue at https://github.com/bamr87/csv-vscoode/issues with the extension version, your VS Code version and platform, what you expected, and a small file that reproduces the problem. Output from the **CSV Pipelines** channel helps for pipeline issues.
