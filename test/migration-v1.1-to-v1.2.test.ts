import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigration } from "../src/migrations/runner.js";
import { listBackups, restoreBackup } from "../src/migrations/backup.js";

interface FixtureOptions {
  productSlug: string;
  productName: string;
  reposBase?: string;
  messenger?: string;
  includeMultiMessenger?: boolean;
}

/** Create a realistic v1.1.x workspace tree + separate REPOS_BASE_PATH tree. */
function makeV11Fixture(options: FixtureOptions = { productSlug: "demo", productName: "Demo" }): {
  workspace: string;
  reposBase: string;
} {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sq-ws-"));
  const reposBase = options.reposBase ?? fs.mkdtempSync(path.join(os.tmpdir(), "sq-repos-"));

  for (const d of ["agents", "routines", "core", "templates", "orchestrator"]) {
    fs.mkdirSync(path.join(workspace, d), { recursive: true });
    fs.writeFileSync(path.join(workspace, d, "KEEP.md"), `# ${d}\n`);
  }

  const messengerLine = options.includeMultiMessenger
    ? "MESSENGER=discord,slack"
    : `MESSENGER=${options.messenger ?? "discord"}`;

  fs.writeFileSync(
    path.join(workspace, ".env"),
    [
      messengerLine,
      "DISCORD_TOKEN=test-token-abc",
      `REPOS_BASE_PATH=${reposBase}`,
      "OWNER_NAME=Tester",
      "",
    ].join("\n")
  );

  fs.writeFileSync(
    path.join(workspace, "core", "products.json"),
    JSON.stringify([{ name: options.productName, slug: options.productSlug, github_org: "tester" }])
  );

  // Product directory (under REPOS_BASE_PATH)
  const productDir = path.join(reposBase, options.productSlug);
  fs.mkdirSync(productDir, { recursive: true });
  fs.mkdirSync(path.join(productDir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(productDir, ".git", "HEAD"), "ref: refs/heads/main\n");

  fs.mkdirSync(path.join(productDir, "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(productDir, "memory", "decisions.jsonl"),
    '{"date":"2026-04-20","decision":"ship v1"}\n'
  );
  fs.writeFileSync(
    path.join(productDir, "memory", "signals.jsonl"),
    '{"date":"2026-04-21","source":"user","content":"good feedback"}\n'
  );

  fs.mkdirSync(path.join(productDir, "projects", "wf-a", "stage-1"), { recursive: true });
  fs.writeFileSync(
    path.join(productDir, "projects", "wf-a", "_status.yaml"),
    "workflow_id: wf-a\nstages: []\n"
  );

  fs.mkdirSync(path.join(productDir, "product"), { recursive: true });
  fs.writeFileSync(path.join(productDir, "product", "brief.md"), "# Product brief\n");

  return { workspace, reposBase };
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

test("dry-run leaves the workspace untouched", async () => {
  const { workspace, reposBase } = makeV11Fixture();
  try {
    const result = await runMigration({
      workspace,
      targetVersion: "1.2.0",
      dryRun: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.sourceVersion, "1.1.x");

    // Nothing moved
    assert.ok(fs.existsSync(path.join(workspace, "agents")));
    assert.ok(fs.existsSync(path.join(workspace, "core", "products.json")));
    assert.ok(!fs.existsSync(path.join(workspace, ".solosquad")));
    assert.ok(fs.existsSync(path.join(reposBase, "demo", ".git")));
  } finally {
    cleanup(workspace, reposBase);
  }
});

test("apply moves config into .solosquad/ and product into workspace-root org", async () => {
  const { workspace, reposBase } = makeV11Fixture();
  try {
    const result = await runMigration({
      workspace,
      targetVersion: "1.2.0",
      dryRun: false,
    });
    assert.equal(result.success, true, `migration failed: ${result.error ?? ""}`);

    // .solosquad/ created with moved config
    for (const d of ["agents", "routines", "core", "templates", "orchestrator"]) {
      assert.ok(
        fs.existsSync(path.join(workspace, ".solosquad", d)),
        `.solosquad/${d} should exist`
      );
      assert.ok(!fs.existsSync(path.join(workspace, d)), `${d} should have been moved`);
    }
    assert.ok(fs.existsSync(path.join(workspace, ".solosquad", ".env")));
    assert.ok(fs.existsSync(path.join(workspace, ".solosquad", "workspace.yaml")));

    // Product → org at workspace root
    const orgDir = path.join(workspace, "demo");
    assert.ok(fs.existsSync(orgDir), "org dir should exist at workspace root");
    assert.ok(fs.existsSync(path.join(orgDir, ".org.yaml")));
    assert.ok(fs.existsSync(path.join(orgDir, ".git")));
    assert.ok(fs.existsSync(path.join(orgDir, "workflows", "wf-a", "_status.yaml")));
    assert.ok(!fs.existsSync(path.join(orgDir, "projects")), "projects/ should be renamed");

    // Memory JSONL content preserved
    const decisions = fs.readFileSync(path.join(orgDir, "memory", "decisions.jsonl"), "utf-8");
    assert.match(decisions, /ship v1/);

    // product/brief.md flattened
    assert.ok(fs.existsSync(path.join(orgDir, "brief.md")));

    // REPOS_BASE_PATH source is now empty or gone
    assert.ok(!fs.existsSync(path.join(reposBase, "demo")));

    // .env has no more REPOS_BASE_PATH
    const envContent = fs.readFileSync(
      path.join(workspace, ".solosquad", ".env"),
      "utf-8"
    );
    assert.doesNotMatch(envContent, /REPOS_BASE_PATH=/);
  } finally {
    cleanup(workspace, reposBase);
  }
});

test("multi-messenger MESSENGER is collapsed to the first value", async () => {
  const { workspace, reposBase } = makeV11Fixture({
    productSlug: "demo",
    productName: "Demo",
    includeMultiMessenger: true,
  });
  try {
    const result = await runMigration({
      workspace,
      targetVersion: "1.2.0",
      dryRun: false,
    });
    assert.equal(result.success, true);
    const env = fs.readFileSync(
      path.join(workspace, ".solosquad", ".env"),
      "utf-8"
    );
    const match = env.match(/^MESSENGER=(.*)$/m);
    assert.ok(match, "MESSENGER line must exist");
    assert.equal(match![1].trim(), "discord");
  } finally {
    cleanup(workspace, reposBase);
  }
});

test("rollback restores the pre-migration layout", async () => {
  const { workspace, reposBase } = makeV11Fixture();
  try {
    const result = await runMigration({
      workspace,
      targetVersion: "1.2.0",
      dryRun: false,
    });
    assert.equal(result.success, true);

    // Verify it's post-migration
    assert.ok(fs.existsSync(path.join(workspace, ".solosquad")));
    assert.ok(!fs.existsSync(path.join(workspace, "agents")));

    const backups = listBackups().filter(
      (b) => path.resolve(b.meta.workspace) === path.resolve(workspace)
    );
    assert.ok(backups.length >= 1, "at least one backup should exist for this workspace");

    restoreBackup(backups[0].path, workspace);

    // Pre-migration layout is back
    assert.ok(fs.existsSync(path.join(workspace, "agents")));
    assert.ok(fs.existsSync(path.join(workspace, "core", "products.json")));
    assert.ok(!fs.existsSync(path.join(workspace, ".solosquad")));
  } finally {
    cleanup(workspace, reposBase);
  }
});

test("idempotent: running apply on already-migrated workspace is a no-op", async () => {
  const { workspace, reposBase } = makeV11Fixture();
  try {
    const first = await runMigration({
      workspace,
      targetVersion: "1.2.0",
      dryRun: false,
    });
    assert.equal(first.success, true);

    const second = await runMigration({
      workspace,
      targetVersion: "1.2.0",
      dryRun: false,
    });
    assert.equal(second.success, true);
    assert.equal(second.chain.length, 0, "no migrations should be needed second time");
  } finally {
    cleanup(workspace, reposBase);
  }
});

test("chain 1.1.x → 1.2.1 creates repositories/ and bumps workspace.yaml", async () => {
  const { workspace, reposBase } = makeV11Fixture();
  try {
    const result = await runMigration({
      workspace,
      targetVersion: "1.2.1",
      dryRun: false,
    });
    assert.equal(result.success, true, `migration failed: ${result.error ?? ""}`);
    assert.deepEqual(result.chain, ["1.1.x → 1.2.0", "1.2.0 → 1.2.1"]);

    const wsYaml = fs.readFileSync(
      path.join(workspace, ".solosquad", "workspace.yaml"),
      "utf-8"
    );
    assert.match(wsYaml, /version:\s*['"]?1\.2\.1['"]?/);
    assert.match(wsYaml, /last_migrated_to:\s*['"]?1\.2\.1['"]?/);

    assert.ok(
      fs.existsSync(path.join(workspace, "demo", "repositories")),
      "repositories/ should be pre-created"
    );
  } finally {
    cleanup(workspace, reposBase);
  }
});
