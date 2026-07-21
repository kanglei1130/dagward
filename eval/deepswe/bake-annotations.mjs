#!/usr/bin/env node
// Bake authored annotations (from the annotation pass) onto graph.files.json
// node.annotation fields, dagward's native home. Then `gq.mjs conedoc/annotate`
// serve them, and dagward's carryAnnotations preserves them across re-init.
//
//   node bake-annotations.mjs <authored.json> <repo_with_dagward-out>
//
// <authored.json> = { "src/foo.ts": {summary,inputs,outputs,should,shouldNot,side,pure}, ... }
import fs from "node:fs";
import path from "node:path";

const [, , authoredPath, repo] = process.argv;
if (!authoredPath || !repo) { console.error("usage: bake-annotations.mjs <authored.json> <repo>"); process.exit(2); }
const authored = JSON.parse(fs.readFileSync(authoredPath, "utf8"));
const gpath = path.join(repo, "dagward-out/graph.files.json");
const g = JSON.parse(fs.readFileSync(gpath, "utf8"));

let hit = 0, miss = 0;
for (const n of g.nodes) {
  const a = authored[n.id];
  if (a) { n.annotation = a; hit++; } else { miss++; }
}
fs.writeFileSync(gpath, JSON.stringify(g, null, 2) + "\n");
console.log(`baked ${hit} annotations onto ${path.basename(repo)}/dagward-out/graph.files.json (${miss} nodes without an authored contract)`);
