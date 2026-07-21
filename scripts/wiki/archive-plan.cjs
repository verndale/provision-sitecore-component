#!/usr/bin/env node
"use strict";

// Archive an approved Claude/Codex plan into wiki/plans/. File-backed plans and
// explicitly named Codex session plans share the same body-first archive path.

const fs = require("node:fs");
const path = require("node:path");
const { slugify, updatePlanTotals } = require("./lib/wiki-io.cjs");
const { digestFor, extractSession } = require("./lib/codex-plans.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const a = { topics: [], evidence: [], wiki: path.join(REPO_ROOT, "wiki"), sourceTool: null };
  a.plan = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
  for (let i = a.plan ? 1 : 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--status") a.status = argv[++i];
    else if (key === "--topics") a.topics = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (key === "--pr") a.evidence.push(argv[++i]);
    else if (key === "--evidence") a.evidence.push(argv[++i]);
    else if (key === "--date") a.date = argv[++i];
    else if (key === "--wiki") a.wiki = argv[++i];
    else if (key === "--note") a.note = argv[++i];
    else if (key === "--source-tool") a.sourceTool = argv[++i];
    else if (key === "--codex-session") a.codexSession = argv[++i];
    else if (key === "--codex-plan") a.codexPlan = argv[++i];
  }
  return a;
}

function h1Title(text, fallback) {
  return (text.match(/^#\s+(.+)$/m) || [])[1] || fallback;
}

function targetId(planPath, title, dateOverride, identitySuffix = null) {
  const base = path.basename(planPath || "", ".md");
  const dated = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  const id = dated ? `${dated[1]}-${slugify(dated[2])}` : `${dateOverride || today()}-${slugify(title)}`;
  return identitySuffix ? `${id}--${identitySuffix}` : id;
}

function yamlList(arr) {
  return arr.length === 0 ? " []" : "\n" + arr.map((x) => `  - ${JSON.stringify(String(x))}`).join("\n");
}

function inferredSourceTool(planPath) {
  const normalized = String(planPath || "").replace(/\\/g, "/");
  return normalized.includes("/.claude/") || normalized.includes("claude-plans") ? "claude" : "file";
}

function archivedSource(text) {
  const match = String(text).match(/^source:\s*(.+)$/m);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return match[1].trim();
  }
}

function archivedBody(text) {
  const match = String(text).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return match ? match[1] : text;
}

function archivePlan({ body, source, sourceTool = "file", status, topics = [], evidence = [], date, wiki, note, planPath, identity }) {
  const title = h1Title(body, path.basename(planPath || source || "plan", ".md"));
  const codexIdentity = sourceTool === "codex" ? (identity || digestFor(body)) : null;
  const id = targetId(planPath, title, date, codexIdentity);
  const archivedDate = date || (id.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || today();
  const plansDir = path.join(wiki, "plans");
  fs.mkdirSync(plansDir, { recursive: true });
  const outPath = path.join(plansDir, `${id}.md`);
  const frontmatter = [
    "---",
    `status: ${status}`,
    `executed: ${archivedDate}`,
    `date: ${archivedDate}`,
    `evidence:${yamlList(evidence)}`,
    `source_tool: ${sourceTool}`,
    `source: ${JSON.stringify(source)}`,
    `topics: [${topics.join(", ")}]`,
    ...(note ? [`audit_note: ${JSON.stringify(note)}`] : []),
    "---",
    "",
  ].join("\n");
  if (fs.existsSync(outPath)) {
    const existing = fs.readFileSync(outPath, "utf8");
    if (archivedBody(existing) !== body || archivedSource(existing) !== source) {
      throw new Error(`refusing to overwrite non-identical archived plan: ${outPath}`);
    }
  }
  fs.writeFileSync(outPath, frontmatter + body);

  const indexPath = path.join(plansDir, "INDEX.md");
  if (fs.existsSync(indexPath)) {
    const lines = fs.readFileSync(indexPath, "utf8").split("\n");
    if (!lines.some((line) => line.includes(`${id}.md`))) {
      let last = -1;
      for (let i = 0; i < lines.length; i++) if (/^\|.*\|$/.test(lines[i].trim())) last = i;
      const renderedEvidence = evidence.length
        ? evidence.map((item) => { const match = String(item).match(/pull\/(\d+)/); return match ? `[PR #${match[1]}](${item})` : item; }).join(", ")
        : "—";
      const row = `| ${archivedDate} | [${title.replace(/\|/g, "\\|")}](${id}.md) | ${status} | ${renderedEvidence} | ${topics.join(", ") || "—"} |`;
      if (last !== -1) lines.splice(last + 1, 0, row);
      fs.writeFileSync(indexPath, lines.join("\n"));
    }
    updatePlanTotals(indexPath);
  }
  return { id, outPath, title };
}

function selectedCodexPlan(args) {
  const candidates = extractSession(args.codexSession, REPO_ROOT);
  if (candidates.length === 0) throw new Error("no assistant <proposed_plan> block for this repository was found in the Codex session");
  if (args.codexPlan) {
    const selected = candidates.find((candidate) => candidate.id === args.codexPlan);
    if (!selected) throw new Error(`Codex plan ${args.codexPlan} was not found; available: ${candidates.map((candidate) => candidate.id).join(", ")}`);
    return selected;
  }
  if (candidates.length !== 1) throw new Error(`Codex session has ${candidates.length} plan blocks; rerun with --codex-plan <id>:\n${candidates.map((candidate) => `- ${candidate.id} — ${candidate.title}`).join("\n")}`);
  return candidates[0];
}

function resolveArchiveInput(args) {
  if (args.codexSession) {
    const plan = selectedCodexPlan(args);
    return { body: plan.body, source: plan.source, sourceTool: "codex", planPath: null, identity: plan.digest };
  }
  if (!args.plan) throw new Error("provide a plan markdown file or --codex-session <session.jsonl>");
  if (!fs.existsSync(args.plan)) throw new Error(`plan not found: ${args.plan}`);
  return {
    body: fs.readFileSync(args.plan, "utf8"),
    source: args.plan,
    sourceTool: args.sourceTool || inferredSourceTool(args.plan),
    planPath: args.plan,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.status) {
    console.error("FAIL usage: archive-plan.cjs <plan.md> --status <status> | --codex-session <session.jsonl> [--codex-plan <id>] --status <status>");
    return 2;
  }
  try {
    const input = resolveArchiveInput(args);
    const archived = archivePlan({ ...input, ...args, sourceTool: input.sourceTool });
    console.log(`PASS archived → wiki/plans/${archived.id}.md`);
    const journalDir = path.join(args.wiki, "journal");
    const referenced = fs.existsSync(journalDir) && fs.readdirSync(journalDir).some((name) =>
      name.endsWith(".md") && fs.readFileSync(path.join(journalDir, name), "utf8").includes(`plans/${archived.id}.md`)
    );
    if (!referenced) console.log(`note: no journal entry references plans/${archived.id}.md — add one per wiki/MECHANICS.md`);
    return 0;
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return 2;
  }
}

if (require.main === module) process.exit(main());

module.exports = { parseArgs, h1Title, targetId, yamlList, inferredSourceTool, archivedSource, archivedBody, archivePlan, selectedCodexPlan, resolveArchiveInput };
