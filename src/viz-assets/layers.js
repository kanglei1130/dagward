// Containment chain of a node id, root-down, excluding the node itself:
// folder ancestors, then (for a function `file#fn`) its file. These are the
// ids that can be expanded/collapsed to reveal or hide the node.
function containers(id) {
  const hash = id.indexOf("#");
  const filePart = hash >= 0 ? id.slice(0, hash) : id;
  const out = [];
  const slash = filePart.lastIndexOf("/");
  if (slash < 0) {
    out.push("."); // repo-root files sit under the "." folder
  } else {
    const parts = filePart.split("/");
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? prefix + "/" + parts[i] : parts[i];
      out.push(prefix);
    }
  }
  if (hash >= 0) out.push(filePart); // a file contains its functions
  return out;
}

// The display node representing `id` under the current expansion: the first
// container not in `expanded`; if every container is expanded, the node
// shows itself.
function displayNode(id, expanded) {
  const cs = containers(id);
  for (const c of cs) if (!expanded.has(c)) return c;
  return id;
}

// Initial frontier: high-level folders. Expand the root and any top-level
// folder that branches into >= 2 sub-folders (e.g. `src`), so the opening
// view shows the area folders (src/components, src/lib, src/db, …) laid out
// in the side lanes. Deeper folders, files, and functions stay collapsed
// until the viewer clicks in. Flat top-level folders (scripts, prisma) stay
// as one node rather than spilling their files.
function initialExpanded(rawNodes) {
  const allFolders = new Set();
  for (const n of rawNodes) {
    if (n.id.includes("#")) continue; // module nodes only
    for (const c of containers(n.id)) allFolders.add(c);
  }
  const childFolders = new Map();
  for (const f of allFolders) {
    const slash = f.lastIndexOf("/");
    const parent = slash < 0 ? "." : f.slice(0, slash);
    if (parent !== f) childFolders.set(parent, (childFolders.get(parent) || 0) + 1);
  }
  const expanded = new Set(["."]);
  for (const f of allFolders) {
    const topLevel = !f.includes("/"); // depth-1 folder
    if (f !== "." && topLevel && (childFolders.get(f) || 0) >= 2) expanded.add(f);
  }
  return expanded;
}

// Aggregate the unified graph (nodes [{id, ln?, ann?}], edges [[f,t,k,w]])
// to the current expansion frontier. Display nodes are folders (synthetic),
// files (module nodes), or functions. Returns compact nodes carrying `kind`,
// `hidden` (foldable children count), `fileCount`, plus per-cycle `cycleReal`
// classified against the true folder/file/function cycles in `trueCycles`.
function aggregate(rawNodes, rawEdges, expanded, trueCycles) {
  const displayOf = new Array(rawNodes.length);
  const groups = new Map();
  rawNodes.forEach((n, i) => {
    const d = displayNode(n.id, expanded);
    displayOf[i] = d;
    let g = groups.get(d);
    if (!g) groups.set(d, (g = { id: d, self: null, hidden: 0, files: new Set(), fns: 0, sideVotes: {} }));
    if (n.id === d) g.self = n;
    else g.hidden++;
    if (n.id.includes("#")) g.fns++;
    else g.files.add(n.id);
    const side = n.ann && n.ann.side;
    if (side) g.sideVotes[side] = (g.sideVotes[side] || 0) + (n.id === d ? 1000 : 1);
  });

  const ids = [...groups.keys()].sort();
  const indexOf = new Map(ids.map((d, i) => [d, i]));
  const nodes = ids.map((d) => {
    const g = groups.get(d);
    let side = null, best = -1;
    for (const k in g.sideVotes) if (g.sideVotes[k] > best) { best = g.sideVotes[k]; side = k; }
    const kind = d.includes("#") ? "function" : g.self ? "file" : "folder";
    let ann = (g.self && g.self.ann) || null;
    if (ann && !ann.side && side) ann = Object.assign({}, ann, { side });
    if (!ann && side) ann = { side };
    // a folder is always expandable; a collapsed file is expandable iff it
    // hides functions
    const hidden = kind === "folder" ? g.files.size : kind === "file" ? g.fns : 0;
    return Object.assign({}, g.self, { id: d, kind, ann, hidden, fileCount: g.files.size, fnCount: g.fns });
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

  const { sccOf } = layerAssign(nodes.length, edges.map((e) => ({ f: e[0], t: e[1] })));
  const byScc = new Map();
  sccOf.forEach((c, v) => {
    if (!byScc.has(c)) byScc.set(c, []);
    byScc.get(c).push(v);
  });
  const cycles = [...byScc.values()].filter((g) => g.length > 1);

  // A displayed SCC is a real cycle only if some true cycle (folder, file, or
  // function level) projects onto >= 2 of its members; otherwise it is a
  // projection artifact of coarse aggregation.
  let cycleReal = cycles.map(() => true);
  if (trueCycles) {
    const projections = trueCycles
      .map((c) => new Set(c.map((id) => displayNode(id, expanded))))
      .filter((s) => s.size > 1);
    cycleReal = cycles.map((members) => {
      const memberIds = new Set(members.map((m) => nodes[m].id));
      return projections.some((proj) => [...proj].every((id) => memberIds.has(id)));
    });
  }

  return { nodes, edges, cycles, cycleReal };
}

// Pure layered-layout assignment: top layer = no ingress, bottom = no egress.
// Kept free of DOM/canvas so a node script can verify the invariants.
// NOTE: the Tarjan inside layerAssign has a TypeScript twin in
// src/graph.ts (stronglyConnectedComponents) — this page is assembled by
// concatenation and can't import it; keep algorithm fixes in sync.
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
