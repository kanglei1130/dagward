# Dagward

**Deterministic architecture enforcement for the age of AI coding agents.**

> Your dependency graph should be a DAG. Dagward keeps it one — even when AI agents write the code.

AI agents write undisciplined code that compounds: more abstractions, more context, slower every session. Dagward enforces your rules deterministically and flips the compounding: cleaner structure, smaller context, faster and cheaper every session.

Dagward turns your architecture into something machines must obey:

- **Infer** — Scan your repo, get a draft of your actual module boundaries and dependency rules. Confirm instead of writing from scratch.
- **Enforce** — Every change is checked against the rules: as a Claude Code hook, pre-commit, and in CI. Checks are deterministic graph queries — no AI judging AI.
- **Feed back** — Violations return structured feedback the agent can act on: which rule, why it exists, how to fix. Agents correct themselves; humans stay out of the loop.
- **Exempt with intent** — Real architectures have exceptions. Annotated exemptions are versioned in git and become your team's architecture decision record.

**AI proposes rules. Humans approve them. Machines enforce them.** No line of code's compliance depends on a model's mood.

---

## Quickstart

```bash
# 1. Infer your architecture (read-only, ~1 min on most repos)
npx dagward init

# 2. Review the draft — edit dagward.yml, then commit it
git add dagward.yml && git commit -m "chore: adopt architecture rules"

# 3. Check the whole repo
npx dagward check

# 4. Wire it into Claude Code (one command)
npx dagward install-hook claude-code
```

That's it. From now on, every edit an agent makes is checked against your rules the moment it lands — and violations are fed back to the agent in a format it can act on.

Requirements: Node.js ≥ 20, a TypeScript project with a `tsconfig.json`. Monorepos (npm/pnpm/yarn workspaces) are supported.

## What `init` produces

`dagward init` builds the full dependency graph using the TypeScript compiler API (real module resolution — `paths`, workspace deps, conditional exports), detects strongly connected components and layer structure, and writes two files:

- **`ARCHITECTURE.md`** — a human-readable snapshot of your system as it actually is: layers, module boundaries, existing cycles, and the edges that look accidental. Useful on its own, even if you never adopt the rules.
- **`dagward.yml`** — a draft rule file. Nothing is enforced until you review, edit, and commit it. Confirming is a 10-minute job; writing from scratch would take days.

## Visualize

```bash
npx dagward init && npx dagward viz
```

`dagward viz` renders the graphs in `dagward-out/` to a single self-contained `viz.html` — no network, no CDN, works offline — and opens it in your default browser (`--no-open` to skip). Tabs switch between folder, file, and function level; dependencies point downward, type-only imports are dashed, and cycle members are flagged red.

## The rule file

Rules are declarative YAML — language-agnostic by design, and readable by both humans and agents. MVP supports three rule types:

```yaml
version: 1

layers:                      # topological order: earlier may not depend on later
  - name: domain
    match: "packages/domain/**"
  - name: application
    match: "packages/app/**"
  - name: infrastructure
    match: "packages/infra/**"

rules:
  - id: no-cycles
    type: no-cycles
    level: package           # package | file
    rationale: >
      Cycles between packages cause initialization-order bugs and make
      modules impossible to extract or test in isolation.

  - id: layering
    type: layer-order        # enforces the `layers` list above
    ignore-type-imports: true
    rationale: >
      Domain logic must stay framework-free. Dependencies point inward.

  - id: no-direct-db-from-api
    type: forbidden-edge
    from: "packages/api/**"
    to: "packages/infra/db/**"
    rationale: >
      API handlers go through the repository layer (ADR-012, 2024-06).
      Direct DB access bypassed row-level security once. Never again.
```

`rationale` is not a comment — it is part of the enforcement. When an agent violates a rule, the rationale is included in the feedback, so the agent understands *why* and fixes the code instead of fighting the rule.

Type-only imports (`import type`) are tracked as a separate edge kind and can be exempted per rule — a type-level cycle is not a runtime cycle, and Dagward knows the difference.

## Checking

```bash
dagward check                 # full repo
dagward check --changed       # only files changed since HEAD (fast path for hooks)
dagward check --format agent  # structured JSON for agent consumption
```

Checks are pure graph queries — cycle detection via strongly connected components, layer rules as reachability queries on the condensation. Deterministic, reproducible, milliseconds on the incremental path. No network calls, no LLM, no flakiness.

Exit code `0` = clean, `1` = violations, `2` = config error. That's your CI gate:

