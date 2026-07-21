#!/usr/bin/env node
"use strict";

// Shared helpers for editing the wiki tree: slugs, the INDEX journal list, and
// the topic Decisions log. Kept dependency-free (stdlib only) and idempotent so
// the merge automation can re-run without duplicating lines.

const fs = require("node:fs");
const path = require("node:path");

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "entry";
}

// Insert a journal line as the newest (first) bullet under `## Journal` in
// INDEX.md. No-op if the exact line already exists.
function addJournalLine(indexPath, line) {
  if (!fs.existsSync(indexPath)) return false;
  let text = fs.readFileSync(indexPath, "utf8");
  if (text.includes(line)) return false;
  const lines = text.split("\n");
  const h = lines.findIndex((l) => /^##\s+Journal\b/.test(l));
  if (h === -1) return false;
  // Find the first existing bullet after the heading (skip blank + HTML comments).
  let insertAt = h + 1;
  while (insertAt < lines.length && !/^- /.test(lines[insertAt]) && !/^##\s/.test(lines[insertAt])) insertAt++;
  lines.splice(insertAt, 0, line);
  fs.writeFileSync(indexPath, lines.join("\n"));
  return true;
}

// Append a Decisions bullet as the newest (first) bullet under `## Decisions`
// in a topic page. Idempotent by the citation marker (e.g. the PR URL). Returns
// { added, overBudget } where overBudget flags the ~150-line soft cap.
function addTopicDecision(topicPath, bullet, citeMarker, budget = 150) {
  if (!fs.existsSync(topicPath)) return { added: false, overBudget: false };
  let text = fs.readFileSync(topicPath, "utf8");
  if (citeMarker && text.includes(citeMarker)) return { added: false, overBudget: false };
  const lines = text.split("\n");
  const h = lines.findIndex((l) => /^##\s+Decisions\b/.test(l));
  if (h === -1) return { added: false, overBudget: false };
  let insertAt = h + 1;
  while (insertAt < lines.length && !/^- /.test(lines[insertAt]) && !/^##\s/.test(lines[insertAt])) insertAt++;
  lines.splice(insertAt, 0, bullet);
  fs.writeFileSync(topicPath, lines.join("\n"));
  return { added: true, overBudget: lines.length > budget };
}

// Render the plans/INDEX.md `Totals:` summary from its own table rows. The line is
// derived data — archive-plan.cjs appends rows without it, so it drifts silently
// unless recomputed. Returns null when the table has no rows.
function planTotalsLine(text) {
  const counts = new Map();
  for (const line of String(text || "").split("\n")) {
    if (!/^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line)) continue;
    // Split on unescaped pipes: a plan title may contain an escaped `\|`.
    const status = (line.split(/(?<!\\)\|/)[3] || "").trim();
    if (status) counts.set(status, (counts.get(status) || 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  if (!total) return null;
  // `implemented` leads, remaining statuses alphabetical — the existing convention.
  const ordered = [...counts.keys()].sort((a, b) => (
    a === "implemented" ? -1 : b === "implemented" ? 1 : a.localeCompare(b)
  ));
  return `Totals: ${ordered.map((s) => `${counts.get(s)} ${s}`).join(" · ")} (${total} plans).`;
}

// Rewrite the `Totals:` line in place. Idempotent: no write when already correct.
function updatePlanTotals(indexPath) {
  if (!fs.existsSync(indexPath)) return { changed: false, line: null };
  const text = fs.readFileSync(indexPath, "utf8");
  const line = planTotalsLine(text);
  if (!line || !/^Totals:.*$/m.test(text)) return { changed: false, line };
  const next = text.replace(/^Totals:.*$/m, line);
  if (next === text) return { changed: false, line };
  fs.writeFileSync(indexPath, next);
  return { changed: true, line };
}

module.exports = {
  slugify,
  addJournalLine,
  addTopicDecision,
  planTotalsLine,
  updatePlanTotals,
};
