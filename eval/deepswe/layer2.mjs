#!/usr/bin/env node
// Layer-2: the clean, deterministic token measurement of dagward's actual claim
// — answering a structural question via a graph query is cheaper than reading
// source to answer it. No agent, no variance.
//
//   node layer2.mjs <repo_with_dagward-out>
//
// Two questions an agent asks constantly, priced both ways (tokens ≈ chars/4):
//
//   Q1 "What is the architecture?" (whole-repo structure)
//        dagward = read ARCHITECTURE.md      vs   source = read all src/*.ts
//   Q2 "To change file X safely, what must I understand?" (its dependency cone)
//        dagward = gq cone X (the id list)   vs   source = read every file in X's cone
import fs from "node:fs";
import path from "node:path";

const repo = process.argv[2];
if (!repo) { console.error("usage: layer2.mjs <repo_with_dagward-out>"); process.exit(2); }
const tok = (s) => Math.ceil(s.length / 4);
const graph = JSON.parse(fs.readFileSync(path.join(repo, "dagward-out/graph.files.json"), "utf8"));
// real per-file annotation token size (baked onto node.annotation), fallback 126
const annTok = new Map(graph.nodes.map((n) => [n.id, n.annotation ? tok(JSON.stringify(n.annotation)) : 126]));

// adjacency + transitive cone (out-closure)
const out = new Map(graph.nodes.map((n) => [n.id, []]));
for (const e of graph.edges) out.get(e.from)?.push(e.to);
const coneOf = (start) => {
  const seen = new Set(), stack = [...(out.get(start) ?? [])];
  while (stack.length) { const id = stack.pop(); if (seen.has(id) || id === start) continue; seen.add(id); for (const nx of out.get(id) ?? []) stack.push(nx); }
  return [...seen];
};
const srcTokens = (id) => { try { return tok(fs.readFileSync(path.join(repo, id), "utf8")); } catch { return 0; } };

// Q1 — whole-repo structure
const archTokens = tok(fs.readFileSync(path.join(repo, "dagward-out/ARCHITECTURE.md"), "utf8"));
const allSrcTokens = graph.nodes.reduce((a, n) => a + srcTokens(n.id), 0);

// Q2/Q3 — per-file cone (averaged over all files)
let dagSum = 0, srcSum = 0, annSum = 0, n = 0;
for (const node of graph.nodes) {
  const cone = coneOf(node.id);
  // Q2 dagward answer = the gq cone output (a JSON id list + size): WHICH files,
  // but not WHAT they do
  const dag = tok(JSON.stringify({ file: node.id, coneSize: cone.length, cone }, null, 2));
  // Q2 source answer = read the source of every file in the cone
  const src = cone.reduce((a, id) => a + srcTokens(id), 0);
  // Q3 = read each cone file's actual authored contract (comprehend what it does
  // without reading its source)
  const ann = cone.reduce((a, id) => a + (annTok.get(id) ?? 126), 0);
  dagSum += dag; srcSum += src; annSum += ann; n++;
}

const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : "n/a");
console.log(JSON.stringify({
  repo: path.basename(repo),
  files: graph.nodes.length,
  Q1_architecture: { dagward_tokens: archTokens, source_tokens: allSrcTokens,
    dagward_is: pct(archTokens, allSrcTokens) + " of reading all source",
    savings_x: +(allSrcTokens / archTokens).toFixed(1) },
  // Q2: know WHICH files are in the cone (structure only)
  Q2_cone_ids_avg: { dagward_tokens: Math.round(dagSum / n), source_tokens: Math.round(srcSum / n),
    dagward_is: pct(dagSum, srcSum) + " of reading the cone", savings_x: +(srcSum / dagSum).toFixed(1) },
  // Q3: COMPREHEND every cone dependency (what each does) — annotations vs source.
  // This is the piece that matters for complex tasks: you must understand hubs,
  // not just know they exist.
  Q3_cone_comprehension_avg: { annotation_tokens: Math.round(annSum / n), source_tokens: Math.round(srcSum / n),
    annotations_are: pct(annSum, srcSum) + " of reading the cone source", savings_x: +(srcSum / annSum).toFixed(1) },
}, null, 2));
