#!/usr/bin/env node
"use strict";

// Nightly issue-state refresh for topic pages. Scans wiki/topics/*.md for
// `[issue #N](url)` citations under an `## Open threads` section and, when the
// issue has since closed, annotates the line with ` — closed`. It does not
// restructure the page (Joe prunes) — it just stops "Open threads" from silently
// citing resolved issues. Used by the wiki-issue-sync workflow, which opens a PR
// with any changes.
//
// Usage: node scripts/wiki/refresh-issue-state.cjs [--wiki <dir>] [--state-map <json>]
//   --state-map lets tests inject { "213": "closed" } instead of calling gh.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const a = { wiki: path.join(path.resolve(__dirname, "..", ".."), "wiki") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--wiki") a.wiki = argv[++i];
    else if (argv[i] === "--state-map") a.stateMap = argv[++i];
  }
  return a;
}

function ghState(n) {
  try {
    const out = execFileSync("gh", ["api", `repos/verndale/provision-sitecore-component/issues/${n}`, "--jq", ".state"], {
      encoding: "utf8",
    });
    return out.trim().toLowerCase() || null;
  } catch {
    return null; // fail soft — leave the citation untouched
  }
}

// Returns list of change descriptions. lookup(n) -> "open"|"closed"|null.
function refresh(topicsDir, lookup) {
  const changes = [];
  if (!fs.existsSync(topicsDir)) return changes;
  for (const name of fs.readdirSync(topicsDir)) {
    if (!name.endsWith(".md")) continue;
    const p = path.join(topicsDir, name);
    const lines = fs.readFileSync(p, "utf8").split("\n");
    let inOpen = false;
    let touched = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^##\s/.test(l)) inOpen = /^##\s+Open threads\b/.test(l);
      if (!inOpen) continue;
      const m = l.match(/\[issue #(\d+)\]/);
      if (!m) continue;
      const annotated = /—\s*closed\b/i.test(l);
      const state = lookup(m[1]); // consult live state even when already annotated
      if (state === "closed" && !annotated) {
        lines[i] = l.replace(/\s*$/, "") + " — closed";
        changes.push(`${name}: issue #${m[1]} marked closed`);
        touched = true;
      } else if (state === "open" && annotated) {
        // A reopened issue must lose the tool's own trailing ` — closed`, not keep it forever.
        // Only the tool's clean end-of-line annotation is stripped; a human-customized line
        // (text after `— closed`) is left untouched rather than falsely reported as cleaned.
        const stripped = l.replace(/\s*—\s*closed\b\s*$/i, "");
        if (stripped !== l) {
          lines[i] = stripped;
          changes.push(`${name}: issue #${m[1]} reopened — annotation removed`);
          touched = true;
        }
      }
    }
    if (touched) fs.writeFileSync(p, lines.join("\n"));
  }
  return changes;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  let lookup = ghState;
  if (a.stateMap) {
    const map = JSON.parse(fs.readFileSync(a.stateMap, "utf8"));
    lookup = (n) => map[String(n)] || null;
  }
  const changes = refresh(path.join(a.wiki, "topics"), lookup);
  if (changes.length === 0) console.log("PASS issue-state: nothing to update");
  else for (const c of changes) console.log(`PASS ${c}`);
  process.exit(0);
}

if (require.main === module) main();
module.exports = { refresh };
