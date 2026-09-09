import { createRequire } from "node:module";
import * as path from "node:path";
import type initSqlJs from "sql.js";
import type { SqlJsStatic } from "sql.js";

let instance: Promise<SqlJsStatic> | undefined;

/**
 * Load sql.js from the copy the build places under `out/sqljs`. The module is
 * kept out of the extension bundle so the emscripten loader can find its
 * `.wasm` file next to it.
 */
export function loadSqlJs(extensionPath: string): Promise<SqlJsStatic> {
  if (!instance) {
    const dir = path.join(extensionPath, "out", "sqljs");
    const require = createRequire(__filename);
    const init = require(path.join(dir, "sql-wasm.js")) as typeof initSqlJs;
    instance = init({ locateFile: (file: string) => path.join(dir, file) });
  }
  return instance;
}
