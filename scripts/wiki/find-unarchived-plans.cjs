#!/usr/bin/env node
"use strict";

// Opt-in recovery backstop for local Claude markdown plans and live Codex
// sessions. Normal plan capture remains explicit at execution time.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { archivePlan } = require("./archive-plan.cjs");
const { findSessionPlans } = require("./lib/codex-plans.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REPO_MATCH = /provision-sitecore-component/;

function parseArgs(argv) {
  const args = { archive: false, wiki: path.join(REPO_ROOT, "wiki"), dirs: [], codexDirs: [], sinceDays: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--archive") args.archive = true;
    else if (argv[i] === "--wiki") args.wiki = argv[++i];
    else if (argv[i] === "--plans-dir") args.dirs.push(argv[++i]);
    else if (argv[i] === "--codex-sessions-dir") args.codexDirs.push(argv[++i]);
    else if (argv[i] === "--since-days") args.sinceDays = Number(argv[++i]);
  }
  const suppliedMarkdownDirs = args.dirs.length > 0;
  if (!suppliedMarkdownDirs) {
    args.dirs = [
      path.join(os.homedir(), ".claude", "plans"),
      path.join(os.homedir(), "Desktop", "claude-plans-organized", "provision-sitecore-component", "executed"),
      path.join(os.homedir(), "Desktop", "claude-plans-organized", "provision-sitecore-component", "open-plans"),
    ];
  }
  // Supplying only --plans-dir preserves the existing test/operator behavior;
  // normal recovery includes live Codex sessions unless a directory is supplied.
  args.scanCodex = args.codexDirs.length > 0 || !suppliedMarkdownDirs;
  if (args.codexDirs.length === 0 && args.scanCodex) args.codexDirs = [path.join(os.homedir(), ".codex", "sessions")];
  return args;
}

function h1(text, fallback) {
  return (text.match(/^#\s+(.+)$/m) || [])[1] || fallback;
}

function findCandidates({ dirs, indexText, sinceDays, now = Date.now(), fsImpl = fs }) {
  const cutoff = sinceDays ? now - sinceDays * 86_400_000 : 0;
  const seen = new Set();
  const candidates = [];
  for (const dir of dirs) {
    if (!fsImpl.existsSync(dir)) continue;
    for (const name of fsImpl.readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const candidatePath = path.join(dir, name);
      const stat = fsImpl.statSync(candidatePath);
      if (cutoff && stat.mtimeMs < cutoff) continue;
      const text = fsImpl.readFileSync(candidatePath, "utf8");
      if (!REPO_MATCH.test(text)) continue;
      const title = h1(text, name);
      const key = title.slice(0, 40);
      if (seen.has(key) || (indexText && indexText.includes(title.slice(0, 30)))) continue;
      seen.add(key);
      candidates.push({ path: candidatePath, title });
    }
  }
  return candidates;
}

function codexArchiveSources(wiki, fsImpl = fs) {
  const plansDir = path.join(wiki, "plans");
  if (!fsImpl.existsSync(plansDir)) return [];
  const sources = [];
  for (const name of fsImpl.readdirSync(plansDir)) {
    if (!name.endsWith(".md") || name === "INDEX.md") continue;
    let text;
    try {
      text = fsImpl.readFileSync(path.join(plansDir, name), "utf8");
    } catch {
      continue;
    }
    const match = text.match(/^source:\s*(.+)$/m);
    if (!match) continue;
    let source = match[1].trim();
    try {
      source = JSON.parse(source);
    } catch {
      // Older frontmatter may have an unquoted source value.
    }
    if (typeof source === "string" && source.startsWith("codex-session:")) sources.push(source);
  }
  return sources;
}

function allCandidates({ dirs, codexDirs, scanCodex, indexText, sinceDays, now, fsImpl = fs, repoRoot = REPO_ROOT, wiki = path.join(REPO_ROOT, "wiki") }) {
  const markdown = findCandidates({ dirs, indexText, sinceDays, now, fsImpl })
    .map((candidate) => ({ ...candidate, sourceTool: "claude", source: candidate.path, body: fsImpl.readFileSync(candidate.path, "utf8"), kind: "file" }));
  const codex = scanCodex
    ? findSessionPlans({ dirs: codexDirs, repoRoot, archivedSources: codexArchiveSources(wiki, fsImpl), sinceDays, now, fsImpl }).map((candidate) => ({ ...candidate, kind: "codex" }))
    : [];
  return [...markdown, ...codex];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const indexPath = path.join(args.wiki, "plans", "INDEX.md");
  const indexText = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
  const candidates = allCandidates({ ...args, indexText });
  if (candidates.length === 0) {
    console.log("PASS no unarchived repo plans found");
    return 0;
  }
  console.log(`Found ${candidates.length} unarchived plan(s):`);
  for (const candidate of candidates) console.log(`- ${candidate.title}\n    ${candidate.sourceTool}: ${candidate.path || candidate.source}`);
  if (!args.archive) {
    console.log("\nRe-run with --archive to copy these into wiki/plans/ (status not-verified).");
    return 0;
  }
  for (const candidate of candidates) {
    try {
      archivePlan({
        body: candidate.body,
        source: candidate.source,
        sourceTool: candidate.sourceTool,
        status: "not-verified",
        wiki: args.wiki,
        planPath: candidate.kind === "file" ? candidate.path : null,
      });
      console.log(`PASS archived ${candidate.title}`);
    } catch (error) {
      console.error(`  FAIL archiving ${candidate.title}: ${error.message}`);
    }
  }
  console.log("note: archived with status not-verified — confirm each status and add evidence.");
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { parseArgs, h1, findCandidates, codexArchiveSources, allCandidates };
