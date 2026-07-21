#!/usr/bin/env node
"use strict";

// Knowledge-graph builder. Walks the repo and emits a typed node/edge graph to
// scripts/graph/data/graph.json for the interactive viewer (scripts/graph/viewer/),
// plus the generated wiki/connections* pages. Ported from ai-orchestration's
// scripts/graph/build-graph.cjs with discovery adapted to this repo's layout.
//
// Nodes  = knowledge units: the skill and its references, source modules, test
//          suites, automation scripts, lifecycle hooks, wiki pages, root docs — one node per file.
// Edges  = relationships already latent in the content:
//   links-to   relative markdown link between two node files (count = weight)
//   references the skill's SKILL.md -> each file under its own references/ tree
//   topic      a wiki page -> topics/<slug>.md (from frontmatter `topics:`)
//   plan       a wiki journal entry -> its archived plan (from frontmatter `plan:`)
//   covers     a wiki topic -> the runtime surfaces declared in its `covers:` metadata
//   requires   a .cjs node -> another .cjs node it require()s (relative paths only)
//   invokes    a hook node -> an in-repo script it runs (git, release, agent-guard hooks)
//
// Everything is derived deterministically from the files — no guessing, no LLM.
// Output is timestamp-free so a rebuild only diffs when the content graph changes.

const fs = require("fs");
const path = require("path");
const frontmatter = require("../wiki/lib/frontmatter.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_FILE = path.join(__dirname, "data", "graph.json");
// The generated governance-connections pages (a view of the graph, rendered into the
// wiki as a small index at wiki/connections.md plus per-section files under
// wiki/connections/). Excluded from the graph itself — otherwise their many links would
// become links-to edges, making them mega-nodes and coupling the graph to its own view.
const CONNECTIONS_INDEX_ID = "wiki/connections.md";
const CONNECTIONS_DIR_ID = "wiki/connections";
const isConnectionsView = (id) => id === CONNECTIONS_INDEX_ID || id.startsWith(`${CONNECTIONS_DIR_ID}/`);

// Root docs promoted to their own node type.
const ROOT_DOCS = new Set(["README.md", "CONTRIBUTING.md", "AGENTS.md", "CLAUDE.md"]);
// Non-.cjs automation entrypoints included by explicit path.
const AUTOMATION_FILES = new Set(["setup.sh"]);
// Lifecycle hook config surfaces — git hooks, the release plugin chain, and the agent
// PreToolUse guards. Extensionless (.husky/*), dot-dir (.claude/.codex), or repo-root
// (.releaserc.cjs) files the generic walk() can't reach, so included by explicit path.
const HOOK_FILES = new Set([
  ".husky/pre-commit",
  ".husky/pre-push",
  ".husky/commit-msg",
  ".husky/prepare-commit-msg",
  ".releaserc.cjs",
  ".claude/settings.json",
  ".codex/hooks.json",
]);

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const REQUIRE_RE = /require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
// In-repo scripts a hook runs: `node scripts/….cjs` (husky, .codex/hooks.json) or a
// './scripts/….cjs' / "$CLAUDE_PROJECT_DIR/scripts/….cjs" reference (.releaserc.cjs,
// .claude/settings.json). The captured repo path is resolved against known nodes, so an
// `invokes` edge is grounded in the file — external tooling (ai-commit) yields no match.
const HOOK_INVOKE_RE = /(scripts\/[A-Za-z0-9._/-]+\.cjs)/g;
const FENCE_RE = /^```/;
const H1_RE = /^#\s+(.+?)\s*$/;
const PR_RE = /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/g;
const ISSUE_RE = /github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/g;

const toPosix = (p) => p.split(path.sep).join("/");
const rel = (abs) => toPosix(path.relative(REPO_ROOT, abs));

// Same skip rules as the skills-lint link check: external, anchors, template vars, placeholders.
function isSkippable(target) {
  return (
    target === "" ||
    target.startsWith("#") ||
    /^(https?:|mailto:)/.test(target) ||
    target.includes("${") ||
    target.includes("<") ||
    target.includes("...") ||
    target.startsWith("/")
  );
}

// Recursively collect files under `target` (a dir or file), skipping node_modules,
// dotfiles, _meta/ authoring templates, and the viewer's vendored JS.
function walk(target, exts) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return [];
  }
  if (stat.isFile()) return exts.some((e) => target.endsWith(e)) ? [target] : [];
  const out = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "_meta" || entry.name === "vendor" || entry.name.startsWith(".")) continue;
    const p = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, exts));
    else if (entry.isFile() && exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

// Map a repo-relative posix path to a node type, or null to skip it.
function typeOf(r) {
  if (ROOT_DOCS.has(r)) return "root-doc";
  if (AUTOMATION_FILES.has(r)) return "automation";
  if (HOOK_FILES.has(r)) return "hook";

  if (r.startsWith("skills/")) {
    if (r.endsWith("/SKILL.md")) return "skill";
    if (r.endsWith("/README.md")) return "skill-readme";
    if (r.endsWith(".md")) return "reference";
    return null;
  }

  if (/^src\/[^/]+\.cjs$/.test(r)) return "source";
  if (/^test\/[^/]+\.cjs$/.test(r)) return "test";
  if (/^scripts\/(wiki|release|graph|evals|hooks)\/.+\.cjs$/.test(r)) return "automation";

  if (r.startsWith("wiki/")) {
    if (r.endsWith(".md") === false) return null;
    if (path.basename(r) === "INDEX.md" || path.basename(r) === "MECHANICS.md") return "wiki-index";
    if (r.startsWith("wiki/journal/")) return "wiki-journal";
    if (r.startsWith("wiki/topics/")) return "wiki-topic";
    if (r.startsWith("wiki/plans/")) return "wiki-plan";
    return "wiki-index";
  }
  return null;
}

function extractLabel(r, type, text) {
  if (type === "skill") {
    const name = frontmatter.readField(text, "name");
    if (name) return name;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(H1_RE);
    if (m) return m[1].replace(/`/g, "");
  }
  return path.basename(r);
}

