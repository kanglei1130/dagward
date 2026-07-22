// Step-1 proxy validation, analysis half: does cone size predict tokens-to-change?
//
// Joins the deterministic predictor (cones.csv, x) to measured A/B runs
// (proxy-results.json, y) and reports the correlation PER CONDITION. Two
// findings matter, and they are different:
//   - baseline (agent reads source): a STRONG cone->tokens correlation confirms
//     the thesis "cone size = change cost" — the proxy is valid.
//   - dagward (agent uses the graph cache): a WEAKER correlation is the payoff —
//     it means dagward has decoupled change cost from cone size (the flat line
//     is the win). A still-strong correlation would say the cache isn't helping.
//
// No plotting, no deps: Pearson r, Spearman rho, and a least-squares line.
// Usage: node regress.mjs [proxy-results.json] [--x forwardCone|reverseCone]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const xi = args.indexOf("--x");
const xKey = xi === -1 ? "forwardCone" : args[xi + 1];
// positional = the results file: any arg that isn't --x or its value.
const positional = args.filter((a, i) => xi === -1 || (i !== xi && i !== xi + 1));
const resultsPath = positional[0] ?? path.join(here, "proxy-results.json");

const cones = new Map(
  fs
    .readFileSync(path.join(here, "cones.csv"), "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const [file, forwardCone, reverseCone] = line.split(",");
      return [file, { forwardCone: Number(forwardCone), reverseCone: Number(reverseCone) }];
    }),
);

const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
if (results.synthetic) console.log("!! SAMPLE DATA (synthetic) — replace proxy-results.json with real A/B runs before trusting any number below.\n");

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
function pearson(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx === 0 || vy === 0 ? NaN : cov / Math.sqrt(vx * vy);
}
// ranks with ties averaged, so Spearman is robust to the cone's integer clumps.
function ranks(a) {
  const order = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j < order.length && order[j][0] === order[i][0]) j++;
    const avg = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) r[order[k][1]] = avg;
    i = j;
  }
  return r;
}
const spearman = (xs, ys) => pearson(ranks(xs), ranks(ys));

const byCond = {};
for (const run of results.runs) {
  const cone = cones.get(run.file);
  if (!cone) {
    console.log(`  (skip: ${run.file} not in cones.csv)`);
    continue;
  }
  (byCond[run.cond] ??= []).push({ x: cone[xKey], y: run.input });
}

console.log(`predictor x = ${xKey} · response y = input tokens to change the file\n`);
console.log(`${"condition".padEnd(12)} ${"n".padStart(3)} ${"Pearson r".padStart(10)} ${"R^2".padStart(6)} ${"Spearman".padStart(9)}  tokens ≈ a + b·cone`);
console.log("-".repeat(78));
for (const [cond, pts] of Object.entries(byCond)) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const r = pearson(xs, ys);
  const rho = spearman(xs, ys);
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
  }
  const b = vx === 0 ? NaN : cov / vx;
  const a = my - b * mx;
  console.log(
    `${cond.padEnd(12)} ${String(pts.length).padStart(3)} ${r.toFixed(2).padStart(10)} ${(r * r).toFixed(2).padStart(6)} ${rho.toFixed(2).padStart(9)}  ${Math.round(a).toLocaleString()} + ${Math.round(b).toLocaleString()}·cone`,
  );
}
console.log(
  "\nRead: baseline r near 1 validates the proxy (cone predicts change cost).\n" +
    "A lower r for the dagward condition is the win — change cost decoupled from cone size.",
);
