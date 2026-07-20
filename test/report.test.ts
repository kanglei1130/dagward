import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFileGraph } from "../src/fileGraph.js";
import { buildFolderGraph } from "../src/folderGraph.js";
import { buildFunctionGraph } from "../src/functionGraph.js";
import { loadProject } from "../src/project.js";
import { renderArchitectureMd, type ReportInput } from "../src/report.js";

function reportFor(fixtureName: string): string {
  const project = loadProject(path.join(__dirname, "fixtures", fixtureName));
  const { graph: files, skippedDynamicImports } = buildFileGraph(project);
  const input: ReportInput = {
    folders: buildFolderGraph(files),
    files,
    functions: buildFunctionGraph(project),
    skippedDynamicImports,
    version: "0.0.0-test",
  };
  // strip the machine-specific absolute root for stable snapshots
  return renderArchitectureMd(input).replace(project.rootDir, "<root>");
}

describe("renderArchitectureMd", () => {
  it("renders the simple fixture (snapshot)", () => {
    expect(reportFor("simple")).toMatchSnapshot();
  });

  it("lists file cycles with concrete import lines", () => {
    const report = reportFor("cycle");
    expect(report).toContain("### File cycles (1)");
    expect(report).toContain("src/x.ts ⇄ src/y.ts");
    expect(report).toContain("`src/x.ts:1` → `src/y.ts` (value)");
  });

  it("celebrates a DAG when no cycles exist", () => {
    expect(reportFor("simple")).toContain("Your dependency graph is a DAG");
  });
});
