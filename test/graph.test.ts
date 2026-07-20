import { describe, expect, it } from "vitest";
import {
  buildGraph,
  carryAnnotations,
  findCycles,
  stronglyConnectedComponents,
  type GraphEdge,
  type GraphNode,
} from "../src/graph.js";

function adjacency(edges: [string, string][]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [from, to] of edges) {
    if (!map.has(from)) map.set(from, []);
    map.get(from)!.push(to);
  }
  return map;
}

describe("stronglyConnectedComponents", () => {
  it("handles an empty graph", () => {
    expect(stronglyConnectedComponents([], new Map())).toEqual([]);
  });

  it("returns singletons for a chain", () => {
    const sccs = stronglyConnectedComponents(
      ["a", "b", "c"],
      adjacency([
        ["a", "b"],
        ["b", "c"],
      ]),
    );
    expect(sccs.map((c) => c.join(","))).toContain("a");
    expect(sccs).toHaveLength(3);
    expect(sccs.every((c) => c.length === 1)).toBe(true);
  });

  it("finds one big cycle", () => {
    const sccs = stronglyConnectedComponents(
      ["a", "b", "c"],
      adjacency([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ]),
    );
    expect(sccs).toEqual([["a", "b", "c"]]);
  });

  it("finds two SCCs joined by a bridge", () => {
    const sccs = stronglyConnectedComponents(
      ["a", "b", "x", "y"],
      adjacency([
        ["a", "b"],
        ["b", "a"],
        ["b", "x"],
        ["x", "y"],
        ["y", "x"],
      ]),
    );
    const multi = sccs.filter((c) => c.length > 1).map((c) => c.join(","));
    expect(multi.sort()).toEqual(["a,b", "x,y"]);
  });
});

describe("findCycles", () => {
  const node = (id: string): GraphNode => ({ id });
  const edge = (from: string, to: string): GraphEdge => ({ from, to, kind: "value", weight: 1 });

  it("ignores acyclic graphs", () => {
    expect(findCycles([node("a"), node("b")], [edge("a", "b")])).toEqual([]);
  });

  it("reports self-loops as cycles", () => {
    expect(findCycles([node("a")], [edge("a", "a")])).toEqual([{ id: 0, nodes: ["a"] }]);
  });

  it("reports multi-node SCCs as cycles", () => {
    const cycles = findCycles(
      [node("a"), node("b"), node("c")],
      [edge("a", "b"), edge("b", "a"), edge("b", "c")],
    );
    expect(cycles).toEqual([{ id: 0, nodes: ["a", "b"] }]);
  });
});

describe("carryAnnotations", () => {
  const ann = (summary: string) => ({ summary, side: "backend" as const });

  it("copies annotations by id and drops those of removed nodes", () => {
    const prev = buildGraph("file", ".", [{ id: "a.ts", annotation: ann("A") }, { id: "gone.ts", annotation: ann("G") }], []);
    const next = buildGraph("file", ".", [{ id: "a.ts" }, { id: "b.ts" }], []);
    carryAnnotations(prev, next);
    expect(next.nodes.find((n) => n.id === "a.ts")?.annotation).toEqual(ann("A"));
    expect(next.nodes.find((n) => n.id === "b.ts")?.annotation).toBeUndefined();
    expect(next.nodes).toHaveLength(2);
  });

  it("keeps an annotation the next graph already has", () => {
    const prev = buildGraph("file", ".", [{ id: "a.ts", annotation: ann("old") }], []);
    const next = buildGraph("file", ".", [{ id: "a.ts", annotation: ann("new") }], []);
    carryAnnotations(prev, next);
    expect(next.nodes[0].annotation).toEqual(ann("new"));
  });
});

describe("buildGraph", () => {
  it("sorts nodes and edges deterministically", () => {
    const graph = buildGraph(
      "file",
      ".",
      [{ id: "b.ts" }, { id: "a.ts" }],
      [
        { from: "b.ts", to: "a.ts", kind: "value", weight: 1 },
        { from: "a.ts", to: "b.ts", kind: "type", weight: 2 },
      ],
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["a.ts", "b.ts"]);
    expect(graph.edges[0]).toMatchObject({ from: "a.ts", to: "b.ts" });
    expect(graph.cycles).toHaveLength(1);
    expect(graph.version).toBe(1);
  });
});
