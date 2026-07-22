# Plan — cone + LOC as a token-usage proxy for repo maintainability

The goal: evaluate whether dagward keeps a repo cheaper to change over time, using a
**deterministic proxy for token cost** instead of running an agent on every file.

## Thesis

The context needed to change a file is its **dependency cone** — everything reachable
through its imports. Cone *count* says how many files enter context; **loc/bytes** say
how big each is. So the token cost of changing a file is estimated by the size summed
over its cone:

```
coneBytes(X) = bytes(X) + Σ bytes(f)  for f in forwardCone(X)
estTokens(X) ≈ coneBytes(X) / 3.7      (chars/token ratio, per RESULTS.md)
```

Cone gives *which* files; loc/bytes give *how much*. If this proxy predicts real
tokens, cone size becomes a free, continuous health metric — track it every commit,
no agents required.

## Inputs dagward now provides

- `graph.files.json` — file nodes carry `loc` and `bytes` (computed each run; node
  fields, not annotations, since annotations are authored and preserved).
- `dagward affects <file>` — the reverse cone (blast radius) as a shipped command.

## The harness (this folder)

- `cone.mjs` — reads a dagward graph, emits `cones.csv` with `loc, bytes,
  forwardCone, reverseCone, coneLoc, coneBytes, estTokens` per file, ranks the
  most-expensive-to-change files, and (`--select N`) picks a spread of candidates.
- `regress.mjs` — joins the proxy (x) to measured A/B tokens (y) and reports
  Pearson/Spearman/least-squares per condition, for any `--x` column.
- `README.md` — full usage; `proxy-results.example.json` — labeled synthetic demo.

## Three-step evaluation

1. **Validate the proxy.** Pick ~15 files spanning `estTokens` (cheap → expensive).
   Run the with/without-dagward A/B on each (same method as `../RESULTS.md`), record
   tokens into `proxy-results.json`, then `regress.mjs`. A **strong baseline r**
   confirms cost is cone-driven → the proxy is valid. A **weaker dagward r** is the
   payoff → dagward decoupled change cost from cone size.
2. **Track health over time.** With the proxy validated, run `dagward init` across git
   history and plot cycles, cone-p95, hub fan-in, and `check` violations/exemptions.
   A flat/shrinking cone-p95 (normalized by repo size) is a maintainable repo.
3. **Attribute causally.** Control vs. treatment (one arm gated by `dagward check`),
   or the slope-change at the adoption commit, rules out "the team did it, not the tool."

## Run it on HiHome

```
npm run build && node dist/cli.js init /path/to/hihome
node benchmark/proxy/cone.mjs /path/to/hihome/dagward-out --select 15
# run the A/B per candidate → proxy-results.json (see README), then:
node benchmark/proxy/regress.mjs proxy-results.json --x estTokens
```

Expected report: per-file `estTokens` across HiHome's ~407 files, the hub files that
dominate total context cost, and how cone-count vs LOC-weighted cost compare.

## Honest boundary

The proxy estimates the *structural read cost* of a change (which files, how big).
It does not model the *write* cost or behavioral reasoning — those still need the
source. The proxy predicts where changes are expensive; it doesn't author them.
