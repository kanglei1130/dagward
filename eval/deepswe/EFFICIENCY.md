# DeepSWE × dagward — token & time efficiency (with vs without dagward)

The primary question: does dagward reduce an agent's token usage and running
time? Measured on 3 TS tasks × 3 arms (control, v1 doc, v2 graph-queried),
Claude as the agent. Numbers are the agent's own reported usage per run.

## Per task — tokens (k) / tool calls / wall-clock (min)

| Task | Control (no dagward) | v1 (ARCHITECTURE.md + gate) | v2 (graph.files.json queried) |
|---|---|---|---|
| ts-pattern | 75.3k / 27 / 7.3 | 74.8k / 25 / 7.0 | 70.4k / 20 / 5.6 |
| superjson | 88.8k / 27 / 9.6 | 98.6k / 31 / 10.9 | 83.4k / 35 / 9.3 |
| awilix | 101.3k / 45 / 10.6 | 115.5k / 53 / 13.8 | 106.8k / 40 / 11.6 |
| **Total** | **265k / 99 / 27.4** | **289k / 109 / 31.7** | **261k / 95 / 26.6** |

## Deltas vs control

| Arm | Tokens | Wall-clock | Tool calls |
|---|---|---|---|
| v1 (doc) | **+8.9%** | **+15.5%** | +10% |
| v2 (queried) | **−1.8%** | **−3.1%** | −4% |

v2 per task: ts-pattern −6.5% tok / −22% time; superjson −6.1% / −2.4%;
awilix **+5.4% / +9.5%** (the complex hub-heavy task — graph-reasoning overhead
exceeded navigation savings).

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
