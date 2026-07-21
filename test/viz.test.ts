import { describe, expect, it } from "vitest";
import { buildGraph, type Graph } from "../src/graph.js";
import { buildUnifiedGraph } from "../src/unifiedGraph.js";
import { renderVizHtml } from "../src/viz.js";

function graph(level: Graph["level"], overrides: Partial<Graph> = {}): Graph {
  return { version: 1, level, root: "/repo", nodes: [], edges: [], cycles: [], ...overrides };
}

function render(overrides: Partial<Record<"folders" | "files" | "functions", Graph>> = {}) {
  const files = graph("file", overrides.files);
  const functions = graph("function", overrides.functions);
  return renderVizHtml({
    folders: graph("folder", overrides.folders),
    files,
    functions,
    unified: buildUnifiedGraph(files, functions),
  });
}

describe("renderVizHtml", () => {
  it("embeds the compact unified data blob and the client app", () => {
    const html = render({
      files: graph("file", {
        nodes: [{ id: "src/a.ts" }, { id: "src/b.ts" }],
        edges: [{ from: "src/a.ts", to: "src/b.ts", kind: "value", weight: 1 }],
      }),
    });
    expect(html).toContain('<script id="data" type="application/json">');
    expect(html).toContain("src/a.ts");
    expect(html).toContain('"edges":[[0,1,0,1]]'); // compact [from, to, kindIdx, weight]
    expect(html).toContain('"kinds":["value"'); // edge-kind index table
    expect(html).toContain('id="cv"'); // canvas renderer
  });

  it("escapes < so node ids cannot break out of the data script", () => {
    const html = render({
      files: graph("file", { nodes: [{ id: "a</script><script>x" }] }),
    });
    expect(html).toContain("\\u003c/script>");
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  it("carries node annotations into the data blob", () => {
    const html = render({
      files: graph("file", {
        nodes: [
          { id: "src/ui.tsx", annotation: { side: "frontend", summary: "a view" } },
          { id: "src/api.ts", annotation: { side: "backend" } },
        ],
      }),
    });
    expect(html).toContain('"side":"frontend"');
    expect(html).toContain('"summary":"a view"');
  });

  it("omits annotation data for unannotated graphs", () => {
    const html = render({ files: graph("file", { nodes: [{ id: "src/a.ts" }] }) });
    expect(html).not.toContain('"ann"');
  });

  it("ships the layered layout, lanes, and drill-down machinery", () => {
    const html = render();
    expect(html).toContain("layerAssign"); // layered layout core
    expect(html).toContain("function aggregate"); // unified drill-down aggregation
    expect(html).toContain("function displayNode"); // containment mapping
    expect(html).toContain('id="reset-folders"');
    expect(html).toContain('id="split-seg"'); // side lanes toggle
  });

  it("embeds true cycles from every level as node-id lists", () => {
    const html = renderVizHtml({
      folders: graph("folder"),
      files: graph("file", {
        nodes: [{ id: "x.ts" }, { id: "y.ts" }],
        edges: [
          { from: "x.ts", to: "y.ts", kind: "value", weight: 1 },
          { from: "y.ts", to: "x.ts", kind: "value", weight: 1 },
        ],
        cycles: [{ id: 0, nodes: ["x.ts", "y.ts"] }],
      }),
      functions: graph("function"),
      unified: buildGraph("unified", "/repo", [], []),
    });
    expect(html).toContain('"trueCycles":[["x.ts","y.ts"]]');
  });
});
