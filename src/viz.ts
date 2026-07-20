import fs from "node:fs";
import type { EdgeKind, Graph } from "./graph.js";

export interface VizInput {
  folders: Graph;
  files: Graph;
  functions: Graph;
}

const KINDS: EdgeKind[] = ["value", "type", "dynamic", "call", "reference"];

// The client (style.css, body.html, layers.js, app.js in viz-assets/) is the
// single source of the viz page; renderVizHtml only supplies the data blob.
function asset(name: string): string {
  return fs.readFileSync(new URL(`./viz-assets/${name}`, import.meta.url), "utf8");
}

// Compact node/edge format the client consumes: nodes keep id/fc/ln/ann,
// edges become [fromIdx, toIdx, kindIdx, weight], cycles become index lists.
function compact(graph: Graph) {
  const idx = new Map(graph.nodes.map((n, i) => [n.id, i]));
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      ...(n.fileCount !== undefined ? { fc: n.fileCount } : {}),
      ...(n.line !== undefined ? { ln: n.line } : {}),
      ...(n.annotation ? { ann: n.annotation } : {}),
    })),
    edges: graph.edges.map((e) => [idx.get(e.from)!, idx.get(e.to)!, KINDS.indexOf(e.kind), e.weight]),
    cycles: graph.cycles.map((c) => c.nodes.map((id) => idx.get(id)!)),
  };
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderVizHtml(input: VizInput): string {
  const data = {
    root: input.files.root,
    levels: {
      folder: compact(input.folders),
      file: compact(input.files),
      function: compact(input.functions),
    },
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
