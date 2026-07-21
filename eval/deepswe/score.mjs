#!/usr/bin/env node
// Structural scorer for the DeepSWE dagward eval.
//
// DeepSWE's verifier is behavioral (pass/fail on observable behavior). It does
// NOT reward structure. This script measures the orthogonal thing dagward cares
// about: how a patch changes the file dependency graph. Run it on the graph
// dagward emits before vs after applying an agent's patch.
//
//   node score.mjs <before/graph.files.json> <after/graph.files.json>
//
// Reports deltas in: file-level cycles, import edges, and dependency-cone size
// (transitive out-closure per file — the context an agent must read to change a
// file). Lower/flat is better; positive deltas mean the patch made structure worse.

import fs from "node:fs";

function load(p) {
  const g = JSON.parse(fs.readFileSync(p, "utf8"));
  return { nodes: g.nodes ?? [], edges: g.edges ?? [], cycles: g.cycles ?? [] };
}

// Transitive out-closure (dependency cone) size for every node.
function cones(g) {
  const out = new Map(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) if (out.has(e.from)) out.get(e.from).push(e.to);
  const sizes = new Map();
  for (const start of out.keys()) {
    const seen = new Set();
    const stack = [...(out.get(start) ?? [])];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id) || id === start) continue;
      seen.add(id);
      for (const nxt of out.get(id) ?? []) stack.push(nxt);
    }
    sizes.set(start, seen.size);
  }
  return sizes;
}

function stats(sizes) {
  const v = [...sizes.values()].sort((a, b) => a - b);
  const sum = v.reduce((a, b) => a + b, 0);
  const median = v.length ? v[Math.floor(v.length / 2)] : 0;
  const max = v.length ? v[v.length - 1] : 0;
  return { mean: v.length ? +(sum / v.length).toFixed(2) : 0, median, max };
}

const [, , beforePath, afterPath] = process.argv;
if (!beforePath || !afterPath) {
  console.error("usage: node score.mjs <before graph.files.json> <after graph.files.json>");
  process.exit(2);
}

const before = load(beforePath);
const after = load(afterPath);
const cb = stats(cones(before));
const ca = stats(cones(after));

const d = (a, b) => {
  const x = b - a;
  return x > 0 ? `+${x}` : `${x}`;
};

const report = {
  files: { before: before.nodes.length, after: after.nodes.length, delta: d(before.nodes.length, after.nodes.length) },
  importEdges: { before: before.edges.length, after: after.edges.length, delta: d(before.edges.length, after.edges.length) },
  fileCycles: { before: before.cycles.length, after: after.cycles.length, delta: d(before.cycles.length, after.cycles.length) },
  coneMean: { before: cb.mean, after: ca.mean, delta: d(cb.mean, ca.mean) },
  coneMedian: { before: cb.median, after: ca.median, delta: d(cb.median, ca.median) },
  coneMax: { before: cb.max, after: ca.max, delta: d(cb.max, ca.max) },
  // The headline signal: did the patch introduce a cycle the baseline didn't have?
  introducedCycle: after.cycles.length > before.cycles.length,
};

console.log(JSON.stringify(report, null, 2));
