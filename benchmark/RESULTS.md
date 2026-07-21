# Token-economics benchmark — dagward on hihome (REAL runs only)

Every number here is a **measured live Claude subagent run** on the hihome repo. There is no
analytic/"calculated" track — each row is an actual agent doing the task end-to-end, with token
usage and wall-clock time recorded from the harness.

**Repo:** hihome — 407 graph nodes, all annotated (summary/inputs/outputs/should/shouldNot/side/pure),
0 file/folder cycles.

## The two conditions — the graph as a cache

Each task is run twice:

- **w/o dagward** — the agent reads source (grep/read/glob) and is forbidden from `dagward-out/`.
- **w/ dagward** — the agent uses `dagward-out/` as a **precomputed cache**, via three lookups:
  ```
  grep -i 'user' dagward-out/annotations.jsonl   # lean search: path ⇥ side ⇥ summary per file
  dagward query   src/foo.ts                     # one file's full contract + direct imports/importers
  dagward affects src/foo.ts                     # everything that breaks if it changes
  ```
  The graph is parsed **inside the command** — it never enters the agent's context; only the small
  answer comes back. The graph is the cache; the lookups are the savings.

## Results

Tokens are `input / output`, summed per API request from each transcript (input incl. cache reads).
**% = w/ dagward ÷ w/o dagward** (under 100% = dagward cheaper); **time saved** positive = dagward
faster. All 12 runs correct.

| Task | tokens w/o dagward<br>in / out | tokens w/ dagward<br>in / out | %<br>in / out | time<br>w/o | time<br>w/ | time<br>saved |
|---|--:|--:|--:|--:|--:|--:|
| Architecture comprehension | 119,509 / 5,831 | 57,269 / 2,095 | **48% / 36%** | 91s | 34s | **63%** |
| Change-impact analysis | 205,790 / 11,172 | 30,958 / 317 | **15% / 3%** | 156s | 8s | **95%** |
| Diff architecture review | 31,355 / 970 | 52,394 / 708 | 167% / 73% | 15s | 16s | −6% |
| Add an agent-ranks page | 123,602 / 2,659* | 110,306 / 4,472 | 89% / 168% | 60s | 65s | −7% |
| Add an API route | 121,144 / 2,337 | 96,186 / 1,840* | **79% / 79%** | 45s | 35s | **23%** |
| Add a DB schema field | 166,363 / 5,004 | 184,306 / 4,227 | 111% / 84% | 80s | 61s | **24%** |
| **Overall** | **767,763 / 27,973** | **531,419 / 13,659** | **69% / 49%** | 448s | 217s | **51%** |

\* For two runs the harness logged a streaming-start snapshot instead of the final usage record,
scoring a whole final answer at 3–6 output tokens. Those two are estimated from the emitted text
(chars ÷ 3.7); every other cell is a recorded count. `live-results.json` keeps the raw
`output_reported` alongside.

The `w/ dagward` column uses the optimized lookup path: `dagward query <file>` / `dagward affects
<file>` and a lean grep-able `annotations.jsonl`. Before those optimizations the same tasks measured
79% input / 66% output / 30% time saved — see *Optimization pass* below.

## How to read it — the cache's win is *task-shaped*

With real input/output counts, the split is stark: **dagward is a large win on analytical/query tasks
and a net loss on code-generation tasks.**

- **Analytical tasks win huge, on every axis.** Change-impact: **15% of the input, 3% of the output,
  95% faster** — `dagward affects` answers in one call (8 s) what cost the baseline a 156 s hand-trace
  over 205 k input tokens. Comprehension: **48% input, 36% output, 63% faster** (ARCHITECTURE.md states
  "0 cycles"; the baseline spent 90 s reasoning through an apparent `db↔lib` cycle). These are
  questions dagward has *already answered*.
- **Trivial checks lose — because the query over-answers.** Diff review asks one bit: *does
  `geocoding` already reach `db/prisma`?* dagward has no single-edge query, so the agent used the
  nearest primitive, `affects src/db/prisma.ts` — and `db/prisma.ts` is the repo's biggest hub, so it
  returned **136 files / 6,101 bytes** into context where the baseline's grep of one import line cost
  **101 bytes**. Not a graph-vs-grep loss; a missing-primitive loss. The fix is a
  `dagward check-edge <from> <to>` that answers CYCLE/CLEAN in one line (see *Next*).
- **Generative tasks now roughly break even, with a latency win on the well-targeted ones.** The API
  route came out ahead (**79% input, 23% faster**) and the DB field saved 24% of the time; the page task
  sits at 89% input / −7% time. Writing code still needs the real pattern, so contracts supplement
  rather than replace source — but they cut the *search* for which files matter.
