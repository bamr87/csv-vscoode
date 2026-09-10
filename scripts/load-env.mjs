import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal .env loader.
 *
 * Node 20.6 has `--env-file`, but the publish scripts shell out to `vsce`
 * and `ovsx` through npx, where that flag does not reach the child. Reading
 * the file here keeps the behaviour identical on every supported Node
 * version without adding a dependency.
 *
 * Values already present in the real environment always win, so CI secrets
 * are never shadowed by a stale local file.
 */
export function loadEnv(file = ".env") {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) {
    return {};
  }

  const loaded = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      console.warn(`${file}:${index + 1}: ignoring line that is not KEY=value`);
      continue;
    }

    const key = match[1];
    let value = match[2].trim();

    // Strip matching quotes; only unquoted values get a trailing comment removed.
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) || (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    if (value.length === 0) {
      continue;
    }
    loaded[key] = value;
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }

  return loaded;
}

/** Read a required token, failing with instructions rather than a stack trace. */
export function requireToken(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}.`);
    console.error("");
    console.error("Set it in a local .env file:");
    console.error("");
    console.error("  cp .env.example .env");
    console.error(`  # then fill in ${name}`);
    console.error("");
    console.error("See .env.example for how to create the token, and docs/RELEASING.md for the full procedure.");
    process.exit(1);
  }
  return value;
}

/** Mask a token so it can be shown in output without disclosing it. */
export function mask(value) {
  if (!value || value.length < 8) {
    return "****";
  }
  return `${value.slice(0, 3)}${"*".repeat(Math.min(value.length - 6, 24))}${value.slice(-3)}`;
}
