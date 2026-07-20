import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/project.js";
import { parseRuleSet } from "../src/rules.js";

const VALID = `
version: 1
layers:
  - name: domain
    match: "src/domain/**"
  - name: infra
    match: ["src/infra/**", "src/db/**"]
rules:
  - id: no-cycles
    type: no-cycles
    level: package
    rationale: cycles bad
  - id: layering
    type: layer-order
    ignore-type-imports: true
    rationale: layers flow one way
  - id: no-db-from-domain
    type: forbidden-edge
    from: "src/domain/**"
    to: "src/db/**"
    rationale: domain stays pure
    fix: use the repository layer
exemptions:
  - rule: layering
    from: "src/domain/legacy.ts"
    to: "src/infra/**"
    reason: pre-dates the boundary
`;

describe("parseRuleSet", () => {
  it("parses a full rule file", () => {
    const rs = parseRuleSet(VALID);
    expect(rs.rules).toHaveLength(3);
    expect(rs.rules[0]).toMatchObject({ type: "no-cycles", level: "folder" }); // package aliases folder
    expect(rs.rules[1]).toMatchObject({ type: "layer-order", ignoreTypeImports: true });
    expect(rs.rules[2]).toMatchObject({ type: "forbidden-edge", fix: "use the repository layer" });
    expect(rs.layers[1].match).toEqual(["src/infra/**", "src/db/**"]);
    expect(rs.exemptions[0].reason).toBe("pre-dates the boundary");
  });

  it("rejects an exemption without a reason", () => {
    const bad = VALID.replace("reason: pre-dates the boundary", "");
    expect(() => parseRuleSet(bad)).toThrow(ConfigError);
  });

  it("rejects unknown rule types", () => {
    expect(() =>
      parseRuleSet("version: 1\nrules:\n  - id: x\n    type: wat\n    rationale: r\n"),
    ).toThrow(/unknown type/);
  });

  it("rejects a layer-order rule without layers", () => {
    expect(() =>
      parseRuleSet("version: 1\nrules:\n  - id: l\n    type: layer-order\n    rationale: r\n"),
    ).toThrow(/requires a non-empty `layers` list/);
  });

  it("rejects a missing version", () => {
    expect(() => parseRuleSet("rules: []")).toThrow(/version: 1/);
  });

  it("rejects an exemption referencing an unknown rule", () => {
    const bad = VALID.replace("rule: layering", "rule: nonexistent");
    expect(() => parseRuleSet(bad)).toThrow(/unknown rule/);
  });
});
