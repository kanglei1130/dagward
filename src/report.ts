import { edgesToAdjacency, stronglyConnectedComponents, type Graph } from "./graph.js";
import type { UnusedImport } from "./unusedImports.js";

export interface ReportInput {
  folders: Graph;
  files: Graph;
  // Only present when `init --functions` ran; the function level is opt-in.
  functions?: Graph;
  skippedDynamicImports: number;
  unusedImports: UnusedImport[];
  version: string;
}

// Layer depth on the condensation of the folder graph: layer 0 depends on
// nothing; layer N depends only on layers < N. Cyclic groups share a depth.
// NOTE: src/viz-assets/layers.js computes layers for the viz with the
// OPPOSITE orientation (its layer 0 = no ingress, i.e. entry points), plus
// sink-pinning and empty-layer compaction — "layer 2" here and in viz.html
// are different things. Keep that in mind when comparing outputs.
function folderLayers(folders: Graph): Map<number, string[]> {
  const sccs = stronglyConnectedComponents(
    folders.nodes.map((n) => n.id),
    edgesToAdjacency(folders.edges),
  );
  const componentOf = new Map<string, number>();
  sccs.forEach((scc, i) => scc.forEach((id) => componentOf.set(id, i)));

  const deps = new Map<number, Set<number>>(sccs.map((_, i) => [i, new Set()]));
  for (const edge of folders.edges) {
    const from = componentOf.get(edge.from)!;
    const to = componentOf.get(edge.to)!;
    if (from !== to) deps.get(from)!.add(to);
  }

  const depth = new Map<number, number>();
  const resolve = (component: number): number => {
    const known = depth.get(component);
    if (known !== undefined) return known;
    let d = 0;
    for (const dep of deps.get(component)!) d = Math.max(d, resolve(dep) + 1);
    depth.set(component, d);
    return d;
  };

  const layers = new Map<number, string[]>();
  sccs.forEach((scc, i) => {
    const d = resolve(i);
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(...scc);
  });
  for (const members of layers.values()) members.sort();
  return layers;
}

function fanCounts(graph: Graph): Map<string, { fanIn: number; fanOut: number }> {
  const counts = new Map<string, { fanIn: number; fanOut: number }>();
  const entry = (id: string) => {
    if (!counts.has(id)) counts.set(id, { fanIn: 0, fanOut: 0 });
    return counts.get(id)!;
  };
  for (const node of graph.nodes) entry(node.id);
  for (const edge of graph.edges) {
    entry(edge.from).fanOut++;
    entry(edge.to).fanIn++;
  }
  return counts;
}

function cyclesSection(lines: string[], graph: Graph, label: string, cap?: number): void {
  if (graph.cycles.length === 0) return;
  const shown = cap ? graph.cycles.slice(0, cap) : graph.cycles;
  lines.push(`### ${label} cycles (${graph.cycles.length})`, "");
  for (const cycle of shown) {
    lines.push(`- **Cycle ${cycle.id}** (${cycle.nodes.length} nodes): ${cycle.nodes.join(" ⇄ ")}`);
    if (graph.level === "file") {
      const members = new Set(cycle.nodes);
      for (const edge of graph.edges) {
        if (members.has(edge.from) && members.has(edge.to) && edge.from !== edge.to) {
          lines.push(`  - \`${edge.from}:${edge.line ?? "?"}\` → \`${edge.to}\` (${edge.kind})`);
        }
      }
    }
  }
  if (cap && graph.cycles.length > cap) {
    lines.push(`- … ${graph.cycles.length - cap} more (see JSON output)`);
  }
  lines.push("");
}

