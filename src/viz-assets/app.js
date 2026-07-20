"use strict";
(() => {
  const DATA = window.DAGWARD_DATA;
  // annotations live on the graph nodes themselves; function nodes inherit
  // their file's annotation via this lookup
  const FILE_ANN = new Map(
    DATA.levels.file.nodes.filter((n) => n.ann).map((n) => [n.id, n.ann]),
  );
  const KINDS = ["value", "type", "dynamic", "call", "reference"];
  const SIDES = [
    { key: "frontend", label: "frontend", token: "--s-frontend" },
    { key: "backend", label: "backend", token: "--s-backend" },
    { key: "shared", label: "shared (pure/isomorphic)", token: "--s-shared" },
    { key: "tooling", label: "scripts / prisma / data", token: "--s-tooling" },
  ];
  const AREAS = [
    { key: "components", label: "src/components", token: "--c-components", test: (id) => id.startsWith("src/components") },
    { key: "lib", label: "src/lib", token: "--c-lib", test: (id) => id.startsWith("src/lib") },
    { key: "pages", label: "src/pages", token: "--c-pages", test: (id) => id.startsWith("src/pages") },
    { key: "tooling", label: "scripts / prisma / data", token: "--c-tooling", test: (id) => /^(scripts|prisma|data)(\/|$)/.test(id) },
    { key: "other", label: "everything else", token: "--c-other", test: () => true },
  ];
  const LEVELS = [
    { key: "folder", label: "Folders", kinds: ["value", "type"] },
    { key: "file", label: "Files", kinds: ["value", "type", "dynamic"] },
    { key: "function", label: "Functions", kinds: ["call", "reference"] },
  ];

  // ---- theme colors, re-read on theme change ----
  let C = {};
  function readColors() {
    const s = getComputedStyle(document.documentElement);
    const get = (t) => s.getPropertyValue(t).trim();
    C = {
      ink: get("--ink"), ink2: get("--ink-2"), muted: get("--muted"),
      edge: get("--edge"), surface: get("--surface"), page: get("--page"), grid: get("--grid"),
      accent: get("--accent"), critical: get("--critical"),
      areas: Object.fromEntries(AREAS.map((a) => [a.key, get(a.token)])),
      sides: Object.fromEntries(SIDES.map((s) => [s.key, get(s.token)])),
    };
  }
  readColors();
  new MutationObserver(() => { readColors(); buildLegends(); draw(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    readColors(); buildLegends(); draw();
  });

  // ---- graph model ----
  function areaOf(id) {
    const fileId = id.includes("#") ? id.slice(0, id.indexOf("#")) : id;
    return AREAS.find((a) => a.test(fileId)).key;
  }
  function shortName(id) {
    const hash = id.indexOf("#");
    if (hash >= 0) return id.slice(id.lastIndexOf("/", hash) + 1);
    const slash = id.lastIndexOf("/");
    return slash >= 0 ? id.slice(slash + 1) : id;
  }

  function buildLevel(key) {
    const raw =
      key === "folder"
        ? aggregateFolders(DATA.levels.folder.nodes, DATA.levels.folder.edges, folderExpanded)
        : DATA.levels[key];
    const nodes = raw.nodes.map((n, i) => {
      const ann =
        n.ann ?? (n.id.includes("#") ? FILE_ANN.get(n.id.slice(0, n.id.indexOf("#"))) : undefined);
      return {
        i, id: n.id, fc: n.fc, ln: n.ln, hidden: n.hidden || 0,
        area: areaOf(n.id), label: shortName(n.id) + (n.hidden ? " +" + n.hidden : ""),
        ann, side: ann?.side ?? "shared",
        fanIn: 0, fanOut: 0, cycle: -1,
        x: 0, y: 0, vx: 0, vy: 0, r: 4, fixed: false,
      };
    });
    const edges = raw.edges.map(([f, t, k, w]) => ({
      f, t, kind: KINDS[k], w, cycle: false,
    }));
    for (const e of edges) {
      nodes[e.f].fanOut += 1;
      nodes[e.t].fanIn += 1;
    }
    // In the aggregated folder view, an SCC can be a projection artifact:
    // group A and group B mutually import through DIFFERENT files with no
    // underlying folder cycle. A displayed cycle is "real" only if some raw
    // folder cycle spans >= 2 of its aggregate nodes.
    let cycleReal = raw.cycles.map(() => true);
    if (key === "folder") {
      const rawFolder = DATA.levels.folder;
      const realProjections = rawFolder.cycles
        .map((c) => new Set(c.map((v) => displayFolder(rawFolder.nodes[v].id, folderExpanded))))
        .filter((s) => s.size > 1);
      cycleReal = raw.cycles.map((members) => {
        const ids = new Set(members.map((m) => nodes[m].id));
        return realProjections.some((proj) => [...proj].every((id) => ids.has(id)));
      });
    }
    raw.cycles.forEach((members, ci) => {
      for (const m of members) {
        nodes[m].cycle = ci;
        nodes[m].cycleReal = cycleReal[ci];
      }
    });
    for (const e of edges) {
      const a = nodes[e.f], b = nodes[e.t];
      e.cycle = a.cycle >= 0 && a.cycle === b.cycle;
      e.cycleReal = e.cycle && a.cycleReal;
    }
    for (const n of nodes) {
      const deg = key === "folder" ? (n.fc ?? 1) : n.fanIn + n.fanOut;
      n.r = Math.min(16, 3.5 + 2.2 * Math.sqrt(deg));
    }
    // initial positions: one wedge per area so the layout starts pre-sorted
    const areaIndex = Object.fromEntries(AREAS.map((a, i) => [a.key, i]));
    const spread = 90 * Math.sqrt(nodes.length);
    for (const n of nodes) {
      const angle = (areaIndex[n.area] / AREAS.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.9;
      const rad = spread * (0.25 + Math.random() * 0.75);
      n.x = Math.cos(angle) * rad;
      n.y = Math.sin(angle) * rad;
    }
    return { key, nodes, edges, cycles: raw.cycles, cycleReal, alpha: 1 };
  }

  const graphs = {};
  let G = null;
  let layoutMode = "layered";
  let splitMode = true;
  let folderExpanded = new Set(["src"]);

  // ---- layered layout (layerAssign comes from layers.js) ----
  const SPACING = { folder: 110, file: 52, function: 40 };
  const LAYER_GAP = { folder: 170, file: 140, function: 120 };

  function computeLayered(g) {
    const cacheKey = splitMode ? "split" : "flat";
    if (!g.layeredCache) g.layeredCache = {};
    if (g.layeredCache[cacheKey]) return g.layeredCache[cacheKey];
    const N = g.nodes.length;
    const { layerOf, layers } = layerAssign(N, g.edges);

    // barycenter crossing-reduction: order each layer by mean neighbor position
    const neighbors = Array.from({ length: N }, () => []);
    for (const e of g.edges) {
      if (e.f === e.t) continue;
      neighbors[e.f].push(e.t);
      neighbors[e.t].push(e.f);
    }
    const order = new Float64Array(N);
    for (const layer of layers) {
      layer.sort((a, b) => (g.nodes[a].area + g.nodes[a].id).localeCompare(g.nodes[b].area + g.nodes[b].id));
      layer.forEach((v, i) => { order[v] = i; });
    }
    const bary = (v) => {
      const ns = neighbors[v];
      if (!ns.length) return order[v];
      let sum = 0;
      for (const w of ns) sum += order[w];
      return sum / ns.length;
    };
    for (let iter = 0; iter < 4; iter++) {
      const sweep = iter % 2 === 0 ? layers : [...layers].reverse();
      for (const layer of sweep) {
        layer.sort((a, b) => bary(a) - bary(b));
        layer.forEach((v, i) => { order[v] = i; });
      }
    }

    const spacing = SPACING[g.key];
    const gap = LAYER_GAP[g.key];
    const pos = new Array(N);
    const bands = [];
    let lanes = null;

    const LANE_ORDER = ["frontend", "shared", "backend", "tooling"];
    const laneOf = (v) => (LANE_ORDER.includes(g.nodes[v].side) ? g.nodes[v].side : "shared");

    if (splitMode) {
      const titles = { frontend: "frontend", shared: "shared · pure", backend: "backend", tooling: "tooling" };
      const present = LANE_ORDER.filter((k) => g.nodes.some((n, v) => laneOf(v) === k));
      const cells = layers.map((layer) => {
        const byLane = Object.fromEntries(present.map((k) => [k, []]));
        for (const v of layer) byLane[laneOf(v)].push(v); // barycenter order preserved
        return byLane;
      });
      const maxCell = Object.fromEntries(present.map((k) => [k, 1]));
      for (const byLane of cells) {
        for (const k of present) maxCell[k] = Math.max(maxCell[k], byLane[k].length);
      }
      const gutter = spacing * 2.5;
      let cursor = 0;
      lanes = present.map((k) => {
        const width = maxCell[k] * spacing;
        const meta = { key: k, title: titles[k], x0: cursor, x1: cursor + width };
        cursor += width + gutter;
        return meta;
      });
      const total = cursor - gutter;
      for (const m of lanes) { m.x0 -= total / 2; m.x1 -= total / 2; }
      const laneMeta = Object.fromEntries(lanes.map((m) => [m.key, m]));
      cells.forEach((byLane, li) => {
        bands.push({ y: li * gap, count: layers[li].length });
        for (const k of present) {
          const mid = (laneMeta[k].x0 + laneMeta[k].x1) / 2;
          byLane[k].forEach((v, i) => {
            pos[v] = { x: mid + (i - (byLane[k].length - 1) / 2) * spacing, y: li * gap };
          });
        }
      });
    } else {
      layers.forEach((layer, li) => {
        bands.push({ y: li * gap, count: layer.length });
        layer.forEach((v, i) => {
          pos[v] = { x: (i - (layer.length - 1) / 2) * spacing, y: li * gap };
        });
      });
    }

    const isolated = [];
    for (let v = 0; v < N; v++) if (layerOf[v] === -1) isolated.push(v);
    let isoBand = null;
    if (isolated.length) {
      isolated.sort((a, b) =>
        splitMode
          ? LANE_ORDER.indexOf(laneOf(a)) - LANE_ORDER.indexOf(laneOf(b)) ||
            g.nodes[a].id.localeCompare(g.nodes[b].id)
          : g.nodes[a].id.localeCompare(g.nodes[b].id),
      );
      const cols = Math.ceil(Math.sqrt(isolated.length * 3));
      const y0 = (layers.length - 1) * gap + gap * 1.6;
      isolated.forEach((v, i) => {
        pos[v] = {
          x: ((i % cols) - (cols - 1) / 2) * spacing * 0.8,
          y: y0 + Math.floor(i / cols) * gap * 0.35,
        };
      });
      isoBand = { y: y0, count: isolated.length };
    }

    let minX = Infinity, maxY = 0;
    for (const p of pos) {
      if (!p) continue;
      minX = Math.min(minX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const result = {
      pos, bands, isoBand, lanes,
      labelX: minX - 50,
      laneTop: -gap * 0.6,
      laneBottom: maxY + gap * 0.5,
    };
    g.layeredCache[cacheKey] = result;
    return result;
  }

  function applyLayout() {
    if (!G) return;
    if (layoutMode === "layered") {
      const { pos } = computeLayered(G);
      for (const n of G.nodes) {
        n.x = pos[n.i].x;
        n.y = pos[n.i].y;
        n.vx = n.vy = 0;
      }
      draw();
    } else {
      if (G.forcePos) {
        for (const n of G.nodes) { n.x = G.forcePos[n.i].x; n.y = G.forcePos[n.i].y; }
        reheat(0.2);
      } else {
        // seed the simulation from the layered arrangement for continuity
        reheat(1);
      }
    }
  }

  function setMode(mode) {
    if (mode === layoutMode) return;
    if (layoutMode === "force" && G) G.forcePos = G.nodes.map((n) => ({ x: n.x, y: n.y }));
    layoutMode = mode;
    document.getElementById("mode-layered").setAttribute("aria-pressed", String(mode === "layered"));
    document.getElementById("mode-force").setAttribute("aria-pressed", String(mode === "force"));
    for (const b of document.querySelectorAll("#split-seg button")) b.disabled = mode !== "layered";
    applyLayout();
    fitTo(G.nodes);
  }

  function setSplit(on) {
    if (on === splitMode) return;
    splitMode = on;
    document.getElementById("split-on").setAttribute("aria-pressed", String(on));
    document.getElementById("split-off").setAttribute("aria-pressed", String(!on));
    if (layoutMode === "layered" && G) {
      applyLayout();
      fitTo(G.nodes);
    }
  }

  // ---- force simulation (grid-bucketed repulsion) ----
  const REST = { folder: 70, file: 42, function: 30 };
  function tick(g) {
    const nodes = g.nodes, edges = g.edges;
    const alpha = g.alpha;
    const cell = 60;
    const grid = new Map();
    for (const n of nodes) {
      const k = ((n.x / cell) | 0) + ":" + ((n.y / cell) | 0);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(n);
    }
    const K = 900;
    for (const n of nodes) {
      const cx = (n.x / cell) | 0, cy = (n.y / cell) | 0;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(gx + ":" + gy);
          if (!bucket) continue;
          for (const m of bucket) {
            if (m === n) continue;
            let dx = n.x - m.x, dy = n.y - m.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
            if (d2 > cell * cell * 4) continue;
            const f = (K * alpha) / d2;
            n.vx += dx * f;
            n.vy += dy * f;
          }
        }
      }
    }
    const rest = REST[g.key];
    for (const e of edges) {
      const a = nodes[e.f], b = nodes[e.t];
      if (a === b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = ((d - rest) / d) * 0.06 * alpha;
      a.vx += dx * f; a.vy += dy * f;
      b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.004 * alpha;
      n.vy -= n.y * 0.004 * alpha;
      if (!n.fixed) {
        n.x += n.vx = n.vx * 0.6;
        n.y += n.vy = n.vy * 0.6;
      } else {
        n.vx = n.vy = 0;
      }
    }
    g.alpha = Math.max(0, alpha * 0.985);
  }

  // ---- canvas & view ----
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const tip = document.getElementById("tip");
  let view = { s: 1, tx: 0, ty: 0 };
  let hover = null, selected = null, selectedCycle = -1;
  let searchSet = null;
  let colorMode = "side";

  function nodeColor(n) {
    return colorMode === "side" ? C.sides[n.side] ?? C.muted : C.areas[n.area];
  }

  function setColorMode(mode) {
    if (mode === colorMode) return;
    colorMode = mode;
    document.getElementById("color-area").setAttribute("aria-pressed", String(mode === "area"));
    document.getElementById("color-side").setAttribute("aria-pressed", String(mode === "side"));
    buildLegends();
    draw();
  }

  function resize() {
    const dpr = devicePixelRatio || 1;
    const { width, height } = cv.getBoundingClientRect();
    cv.width = width * dpr;
    cv.height = height * dpr;
    draw();
  }
  new ResizeObserver(resize).observe(cv);

  function toWorld(px, py) {
    return { x: (px - view.tx) / view.s, y: (py - view.ty) / view.s };
  }

  function fitTo(nodes) {
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    const rect = cv.getBoundingClientRect();
    const pad = 60;
    const s = Math.min(
      3,
      (rect.width - pad * 2) / Math.max(80, maxX - minX),
      (rect.height - pad * 2) / Math.max(80, maxY - minY),
    );
    view.s = Math.max(0.05, s);
    view.tx = rect.width / 2 - ((minX + maxX) / 2) * view.s;
    view.ty = rect.height / 2 - ((minY + maxY) / 2) * view.s;
    draw();
  }

  function highlightSets() {
    // returns {nodes:Set|null, edges:(e)=>bool} of what stays at full opacity
    if (selected != null) {
      const keep = new Set([selected]);
      const edgeKeep = (e) => e.f === selected || e.t === selected;
      for (const e of G.edges) {
        if (e.f === selected) keep.add(e.t);
        if (e.t === selected) keep.add(e.f);
      }
      return { nodes: keep, edge: edgeKeep };
    }
    if (selectedCycle >= 0) {
      const keep = new Set(G.cycles[selectedCycle]);
      return { nodes: keep, edge: (e) => keep.has(e.f) && keep.has(e.t) };
    }
    if (searchSet) {
      return { nodes: searchSet, edge: (e) => searchSet.has(e.f) && searchSet.has(e.t) };
    }
    return null;
  }

  function draw() {
    const dpr = devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!G) return;
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.s, view.s);

    const hl = highlightSets();
    const nodes = G.nodes;

    // layer band labels + side lanes
    if (layoutMode === "layered") {
      const L = computeLayered(G);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.font = `${12 / view.s}px system-ui, sans-serif`;
      ctx.fillStyle = C.muted;
      ctx.globalAlpha = 1;
      L.bands.forEach((band, i) => {
        let label = "L" + i;
        if (i === 0) label += " · entry — no ingress";
        if (i === L.bands.length - 1) label += " · foundation — no egress";
        ctx.fillText(label, L.labelX, band.y);
      });
      if (L.isoBand) ctx.fillText(`isolated (${L.isoBand.count})`, L.labelX, L.isoBand.y);
      if (L.lanes) {
        ctx.textAlign = "center";
        ctx.font = `600 ${13 / view.s}px system-ui, sans-serif`;
        for (const lane of L.lanes) {
          ctx.fillStyle = C.sides[lane.key] ?? C.muted;
          ctx.fillText(lane.title, (lane.x0 + lane.x1) / 2, L.laneTop);
        }
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1 / view.s;
        ctx.setLineDash([4 / view.s, 5 / view.s]);
        for (let i = 0; i + 1 < L.lanes.length; i++) {
          const x = (L.lanes[i].x1 + L.lanes[i + 1].x0) / 2;
          ctx.beginPath();
          ctx.moveTo(x, L.laneTop + 14 / view.s);
          ctx.lineTo(x, L.laneBottom);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // edges
    ctx.lineCap = "round";
    for (const e of G.edges) {
      const a = nodes[e.f], b = nodes[e.t];
      const emphasized = hl ? hl.edge(e) : false;
      ctx.globalAlpha = hl && !emphasized ? 0.05 : e.cycle ? 0.9 : 0.45;
      ctx.strokeStyle = e.cycleReal ? C.critical : emphasized ? C.accent : e.cycle ? C.muted : C.edge;
      ctx.lineWidth = Math.min(4, 0.7 + 0.4 * Math.sqrt(e.w)) / view.s;
      if (e.kind === "type" || e.kind === "reference") ctx.setLineDash([5 / view.s, 4 / view.s]);
      else if (e.kind === "dynamic") ctx.setLineDash([2 / view.s, 4 / view.s]);
      else ctx.setLineDash([]);
      if (a === b) {
        // self-loop: small circle beside the node
        ctx.beginPath();
        ctx.arc(a.x + a.r + 4, a.y - a.r - 4, a.r * 0.9, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      // same-band edges (cycle members share a layer) bow below the band
      const sameBand = layoutMode === "layered" && Math.abs(a.y - b.y) < 0.5;
      const bowX = (a.x + b.x) / 2;
      const bowY = a.y + Math.min(70, 18 + Math.abs(b.x - a.x) * 0.12);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (sameBand) ctx.quadraticCurveTo(bowX, bowY, b.x, b.y);
      else ctx.lineTo(b.x, b.y);
      ctx.stroke();
      // direction arrows only when meaningfully zoomed or emphasized
      if ((emphasized || e.cycle || view.s > 1.2) && view.s > 0.35) {
        const sx = sameBand ? bowX : a.x, sy = sameBand ? bowY : a.y;
        const dx = b.x - sx, dy = b.y - sy;
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const px = b.x - ux * (b.r + 3), py = b.y - uy * (b.r + 3);
        const w = 4 / Math.sqrt(view.s);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - ux * w * 2 - uy * w, py - uy * w * 2 + ux * w);
        ctx.lineTo(px - ux * w * 2 + uy * w, py - uy * w * 2 - ux * w);
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
    }
    ctx.setLineDash([]);

    // nodes
    for (const n of nodes) {
      const kept = hl ? hl.nodes.has(n.i) : true;
      ctx.globalAlpha = kept ? 1 : 0.12;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor(n);
      ctx.fill();
      // 2px surface ring separates overlapping marks
      ctx.lineWidth = 2 / view.s;
      ctx.strokeStyle = C.surface;
      ctx.stroke();
      if (n.cycle >= 0) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 2.5 / view.s, 0, Math.PI * 2);
        ctx.strokeStyle = n.cycleReal ? C.critical : C.muted;
        ctx.lineWidth = 1.6 / view.s;
        ctx.stroke();
      }
      if (n.i === selected || n.i === (hover ?? -1)) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 4.5 / view.s, 0, Math.PI * 2);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2 / view.s;
        ctx.stroke();
      }
    }

    // labels: hubs when zoomed in, plus anything highlighted
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const fontPx = Math.max(10, 11 / view.s);
    ctx.font = `${fontPx}px ui-monospace, Menlo, monospace`;
    for (const n of nodes) {
      const kept = hl ? hl.nodes.has(n.i) : true;
      const zoomLabel = view.s * n.r > 9;
      if (!(kept && (zoomLabel || n.i === selected || n.i === hover || (hl && hl.nodes.size <= 40)))) continue;
      ctx.globalAlpha = 1;
      const text = n.label;
      const tw = ctx.measureText(text).width;
      const ly = n.y + n.r + 3 / view.s;
      ctx.fillStyle = C.surface;
      ctx.globalAlpha = 0.82;
      ctx.fillRect(n.x - tw / 2 - 2, ly - 1, tw + 4, fontPx + 3);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.ink2;
      ctx.fillText(text, n.x, ly);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- simulation loop ----
  let rafId = 0;
  function loop() {
    if (G && layoutMode === "force" && G.alpha > 0.02) {
      tick(G);
      draw();
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = 0;
      draw();
    }
  }
  function reheat(a) {
    if (!G) return;
    G.alpha = Math.max(G.alpha, a);
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  // ---- interaction ----
  let dragNode = null, panning = false, lastPos = null, moved = false, userTouched = false;

  function nodeAt(px, py) {
    const w = toWorld(px, py);
    let best = null, bestD = Infinity;
    for (const n of G.nodes) {
      const dx = n.x - w.x, dy = n.y - w.y;
      const d = Math.hypot(dx, dy);
      const hit = Math.max(n.r, 6 / view.s);
      if (d < hit && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  cv.addEventListener("pointerdown", (ev) => {
    cv.setPointerCapture(ev.pointerId);
    userTouched = true;
    const rect = cv.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const n = nodeAt(px, py);
    moved = false;
    lastPos = { x: px, y: py };
    if (n) { dragNode = n; n.fixed = true; }
    else { panning = true; cv.classList.add("dragging"); }
  });
  cv.addEventListener("pointermove", (ev) => {
    const rect = cv.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    if (dragNode) {
      const w = toWorld(px, py);
      dragNode.x = w.x; dragNode.y = w.y;
      moved = true;
      if (layoutMode === "force") reheat(0.12);
      else draw();
      return;
    }
    if (panning && lastPos) {
      view.tx += px - lastPos.x;
      view.ty += py - lastPos.y;
      lastPos = { x: px, y: py };
      moved = true;
      draw();
      return;
    }
    const n = nodeAt(px, py);
    hover = n ? n.i : null;
    cv.style.cursor = n ? "pointer" : "";
    if (n) {
      tip.style.display = "block";
      const flow = `${n.fanIn} in · ${n.fanOut} out`;
      const extra =
        G.key === "folder" ? `${n.fc} file${n.fc === 1 ? "" : "s"} · ${flow}` :
        G.key === "function" ? `${flow}${n.ln ? ` · line ${n.ln}` : ""}` : flow;
      const cyc =
        n.cycle >= 0
          ? n.cycleReal
            ? ` · <span style="color:var(--critical)">in cycle ${n.cycle}</span>`
            : ` · <span style="color:var(--muted)">in group loop ${n.cycle} (no real cycle)</span>`
          : "";
      const summary = n.ann?.summary ? `<div class="tmeta">${escapeHtml(n.ann.summary)}</div>` : "";
      tip.innerHTML = `<div class="tid">${escapeHtml(n.id)}</div>${summary}<div class="tmeta">${n.side} · ${AREAS.find(a => a.key === n.area).label} · ${extra}${cyc}</div>`;
      const tx = Math.min(px + 14, rect.width - 320);
      tip.style.left = Math.max(6, tx) + "px";
      tip.style.top = Math.min(py + 14, rect.height - 70) + "px";
    } else {
      tip.style.display = "none";
    }
    draw();
  });
  cv.addEventListener("pointerup", (ev) => {
    cv.classList.remove("dragging");
    if (dragNode) { dragNode.fixed = false; }
    if (!moved) {
      const rect = cv.getBoundingClientRect();
      const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top);
      selected = n ? n.i : null;
      selectedCycle = -1;
      renderCycleList();
      renderDetails();
      draw();
    }
    dragNode = null; panning = false; lastPos = null;
  });
  cv.addEventListener("pointerleave", () => { hover = null; tip.style.display = "none"; draw(); });

  // folder drill-down: double-click expands an aggregate, collapses otherwise
  function refreshFolders() {
    delete graphs.folder;
    if (G && G.key === "folder") activate("folder");
  }
  cv.addEventListener("dblclick", (ev) => {
    if (!G || G.key !== "folder") return;
    const rect = cv.getBoundingClientRect();
    const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top);
    if (!n) return;
    if (n.hidden > 0) {
      folderExpanded.add(n.id);
      refreshFolders();
      return;
    }
    if (folderExpanded.has(n.id)) {
      folderExpanded.delete(n.id);
      refreshFolders();
      return;
    }
    // collapse the deepest expanded ancestor this node came out of
    const parts = n.id.split("/");
    let target = null, prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? prefix + "/" + parts[i] : parts[i];
      if (folderExpanded.has(prefix)) target = prefix;
    }
    if (target) {
      folderExpanded.delete(target);
      refreshFolders();
    }
  });
  document.getElementById("reset-folders").addEventListener("click", () => {
    folderExpanded = new Set(["src"]);
    refreshFolders();
  });
  cv.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    userTouched = true;
    const rect = cv.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const factor = Math.exp(-ev.deltaY * 0.0015);
    const s = Math.min(8, Math.max(0.05, view.s * factor));
    view.tx = px - ((px - view.tx) / view.s) * s;
    view.ty = py - ((py - view.ty) / view.s) * s;
    view.s = s;
    draw();
  }, { passive: false });

  document.getElementById("fit").addEventListener("click", () => fitTo(G.nodes));
  document.getElementById("mode-layered").addEventListener("click", () => setMode("layered"));
  document.getElementById("mode-force").addEventListener("click", () => setMode("force"));
  document.getElementById("color-area").addEventListener("click", () => setColorMode("area"));
  document.getElementById("color-side").addEventListener("click", () => setColorMode("side"));
  document.getElementById("split-on").addEventListener("click", () => setSplit(true));
  document.getElementById("split-off").addEventListener("click", () => setSplit(false));
  document.getElementById("clear").addEventListener("click", clearSelection);
  function clearSelection() {
    selected = null; selectedCycle = -1; searchSet = null;
    document.getElementById("search").value = "";
    document.getElementById("hits").textContent = "";
    renderCycleList();
    renderDetails();
    draw();
  }

  function renderDetails() {
    const section = document.getElementById("details-section");
    const el = document.getElementById("details");
    if (selected == null) {
      section.style.display = "none";
      return;
    }
    const n = G.nodes[selected];
    const a = n.ann;
    const sideColor = C.sides[n.side] ?? C.muted;
    const rows = [];
    if (a?.summary) rows.push(`<div class="dsummary">${escapeHtml(a.summary)}</div>`);
    rows.push(
      `<div class="badges">` +
        `<span class="badge"><span class="swatch" style="background:${sideColor}"></span>${escapeHtml(n.side)}</span>` +
        (a?.pure ? `<span class="badge">pure</span>` : "") +
        `<span class="badge">${n.fanIn} in · ${n.fanOut} out</span>` +
        (n.cycle >= 0
          ? n.cycleReal
            ? `<span class="badge" style="color:var(--critical)">cycle ${n.cycle}</span>`
            : `<span class="badge">group loop ${n.cycle}</span>`
          : "") +
      `</div>`,
    );
    if (a?.inputs) rows.push(`<div class="drow"><div class="dlabel">Inputs</div><div class="dval">${escapeHtml(a.inputs)}</div></div>`);
    if (a?.outputs) rows.push(`<div class="drow"><div class="dlabel">Outputs</div><div class="dval">${escapeHtml(a.outputs)}</div></div>`);
    if (a?.should) rows.push(`<div class="drow"><div class="dlabel">Should</div><div class="dval">${escapeHtml(a.should)}</div></div>`);
    if (a?.shouldNot) rows.push(`<div class="drow"><div class="dlabel">Should not</div><div class="dval no">${escapeHtml(a.shouldNot)}</div></div>`);
    if (!a) rows.push(`<div class="drow"><div class="dval">No annotation for this node.</div></div>`);
    el.innerHTML = `<div class="dpath">${escapeHtml(n.id)}</div>` + rows.join("");
    section.style.display = "";
  }

  // ---- search ----
  const searchInput = document.getElementById("search");
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    selected = null; selectedCycle = -1;
    if (!q) { searchSet = null; document.getElementById("hits").textContent = ""; draw(); return; }
    searchSet = new Set(
      G.nodes
        .filter((n) => n.id.toLowerCase().includes(q) || n.ann?.summary?.toLowerCase().includes(q))
        .map((n) => n.i),
    );
    document.getElementById("hits").textContent = String(searchSet.size);
    renderCycleList();
    draw();
  });
  searchInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") clearSelection();
    if (ev.key === "Enter" && searchSet && searchSet.size) {
      fitTo([...searchSet].map((i) => G.nodes[i]));
    }
  });

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }

  // ---- sidebar ----
  function buildLegends() {
    const areasEl = document.getElementById("legend-areas");
    if (colorMode === "side") {
      document.getElementById("legend-title").textContent = "Side";
      areasEl.innerHTML = SIDES.map((s) =>
        `<div class="row"><span class="swatch" style="background:${C.sides[s.key]}"></span>${s.label}</div>`,
      ).join("");
    } else {
      document.getElementById("legend-title").textContent = "Areas";
      areasEl.innerHTML = AREAS.map((a) =>
        `<div class="row"><span class="swatch" style="background:${C.areas[a.key]}"></span>${a.label}</div>`,
      ).join("");
    }
    const level = LEVELS.find((l) => l.key === G.key);
    const dash = { value: "", call: "", type: "5 4", reference: "5 4", dynamic: "2 4" };
    const edgesEl = document.getElementById("legend-edges");
    edgesEl.innerHTML = level.kinds.map((k) =>
      `<div class="row"><svg class="linesample" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="${C.edge}" stroke-width="2" stroke-dasharray="${dash[k]}"/></svg>${k}</div>`,
    ).join("") +
      `<div class="row"><svg class="linesample" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="${C.critical}" stroke-width="2"/></svg>edge inside a cycle</div>` +
      (G.key === "folder"
        ? `<div class="row"><svg class="linesample" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="${C.muted}" stroke-width="2"/></svg>group loop (aggregate view only)</div>`
        : "");
  }

  function renderStats() {
    const el = document.getElementById("stats");
    const cyc = G.cycleReal.filter(Boolean).length;
    el.innerHTML =
      `<div class="stat"><div class="v">${G.nodes.length}</div><div class="k">nodes</div></div>` +
      `<div class="stat"><div class="v">${G.edges.length}</div><div class="k">edges</div></div>` +
      `<div class="stat${cyc ? " bad" : ""}"><div class="v">${cyc}</div><div class="k">cycles</div></div>`;
  }

  function renderCycleList() {
    const el = document.getElementById("cycles");
    if (!G.cycles.length) {
      el.innerHTML = `<div class="empty">None — this level is a DAG. 🎉</div>`;
      return;
    }
    el.innerHTML = "";
    if (!G.cycleReal.some(Boolean)) {
      const note = document.createElement("div");
      note.className = "empty";
      note.textContent =
        "No true cycles at this level — the loops below are mutual imports between collapsed groups (expand them to inspect).";
      el.appendChild(note);
    }
    G.cycles.forEach((members, ci) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(ci === selectedCycle));
      const first = G.nodes[members[0]];
      const desc = members.length === 1 ? `${first.label} (self)` :
        members.slice(0, 2).map((m) => G.nodes[m].label).join(" ⇄ ") + (members.length > 2 ? " …" : "");
      const real = G.cycleReal[ci];
      const badge = `<span class="cyc-badge"${real ? "" : ' style="background:var(--muted)"'}></span>`;
      const meta = `${members.length} node${members.length === 1 ? "" : "s"}${real ? "" : " · loop"}`;
      btn.innerHTML = `${badge}<span class="name">${escapeHtml(desc)}</span><span class="meta">${meta}</span>`;
      btn.addEventListener("click", () => {
        selected = null;
        selectedCycle = selectedCycle === ci ? -1 : ci;
        renderCycleList();
        if (selectedCycle >= 0) fitTo(members.map((m) => G.nodes[m]));
        draw();
      });
      el.appendChild(btn);
    });
  }

  function renderHubs() {
    const el = document.getElementById("hubs");
    const hubs = [...G.nodes].sort((a, b) => b.fanIn - a.fanIn).slice(0, 8).filter((n) => n.fanIn > 0);
    el.innerHTML = "";
    for (const n of hubs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `<span class="name" title="${escapeHtml(n.id)}">${escapeHtml(n.id)}</span><span class="meta">${n.fanIn} in</span>`;
      btn.addEventListener("click", () => {
        selected = n.i;
        selectedCycle = -1;
        renderCycleList();
        renderDetails();
        const rect = cv.getBoundingClientRect();
        view.s = Math.max(view.s, 1.2);
        view.tx = rect.width / 2 - n.x * view.s;
        view.ty = rect.height / 2 - n.y * view.s;
        draw();
      });
      el.appendChild(btn);
    }
  }

  // ---- tabs & boot ----
  const tabsEl = document.getElementById("tabs");
  LEVELS.forEach((level) => {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.type = "button";
    btn.role = "tab";
    btn.innerHTML = `${level.label}<span class="n">${DATA.levels[level.key].nodes.length}</span>`;
    btn.addEventListener("click", () => activate(level.key));
    btn.dataset.level = level.key;
    tabsEl.appendChild(btn);
  });

  function activate(key) {
    for (const b of tabsEl.children) b.setAttribute("aria-selected", String(b.dataset.level === key));
    if (!graphs[key]) graphs[key] = buildLevel(key);
    G = graphs[key];
    document.getElementById("reset-folders").hidden = key !== "folder";
    applyLayout();
    fitTo(G.nodes);
    if (layoutMode === "force" && G.alpha > 0.05) {
      // fit periodically while the simulation unfolds, unless the user takes over
      let fits = 0;
      userTouched = false;
      const interval = setInterval(() => {
        if (userTouched || ++fits > 6 || G.alpha < 0.05) { clearInterval(interval); return; }
        fitTo(G.nodes);
      }, 500);
    }
    selected = null; selectedCycle = -1; searchSet = null;
    searchInput.value = "";
    document.getElementById("hits").textContent = "";
    renderDetails();
    renderStats();
    buildLegends();
    renderCycleList();
    renderHubs();
    draw();
  }

  document.getElementById("rootpath").textContent = DATA.root + " · folder / file / function dependency graphs";
  resize();
  activate("folder");
})();
