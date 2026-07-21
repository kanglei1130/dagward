#!/usr/bin/env node
// File-graph query tool — reads dagward's graph.files.json and answers the
// structural questions an agent needs BEFORE editing a file, so graph.files.json
// is genuinely in the loop (query the graph instead of reading the repo).
//
//   node gq.mjs <graph.files.json> deps     <file>   direct imports of <file>
//   node gq.mjs <graph.files.json> cone     <file>   transitive imports (what you must understand to change it)
//   node gq.mjs <graph.files.json> importers<file>   direct importers of <file>
//   node gq.mjs <graph.files.json> affects  <file>   transitive importers (blast radius if you change it)
//   node gq.mjs <graph.files.json> cycles            current file-level cycles
//   node gq.mjs <graph.files.json> hubs              most depended-on files
import fs from "node:fs";

const [, , graphPath, verb, file] = process.argv;
if (!graphPath || !verb) {
  console.error("usage: gq.mjs <graph.files.json> <deps|cone|conedoc|importers|affects|annotate|cycles|hubs> [file]");
  process.exit(2);
}
const g = JSON.parse(fs.readFileSync(graphPath, "utf8"));
const out = new Map(), inn = new Map(), ann = new Map();
for (const n of g.nodes) { out.set(n.id, []); inn.set(n.id, []); if (n.annotation) ann.set(n.id, n.annotation); }
for (const e of g.edges) { out.get(e.from)?.push(e.to); inn.get(e.to)?.push(e.from); }

function closure(start, adj) {
  const seen = new Set(), stack = [...(adj.get(start) ?? [])];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || id === start) continue;
    seen.add(id);
    for (const nx of adj.get(id) ?? []) stack.push(nx);
  }
  return [...seen].sort();
}
function need(f) {
  if (!f) { console.error("this verb needs a <file>"); process.exit(2); }
  if (!out.has(f)) { console.error(`unknown file "${f}". Known ids look like: ${g.nodes.slice(0,3).map(n=>n.id).join(", ")} …`); process.exit(1); }
}

if (verb === "deps")       { need(file); console.log(JSON.stringify([...new Set(out.get(file))].sort(), null, 2)); }
else if (verb === "importers") { need(file); console.log(JSON.stringify([...new Set(inn.get(file))].sort(), null, 2)); }
else if (verb === "cone")  { need(file); const c = closure(file, out); console.log(JSON.stringify({ file, coneSize: c.length, cone: c }, null, 2)); }
else if (verb === "affects"){ need(file); const a = closure(file, inn); console.log(JSON.stringify({ file, affects: a }, null, 2)); }
else if (verb === "annotate"){ need(file); console.log(JSON.stringify(ann.get(file) ?? { note: "no annotation authored for this file" }, null, 2)); }
else if (verb === "conedoc") {
  // depth-1 contract pack: the cone as ids + each file's annotation (what it
  // DOES), so you comprehend dependencies without reading their source.
  need(file);
  const rows = closure(file, out).map((id) => {
    const a = ann.get(id) || {};
    return { id, summary: a.summary, should: a.should, shouldNot: a.shouldNot, side: a.side, pure: a.pure };
  });
  console.log(JSON.stringify({ file, coneSize: rows.length, cone: rows }, null, 2));
}
else if (verb === "cycles"){ console.log(JSON.stringify(g.cycles ?? [], null, 2)); }
else if (verb === "hubs")  {
  const rows = g.nodes.map(n => ({ id: n.id, importedBy: (inn.get(n.id)||[]).length, imports: (out.get(n.id)||[]).length }))
    .sort((a,b) => b.importedBy - a.importedBy).slice(0, 10);
  console.log(JSON.stringify(rows, null, 2));
}
else { console.error(`unknown verb "${verb}"`); process.exit(2); }
