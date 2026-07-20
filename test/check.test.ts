import { describe, expect, it } from "vitest";
import { evaluate } from "../src/check.js";
import type { Graph } from "../src/graph.js";
import type { RuleSet } from "../src/rules.js";

function graph(level: Graph["level"], overrides: Partial<Graph> = {}): Graph {
  return { version: 1, level, root: "/repo", nodes: [], edges: [], cycles: [], ...overrides };
}

function ruleSet(overrides: Partial<RuleSet> = {}): RuleSet {
  return { layers: [], rules: [], exemptions: [], ...overrides };
}

const CYCLIC_FILES = graph("file", {
  nodes: [{ id: "a.ts" }, { id: "b.ts" }],
  edges: [
    { from: "a.ts", to: "b.ts", kind: "value", weight: 1, line: 1 },
    { from: "b.ts", to: "a.ts", kind: "value", weight: 1, line: 2 },
  ],
  cycles: [{ id: 0, nodes: ["a.ts", "b.ts"] }],
});

describe("evaluate", () => {
  it("reports one violation per cycle at the configured level", () => {
    const { violations } = evaluate(
      ruleSet({ rules: [{ id: "nc", type: "no-cycles", level: "file", rationale: "r" }] }),
      { folders: graph("folder"), files: CYCLIC_FILES },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "nc", cycle: ["a.ts", "b.ts"] });
  });

  it("reports layer-order violations with the exact edge, skipping type imports when configured", () => {
    const files = graph("file", {
      edges: [
        { from: "src/domain/d.ts", to: "src/infra/i.ts", kind: "value", weight: 1, line: 3 },
        { from: "src/domain/d.ts", to: "src/infra/t.ts", kind: "type", weight: 1, line: 4 },
        { from: "src/infra/i.ts", to: "src/domain/d.ts", kind: "value", weight: 1, line: 5 },
      ],
    });
    const { violations } = evaluate(
      ruleSet({
        layers: [
          { name: "domain", match: ["src/domain/**"] },
          { name: "infra", match: ["src/infra/**"] },
        ],
        rules: [{ id: "lay", type: "layer-order", ignoreTypeImports: true, rationale: "r" }],
      }),
      { folders: graph("folder"), files },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].edge).toMatchObject({ from: "src/domain/d.ts", line: 3 });
  });

  it("reports forbidden edges and echoes the fix", () => {
    const files = graph("file", {
      edges: [{ from: "src/api/a.ts", to: "src/db/c.ts", kind: "value", weight: 1 }],
    });
    const { violations } = evaluate(
      ruleSet({
        rules: [
          { id: "fb", type: "forbidden-edge", from: "src/api/**", to: "src/db/**", rationale: "r", fix: "go via repo" },
        ],
      }),
      { folders: graph("folder"), files },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].fix).toBe("go via repo");
  });

  it("exemptions suppress exactly their edge and report unused ones", () => {
    const files = graph("file", {
      edges: [
        { from: "src/api/a.ts", to: "src/db/c.ts", kind: "value", weight: 1 },
        { from: "src/api/b.ts", to: "src/db/c.ts", kind: "value", weight: 1 },
      ],
    });
    const { violations, unusedExemptions } = evaluate(
      ruleSet({
        rules: [
          { id: "fb", type: "forbidden-edge", from: "src/api/**", to: "src/db/**", rationale: "r" },
        ],
        exemptions: [
          { rule: "fb", from: "src/api/a.ts", to: "**", reason: "legacy" },
          { rule: "fb", from: "src/api/never.ts", to: "**", reason: "stale" },
        ],
      }),
      { folders: graph("folder"), files },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].edge?.from).toBe("src/api/b.ts");
    expect(unusedExemptions).toHaveLength(1);
    expect(unusedExemptions[0].reason).toBe("stale");
  });

  it("exemptions never suppress cycle violations", () => {
    const { violations } = evaluate(
      ruleSet({
        rules: [{ id: "nc", type: "no-cycles", level: "file", rationale: "r" }],
        exemptions: [{ rule: "nc", from: "**", to: "**", reason: "nice try" }],
      }),
      { folders: graph("folder"), files: CYCLIC_FILES },
    );
    expect(violations).toHaveLength(1);
  });
});