export function renderArchitectureMd(input: ReportInput): string {
  const { folders, files, functions } = input;
  const lines: string[] = [];

  lines.push("# Architecture Review", "");
  lines.push(`Project root: \`${folders.root}\``, "");
  lines.push("| Level | Nodes | Edges | Cycles |");
  lines.push("|---|---:|---:|---:|");
  for (const graph of [folders, files, ...(functions ? [functions] : [])]) {
    lines.push(
      `| ${graph.level} | ${graph.nodes.length} | ${graph.edges.length} | ${graph.cycles.length} |`,
    );
  }
  lines.push("");

  lines.push("## Folder layering", "");
  lines.push(
    "Layer 0 depends on nothing; each layer depends only on lower layers.",
    "Folders in a cycle share a layer.",
    "",
  );
  const fans = fanCounts(folders);
  const fileCount = new Map(folders.nodes.map((n) => [n.id, n.fileCount ?? 0]));
  lines.push("| Layer | Folder | Files | Fan-in | Fan-out |");
  lines.push("|---:|---|---:|---:|---:|");
  const layers = folderLayers(folders);
  for (const depth of [...layers.keys()].sort((a, b) => a - b)) {
    for (const folder of layers.get(depth)!) {
      const fan = fans.get(folder)!;
      lines.push(
        `| ${depth} | \`${folder}\` | ${fileCount.get(folder)} | ${fan.fanIn} | ${fan.fanOut} |`,
      );
    }
  }
  lines.push("");

  const anyCycles =
    folders.cycles.length + files.cycles.length + (functions?.cycles.length ?? 0) > 0;
  lines.push("## Cycles", "");
  if (anyCycles) {
    cyclesSection(lines, folders, "Folder");
    cyclesSection(lines, files, "File");
    if (functions) cyclesSection(lines, functions, "Function", 20);
  } else {
    lines.push("None found at any level. Your dependency graph is a DAG. 🎉", "");
  }

  lines.push("## Notable edges", "");
  const heaviest = [...folders.edges].sort((a, b) => b.weight - a.weight).slice(0, 10);
  if (heaviest.length > 0) {
    lines.push("### Heaviest cross-folder dependencies", "");
    lines.push("| From | To | Kind | File edges |");
    lines.push("|---|---|---|---:|");
    for (const edge of heaviest) {
      lines.push(`| \`${edge.from}\` | \`${edge.to}\` | ${edge.kind} | ${edge.weight} |`);
    }
    lines.push("");
  }

  const fileFans = fanCounts(files);
  const hubs = [...fileFans.entries()]
    .filter(([, fan]) => fan.fanIn > 0)
    .sort((a, b) => b[1].fanIn - a[1].fanIn)
    .slice(0, 10);
  if (hubs.length > 0) {
    lines.push("### Most depended-on files (hubs)", "");
    lines.push("| File | Fan-in | Fan-out |");
    lines.push("|---|---:|---:|");
    for (const [id, fan] of hubs) {
      lines.push(`| \`${id}\` | ${fan.fanIn} | ${fan.fanOut} |`);
    }
    lines.push("");
  }

  const pairKinds = new Map<string, Set<string>>();
  for (const edge of folders.edges) {
    const key = `${edge.from} → ${edge.to}`;
    if (!pairKinds.has(key)) pairKinds.set(key, new Set());
    pairKinds.get(key)!.add(edge.kind);
  }
  const typeOnlyPairs = [...pairKinds.entries()]
    .filter(([, kinds]) => kinds.size === 1 && kinds.has("type"))
    .map(([pair]) => pair)
    .slice(0, 10);
  if (typeOnlyPairs.length > 0) {
    lines.push("### Folder pairs connected only by type imports", "");
    lines.push("These couplings vanish at runtime — candidates for clean decoupling.", "");
    for (const pair of typeOnlyPairs) lines.push(`- \`${pair}\``);
    lines.push("");
  }

  if (input.unusedImports.length > 0) {
    lines.push("## Unused imports", "");
    lines.push(
      `${input.unusedImports.length} import(s) are declared but never used — dead code that ` +
        "adds to the token cost of every read. (Side-effect imports are never flagged.)",
      "",
    );
    for (const u of input.unusedImports.slice(0, 30)) {
      lines.push(`- \`${u.file}:${u.line}\` → \`${u.specifier}\``);
    }
    if (input.unusedImports.length > 30) {
      lines.push(`- … ${input.unusedImports.length - 30} more`);
    }
    lines.push("");
  }

  if (input.skippedDynamicImports > 0) {
    lines.push(
      `> Note: ${input.skippedDynamicImports} dynamic import(s) with non-literal specifiers ` +
        "could not be resolved and are not in the graph.",
      "",
    );
  }

  lines.push("---", "");
  lines.push(
    `Generated by dagward v${input.version}. Machine-readable ` +
      (functions
        ? "graphs: `graph.files.json`, `graph.functions.json`."
        : "graph: `graph.files.json`."),
  );
  return lines.join("\n") + "\n";
}
