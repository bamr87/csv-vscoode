#!/usr/bin/env node
/**
 * Fails the build when a page links to something the build did not produce.
 *
 * The guide pages are generated and their links are rewritten by
 * sync-docs.mjs, so a renamed source file turns into a dead link rather than
 * into a build error. This is the check that catches that.
 *
 * Usage: node scripts/check-links.mjs <built-site-root> [--base /csv-vscode]
 * The root is the directory the site is served from, i.e. the one containing
 * index.html for the base path.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "dist");
const base = (process.env.SITE_BASE ?? "/csv-vscode").replace(/\/+$/, "");

async function htmlFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Pagefind's own bundle is machine-generated and not worth walking.
      if (entry.name === "pagefind") {
        continue;
      }
      found.push(...(await htmlFiles(full)));
    } else if (entry.name.endsWith(".html")) {
      found.push(full);
    }
  }
  return found;
}

/** Resolves a same-site URL to the file that should serve it, or undefined. */
function targetFor(url, fromFile) {
  const clean = url.split("#")[0].split("?")[0];
  if (clean === "") {
    return undefined;
  }
  let relative;
  if (clean.startsWith("/")) {
    if (base && !clean.startsWith(`${base}/`) && clean !== base) {
      // Points outside the base path: the deployment cannot serve it.
      return { missing: clean, absolute: true };
    }
    relative = clean.slice(base.length).replace(/^\/+/, "");
  } else {
    const fromDir = path.dirname(fromFile);
    relative = path.relative(root, path.resolve(fromDir, clean));
  }

  const candidates = [
    path.join(root, relative),
    path.join(root, relative, "index.html"),
    path.join(root, `${relative}.html`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return undefined;
    }
  }
  return { missing: clean, absolute: clean.startsWith("/") };
}

async function main() {
  if (!existsSync(root) || !(await stat(root)).isDirectory()) {
    console.error(`check-links: ${root} is not a directory`);
    process.exit(1);
  }

  const files = await htmlFiles(root);
  const failures = [];
  let checked = 0;

  for (const file of files) {
    const html = await readFile(file, "utf8");
    const urls = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    for (const url of urls) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(url)) {
        continue;
      }
      checked += 1;
      const failure = targetFor(url, file);
      if (failure) {
        failures.push(`${path.relative(root, file)} → ${failure.missing}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`check-links: ${failures.length} dead link(s) in ${files.length} pages:`);
    for (const failure of [...new Set(failures)].sort()) {
      console.error(`  ${failure}`);
    }
    process.exit(1);
  }

  console.log(`check-links: ${checked} internal links across ${files.length} pages all resolve`);
}

await main();
