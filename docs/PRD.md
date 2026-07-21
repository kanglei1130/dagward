# Dagward PRD — Architecture Contracts for AI-Generated Code

Status: Draft · Owner: TBD · Last updated: 2026-07-21

## 1. Problem

AI agents write code faster than anyone can review it. Undisciplined structure
compounds: more tangles, larger dependency cones, more context to read, slower
every session. The intent that keeps a codebase maintainable — *what this file
may and may not do* — lives in senior engineers' heads, not anywhere a machine
(or a new agent) can read. So each AI change is a fresh gamble on structure.

Dagward already turns architecture into data a machine can check: deterministic
dependency graphs at folder/file level, cycle detection, and per-node
annotations. This PRD defines the product that puts that data in front of
engineers and AI agents in the loop where code is written.

## 2. Vision and the core loop

**Dagward makes architecture machine-checkable (the graph) and intent
machine-readable (annotations); together they let AI generate code that is
maintainable by construction — because the contract is enforced, not hoped for.**

Every requirement in this document serves one stage of a single loop:

> **Define** — an engineer authors a contract (annotation) on a file or function.
> **Generate** — an AI agent reads the graph + contract + rules as context and
> writes code that conforms.
> **Enforce** — dagward checks the change deterministically: no new cycles, no
> boundary or `shouldNot` violations, cone stays small.
> **Maintain** — contracts are preserved across edits and moves; drift is flagged.
> → back to Define.

## 3. Personas

- **Author** — an engineer who defines and owns contracts for a module. Wants to
  express "this file may X, must not Y" once and have it enforced forever.
- **AI agent** — a coding agent (in-IDE or CI) that generates or edits code.
  Wants the minimal, trustworthy context to produce a conformant change on the
  first try.
- **Reviewer** — approves both the code change and any contract change in the
  same PR. Wants to see what structure and contracts a change altered.

## 4. Jobs to be done

- "Tell the AI what this file may and may not do, once."
- "Stop a change — human or AI — that breaks an architectural boundary."
- "Know when a contract has gone stale because the code under it changed."
- "Give an agent just enough context to change a file, not the whole repo."

## 5. Success metrics

Maintainability (the outcome):
- Median and p95 **dependency-cone size** — trend down.
- **Cycle count** — stays at zero.
- **% of nodes with a fresh (non-stale) annotation** — trend up.

AI leverage (the mechanism):
- **Tokens per agent task** — down.
- **% of AI changes passing `check` on the first try** — up.
- **% of AI PRs that introduce a cycle or violation** — down.

Adoption:
- **Annotation coverage %** of files.
- Weekly active authors.

## 6. Scope

### MVP — the define + enforce loop, one language, one IDE

TypeScript projects; VS Code; the graph is file + folder level. Ships:

- Annotation authoring panel with AI-drafted, human-approved contracts (A1–A4).
- Live graph with annotation preservation, rename re-keying, and staleness
  detection (B1–B3).
- Deterministic enforcement inline and in CI (C1, C3).
- A machine context API for agents plus post-generation validation (D1, D3).
- Impact / blast-radius view (E2).

### Later

Function-graph drill-down (E1), contract-first generation (D4), multi-language
adapters (Go, Python, Rust, C++), team governance of layers and lanes (F2).

The unified graph remains a computed visualization artifact, not a persisted
output.

## 7. Functional requirements

### A. Annotation authoring (the IDE surface)

- **A1** — In-editor panel to view and edit a node's contract: the existing
  `NodeAnnotation` fields (`summary`, `inputs`, `outputs`, `should`,
  `shouldNot`, `side`, `pure`), with schema validation on enums and shape.
- **A2** — Gutter / codelens on every file (and function) showing at a glance:
  has-annotation?, `side`, `pure`, and stale?. One click opens the panel.
- **A3** — AI-assisted draft, human-approved. The agent proposes an annotation
  from the code; the engineer edits and accepts. This preserves dagward's core
  invariant: it never invents contracts, it preserves authored ones. Approval is
  mandatory — no silent auto-annotation.
- **A4** — Annotations are the source of truth, committed and diffable, versioned
  with the code and reviewed in PRs.
