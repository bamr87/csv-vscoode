import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/** Extension host bundle (Node). sql.js is loaded at runtime from out/sqljs. */
const hostOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "out/extension.js",
  external: ["vscode", "sql.js"],
  sourcemap: !production,
  minify: production,
  logLevel: "info"
};

/** Webview bundle (browser). Imports Tabulator + Chart.js and emits main.css. */
const webviewOptions = {
  entryPoints: ["webview/main.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  outfile: "out/webview/main.js",
  sourcemap: !production,
  minify: production,
  loader: { ".css": "css", ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "dataurl" },
  logLevel: "info"
};

function copySqlJs() {
  const dist = path.dirname(require.resolve("sql.js/dist/sql-wasm.js"));
  mkdirSync("out/sqljs", { recursive: true });
  for (const file of ["sql-wasm.js", "sql-wasm.wasm"]) {
    copyFileSync(path.join(dist, file), path.join("out/sqljs", file));
  }
}

copySqlJs();

if (watch) {
  const [host, web] = await Promise.all([esbuild.context(hostOptions), esbuild.context(webviewOptions)]);
  await Promise.all([host.watch(), web.watch()]);
  console.log("esbuild watching…");
} else {
  await Promise.all([esbuild.build(hostOptions), esbuild.build(webviewOptions)]);
}
