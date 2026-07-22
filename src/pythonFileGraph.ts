import fs from "node:fs";
import path from "node:path";
import { accumulateEdge, buildGraph, type EdgeKind, type GraphEdge } from "./graph.js";
import type { FileGraphResult } from "./fileGraph.js";

// Python file graph: nodes = .py files, edges = resolved intra-project imports.
// Dependency-free — a small logical-line scanner extracts import statements and
// a filesystem resolver maps them to project files. File graph only; Python is
// dynamically typed, so a function/call graph would be low-fidelity (see README).

const SKIP_DIRS = new Set([
  "__pycache__", "node_modules", "build", "dist", ".tox", ".mypy_cache",
  ".pytest_cache", ".eggs", "site-packages", ".venv", "venv", "env",
]);

function leadingWs(s: string): number {
  let k = 0;
  while (k < s.length && (s[k] === " " || s[k] === "\t")) k++;
  return k;
}

interface LogicalLine {
  text: string;
  line: number;
  indent: number;
}

// Collapse a Python source into logical lines: comments stripped, string
// literals kept intact, bracket/backslash continuations joined. Indent is read
// from the physical line where the logical line starts (used for scoping only).
function logicalLines(source: string): LogicalLine[] {
  const phys = source.split("\n");
  const lines: LogicalLine[] = [];
  let buf = "";
  let start = -1;
  let bracket = 0;
  let i = 0;
  let line = 1;
  let quote = "";
  let triple = false;
  const n = source.length;
  const push = (): void => {
    const t = buf.trim();
    if (t) lines.push({ text: t, line: start, indent: leadingWs(phys[start - 1] ?? "") });
    buf = "";
    start = -1;
  };

  while (i < n) {
    const ch = source[i];
    const c2 = source[i + 1];
    const c3 = source[i + 2];
    if (quote) {
      buf += ch;
      if (!triple && ch === "\\") { buf += c2 ?? ""; i += 2; continue; }
      if (triple && ch === quote && c2 === quote && c3 === quote) {
        buf += quote + quote; i += 3; quote = ""; triple = false; continue;
      }
      if (!triple && ch === quote) { quote = ""; i++; continue; }
      if (ch === "\n") { line++; if (!triple) quote = ""; }
      i++; continue;
    }
    if (ch === "#") { while (i < n && source[i] !== "\n") i++; continue; }
    if (ch === '"' || ch === "'") {
      if (start < 0) start = line;
      if (c2 === ch && c3 === ch) { triple = true; quote = ch; buf += ch + ch + ch; i += 3; continue; }
      quote = ch; buf += ch; i++; continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") { if (start < 0) start = line; bracket++; buf += ch; i++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { if (bracket > 0) bracket--; buf += ch; i++; continue; }
    if (ch === "\\" && c2 === "\n") { line++; i += 2; continue; }
    if (ch === "\n") { line++; if (bracket > 0) { buf += " "; i++; continue; } push(); i++; continue; }
    if (ch !== " " && ch !== "\t" && start < 0) start = line;
    buf += ch; i++;
  }
  push();
  return lines;
}

interface ImportRef {
  from: boolean; // true = `from X import ...`, false = `import X`
  module: string; // dotted path, may be "" for `from . import x`
  names: string[]; // imported names (from-imports only)
  level: number; // number of leading dots (relative import depth)
  kind: EdgeKind;
  line: number;
}

function names(blob: string): string[] {
  return blob
    .replace(/^\(/, "").replace(/\)$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+as\s+/)[0].trim());
}

// Parse the import statements out of one file, plus a count of dynamic imports
// whose target is not a string literal (unresolvable, like TS's skippedDynamic).
export function extractImports(source: string): { refs: ImportRef[]; skippedDynamic: number } {
  const refs: ImportRef[] = [];
  let skippedDynamic = 0;
  const tc: number[] = []; // indents of open `if TYPE_CHECKING:` blocks

  for (const ll of logicalLines(source)) {
    while (tc.length > 0 && ll.indent <= tc[tc.length - 1]) tc.pop();
    const kind: EdgeKind = tc.length > 0 ? "type" : "value";

    if (/^if\s+(?:[\w.]+\.)?TYPE_CHECKING\s*:/.test(ll.text)) { tc.push(ll.indent); continue; }

    const fm = /^from\s+(\.*)([\w.]*)\s+import\s+(.+)$/.exec(ll.text);
    if (fm) {
      refs.push({ from: true, module: fm[2], names: names(fm[3]), level: fm[1].length, kind, line: ll.line });
      continue;
    }
    const im = /^import\s+(.+)$/.exec(ll.text);
    if (im) {
      for (const part of im[1].split(",")) {
        const mod = part.trim().split(/\s+as\s+/)[0].trim();
        if (/^[\w.]+$/.test(mod)) refs.push({ from: false, module: mod, names: [], level: 0, kind, line: ll.line });
      }
      continue;
    }
    for (const d of ll.text.matchAll(/(?:importlib\.import_module|__import__)\s*\(\s*([^)]*)/g)) {
      const lit = /^(['"])([\w.]+)\1/.exec(d[1].trim());
      if (lit) refs.push({ from: false, module: lit[2], names: [], level: 0, kind: "dynamic", line: ll.line });
      else skippedDynamic++;
    }
  }
  return { refs, skippedDynamic };
}

function walkDir(dir: string, root: string, out: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
      walkDir(path.join(dir, ent.name), root, out);
    } else if (ent.isFile() && ent.name.endsWith(".py")) {
      out.push(path.relative(root, path.join(dir, ent.name)).split(path.sep).join("/"));
    }
  }
}

