/* Knowledge-graph viewer. Loads data/graph.json and renders it with Sigma.js
 * (WebGL) over a graphology model. Node color = type, node size = degree.
 * Search + type filters and click-to-focus are driven by Sigma node/edge
 * reducers: applyView() recomputes which nodes are visible/active, then
 * refresh() re-runs the reducers. */
"use strict";

// Dark-friendly palette, one hue per node type.
const TYPE_COLORS = {
  skill: "#6ea8fe",
  "skill-readme": "#9ec5ff",
  reference: "#63c3a4",
  source: "#f2688f",
  test: "#e6c34a",
  automation: "#c58af9",
  "wiki-journal": "#5bd0d0",
  "wiki-topic": "#8fd14f",
  "wiki-plan": "#b0b6c4",
  "wiki-index": "#7a8296",
  "root-doc": "#ff8a5c",
  hook: "#b58b5a",
};
const TYPE_LABELS = {
  skill: "Skill",
  "skill-readme": "Skill README",
  reference: "Skill reference",
  source: "Source module",
  test: "Test suite",
  automation: "Automation script",
  "wiki-journal": "Wiki journal",
  "wiki-topic": "Wiki topic",
  "wiki-plan": "Wiki plan",
  "wiki-index": "Wiki index",
  "root-doc": "Root doc",
  hook: "Hook",
};
const EDGE_COLORS = {
  "links-to": "rgba(150,156,170,0.22)",
  references: "rgba(110,168,254,0.28)",
  topic: "rgba(143,209,79,0.4)",
  covers: "rgba(99,195,164,0.42)",
  plan: "rgba(91,208,208,0.45)",
  requires: "rgba(242,104,143,0.35)",
  invokes: "rgba(181,139,90,0.45)",
};
const DIM_NODE = "rgba(120,126,140,0.16)";
const DIM_EDGE = "rgba(120,126,140,0.05)";

const state = {
  graph: null, // parsed graph.json
  model: null, // graphology MultiGraph
  renderer: null, // Sigma
  raw: new Map(), // id -> raw node
  adjacency: new Map(), // id -> Set(neighbor id)
  hiddenTypes: new Set(),
  query: "",
  focus: null,
  visible: new Set(),
  matched: null, // Set or null (null = all)
  focusSet: null, // Set or null
  policy: null,
  route: null,
  routeNodes: null,
  routeEdges: null,
};

const $ = (sel) => document.querySelector(sel);

async function init() {
  const res = await fetch("/data/graph.json");
  if (!res.ok) {
    $("#stats").textContent = "Could not load data/graph.json — run `pnpm graph:build`.";
    return;
  }
  state.graph = await res.json();
  const policyRes = await fetch("/routing-policy.json");
  if (!policyRes.ok) {
    $("#stats").textContent = "Could not load routing policy — run pnpm graph:build.";
    return;
  }
  state.policy = await policyRes.json();
  buildIndexes();
  buildModel();
  buildRenderer();
  buildLegend();
  populateRouteSelects();
  wireControls();
  applyView();
  $("#stats").textContent = `${state.graph.counts.nodes} nodes · ${state.graph.counts.edges} edges`;
}

function buildIndexes() {
  for (const n of state.graph.nodes) {
    state.raw.set(n.id, n);
    state.adjacency.set(n.id, new Set());
    state.visible.add(n.id);
  }
  for (const e of state.graph.edges) {
    state.adjacency.get(e.source)?.add(e.target);
    state.adjacency.get(e.target)?.add(e.source);
  }
}

function nodeSize(degree) {
  return 3 + Math.sqrt(degree) * 1.7;
}

function buildModel() {
  const graph = new graphology.MultiGraph();
  for (const n of state.graph.nodes) {
    graph.addNode(n.id, {
      label: n.label,
      size: nodeSize(n.degree),
      color: TYPE_COLORS[n.type] || "#888",
      nodeType: n.type,
      searchKey: `${n.label} ${n.id}`.toLowerCase(),
      x: 0,
      y: 0,
    });
  }
  let eid = 0;
  for (const e of state.graph.edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    graph.addEdgeWithKey(`e${eid++}`, e.source, e.target, {
      edgeType: e.type,
      routeKey: window.KGRouting.edgeKey(e),
      size: e.type === "links-to" ? Math.min(0.6 + (e.count || 1) * 0.3, 3) : 0.8,
      color: EDGE_COLORS[e.type] || DIM_EDGE,
    });
  }

  // Seed positions on a circle, then settle with ForceAtlas2.
  graphologyLibrary.layout.circular.assign(graph);
  const settings = graphologyLibrary.layoutForceAtlas2.inferSettings(graph);
  graphologyLibrary.layoutForceAtlas2.assign(graph, { iterations: 300, settings });

  state.model = graph;
}

