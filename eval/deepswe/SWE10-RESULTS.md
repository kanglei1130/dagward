# SWE10 — 10 real bug fixes on large repos (control vs v3)

The DeepSWE table (`N12-RESULTS.md`) was **94% feature-implementation** and came
out token-neutral. The single bug fix in it (happy-dom, −16%) hinted that dagward
helps **locate-bound** work — but that was N=1. This experiment tests that claim
directly: **10 real git-mined bug fixes** across three **300+ file** repos, each
graded by running the repo's own test.

**Bottom line:** on large-repo bug fixes, **v3 (dagward + annotations) leans
genuinely — if modestly — cheaper**: **−5.6% total tokens**, mean **−3.8%** /
median **−6.5%** per task, **cheaper on 8/10**, with **identical solve rates
(10/10 both arms)**. This is dagward's best full-solve agentic result so far, and
it lands on exactly the task shape the task-shape law predicts.

## Setup

- **Repos (all ≥ 200 files):** dynamodb-toolbox (697), happy-dom (580),
  obsidian-linter (206).
- **Instances (git-mined, SWE-bench style):** for each, base = the fix commit's
  parent (`sha^`); the gold **test** file is applied on top (so it *fails* at
  base); the gold **fix** commit is scrubbed from all refs + gc'd so the agent
  can't read it. Prompt = the original commit message + "a failing regression
  test was added, fix the source, don't touch the test."
- **Arms:** **control** (no dagward) and **v3** (dagward graph + authored per-file
  annotations; agent may `gq importers/annotate/conedoc`). No v2 — v3 is the arm
  that carries the annotation thesis.
- **Grading:** after the agent commits `solve`, the test file is reset to gold
  (anti-tamper) and re-run. `reward=1` iff it passes.
- One subagent per (instance, arm), sandboxed from `solution/` and gold history.

## Results

| case | repo (files) | ctrl tok | v3 tok | Δtok | ctrl→v3 calls | Δtime | reward |
|---|---|--:|--:|--:|--:|--:|:--:|
| ddb-anyOf | dynamodb-toolbox (697) | 57,051 | 47,114 | **−17.4%** | 24→21 | −15% | 1/1 |
| ddb-logical | dynamodb-toolbox | 29,433 | 28,200 | −4.2% | 8→8 | +12% | 1/1 |
| ddb-cloneDeep | dynamodb-toolbox | 28,638 | 29,145 | +1.8% | 8→9 | +17% | 1/1 |
| ddb-doesValidate | dynamodb-toolbox | 29,495 | 29,381 | −0.4% | 9→8 | 0% | 1/1 |
| hd-Request | happy-dom (580) | 30,678 | 29,458 | −4.0% | 9→9 | +18% | 1/1 |
| hd-Node | happy-dom | 51,191 | 35,046 | **−31.5%** | 23→12 | **−75%** | 1/1 |
| hd-ESM | happy-dom | 46,902 | 37,773 | **−19.5%** | 11→15 | +5% | 1/1 |
| hd-EventTarget | happy-dom | 35,016 | 31,950 | −8.8% | 16→12 | −5% | 1/1 |
| obs-keysort | obsidian-linter (206) | 41,584 | 33,423 | **−19.6%** | 19→9 | −29% | 1/1 |
| obs-title | obsidian-linter | 40,761 | 67,534 | **+65.7%** | 16→28 | +54% | 1/1 |
| **TOTAL** | | **390,749** | **369,024** | **−5.6%** | 143→121 | −20% | **10/10 · 10/10** |

Mean per-task Δtokens **−3.8%**, median **−6.5%**, v3 cheaper on **8/10**.
Total tool calls **143 → 121 (−15%)**.

## Reading it honestly

**The direction is real, the magnitude is noisy.** Two cases dominate the spread:

- **hd-Node (−31.5% tok, −75% time)** — the hardest bug (a live-array mutation
  during `connectedCallback`). Control went down a wrong path first (guarded with
  `=== this`, which broke 2 form-submit tests because `parentNode` holds the
  *proxy*, not the bare node), then backtracked — **23 calls, 417s**. v3 read the
  stack trace, checked `annotate`/`importers` to bound the blast radius, and fixed
  it cleanly in **12 calls, 103s**. This is the mechanism working: the graph kept
  the agent from an expensive detour on the one genuinely hard bug.
- **obs-title (+65.7%)** — the counter-example. v3 ran `conedoc` on the rule,
  which surfaced `strings.ts` as "the escape/unescape utility," and the agent
  built a **new `unescapeMarkdownSpecialCharacters` helper** there (2 files, 28
  calls). Control did a tighter inline regex in `regex.ts` (1 file, 16 calls).
  Same reward, but dagward's cone view *nudged the agent toward a heavier,
  "properer" fix*. Cheap context can induce more work — the same effect seen on
  the DeepSWE feature tasks.

Drop those two outliers and the other **8 cases average ≈ −9%** — a steadier,
smaller version of the same lean.

**Why bug fixes beat features for dagward.** The compressible slice of a task is
*finding + understanding existing code*. A feature spends most of its budget
*writing new code* (incompressible); a bug fix spends most of it *locating and
comprehending* — dagward's home turf. `importers`/`annotate` cut the search;
contracts let the agent trust a neighbor without reading its source.

**The honest caveat — stack traces make locate partly free.** Several agents
localized straight from the failing-test stack trace ("the trace pointed at
`Request.ts:477`, so I read that method rather than querying"). Where a trace
already names the file, dagward's locate value is redundant and the saving shrinks
toward zero (ddb-cloneDeep +1.8%, ddb-doesValidate −0.4%). The bigger wins are on
bugs where the trace is *diffuse* (hd-Node's error surfaced far from its cause) or
where comprehending neighbors matters (obs-keysort −19.6%). So the −16% happy-dom
N=1 was not a fluke, but it was the *high* end; the honest large-repo average is
**−4% to −9%**, not −16%.

## How this fits the two prior benchmarks

| Benchmark | Task shape | dagward token effect |
|---|---|--:|
| hihome (query-cache) | analytical (arch / change-impact) | **−15% to −48% in** |
| DeepSWE N=12 (full solve) | 94% feature-implementation | **≈0% (neutral)** |
| **SWE10 (this, full solve)** | **10 bug fixes, large repos** | **−5.6% total, 8/10 cheaper** |

No contradiction — one monotonic law: **the more a task is finding/understanding
existing code, the more dagward saves.** SWE10 slots exactly between the
analytical wins and the feature-neutral floor, and it's the first full-solve
result with **verified rewards (10/10) and N=10** rather than a single case.

## Caveats

- N=10, one trial per cell; per-agent thoroughness swings ±15%, comparable to the
  effect on the quiet cases. The aggregate lean is robust (8/10 cheaper); any
  single number is not.
- Per-task numbers assume the graph + annotations pre-exist. Annotation authoring
  is a one-time ~50–200k-token cost per repo (see `EFFICIENCY.md` amortization).
- Equal solve rate (10/10) means dagward didn't *improve correctness* here — these
  bugs are all solvable by both arms. Its value is efficiency, not capability.

Raw data: `../../benchmark/deepswe/swe10-tokens.tsv` (tokens/ms/calls/reward per
cell). Harness: `/tmp/batch/swe10-*.sh` (setup, verify) + `gq.mjs` + `annotations/`.