export function discoverPyFiles(root: string): string[] {
  const out: string[] = [];
  walkDir(root, root, out);
  return out;
}

// True if the tree contains at least one .py file (cheap-ish; used for language
// detection). Not early-exiting, but detection only runs once per invocation.
export function hasPyFiles(root: string): boolean {
  return discoverPyFiles(root).length > 0;
}

// A file's fully-qualified module keys for absolute-import lookup. Two schemes,
// so both flat (`pkg/` at repo root) and src (`src/pkg/`) layouts resolve:
//   1. repo-root dotted path
//   2. source-root dotted path (climb while ancestors have __init__.py)
function fqnKeys(id: string, initDirs: Set<string>): string[] {
  const noext = id.replace(/\.py$/, "");
  const parts = noext.split("/");
  const isInit = parts[parts.length - 1] === "__init__";
  const keys: string[] = [];
  const rootParts = isInit ? parts.slice(0, -1) : parts;
  if (rootParts.length > 0) keys.push(rootParts.join("."));

  const dir = id.split("/").slice(0, -1);
  let i = dir.length;
  while (i > 0 && initDirs.has(dir.slice(0, i).join("/"))) i--;
  const pkgParts = dir.slice(i);
  const srcParts = isInit ? pkgParts : [...pkgParts, parts[parts.length - 1]];
  if (srcParts.length > 0) keys.push(srcParts.join("."));
  return [...new Set(keys)];
}

interface ResolveCtx {
  fileSet: Set<string>;
  fqnToFile: Map<string, string>;
}

function resolveRef(
  from: string,
  ref: ImportRef,
  ctx: ResolveCtx,
  add: (to: string, kind: EdgeKind, line: number) => void,
): void {
  if (ref.level === 0) {
    const base = ctx.fqnToFile.get(ref.module);
    if (base) add(base, ref.kind, ref.line);
    if (ref.from) {
      for (const name of ref.names) {
        if (name === "*") continue;
        const sub = ctx.fqnToFile.get(`${ref.module}.${name}`);
        if (sub) add(sub, ref.kind, ref.line);
      }
    }
    return;
  }
  // Relative import: resolve by directory arithmetic against the file's own path.
  const dir = from.split("/").slice(0, -1);
  const baseDir = dir.slice(0, Math.max(0, dir.length - (ref.level - 1)));
  const targetDir = [...baseDir, ...(ref.module ? ref.module.split(".") : [])];
  const resolve = (segs: string[]): string | undefined => {
    const asMod = `${segs.join("/")}.py`;
    if (ctx.fileSet.has(asMod)) return asMod;
    const asPkg = `${[...segs, "__init__"].join("/")}.py`;
    return ctx.fileSet.has(asPkg) ? asPkg : undefined;
  };
  const base = resolve(targetDir);
  if (base) add(base, ref.kind, ref.line);
  for (const name of ref.names) {
    if (name === "*") continue;
    const sub = resolve([...targetDir, name]);
    if (sub) add(sub, ref.kind, ref.line);
  }
}

export function buildPythonFileGraph(root: string): FileGraphResult {
  const files = discoverPyFiles(root);
  const fileSet = new Set(files);
  const initDirs = new Set<string>();
  for (const id of files) {
    if (id.endsWith("__init__.py")) initDirs.add(id.split("/").slice(0, -1).join("/"));
  }

  const fqnToFile = new Map<string, string>();
  for (const id of files) {
    for (const key of fqnKeys(id, initDirs)) {
      if (!fqnToFile.has(key)) fqnToFile.set(key, id); // first writer wins → deterministic
    }
  }

  const merged = new Map<string, GraphEdge>();
  let skippedDynamicImports = 0;
  const ctx: ResolveCtx = { fileSet, fqnToFile };
  for (const from of files) {
    const { refs, skippedDynamic } = extractImports(fs.readFileSync(path.join(root, from), "utf8"));
    skippedDynamicImports += skippedDynamic;
    for (const ref of refs) {
      resolveRef(from, ref, ctx, (to, kind, line) => {
        if (to !== from) accumulateEdge(merged, { from, to, kind, line });
      });
    }
  }

  const nodes = files.map((id) => ({ id }));
  return { graph: buildGraph("file", root, nodes, [...merged.values()]), skippedDynamicImports };
}
