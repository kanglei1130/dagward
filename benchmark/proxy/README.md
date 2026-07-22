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

- `cones.csv` — every file with, per column:
  - **forwardCone** — transitive imports (how many files enter context to change it).
  - **reverseCone** — `dagward affects` (what breaks if it changes); reuses the
    shipped `affects`, so it equals `dagward affects <file>` exactly.
  - **loc / bytes** — the file's own size, from the node fields dagward records.
  - **coneLoc / coneBytes** — size summed over the file *and its forward cone*.
  - **estTokens** — `coneBytes / 3.7`: the estimated tokens to read the file plus
    everything it depends on. Cone says *which* files; loc/bytes say *how big*.
    This is the sharpest single predictor and the harness's headline proxy.
- `candidates.json` — ~15 files stratified across the **estTokens** range
  (cheap → expensive), so the regression covers the whole span, not a cluster.

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
node benchmark/proxy/regress.mjs proxy-results.json              # x = forwardCone
node benchmark/proxy/regress.mjs proxy-results.json --x estTokens
```

`--x` accepts any cones.csv column: `forwardCone`, `reverseCone`, `coneLoc`,
`coneBytes`, or `estTokens`. Try each — the one with the highest baseline r is
your best proxy (expect `estTokens`, since it weights the cone by real file size).

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
