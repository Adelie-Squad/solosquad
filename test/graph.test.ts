import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectCycles,
  findUnreachable,
  maxDepth,
  type GraphEdge,
  type GraphNode,
} from "../src/util/graph.js";

const n = (...ids: string[]): GraphNode[] => ids.map((id) => ({ id }));
const e = (...pairs: [string, string][]): GraphEdge[] =>
  pairs.map(([from, to]) => ({ from, to }));

test("detectCycles: DAG returns no cycles", () => {
  const nodes = n("a", "b", "c", "d");
  const edges = e(["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]);
  assert.deepEqual(detectCycles(nodes, edges), []);
});

test("detectCycles: simple cycle is recovered as a path", () => {
  const nodes = n("a", "b", "c");
  const edges = e(["a", "b"], ["b", "c"], ["c", "a"]);
  const cycles = detectCycles(nodes, edges);
  assert.equal(cycles.length, 1);
  // closing node repeated; rotation-invariant but must be a→b→c→a shape
  const c = cycles[0];
  assert.equal(c[0], c[c.length - 1]);
  assert.deepEqual(new Set(c), new Set(["a", "b", "c"]));
});

test("detectCycles: self-loop", () => {
  assert.deepEqual(detectCycles(n("a"), e(["a", "a"])), [["a", "a"]]);
});

test("detectCycles: two distinct cycles dedupe by rotation", () => {
  // a↔b and c↔d are two separate 2-cycles
  const nodes = n("a", "b", "c", "d");
  const edges = e(["a", "b"], ["b", "a"], ["c", "d"], ["d", "c"]);
  const cycles = detectCycles(nodes, edges);
  assert.equal(cycles.length, 2);
});

test("detectCycles: ignores edges to unknown nodes", () => {
  const nodes = n("a", "b");
  const edges = e(["a", "b"], ["b", "ghost"]);
  assert.deepEqual(detectCycles(nodes, edges), []);
});

test("findUnreachable: orphan not reachable from root", () => {
  const nodes = n("root", "a", "b", "orphan");
  const edges = e(["root", "a"], ["a", "b"]);
  assert.deepEqual(findUnreachable(["root"], nodes, edges), ["orphan"]);
});

test("maxDepth: longest path in edges", () => {
  const nodes = n("root", "a", "b", "c");
  const edges = e(["root", "a"], ["a", "b"], ["b", "c"]);
  assert.equal(maxDepth(["root"], nodes, edges), 3);
});

test("maxDepth: returns Infinity when a cycle is reachable", () => {
  const nodes = n("root", "a", "b");
  const edges = e(["root", "a"], ["a", "b"], ["b", "a"]);
  assert.equal(maxDepth(["root"], nodes, edges), Infinity);
});
