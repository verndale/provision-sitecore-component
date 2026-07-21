#!/usr/bin/env node
"use strict";

// Pre-commit reminder for the context wiki. Warns (never blocks) when a commit
// stages a substantive change but no wiki/journal entry, and when a repo-matching
// plan under ~/.claude/plans looks executed but isn't archived. Exits 0 always;
// fails open on any error. Skipped under $CI so it can't wedge the release or
// uidb-sync bot commits.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const { classify } = require("./lib/substantive.cjs");

function stagedPaths() {
  const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// A repo-matching local plan modified in the last 6h that is not yet archived in
// wiki/plans/INDEX.md, if any — the nudge to run archive-plan.cjs.
// Impure by default (real home dir, real clock, real fs), but every dependency is
// injectable so the decision is unit-testable offline.
function unarchivedPlanHint({
  plansDir = path.join(os.homedir(), ".claude", "plans"),
  indexPath = path.join(REPO_ROOT, "wiki", "plans", "INDEX.md"),
  now = Date.now(),
  fsImpl = fs,
} = {}) {
  try {
    if (!fsImpl.existsSync(plansDir)) return null;
    const index = fsImpl.existsSync(indexPath) ? fsImpl.readFileSync(indexPath, "utf8") : "";
    const cutoff = now - 6 * 60 * 60 * 1000;
    for (const name of fsImpl.readdirSync(plansDir)) {
      if (!name.endsWith(".md")) continue;
      const p = path.join(plansDir, name);
      const st = fsImpl.statSync(p);
      if (st.mtimeMs < cutoff) continue;
      const text = fsImpl.readFileSync(p, "utf8");
      if (!/provision-sitecore-component/.test(text)) continue;
      const h1 = (text.match(/^#\s+(.+)$/m) || [])[1] || name;
      if (index && index.includes(h1.slice(0, 30))) continue; // already archived
      return { path: p, title: h1 };
    }
  } catch {
    /* fail open */
  }
  return null;
}

// Pure: given the staged paths and an optional plan hint, return the warning lines.
function buildWarnings({ stagedPaths, planHint }) {
  const paths = stagedPaths || [];
  const { substantive, substantivePaths } = classify(paths);
  const hasJournal = paths.some((p) => p.startsWith("wiki/journal/"));

  const notes = [];
  if (substantive && !hasJournal) {
    notes.push(
      "wiki: this commit stages a substantive change with no wiki/journal entry.",
      "  Changed: " + substantivePaths.slice(0, 6).join(", ") + (substantivePaths.length > 6 ? " …" : ""),
      "  Add one per wiki/MECHANICS.md, or ignore. The merge workflow will draft a stub if you skip it."
    );
  }
  if (planHint) {
    notes.push(
      "wiki: a recent plan looks executed but isn't archived: " + planHint.title,
      "  node scripts/wiki/archive-plan.cjs " + planHint.path + " --status implemented"
    );
  }
  return notes;
}

function main() {
  if (process.env.CI) return 0;
  let staged;
  try {
    staged = stagedPaths();
  } catch {
    return 0; // no git / fail open
  }
  const notes = buildWarnings({ stagedPaths: staged, planHint: unarchivedPlanHint() });
  if (notes.length) {
    const rule = "=".repeat(64);
    console.warn(`\n${rule}\n  !!  WIKI REMINDER — action likely needed before you commit\n${rule}\n${notes.join("\n")}\n${rule}\n`);
  }
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { main, buildWarnings, unarchivedPlanHint, stagedPaths };