```yaml
# .github/workflows/architecture.yml
- run: npx dagward check --format github
```

## Agent feedback

With `--format agent`, a violation looks like this:

```json
{
  "violations": [{
    "rule": "no-direct-db-from-api",
    "severity": "error",
    "edge": {
      "from": "packages/api/src/checkout.ts",
      "to": "packages/infra/db/client.ts",
      "kind": "value-import"
    },
    "rationale": "API handlers go through the repository layer (ADR-012, 2024-06). Direct DB access bypassed row-level security once. Never again.",
    "fix_direction": "Import from packages/app/repositories instead, or add a repository method if none fits.",
    "exemption_hint": "If this dependency is intentional, add an annotated exemption — see docs/exemptions.md."
  }]
}
```

The Claude Code hook feeds this back automatically after each edit. In practice, agents fix their own violations on the next turn without human intervention.

## Annotations

Graph nodes can carry an optional `annotation` object — `summary`, `inputs`, `outputs`, `should`, `shouldNot`, `side` (frontend/backend/shared/tooling), `pure` — written by a human or an AI pass, never by dagward itself. Dagward preserves annotations by node id when regenerating graphs, so `dagward init` can run on every change without losing them. Enforcement remains purely deterministic; annotations are context for humans and agents reading the graph.

## The token economics

Measured on a real 410-file Next.js app (~455k tokens of source):

| What an agent needs | Reading source | Consulting dagward |
|---|---|---|
| The architecture: layers, boundaries, cycles | 50–150k tokens of exploration | `ARCHITECTURE.md`: **~2k tokens** |
| What one file is, does, and must not do | ~1,100 tokens (read it) | its annotation: **~126 tokens** |
| A repo-wide structure audit or refactor plan | the whole repo, 455k+ | graph queries: **~5k tokens** |
| Architecture review of a change | 5–50k (LLM review pass) | `dagward check`: **0 LLM tokens** |

The mechanism is the dependency cone: the context needed to change a file is everything reachable through its imports. Rules keep the cone small (that app's median is 3 files) and acyclic — a cycle makes every member's cone include all members. Annotated boundaries let traversal stop at depth 1: an agent trusts a dependency's 126-token contract instead of descending into its source, collapsing a ~10k-token trace to ~1–2k.

Honest costs: the annotation pass is AI-generated, roughly 1M tokens one-time for a repo that size, amortized across every future session — dagward preserves annotations across regenerations, so maintenance is only the files you move or add. And logic-level work still requires reading code; dagward saves the tokens spent *finding and fencing* it, not the tokens spent editing it.

## Exemptions

Real architectures have exceptions. Unexplained exceptions are how architectures rot — so every exemption requires a reason, and lives in git:

```yaml
exemptions:
  - rule: layering
    from: "packages/domain/src/legacy/pricing.ts"
    to: "packages/infra/feature-flags/**"
    reason: "Pre-dates the flag abstraction. Tracked in TICKET-4102."
    added-by: "@yourname"
    added: 2026-07-19
```

Over time, your exemption log becomes something no wiki ever stays: an accurate, versioned record of every architectural decision and its debt.

## What Dagward is not

- **Not a linter.** Linters check code style within a file. Dagward checks the structure between files — the part no single diff reveals and no agent context window retains.
- **Not an AI reviewer.** Review bots use an LLM to judge LLM output — probabilistic opinions about probabilistic code. Dagward's enforcement is a graph query. Same input, same answer, every time.
- **Not a replacement for CI, tests, or review.** It is one more deterministic gate — the one specifically shaped for the failure mode AI agents actually have.

## Roadmap

- **v0.2 — MCP server**: read-only architecture tools (`check_change`, `query_dependencies`, `explain_rule`) so agents can consult the rules *before* writing code, and interactive rule inference inside your agent session.
- **v0.3 — Cursor hook**, watch mode, richer rule types (public-API surfaces, tag-based boundaries).
- **Later**: Python analyzer (same rule format, pluggable analyzer), team features (exemption approval flow, drift trends).

Multi-language support is a design constraint from day one: the rule format and engine are language-agnostic; only the analyzer is TypeScript-specific.

## Status

Early. Dagward currently guards its own repository and a handful of production monorepos. Expect sharp edges; expect fast fixes. Issues and violation war stories are equally welcome.

## License

Apache-2.0. The `Dagward` name and logo are trademarks of the project and are not covered by the code license.
