import { test } from "node:test";
import assert from "node:assert/strict";
import { ManifestBuilder, sha256OfBuffer, createHashTap } from "../src/lifecycle/manifest.js";

test("ManifestBuilder.toTsv emits the schema header and rows", () => {
  const m = new ManifestBuilder();
  m.add({
    path: "workspace/workspace.yaml",
    sha256: "abc123",
    size: 412,
    cls: "C",
  });
  m.add({
    path: "credentials/env.template",
    sha256: null,
    size: 50,
    cls: "D",
    notes: "values redacted",
  });
  const tsv = m.toTsv();
  const lines = tsv.split("\n");
  assert.equal(lines[0], "# schema_version=1");
  assert.equal(lines[1], "path\tsha256\tsize\tclass\tnotes");
  assert.equal(lines[2], "workspace/workspace.yaml\tabc123\t412\tC\t-");
  assert.equal(lines[3], "credentials/env.template\t-\t50\tD\tvalues redacted");
});

test("sha256OfBuffer is deterministic", () => {
  const a = sha256OfBuffer(Buffer.from("hello"));
  const b = sha256OfBuffer(Buffer.from("hello"));
  assert.equal(a, b);
  assert.equal(a, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

test("createHashTap returns same digest as sha256OfBuffer for equivalent input", () => {
  const tap = createHashTap();
  tap.update(Buffer.from("hello "));
  tap.update(Buffer.from("world"));
  const digest = tap.digest();
  assert.equal(digest, sha256OfBuffer(Buffer.from("hello world")));
  // digest is idempotent
  assert.equal(tap.digest(), digest);
});

test("manifest tab escaping replaces newlines and tabs", () => {
  const m = new ManifestBuilder();
  m.add({
    path: "weird\tname",
    sha256: "abc",
    size: 1,
    cls: "C",
    notes: "multi\nline note",
  });
  const tsv = m.toTsv();
  // The escape simply replaces tabs/newlines with single space — that's
  // enough to keep TSV columns intact, which is the contract.
  const rowLine = tsv.split("\n")[2];
  const parts = rowLine.split("\t");
  assert.equal(parts.length, 5);
});
