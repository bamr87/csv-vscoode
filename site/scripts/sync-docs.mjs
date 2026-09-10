#!/usr/bin/env node
/**
 * Generates the site's guide and reference pages from the repository's own
 * markdown, so /docs stays the single source of truth and the site can never
 * drift from what a reader sees on GitHub.
 *
 * Everything this script writes is git-ignored. Edit the source file listed in
 * PAGES, not the generated copy.
 *
 * Two reference pages are generated from machine-readable sources instead:
 * the command list from package.json's `contributes.commands`, and the pipeline
 * reference from schemas/csvpipe.schema.json. Neither can go stale.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const ROOT = path.resolve(SITE, "..");
const CONTENT = path.join(SITE, "src", "content", "docs");
const PUBLIC = path.join(SITE, "public");

/** Base path the site is served from; links to public assets need the prefix. */
const BASE = (process.env.SITE_BASE ?? "/csv-vscode").replace(/\/+$/, "");
const REPO = "https://github.com/bamr87/csv-vscoode";

/**
 * source: path relative to the repository root.
 * out:    path relative to site/src/content/docs.
 * route:  the URL the page ends up at, used to rewrite cross-document links.
 */
const PAGES = [
  {
    source: "docs/getting-started.md",
    out: "guides/getting-started.md",
    route: "/guides/getting-started/",
    title: "Getting started",
    description: "Install the extension, open a delimited file, and learn the difference between grid mode and text mode.",
    order: 1,
  },
  {
    source: "docs/grid-editor.md",
    out: "guides/grid-editor.md",
    route: "/guides/grid-editor/",
    title: "The grid editor",
    description: "Editing cells, working with rows and columns, cleaning data and exporting it.",
    order: 2,
  },
  {
    source: "docs/filtering-and-search.md",
    out: "guides/filtering-and-search.md",
    route: "/guides/filtering-and-search/",
    title: "Filtering, search and sort",
    description: "Excel-style AutoFilter dropdowns, find and replace, and multi-level sorting.",
    order: 3,
  },
  {
    source: "docs/analysis.md",
    out: "guides/analysis.md",
    route: "/guides/analysis/",
    title: "Analysis",
    description: "Column statistics, charts, and SQL queries over the open file.",
    order: 4,
  },
  {
    source: "docs/pipelines.md",
    out: "guides/pipelines.md",
    route: "/guides/pipelines/",
    title: "Pipelines",
    description: "Reusable no-code, low-code and code transformations saved as .csvpipe.json files.",
    order: 5,
  },
  {
    source: "docs/keyboard-shortcuts.md",
    out: "reference/keyboard-shortcuts.md",
    route: "/reference/keyboard-shortcuts/",
    title: "Keyboard shortcuts",
    description: "Every shortcut the grid understands, next to its Excel equivalent.",
    order: 3,
  },
  {
    source: "docs/settings.md",
    out: "reference/settings.md",
    route: "/reference/settings/",
    title: "Settings",
    description: "Every configuration option the extension contributes, and where each one applies.",
    order: 2,
  },
  {
    source: "docs/troubleshooting.md",
    out: "reference/troubleshooting.md",
    route: "/reference/troubleshooting/",
    title: "Troubleshooting",
    description: "Common problems and their fixes.",
    order: 6,
  },
  {
    source: "docs/FEATURE-PARITY.md",
    out: "reference/feature-parity.md",
    route: "/reference/feature-parity/",
    title: "Feature parity",
    description: "How the extension compares with Excel and other CSV tools, and what is still missing.",
    order: 5,
  },
  {
    source: "CHANGELOG.md",
    out: "reference/changelog.md",
    route: "/reference/changelog/",
    title: "Changelog",
    description: "Every released version and what changed in it.",
    order: 7,
  },
  {
    source: "CONTRIBUTING.md",
    out: "contribute/contributing.md",
    route: "/contribute/contributing/",
    title: "Contributing",
    description: "Development setup, the build, the test suite, and the conventions a pull request is held to.",
    order: 1,
  },
  {
    source: "docs/RELEASING.md",
    out: "contribute/releasing.md",
    route: "/contribute/releasing/",
    title: "Releasing",
    description: "How a new version is built, packaged and published to the Marketplace and Open VSX.",
    order: 3,
  },
];

