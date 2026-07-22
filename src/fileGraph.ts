import ts from "typescript";
import { accumulateEdge, buildGraph, type EdgeKind, type Graph, type GraphEdge } from "./graph.js";
import { relativeId, type Project } from "./project.js";

export interface FileGraphResult {
  graph: Graph;
  skippedDynamicImports: number;
}

interface RawEdge {
  specifier: ts.StringLiteralLike;
  kind: EdgeKind;
}

function allTypeOnly(elements: readonly { isTypeOnly: boolean }[]): boolean {
  return elements.length > 0 && elements.every((el) => el.isTypeOnly);
}

function classifyImport(decl: ts.ImportDeclaration): EdgeKind {
  const clause = decl.importClause;
  if (!clause) return "value"; // bare `import "./x"` is a runtime dependency
  if (clause.isTypeOnly) return "type";
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings) && !clause.name && allTypeOnly(bindings.elements)) {
    return "type";
  }
  return "value";
}

function classifyReExport(decl: ts.ExportDeclaration): EdgeKind {
  if (decl.isTypeOnly) return "type";
  const clause = decl.exportClause;
  if (clause && ts.isNamedExports(clause) && allTypeOnly(clause.elements)) return "type";
  return "value";
}

function collectRawEdges(sf: ts.SourceFile): { edges: RawEdge[]; skippedDynamic: number } {
  const edges: RawEdge[] = [];
  let skippedDynamic = 0;

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteralLike(stmt.moduleSpecifier)) {
      edges.push({ specifier: stmt.moduleSpecifier, kind: classifyImport(stmt) });
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteralLike(stmt.moduleSpecifier)
    ) {
      edges.push({ specifier: stmt.moduleSpecifier, kind: classifyReExport(stmt) });
    } else if (
      ts.isImportEqualsDeclaration(stmt) &&
      ts.isExternalModuleReference(stmt.moduleReference) &&
      ts.isStringLiteralLike(stmt.moduleReference.expression)
    ) {
      edges.push({ specifier: stmt.moduleReference.expression, kind: "value" });
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      if (ts.isStringLiteralLike(node.arguments[0])) {
        edges.push({ specifier: node.arguments[0], kind: "dynamic" });
      } else {
        skippedDynamic++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { edges, skippedDynamic };
}

export function buildFileGraph(project: Project): FileGraphResult {
  const { rootDir, options, sourceFiles } = project;
  const projectFiles = new Set(sourceFiles.map((sf) => sf.fileName));
  const cache = ts.createModuleResolutionCache(rootDir, (s) => s, options);

  const merged = new Map<string, GraphEdge>();
  let skippedDynamicImports = 0;

  for (const sf of sourceFiles) {
    const from = relativeId(rootDir, sf.fileName);
    const { edges, skippedDynamic } = collectRawEdges(sf);
    skippedDynamicImports += skippedDynamic;

    for (const raw of edges) {
      const resolved = ts.resolveModuleName(
        raw.specifier.text,
        sf.fileName,
        options,
        ts.sys,
        cache,
      ).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) continue;
      if (!projectFiles.has(resolved.resolvedFileName)) continue;

      const to = relativeId(rootDir, resolved.resolvedFileName);
      const { line } = sf.getLineAndCharacterOfPosition(raw.specifier.getStart(sf));
      accumulateEdge(merged, { from, to, kind: raw.kind, line: line + 1 });
    }
  }

  // loc/bytes are computed size metrics (a token-cost proxy), recomputed every
  // run — hence node fields, not annotations (which are authored and preserved).
  const nodes = sourceFiles.map((sf) => ({
    id: relativeId(rootDir, sf.fileName),
    loc: sf.getLineStarts().length,
    bytes: Buffer.byteLength(sf.text, "utf8"),
  }));
  return {
    graph: buildGraph("file", rootDir, nodes, [...merged.values()]),
    skippedDynamicImports,
  };
}
