import fs from "node:fs";
import type { EdgeKind, Graph } from "./graph.js";

export interface VizInput {
  folders: Graph;
  files: Graph;
  functions: Graph;
  unified: Graph;
}

const KINDS: EdgeKind[] = ["value", "type", "dynamic", "call", "reference"];

// The client (style.css, body.html, layers.js, app.js in viz-assets/) is the
// single source of the viz page; renderVizHtml only supplies the data blob.
function asset(name: string): string {
  return fs.readFileSync(new URL(`./viz-assets/${name}`, import.meta.url), "utf8");
}

// The client drills the unified graph: nodes keep id/line/annotation, edges
// become [fromIdx, toIdx, kindIdx, weight].
function compactNodes(graph: Graph) {
  return graph.nodes.map((n) => ({
    id: n.id,
    ...(n.line !== undefined ? { ln: n.line } : {}),
    ...(n.annotation ? { ann: n.annotation } : {}),
  }));
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderVizHtml(input: VizInput): string {
  const idx = new Map(input.unified.nodes.map((n, i) => [n.id, i]));
  const data = {
    root: input.files.root,
    kinds: KINDS, // the edge-kind index table app.js decodes edges with
    nodes: compactNodes(input.unified),
    edges: input.unified.edges.map((e) => [
      idx.get(e.from)!,
      idx.get(e.to)!,
      KINDS.indexOf(e.kind),
      e.weight,
    ]),
    // true cycles at every level, as node-id lists — the client classifies a
    // displayed aggregate cycle as real vs projection against these
    trueCycles: [...input.folders.cycles, ...input.files.cycles, ...input.functions.cycles].map(
      (c) => c.nodes,
    ),
  };
  // <-escape so a node id containing </script> cannot terminate the data tag
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dagward — ${escapeHtml(input.files.root)}</title>
<style>
${asset("style.css")}
</style>
</head>
<body>
${asset("body.html")}
<script id="data" type="application/json">${json}</script>
<script>
window.DAGWARD_DATA = JSON.parse(document.getElementById("data").textContent);
${asset("layers.js")}
${asset("app.js")}
</script>
</body>
</html>
`;
}
