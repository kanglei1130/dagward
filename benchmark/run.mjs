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

const H = [
  padR("Task", 26),
  padL("in w/o", 8), padL("in w/", 8), padL("in%", 6),
  padL("out w/o", 8), padL("out w/", 9), padL("out%", 6),
  padL("t w/o", 7), padL("t w/", 7), padL("t saved", 8),
];
console.log(H.join(" "));
console.log("-".repeat(101));

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
      padL(wo.input.toLocaleString(), 8), padL(w.input.toLocaleString(), 8), padL(pct(w.input, wo.input).toFixed(0) + "%", 6),
      padL(wo.output.toLocaleString(), 8), padL(w.output.toLocaleString(), 9), padL(pct(w.output, wo.output).toFixed(0) + "%", 6),
      padL((wo.ms / 1000).toFixed(0) + "s", 7), padL((w.ms / 1000).toFixed(0) + "s", 7), padL(save(w.ms, wo.ms).toFixed(0) + "%", 8),
    ].join(" "),
  );
}
console.log("-".repeat(101));
console.log(
  [
    padR("TOTAL / overall", 26),
    padL(acc.inWo.toLocaleString(), 8), padL(acc.inW.toLocaleString(), 8), padL(pct(acc.inW, acc.inWo).toFixed(0) + "%", 6),
    padL(acc.outWo.toLocaleString(), 8), padL(acc.outW.toLocaleString(), 9), padL(pct(acc.outW, acc.outWo).toFixed(0) + "%", 6),
    padL((acc.tWo / 1000).toFixed(0) + "s", 7), padL((acc.tW / 1000).toFixed(0) + "s", 7), padL(save(acc.tW, acc.tWo).toFixed(0) + "%", 8),
  ].join(" "),
);
