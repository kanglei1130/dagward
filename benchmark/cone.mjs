// Dependency-cone queries over dagward's file graph. These define the
// *minimal* file set a no-dagward agent would need — the honest baseline.
import fs from "node:fs";
import path from "node:path";

export function loadGraph(dagwardOut) {
  return JSON.parse(fs.readFileSync(path.join(dagwardOut, "graph.files.json"), "utf8"));
}

function adjacency(graph, reverse = false) {
  const adj = new Map();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    const [from, to] = reverse ? [e.to, e.from] : [e.from, e.to];
    if (adj.has(from)) adj.get(from).push(to);
  }
  return adj;
}

// Transitive closure from `start` following edges (or reverse edges), incl. start.
export function cone(graph, start, { reverse = false } = {}) {
  const adj = adjacency(graph, reverse);
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    for (const next of adj.get(stack.pop()) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return [...seen];
}

// Does `from` already reach `to`? (adding from->to would then close a cycle.)
export function reaches(graph, from, to) {
  return cone(graph, from).includes(to);
}

export function annotationOf(graph, id) {
  return graph.nodes.find((n) => n.id === id)?.annotation ?? null;
}

// Concatenated source of a set of file ids, resolved against the repo root.
// Missing files (e.g. graph nodes outside src) are skipped and counted.
export function sourceOf(repoRoot, ids) {
  let text = "";
  let missing = 0;
  for (const id of ids) {
    try {
      text += fs.readFileSync(path.join(repoRoot, id), "utf8") + "\n";
    } catch {
      missing++;
    }
  }
  return { text, missing, files: ids.length - missing };
}

// The import statements of a file — the minimum needed to reconstruct the
// dependency graph (and thus find layers/cycles) without dagward.
export function importLines(repoRoot, id) {
  let src;
  try {
    src = fs.readFileSync(path.join(repoRoot, id), "utf8");
  } catch {
    return "";
  }
  return src
    .split("\n")
    .filter((l) => /^\s*(import|export .* from)\b/.test(l))
    .join("\n");
}
