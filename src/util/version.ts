import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * v0.8.5 — Dynamic version from package.json.
 *
 * Prior to v0.8.5, init.ts hardcoded `SOLOSQUAD_VERSION = "0.4.0"`, which made
 * every fresh init stamp workspace.yaml with a stale version and immediately
 * trigger the doctor's CLI↔workspace mismatch banner. Reading from package.json
 * at runtime keeps the value in lockstep with `npm publish`.
 *
 * The dev path (`src/util/version.ts`) needs `../../package.json`, while the
 * compiled path (`dist/src/util/version.js`) needs `../../../package.json`.
 * Same fallback pattern as `src/cli/archive.ts:190`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePackageJson(): string {
  let pkgPath = path.resolve(__dirname, "..", "..", "package.json");
  if (!fs.existsSync(pkgPath)) {
    pkgPath = path.resolve(__dirname, "..", "..", "..", "package.json");
  }
  return pkgPath;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(resolvePackageJson(), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const SOLOSQUAD_VERSION: string = readVersion();
