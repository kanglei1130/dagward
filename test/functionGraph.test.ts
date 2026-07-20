import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildFunctionGraph } from "../src/functionGraph.js";
import type { Graph } from "../src/graph.js";
import { loadProject } from "../src/project.js";

let graph: Graph;
let tuples: [string, string, string][];

beforeAll(() => {
  graph = buildFunctionGraph(loadProject(path.join(__dirname, "fixtures", "functions")));
  tuples = graph.edges.map((e) => [e.from, e.to, e.kind]);
});

describe("buildFunctionGraph", () => {
  it("registers function, method, constructor, and module nodes", () => {
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain("src/util.ts#helper");
    expect(ids).toContain("src/main.ts#main");
    expect(ids).toContain("src/greeter.ts#Greeter.constructor");
    expect(ids).toContain("src/greeter.ts#Greeter.greet");
    expect(ids).toContain("src/main.ts#<module>");
  });

  it("resolves cross-file calls through import aliases", () => {
    expect(tuples).toContainEqual(["src/main.ts#main", "src/util.ts#helper", "call"]);
  });

  it("attributes calls inside anonymous closures to the enclosing function", () => {
    // helper() is called inside the arrow passed to .map — still attributed to main
    const edge = graph.edges.find(
      (e) => e.from === "src/main.ts#main" && e.to === "src/util.ts#helper" && e.kind === "call",
    );
    expect(edge?.weight).toBe(1);
  });

  it("attributes module-level calls to a synthetic <module> node", () => {
    expect(tuples).toContainEqual(["src/main.ts#<module>", "src/util.ts#helper", "call"]);
  });

  it("records reference edges for functions passed as values", () => {
    expect(tuples).toContainEqual(["src/main.ts#main", "src/util.ts#helper", "reference"]);
  });

  it("resolves method-to-method calls", () => {
    expect(tuples).toContainEqual([
      "src/greeter.ts#Greeter.greet",
      "src/greeter.ts#Greeter.prefix",
      "call",
    ]);
  });

  it("resolves new-expressions to the constructor", () => {
    expect(tuples).toContainEqual([
      "src/greeter.ts#makeGreeter",
      "src/greeter.ts#Greeter.constructor",
      "call",
    ]);
  });

  it("reports mutual recursion as a function-level cycle", () => {
    expect(graph.cycles).toContainEqual({
      id: expect.any(Number),
      nodes: ["src/recursive.ts#even", "src/recursive.ts#odd"],
    });
  });

  it("emits no edge for interface-dispatched calls", () => {
    expect(tuples.filter(([from]) => from === "src/iface.ts#runAll")).toEqual([]);
  });
});
