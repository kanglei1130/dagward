import fs from "node:fs";
import { parse } from "yaml";
import { ConfigError } from "./project.js";

export type RuleLevel = "folder" | "file";

export interface LayerDef {
  name: string;
  match: string[];
}

export type Rule =
  | { id: string; type: "no-cycles"; level: RuleLevel; rationale: string }
  | { id: string; type: "layer-order"; ignoreTypeImports: boolean; rationale: string }
  | { id: string; type: "forbidden-edge"; from: string; to: string; rationale: string; fix?: string };

export interface Exemption {
  rule: string;
  from: string;
  to: string;
  reason: string;
}

export interface RuleSet {
  layers: LayerDef[];
  rules: Rule[];
  exemptions: Exemption[];
}

function fail(message: string): never {
  throw new ConfigError(message);
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${what} must be a non-empty string`);
  return value.trim();
}

// `match` accepts a single glob or a list of globs.
function toMatchList(value: unknown, what: string): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string") && value.length > 0) {
    return value as string[];
  }
  fail(`${what} must be a glob string or a list of glob strings`);
}

function parseRule(raw: Record<string, unknown>, index: number): Rule {
  const id = requireString(raw.id, `rules[${index}].id`);
  const rationale = requireString(raw.rationale, `rule "${id}": rationale`);
  switch (raw.type) {
    case "no-cycles": {
      const level = raw.level === "package" ? "folder" : raw.level;
      if (level !== "folder" && level !== "file") {
        fail(`rule "${id}": level must be "folder", "package", or "file"`);
      }
      return { id, type: "no-cycles", level, rationale };
    }
    case "layer-order":
      return {
        id,
        type: "layer-order",
        ignoreTypeImports: raw["ignore-type-imports"] === true,
        rationale,
      };
    case "forbidden-edge": {
      const rule: Rule = {
        id,
        type: "forbidden-edge",
        from: requireString(raw.from, `rule "${id}": from`),
        to: requireString(raw.to, `rule "${id}": to`),
        rationale,
      };
      if (raw.fix !== undefined) rule.fix = requireString(raw.fix, `rule "${id}": fix`);
      return rule;
    }
    default:
      fail(`rule "${id}": unknown type "${String(raw.type)}"`);
  }
}

export function parseRuleSet(yamlText: string): RuleSet {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch (error) {
    fail(`dagward.yml is not valid YAML: ${(error as Error).message}`);
  }
  if (typeof doc !== "object" || doc === null) fail("dagward.yml must be a YAML mapping");
  const root = doc as Record<string, unknown>;
  if (root.version !== 1) fail('dagward.yml must declare `version: 1`');

  const layers = ((root.layers as unknown[]) ?? []).map((raw, i) => {
    const layer = raw as Record<string, unknown>;
    return {
      name: requireString(layer.name, `layers[${i}].name`),
      match: toMatchList(layer.match, `layers[${i}].match`),
    };
  });

  if (!Array.isArray(root.rules) || root.rules.length === 0) {
    fail("dagward.yml must contain a non-empty `rules` list");
  }
  const rules = root.rules.map((raw, i) => parseRule(raw as Record<string, unknown>, i));

  const usesLayers = rules.some((r) => r.type === "layer-order");
  if (usesLayers && layers.length === 0) {
    fail("a layer-order rule requires a non-empty `layers` list");
  }

  const ruleIds = new Set(rules.map((r) => r.id));
  const exemptions = ((root.exemptions as unknown[]) ?? []).map((raw, i) => {
    const ex = raw as Record<string, unknown>;
    const rule = requireString(ex.rule, `exemptions[${i}].rule`);
    if (!ruleIds.has(rule)) fail(`exemptions[${i}] references unknown rule "${rule}"`);
    return {
      rule,
      from: typeof ex.from === "string" ? ex.from : "**",
      to: typeof ex.to === "string" ? ex.to : "**",
      reason: requireString(ex.reason, `exemptions[${i}].reason (every exemption needs one)`),
    };
  });

  return { layers, rules, exemptions };
}

export function loadRuleSet(file: string): RuleSet {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    fail(`No dagward.yml found at ${file}. Run \`dagward init\` and edit the draft it writes.`);
  }
  return parseRuleSet(text);
}
