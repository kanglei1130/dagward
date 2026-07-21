#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { evaluate } from "./check.js";
import { buildFileGraph } from "./fileGraph.js";
import { buildFolderGraph } from "./folderGraph.js";
import { buildFunctionGraph } from "./functionGraph.js";
import { carryAnnotations, serializeGraph, type Graph } from "./graph.js";
import { ConfigError, loadProject } from "./project.js";
import { renderArchitectureMd } from "./report.js";
import { affects, queryNode, renderAnnotationsIndex } from "./query.js";
import { loadRuleSet } from "./rules.js";
import { buildUnifiedGraph } from "./unifiedGraph.js";
import { findUnusedImports } from "./unusedImports.js";
import { renderVizHtml, type VizInput } from "./viz.js";

const HELP = `dagward — multi-level dependency graphs for TypeScript projects

Usage:
  dagward init    [dir] [options]   Analyze the project, write graphs + report (dir defaults to .)
  dagward check   [dir] [options]   Check the dependency graph against dagward.yml rules
  dagward viz     [dir] [options]   Render dagward-out graphs to an interactive viz.html
  dagward query   <file> [options]  Print one file's contract + direct imports/importers
  dagward affects <file> [options]  Print everything that breaks if <file> changes

Options:
  --project <path>   Explicit tsconfig.json (default: nearest to [dir])
  --out <dir>        Output directory (default: <dir>/dagward-out, or ./dagward-out for queries)
  --no-open          viz: do not open viz.html in the browser
  --help             Show this help
  --version          Show version

Outputs: graph.{folders,files,functions,unified}.json, annotations.jsonl, ARCHITECTURE.md

query/affects read dagward-out and print JSON — no source reads, no re-analysis.
For a grep-only lookup: grep '"id":"src/foo.ts"' dagward-out/annotations.jsonl

Exit codes: 0 ok, 1 rule violations (check), 2 config error.`;

const STARTER_RULES = `version: 1

# Layers are ordered: earlier layers may not depend on later ones.
# layers:
#   - name: domain
#     match: "src/domain/**"
#   - name: infrastructure
#     match: "src/infrastructure/**"

rules:
  - id: no-folder-cycles
    type: no-cycles
    level: folder
    rationale: >
      Folder cycles dissolve module boundaries: every member's dependency
      cone grows to include the entire cycle.

  - id: no-file-cycles
    type: no-cycles
    level: file
    rationale: >
      Import cycles cause initialization-order bugs and make files
      impossible to extract or test in isolation.

#   - id: layering
#     type: layer-order
#     ignore-type-imports: true
#     rationale: Dependencies point one way, toward the domain.
#
#   - id: no-api-to-db
#     type: forbidden-edge
#     from: "src/api/**"
#     to: "src/db/**"
#     rationale: API handlers go through the repository layer.
#     fix: Import from src/repositories instead.

# exemptions:
#   - rule: layering
#     from: "src/legacy/pricing.ts"
#     to: "src/infrastructure/**"
#     reason: "Pre-dates the boundary. Tracked in TICKET-123."
`;

function timed<T>(label: string | ((result: T) => string), fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const text = typeof label === "string" ? label : label(result);
  console.error(`→ ${text} … ${Math.round(performance.now() - start)}ms`);
  return result;
}

function version(): string {
  const pkg = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return pkg.version;
}

