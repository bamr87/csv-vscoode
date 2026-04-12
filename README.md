# CSV Grid Viewer

A simple VS Code extension that opens `.csv` files in a grid UI and calculates the sum of selected numeric cells.

## Features

- Grid view with row/column headers
- Click-to-select cells
- Live count of selected cells
- Live sum of selected numeric values
- "Clear Selection" action

## Run Locally

1. Install dependencies:
   - `npm install`
2. Compile:
   - `npm run compile`
3. Launch extension development host:
   - Press `F5` in VS Code
4. Open a CSV file and run:
   - `CSV: Open Grid View`

You can also trigger the same command from the editor title bar or file explorer context menu for CSV files.

## Publish

Use the publishing workflow in `PUBLISHING.md`:

1. `npm run publish:init -- --publisher <publisher-id> --repo <https://github.com/<user>/<repo>.git>`
2. `npm run publish:login -- <publisher-id>`
3. `npm run package:vsix`
4. `npm run publish:extension`
