export type EdgeKind = "value" | "type" | "dynamic" | "call" | "reference";

export type GraphLevel = "folder" | "file" | "function";

// AI- or human-written enrichment. Dagward never generates these; it only
// preserves them across regenerations (see carryAnnotations).
export interface NodeAnnotation {
  summary?: string;
  inputs?: string;
  outputs?: string;
  should?: string;
  shouldNot?: string;
  side?: "frontend" | "backend" | "shared" | "tooling";
  pure?: boolean;
}

export interface GraphNode {
  id: string;
  file?: string;
  line?: number;
  fileCount?: number;
  annotation?: NodeAnnotation;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
  line?: number;
}

export interface Cycle {
  id: number;
  nodes: string[];
}

export interface Graph {
  version: 1;
  level: GraphLevel;
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: Cycle[];
}

// Iterative Tarjan: explicit frames so deep DFS chains on large repos
// don't overflow the call stack. Returns SCCs as arrays of node ids.
export function stronglyConnectedComponents(
  nodeIds: string[],
  adjacency: Map<string, string[]>,
): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const start of nodeIds) {
    if (index.has(start)) continue;
    const frames: { node: string; cursor: number }[] = [{ node: start, cursor: 0 }];
    index.set(start, counter);
    lowlink.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const neighbors = adjacency.get(frame.node) ?? [];
      if (frame.cursor < neighbors.length) {
        const next = neighbors[frame.cursor++];
        if (!index.has(next)) {
          index.set(next, counter);
          lowlink.set(next, counter);
          counter++;
          stack.push(next);
          onStack.add(next);
          frames.push({ node: next, cursor: 0 });
        } else if (onStack.has(next)) {
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node)!, index.get(next)!));
        }
      } else {
        frames.pop();
        const parent = frames[frames.length - 1];
        if (parent) {
          lowlink.set(parent.node, Math.min(lowlink.get(parent.node)!, lowlink.get(frame.node)!));
        }
        if (lowlink.get(frame.node) === index.get(frame.node)) {
          const component: string[] = [];
          let popped: string;
          do {
            popped = stack.pop()!;
            onStack.delete(popped);
            component.push(popped);
          } while (popped !== frame.node);
          components.push(component.sort());
        }
      }
    }
  }
  return components;
}

// A component is a cycle if it has >1 node, or a single node with a self-edge.
export function findCycles(nodes: GraphNode[], edges: GraphEdge[]): Cycle[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    let targets = adjacency.get(edge.from);
    if (!targets) adjacency.set(edge.from, (targets = []));
    targets.push(edge.to);
  }
  const selfLoops = new Set(edges.filter((e) => e.from === e.to).map((e) => e.from));
  const components = stronglyConnectedComponents(
    nodes.map((n) => n.id),
    adjacency,
  );
  return components
    .filter((c) => c.length > 1 || selfLoops.has(c[0]))
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))
    .map((c, i) => ({ id: i, nodes: c }));
}

// Sorted nodes/edges, no timestamps: output is diffable and deep-comparable.
export function buildGraph(
  level: GraphLevel,
  root: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Graph {
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...edges].sort(
    (a, b) =>
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
  );
  return {
    version: 1,
    level,
    root,
    nodes: sortedNodes,
    edges: sortedEdges,
    cycles: findCycles(sortedNodes, sortedEdges),
  };
}

export function serializeGraph(graph: Graph): string {
  return JSON.stringify(graph, null, 2) + "\n";
}

// Copy node annotations from a previous graph onto a freshly built one, by
// node id. A node that was rebuilt with its own annotation keeps it.
export function carryAnnotations(prev: Graph, next: Graph): Graph {
  const previous = new Map(
    prev.nodes.filter((n) => n.annotation).map((n) => [n.id, n.annotation!]),
  );
  for (const node of next.nodes) {
    if (!node.annotation) {
      const annotation = previous.get(node.id);
      if (annotation) node.annotation = annotation;
    }
  }
  return next;
}
