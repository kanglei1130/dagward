import { describe, expect, it } from "vitest";
import type { Graph } from "../src/graph.js";
import { affects, queryNode } from "../src/query.js";

const files: Graph = {
  version: 1,
  level: "file",
  root: "/repo",
  nodes: [
    { id: "src/a.ts", annotation: { summary: "entry", side: "backend" } },
    { id: "src/b.ts" },
    { id: "src/c.ts" },
    { id: "src/lonely.ts" },
  ],
  edges: [
    { from: "src/a.ts", to: "src/b.ts", kind: "value", weight: 1 },
    { from: "src/b.ts", to: "src/c.ts", kind: "value", weight: 1 },
  ],
  cycles: [],
};

describe("queryNode", () => {
  it("returns the contract plus direct neighbours", () => {
    expect(queryNode(files, "src/b.ts")).toEqual({
      id: "src/b.ts",
      annotation: undefined,
      imports: ["src/c.ts"],
      importedBy: ["src/a.ts"],
    });
  });

  it("carries the annotation when present", () => {
    expect(queryNode(files, "src/a.ts")?.annotation).toEqual({ summary: "entry", side: "backend" });
  });

  it("returns null for an unknown file", () => {
    expect(queryNode(files, "src/nope.ts")).toBeNull();
  });
});

describe("affects", () => {
  it("returns transitive dependents, excluding the file itself", () => {
    expect(affects(files, "src/c.ts")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns nothing for a file no one imports", () => {
    expect(affects(files, "src/a.ts")).toEqual([]);
    expect(affects(files, "src/lonely.ts")).toEqual([]);
  });

  it("terminates on cycles", () => {
    const cyclic: Graph = {
      ...files,
      edges: [
        { from: "src/a.ts", to: "src/b.ts", kind: "value", weight: 1 },
        { from: "src/b.ts", to: "src/a.ts", kind: "value", weight: 1 },
      ],
    };
    expect(affects(cyclic, "src/a.ts")).toEqual(["src/b.ts"]);
  });
});

