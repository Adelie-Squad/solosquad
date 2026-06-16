import fs from "fs";
import path from "path";
import { normalizeLine } from "../util/platform.js";
import {
  createDevConfirm,
  devConfirmAuditPath,
  type DevConfirmAuditEntry,
  type DevConfirmDecision,
} from "./dev-confirm.js";
import {
  pendingConfirmsDir,
  decisionPath,
  type PendingConfirmFile,
  type PendingDecision,
} from "./dev-confirm-paths.js";

/**
 * v1.3.0 Part A — bot-side half of the dev-confirm gate. Watches one org's
 * `pending-confirms/` directory; when the PreToolUse hook drops a `<id>.json`
 * request, the bridge:
 *
 *   1. posts an approval card to command-<handle> (via the injected poster,
 *      implemented by the Discord adapter — Part B buttons),
 *   2. awaits the user's verdict (button click) or the gate timeout,
 *   3. writes `<id>.decision` ("y"/"n") for the hook to read, and
 *   4. appends an enriched audit record (commit hashes + workflow id) to
 *      `<org>/memory/dev-confirmations.jsonl`.
 *
 * The controller lifecycle + timeout + audit write are reused from
 * `dev-confirm.ts:createDevConfirm`; the bridge only adds the file IPC and the
 * commit-hash mapping (via the `writeAudit` seam). Single-bot-process invariant
 * (v0.7) means an in-memory in-flight set is enough — no file locks.
 *
 * Restart recovery (PRD risk #5): `start()` scans for leftover `<id>.json`
 * without a sibling `<id>.decision` and re-posts them, so a bot restart mid
 * confirm doesn't strand a pending push forever.
 */

/** Posts the approval card and resolves with the user's verdict. */
export type ApprovalPoster = (
  req: PendingConfirmFile,
) => Promise<PendingDecision>;

export interface DevConfirmBridgeOpts {
  workspace: string;
  orgSlug: string;
  /** Posts the approval card + awaits the verdict. */
  postApproval: ApprovalPoster;
  /** Override approval timeout (ms). Defaults to dev-confirm's 30 min. */
  timeoutMs?: number;
  /** Test seam. */
  now?: () => number;
  /** Stale-file sweep horizon (ms). Files older than this are GC'd on start. */
  staleMs?: number;
}

const DEFAULT_STALE_MS = 2 * 60 * 60 * 1000; // 2h

export class DevConfirmBridge {
  private readonly dir: string;
  private watcher: fs.FSWatcher | null = null;
  /** Confirm ids currently being handled — dedupes watch event storms. */
  private readonly inFlight = new Set<string>();

  constructor(private readonly opts: DevConfirmBridgeOpts) {
    this.dir = pendingConfirmsDir(opts.workspace, opts.orgSlug);
  }

  /** Begin watching. Idempotent. Best-effort — never throws. */
  start(): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch {
      // can't even create the dir — the gate will fail open at the hook.
      return;
    }
    this.sweepStale();
    void this.scanOnce(); // restart recovery

    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.dir, (_event, filename) => {
        if (!filename) {
          void this.scanOnce();
          return;
        }
        const name = filename.toString();
        if (name.endsWith(".json")) {
          void this.handleId(name.slice(0, -".json".length));
        }
      });
    } catch (e) {
      console.log(
        `[dev-confirm-bridge] fs.watch failed for ${this.dir}: ${(e as Error).message}`,
      );
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  /** Scan the directory once for unresolved requests (recovery / fallback). */
  async scanOnce(): Promise<void> {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    const ids = entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length));
    for (const id of ids) {
      await this.handleId(id);
    }
  }

  private async handleId(id: string): Promise<void> {
    if (this.inFlight.has(id)) return;
    const decisionFile = decisionPath(this.dir, id);
    if (fs.existsSync(decisionFile)) return; // already resolved

    const req = this.readRequest(id);
    if (!req) return;

    this.inFlight.add(id);
    try {
      await this.process(req);
    } catch (e) {
      console.log(
        `[dev-confirm-bridge] handling ${id} failed: ${(e as Error).message}`,
      );
    } finally {
      this.inFlight.delete(id);
    }
  }

  private readRequest(id: string): PendingConfirmFile | null {
    const file = path.join(this.dir, `${id}.json`);
    try {
      const raw = normalizeLine(fs.readFileSync(file, "utf-8"));
      return JSON.parse(raw) as PendingConfirmFile;
    } catch {
      return null; // partial write / unreadable — a later watch event retries.
    }
  }

  private async process(req: PendingConfirmFile): Promise<void> {
    const controller = createDevConfirm(
      {
        id: req.id,
        user: req.user,
        skill: req.repoSlug ?? "git",
        cmd: req.cmd,
        ts: req.ts,
        workspace: this.opts.workspace,
        orgSlug: this.opts.orgSlug,
        timeoutMs: this.opts.timeoutMs,
        now: this.opts.now,
      },
      {
        // Enrich the audit record with commit-hash + workflow-id mapping
        // (§A.4.3) via the existing writeAudit seam — single audit write.
        writeAudit: (entry) =>
          this.appendAudit(entry, req),
      },
    );

    // The button click resolves the controller; its 30-min timer is the
    // authoritative timeout. A poster error counts as a rejection.
    void this.opts
      .postApproval(req)
      .then((verdict) => controller.resolve(verdict))
      .catch(() => controller.resolve("n"));

    const decision = await controller.promise;
    this.writeDecision(req.id, decision);
  }

  private writeDecision(id: string, decision: DevConfirmDecision): void {
    const token: PendingDecision = decision === "y" ? "y" : "n";
    try {
      fs.writeFileSync(decisionPath(this.dir, id), token, "utf-8");
    } catch (e) {
      console.log(
        `[dev-confirm-bridge] decision write failed for ${id}: ${(e as Error).message}`,
      );
    }
  }

  private appendAudit(
    entry: DevConfirmAuditEntry,
    req: PendingConfirmFile,
  ): void {
    const enriched = {
      ...entry,
      branch: req.branch,
      repo_slug: req.repoSlug,
      workflow_id: req.workflowId,
      commits: req.commits,
    };
    const file = devConfirmAuditPath(this.opts.workspace, this.opts.orgSlug);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(enriched) + "\n", "utf-8");
  }

  /** Delete pending/decision files older than `staleMs` to bound growth. */
  private sweepStale(): void {
    const horizon = (this.opts.now?.() ?? Date.now()) - (this.opts.staleMs ?? DEFAULT_STALE_MS);
    let entries: string[];
    try {
      entries = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(this.dir, name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < horizon) fs.unlinkSync(full);
      } catch {
        // ignore — best-effort GC
      }
    }
  }
}
