# Proxy validation — does cone size predict tokens-to-change?

Step 1 of evaluating dagward's maintenance claim. The README's thesis is that
**the context needed to change a file is its dependency cone**. If that holds,
cone size — which dagward computes deterministically, for free — should *predict*
the tokens an agent spends changing a file. Validate that once and cone size
becomes a cheap, continuous proxy for change cost: you can track repo health
every commit without ever running an agent.

This harness has two halves.

## Half 1 — the predictor (deterministic, runs now, no agents)

```
dagward init .                       # writes dagward-out/graph.files.json
node benchmark/proxy/cone.mjs dagward-out --select 15
```

- `cones.csv` — every file with its **forwardCone** (transitive imports: what you
  must read to change it) and **reverseCone** (`dagward affects`: what breaks if
  it changes). `reverseCone` reuses dagward's shipped `affects`, so it equals
  `dagward affects <file>` exactly.
- `candidates.json` — ~15 files stratified across the cone distribution
  (small → large), so the regression covers the whole range instead of clustering.

Run this against a **real target repo** (e.g. hihome, 407 files). dagward's own
14-file graph works for smoke-testing the plumbing but is too small to regress on.

## Half 2 — the response (the A/B runs, needs agents)

For each file in `candidates.json`, run the same A/B the top-level benchmark uses
(`../RESULTS.md`): an agent makes a realistic change to that file **with** and
**without** dagward, and you record token usage. Append every run to
`proxy-results.json`:

```json
{
  "runs": [
    { "file": "src/foo.ts", "cond": "baseline", "input": 41000, "output": 1200, "ms": 60000, "correct": true },
    { "file": "src/foo.ts", "cond": "dagward",  "input": 18000, "output":  900, "ms": 30000, "correct": true }
  ]
}
```

Same schema and conditions as `../live-results.json`: `cond` is `baseline`
(reads source, `dagward-out/` forbidden) or `dagward` (graph-as-cache). `input`
includes cache reads. Grade `correct` per run — a cheaper wrong answer is not a win.

## Half 3 — the verdict

```
node benchmark/proxy/regress.mjs proxy-results.json          # x = forwardCone
node benchmark/proxy/regress.mjs proxy-results.json --x reverseCone
```

Joins cone size (x) to input tokens (y) and reports, **per condition**, Pearson r,
R², Spearman rho, and the least-squares line `tokens ≈ a + b·cone`.

**How to read it — two different findings:**

- **baseline r near 1** → the proxy is *valid*: change cost really is cone-driven,
  so you may track cone size as a stand-in for tokens. The slope `b` is the price,
  in tokens, of each extra file in the cone.
- **dagward r *lower* than baseline** → the *payoff*: dagward has partly decoupled
  change cost from cone size (a flatter, noisier line). A dagward r still near the
  baseline's would say the cache isn't earning its keep on change tasks.

## Demo (synthetic — not measured)

`proxy-results.example.json` (`"synthetic": true`) lets you run Half 3 end-to-end
before you have real runs; `regress.mjs` prints a SAMPLE DATA banner for it. On
dagward's own graph it illustrates the expected shape — baseline tightly
cone-correlated, dagward flatter — and shows `forwardCone` predicting well while
`reverseCone` does not. Replace it with real `proxy-results.json` for a real verdict.
