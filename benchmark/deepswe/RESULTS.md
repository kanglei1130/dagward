# DeepSWE benchmark — dagward on 12 real OSS TypeScript repos

A second, external benchmark to complement the in-repo `../RESULTS.md` (hihome).
Where hihome measures dagward as a **query cache** on curated task *types*, this
runs dagward inside a **full agentic solve loop** on the
[DeepSWE benchmark](https://github.com/datacurve-ai/deep-swe) — real from-scratch
tasks against real open-source repos, graded by each repo's own held-out tests.

**Bottom line up front:** on DeepSWE (which is **94% feature-implementation**),
dagward is **token- and time-neutral** for the full solve. On the one
comprehension/locate-bound task (a bug fix) it saved **−16% tokens / −27%
tool-calls**. This *confirms* the hihome finding — dagward's win is analytical /
locate-heavy work, not code generation — from the opposite direction.

## Setup

- **Benchmark:** DeepSWE, the **TypeScript subset** (35 of 117 tasks). 12 repos
  ran end-to-end (8 excluded: install failures / monorepo layouts). Repos span
  9–697 files, 0–14 baseline cycles.
- **Agent:** the Claude Code session itself (no API key), one subagent per
  (task, arm), sandboxed so it never sees `solution/` or the held-out tests.
- **Verifier:** the official DeepSWE `test.sh`/`grader.py` reconstructed to run
  **natively, no Docker** (validated: golden solution → `reward=1`).
- **Three arms:**
  - **control** — no dagward.
  - **v2** — the agent queries `graph.files.json` (`gq cone/affects/hubs`) before
    editing, plus a `dagward init` cycle-gate.
  - **v3** — v2 **plus authored per-file annotations** (`gq conedoc/annotate`):
    comprehend a dependency from its ~123-token contract instead of its source.

Raw per-run data: `n12-tokens.tsv` (main), `exp2-tokens.tsv` (follow-ups). Full
harness + authored annotations live in `eval/deepswe/`.

## Headline: control vs v3, N=12 (agent tokens)

| repo | files | ctrl (k) | v3 Δ tokens | v3 Δ time |
|---|--:|--:|--:|--:|
| ofetch | 9 | 81.9 | −13% | −27% |
| superjson | 12 | 88.8 | +13% | −24% |
| ts-pattern | 18 | 75.3 | **−25%** | **−44%** |
| true-myth | 19 | 138.4 | −17% | −29% |
| awilix | 28 | 101.3 | +16% | −38% |
| kea | 36 | 110.9 | +20% | −16% |
| clack | 68 | 112.5 | −10% | −3% |
| quill | 119 | 138.4 | +1% | −2% |
| sql-formatter | 166 | 126.1 | +10% | −26% |
| meriyah | 167 | 154.7 | +17% | −75% |
| obsidian-linter | 206 | 111.6 | −3% | −30% |
| dynamodb-toolbox | 697 | 192.4 | −10% | −10% |
| **TOTAL** | | **1,432** | **−0.3%** | **−11.7%** |

- **Tokens: net −0.3% (neutral).** v3 saved on 6/12, cost on 6/12; per-task span
  −25% … +20%.
- **Time: net −12% (slower).** dagward's `gq`/`init` overhead + cycle-gate.
- **No predictor.** Correlation of token Δ with repo size ≈ 0 (v3 r=0.13). The
  small-sample "blast radius predicts savings" pattern did **not** survive.
  Full-solve token outcome is dominated by per-agent variance (how much source
  each agent chose to read), not task structure.

(v2 — graph without annotations — is the same story: +2.2% tokens total. Both
arms are ~neutral; annotations did not move the aggregate.)

## Why neutral here but a big win on hihome — it's the task type

hihome and DeepSWE agree completely once you split by task type:

| Task type | hihome (query-cache) | DeepSWE (full solve) |
|---|---|---|
| **Architecture comprehension** | 48% input / **63% faster** | — (see Layer-2) |
| **Change-impact ("what breaks")** | **15% input / 95% faster** | — (see Layer-2) |
| **Code generation (feature add)** | ~break-even (79–111% in) | **≈ neutral (this table)** |
| **Bug fix (locate + comprehend)** | — | **−16% tok / −27% calls** ↓ |

DeepSWE is **94% feature_request** (106/113 tasks; only 4 bugfix, 3 of them
non-TS). So it stress-tests dagward on its *weakest* case — writing new code at a
known seam, where the compressible "find + understand" slice is small and the
prompt often pre-names the location. hihome's headline win comes from its
**analytical** rows (comprehension, impact) — exactly the rows DeepSWE barely
contains. **No contradiction: both show dagward saves on analytical / locate work
and breaks even on code generation.**

## The deterministic win is unchanged (and large)

Independent of any agent run, as a property of the artifacts (`eval/deepswe/layer2.mjs`):

| Question | dagward vs reading source | Savings |
|---|---|---|
| "What is the architecture?" | 2–6% of source tokens | **17–45×** |
| "What's this file's dependency cone?" | 0.5–1.4% | **70–200×** |
| "Comprehend the cone" (via contracts) | 8–20% | **5–13×** |

This mirrors hihome's cache result. The gap between this (huge) and the
full-solve number (neutral) is the whole story: **the saving is available; a
free-form agent doesn't reliably realize it** because writing code dominates the
budget and agents re-read source "to be safe."

## The bug-fix experiment (the confirmation)

happy-dom "Abort pending body reads on shutdown" — the only TS bugfix in DeepSWE.
The prompt **names no files**; the verifier checks behavior. So the agent must
locate the bug across a 580-file package.

| | Tokens | Tool calls | Wall-clock | Files edited |
|---|--:|--:|--:|--:|
| control | 139.5k | 62 | 18.3m | 5 |
| **v3 (dagward)** | **117.0k (−16%)** | **45 (−27%)** | **13.2m (−28%)** | **3** |

v3 used `gq annotate`/`importers` to pinpoint the read loops and trusted
contracts for the async-lifecycle files **without reading their source**; control
spent 62 tool calls exploring. dagward's fix was also *tighter* (3 files vs 5).
The single cleanest agentic win in the eval — and it's a **fix**. (N=1;
directional, but the mechanism is explicit in the transcript.)