/** Link targets that resolve to a page not generated from a markdown file. */
const EXTRA_ROUTES = {
  "docs/README.md": "/",
  "README.md": "/",
};

const routeFor = new Map();
for (const page of PAGES) {
  routeFor.set(page.source, page.route);
}
for (const [source, route] of Object.entries(EXTRA_ROUTES)) {
  routeFor.set(source, route);
}

/** YAML-safe double-quoted scalar. */
function yamlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Rewrites a relative markdown link found in `sourcePath` to a site route.
 * Anything that does not resolve to a page we generate is left alone, so links
 * to files that only exist in the repository still point at GitHub.
 */
function resolveLink(target, sourcePath) {
  const [pathPart, hash = ""] = target.split("#");
  const resolved = path
    .normalize(path.join(path.dirname(sourcePath), pathPart))
    .split(path.sep)
    .join("/");
  const route = routeFor.get(resolved);
  if (route) {
    return `${BASE}${route}${hash ? `#${hash}` : ""}`;
  }
  // Not a site page: point at the file on GitHub rather than leaving a 404.
  return `${REPO}/blob/main/${resolved}${hash ? `#${hash}` : ""}`;
}

function transform(markdown, page) {
  let text = markdown.replace(/^\uFEFF/, "");

  // Starlight renders the title from frontmatter; a second H1 would duplicate it.
  text = text.replace(/^#\s+.+\n+/, "");

  // Screenshots are committed to this repository. Serve them from the site
  // rather than from raw.githubusercontent.com so the page works offline and
  // does not depend on the state of the default branch.
  text = text.replace(
    /https:\/\/raw\.githubusercontent\.com\/bamr87\/csv-vscoode\/main\/media\//g,
    `${BASE}/media/`,
  );

  // Relative links between repository markdown files become site routes.
  text = text.replace(/\]\(([^)\s#]+\.md)(#[^)\s]*)?\)/gi, (match, target, hash = "") => {
    if (/^[a-z]+:/i.test(target) || target.startsWith("/")) {
      return match;
    }
    return `](${resolveLink(target + hash, page.source)})`;
  });

  return text.trimStart();
}

function frontmatter(page) {
  const lines = [
    "---",
    `title: ${yamlString(page.title)}`,
    `description: ${yamlString(page.description)}`,
    `editUrl: ${yamlString(`${REPO}/edit/main/${page.source}`)}`,
    "sidebar:",
    `  order: ${page.order}`,
    "---",
    "",
    `<!-- Generated from ${page.source} by site/scripts/sync-docs.mjs. Do not edit. -->`,
    "",
  ];
  return lines.join("\n");
}

/** Reference page listing every contributed command, built from package.json. */
function commandsPage(pkg) {
  const commands = pkg.contributes.commands;
  const keybindings = new Map(
    (pkg.contributes.keybindings ?? []).map((k) => [k.command, k]),
  );
  const rows = commands
    // The sidebar's own context-menu entries are hidden from the palette and
    // are documented where they appear, not in the command reference.
    .filter((c) => !/^csv\.(settings|pipelines|files|views)\./.test(c.command) && c.command !== "csv.reloadDocument")
    .map((c) => {
      const binding = keybindings.get(c.command);
      const keys = binding ? `\`${binding.mac ?? binding.key}\` / \`${binding.key}\`` : "—";
      return `| **${c.category}: ${c.title}** | \`${c.command}\` | ${keys} |`;
    });

  const internal = commands
    .filter((c) => /^csv\.(settings|pipelines|files|views)\./.test(c.command))
    .map((c) => `| **${c.category}: ${c.title}** | \`${c.command}\` |`);

  return [
    "---",
    'title: "Commands"',
    'description: "Every command the extension contributes to the Command Palette, with its identifier and default keybinding."',
    `editUrl: ${yamlString(`${REPO}/edit/main/package.json`)}`,
    "sidebar:",
    "  order: 1",
    "---",
    "",
    "<!-- Generated from package.json by site/scripts/sync-docs.mjs. Do not edit. -->",
    "",
    "Every command is under the **CSV** category. Open the Command Palette with `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P`, type `CSV`, and they all appear. `CSV: Show Actions` is a quick pick of the whole list.",
    "",
    "## Command Palette",
    "",
    "| Command | Identifier | Default keybinding |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## Sidebar and context-menu commands",
    "",
    "These are invoked from the CSV views in the activity bar rather than typed. They are listed here because they can be bound to keys or called from a task.",
    "",
    "| Command | Identifier |",
    "| --- | --- |",
    ...internal,
    "",
    "## Calling a command yourself",
    "",
    "Any of these can be bound to a key in `keybindings.json`:",
    "",
    "```json",
    "{",
    '  "key": "ctrl+alt+q",',
    '  "command": "csv.runSql",',
    '  "when": "activeCustomEditorId == csv.gridEditor"',
    "}",
    "```",
    "",
  ].join("\n");
}

/** Reference page for the pipeline file format, built from the JSON schema. */
function pipelineSchemaPage(schema) {
  const out = [
    "---",
    'title: "Pipeline schema"',
    'description: "Every field of the .csvpipe.json format and every step kind, generated from the JSON schema the extension validates against."',
    `editUrl: ${yamlString(`${REPO}/edit/main/schemas/csvpipe.schema.json`)}`,
    "sidebar:",
    "  order: 4",
    "---",
    "",
    "<!-- Generated from schemas/csvpipe.schema.json by site/scripts/sync-docs.mjs. Do not edit. -->",
    "",
    "This page is generated from the same JSON schema the extension validates pipeline files against, so it is always exactly what the extension accepts. For the narrative version, read the [Pipelines guide](" + BASE + "/guides/pipelines/).",
    "",
    "Add the `$schema` key to get completion and validation while you type:",
    "",
    "```json",
    "{",
    '  "$schema": "https://raw.githubusercontent.com/bamr87/csv-vscoode/main/schemas/csvpipe.schema.json",',
    '  "name": "Clean sales export",',
    '  "steps": [{ "kind": "trim" }]',
    "}",
    "```",
    "",
    "Files named `*.csvpipe.json` are validated automatically; the `$schema` key only matters outside VS Code.",
    "",
    "## Top-level fields",
    "",
    "| Field | Type | Required | Description |",
    "| --- | --- | --- | --- |",
  ];

  const required = new Set(schema.required ?? []);
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (name === "$schema") {
      continue;
    }
    out.push(
      `| \`${name}\` | ${typeName(prop)} | ${required.has(name) ? "yes" : "no"} | ${describe(prop)} |`,
    );
  }

  out.push("", "## Step kinds", "");
  out.push(
    "Every step is an object with a `kind`. Steps run in order, each one receiving the table the previous step produced. All steps also accept the shared fields below.",
    "",
  );

  const base = schema.definitions.stepBase;
  out.push("### Shared step fields", "", "| Field | Type | Description |", "| --- | --- | --- |");
  for (const [name, prop] of Object.entries(base.properties ?? {})) {
    out.push(`| \`${name}\` | ${typeName(prop)} | ${describe(prop)} |`);
  }
  out.push("");

  for (const variant of schema.definitions.step.oneOf) {
    const props = variant.properties ?? {};
    const kind = props.kind?.const ?? "?";
    const req = new Set(variant.required ?? []);
    out.push(`### \`${kind}\` — ${variant.title ?? kind}`, "");
    if (variant.description) {
      out.push(variant.description, "");
    }
    const fields = Object.entries(props).filter(([name]) => name !== "kind");
    if (fields.length === 0) {
      out.push("Takes no options beyond the shared fields.", "");
      continue;
    }
    out.push("| Field | Type | Required | Description |", "| --- | --- | --- | --- |");
    for (const [name, prop] of fields) {
      out.push(
        `| \`${name}\` | ${typeName(prop)} | ${req.has(name) ? "yes" : "no"} | ${describe(prop)} |`,
      );
    }
    out.push("");
  }

  return out.join("\n");
}

