#!/usr/bin/env node
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Walk up from CWD to find the nearest solosquad workspace root, then load
// its .env. v1.2.2+ stores config at <root>/.solosquad/.env; v1.1.x had it at
// <root>/.env. Fall back to plain `dotenv/config` semantics (CWD/.env) when
// no workspace is detected (fresh shell, pre-init).
function loadWorkspaceEnv(): void {
  let current = path.resolve(process.cwd());
  while (true) {
    const solosquadEnv = path.join(current, ".solosquad", ".env");
    if (fs.existsSync(solosquadEnv)) {
      dotenv.config({ path: solosquadEnv });
      return;
    }
    const legacyEnv = path.join(current, ".env");
    const legacyMarkers = ["agents", "routines", "core"];
    if (
      fs.existsSync(legacyEnv) &&
      legacyMarkers.every((m) => fs.existsSync(path.join(current, m)))
    ) {
      dotenv.config({ path: legacyEnv });
      return;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // No workspace detected — fall back to default CWD/.env loading.
  dotenv.config();
}

loadWorkspaceEnv();

const { program } = await import("../src/cli/index.js");
program.parse(process.argv);