function uniqueMatches(text, re) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// Extract resolvable relative markdown-link targets (repo-relative posix), skipping
// fenced code blocks and non-local targets.
function extractLinks(absFile, text) {
  const targets = [];
  const lines = text.split(/\r?\n/);
  let fenced = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(line)) !== null) {
      const full = m[1].trim();
      const raw = full.split("#")[0].split(" ")[0];
      if (isSkippable(raw)) continue;
      const resolvedAbs = path.resolve(path.dirname(absFile), raw);
      targets.push({ target: rel(resolvedAbs), anchor: full.includes("#") ? full.split("#")[1] : null });
    }
  }
  return targets;
}

function build({ repoRoot = REPO_ROOT } = {}) {
  const roots = [
    path.join(repoRoot, "skills"),
    path.join(repoRoot, "src"),
    path.join(repoRoot, "test"),
    path.join(repoRoot, "scripts"),
    path.join(repoRoot, "wiki"),
    ...[...ROOT_DOCS].map((d) => path.join(repoRoot, d)),
    ...[...AUTOMATION_FILES].map((d) => path.join(repoRoot, d)),
  ];

  // Hook config surfaces can't be reached by walk() (dot-dirs, extensionless, non-.md/.cjs/.sh),
  // so include them by explicit path when present.
  const hookFiles = [...HOOK_FILES].map((h) => path.join(repoRoot, h)).filter((abs) => fs.existsSync(abs));
  const absFiles = [...new Set([...roots.flatMap((rt) => walk(rt, [".md", ".cjs", ".sh"])), ...hookFiles])];

  const nodes = new Map(); // id -> node
  const fileText = new Map(); // id -> raw text

  for (const abs of absFiles) {
    const id = rel(abs);
    if (isConnectionsView(id)) continue; // the generated view is never a node in the graph
    const type = typeOf(id);
    if (!type) continue;
    const text = fs.readFileSync(abs, "utf8");
    fileText.set(id, text);
    const isMd = id.endsWith(".md");
    const label = isMd ? extractLabel(id, type, text) : path.basename(id);
    nodes.set(id, {
      id,
      label,
      type,
      dir: toPosix(path.dirname(id)),
      topics: isMd ? frontmatter.readList(text, "topics") : [],
      aliases: isMd ? frontmatter.readList(text, "aliases") : [],
      prs: isMd ? uniqueMatches(text, PR_RE) : [],
      issues: isMd ? uniqueMatches(text, ISSUE_RE) : [],
      bytes: Buffer.byteLength(text, "utf8"),
      degree: 0,
    });
  }

  const edges = [];
  const linkCounts = new Map(); // `${src}\u0000${tgt}` -> {count, anchors:Set}

  // 1. links-to — relative markdown links between two known node files.
  for (const [id, text] of fileText) {
    if (!id.endsWith(".md")) continue;
    for (const { target, anchor } of extractLinks(path.join(repoRoot, id), text)) {
      if (target === id || !nodes.has(target)) continue;
      const key = `${id}\u0000${target}`;
      let entry = linkCounts.get(key);
      if (!entry) {
        entry = { count: 0, anchors: new Set() };
        linkCounts.set(key, entry);
      }
      entry.count += 1;
      if (anchor) entry.anchors.add(anchor);
    }
  }
  for (const [key, { count, anchors }] of linkCounts) {
    const [source, target] = key.split("\u0000");
    edges.push({ source, target, type: "links-to", count, anchors: [...anchors] });
  }

  // 2. references — the skill's SKILL.md -> each file under its own references/ tree.
  for (const id of nodes.keys()) {
    if (!id.endsWith("/SKILL.md")) continue;
    const skillDir = id.slice(0, -"/SKILL.md".length);
    const refPrefix = `${skillDir}/references/`;
    for (const target of nodes.keys()) {
      if (target.startsWith(refPrefix)) edges.push({ source: id, target, type: "references" });
    }
  }

  // 3. topic / 4. plan / 5. covers — wiki frontmatter relations.
  for (const [id, text] of fileText) {
    if (!id.startsWith("wiki/")) continue;
    for (const slug of frontmatter.readList(text, "topics")) {
      const target = `wiki/topics/${slug}.md`;
      if (nodes.has(target) && target !== id) edges.push({ source: id, target, type: "topic" });
    }
    const planField = frontmatter.readField(text, "plan");
    if (planField && planField !== "none") {
      const candidate = planField.startsWith("wiki/") ? planField : `wiki/${planField.replace(/^\.?\//, "")}`;
      if (nodes.has(candidate)) edges.push({ source: id, target: candidate, type: "plan" });
    }
    if (nodes.get(id)?.type === "wiki-topic") {
      for (const target of frontmatter.readList(text, "covers")) {
        // Preserve unresolved targets so the integrity gate can fail loudly instead
        // of silently dropping a stale topic-to-runtime declaration.
        edges.push({ source: id, target, type: "covers" });
      }
    }
  }

  // 6. requires — a .cjs node -> another .cjs node it require()s (relative paths only).
  //    This is the runtime dependency wiring: tests -> the modules they exercise,
  //    modules -> shared helpers, automation -> its libs. Grounded, not guessed.
  const seenRequires = new Set();
  for (const [id, text] of fileText) {
    if (!id.endsWith(".cjs")) continue;
    for (const raw of uniqueMatches(text, REQUIRE_RE)) {
      const resolved = rel(path.resolve(path.dirname(path.join(repoRoot, id)), raw));
      const target = nodes.has(resolved) ? resolved : nodes.has(`${resolved}.cjs`) ? `${resolved}.cjs` : null;
      if (!target || target === id) continue;
      const key = `${id}\u0000${target}`;
      if (seenRequires.has(key)) continue;
      seenRequires.add(key);
      edges.push({ source: id, target, type: "requires" });
    }
  }

  // 7. invokes — a hook node -> the in-repo script(s) it runs. Git hooks and the agent-guard
  //    configs name scripts via `node scripts/…`; the release config lists a local plugin path.
  //    External tooling (ai-commit, @semantic-release/*) has no node, so those hooks get no edge.
  for (const [id, text] of fileText) {
    if (nodes.get(id)?.type !== "hook") continue;
    for (const target of uniqueMatches(text, HOOK_INVOKE_RE)) {
      if (nodes.has(target) && target !== id) edges.push({ source: id, target, type: "invokes" });
    }
  }

  // Degree.
  for (const e of edges) {
    if (nodes.has(e.source)) nodes.get(e.source).degree += 1;
    if (nodes.has(e.target)) nodes.get(e.target).degree += 1;
  }

  const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const edgeList = edges.sort(
    (a, b) => a.type.localeCompare(b.type) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );

  const byType = {};
  for (const n of nodeList) byType[n.type] = (byType[n.type] || 0) + 1;
  const byEdge = {};
  for (const e of edgeList) byEdge[e.type] = (byEdge[e.type] || 0) + 1;

  return {
    counts: { nodes: nodeList.length, edges: edgeList.length, byType, byEdgeType: byEdge },
    nodes: nodeList,
    edges: edgeList,
  };
}

