import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

const args = parseArgs(process.argv.slice(2));
const packagePath = "package.json";

if (!existsSync(packagePath)) {
  console.error("package.json not found in current directory.");
  process.exit(1);
}

const raw = readFileSync(packagePath, "utf8");
const pkg = JSON.parse(raw);

const publisher = args.publisher ?? pkg.publisher;
const repo = args.repo ?? inferRepoFromCurrent(pkg.repository?.url ?? "");
const displayName = args.displayName ?? pkg.displayName ?? pkg.name;
const description = args.description ?? pkg.description;

if (!publisher || publisher === "local-dev") {
  console.error("Set a real publisher id with --publisher <publisher-id>.");
  process.exit(1);
}

if (!repo) {
  console.error("Set repository URL with --repo <https://github.com/user/repo.git>.");
  process.exit(1);
}

pkg.publisher = publisher;
pkg.displayName = displayName;
pkg.description = description;
pkg.license = pkg.license ?? "MIT";
pkg.repository = { type: "git", url: repo };
pkg.homepage = toHomepageUrl(repo);
pkg.bugs = { url: `${stripGitSuffix(toHomepageUrl(repo))}/issues` };
pkg.keywords = dedupe([
  ...(Array.isArray(pkg.keywords) ? pkg.keywords : []),
  "csv",
  "grid",
  "vscode-extension"
]);

writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

ensureFile(
  "CHANGELOG.md",
  "# Changelog\n\n## 0.0.1\n\n- Initial release.\n"
);
ensureFile(
  "LICENSE",
  "MIT License\n\nCopyright (c) YEAR NAME\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
);

console.log("Publishing metadata initialized.");
console.log(`- publisher: ${pkg.publisher}`);
console.log(`- repository: ${pkg.repository.url}`);
console.log("- ensured files: CHANGELOG.md, LICENSE");

function parseArgs(tokens) {
  const out = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const key = tokens[i];
    const value = tokens[i + 1];
    if (!key.startsWith("--")) {
      continue;
    }
    out[key.slice(2)] = value;
    i += 1;
  }
  return out;
}

function stripGitSuffix(url) {
  return url.endsWith(".git") ? url.slice(0, -4) : url;
}

function toHomepageUrl(repoUrl) {
  return stripGitSuffix(repoUrl);
}

function inferRepoFromCurrent(existing) {
  if (existing) {
    return existing;
  }
  const cwdName = basename(process.cwd());
  return `https://github.com/your-org-or-user/${cwdName}.git`;
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function ensureFile(path, content) {
  if (!existsSync(path)) {
    writeFileSync(path, content, "utf8");
  }
}
