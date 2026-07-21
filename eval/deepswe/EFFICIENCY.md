# DeepSWE × dagward — token & time efficiency (with vs without dagward)

The primary question: does dagward reduce an agent's token usage and running
time? Measured on 3 TS tasks × 3 arms (control, v1 doc, v2 graph-queried),
Claude as the agent. Numbers are the agent's own reported usage per run.

## Control vs v2 (dagward's graph queried in the loop)

tokens (k) / tool calls / wall-clock (min):

| Task | Control (no dagward) | v2 (graph.files.json queried) | Tokens Δ | Time Δ |
|---|---|---|---|---|
| ts-pattern | 75.3k / 27 / 7.3 | 70.4k / 20 / 5.6 | −6.5% | −22% |
| superjson | 88.8k / 27 / 9.6 | 83.4k / 35 / 9.3 | −6.1% | −2.4% |
| awilix (complex) | 101.3k / 45 / 10.6 | 106.8k / 40 / 11.6 | **+5.4%** | **+9.5%** |
| **Total** | **265k / 99 / 27.4** | **261k / 95 / 26.6** | **−1.8%** | **−3.1%** |

Net ≈ token-neutral: dagward saves on the two small tasks and *costs* on the
complex one, because on a complex, hub-tangled task the graph surfaces more
constraints to reason about while the savings (knowing the cone without reading
it) stay a small fixed slice. See "Why complex tasks don't save" below.

(A third arm — dagward consumed as a static ARCHITECTURE.md doc rather than
queried — ran +8.9% tokens; dropped here as it only showed that dumping a doc is
strictly worse than querying.)

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
