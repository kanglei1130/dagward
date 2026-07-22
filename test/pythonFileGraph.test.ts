import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPythonFileGraph, extractImports } from "../src/pythonFileGraph.js";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);

function edgeTuples(name: string): [string, string, string][] {
  const { graph } = buildPythonFileGraph(fixture(name));
  return graph.edges.map((e) => [e.from, e.to, e.kind]);
}

describe("buildPythonFileGraph", () => {
  it("resolves absolute, relative, package, and submodule imports", () => {
    expect(edgeTuples("python-simple")).toEqual([
      ["app/main.py", "app/__init__.py", "value"], // from app import service → the package
      ["app/main.py", "app/service.py", "value"], // from app import service → the submodule
      ["app/main.py", "app/util.py", "value"], // import app.util
      ["app/service.py", "app/__init__.py", "value"], // from . import models → the package
      ["app/service.py", "app/models.py", "value"], // from . import models → the submodule
      ["app/service.py", "app/util.py", "value"], // from .util import helper
    ]);
  });

  it("classifies TYPE_CHECKING as type, importlib as dynamic, and drops externals", () => {
    const { graph, skippedDynamicImports } = buildPythonFileGraph(fixture("python-features"));
    expect(graph.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
      ["pkg/core.py", "pkg/__init__.py", "type"], // from pkg import models (under TYPE_CHECKING)
      ["pkg/core.py", "pkg/models.py", "type"],
      ["pkg/core.py", "pkg/plugins.py", "dynamic"], // importlib.import_module("pkg.plugins")
    ]);
    // __future__, typing, importlib are external → no edges; the non-literal
    // importlib.import_module(name) in plugins.py is counted, not resolved.
    expect(skippedDynamicImports).toBe(1);
  });

  it("detects an import cycle between flat top-level modules", () => {
    const { graph } = buildPythonFileGraph(fixture("python-cycle"));
    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0].nodes).toEqual(["a.py", "b.py"]);
  });

  it("records 1-based line numbers on edges", () => {
    const { graph } = buildPythonFileGraph(fixture("python-simple"));
    const edge = graph.edges.find((e) => e.from === "app/main.py" && e.to === "app/util.py");
    expect(edge?.line).toBe(2); // `import app.util` is the second line
  });
});

describe("extractImports", () => {
  it("parses import forms and skips strings/comments", () => {
    const src = [
      "import os, sys as system",
      "from a.b import c, d as e",
      "x = 'import fake'  # from bogus import nope",
      "from . import sib",
      "from ..pkg import (",
      "    one,",
      "    two,",
      ")",
    ].join("\n");
    const { refs } = extractImports(src);
    expect(refs).toEqual([
      { from: false, module: "os", names: [], level: 0, kind: "value", line: 1 },
      { from: false, module: "sys", names: [], level: 0, kind: "value", line: 1 },
      { from: true, module: "a.b", names: ["c", "d"], level: 0, kind: "value", line: 2 },
      { from: true, module: "", names: ["sib"], level: 1, kind: "value", line: 4 },
      { from: true, module: "pkg", names: ["one", "two"], level: 2, kind: "value", line: 5 },
    ]);
  });

  it("ignores import-looking text inside triple-quoted strings", () => {
    const src = ['"""', "import notreal", "from x import y", '"""', "import real"].join("\n");
    const { refs } = extractImports(src);
    expect(refs).toEqual([
      { from: false, module: "real", names: [], level: 0, kind: "value", line: 5 },
    ]);
  });
});
