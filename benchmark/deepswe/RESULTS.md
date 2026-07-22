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

## Scaling the bug-fix result: 10 fixes on large repos (SWE10)

The −16% above was N=1. To test it, we git-mined **10 real bug fixes** across
three **300+ file** repos — dynamodb-toolbox (697), happy-dom (580),
obsidian-linter (206) — control vs v3, each **graded by running the repo's own
test** (base fails, fixed passes; gold fix scrubbed so the agent can't read it).

| | Total tokens | Mean Δtok | Cheaper on | Reward |
|---|--:|--:|--:|:--:|
| control | 390.7k | — | — | **10/10** |
| **v3 (dagward)** | **369.0k (−5.6%)** | **−3.8%** (median −6.5%) | **8/10** | **10/10** |

The lean is real but noisy, driven by two poles: **hd-Node −31.5%** (the hardest
bug — control took a wrong path and spent 23 calls/417s; v3's `annotate`/`importers`
bounded the blast radius and it fixed cleanly in 12 calls/103s) and **obs-title
+65.7%** (v3's `conedoc` nudged the agent toward a heavier new-helper fix). The
other 8 average ≈ −9%. Solve rate is identical (10/10) — dagward's value here is
**efficiency, not capability**.

**Honest limit:** where a failing-test **stack trace already names the file**,
dagward's locate value is redundant and the saving collapses toward zero
(ddb-cloneDeep +1.8%, ddb-doesValidate −0.4%). The wins concentrate on bugs with a
*diffuse* trace or heavy neighbor-comprehension. So the large-repo bug-fix average
is **−4% to −9%**, not −16% — the N=1 was the high end. Full detail + per-case
table: `eval/deepswe/SWE10-RESULTS.md`; raw data: `swe10-tokens.tsv`.

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

## Final table — savings by task shape

Both benchmarks, one axis: **the more a task is about finding/understanding
existing code (vs. writing new code), the more dagward saves.** Savings are
positive = dagward cheaper / faster; negative = dagward costs more.

| Task shape | Token savings | Time savings | Evidence |
|---|--:|--:|---|
| **Structural query** — "what is the architecture / cone" (deterministic, no agent) | **95–99.5%** (17–200×) | sub-second | Layer-2 |
| **Change-impact** — "what breaks if I change X" | **≈85%** in / 97% out | **≈95%** | hihome |
| **Architecture comprehension** — "how is this laid out" | **≈52%** in / 64% out | **≈63%** | hihome |
| **Bug fix (diffuse trace)** — locate across repo + comprehend + edit | **≈16–31%** | **≈28–75%** | happy-dom, hd-Node |
| **Bug fix (avg, large repos)** — 10 cases, 200–697 files | **≈4–9%** (8/10 cheaper) | ≈mixed | SWE10 (N=10, verified) |
| **Bug fix (stack trace names file)** — locate is already free | **≈0%** | ≈0% | SWE10 ddb-cloneDeep |
| **Feature implementation** — write new code at a known seam | **≈0%** (neutral) | **≈−12%** (slower) | DeepSWE N=12 |
| **Trivial single-edge check** — "does A already import B" | **−67%** (over-answers) | ≈0% | hihome diff-review |

Reading the gradient:
- **Top rows (analytical / locate-bound): dagward's home turf** — the graph has
  *already answered* the question, so a lookup replaces a hand-trace. Savings are
  large on every axis.
- **Bug fix: the strongest agentic case** — the agent must locate across the repo;
  dagward's `affects`/`annotate` cut the search and contracts replace reading
  dependency source. Verified over **10 large-repo fixes** (SWE10): −5.6% total
  tokens, cheaper on 8/10, same 10/10 solve rate — biggest where the trace is
  diffuse (hd-Node −31%), ~zero where the trace already names the file.
- **Feature implementation: neutral** — writing new code dominates the budget and
  isn't compressible; the small find/understand slice is often pre-named by the
  prompt. Time can go slightly negative from the `gq`/`init`/cycle-gate overhead.
- **Trivial single-edge check: a product gap, not a graph limit** — dagward lacks
  a one-line `check-edge <from> <to>`, so the agent uses `affects` on a hub and
  over-answers. Fix is a new primitive (see hihome *Next*).

**One-line rule of thumb:** dagward's savings ≈ *(how much of the task is
finding/understanding existing code)*. Analytical and bug-fix work: big win.
Greenfield feature-add: break-even. And the deterministic context-compression
(17–200×) is always there regardless of the agent.

## Reproduce

Harness, scorer, query tool, authored annotations, and detailed write-ups:
`eval/deepswe/` (`README.md`, `EFFICIENCY.md`, `LAYER2.md`, `N12-RESULTS.md`,
`EXP2-RESULTS.md`). Raw token/time data: `n12-tokens.tsv`, `exp2-tokens.tsv` here.
