// Step-1 proxy validation, deterministic half: compute each file's dependency
// cone from a dagward graph, and pick a spread of files to run the A/B on.
//
// The thesis under test (README "token economics"): the context needed to
// change a file is its dependency cone. If that holds, cone size should PREDICT
// the tokens an agent spends changing the file — making cone size a cheap,
// deterministic proxy for change cost. This file emits the predictor (x);
// regress.mjs joins it to measured tokens (y) and reports whether it predicts.
//
// Reverse cone reuses dagward's shipped `affects` (dist/query.js) so the number
// here is exactly what `dagward affects <file>` returns. Forward cone is the
// same reachability the other way (imports), computed locally.
//
// Usage: node cone.mjs [dagward-out-dir] [--select N]
//   dagward-out-dir  defaults to ./dagward-out (run `dagward init` first)
//   --select N       also write candidates.json: N files spanning small->large
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { affects } from "../../dist/query.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const selectIdx = args.indexOf("--select");
const selectN = selectIdx === -1 ? 0 : Number(args[selectIdx + 1]);
const outDir = args.find((a, i) => !a.startsWith("--") && i !== selectIdx + 1) ?? "dagward-out";

const graphPath = path.resolve(outDir, "graph.files.json");
const files = JSON.parse(fs.readFileSync(graphPath, "utf8"));

// imports adjacency, built once (from -> set of direct imports).
const imports = new Map();
for (const e of files.edges) {
  let set = imports.get(e.from);
  if (!set) imports.set(e.from, (set = new Set()));
  set.add(e.to);
}

// Forward reachability over imports: everything you must read to understand X.
function forwardCone(id) {
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length > 0) {
    for (const to of imports.get(stack.pop()) ?? []) if (!seen.has(to)) (seen.add(to), stack.push(to));
  }
  seen.delete(id);
  return seen.size;
}

const rows = files.nodes
  .map((n) => ({
    file: n.id,
    forwardCone: forwardCone(n.id),
    reverseCone: affects(files, n.id).length,
  }))
  .sort((a, b) => a.forwardCone - b.forwardCone || a.reverseCone - b.reverseCone);

const csv = ["file,forwardCone,reverseCone", ...rows.map((r) => `${r.file},${r.forwardCone},${r.reverseCone}`)].join("\n") + "\n";
fs.writeFileSync(path.join(here, "cones.csv"), csv);
console.log(`wrote cones.csv — ${rows.length} files, forwardCone ${rows[0].forwardCone}..${rows.at(-1).forwardCone}`);

if (selectN > 0) {
  // Stratified pick: split the cone-sorted list into N bands, take each band's
  // middle file, so candidates span the whole distribution instead of clustering.
  const n = Math.min(selectN, rows.length);
  const picked = Array.from({ length: n }, (_, i) => rows[Math.floor(((i + 0.5) * rows.length) / n)]);
  const candidates = { note: "Run the with/without-dagward A/B on each file; record into proxy-results.json (see README).", files: picked };
  fs.writeFileSync(path.join(here, "candidates.json"), JSON.stringify(candidates, null, 2) + "\n");
  console.log(`wrote candidates.json — ${n} files spanning forwardCone ${picked[0].forwardCone}..${picked.at(-1).forwardCone}`);
}
