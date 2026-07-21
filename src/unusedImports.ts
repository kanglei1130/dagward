import ts from "typescript";
import { relativeId, type Project } from "./project.js";

export interface UnusedImport {
  file: string;
  line: number;
  specifier: string;
  message: string;
}

// TypeScript's own unused-symbol diagnostics — accurate about JSX, type, and
// namespace uses in a way a hand-rolled scan is not. These fire because
// loadProject sets noUnusedLocals.
const UNUSED_CODES = new Set([
  6133, // 'X' is declared but its value is never read.
  6192, // All imports in import declaration are unused.
  6196, // 'X' is declared but never used.
]);

// The import declaration a diagnostic sits inside, if any — filters out
// unused locals/params, which share code 6133.
function enclosingImport(sf: ts.SourceFile, start: number): ts.ImportDeclaration | undefined {
  let found: ts.ImportDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (start < node.getStart(sf) || start >= node.getEnd()) return;
    if (ts.isImportDeclaration(node)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// Imports with no call, reference, type-use, or JSX use in the file — genuine
// dead code that adds to the token cost of every future read. Side-effect
// imports (`import "./x"`) have no binding and are never flagged.
export function findUnusedImports(project: Project): UnusedImport[] {
  const { program, rootDir, sourceFiles } = project;
  const inProject = new Set(sourceFiles);
  const results: UnusedImport[] = [];

  for (const diag of program.getSemanticDiagnostics()) {
    if (!diag.file || diag.start === undefined || !UNUSED_CODES.has(diag.code)) continue;
    if (!inProject.has(diag.file)) continue;
    const decl = enclosingImport(diag.file, diag.start);
    if (!decl || !ts.isStringLiteralLike(decl.moduleSpecifier)) continue;
    const { line } = diag.file.getLineAndCharacterOfPosition(diag.start);
    results.push({
      file: relativeId(rootDir, diag.file.fileName),
      line: line + 1,
      specifier: decl.moduleSpecifier.text,
      message: ts.flattenDiagnosticMessageText(diag.messageText, " "),
    });
  }

  return results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