function buildRenderer() {
  state.renderer = new Sigma(state.model, $("#graph"), {
    labelColor: { color: "#c9cede" },
    labelSize: 12,
    labelWeight: "500",
    labelDensity: 0.5,
    labelGridCellSize: 70,
    labelRenderedSizeThreshold: 7,
    defaultEdgeType: "line",
    zIndex: true,
    nodeReducer,
    edgeReducer,
  });

  state.renderer.on("clickNode", ({ node }) => selectNode(node));
  state.renderer.on("clickStage", () => clearFocus());
}

function nodeReducer(node, data) {
  if (state.routeNodes?.has(node)) return { ...data, size: data.size + 2, zIndex: 2 };
  if (!state.visible.has(node)) return { ...data, hidden: true };
  if (state.routeNodes && !state.routeNodes.has(node)) return { ...data, color: DIM_NODE, label: "", zIndex: 0 };
  const active =
    (!state.matched || state.matched.has(node)) &&
    (!state.focusSet || state.focusSet.has(node));
  if (active) return { ...data, zIndex: 1 };
  return { ...data, color: DIM_NODE, label: "", zIndex: 0 };
}

function edgeReducer(edge, data) {
  const [s, t] = state.model.extremities(edge);
  if (state.routeEdges?.has(data.routeKey)) {
    return { ...data, size: 2.5, color: "rgba(255, 196, 80, 0.95)", zIndex: 2 };
  }
  if (!state.visible.has(s) || !state.visible.has(t)) return { ...data, hidden: true };
  if (state.routeEdges) {
    return { ...data, hidden: true };
  }
  const inFocus = !state.focusSet || state.focusSet.has(s) || state.focusSet.has(t);
  const inSearch = !state.matched || state.matched.has(s) || state.matched.has(t);
  if (inFocus && inSearch) return data;
  return { ...data, color: DIM_EDGE, zIndex: 0 };
}

// Recompute visible / matched / focusSet, then re-run the reducers.
function applyView() {
  state.visible = new Set();
  for (const n of state.graph.nodes) if (!state.hiddenTypes.has(n.type)) state.visible.add(n.id);

  if (state.query) {
    state.matched = new Set();
    for (const n of state.graph.nodes) {
      if (n.label.toLowerCase().includes(state.query) || n.id.toLowerCase().includes(state.query)) {
        state.matched.add(n.id);
      }
    }
  } else {
    state.matched = null;
  }

  state.focusSet = state.focus ? new Set([state.focus, ...state.adjacency.get(state.focus)]) : null;
  state.renderer.refresh();
}

function buildLegend() {
  const counts = state.graph.counts.byType;
  const legend = $("#legend");
  legend.innerHTML = "";
  for (const type of Object.keys(TYPE_LABELS)) {
    if (!counts[type]) continue;
    const item = document.createElement("div");
    item.className = "legend-item";
    item.dataset.type = type;
    item.innerHTML =
      `<span class="swatch" style="background:${TYPE_COLORS[type]}"></span>` +
      `<span>${TYPE_LABELS[type]}</span><span class="count">${counts[type]}</span>`;
    item.addEventListener("click", () => toggleType(type, item));
    legend.appendChild(item);
  }
}

function toggleType(type, item) {
  if (state.hiddenTypes.has(type)) {
    state.hiddenTypes.delete(type);
    item.classList.remove("off");
  } else {
    state.hiddenTypes.add(type);
    item.classList.add("off");
  }
  applyView();
}

function populateRouteSelects() {
  const nodes = [...state.graph.nodes].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  for (const selector of ["#route-from", "#route-to"]) {
    const select = $(selector);
    select.innerHTML = `<option value="">${selector === "#route-from" ? "Source…" : "Target…"}</option>`;
    for (const node of nodes) {
      const option = document.createElement("option");
      option.value = node.id;
      option.textContent = `${node.label} — ${node.id}`;
      select.appendChild(option);
    }
  }
}

function renderRoutePanel() {
  if (!state.route) return;
  $("#p-label").textContent = "Shortest route";
  $("#node-panel").classList.add("hidden");
  const list = $("#p-route");
  list.innerHTML = "";
  for (const [index, id] of state.route.nodes.entries()) {
    const item = state.raw.get(id);
    const li = document.createElement("li");
    const relation = index === 0 ? "start" : `${state.route.steps[index - 1].direction === "forward" ? "→" : "←"} ${state.route.steps[index - 1].edge.type}`;
    li.textContent = `${item.label} (${relation})`;
    li.addEventListener("click", () => selectNode(id));
    list.appendChild(li);
  }
  $("#route-panel").classList.remove("hidden");
  $("#panel").classList.remove("hidden");
}

