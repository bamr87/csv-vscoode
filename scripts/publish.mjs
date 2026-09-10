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
 *
 * Tokens are passed to vsce and ovsx through the environment, never on the
 * command line. An argv token is visible to `ps`, and Node echoes the whole
 * command line when a child process fails, which would put the secret in the
 * terminal and in any CI log.
 */
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const openVsxOnly = args.includes("--openvsx-only");
const alsoOpenVsx = args.includes("--openvsx") || openVsxOnly;

loadEnv();

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const { name, version, publisher } = pkg;
const vsix = `${name}-${version}.vsix`;

function run(command, commandArgs, label) {
  if (dryRun) {
    console.log(`[dry run] ${command} ${commandArgs.join(" ")}`);
    return true;
  }
  try {
    execFileSync(command, commandArgs, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env
    });
    return true;
  } catch (error) {
    // Report the failure without echoing the command, which upstream error
    // messages include verbatim.
    const status = typeof error?.status === "number" ? error.status : "unknown";
    console.error("");
    console.error(`${label} failed (exit code ${status}). Output from the tool is above.`);
    return false;
  }
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
  if (!run("npm", ["run", "package:vsix"], "Packaging")) {
    process.exit(1);
  }
} else {
  console.log(`Package   : ${vsix}`);
}

const strays = readdirSync(".").filter((f) => f.endsWith(".vsix") && f !== vsix);
if (strays.length > 0) {
  console.warn("");
  console.warn(`Other .vsix files are present and will not be published: ${strays.join(", ")}`);
}

const failures = [];

if (!openVsxOnly) {
  console.log("");
  console.log("Publishing to the Visual Studio Marketplace...");
  // vsce reads VSCE_PAT from the environment.
  if (!run("npx", ["@vscode/vsce", "publish", "--no-dependencies", "--packagePath", vsix], "Marketplace publish")) {
    failures.push("Visual Studio Marketplace");
  }
}

if (alsoOpenVsx) {
  console.log("");
  console.log("Publishing to Open VSX...");
  // ovsx reads OVSX_PAT from the environment.
  if (!run("npx", ["ovsx", "publish", vsix], "Open VSX publish")) {
    failures.push("Open VSX");
  }
}

console.log("");
if (dryRun) {
  console.log("Dry run complete; nothing was published.");
} else if (failures.length > 0) {
  console.error(`Failed to publish to: ${failures.join(", ")}`);
  process.exit(1);
} else {
  console.log("Published.");
  console.log(`https://marketplace.visualstudio.com/items?itemName=${publisher}.${name}`);
}
