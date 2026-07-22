import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFileGraph } from "../src/fileGraph.js";
import { loadProject } from "../src/project.js";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);

function edgeTuples(name: string): [string, string, string][] {
  const { graph } = buildFileGraph(loadProject(fixture(name)));
  return graph.edges.map((e) => [e.from, e.to, e.kind]);
}

describe("buildFileGraph", () => {
  it("resolves extensionless and index imports, plus dynamic imports", () => {
    const project = loadProject(fixture("simple"));
    const { graph, skippedDynamicImports } = buildFileGraph(project);
    expect(graph.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
      ["src/a.ts", "src/b/index.ts", "value"],
      ["src/a.ts", "src/lazy.ts", "dynamic"],
      ["src/b/index.ts", "src/b/c.ts", "value"],
    ]);
    expect(skippedDynamicImports).toBe(1); // import(someVar) has no literal specifier
    expect(graph.cycles).toEqual([]);
  });

  it("detects the x/y cycle and keeps z out of it", () => {
    const { graph } = buildFileGraph(loadProject(fixture("cycle")));
    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0].nodes).toEqual(["src/x.ts", "src/y.ts"]);
  });

  it("resolves paths aliases and drops unresolved bare imports", () => {
    expect(edgeTuples("paths-alias")).toEqual([["app.ts", "lib/util.ts", "value"]]);
  });

  it("classifies type-only imports, mixed imports, and re-exports", () => {
    expect(edgeTuples("type-only")).toEqual([
      ["src/consumer.ts", "src/mixed.ts", "value"], // mixed { type A, makeT } → value
      ["src/consumer.ts", "src/types.ts", "type"],
      ["src/mixed.ts", "src/types.ts", "type"], // export type { A } from
      ["src/mixed.ts", "src/types.ts", "value"], // export { makeT } from
      ["src/types.ts", "src/consumer.ts", "type"],
    ]);
  });

  it("still reports a type-only cycle as a cycle", () => {
    const { graph } = buildFileGraph(loadProject(fixture("type-only")));
    expect(graph.cycles.some((c) => c.nodes.includes("src/types.ts"))).toBe(true);
  });

  it("records 1-based line numbers on edges", () => {
    const { graph } = buildFileGraph(loadProject(fixture("simple")));
    const edge = graph.edges.find((e) => e.to === "src/b/index.ts");
    expect(edge?.line).toBe(1);
  });

  it("records loc and byte size on each file node", () => {
    const { graph } = buildFileGraph(loadProject(fixture("simple")));
    for (const node of graph.nodes) {
      expect(node.loc).toBeGreaterThan(0);
      expect(node.bytes).toBeGreaterThan(0);
    }
    expect(graph.nodes.find((n) => n.id === "src/b/c.ts")?.bytes).toBe(46);
  });
});