function showRoute() {
  const source = $("#route-from").value;
  const target = $("#route-to").value;
  const status = $("#route-status");
  if (!source || !target) {
    status.textContent = "Choose a source and target.";
    return;
  }
  if (!window.KGRouting.hasSafeNumericPolicy(state.policy)) {
    status.textContent = "Routing policy is invalid; rebuild the graph policy before routing.";
    return;
  }
  const route = window.KGRouting.shortestPath(state.graph, source, target, state.policy);
  if (!route) {
    state.route = null;
    state.routeNodes = null;
    state.routeEdges = null;
    status.textContent = "No permitted route found.";
    $("#route-panel").classList.add("hidden");
    applyView();
    return;
  }
  state.route = route;
  state.routeNodes = new Set(route.nodes);
  state.routeEdges = new Set(route.steps.map((step) => window.KGRouting.edgeKey(step.edge)));
  state.focus = null;
  status.textContent = `${route.nodes.length} nodes · cost ${route.cost}`;
  applyView();
  renderRoutePanel();
}

function wireControls() {
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    applyView();
  });
  $("#reset").addEventListener("click", () => {
    state.query = "";
    $("#search").value = "";
    state.hiddenTypes.clear();
    document.querySelectorAll(".legend-item.off").forEach((el) => el.classList.remove("off"));
    state.focus = null;
    state.route = null;
    state.routeNodes = null;
    state.routeEdges = null;
    $("#route-from").value = "";
    $("#route-to").value = "";
    $("#route-status").textContent = "";
    $("#route-panel").classList.add("hidden");
    $("#panel").classList.add("hidden");
    applyView();
    state.renderer.getCamera().animatedReset();
  });
  $("#toggle-all").addEventListener("click", () => {
    const anyOn = state.hiddenTypes.size < Object.keys(TYPE_LABELS).length;
    document.querySelectorAll(".legend-item").forEach((el) => {
      const t = el.dataset.type;
      if (anyOn) {
        state.hiddenTypes.add(t);
        el.classList.add("off");
      } else {
        state.hiddenTypes.delete(t);
        el.classList.remove("off");
      }
    });
    applyView();
  });
  $("#panel-close").addEventListener("click", clearFocus);
  $("#show-route").addEventListener("click", showRoute);
}

function selectNode(id) {
  state.focus = id;
  applyView();
  renderPanel(id);
  const cam = state.renderer.getCamera();
  cam.animate(state.renderer.getNodeDisplayData(id), { duration: 500 });
}

function clearFocus() {
  state.focus = null;
  if (state.route) renderRoutePanel();
  else $("#panel").classList.add("hidden");
  applyView();
}

function renderPanel(id) {
  const n = state.raw.get(id);
  if (!n) return;
  $("#node-panel").classList.remove("hidden");
  $("#p-label").textContent = n.label;
  const typeBadge = $("#p-type");
  typeBadge.textContent = TYPE_LABELS[n.type] || n.type;
  typeBadge.style.background = TYPE_COLORS[n.type] || "#888";
  typeBadge.style.color = "#14161b";
  typeBadge.style.borderColor = "transparent";

  const meta = $("#p-meta");
  meta.innerHTML = "";
  const row = (dt, ddHtml) => meta.insertAdjacentHTML("beforeend", `<dt>${dt}</dt><dd>${ddHtml}</dd>`);
  row("Path", `<code>${n.id}</code>`);
  row("Connections", String(n.degree));
  if (n.topics.length) row("Topics", n.topics.join(", "));
  if (n.prs.length) row("PRs", n.prs.map((p) => `#${p}`).join(", "));
  if (n.issues.length) row("Issues", n.issues.map((p) => `#${p}`).join(", "));

  const neighbors = [...state.adjacency.get(id)]
    .map((nid) => state.raw.get(nid))
    .filter(Boolean)
    .sort((a, b) => b.degree - a.degree);
  const list = $("#p-neighbors");
  list.innerHTML = "";
  for (const nb of neighbors) {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="swatch" style="background:${TYPE_COLORS[nb.type] || "#888"}"></span>` +
      `<span>${nb.label}</span><span class="rel">${TYPE_LABELS[nb.type] || nb.type}</span>`;
    li.addEventListener("click", () => selectNode(nb.id));
    list.appendChild(li);
  }

  $("#panel").classList.remove("hidden");
}

// Console handle for scripted exploration: KG.select('<node id>'), KG.reset().
window.KG = { select: (id) => selectNode(id), reset: () => clearFocus() };

// Sigma throws when its container has no dimensions yet (a cold-load race in
// embedded/small viewports), and an async throw would stall the page at
// "loading…" silently. Wait for layout to size the container, then surface any
// startup failure in the stats line instead of swallowing it.
function start(attempts = 0) {
  const container = $("#graph");
  if ((container.clientWidth === 0 || container.clientHeight === 0) && attempts < 60) {
    requestAnimationFrame(() => start(attempts + 1));
    return;
  }
  init().catch((err) => {
    $("#stats").textContent = `Failed to start: ${err && err.message ? err.message : err}`;
  });
}
start();
