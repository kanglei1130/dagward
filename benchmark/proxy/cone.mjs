// Step-1 proxy validation, deterministic half: compute each file's dependency
// cone AND its size-weighted read cost from a dagward graph, and pick a spread
// of files to run the A/B on.
//
// The thesis under test (README "token economics"): the context needed to
// change a file is its dependency cone. Cone *count* says how many files enter
// context; loc/bytes say how big each is. So the sharpest token proxy is the
// size summed over the cone:
//
//   coneBytes(X) = bytes(X) + Σ bytes(f) for f in forwardCone(X)
//   estTokens(X) ≈ coneBytes(X) / 3.7        (same chars/token ratio as RESULTS.md)
//
// = the bytes you must read to change X, with cone giving *which* files and
// loc/bytes giving *how much*. regress.mjs then checks which column predicts
// real tokens best.
//
// Reverse cone reuses dagward's shipped `affects` (dist/query.js). loc/bytes
// come from the file-node fields dagward now records.
//
// Usage: node cone.mjs [dagward-out-dir] [--select N]
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

const locOf = new Map(files.nodes.map((n) => [n.id, n.loc ?? 0]));
const bytesOf = new Map(files.nodes.map((n) => [n.id, n.bytes ?? 0]));

// imports adjacency, built once (from -> set of direct imports).
const imports = new Map();
for (const e of files.edges) {
  let set = imports.get(e.from);
  if (!set) imports.set(e.from, (set = new Set()));
  set.add(e.to);
}

// Forward cone as the set of ids reachable via imports (excludes X itself).
function forwardConeSet(id) {
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length > 0) {
    for (const to of imports.get(stack.pop()) ?? []) if (!seen.has(to)) (seen.add(to), stack.push(to));
  }
  seen.delete(id);
  return seen;
}

const sum = (ids, table) => [...ids].reduce((s, id) => s + (table.get(id) ?? 0), 0);

const rows = files.nodes
  .map((n) => {
    const cone = forwardConeSet(n.id);
    const coneBytes = (bytesOf.get(n.id) ?? 0) + sum(cone, bytesOf);
    return {
      file: n.id,
      loc: locOf.get(n.id) ?? 0,
      bytes: bytesOf.get(n.id) ?? 0,
      forwardCone: cone.size,
      reverseCone: affects(files, n.id).length,
      coneLoc: (locOf.get(n.id) ?? 0) + sum(cone, locOf),
      coneBytes,
      estTokens: Math.round(coneBytes / 3.7),
    };
  })
  .sort((a, b) => a.estTokens - b.estTokens);

const cols = ["file", "loc", "bytes", "forwardCone", "reverseCone", "coneLoc", "coneBytes", "estTokens"];
const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => r[c]).join(","))].join("\n") + "\n";
fs.writeFileSync(path.join(here, "cones.csv"), csv);

const totalEst = rows.reduce((s, r) => s + r.estTokens, 0);
console.log(`wrote cones.csv — ${rows.length} files`);
console.log(`estTokens per file (read X + its cone): ${rows[0].estTokens.toLocaleString()}..${rows.at(-1).estTokens.toLocaleString()}`);
console.log(`\nTop 5 most expensive files to change (estTokens = coneBytes/3.7):`);
for (const r of rows.slice(-5).reverse()) {
  console.log(`  ${r.estTokens.toLocaleString().padStart(9)}  ${r.file}  (${r.forwardCone} in cone, ${r.loc} loc)`);
}

if (selectN > 0) {
  // Stratified pick over estTokens, so candidates span cheap -> expensive.
  const n = Math.min(selectN, rows.length);
  const picked = Array.from({ length: n }, (_, i) => rows[Math.floor(((i + 0.5) * rows.length) / n)]);
  const candidates = { note: "Run the with/without-dagward A/B on each file; record into proxy-results.json (see README).", files: picked };
  fs.writeFileSync(path.join(here, "candidates.json"), JSON.stringify(candidates, null, 2) + "\n");
  console.log(`\nwrote candidates.json — ${n} files spanning estTokens ${picked[0].estTokens.toLocaleString()}..${picked.at(-1).estTokens.toLocaleString()}`);
}
