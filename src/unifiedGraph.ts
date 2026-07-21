import { accumulateEdge, type Graph, type GraphEdge, type GraphNode } from "./graph.js";

const MODULE_SUFFIX = "#<module>";

// The module node standing for a file's top-level scope IS the file path;
// functionGraph's synthetic `path#<module>` nodes fold onto it so imports
// (module→module) and top-level calls attach to the same node.
function moduleOf(id: string): string {
  return id.endsWith(MODULE_SUFFIX) ? id.slice(0, -MODULE_SUFFIX.length) : id;
}

// One node-level graph the viz drills through, spanning all tiers by
// CONTAINMENT (folder ⊃ file ⊃ file#fn, all derivable from ids):
//   nodes  = module nodes (one per file, id = file path, keeping the file's
//            annotation) + function nodes (id = file#fn)
//   edges  = import edges (module → module, kinds value/type/dynamic) ∪
//            call/reference edges (function → function, with `#<module>`
//            endpoints folded onto their file's module node)
// This is a viz/navigation artifact only — file/folder enforcement still
// runs on the separate import-derived graphs, so nothing here can drop the
// ~42% of import edges that have no backing call.
export function buildUnifiedGraph(files: Graph, functions: Graph): Graph {
  const nodes: GraphNode[] = [];
  for (const n of files.nodes) nodes.push({ ...n }); // module nodes = file nodes
  for (const n of functions.nodes) {
    if (!n.id.endsWith(MODULE_SUFFIX)) nodes.push({ ...n }); // real functions only
  }

  const merged = new Map<string, GraphEdge>();
  for (const e of files.edges) accumulateEdge(merged, e); // import edges
  for (const e of functions.edges) {
    const from = moduleOf(e.from);
    const to = moduleOf(e.to);
    if (from === to) continue; // a folded top-level self-reference collapses away
    accumulateEdge(merged, { from, to, kind: e.kind, weight: e.weight, line: e.line });
  }

  return {
    version: 1,
    level: "unified",
    root: files.root,
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...merged.values()].sort(
      (a, b) =>
        a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
    ),
    cycles: [], // the viz recomputes cycles per drill frontier; none stored here
  };
}