- **The cache adds a correctness signal generatively.** The API-route agent read `setlicense.ts`'s
  contract, saw its documented "GET that mutates" flaw, and deliberately followed a *different*,
  correct route pattern. The DB-field agent flagged that its own change would invalidate the
  `shouldNot` on `update.ts` and should be re-worded — the annotations act as guardrails, not just docs.

**Overall across 6 tasks: 69% of the input tokens, 49% of the output, 51% less time** — but the average
hides the shape: the analytical tasks carry the win.

**Takeaway (matters for the MCP/hook direction):** expose the graph as *commands*
(`query`/`affects`/`check`) for "what is / what depends on X / does this break" — 2–6× cheaper input
and up to 95% faster, deterministic. Keep the search index lean and put depth behind a per-file query.
For code generation, treat contracts as a targeting aid and a guardrail, not a substitute for reading
the one pattern file you're copying.

Correctness was graded per task (right files, patterns, auth, prisma usage); all 12 runs passed.

## Per-task grading notes

- **Architecture comprehension** — both correct (0 file/folder cycles); baseline had to *manually
  reason* through an apparent `db↔lib` cycle that the cache reports resolved.
- **Change-impact** — the structural reverse-cone (cache: 8 files, deterministic) vs. the baseline's
  slower semantic trace; different scope, both defensible (see note below).
- **Diff review** — both correctly found the `db/prisma ↔ geocoding` cycle.
- **Add agent-ranks page / API route / DB field** — graded on: correct file location, reuse of the
  right data source / auth pattern / prisma call, and matching project conventions.

### Caveat carried over from the impact task
"What's affected by changing `MLSProperty`" is under-specified: the cache gives the exact *structural
import closure*; a semantic agent reasons about *actual field usage* and returns a different set. Both
are legitimate answers to different questions — the cache's value is giving the structural answer
exactly and identically every run.

## Optimization pass (what changed and what it bought)

The first benchmark round exposed *why* dagward lost on some tasks: the "cache" was one 438 KB
`graph.files.json`, so every lookup re-parsed the whole graph in a `node -e` one-liner — one slow
round-trip per question. Three changes, all in this repo:

1. **`dagward query <file>`** — one file's contract plus its direct imports/importers, from
   `dagward-out` alone (no tsconfig, no compiler, no source reads).
2. **`dagward affects <file>`** — the transitive dependents (the change-impact answer) as one command.
3. **`annotations.jsonl`** — one lean line per file (`path ⇥ side ⇥ summary`) emitted by `init`, so
   keyword search is a cheap grep.

**Measured effect** (same tasks, same conditions, re-run):

| | before | after |
|---|--:|--:|
| Overall input tokens vs baseline | 79% | **69%** |
| Overall output tokens vs baseline | 63% | **49%** |
| Overall time saved | 30% | **51%** |
| Change-impact | 23% in / 84% faster | **15% in / 95% faster** (156s → 8s, one tool call) |
| Add an API route | 120% in / 60% *slower* | **79% in / 23% faster** |

**The index-fatness trap (worth recording).** The first version of `annotations.jsonl` carried each
file's *full* contract plus its neighbour arrays — 743 chars/line. That made targeted lookups fine but
keyword search catastrophic: `grep -i user` matched 107 of 407 lines ≈ **22,000 tokens in a single
call**, and the DB-field task ballooned to 280 k input. Slimming the line to `path ⇥ side ⇥ summary`
(133 chars) cut the index 303 KB → 53 KB and the same grep to **1,466 tokens (15× cheaper)**, which
recovered the page task (223 k → 110 k input) and the DB task (280 k → 184 k). Detail now comes from
`dagward query` one file at a time — search stays lean, depth is on demand.

## Why the two "dagward costs more" cells look the way they do

- **Diff review, 167% input** — the agent ran `affects src/db/prisma.ts` (136 dependents, 6,101 bytes)
  to decide a single-edge question. dagward lacks a "would this edge cycle?" primitive, so the closest
  available query over-answers by ~60×. Product gap, not a graph limitation.
- **Agent-ranks page, 168% output** — *not* caused by annotations: annotations are **input**, and never
  appear in output. Two things drive it. (1) A measurement artifact: the baseline's final answer
  (5,420 chars) was logged as 3 output tokens, which made the ratio read 374% before correction.
  (2) A real difference: the dagward agent emitted a longer answer (7,297 vs 5,420 chars) — a richer
  page (debounced search box, pagination notes) plus more design caveats. Better context led it to
  write *more*, not annotations leaking into the output.

## Next (from these results)

- `dagward check-edge <from> <to>` — one-line CYCLE/CLEAN verdict; removes the diff-review regression
  and is the natural hook/MCP primitive for "is this import allowed?".
- Cap or paginate `affects` output for hub files (136 paths is a lot of context for one question).

## Reproduce

```
cd benchmark && node run.mjs      # prints the table from live-results.json
```
`live-results.json` holds every measured run (task, condition, input/output tokens, ms, tool calls, correctness).
