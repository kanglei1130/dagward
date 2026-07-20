import ts from "typescript";
import { accumulateEdge, buildGraph, type Graph, type GraphEdge, type GraphNode } from "./graph.js";
import { relativeId, type Project } from "./project.js";

interface Registry {
  // function-like nodes (bodies we walk / attribute calls to) -> id
  fnIds: Map<ts.Node, string>;
  // declarations that symbols resolve to (incl. VariableDeclaration for
  // `const f = () => {}` and ClassDeclaration for `new C()`) -> id
  declIds: Map<ts.Node, string>;
  // every simple name a registered function can be reached by (function,
  // variable, member, and class names) — used to skip type-checker lookups
  // for callees/identifiers that cannot possibly resolve to project code
  names: Set<string>;
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
  const registry: Registry = { fnIds: new Map(), declIds: new Map(), names: new Set(), nodes: [] };
  const seenIds = new Set<string>();

  const register = (
    fnNode: ts.Node,
    decls: ts.Node[],
    id: string,
    names: (string | undefined)[],
    sf: ts.SourceFile,
  ): void => {
    registry.fnIds.set(fnNode, id);
    for (const decl of decls) registry.declIds.set(decl, id);
    for (const name of names) if (name) registry.names.add(name);
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
        if (name) register(node, [node], `${fileId}#${name}`, [name], sf);
      } else if (
        (ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) &&
        node.body
      ) {
        const cls = className(node);
        const member = memberName(node);
        if (cls && member) register(node, [node], `${fileId}#${cls}.${member}`, [member], sf);
      } else if (ts.isConstructorDeclaration(node) && node.body) {
        const cls = className(node);
        // ClassDeclaration mapped too, so `new C()` resolves to the ctor
        if (cls) register(node, [node, node.parent], `${fileId}#${cls}.constructor`, [cls], sf);
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        const name = node.name.text;
        register(node.initializer, [node, node.initializer], `${fileId}#${name}`, [name], sf);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return registry;
}

// Local names bound by import declarations — an aliased import
// (`import { helper as h }`, `import foo from`) reaches a registered
// function under a name the registry doesn't know.
function importedNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const clause = stmt.importClause;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) names.add(el.name.text);
    }
    // namespace imports (`ns.helper()`) resolve through the member name,
    // which is already in registry.names
  }
  return names;
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

// A method call can only reach a registered function through its member
// name; a bare-identifier callee can be a local alias of a project function
// (`const send = a ?? b; send()`) that only getResolvedSignature sees
// through, so it is never name-filtered.
function methodName(expr: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
  return undefined;
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

  // symbol at `expr` -> registered declaration id, following import aliases
  const resolveDeclId = (expr: ts.Node): string | undefined => {
    let symbol = checker.getSymbolAtLocation(expr);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    for (const decl of symbol?.declarations ?? []) {
      const id = registry.declIds.get(decl);
      if (id) return id;
    }
    return undefined; // interface methods, node_modules, dynamic dispatch: no edge
  };

  const resolveTarget = (call: ts.CallExpression | ts.NewExpression): string | undefined => {
    const signatureDecl = checker.getResolvedSignature(call)?.declaration;
    if (signatureDecl) {
      const id = registry.declIds.get(signatureDecl);
      if (id) return id;
    }
    return resolveDeclId(call.expression);
  };

  const addEdge = (
    from: string,
    to: string,
    kind: "call" | "reference",
    sf: ts.SourceFile,
    at: ts.Node,
  ): void => {
    const { line } = sf.getLineAndCharacterOfPosition(at.getStart(sf));
    accumulateEdge(merged, { from, to, kind, line: line + 1 });
  };

  for (const sf of sourceFiles) {
    const fileId = relativeId(rootDir, sf.fileName);
    const consumedCallees = new Set<ts.Node>();
    const localImports = importedNames(sf);
    // checker lookups dominate the cost of `init`; only names that can
    // possibly reach a registered function are worth asking about
    const mayResolve = (name: string): boolean =>
      registry.names.has(name) || localImports.has(name);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        consumedCallees.add(node.expression);
        const member = methodName(node.expression);
        if (member === undefined || mayResolve(member)) {
          const target = resolveTarget(node);
          if (target) addEdge(callerOf(node, fileId), target, "call", sf, node);
        }
      } else if (
        ts.isIdentifier(node) &&
        !consumedCallees.has(node) &&
        mayResolve(node.text) &&
        (node.parent as { name?: ts.Node }).name !== node &&
        !isInImportOrExportClause(node) &&
        !isInTypePosition(node)
      ) {
        // functions passed as values, e.g. arr.map(fn)
        const id = resolveDeclId(node);
        if (id) addEdge(callerOf(node, fileId), id, "reference", sf, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const nodes = [...registry.nodes, ...syntheticModuleNodes.values()];
  return buildGraph("function", rootDir, nodes, [...merged.values()]);
}