function typeName(prop) {
  if (prop.$ref) {
    return `\`${prop.$ref.split("/").pop()}\``;
  }
  if (prop.enum) {
    return prop.enum.map((v) => `\`${JSON.stringify(v)}\``).join(" \\| ");
  }
  if (prop.const !== undefined) {
    return `\`${JSON.stringify(prop.const)}\``;
  }
  if (prop.type === "array") {
    const items = prop.items ? typeName(prop.items) : "any";
    return `array of ${items}`;
  }
  if (Array.isArray(prop.type)) {
    return prop.type.map((t) => `\`${t}\``).join(" \\| ");
  }
  return prop.type ? `\`${prop.type}\`` : "any";
}

function describe(prop) {
  const parts = [];
  if (prop.description) {
    parts.push(prop.description.replace(/\|/g, "\\|"));
  }
  if (prop.default !== undefined) {
    parts.push(`Default: \`${JSON.stringify(prop.default)}\`.`);
  }
  return parts.join(" ") || "—";
}

async function main() {
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const schema = JSON.parse(
    await readFile(path.join(ROOT, "schemas", "csvpipe.schema.json"), "utf8"),
  );

  // Generated directories are removed first so a renamed source file does not
  // leave an orphaned page behind. contribute/ is not cleared: it also holds a
  // page authored in this repository.
  for (const directory of ["guides", "reference"]) {
    await rm(path.join(CONTENT, directory), { recursive: true, force: true });
  }

  let written = 0;
  for (const page of PAGES) {
    const source = path.join(ROOT, page.source);
    if (!existsSync(source)) {
      throw new Error(`sync-docs: ${page.source} does not exist`);
    }
    const markdown = await readFile(source, "utf8");
    const destination = path.join(CONTENT, page.out);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, frontmatter(page) + transform(markdown, page));
    written += 1;
  }

  await mkdir(path.join(CONTENT, "reference"), { recursive: true });
  await writeFile(path.join(CONTENT, "reference", "commands.md"), commandsPage(pkg));
  await writeFile(
    path.join(CONTENT, "reference", "pipeline-schema.md"),
    pipelineSchemaPage(schema),
  );
  written += 2;

  // Screenshots, the demo GIF and the icon, served from the site itself.
  await rm(path.join(PUBLIC, "media"), { recursive: true, force: true });
  await mkdir(path.join(PUBLIC, "media"), { recursive: true });
  await cp(path.join(ROOT, "media", "screenshots"), path.join(PUBLIC, "media", "screenshots"), {
    recursive: true,
  });
  for (const file of ["demo.gif", "icon.png", "icon.svg"]) {
    await cp(path.join(ROOT, "media", file), path.join(PUBLIC, "media", file));
  }

  // The landing page's hero image. It goes to src/assets rather than public/
  // because Starlight's `hero.image.file` imports it, which is what gets it
  // resized, hashed and preloaded.
  await cp(
    path.join(ROOT, "media", "screenshots", "grid.png"),
    path.join(SITE, "src", "assets", "hero-grid.png"),
  );

  // Sample data, fetched by the live demo and downloadable from the site.
  await rm(path.join(PUBLIC, "samples"), { recursive: true, force: true });
  await mkdir(path.join(PUBLIC, "samples"), { recursive: true });
  for (const file of [
    "sales.csv",
    "products.csv",
    "cities.tsv",
    "clean-products.csvpipe.json",
    "export-summary.csvpipe.json",
  ]) {
    await cp(path.join(ROOT, "samples", file), path.join(PUBLIC, "samples", file));
  }

  // The SQLite WebAssembly binaries the demo's SQL panel loads at runtime.
  // sql.js resolves them by filename against the site root, so they have to sit
  // in public/ rather than be bundled. The browser condition of the package
  // resolves to sql-wasm-browser.js, which asks for sql-wasm-browser.wasm;
  // sql-wasm.wasm is copied too so a change of resolution cannot break the
  // demo silently.
  for (const wasm of ["sql-wasm-browser.wasm", "sql-wasm.wasm"]) {
    await cp(
      path.join(SITE, "node_modules", "sql.js", "dist", wasm),
      path.join(PUBLIC, wasm),
    );
  }

  console.log(
    `sync-docs: ${written} pages, media, samples and the SQLite wasm written (base ${BASE || "/"})`,
  );
}

await main();