const COVERABLE_TYPES = new Set(["skill", "skill-readme", "reference", "source", "test", "automation", "root-doc"]);

function coverageProblems(graph) {
  const problems = [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const covers = graph.edges.filter((edge) => edge.type === "covers");

  for (const edge of covers) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source) problems.push(`covers edge has unresolved source ${edge.source}`);
    else if (source.type !== "wiki-topic") problems.push(`covers source must be a wiki-topic: ${edge.source}`);
    if (!target) problems.push(`covers edge has unresolved target ${edge.target}`);
    else if (!COVERABLE_TYPES.has(target.type)) problems.push(`covers target must be a runtime surface: ${edge.target}`);
  }

  const coveredSkills = new Set(
    covers
      .filter((edge) => byId.get(edge.source)?.type === "wiki-topic" && byId.get(edge.target)?.type === "skill")
      .map((edge) => edge.target),
  );
  for (const skill of graph.nodes.filter((node) => node.type === "skill")) {
    if (!coveredSkills.has(skill.id)) problems.push(`first-class skill has no wiki topic coverage: ${skill.id}`);
  }
  return problems;
}

// Canonical serialization — the exact bytes graph:build writes. Shared with the
// graph-freshness test so builder and checker never disagree on formatting.
function render(graph) {
  return JSON.stringify(graph, null, 2) + "\n";
}

