import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

/** Check whether a directory is a git repository (has `.git` subdir or file). */
export function isGitRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

/** Read a git repo's primary remote URL (origin, then the first remote). Returns null if none. */
export function getRemoteUrl(repoDir: string): string | null {
  if (!isGitRepo(repoDir)) return null;
  try {
    const origin = execSync("git config --get remote.origin.url", {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (origin) return origin;
  } catch {
    /* no origin */
  }
  try {
    const remotes = execSync("git remote", {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (remotes.length === 0) return null;
    const first = remotes[0];
    const url = execSync(`git config --get remote.${first}.url`, {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return url || null;
  } catch {
    return null;
  }
}

/** Derive a repo slug from a clone URL. `git@github.com:foo/bar.git` or `https://.../bar` → `bar`. */
export function slugFromUrl(url: string): string {
  const withoutGit = url.replace(/\.git$/i, "");
  const tail = withoutGit.split(/[/:]/).filter(Boolean).pop() ?? "";
  return tail.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/** Detect whether a string looks like a git URL (http(s), ssh, or git@). */
export function looksLikeGitUrl(s: string): boolean {
  return (
    /^https?:\/\//i.test(s) ||
    /^git@/i.test(s) ||
    /^ssh:\/\//i.test(s) ||
    /^git:\/\//i.test(s)
  );
}

/** Clone a git URL into `destDir`. Throws on failure. Returns the absolute path. */
export function cloneRepo(url: string, destDir: string): string {
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  const result = spawnSync("git", ["clone", url, destDir], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`git clone failed for ${url}`);
  }
  return destDir;
}

/** Best-effort primary language detection from common manifest files. */
export function detectLanguage(dir: string): string | undefined {
  const hasFile = (f: string) => fs.existsSync(path.join(dir, f));
  if (hasFile("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
      if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) return "typescript";
    } catch {
      /* ignore */
    }
    return "javascript";
  }
  if (hasFile("pyproject.toml") || hasFile("requirements.txt") || hasFile("setup.py")) return "python";
  if (hasFile("go.mod")) return "go";
  if (hasFile("Cargo.toml")) return "rust";
  if (hasFile("pom.xml") || hasFile("build.gradle") || hasFile("build.gradle.kts")) return "java";
  if (hasFile("Gemfile")) return "ruby";
  if (hasFile("composer.json")) return "php";
  if (hasFile("mix.exs")) return "elixir";
  return undefined;
}
