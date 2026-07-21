// Real-runs-only reporter. Every number is a measured live Claude subagent run
// on hihome, one per (task, condition). input/output tokens are summed per API
// request from each run's transcript (input incl. cache reads); time is
// wall-clock. Reads live-results.json.
//
// Conditions:
//   WITHOUT dagward — agent reads source (grep/read), dagward-out/ forbidden.
//   WITH dagward    — agent uses dagward-out/ as a precomputed CACHE: targeted
//                     annotation/edge lookups (node -e), never loading the 438KB
//                     graph or reading source. The graph is the cache.
//
// Percentages: token % = WITH ÷ WITHOUT (under 100% = dagward used fewer).
//              time savings % = (WITHOUT − WITH) ÷ WITHOUT (positive = faster).
import fs from "node:fs";

const data = JSON.parse(fs.readFileSync(new URL("./live-results.json", import.meta.url), "utf8"));

const NAMES = {
  "1-architecture": "Architecture comprehension",
  "3-change-impact": "Change-impact analysis",
  "4-diff-review": "Diff architecture review",
  "5-agent-ranks-page": "Add an agent-ranks page",
  "6-add-api-route": "Add an API route",
  "7-add-db-field": "Add a DB schema field",
};
const ORDER = Object.keys(NAMES);

const by = {};
for (const r of data.runs) (by[r.task] ??= {})[r.cond === "baseline" ? "without" : "with"] = r;

const padR = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const pct = (w, wo) => (w / wo) * 100; // with as % of without
const save = (w, wo) => ((wo - w) / wo) * 100; // time savings

console.log("REAL runs on hihome — w/o dagward (reads source) vs w/ dagward (graph-as-cache)");
console.log("% = w/ dagward ÷ w/o dagward (under 100% = dagward cheaper) · time saved: positive = faster\n");

// tokens and their ratios travel as one "in / out" cell per condition
const toks = (input, output) => `${input.toLocaleString()} / ${output.toLocaleString()}`;
const ratios = (w, wo) => `${pct(w.i, wo.i).toFixed(0)}% / ${pct(w.o, wo.o).toFixed(0)}%`;

const H = [
  padR("Task", 26),
  padL("tokens w/o (in/out)", 21),
  padL("tokens w/ (in/out)", 20),
  padL("% (in/out)", 12),
  padL("t w/o", 7), padL("t w/", 7), padL("t saved", 8),
];
console.log(H.join(" "));
console.log("-".repeat(105));

const acc = { inW: 0, inWo: 0, outW: 0, outWo: 0, tW: 0, tWo: 0 };
for (const t of ORDER) {
  const g = by[t];
  if (!g?.without || !g?.with) {
    console.log(padR(NAMES[t], 26), " (incomplete)");
    continue;
  }
  const wo = g.without, w = g.with;
  acc.inWo += wo.input; acc.inW += w.input;
  acc.outWo += wo.output; acc.outW += w.output;
  acc.tWo += wo.ms; acc.tW += w.ms;
  console.log(
    [
      padR(NAMES[t], 26),
      padL(toks(wo.input, wo.output), 21),
      padL(toks(w.input, w.output), 20),
      padL(ratios({ i: w.input, o: w.output }, { i: wo.input, o: wo.output }), 12),
      padL((wo.ms / 1000).toFixed(0) + "s", 7), padL((w.ms / 1000).toFixed(0) + "s", 7), padL(save(w.ms, wo.ms).toFixed(0) + "%", 8),
    ].join(" "),
  );
}
console.log("-".repeat(105));
console.log(
  [
    padR("TOTAL / overall", 26),
    padL(toks(acc.inWo, acc.outWo), 21),
    padL(toks(acc.inW, acc.outW), 20),
    padL(ratios({ i: acc.inW, o: acc.outW }, { i: acc.inWo, o: acc.outWo }), 12),
    padL((acc.tWo / 1000).toFixed(0) + "s", 7), padL((acc.tW / 1000).toFixed(0) + "s", 7), padL(save(acc.tW, acc.tWo).toFixed(0) + "%", 8),
  ].join(" "),
);