- **A5** — First-run / bulk annotation pass with a review queue, so a repo is
  onboarded incrementally and only new or moved files need attention thereafter.

### B. Graph generation and live update

- **B1** — Build file / folder graphs on open and incrementally on save, so the
  IDE reflects current structure within ~1s.
- **B2** — Preserve annotations across regeneration by node id, and re-key across
  renames and moves using git rename detection (moves currently drop the
  contract).
- **B3** — Staleness detection: hash each annotated node's surface (exports,
  imports, signature); flag the annotation when the code under it changed,
  instead of silently carrying a stale contract. Re-hash only changed files.

### C. Enforcement (`check`)

- **C1** — Evaluate layer / boundary rules and per-node `shouldNot` against the
  live graph; surface violations as inline squiggles and in a problems panel.
- **C2** — Cone / cycle budget: warn when a change enlarges a file's cone or
  introduces a cycle.
- **C3** — CI / pre-commit parity: the identical deterministic check runs
  headless and fails the build. No LLM — no AI judging AI.

### D. AI context provisioning (the leverage)

- **D1** — A machine API (MCP tool) an agent calls before generating, to fetch
  the minimal context: the target node's annotation, its depth-limited
  dependency cone (trusting neighbors' contracts at depth 1), applicable rules,
  and the allowed / forbidden edge set.
- **D2** — Pre-write guard: the agent can ask "is an import from X → Y permitted?"
  and get a deterministic yes/no, so it designs within boundaries instead of
  being corrected after.
- **D3** — Post-generation validation loop: run `check` and staleness on AI
  output before it is accepted, and feed violations back to the agent to
  self-correct. This is what makes "maintainable by construction" real.
- **D4** — Contract-first generation (later): author a node's annotation before
  the code exists; AI generates an implementation that satisfies
  `inputs` / `outputs` / `should` / `shouldNot`.

### E. Visualization and navigation

- **E1** — Interactive map embedded in the IDE; click a node to see its
  annotation, neighbors, and violations. (This is where the function graph and
  drill-down earn their place — as a visualization asset, not enforcement.)
- **E2** — Impact view (`affects`): the blast radius of a change before it is made.

### F. Persistence and governance

- **F1** — Annotations and rules live in-repo, reviewed via PR — contracts are
  code-reviewed like code.
- **F2** — Ownership of layer definitions and `side` lanes, versioned.
- **F3** — Drift report on each PR: what structural facts and contracts a change
  altered (new edges, cycles, violations, newly-stale annotations).

## 8. Non-functional requirements

- **Deterministic** — the same source produces the same graph and the same
  verdict; enforcement never depends on an LLM.
- **Fast** — incremental graph update on save under ~1s for a mid-size repo;
  full build ~1 min.
- **Offline** — graph, check, and viz run with no network; the AI draft and
  generation steps are the only model-dependent paths.
- **In-repo and diffable** — every artifact an engineer or agent relies on is a
  committed, human-readable file.

## 9. Non-goals

- Not a style / formatting linter.
- Not the code generator itself — dagward provisions context and enforces
  contracts; the agent writes the code.
- Not runtime or dataflow analysis; the graph is derived statically from
  imports and calls.

## 10. Risks

- **Stale contracts erode trust.** If annotations drift from code unnoticed,
  engineers stop believing them. B3 (staleness) is the mitigation and is
  make-or-break.
- **The AI ignores the context.** A context API the agent can skip provides no
  guarantee. D3 (post-generation validation) turns guidance into a gate.
- **Authoring friction.** If defining a contract is slow, coverage stays low.
  A3 (AI draft + one-click approve) is the mitigation.

## 11. Rollout

1. **Foundation** — file / folder graph, staleness, rename re-keying, `check`
   parity in CI (B, C).
2. **Authoring** — the annotation panel and AI-draft-with-approval (A).
3. **Leverage** — the agent context API and post-generation validation (D1, D3).
4. **Exploration** — embedded interactive map and impact view (E).
5. **Scale** — contract-first generation, multi-language adapters, governance
   (D4, F2).

The two requirements that make or break the product are **B3 (staleness)** and
**D3 (post-generation validation)**: without staleness engineers stop trusting
the contracts, and without the validation loop the AI leverage is a suggestion
the model can ignore.
