import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Materialize one of the 6 v0.5 §11.1 fixture repos into an OS tmpdir.
 *
 * The fixtures live under `test/analyze/fixtures/<name>/skills-source/*.md`
 * in source control (the dotted `.claude` path is reserved by the harness
 * for runtime use). The helper copies those source files into a fresh tmp
 * repo at `<tmp>/.claude/skills/` so scanners + appliers exercise the
 * real on-disk shape the spec calls for.
 *
 * Returns `{ repo: <abs>, cleanup: fn }`. The caller is expected to call
 * cleanup() — tests that forget will just leak a few KB to the OS tmp dir.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface MaterializedFixture {
  repo: string;
  cleanup: () => void;
}

export function materializeFixture(name: string): MaterializedFixture {
  const sourceDir = path.join(__dirname, "fixtures", name);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`fixture not found: ${name} (looked in ${sourceDir})`);
  }
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), `solosquad-fx-${name}-`));
  const target = path.join(tmpRepo, ".claude", "skills");
  fs.mkdirSync(target, { recursive: true });
  const skillsSrc = path.join(sourceDir, "skills-source");
  if (fs.existsSync(skillsSrc)) {
    for (const f of fs.readdirSync(skillsSrc)) {
      if (f === ".gitkeep") continue;
      const sp = path.join(skillsSrc, f);
      if (fs.statSync(sp).isFile()) {
        fs.copyFileSync(sp, path.join(target, f));
      }
    }
  }
  return {
    repo: tmpRepo,
    cleanup: () => {
      try {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}
