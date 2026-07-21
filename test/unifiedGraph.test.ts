import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/graph.js";
import { buildUnifiedGraph } from "../src/unifiedGraph.js";

describe("buildUnifiedGraph", () => {
  const files = buildGraph(
    "file",
    ".",
    [{ id: "a.ts", annotation: { side: "backend" } }, { id: "b.ts" }],
    [{ from: "a.ts", to: "b.ts", kind: "value", weight: 1, line: 1 }],
  );
  const functions = buildGraph(
    "function",
    ".",
    [{ id: "a.ts#f", file: "a.ts" }, { id: "b.ts#g", file: "b.ts" }, { id: "a.ts#<module>", file: "a.ts" }],
    [
      { from: "a.ts#f", to: "b.ts#g", kind: "call", weight: 1, line: 2 },
      { from: "a.ts#<module>", to: "b.ts#g", kind: "call", weight: 1, line: 3 },
    ],
  );

  const unified = buildUnifiedGraph(files, functions);

  it("keeps module nodes (file ids) plus real function nodes, dropping #<module>", () => {
    expect(unified.nodes.map((n) => n.id)).toEqual(["a.ts", "a.ts#f", "b.ts", "b.ts#g"]);
  });

  it("preserves file annotations on module nodes", () => {
    expect(unified.nodes.find((n) => n.id === "a.ts")?.annotation).toEqual({ side: "backend" });
  });

  it("unions import edges (module→module) and call edges, folding #<module> onto the file", () => {
    const tuples = unified.edges.map((e) => [e.from, e.to, e.kind]);
    expect(tuples).toContainEqual(["a.ts", "b.ts", "value"]); // import
    expect(tuples).toContainEqual(["a.ts#f", "b.ts#g", "call"]); // call
    expect(tuples).toContainEqual(["a.ts", "b.ts#g", "call"]); // top-level call folded to module
  });

  it("is a viz artifact with no stored cycles and level 'unified'", () => {
    expect(unified.level).toBe("unified");
    expect(unified.cycles).toEqual([]);
  });
});
