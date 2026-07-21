import type { Graph, NodeAnnotation } from "./graph.js";

export interface NodeQuery {
  id: string;
  annotation?: NodeAnnotation;
  imports: string[];
  importedBy: string[];
}

// Both directions in one pass, so callers that need every node (the index)
// don't rescan the edge list per node.
function adjacency(files: Graph): {
  imports: Map<string, Set<string>>;
  importedBy: Map<string, Set<string>>;
} {
  const imports = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(value);
  };
  for (const edge of files.edges) {
    add(imports, edge.from, edge.to);
    add(importedBy, edge.to, edge.from);
  }
  return { imports, importedBy };
}

const sorted = (set: Set<string> | undefined): string[] => [...(set ?? [])].sort();

// One file's contract plus its direct neighbours — the answer to "what is this
// file?" without reading its source.
export function queryNode(files: Graph, id: string): NodeQuery | null {
  const node = files.nodes.find((n) => n.id === id);
  if (!node) return null;
  const adj = adjacency(files);
  return {
    id,
    annotation: node.annotation,
    imports: sorted(adj.imports.get(id)),
    importedBy: sorted(adj.importedBy.get(id)),
  };
}

// Transitive dependents: everything that breaks if `id` changes.
export function affects(files: Graph, id: string): string[] {
  const { importedBy } = adjacency(files);
  const seen = new Set<string>([id]);
  const stack = [id];
  while (stack.length > 0) {
    for (const source of importedBy.get(stack.pop()!) ?? []) {
      if (!seen.has(source)) {
        seen.add(source);
        stack.push(source);
      }
    }
  }
  seen.delete(id);
  return [...seen].sort();
}

// One lean line per file for search: id, side, and summary only. Deliberately
// small — a keyword grep can match hundreds of lines, and carrying full
// contracts here costs more context than reading the sources it replaces.
// Full contract + neighbours come from `dagward query <file>`, one file at a time.
export function renderAnnotationsIndex(files: Graph): string {
  return (
    files.nodes
      .map((node) => {
        const { side, summary } = node.annotation ?? {};
        return [node.id, side ?? "", summary ?? ""].join("\t");
      })
      .join("\n") + "\n"
  );
}
