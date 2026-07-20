// Folder drill-down: map each folder to the aggregate that represents it
// under the current expansion state. Walk the path's proper prefixes
// root-down; the first non-expanded prefix is the aggregate. An expanded
// folder still shows itself (it represents its own direct files).
function displayFolder(id, expanded) {
  if (id === ".") return ".";
  const parts = id.split("/");
  let prefix = "";
  for (let i = 0; i < parts.length - 1; i++) {
    prefix = prefix ? prefix + "/" + parts[i] : parts[i];
    if (!expanded.has(prefix)) return prefix;
  }
  return id;
}

// Aggregate the compact folder level (nodes [{id, fc, ann}], edges
// [[f,t,kind,w]]) for an expansion state. Returns the same compact shape
// plus per-node `hidden` (descendant folders swallowed by the aggregate).
// Cycles are recomputed on the aggregated graph.
function aggregateFolders(rawNodes, rawEdges, expanded) {
  const displayOf = new Array(rawNodes.length);
  const aggregates = new Map();
  rawNodes.forEach((n, i) => {
    const d = displayFolder(n.id, expanded);
    displayOf[i] = d;
    let a = aggregates.get(d);
    if (!a) aggregates.set(d, (a = { id: d, fc: 0, ann: null, sideVotes: {}, hidden: 0 }));
    a.fc += n.fc || 0;
    if (n.id === d) a.ann = n.ann || null;
    else a.hidden++;
    const side = n.ann && n.ann.side;
    // an aggregate that is itself a real folder keeps its own side
    if (side) a.sideVotes[side] = (a.sideVotes[side] || 0) + (n.id === d ? 1000 : 1);
  });

  const ids = [...aggregates.keys()].sort();
  const indexOf = new Map(ids.map((d, i) => [d, i]));
  const nodes = ids.map((d) => {
    const a = aggregates.get(d);
    let side = null, best = -1;
    for (const k in a.sideVotes) {
      if (a.sideVotes[k] > best) { best = a.sideVotes[k]; side = k; }
    }
    let ann = a.ann;
    if (ann && !ann.side && side) ann = Object.assign({}, ann, { side });
    if (!ann && side) ann = { side };
    return { id: d, fc: a.fc, ann, hidden: a.hidden };
  });

  const merged = new Map();
  for (const e of rawEdges) {
    const f = indexOf.get(displayOf[e[0]]);
    const t = indexOf.get(displayOf[e[1]]);
    if (f === t) continue;
    const key = f + ":" + t + ":" + e[2];
    const m = merged.get(key);
    if (m) m[3] += e[3];
    else merged.set(key, [f, t, e[2], e[3]]);
  }
  const edges = [...merged.values()];

  // cycles of the aggregated graph via layerAssign's SCC pass (self-edges
  // were dropped above, so only multi-node components count)
  const { sccOf } = layerAssign(nodes.length, edges.map((e) => ({ f: e[0], t: e[1] })));
  const groups = new Map();
  sccOf.forEach((c, v) => {
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(v);
  });
  const cycles = [...groups.values()].filter((g) => g.length > 1);

  return { nodes, edges, cycles };
}

// Pure layered-layout assignment: top layer = no ingress, bottom = no egress.
// Kept free of DOM/canvas so a node script can verify the invariants.
// edges: [{f,t}] node-index pairs. Returns:
//   layerOf: Int32Array, -1 for isolated nodes (no edges at all)
//   layers:  number[][] compacted top→bottom
//   sccOf:   Int32Array component id per node
function layerAssign(N, edges) {
  const adj = Array.from({ length: N }, () => []);
  const inDeg = new Int32Array(N);
  const outDeg = new Int32Array(N);
  const seenPair = new Set();
  for (const e of edges) {
    inDeg[e.t]++;
    outDeg[e.f]++;
    if (e.f === e.t) continue;
    const key = e.f * 1048576 + e.t;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    adj[e.f].push(e.t);
  }

  // iterative Tarjan (function level has 1k+ nodes; keep the stack explicit)
  const index = new Int32Array(N).fill(-1);
  const low = new Int32Array(N);
  const onStack = new Uint8Array(N);
  const stack = [];
  const sccOf = new Int32Array(N).fill(-1);
  let counter = 0;
  let sccCount = 0;
  for (let s = 0; s < N; s++) {
    if (index[s] >= 0) continue;
    const frames = [[s, 0]];
    index[s] = low[s] = counter++;
    stack.push(s);
    onStack[s] = 1;
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const v = frame[0];
      if (frame[1] < adj[v].length) {
        const w = adj[v][frame[1]++];
        if (index[w] < 0) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          frames.push([w, 0]);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], index[w]);
        }
      } else {
        frames.pop();
        if (frames.length) {
          const p = frames[frames.length - 1][0];
          low[p] = Math.min(low[p], low[v]);
        }
        if (low[v] === index[v]) {
          let w;
          do {
            w = stack.pop();
            onStack[w] = 0;
            sccOf[w] = sccCount;
          } while (w !== v);
          sccCount++;
        }
      }
    }
  }

  // condensation depths via Kahn: depth 0 = no ingress
  const cadj = Array.from({ length: sccCount }, () => new Set());
  const cin = new Int32Array(sccCount);
  for (let v = 0; v < N; v++) {
    for (const w of adj[v]) {
      const a = sccOf[v], b = sccOf[w];
      if (a !== b && !cadj[a].has(b)) {
        cadj[a].add(b);
        cin[b]++;
      }
    }
  }
  const depth = new Int32Array(sccCount);
  const queue = [];
  for (let c = 0; c < sccCount; c++) if (cin[c] === 0) queue.push(c);
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi];
    for (const b of cadj[c]) {
      depth[b] = Math.max(depth[b], depth[c] + 1);
      if (--cin[b] === 0) queue.push(b);
    }
  }
  let maxDepth = 0;
  for (let c = 0; c < sccCount; c++) maxDepth = Math.max(maxDepth, depth[c]);

  // pure sinks pinned to the bottom (only incoming edges, so never lifts an
  // edge upward); isolated nodes get their own band (-1)
  const layerOf = new Int32Array(N);
  for (let v = 0; v < N; v++) {
    if (inDeg[v] + outDeg[v] === 0) layerOf[v] = -1;
    else if (outDeg[v] === 0) layerOf[v] = maxDepth;
    else layerOf[v] = depth[sccOf[v]];
  }

  // compact empty layers (sink-pinning can drain one)
  const raw = Array.from({ length: maxDepth + 1 }, () => []);
  for (let v = 0; v < N; v++) if (layerOf[v] >= 0) raw[layerOf[v]].push(v);
  const layers = raw.filter((l) => l.length > 0);
  layers.forEach((l, li) => l.forEach((v) => { layerOf[v] = li; }));

  return { layerOf, layers, sccOf };
}