export function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      out: { type: "string" },
      "no-open": { type: "boolean" },
      help: { type: "boolean" },
      version: { type: "boolean" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log(version());
    return 0;
  }

  const [command, dirArg] = positionals;
  const known = ["init", "check", "viz", "query", "affects"];
  if (!known.includes(command)) {
    console.error(command ? `Unknown command: ${command}` : HELP);
    return command ? 2 : 0;
  }

  // For query/affects the positional is a file id, not a directory.
  if (command === "query" || command === "affects") {
    const queryOut = path.resolve(values.out ?? "dagward-out");
    return runQuery(command, queryOut, dirArg);
  }

  const targetDir = path.resolve(dirArg ?? ".");
  const outDir = path.resolve(values.out ?? path.join(targetDir, "dagward-out"));

  if (command === "viz") {
    return runViz(outDir, values["no-open"] ?? false);
  }
  if (command === "check") {
    return runCheck(targetDir, values.project ? path.resolve(values.project) : undefined);
  }

  console.error(`[${new Date().toISOString()}] Initializing dagward in ${targetDir}`);
  let project;
  try {
    project = timed(
      (p) => `load project (${p.sourceFiles.length} files, tsconfig at ${p.rootDir})`,
      () => loadProject(targetDir, values.project ? path.resolve(values.project) : undefined),
    );
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Config error: ${error.message}`);
      return 2;
    }
    throw error;
  }

  const { graph: files, skippedDynamicImports } = timed("file graph", () =>
    buildFileGraph(project),
  );
  const folders = timed("folder graph", () => buildFolderGraph(files));
  const functions = timed("function graph", () => buildFunctionGraph(project));
  const unusedImports = timed(
    (u) => `unused imports (${u.length})`,
    () => findUnusedImports(project),
  );

  timed("write outputs", () => {
    fs.mkdirSync(outDir, { recursive: true });
    // writeGraph carries preserved annotations onto each graph in place, so
    // build the unified graph AFTER files/folders are annotated — else its
    // module nodes copy the un-annotated file nodes.
    writeGraph(path.join(outDir, "graph.folders.json"), folders);
    writeGraph(path.join(outDir, "graph.files.json"), files);
    writeGraph(path.join(outDir, "graph.functions.json"), functions);
    writeGraph(path.join(outDir, "graph.unified.json"), buildUnifiedGraph(files, functions));
    // Grep-able one-line-per-file contracts: a lookup costs one grep, not a
    // parse of the whole file graph.
    fs.writeFileSync(path.join(outDir, "annotations.jsonl"), renderAnnotationsIndex(files));
    fs.writeFileSync(
      path.join(outDir, "ARCHITECTURE.md"),
      renderArchitectureMd({
        folders,
        files,
        functions,
        skippedDynamicImports,
        unusedImports,
        version: version(),
      }),
    );
  });

  for (const graph of [folders, files, functions]) {
    const cycles = graph.cycles.length > 0 ? `${graph.cycles.length} cycle(s)!` : "no cycles";
    console.error(
      `  ${graph.level}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${cycles}`,
    );
  }
  if (unusedImports.length > 0) {
    console.error(`  ${unusedImports.length} unused import(s) — see ARCHITECTURE.md`);
  }
  console.error(`Wrote 6 files to ${outDir}`);

  const rulesPath = path.join(targetDir, "dagward.yml");
  if (!fs.existsSync(rulesPath)) {
    fs.writeFileSync(rulesPath, STARTER_RULES);
    console.error(`Wrote draft rule file to ${rulesPath} — review, edit, and commit it.`);
  }
  return 0;
}

// One output format for everyone — humans, agents, CI: violations as JSON on
// stdout, diagnostics on stderr, the verdict in the exit code.
function runCheck(targetDir: string, projectOverride: string | undefined): number {
  try {
    const ruleSet = loadRuleSet(path.join(targetDir, "dagward.yml"));
    const project = timed(
      (p) => `load project (${p.sourceFiles.length} files, tsconfig at ${p.rootDir})`,
      () => loadProject(targetDir, projectOverride),
    );
    const { graph: files } = timed("file graph", () => buildFileGraph(project));
    const folders = timed("folder graph", () => buildFolderGraph(files));
    const { violations, unusedExemptions, deadPatterns } = evaluate(ruleSet, { folders, files });
    for (const { where, pattern } of deadPatterns) {
      console.error(`Warning: ${where} matches no file: "${pattern}" — typo, or the rule is inert`);
    }
    for (const ex of unusedExemptions) {
      console.error(`Warning: unused exemption (rule "${ex.rule}", from "${ex.from}", to "${ex.to}")`);
    }
    for (const u of findUnusedImports(project)) {
      console.error(`Warning: unused import at ${u.file}:${u.line} — "${u.specifier}"`);
    }
    console.log(JSON.stringify({ violations }, null, 2));
    console.error(
      violations.length === 0
        ? `Clean: ${ruleSet.rules.length} rule(s), 0 violations`
        : `${violations.length} violation(s)`,
    );
    return violations.length > 0 ? 1 : 0;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Config error: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

// Graph queries answered from dagward-out alone: no tsconfig, no compiler, no
// source reads — one call instead of an agent reconstructing the graph.
function runQuery(command: string, outDir: string, fileId: string | undefined): number {
  if (!fileId) {
    console.error(`Usage: dagward ${command} <file> [--out <dir>]`);
    return 2;
  }
  const graphFile = path.join(outDir, "graph.files.json");
  let files: Graph;
  try {
    files = JSON.parse(fs.readFileSync(graphFile, "utf8")) as Graph;
  } catch {
    console.error(`Cannot read ${graphFile}. Run \`dagward init\` first.`);
    return 2;
  }
  if (command === "affects") {
    const dependents = affects(files, fileId);
    console.log(JSON.stringify({ file: fileId, affects: dependents }, null, 2));
    console.error(`${dependents.length} file(s) depend on ${fileId}`);
    return 0;
  }
  const node = queryNode(files, fileId);
  if (!node) {
    console.error(`No node "${fileId}" in ${graphFile}`);
    return 2;
  }
  console.log(JSON.stringify(node, null, 2));
  return 0;
}

// Node annotations are authored externally (AI or human) but live on the
// graph nodes; regenerating must not wipe them.
function writeGraph(file: string, graph: Graph): void {
  try {
    const prev = JSON.parse(fs.readFileSync(file, "utf8")) as Graph;
    if (Array.isArray(prev?.nodes)) carryAnnotations(prev, graph);
  } catch {
    // absent or malformed previous output: nothing to preserve
  }
  fs.writeFileSync(file, serializeGraph(graph));
}

function runViz(outDir: string, noOpen: boolean): number {
  const graphs = {} as VizInput;
  const wanted: [keyof VizInput, string][] = [
    ["folders", "graph.folders.json"],
    ["files", "graph.files.json"],
    ["functions", "graph.functions.json"],
    ["unified", "graph.unified.json"],
  ];
  for (const [key, name] of wanted) {
    const file = path.join(outDir, name);
    try {
      graphs[key] = JSON.parse(fs.readFileSync(file, "utf8")) as Graph;
    } catch {
      console.error(`Cannot read ${file}. Run \`dagward init\` first.`);
      return 2;
    }
  }
  const htmlPath = path.join(outDir, "viz.html");
  timed("write viz.html", () => fs.writeFileSync(htmlPath, renderVizHtml(graphs)));
  console.error(`Wrote ${htmlPath}`);
  if (!noOpen) openInBrowser(htmlPath);
  return 0;
}

// Never shell: true — the path goes through as a plain argv element, and
// rundll32 (not `cmd /c start`) avoids cmd.exe re-parsing it on Windows.
function openInBrowser(file: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [file]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", file]]
        : ["xdg-open", [file]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {}); // a missing opener is not a CLI failure
  child.unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
