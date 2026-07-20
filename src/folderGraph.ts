import path from "node:path";
import {
  accumulateEdge,
  buildGraph,
  type EdgeKind,
  type Graph,
  type GraphEdge,
  type GraphNode,
} from "./graph.js";

function folderOf(fileId: string): string {
  const dir = path.posix.dirname(fileId);
  return dir === "" ? "." : dir;
}

// Folders are the immediate parent of each file. Ancestor rollups are
// derivable by consumers from the path hierarchy; emitting every ancestor
// pair would manufacture phantom cycles at higher levels.
export function buildFolderGraph(fileGraph: Graph): Graph {
  const fileCounts = new Map<string, number>();
  for (const node of fileGraph.nodes) {
    const folder = folderOf(node.id);
    fileCounts.set(folder, (fileCounts.get(folder) ?? 0) + 1);
  }

  const merged = new Map<string, GraphEdge>();
  for (const edge of fileGraph.edges) {
    const from = folderOf(edge.from);
    const to = folderOf(edge.to);
    if (from === to) continue;
    // dynamic imports are runtime deps: fold into value at folder level
    const kind: EdgeKind = edge.kind === "type" ? "type" : "value";
    accumulateEdge(merged, { from, to, kind, weight: edge.weight });
  }

  const nodes: GraphNode[] = [...fileCounts.entries()].map(([id, fileCount]) => ({
    id,
    fileCount,
  }));
  return buildGraph("folder", fileGraph.root, nodes, [...merged.values()]);
}
