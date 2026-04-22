import { execSync } from "child_process";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { npmGlobalInstallCmd } from "../util/platform.js";
import { detectWorkspaceVersion } from "../migrations/detect.js";
import { getWorkspaceRoot } from "../util/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getLocalVersion(): string {
  // Walk up from dist/src/cli/ or src/cli/ to find package.json
  let pkgPath = path.resolve(__dirname, "..", "..", "package.json");
  if (!fs.existsSync(pkgPath)) {
    pkgPath = path.resolve(__dirname, "..", "..", "..", "package.json");
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

function getRemoteVersion(): string | null {
  try {
    const result = execSync("npm view solosquad version", {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

function parseVersion(v: string): number[] {
  return v.split(".").map((p) => parseInt(p) || 0);
}

function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

export async function updateCommand(channel: string): Promise<void> {
  const current = getLocalVersion();
  console.log(chalk.dim(`Current version: v${current}`));
  console.log(chalk.dim(`Channel: ${channel}\n`));

  console.log("Checking for updates...");
  const latest = getRemoteVersion();

  if (!latest) {
    console.log(chalk.yellow("Could not reach npm registry. Check your network."));
    console.log(chalk.dim(`You can manually update: ${npmGlobalInstallCmd("solosquad@latest")}`));
    return;
  }

  if (isNewer(latest, current)) {
    console.log(chalk.green.bold(`\nNew version available: v${latest}`));

    // Warn if installed CLI is already ahead of the workspace layout.
    const workspaceVersion = detectWorkspaceVersion(getWorkspaceRoot());
    if (workspaceVersion && workspaceVersion !== latest && !isNewer(workspaceVersion, latest)) {
      // Detect a known structural jump (1.1.x → 1.2.x)
      if (workspaceVersion.startsWith("1.1") && latest.startsWith("1.2")) {
        console.log(
          chalk.yellow(
            "\n  ⚠ This update includes breaking workspace-layout changes."
          )
        );
        console.log(
          chalk.yellow(
            "    After updating the CLI, run:"
          )
        );
        console.log(chalk.cyan("      solosquad migrate --dry-run        (preview)"));
        console.log(chalk.cyan("      solosquad migrate --apply          (perform migration)"));
      }
    }

    console.log(`\nRun to update:`);
    console.log(chalk.cyan(`  ${npmGlobalInstallCmd("solosquad@latest")}\n`));

    // Auto-update
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question("Update now? (y/N) ", resolve);
    });
    rl.close();

    if (answer.toLowerCase() === "y") {
      const updateCmd = npmGlobalInstallCmd("solosquad@latest");
      console.log(`\nUpdating... ${chalk.dim(updateCmd)}`);
      try {
        execSync(updateCmd, { stdio: "inherit" });
        console.log(chalk.green("\n✓ Updated successfully!"));
        console.log(chalk.dim("Run `solosquad doctor` to verify."));
      } catch {
        console.log(chalk.red(`\nUpdate failed. Try manually: ${updateCmd}`));
      }
    }
  } else {
    console.log(chalk.green(`✓ You're on the latest version (v${current})`));
  }
}

/** Print update banner on startup (non-blocking). */
export function printUpdateBanner(): void {
  try {
    const current = getLocalVersion();
    const latest = getRemoteVersion();
    if (latest && isNewer(latest, current)) {
      console.log(
        chalk.yellow(`\n  New version available: v${latest} (current: v${current})`) +
        chalk.dim(`\n  Run: solosquad update\n`)
      );
    }
  } catch {
    // silent
  }
}
