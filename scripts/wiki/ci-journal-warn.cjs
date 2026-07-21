#!/usr/bin/env node
"use strict";

// CI mirror of the pre-commit journal warn. Emits a non-blocking ::warning::
// annotation when a PR is substantive but adds no wiki/journal entry. Reads the
// PR's changed paths from a newline-delimited file (--files) produced by `gh api`
// in the workflow. Always exits 0 — informational only; the merge workflow drafts
// a stub anyway.
//
// Usage: node scripts/wiki/ci-journal-warn.cjs --files <changed.txt>

const fs = require("node:fs");
const { classify } = require("./lib/substantive.cjs");

// Pure decision: the ::warning:: string for these paths, or null if none is warranted.
function warningForPaths(paths) {
  const list = paths || [];
  const { substantive, substantivePaths } = classify(list);
  const hasJournal = list.some((p) => p.startsWith("wiki/journal/"));
  if (substantive && !hasJournal) {
    const shown = substantivePaths.slice(0, 6).join(", ");
    return (
      `::warning::This PR changes tool source (${shown}) with no wiki/journal entry. ` +
      `Add one per wiki/MECHANICS.md, or the merge sync will draft a stub for you to revise.`
    );
  }
  return null;
}

function main() {
  const idx = process.argv.indexOf("--files");
  if (idx === -1) return 0;
  let paths = [];
  try {
    paths = fs.readFileSync(process.argv[idx + 1], "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return 0;
  }
  const warning = warningForPaths(paths);
  if (warning) console.log(warning);
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { main, warningForPaths };
