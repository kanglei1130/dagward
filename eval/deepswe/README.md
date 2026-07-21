# DeepSWE × dagward — TS trial runbook

A differential (± dagward) trial on the TypeScript subset of the
[DeepSWE benchmark](https://github.com/datacurve-ai/deep-swe), using **Claude
only** as the agent model. This directory holds the harness; the benchmark
itself is cloned separately.

## Why this benchmark

- **Has TypeScript** — dagward runs on TS today, no adapter needed. TS is the
  largest subset: **35 of 117 tasks**.
- **Multi-file, long-horizon, from-scratch tasks** (not scraped PRs) — dagward's
  sweet spot, and low training-data contamination.
- **Behavioral verifier** — DeepSWE scores observable behavior only, *not*
  structure. So pass/fail is our guardrail and dagward's structural delta is a
  separate, orthogonal metric. That separation is what makes it a clean eval.

## What we measure

Same agent (Claude), same tasks, the only changed variable is dagward.

| Metric | How | Role |
|---|---|---|
| Structural delta | `score.mjs` on dagward graph before vs after each patch | **primary** — cycles introduced, cone growth, edge growth |
| Efficiency | Pier trajectory logs | tokens, tool calls, wall-clock |
| Resolution | DeepSWE `reward.json` | **guardrail** — pass-rate must not regress |

## Trial scope

3 TS tasks, Claude only. Baselines already captured in `baselines.json`:

- `ts-pattern-match-each` — add a `matchEach` matcher parallel to `match`
- `superjson-error-stack-serialization` — new option threaded through transformer/plainer/index
- `awilix-async-container-initialization` — dependency-aware async init in the DI container

## Prerequisites

- **Docker** (each task builds an isolated container; `task.toml` pins the image
  and sets `allow_internet=false`). Not available in the authoring sandbox — run
  on a Docker host, or use Pier's `--env modal`.
- **Pier** ≥ 0.3.0: `uv tool install datacurve-pier`
- **Claude API key** for the agent.

## Run

```bash
# 0. get the benchmark
git clone https://github.com/datacurve-ai/deep-swe && cd deep-swe

# 1. CONTROL arm — Claude, no dagward, the 3 trial tasks
for t in ts-pattern-match-each superjson-error-stack-serialization awilix-async-container-initialization; do
  pier run -p tasks/$t --agent mini-swe-agent --model anthropic/claude-opus-4-8
done

# 2. TREATMENT arm — same, with dagward context injected (see "dagward arm" below)
#    2a: prepend precomputed ARCHITECTURE.md + relevant annotations to the prompt
#    2b: expose dagward context API + `check` as an MCP tool + post-gen check-gate retry

# 3. SCORE — structural delta per task, per arm
#    Apply the arm's model.patch onto the base commit, run `dagward init`, then:
node score.mjs before/graph.files.json after/graph.files.json
```

Run multiple trials per task (agent runs are stochastic) and report confidence
intervals — with only 3 tasks the trial is **directional**, a smoke test of the
pipeline, not a headline number.

## dagward arm (treatment) — how dagward enters the loop

- **2a static (cheap):** run `dagward init` on the repo at base commit; prepend a
  compact context block (`ARCHITECTURE.md` + annotations for files in the task's
  blast radius) to `instruction.md`.
- **2b interactive (the real thesis):** register dagward's context API + `check`
  as an MCP server (`mcp_servers` in `task.toml`) so the agent queries structure
  on demand, and add a post-generation gate: run `dagward check`, feed any new
  cycle / boundary violation back, let the agent self-correct.

## Scoring notes

- `score.mjs` compares two `graph.files.json` files and reports deltas in files,
  import edges, file cycles, and dependency-cone size (mean/median/max).
- `introducedCycle: true` is the headline red flag — the patch added a cycle the
  baseline didn't have.
- These OSS repos carry no authored `dagward.yml` rules or annotations, so the
  structural metric uses only intrinsic graph facts (cycles, cones, coupling) —
  no per-repo authoring required. Boundary/`shouldNot` metrics would need rules.
- To avoid dagward-as-its-own-oracle circularity, pair the delta with one
  independent coupling metric and human review on a sample.

## Docker-free / no-API-key variant (what this trial actually runs)

Docker and a paid API key both turned out to be optional:

- **No Docker:** `grader.py` is env-path-overridable ("for testing/replays"),
  so `run-verifier.sh` reconstructs the container paths (`/app`, `/tests`,
  `/logs`, out-of-tree `/opt/jest-ctrf`) on the host and runs the *unmodified*
  official `tests/test.sh` → `grader.py`. Only the environment is
  reconstructed, not the grading logic. **Validated:** the ts-pattern golden
  solution scores `reward=1` (85/85 f2p, 6/6 p2p) through this path.
- **No API key:** the Claude Code session itself is the agent — one subagent
  solves each task in its own repo copy (control arm, no dagward), sandboxed so
  it can't see `solution/` or the held-out tests.

Tooling the native verifiers need (all installed): `jest-ctrf-json-reporter`
+ `jest-environment-node` under `/opt/jest-ctrf` (ts-pattern, awilix),
`junit-to-ctrf` global + vitest (superjson), python3. awilix also gates on
`npm run build`.

Scripts: `run-verifier.sh` (core native verifier), `verify-task.sh`
(orchestrates patch-extract + isolated verify + dagward delta per task).

## Status

- [x] TS subset inventoried (35 tasks)
- [x] 3 trial tasks selected + baselines captured (`baselines.json`)
- [x] structural scorer built + validated (`score.mjs`)
- [x] native Docker-free verifier built + validated on golden solution
- [x] control-arm agents dispatched (Claude session as agent)
- [ ] per-task verifier + structural/efficiency deltas (pending agent solves)
