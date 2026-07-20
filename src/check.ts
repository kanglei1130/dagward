import type { Graph } from "./graph.js";
import { globToRegExp } from "./glob.js";
import type { Exemption, RuleSet } from "./rules.js";

export interface Violation {
  rule: string;
  severity: "error";
  message: string;
  edge?: { from: string; to: string; kind: string; line?: number };
  cycle?: string[];
  rationale: string;
  fix?: string;
}

export interface CheckResult {
  violations: Violation[];
  unusedExemptions: Exemption[];
  // patterns that match no node in the graph — almost always a typo or
  // unsupported glob syntax, which would otherwise silently disable a rule
  deadPatterns: { where: string; pattern: string }[];
}

// Pure graph queries: consumes Graph data only, never the compiler API.
export function evaluate(rules: RuleSet, graphs: { folders: Graph; files: Graph }): CheckResult {
  const violations: Violation[] = [];
  const deadPatterns: { where: string; pattern: string }[] = [];
  const fileIds = graphs.files.nodes.map((n) => n.id);
  const noteIfDead = (where: string, pattern: string, re: RegExp): void => {
    if (!fileIds.some((id) => re.test(id))) deadPatterns.push({ where, pattern });
  };

  const layerPatterns = rules.layers.map((layer) => ({
    name: layer.name,
    patterns: layer.match.map((m) => {
      const re = globToRegExp(m);
      noteIfDead(`layer "${layer.name}"`, m, re);
      return re;
    }),
  }));
  const layerOf = (path: string): number =>
    layerPatterns.findIndex((l) => l.patterns.some((p) => p.test(path)));

  for (const rule of rules.rules) {
    if (rule.type === "no-cycles") {
      const graph = rule.level === "folder" ? graphs.folders : graphs.files;
      for (const cycle of graph.cycles) {
        violations.push({
          rule: rule.id,
          severity: "error",
          message: `${rule.level} cycle: ${cycle.nodes.join(" <-> ")}`,
          cycle: cycle.nodes,
          rationale: rule.rationale,
        });
      }
    } else if (rule.type === "layer-order") {
      for (const edge of graphs.files.edges) {
        if (rule.ignoreTypeImports && edge.kind === "type") continue;
        const from = layerOf(edge.from);
        const to = layerOf(edge.to);
        if (from === -1 || to === -1 || to <= from) continue;
        violations.push({
          rule: rule.id,
          severity: "error",
          message:
            `layer "${layerPatterns[from].name}" may not depend on ` +
            `layer "${layerPatterns[to].name}": ${edge.from} -> ${edge.to}`,
          edge: { from: edge.from, to: edge.to, kind: edge.kind, line: edge.line },
          rationale: rule.rationale,
        });
      }
    } else {
      const from = globToRegExp(rule.from);
      const to = globToRegExp(rule.to);
      noteIfDead(`rule "${rule.id}": from`, rule.from, from);
      noteIfDead(`rule "${rule.id}": to`, rule.to, to);
      for (const edge of graphs.files.edges) {
        if (rule.ignoreTypeImports && edge.kind === "type") continue;
        if (!from.test(edge.from) || !to.test(edge.to)) continue;
        violations.push({
          rule: rule.id,
          severity: "error",
          message: `forbidden edge: ${edge.from} -> ${edge.to}`,
          edge: { from: edge.from, to: edge.to, kind: edge.kind, line: edge.line },
          rationale: rule.rationale,
          ...(rule.fix ? { fix: rule.fix } : {}),
        });
      }
    }
  }

  // Exemptions suppress edge-bearing violations; cycles must be fixed or the
  // rule narrowed — an exempted cycle would still poison every member's cone.
  const used = new Set<Exemption>();
  const kept = violations.filter((v) => {
    if (!v.edge) return true;
    const exemption = rules.exemptions.find(
      (ex) =>
        ex.rule === v.rule &&
        globToRegExp(ex.from).test(v.edge!.from) &&
        globToRegExp(ex.to).test(v.edge!.to),
    );
    if (exemption) used.add(exemption);
    return !exemption;
  });

  return {
    violations: kept,
    unusedExemptions: rules.exemptions.filter((ex) => !used.has(ex)),
    deadPatterns,
  };
}