// Coarse "area" for cross-subsystem filtering: the skill, src, test, scripts, wiki,
// and root docs are areas. A links-to edge is a seam when its endpoints sit in
// different areas.
function areaOf(id) {
  if (id.startsWith("skills/")) return "skill:" + id.split("/")[1];
  if (id.startsWith("src/")) return "src";
  if (id.startsWith("test/")) return "test";
  if (id.startsWith("scripts/") || AUTOMATION_FILES.has(id)) return "scripts";
  if (id.startsWith("wiki/")) return "wiki";
  return "root";
}

// Render the curated wiring as a set of human/agent-readable markdown pages: a small
// index at wiki/connections.md that routes to five per-section files under
// wiki/connections/. Node links from a section file resolve to the repo root via
// `../../<id>`; the index's links use `../<id>`. Deterministic + timestamp-free.
function renderConnections(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const linkTo = (prefix) => (id) => {
    const n = byId.get(id);
    const label = (n ? n.label : path.basename(id)).replace(/[[\]]/g, "");
    return `[${label}](${prefix}${id})`;
  };
  const link = linkTo("../../");
  const edgesOf = (t) => graph.edges.filter((e) => e.type === t);
  const finish = (lines) => lines.join("\n").replace(/\n*$/, "") + "\n";

  const head = (title, desc) => [
    `# Connections — ${title}`,
    "",
    desc,
    "",
    "Part of the [wiring map](../connections.md), generated from the knowledge graph — **do not edit by hand**. Rebuilt on every `pnpm graph:build` and verified fresh by `pnpm test`.",
    "",
  ];

  // Tests ↔ source
  const testsSource = () => {
    const out = head("Tests and source modules", "Which test suites exercise each source module (require() edges).");
    const sources = graph.nodes.filter((n) => n.type === "source").sort((a, b) => a.id.localeCompare(b.id));
    const requires = edgesOf("requires");
    for (const s of sources) {
      const suites = requires
        .filter((e) => e.target === s.id && byId.get(e.source)?.type === "test")
        .map((e) => e.source)
        .sort();
      out.push(suites.length ? `- ${link(s.id)} ← ${suites.map(link).join(", ")}` : `- ${link(s.id)} — no test suite requires it directly`);
    }
    return finish(out);
  };

  // Skill → references
  const skillsReferences = () => {
    const out = head("The skill and its references", "The skill and the references under its own `references/` tree.");
    const skills = graph.nodes.filter((n) => n.type === "skill").sort((a, b) => a.id.localeCompare(b.id));
    const refEdges = edgesOf("references");
    for (const s of skills) {
      const refs = refEdges.filter((e) => e.source === s.id).map((e) => e.target).sort();
      out.push(`- ${link(s.id)} — ${refs.length} reference${refs.length === 1 ? "" : "s"}`);
      for (const r of refs) out.push(`  - ${link(r)}`);
    }
    return finish(out);
  };

  // Wiki topics → runtime surfaces
  const topicsRuntime = () => {
    const out = head(
      "Wiki topics and runtime surfaces",
      "Each design-history topic and the runtime skill, source, or supporting surfaces it explicitly covers.",
    );
    const topics = graph.nodes.filter((n) => n.type === "wiki-topic").sort((a, b) => a.id.localeCompare(b.id));
    const coverEdges = edgesOf("covers");
    for (const topic of topics) {
      const targets = coverEdges.filter((edge) => edge.source === topic.id).map((edge) => edge.target).sort();
      out.push(`- ${link(topic.id)} — ${targets.length} runtime surface${targets.length === 1 ? "" : "s"}`);
      for (const target of targets) out.push(`  - ${link(target)}`);
    }
    return finish(out);
  };

  // Cross-subsystem links (seams)
  const seams = () => {
    const out = head(
      "Cross-subsystem links",
      "Markdown links whose source and target live in different areas — the seams between subsystems.",
    );
    const cross = edgesOf("links-to")
      .filter((e) => areaOf(e.source) !== areaOf(e.target))
      .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
    for (const e of cross) {
      out.push(`- ${link(e.source)} → ${link(e.target)}${e.count > 1 ? ` (×${e.count})` : ""}`);
    }
    return finish(out);
  };

  // Hooks → the scripts they run
  const hooksScripts = () => {
    const out = head(
      "Hooks and the scripts they run",
      "Each git hook (`.husky/`), the release hook chain (`.releaserc.cjs`), and the agent PreToolUse guards (`.claude/settings.json`, `.codex/hooks.json`) — and the in-repo scripts it invokes.",
    );
    const hooks = graph.nodes.filter((n) => n.type === "hook").sort((a, b) => a.id.localeCompare(b.id));
    const invokes = edgesOf("invokes");
    for (const h of hooks) {
      const scripts = invokes.filter((e) => e.source === h.id).map((e) => e.target).sort();
      out.push(
        scripts.length
          ? `- ${link(h.id)} → ${scripts.map(link).join(", ")}`
          : `- ${link(h.id)} — delegates to external tooling (no in-repo script)`,
      );
    }
    return finish(out);
  };

  const index = () =>
    finish([
      "# Connections — wiring map",
      "",
      "Generated from the knowledge graph ([`scripts/graph/build-graph.cjs`](../scripts/graph/build-graph.cjs)) — **do not edit by hand**.",
      "Rebuilt on every `pnpm graph:build` and verified fresh by `pnpm test`. It maps how the repo's",
      "skill, source modules, tests, and wiki wire together — the curated edges only; ordinary",
      "same-area cross-links are omitted (open the graph viewer with `pnpm graph:view` for the full picture).",
      "",
      "This is a small index — open the section your question needs:",
      "",
      "- [Tests and source modules](connections/tests-source.md) — which test suites exercise each source module.",
      "- [The skill and its references](connections/skills-references.md) — the skill and the references under its own `references/` tree.",
      "- [Wiki topics and runtime surfaces](connections/topics-runtime.md) — the runtime surfaces each history topic explicitly covers.",
      "- [Cross-subsystem links](connections/seams.md) — markdown links whose source and target live in different areas: the seams between subsystems.",
      "- [Hooks and the scripts they run](connections/hooks.md) — each git, release, and agent-guard hook and the in-repo scripts it invokes.",
    ]);

  return {
    [CONNECTIONS_INDEX_ID]: index(),
    [`${CONNECTIONS_DIR_ID}/tests-source.md`]: testsSource(),
    [`${CONNECTIONS_DIR_ID}/skills-references.md`]: skillsReferences(),
    [`${CONNECTIONS_DIR_ID}/topics-runtime.md`]: topicsRuntime(),
    [`${CONNECTIONS_DIR_ID}/seams.md`]: seams(),
    [`${CONNECTIONS_DIR_ID}/hooks.md`]: hooksScripts(),
  };
}

