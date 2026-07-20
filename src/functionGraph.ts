import ts from "typescript";
import { buildGraph, type Graph, type GraphEdge, type GraphNode } from "./graph.js";
import { relativeId, type Project } from "./project.js";

interface Registry {
  // function-like nodes (bodies we walk / attribute calls to) -> id
  fnIds: Map<ts.Node, string>;
  // declarations that symbols resolve to (incl. VariableDeclaration for
  // `const f = () => {}` and ClassDeclaration for `new C()`) -> id
  declIds: Map<ts.Node, string>;
  nodes: GraphNode[];
}

function className(node: ts.ClassElement): string | undefined {
  const parent = node.parent;
  if (ts.isClassDeclaration(parent) && parent.name) return parent.name.text;
  return undefined; // class expressions: skipped
}

function memberName(node: ts.MethodDeclaration | ts.AccessorDeclaration): string | undefined {
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return undefined; // computed names: skipped
}

function collectFunctions(sourceFiles: ts.SourceFile[], rootDir: string): Registry {
  const registry: Registry = { fnIds: new Map(), declIds: new Map(), nodes: [] };
  const seenIds = new Set<string>();

  const register = (fnNode: ts.Node, decls: ts.Node[], id: string, sf: ts.SourceFile): void => {
    registry.fnIds.set(fnNode, id);
    for (const decl of decls) registry.declIds.set(decl, id);
    if (!seenIds.has(id)) {
      seenIds.add(id);
      const file = relativeId(rootDir, sf.fileName);
      const { line } = sf.getLineAndCharacterOfPosition(fnNode.getStart(sf));
      registry.nodes.push({ id, file, line: line + 1 });
    }
  };

  for (const sf of sourceFiles) {
    const fileId = relativeId(rootDir, sf.fileName);
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.body) {
        const name =
          node.name?.text ??
          (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
            ? "default"
            : undefined);
        if (name) register(node, [node], `${fileId}#${name}`, sf);
      } else if (ts.isMethodDeclaration(node) && node.body) {
        const cls = className(node);
        const member = memberName(node);
        if (cls && member) register(node, [node], `${fileId}#${cls}.${member}`, sf);
      } else if ((ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.body) {
        const cls = className(node);
        const member = memberName(node);
        if (cls && member) register(node, [node], `${fileId}#${cls}.${member}`, sf);
      } else if (ts.isConstructorDeclaration(node) && node.body) {
        const cls = className(node);
        // ClassDeclaration mapped too, so `new C()` resolves to the ctor
        if (cls) register(node, [node, node.parent], `${fileId}#${cls}.constructor`, sf);
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        register(node.initializer, [node, node.initializer], `${fileId}#${node.name.text}`, sf);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return registry;
}

function isInImportOrExportClause(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent)
  );
}

// `: Greeter`, `typeof f`, `extends Base` are not function references
function isInTypePosition(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isTypeReferenceNode(parent) ||
    ts.isTypeQueryNode(parent) ||
    ts.isExpressionWithTypeArguments(parent) ||
    ts.isQualifiedName(parent)
  );
}

export function buildFunctionGraph(project: Project): Graph {
  const { checker, rootDir, sourceFiles } = project;
  const registry = collectFunctions(sourceFiles, rootDir);
  const merged = new Map<string, GraphEdge>();
  const syntheticModuleNodes = new Map<string, GraphNode>();

  const callerOf = (node: ts.Node, fileId: string): string => {
    for (let current = node.parent; current; current = current.parent) {
      const id = registry.fnIds.get(current);
      if (id) return id;
    }
    const moduleId = `${fileId}#<module>`;
    if (!syntheticModuleNodes.has(moduleId)) {
      syntheticModuleNodes.set(moduleId, { id: moduleId, file: fileId, line: 1 });
    }
    return moduleId;
  };

  const resolveTarget = (call: ts.CallExpression | ts.NewExpression): string | undefined => {
    const signatureDecl = checker.getResolvedSignature(call)?.declaration;
    if (signatureDecl) {
      const id = registry.declIds.get(signatureDecl);
      if (id) return id;
    }
    let symbol = checker.getSymbolAtLocation(call.expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    for (const decl of symbol?.declarations ?? []) {
      const id = registry.declIds.get(decl);
      if (id) return id;
    }
    return undefined; // interface methods, node_modules, dynamic dispatch: no edge
  };

  const addEdge = (
    from: string,
    to: string,
    kind: "call" | "reference",
    sf: ts.SourceFile,
    at: ts.Node,
  ): void => {
    const key = `${from} ${to} ${kind}`;
    const existing = merged.get(key);
    if (existing) {
      existing.weight++;
    } else {
      const { line } = sf.getLineAndCharacterOfPosition(at.getStart(sf));
      merged.set(key, { from, to, kind, weight: 1, line: line + 1 });
    }
  };

  for (const sf of sourceFiles) {
    const fileId = relativeId(rootDir, sf.fileName);
    const consumedCallees = new Set<ts.Node>();

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        consumedCallees.add(node.expression);
        const target = resolveTarget(node);
        if (target) addEdge(callerOf(node, fileId), target, "call", sf, node);
      } else if (
        ts.isIdentifier(node) &&
        !consumedCallees.has(node) &&
        (node.parent as { name?: ts.Node }).name !== node &&
        !isInImportOrExportClause(node) &&
        !isInTypePosition(node)
      ) {
        // functions passed as values, e.g. arr.map(fn)
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
          symbol = checker.getAliasedSymbol(symbol);
        }
        for (const decl of symbol?.declarations ?? []) {
          const id = registry.declIds.get(decl);
          if (id) {
            addEdge(callerOf(node, fileId), id, "reference", sf, node);
            break;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const nodes = [...registry.nodes, ...syntheticModuleNodes.values()];
  return buildGraph("function", rootDir, nodes, [...merged.values()]);
}
