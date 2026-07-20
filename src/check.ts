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
}

// Pure graph queries: consumes Graph data only, never the compiler API.
export function evaluate(rules: RuleSet, graphs: { folders: Graph; files: Graph }): CheckResult {
  const violations: Violation[] = [];
  const layerPatterns = rules.layers.map((layer) => ({
    name: layer.name,
    patterns: layer.match.map(globToRegExp),
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
      for (const edge of graphs.files.edges) {
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
  };
}
