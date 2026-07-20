import { describe, expect, it } from "vitest";
import { buildFolderGraph } from "../src/folderGraph.js";
import { buildGraph, type GraphEdge } from "../src/graph.js";

const edge = (from: string, to: string, kind: GraphEdge["kind"], weight = 1): GraphEdge => ({
  from,
  to,
  kind,
  weight,
});

describe("buildFolderGraph", () => {
  it("aggregates file edges to immediate-parent folders", () => {
    const fileGraph = buildGraph(
      "file",
      ".",
      [{ id: "src/a.ts" }, { id: "src/b/index.ts" }, { id: "src/b/c.ts" }, { id: "root.ts" }],
      [
        edge("src/a.ts", "src/b/index.ts", "value"),
        edge("src/a.ts", "src/b/c.ts", "dynamic"),
        edge("src/b/index.ts", "src/b/c.ts", "value"), // same folder: dropped
        edge("root.ts", "src/a.ts", "type"),
      ],
    );
    const folderGraph = buildFolderGraph(fileGraph);

    expect(folderGraph.nodes).toEqual([
      { id: ".", fileCount: 1 },
      { id: "src", fileCount: 1 },
      { id: "src/b", fileCount: 2 },
    ]);
    // dynamic folds into value and merges with the plain value edge
    expect(folderGraph.edges).toEqual([
      { from: ".", to: "src", kind: "type", weight: 1 },
      { from: "src", to: "src/b", kind: "value", weight: 2 },
    ]);
    expect(folderGraph.cycles).toEqual([]);
  });

  it("detects cross-folder cycles", () => {
    const fileGraph = buildGraph(
      "file",
      ".",
      [{ id: "a/x.ts" }, { id: "b/y.ts" }],
      [edge("a/x.ts", "b/y.ts", "value"), edge("b/y.ts", "a/x.ts", "value")],
    );
    const folderGraph = buildFolderGraph(fileGraph);
    expect(folderGraph.cycles).toEqual([{ id: 0, nodes: ["a", "b"] }]);
  });
});
