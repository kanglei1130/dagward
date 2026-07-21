# 20-task scale-up — control vs v2 vs v3 (effective N=12)

Requested: run 20 TS tasks, compare control / v2 (graph queried) / v3 (graph +
annotations). 8 of 20 excluded (install failures or monorepo layouts dagward
init couldn't resolve); **effective N=12** repos, 3 arms each = 36 agentic
solves, Claude as the agent, native Docker-free verifier. Raw per-solve data in
`n12-tokens.tsv`. Total cost: 4.33M agent tokens.

## Agent tokens (k) per repo, sorted by repo size

| repo | files | ctrl | v2 Δ | v3 Δ |
|---|---|---|---|---|
| ofetch | 9 | 81.9 | −7% | −13% |
| superjson | 12 | 88.8 | −6% | +13% |
| ts-pattern | 18 | 75.3 | −7% | −25% |
| true-myth | 19 | 138.4 | +17% | −17% |
| awilix | 28 | 101.3 | +5% | +16% |
| kea | 36 | 110.9 | +5% | +20% |
| clack | 68 | 112.5 | +1% | −10% |
| quill | 119 | 138.4 | −5% | +1% |
| sql-formatter | 166 | 126.1 | +1% | +10% |
| meriyah | 167 | 154.7 | +25% | +17% |
| obsidian-linter | 206 | 111.6 | +2% | −3% |
| dynamodb-toolbox | 697 | 192.4 | −11% | −10% |

## Aggregate (N=12)

| | Tokens (total) | Tokens (mean per-task Δ) | Saved on | Wall-clock |
|---|---|---|---|---|
| v2 (graph) | +2.2% | +1.6% | 5/12 | +18.6% |
| v3 (annotations) | +0.3% | **0.0%** | 6/12 | +11.7% |

## Findings

1. **Full-solve token-neutral, confirmed at scale.** Both arms land within noise
   of control (v2 +2.2%, v3 +0.0% mean). Adding annotations did not help in
   aggregate. dagward does **not** reliably reduce an agent's tokens to *solve* a
   task.
2. **The sign is unpredictable — variance dominates.** Per-task deltas span −25%
   to +25%. Correlation of token delta with repo size ≈ 0 (v2 0.02, v3 0.13).
   The small-N (N=3) "blast radius predicts savings" pattern **did not survive** —
   at N=12 the outcome is governed by per-agent behavior (how much source each
   agent chose to read, how thorough its verification), not by task structure.
3. **Both arms are slightly *slower*** (v2 +19%, v3 +12% wall-clock) — the cost
   of consulting the graph/contracts + running the cycle-gate.
4. **The real, guaranteed win is elsewhere (LAYER2.md):** as a deterministic
   property of the artifacts, dagward compresses context-gathering 17–200×. That
   saving is not reliably *realized* by a free-form agent in a full solve — the
   compressible slice is small, and agents read source anyway "to be safe".

## Caveat

Behavioral pass/fail (reward) and structural deltas were **not** aggregated here:
several repos' test runners (Playwright for quill, jest for kea/sql-formatter,
rollup for meriyah) can't run in this sandbox, and the question of interest was
token/time. The verifier is validated (golden solution → reward=1) and available
per-repo where the toolchain runs.

## Bottom line

Across 12 real TS repos, **dagward is token- and time-neutral-to-slightly-negative
for agentic full solves**, with no predictable task-type where it wins. Its
measurable value is the deterministic context-compression (Layer-2), which a
constrained agent must be *forced* to exploit (trust contracts, don't re-read
source) — free-form agents leave it on the table.
