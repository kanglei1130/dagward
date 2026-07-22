# Proxy validation — real A/B results (hihome, 15 files × 2 conditions)

Every row below is a **live subagent run** on hihome. Task per file: *enumerate the file's
complete forward dependency cone* — the context-gathering half of any change (proxy.md's
"structural read cost"). Ground truth is the deterministic cone from `graph.files.json`, so
correctness is exact. **All 30 runs correct.** `input` = subagent total tokens (harness).

- **baseline** — reads source (grep/read), `dagward-out/` forbidden.
- **dagward** — uses only the graph cache (`graph.files.json` via targeted `node -e`), no source.

## Regression: does cone size predict change cost? (`regress.mjs`)

| condition | n | predictor | Pearson r | R² | Spearman ρ | fit |
|---|---|---|---|---|---|---|
| baseline | 15 | estTokens | 0.33 | 0.11 | **0.75** | 18,881 + 0·cone |
| dagward | 15 | estTokens | **0.01** | 0.00 | −0.38 | 15,896 (flat) |
| baseline | 15 | forwardCone | 0.32 | 0.10 | 0.69 | 19,024 + 87·cone |
| dagward | 15 | forwardCone | 0.01 | 0.00 | −0.46 | 15,895 (flat) |

Time (wall-clock) tracks the cone far better than tokens do: baseline **time~cone r = 0.66**,
dagward **r = −0.10** (flat).

## Per-file (sorted by cone size)

| cone | baseline tok / s | dagward tok / s | tok % | time % | file |
|---:|---|---|---:|---:|---|
| 0 | 15,862 / 8s | 16,531 / 24s | 104% | 303% | playwright.config.ts |
| 0 | 16,067 / 7s | 16,201 / 24s | 101% | 326% | api-test-utils.ts |
| 1 | 16,446 / 9s | 15,539 / 20s | 94% | 229% | quota.ts |
| 1 | 16,967 / 13s | 16,709 / 27s | 98% | 206% | tabs.tsx |
| 1 | 20,780 / 19s | 16,292 / 28s | 78% | 149% | browser-session.ts |
| 2 | 17,982 / 15s | 16,001 / 21s | 89% | 135% | pagination.tsx |
| 3 | 16,447 / 20s | 15,129 / 9s | 92% | 47% | disclosure-summary.tsx |
| 3 | 19,053 / 21s | 16,320 / 24s | 86% | 114% | layout-analysis-report.tsx |
| 4 | 29,113 / 32s | 15,132 / 10s | 52% | 33% | cgszones.ts |
| 6 | 23,729 / 52s | 15,207 / 12s | 64% | 23% | apply-referral.ts |
| 6 | 19,973 / 47s | 16,023 / 19s | 80% | 40% | referral.ts |
| 6 | 20,868 / 64s | 15,869 / 19s | 76% | 30% | comparable-card.tsx |
| 13 | 18,270 / 48s | 15,975 / 19s | 87% | 40% | configure.ts |
| 13 | 20,729 / 59s | 15,396 / 14s | 74% | 24% | quality-selector.tsx |
| 52 | 22,723 / 68s | 16,149 / 20s | 71% | 30% | mlslisting-card.tsx |

**Totals:** baseline 295,009 tok / 482s · dagward 238,473 tok / 291s (81% tokens, 60% time).

## What the data says (honestly)

1. **Dagward decouples change-context cost from cone size — the predicted win, cleanly.**
   Dagward's cost is flat (~15,900 tokens, ~19s) for *every* file, cone 0 to 52 (r ≈ 0). It turns
   an O(cone) source-trace into an O(1) graph lookup. Baseline scales with the cone (Spearman 0.75,
   time~cone 0.66).

2. **The payoff is entirely in the tail.** For cone ≤ 2 the two conditions tie (~16k both) — the
   fixed ~16k agent overhead dominates, and dagward's node-process startup even makes it *slower*
   in wall-clock on trivial files (time % > 100%). The savings appear at cone ≥ 4 and grow: at the
   47k-est-token hub `mlslisting-card` (cone 52), dagward is 71% the tokens and 30% the time.

3. **The proxy is a valid ORDINAL metric, not a magnitude one — and there's a confound.** Cone
   size predicts the *ranking* of change cost (Spearman 0.75) but not the linear magnitude
   (Pearson 0.33). Baseline tokens grew sub-linearly (16k → 23k across a 52× cone range) while the
   byte-summed proxy predicts 28 → 47,642. **Verified reason (from the transcripts, not assumed):**
   the baseline agents avoided pulling file contents into context — they traced imports through
   subprocess tools (mostly `grep` on import lines; the cone-52 run *wrote a throwaway import-tracer
   script* that reads files in a subprocess), doing at most 1–3 whole-file reads, never the full
   cone. So the "reads source" baseline partially **reinvented dagward's own graph trace** (the
   script case is a hand-rolled `dagward affects`), which compresses the token gap and is the real
   cause of the weak Pearson. A stricter baseline (no analysis scripts; must actually read every
   file it names) would show a far steeper cone→token curve. Takeaway: **track cone / estTokens as
   a relative health signal (which files rank costliest), not as a literal token count**, and note
   that a resourceful agent can sidestep cone size — which is itself part of dagward's point.

4. **Boundary (as proxy.md warned).** This task is the context-gathering half of a change, which is
   itself a graph query — so dagward's flat line is partly by construction. The write/reasoning half
   still requires the source; the proxy predicts structural read cost, not authoring cost.

### Method honesty note

The "grep import lines" explanation in an earlier draft was an *inference* from token sublinearity,
not an observation. It was checked afterward against the run transcripts (tool-call breakdown per
baseline run) and corrected to the mixed grep/script reality above. Point 3's confound is the
substantive finding from that check.
