# Dagward

**Deterministic architecture enforcement for the age of AI coding agents.**

> Your dependency graph should be a DAG. Dagward keeps it one — even when AI agents write the code.

AI agents write code faster than anyone can review it, and undisciplined structure compounds: more tangles, more context to read, slower every session. Dagward turns your architecture into data that machines can check — deterministic graph queries, no AI judging AI — so structure gets cleaner and every session gets cheaper.

## Quickstart

```bash
npx dagward init   # build the dependency graphs + ARCHITECTURE.md (read-only, ~1 min)
npx dagward viz    # open them as an interactive map in your browser
```

Requirements: Node.js ≥ 20 and a TypeScript project with a `tsconfig.json`.

## What you get

**`dagward init`** analyzes your repo with the TypeScript compiler (real module resolution: `paths`, index files, conditional exports) and writes four files to `dagward-out/`:

- `graph.folders.json`, `graph.files.json`, `graph.functions.json` — your dependency graph at three levels, with cycles detected at each.
- `ARCHITECTURE.md` — a ~2k-token snapshot of the system as it actually is: layers, cycles, hub files, suspicious edges.

**`dagward viz`** renders those graphs to one self-contained `viz.html` (offline, no CDN):

- Layered layout: files nothing depends on at the top, foundations at the bottom, dependencies always pointing down.
- Frontend / shared·pure / backend lanes, folder drill-down (start aggregated, click to expand), search, and per-node detail panels.
- Real cycles in red; type-only imports dashed.

**Annotations.** Any graph node can carry an `annotation`: `summary`, `inputs`, `outputs`, `should`, `shouldNot`, `side`, `pure`. Humans or an AI pass write them; dagward never invents them, but preserves them by node id across every regeneration. They turn each file into a ~126-token contract an agent can obey without reading the source.

## Why: the token economics

Measured on a real 410-file Next.js app (~455k tokens of source):

| An agent needs… | Reading source | Consulting dagward |
|---|---|---|
| the architecture (layers, cycles, boundaries) | 50–150k tokens | **~2k** (`ARCHITECTURE.md`) |
| one file's role and limits | ~1,100 tokens | **~126** (its annotation) |
| a repo-wide structure audit | 455k+ tokens | **~5k** (graph queries) |
| an architecture check of a change | 5–50k (LLM review) | **0** (graph query) |

The mechanism: the context needed to change a file is its *dependency cone* — everything reachable through its imports. Rules keep cones small and acyclic (one cycle makes every member's cone include all members). Annotations let an agent stop at depth 1, trusting a dependency's contract instead of descending into it.

Honest costs: the AI annotation pass is ~1M tokens one-time for a repo that size (then amortized — only moved or new files need re-annotation), and logic-level edits still require reading code. Dagward saves the tokens spent *finding and fencing* code, not editing it.

## Where it's going: enforcement

The rule file format is settled (dagward's own test repo carries one); the `check` command and editor hooks that enforce it are the next milestone. Rules are declarative YAML with three types — and every rule carries a `rationale`, because when an agent violates a rule, the *why* is what makes it fix the design instead of fighting the checker:

```yaml
version: 1

layers:                      # earlier layers may not depend on later ones
  - name: domain
    match: "packages/domain/**"
  - name: infrastructure
    match: "packages/infra/**"

rules:
  - id: no-cycles
    type: no-cycles
    level: package           # package | file
    rationale: Cycles cause init-order bugs and block extraction.

  - id: no-direct-db-from-api
    type: forbidden-edge
    from: "packages/api/**"
    to: "packages/infra/db/**"
    rationale: API handlers go through the repository layer (ADR-012).

exemptions:                  # real architectures have exceptions — in git, with reasons
  - rule: no-direct-db-from-api
    from: "packages/api/src/legacy.ts"
    to: "packages/infra/db/client.ts"
    reason: "Pre-dates the repo layer. Tracked in TICKET-4102."
    added: 2026-07-19
```

Type-only imports are a separate edge kind and exemptable per rule — a type-level cycle is not a runtime cycle. `check` prints one format for everyone — humans, agents, and CI: violations as structured JSON on stdout (rule, edge, rationale, fix), diagnostics on stderr, and the verdict in the exit code — `0` clean, `1` violations, `2` config error. The rationale travels with every violation, so an agent that broke a rule reads *why* it exists and fixes the code instead of fighting it. Planned on top of `check`: `--changed` for fast pre-commit hooks, a Claude Code hook, and an MCP server so agents can consult the rules *before* writing code.

## What Dagward is not

- **Not a linter** — linters check style within a file; dagward checks structure between files, the part no diff shows and no context window retains.
- **Not an AI reviewer** — enforcement is a graph query: same input, same answer, every time.
- **Not a replacement for tests or review** — one more deterministic gate, shaped for the failure mode AI agents actually have.

## Status

Early and moving fast. `init`, `check`, `viz`, and annotation preservation work today and dagward guards its own repo; hooks and MCP are in progress. The rule format and graph engine are language-agnostic; only the analyzer is TypeScript-specific, with Python planned.

## License

Apache-2.0. The `Dagward` name and logo are trademarks of the project and are not covered by the code license.
