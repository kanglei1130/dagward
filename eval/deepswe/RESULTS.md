# DeepSWE × dagward — trial results

3 TypeScript tasks, Claude as the agent, run entirely **without Docker and
without an API key** (Claude Code session as the agent; native reconstructed
verifier). Harness validated: the ts-pattern golden solution scores `reward=1`
(85/85) through the native verifier.

## Control arm (without dagward)

Same agent, no dagward context. Behavioral verdict from the official
`grader.py`; structural delta from `dagward init` before vs after the patch
(src only, held-out tests excluded).

| Task | Behavioral verdict | Files Δ | Import edges Δ | Cycle introduced? | Cone mean Δ | Cone max Δ |
|---|---|---|---|---|---|---|
| ts-pattern `matchEach` | ✅ **reward=1** — 85/85 f2p, 6/6 p2p | +2 | +12 | **no** | +0.77 | +2 |
| superjson `errorStack` | ✅ **reward=1** — 80/80 f2p, 116/116 p2p | +4 | +6 | **no** | +0.13 | +4 |
| awilix async init | ◑ **reward=0** — 23/24 f2p, 162/162 p2p | 0 | 0 | **no** | 0 | 0 |

- **Solve rate:** 2/3 fully solved; awilix a near-miss (one fail-to-pass edge
  case, 95.8% of f2p, all 162 pass-to-pass green).
- **Structure:** **zero cycles introduced across all three.** Only modest cone
  growth from new modules (ts-pattern, superjson); awilix edited existing files
  with no new inter-file edges (0 delta).

## Treatment arm v1 (with dagward — thin: ARCHITECTURE.md + cycle-gate)

Same tasks, agent given `dagward-out/ARCHITECTURE.md` + `annotations.jsonl` and
a mandatory `dagward init` cycle-gate before commit.

| Task | Control | With dagward (v1) | Structural difference |
|---|---|---|---|
| ts-pattern | reward=1 (85/85) | reward=1 (85/85) | none — both +2 files, no cycle |
| superjson | reward=1 (80/80) | reward=0 (79/80) | none — both +4 files, no cycle |
| awilix | reward=0 (23/24) | reward=1 (24/24) | none — both no cycle |

- Pass rate 2/3 both arms; one task flipped each direction (**variance**, not signal).
- **Zero cycles introduced in all six runs.**
- **Why v1 is weak:** the agent read a graph-*derived* report and a single cycle
  scalar; `annotations.jsonl` was empty (0/20 files have authored contracts on
  these OSS repos); and the cycle-gate never fired (count stayed 1). So
  `graph.files.json` itself was never queried — v1 tests "did an architecture doc
  help", not "does the file graph help".

## Treatment arm v2 (with dagward — graph.files.json in the loop)

Agent must query `graph.files.json` via `gq.mjs` before editing each file:
`cone <file>` (what to understand), `affects <file>` (blast radius), `hubs`.
This puts the file graph's structured outputs directly in the agent's decisions.
Results pending.

## Key findings

1. **The pipeline works end-to-end, Docker-free and key-free.** Native verifier
   reproduces official grading (golden → reward=1); Claude session is the agent;
   dagward supplies the structural delta.
2. **Unaided Claude is a competent baseline here** — solves 2/3, near-misses the
   third on one edge case.
3. **Nothing for enforcement to catch on these tasks.** Every control patch is
   acyclic with only healthy cone growth. On small, well-scoped library features
   the agent already produces clean structure, so a "with dagward" arm has no
   cycle or boundary violation to *prevent* — the expected ±dagward structural
   delta on these 3 is ≈ 0.

## Implication for the ±dagward comparison

These repos are **too clean to showcase enforcement value**. To measure dagward's
effect, either:

- **target messier/larger tasks** — big multi-file refactors, or repos with
  existing layering to violate, where an unaided agent is more likely to add a
  cycle or cross a boundary; and/or
- **measure the token-economics axis instead** (deterministic Layer-2 benchmark:
  tokens to answer architecture questions via source vs via dagward artifacts) —
  which does not depend on the agent making a structural mistake.

## Caveats

- Not official DeepSWE numbers (Claude Code session ≠ mini-swe-agent scaffold);
  valid as a directional pipeline proof.
- ts-pattern's repo was briefly disturbed by an earlier harness self-test that
  dropped golden files into its working tree; the agent reset and reimplemented
  without reading them, and its result (a from-scratch pass, not a copy) is
  consistent with no contamination.
- These repos carry no authored annotations, so this trial exercises dagward's
  auto-generated structural context + check-gate, **not** the annotation-contract
  product feature.

## Reproduce

```bash
# per task (task_dir, agent_repo, base_sha, dagward_cli)
bash verify-task.sh <deep-swe>/tasks/<task> <repo> <base_sha> <dagward>/dist/cli.js
```
