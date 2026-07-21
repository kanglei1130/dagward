# Follow-up experiments: does dagward save more when the agent must LOCATE?

Hypothesis (from the N=12 analysis): dagward is token-neutral on *feature*
tasks because those are implementation-bound and the prompts pre-name the seam.
It should save more on *comprehension/locate-bound* work. Two tests, control vs v3.

## Experiment A — bug fix (happy-dom, the only TS bugfix in DeepSWE, N=1)

The prompt names **no files** ("async work left in an invalid state after
shutdown; interrupted body reads must reject with AbortError") and the verifier
checks behavior. So control must locate the bug across a 580-file package.

| | Tokens | Tool calls | Wall-clock | Files edited |
|---|---|---|---|---|
| control | 139.5k | 62 | 18.3m | 5 |
| **v3 (dagward)** | **117.0k (−16.1%)** | **45 (−27%)** | **13.2m (−28%)** | **3** |

v3 used `annotate`/`importers` to pinpoint the read loops (`consumeBodyStream`,
`streamToFormData`) and trusted contracts for the async-lifecycle files
(`AsyncTaskManager`, navigator, factory) **without reading their source** —
control spent 62 tool calls exploring to find the same thing. dagward saved
~16% tokens / ~27% tool-calls **and** produced a tighter fix (3 files vs 5).

**This is the largest, cleanest dagward win in the whole eval** — and it's on a
*fix*, not a feature. Directional (N=1) but the mechanism is explicit.

## Experiment B — vague feature prompts (ofetch, awilix)

Stripped the API defaults/structure from the prompt to force design+locate.

| task | ctrl | v3 | Δ | (detailed-prompt v3 Δ) |
|---|---|---|---|---|
| ofetch-vague | 50.1k | 51.0k | +1.8% | (−12.8%) |
| awilix-vague | 78.0k | 85.5k | +9.7% | (+16.0%) |

**Confounded and inconclusive.** A vaguer prompt didn't create a harder locate
phase — it created a *smaller task* (both control runs got much cheaper:
ofetch 82k→50k, awilix 101k→78k, because the agent designed a simpler API). The
per-repo dagward sign was preserved but muted. You can't isolate "locate" by
vaguening the prompt on this benchmark, because the spec detail and the task size
are entangled. (These vague runs also fail the exact-API verifiers by design.)

## Takeaway

The bug-fix test confirms the thesis directly: **dagward's token savings scale
with how comprehension/locate-bound the task is.** Feature implementation (write
new code at a known seam) → ~0. Bug fix (find and understand existing code) →
−16% tokens, −27% tool-calls, on a single but clean data point. The DeepSWE
benchmark being 94% features is why the headline N=12 result came out neutral —
it under-samples exactly the work dagward is built for.
