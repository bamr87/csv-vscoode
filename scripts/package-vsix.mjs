import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

if (!existsSync("package.json")) {
  console.error("package.json not found. Run from extension root.");
  process.exit(1);
}

if (!existsSync("README.md")) {
  console.error("README.md is required for Marketplace listing.");
  process.exit(1);
}

if (!existsSync(".vscodeignore")) {
  console.error(".vscodeignore is recommended to keep package small.");
  process.exit(1);
}

try {
  console.log("Compiling extension...");
  execSync("npm run compile", { stdio: "inherit" });

  console.log("Running vsce package...");
  execSync("npx @vscode/vsce package", { stdio: "inherit" });

  console.log("VSIX package generated successfully.");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Packaging failed.");
  console.error(message);
  process.exit(1);
}
