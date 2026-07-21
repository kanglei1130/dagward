# DeepSWE × dagward — token & time efficiency (with vs without dagward)

The primary question: does dagward reduce an agent's token usage and running
time? Measured on 3 TS tasks × 3 arms (control, v1 doc, v2 graph-queried),
Claude as the agent. Numbers are the agent's own reported usage per run.

## Control vs v2 (graph queried) vs v3 (graph + annotations)

Agent tokens (k) — the metric of interest:

| Task | Control | v2 (graph) | v3 (graph + annotations) |
|---|---|---|---|
| ts-pattern | 75.3k | 70.4k (−6.5%) | **56.6k (−24.9%)** |
| superjson | 88.8k | 83.4k (−6.1%) | 100.3k (**+12.9%**) |
| awilix (complex) | 101.3k | 106.8k (+5.4%) | 117.6k (**+16.0%**) |
| **Total** | **265k** | **261k (−1.8%)** | **274k (+3.4%)** |

Wall-clock total: control 27.4m, v2 26.6m (−3.1%), v3 30.5m (**+11.2%**).

### The honest result

**Neither arm delivers reliable token savings, and annotations (v3) made it
slightly *worse* overall (+3.4%).** The per-task numbers swing wildly by sign:
- v3 ts-pattern **−25%** — the agent genuinely trusted 13 contracts and skipped
  reading their source (the annotation thesis working).
- v3 superjson **+13%**, v3 awilix **+16%** — those agents read dependency source
  anyway ("not answerable from the contract") and did more thorough design +
  verification. Given *cheap* context, they did *more* work, not less.

The annotation lever did **not** flip the complex task (awilix): v3 was the most
expensive awilix run of all.

### Why the agentic measurement can't show dagward's token win

1. **The savings are a small slice.** A full solve is dominated by design +
   implementation + verification. Comprehending un-edited dependencies (the part
   annotations compress) is a minor fraction; edited files are read in full
   regardless.
2. **Agents don't reliably take the saving.** "To be safe" they read source even
   when a contract exists (superjson read `plainer.ts`; awilix reasoned deeply
   about PROXY-mode runtime behavior a 123-token contract can't convey).
3. **Cheap context induces more work.** With contracts in hand the agents ran
   larger smoke suites and deeper design pivots — costlier, not cheaper.
4. **Variance ≫ effect.** N=1 per cell; per-agent thoroughness swings ±15%,
   larger than any dagward effect.

### What IS real (LAYER2.md)

As a **deterministic property of the artifacts**, dagward cuts context cost
massively — 17-200× for structure, 5-13× for cone comprehension. That saving is
guaranteed; it is the agent that fails to realize it in a free-form solve. To
capture it you must *constrain* the agent to trust contracts instead of reading
source (a harness/prompt-discipline problem). v3 ts-pattern proves it's
achievable (−25%); v3 superjson/awilix prove it isn't automatic.

(A doc-only arm — ARCHITECTURE.md, no queries — ran +8.9% tokens; strictly worse
than querying, dropped from the table.)

## Why complex tasks don't save

dagward compresses the *cost of learning the structure* (which files exist, what
imports what — see LAYER2.md, 17-200x). It does NOT compress:
- **Writing the implementation** — fixed, dagward-independent, and it grows with
  task complexity (awilix's async engine is ~280 lines vs ts-pattern's leaf).
- **Understanding what each dependency DOES** — the graph gives the cone as a
  list of ids, but to safely edit around a hub the agent still reads that hub's
  *source*. The id list is cheap; the comprehension is not.
- **Reasoning within a tangled structure** — awilix's 3 edit targets are a
  mutually-recursive 7-node SCC. The graph honestly reports "there is no clean
  leaf here," and the agent then spends tokens reasoning how to minimize coupling
  (import-type tricks, joining vs creating a cycle). The graph adds constraints
  to think about without handing over a cheaper path.

So on a complex task: learning-structure (compressed) is a small share; the large
shares (implementation + comprehending hub source + navigating the tangle) are
uncompressed, and the extra graph-reasoning can tip the total positive.

The missing piece is **comprehending dependencies without reading their source** —
which is what per-file annotations provide (depth-1 contract instead of full
source). See LAYER2.md "annotation projection".

## Findings

1. **dagward as a static doc (v1) reliably *adds* cost** (+8.9% tokens): the
   agent reads a mostly-inert report and runs a gate, with no offsetting saving.
2. **dagward queried (v2) is ~token-neutral overall** (−1.8%): cheaper on small
   tasks, more expensive on the complex one. No robust win.
3. **Total-solve token/time is the wrong instrument.** A full solve is dominated
   by writing the implementation (fixed, dagward-independent) plus graph-reasoning
   overhead, which swamp the context-gathering savings dagward targets. Agent
   variance (each arm writes a different implementation) is large relative to the
   effect.

## The clean measurement: context-gathering only (Layer 2)

dagward's token claim is specifically that **answering a structural question via
a graph query is cheaper than reading source to answer it.** That isolates from
implementation effort. See `layer2.mjs` / `LAYER2.md`: for each file, tokens to
answer "what depends on X?" (affects) and "what does X depend on?" (cone) via a
`gq` query vs via reading the source you'd otherwise open. This is deterministic
(no agent, no variance) and is the apples-to-apples with/without-dagward number.

## Caveats

- N = 3 tasks, 1 trial each — directional only.
- Claude Code session as the agent, not the official DeepSWE scaffold.
- `subagent_tokens` is the agent's reported usage; rough cross-run comparability.
