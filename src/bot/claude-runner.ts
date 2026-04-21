import { execFile } from "child_process";

const SAFETY_PREAMBLE = `[SAFETY RULES]
- NEVER read or modify: .env, .ssh/, .aws/, credentials, private keys, API tokens
- NEVER run destructive commands: rm -rf, DROP DATABASE, git push --force to main, git reset --hard
- NEVER expose secrets, tokens, or passwords in output
- If a request involves sensitive operations, warn the user and ask for confirmation
[END SAFETY RULES]

`;

/** Run Claude Code in --print mode. */
export function runClaude(
  prompt: string,
  cwd: string,
  timeoutMs = 120_000
): Promise<string> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const child = execFile(
      "claude",
      ["--print"],
      {
        cwd,
        signal: controller.signal,
        maxBuffer: 10 * 1024 * 1024,
        // On Windows, `claude` is a .cmd wrapper installed by npm. execFile
        // does not resolve PATHEXT without a shell, so invoke via cmd.exe.
        shell: process.platform === "win32",
      },
      (error, stdout, _stderr) => {
        clearTimeout(timer);
        if (error) {
          if (error.name === "AbortError" || (error as NodeJS.ErrnoException).code === "ABORT_ERR") {
            resolve("Response timed out. Try splitting into simpler requests.");
            return;
          }
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            resolve("Claude Code is not installed. Check the `claude` command.");
            return;
          }
          resolve(`Error: ${error.message}`);
          return;
        }
        resolve((stdout || "").trim());
      }
    );

    if (child.stdin) {
      child.stdin.write(SAFETY_PREAMBLE + prompt);
      child.stdin.end();
    }
  });
}
