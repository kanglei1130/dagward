# Token-economics benchmark — dagward on hihome (REAL runs only)

Every number here is a **measured live Claude subagent run** on the hihome repo. There is no
analytic/"calculated" track — each row is an actual agent doing the task end-to-end, with token
usage and wall-clock time recorded from the harness.

**Repo:** hihome — 407 graph nodes, all annotated (summary/inputs/outputs/should/shouldNot/side/pure),
0 file/folder cycles.

## The two conditions — the graph as a cache

Each task is run twice:

- **baseline** — the agent reads source (grep/read/glob) and is forbidden from `dagward-out/`.
- **dagward-cache** — the agent uses `dagward-out/` as a **precomputed cache**. Instead of reading a
  file's source (~1,000+ tokens) it looks up that file's *annotation contract* (~120 tokens) with a
  targeted query:
  ```
  node -e 'const g=require(".../dagward-out/graph.files.json");
           const n=g.nodes.find(x=>x.id==="src/PATH");
           console.log(JSON.stringify(n.annotation))'
  ```
  The 438 KB graph is loaded **inside the node process** (it never enters the agent's context) and
  only the small queried annotation — or a slice of the `edges` — comes back. The graph is the cache;
  lookups are the token savings.

## Results

Tokens summed per API request from each transcript (input incl. cache reads). **% = w/ dagward ÷ w/o
dagward** (under 100% = dagward cheaper); **time saved** positive = dagward faster. All 12 runs correct.

| Task | in<br>w/o dagward | in<br>w/ dagward | in % | out<br>w/o dagward | out<br>w/ dagward | out % | time<br>w/o dagward | time<br>w/ dagward | time<br>saved |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Architecture comprehension | 119,509 | 57,269 | **48%** | 5,831 | 2,095 | **36%** | 91s | 34s | **63%** |
| Change-impact analysis | 205,790 | 47,219 | **23%** | 11,172 | 643 | **6%** | 156s | 25s | **84%** |
| Diff architecture review | 31,355 | 64,282 | 205% | 970 | 1,087 | 112% | 15s | 26s | −74% |
| Add an agent-ranks page | 123,602 | 184,263 | 149% | 1,197 | 6,347 | 530% | 60s | 97s | −60% |
| Add an API route | 121,144 | 144,973 | 120% | 2,337 | 3,589 | 154% | 45s | 73s | −60% |
| Add a DB schema field | 166,363 | 107,404 | 65% | 5,004 | 3,852 | 77% | 80s | 61s | 23% |
| **Overall** | 767,763 | 605,410 | **79%** | 26,511 | 17,613 | **66%** | 448s | 315s | **30%** |

## How to read it — the cache's win is *task-shaped*

With real input/output counts, the split is stark: **dagward is a large win on analytical/query tasks
and a net loss on code-generation tasks.**

- **Analytical tasks win huge, on every axis.** Change-impact: dagward used **23% of the input, 6% of
  the output, and was 84% faster** (a precomputed reverse-cone vs. a 156 s hand-trace over 205 k input
  tokens). Comprehension: **48% input, 36% output, 63% faster** (dagward reports "0 cycles" from the
  graph; the baseline spent 90 s reasoning through an apparent `db↔lib` cycle). These are questions
  dagward has *already answered*, so the agent reads a small result instead of the repo.
- **Trivial checks favor the baseline.** Diff review is a one-edge question — a grep found the import
  in 15 s (31 k input), while the cache agent pulled graph slices costing **2× the input and 74% more
  time**. dagward's edge is *global/transitive* questions, not local ones.
- **Generative tasks are a real loss.** Adding a page/route cost the cache agent **more** input
  (120–149%) and far more output (154–530%) and ran **60% slower** — the annotation lookups add
  round-trips, and to write correct code the agent still needs the real pattern, then tends to write a
  more elaborate answer. Only the DB-field task came out ahead (65% input, 23% faster), because the
  annotations (`side`, `summary`) pinpointed the data-layer files without a repo hunt.
- **The cache still added a correctness signal generatively.** The API-route cache agent read
  `setlicense.ts`'s annotation and flagged its documented "GET that mutates" flaw — using the
  `shouldNot` contract to avoid copying a known anti-pattern the baseline had to infer.

**Overall across 6 tasks: 79% of the input tokens, 66% of the output, 30% less time** — but that
average hides the shape. The savings are concentrated entirely in the analytical tasks; the generative
tasks drag the mean the other way.

**Takeaway (matters for the MCP/hook direction):** deploy the graph-as-cache for *"what is / what
depends on X / does this break"* — analysis, impact, review — where it cuts input tokens 2–4× and time
2–6× with deterministic answers. Do **not** route *"write this new code"* through annotation lookups:
generation needs the real pattern, and the lookups cost tokens and latency without replacing it.

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

## Reproduce

```
cd benchmark && node run.mjs      # prints the table from live-results.json
```
`live-results.json` holds every measured run (task, condition, tokens, ms, tool calls, correctness).
