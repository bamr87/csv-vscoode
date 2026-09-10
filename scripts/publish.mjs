import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadEnv, mask, requireToken } from "./load-env.mjs";

/**
 * Publish the extension using tokens from .env (or the real environment).
 *
 * Usage:
 *   node scripts/publish.mjs                 Marketplace, packaging first if needed
 *   node scripts/publish.mjs --openvsx       Marketplace and Open VSX
 *   node scripts/publish.mjs --openvsx-only  Open VSX only
 *   node scripts/publish.mjs --dry-run       Check tokens and inputs, publish nothing
 */
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const openVsxOnly = args.includes("--openvsx-only");
const alsoOpenVsx = args.includes("--openvsx") || openVsxOnly;

loadEnv();

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const { name, version, publisher } = pkg;
const vsix = `${name}-${version}.vsix`;

function run(command, commandArgs) {
  if (dryRun) {
    // Never echo the token itself, even in a dry run.
    const shown = commandArgs.map((a, i) => (commandArgs[i - 1] === "--pat" || commandArgs[i - 1] === "-p" ? "<token>" : a));
    console.log(`[dry run] ${command} ${shown.join(" ")}`);
    return;
  }
  execFileSync(command, commandArgs, { stdio: "inherit", shell: process.platform === "win32" });
}

console.log(`Extension : ${publisher}.${name}`);
console.log(`Version   : ${version}`);

// The publisher and name together are the Marketplace identifier. Publishing
// under a different publisher creates a separate listing instead of updating
// the existing one, stranding everyone already installed.
if (process.env.VSCE_PUBLISHER && process.env.VSCE_PUBLISHER !== publisher) {
  console.error("");
  console.error(`VSCE_PUBLISHER (${process.env.VSCE_PUBLISHER}) does not match package.json publisher (${publisher}).`);
  console.error("That would create a separate Marketplace listing rather than updating the existing one.");
  console.error("Change package.json deliberately if that is really the intent.");
  process.exit(1);
}

if (!openVsxOnly) {
  console.log(`VSCE_PAT  : ${mask(requireToken("VSCE_PAT"))}`);
}
if (alsoOpenVsx) {
  console.log(`OVSX_PAT  : ${mask(requireToken("OVSX_PAT"))}`);
}

if (!existsSync(vsix)) {
  console.log("");
  console.log(`${vsix} not found; building it.`);
  run("npm", ["run", "package:vsix"]);
} else {
  console.log(`Package   : ${vsix}`);
}

const strays = readdirSync(".").filter((f) => f.endsWith(".vsix") && f !== vsix);
if (strays.length > 0) {
  console.warn("");
  console.warn(`Other .vsix files are present and will not be published: ${strays.join(", ")}`);
}

if (!openVsxOnly) {
  console.log("");
  console.log("Publishing to the Visual Studio Marketplace...");
  run("npx", ["@vscode/vsce", "publish", "--no-dependencies", "--packagePath", vsix, "--pat", process.env.VSCE_PAT]);
}

if (alsoOpenVsx) {
  console.log("");
  console.log("Publishing to Open VSX...");
  run("npx", ["ovsx", "publish", vsix, "-p", process.env.OVSX_PAT]);
}

console.log("");
if (dryRun) {
  console.log("Dry run complete; nothing was published.");
} else {
  console.log("Published.");
  console.log(`https://marketplace.visualstudio.com/items?itemName=${publisher}.${name}`);
}
