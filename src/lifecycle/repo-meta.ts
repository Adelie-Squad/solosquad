import fs from "fs";
import path from "path";
import { listOrganizations } from "../util/config.js";

/**
 * v0.7 — Class A* extraction.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §10 #8a + §4 (class A*).
 *
 * For each repo registered under `<workspace>/<org>/repositories/<repo>/`,
 * read `<repo>/.solosquad/repo.yaml` (and only that — the rest of the repo
 * is class A, never enumerated). The archive writer will store these at
 * `orgs/<org-slug>/repos/<repo-slug>/repo.yaml`. After extraction, cleanup
 * may surgically remove the repo's `.solosquad/` container.
 *
 * Whitelist length = 1 — this module reads exactly one file per repo and
 * touches no other path inside `<repo>/`.
 */

export interface RepoMetaExtraction {
  orgSlug: string;
  repoSlug: string;
  /** Absolute path on disk. */
  srcPath: string;
  /** Path inside archive zip (forward slashes). */
  archivePath: string;
  /** Raw file contents (UTF-8). */
  contents: string;
  /** Size of the source file in bytes. */
  size: number;
}

export interface ExtractReport {
  extractions: RepoMetaExtraction[];
  /** Repos where `.solosquad/` exists but `repo.yaml` is missing — caller may warn but should NOT auto-delete that `.solosquad/`. */
  reposMissingRepoYaml: { orgSlug: string; repoSlug: string; solosquadDir: string }[];
}

export function extractRepoMeta(workspace: string): ExtractReport {
  const extractions: RepoMetaExtraction[] = [];
  const reposMissingRepoYaml: ExtractReport["reposMissingRepoYaml"] = [];

  for (const org of listOrganizations(workspace)) {
    const reposDir = path.join(org.path, "repositories");
    if (!fs.existsSync(reposDir)) continue;
    for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const repoSlug = entry.name;
      const repoRoot = path.join(reposDir, repoSlug);
      const solosquadDir = path.join(repoRoot, ".solosquad");
      if (!fs.existsSync(solosquadDir)) continue;
      const repoYamlPath = path.join(solosquadDir, "repo.yaml");
      if (!fs.existsSync(repoYamlPath)) {
        reposMissingRepoYaml.push({ orgSlug: org.slug, repoSlug, solosquadDir });
        continue;
      }
      const contents = fs.readFileSync(repoYamlPath, "utf-8");
      const stat = fs.statSync(repoYamlPath);
      extractions.push({
        orgSlug: org.slug,
        repoSlug,
        srcPath: repoYamlPath,
        archivePath: `orgs/${org.slug}/repos/${repoSlug}/repo.yaml`,
        contents,
        size: stat.size,
      });
    }
  }

  return { extractions, reposMissingRepoYaml };
}

/**
 * Path of the surgical-removal target for a successfully extracted repo —
 * `<workspace>/<org>/repositories/<repo>/.solosquad/`. Caller must verify
 * extraction landed in the archive before invoking removal.
 */
export function repoSolosquadDir(workspace: string, orgSlug: string, repoSlug: string): string {
  return path.join(workspace, orgSlug, "repositories", repoSlug, ".solosquad");
}
