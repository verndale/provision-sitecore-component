"use strict";

// Knowledge-graph gates: the committed graph.json and wiki/connections* pages are
// byte-fresh (a rebuild produces identical bytes), every edge endpoint resolves,
// wiki topic coverage holds, the routing policy is valid against the live graph,
// and the navigate router returns real routes for all three intents.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const {
  build,
  render,
  renderConnections,
  coverageProblems,
  OUT_FILE,
} = require("../scripts/graph/build-graph.cjs");
const { route, loadPolicy, policyProblems } = require("../scripts/graph/routing.cjs");

const graph = build();

test("committed graph.json is byte-fresh (run pnpm graph:build after content changes)", () => {
  assert.ok(fs.existsSync(OUT_FILE), "scripts/graph/data/graph.json is committed");
  assert.equal(fs.readFileSync(OUT_FILE, "utf8"), render(graph));
});

test("committed wiki/connections* pages are byte-fresh", () => {
  const files = renderConnections(graph);
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(REPO, relPath);
    assert.ok(fs.existsSync(abs), `${relPath} is committed`);
    assert.equal(fs.readFileSync(abs, "utf8"), content, `${relPath} is stale — run pnpm graph:build`);
  }
});

test("every edge endpoint resolves to a node", () => {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const dangling = graph.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
  assert.deepEqual(dangling, []);
});

test("wiki topic coverage problems are empty (skill covered, covers targets valid)", () => {
  assert.deepEqual(coverageProblems(graph), []);
});

test("routing policy is valid against the live graph", () => {
  assert.deepEqual(policyProblems(loadPolicy(), graph), []);
});

test("navigate router returns real routes for why / wiring / impact", () => {
  const why = route(graph, { intent: "why", query: "src/executor.cjs" });
  assert.equal(why.status, "ok", JSON.stringify(why));
  assert.equal(why.target.id, "wiki/topics/sitecore-provisioning.md", "why routes to the design-history topic");

  const wiring = route(graph, { intent: "wiring", query: "emit-tsx.cjs" });
  assert.equal(wiring.status, "ok", JSON.stringify(wiring));

  const impact = route(graph, { intent: "impact", query: "build-plan.cjs" });
  assert.equal(impact.status, "ok", JSON.stringify(impact));

  const ambiguous = route(graph, { intent: "why", query: "manifest" });
  assert.notEqual(ambiguous.status, "ok", "an ambiguous query reports instead of guessing");
});