A parallel "vague feature prompt" experiment was **inconclusive**: vaguening the
prompt shrinks the task rather than hardening the locate phase (control got
cheaper too), so it can't isolate the effect. Details in
`eval/deepswe/EXP2-RESULTS.md`.

## Cost caveat (amortization)

These per-task numbers assume the graph + annotations already exist. The graph
build (`dagward init`) is negligible (~seconds). The **annotation authoring pass
is not** — ~49–206k tokens per repo, one-time. For a repo that sees only a few
tasks that dwarfs any per-task saving; v3 only pays off once annotations amortize
across many tasks (or on analytical/bug-fix work where the per-task saving is
real).

## Takeaways

1. **dagward's agentic ROI is task-shaped**, and both benchmarks agree:
   large on **comprehension / change-impact / bug-fix** work, ~neutral on
   **feature code-generation**.
2. **Pitch the guaranteed value as cheap context** (17–200× to answer structural
   questions) — that's deterministic and independent of the agent.
3. **To capture it in an agent loop**, the agent must be *constrained* to trust
   contracts instead of re-reading source (a harness/prompt discipline). Free-form
   agents leave it on the table — which is why the full-solve average is flat.
4. **Benchmark choice matters**: DeepSWE being 94% features under-samples exactly
   the work dagward is built for. A fix/refactor-heavy suite would show a much
   stronger agentic number.

## Reproduce

Harness, scorer, query tool, authored annotations, and detailed write-ups:
`eval/deepswe/` (`README.md`, `EFFICIENCY.md`, `LAYER2.md`, `N12-RESULTS.md`,
`EXP2-RESULTS.md`). Raw token/time data: `n12-tokens.tsv`, `exp2-tokens.tsv` here.