function run() {
  const graph = build();

  // Integrity gate: every edge endpoint must resolve to a node. Check before writing so
  // a broken graph never overwrites the committed artifacts.
  const ids = new Set(graph.nodes.map((n) => n.id));
  const dangling = graph.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
  if (dangling.length) {
    console.error(`FAIL: ${dangling.length} edge(s) with unresolved endpoints.`);
    for (const d of dangling.slice(0, 10)) console.error(`  ${d.type} ${d.source} -> ${d.target}`);
    process.exit(1);
  }
  const coverage = coverageProblems(graph);
  if (coverage.length) {
    console.error(`FAIL: ${coverage.length} wiki topic coverage problem(s).`);
    for (const problem of coverage.slice(0, 20)) console.error(`  ${problem}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, render(graph));

  const connFiles = renderConnections(graph);
  for (const [relPath, content] of Object.entries(connFiles)) {
    const abs = path.join(REPO_ROOT, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  console.log(`Knowledge graph → ${rel(OUT_FILE)}`);
  console.log(`Connections pages → ${Object.keys(connFiles).length} files (index + sections under ${CONNECTIONS_DIR_ID}/)`);
  console.log(`  nodes: ${graph.counts.nodes}   edges: ${graph.counts.edges}`);
  const fmt = (obj) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
  console.log(`  node types: ${fmt(graph.counts.byType)}`);
  console.log(`  edge types: ${fmt(graph.counts.byEdgeType)}`);
}

if (require.main === module) run();

module.exports = {
  build,
  render,
  renderConnections,
  coverageProblems,
  typeOf,
  extractLinks,
  extractLabel,
  areaOf,
  OUT_FILE,
  REPO_ROOT,
  CONNECTIONS_INDEX_ID,
  CONNECTIONS_DIR_ID,
  COVERABLE_TYPES,
};
