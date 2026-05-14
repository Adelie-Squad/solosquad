import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectDomainOverlap,
  extractDomainTerms,
} from "../scripts/skill-pr-review/domain-overlap.js";

/**
 * v0.6 S6.B §11.5 — `<org>/domain/*.md` term overlap detection.
 */

test("extractDomainTerms picks up headings and bold-definition lines", () => {
  const md = [
    "# Customer Segments",
    "",
    "Some prose.",
    "",
    "## Pricing Tier",
    "",
    "- **API Token**: a short-lived JWT.",
    "**Latency Budget**: 200ms p95.",
    "",
    "Mid-paragraph mention of Pricing Tier should not re-trigger.",
  ].join("\n");

  const terms = extractDomainTerms(md, "domain/glossary.md");
  const names = terms.map((t) => t.term).sort();
  assert.deepEqual(names, [
    "api token",
    "customer segments",
    "latency budget",
    "pricing tier",
  ]);
});

test("same term in two distinct files → overlap warning", () => {
  const overlaps = detectDomainOverlap([
    { path: "domain/market.md", content: "# Customer Segments\n" },
    { path: "domain/customers.md", content: "## Customer Segments\n" },
  ]);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].term, "customer segments");
  assert.equal(overlaps[0].occurrences.length, 2);
});

test("same term repeated within one file is not flagged", () => {
  const md = "# Foo\n\n## Foo\n\n**Foo**: x\n";
  const overlaps = detectDomainOverlap([
    { path: "domain/only.md", content: md },
  ]);
  assert.equal(overlaps.length, 0);
});
