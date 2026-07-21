#!/usr/bin/env node
"use strict";

// Post-merge wiki sync. Given a merged PR's context, updates all three wiki
// layers: fills `pr: pending` / `follow_up_pr: pending` (+ derives `issue:`) in journal entries, drafts a
// deterministic (optionally AI-enriched) stub when a substantive PR added none,
// appends a topic Decisions bullet, and completes the plans/INDEX.md row when the
// PR references an archived plan. Writes files only — the workflow commits the
// diff to a bot PR. Deterministic-first and fail-soft: a missing/off AI never
// blocks and never fabricates.
//
// Usage: node scripts/wiki/on-merge-sync.cjs --context <ctx.json> [--wiki <dir>] [--repo <dir>]
//   ctx: { number, title, body, url, mergedAt?, changedPaths[], commits[{hash,subject}] }

const fs = require("node:fs");
const path = require("node:path");

const fm = require("./lib/frontmatter.cjs");
const { classify } = require("./lib/substantive.cjs");
const { slugify, addJournalLine, addTopicDecision } = require("./lib/wiki-io.cjs");
const ai = require("./lib/ai.cjs");

function parseArgs(argv) {
  const a = { repo: path.resolve(__dirname, "..", "..") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--context") a.context = argv[++i];
    else if (argv[i] === "--wiki") a.wiki = argv[++i];
    else if (argv[i] === "--repo") a.repo = argv[++i];
  }
  if (!a.wiki) a.wiki = path.join(a.repo, "wiki");
  return a;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function deriveIssue(body) {
  const m = String(body || "").match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  return m ? `https://github.com/verndale/provision-sitecore-component/issues/${m[1]}` : null;
}

async function run(ctx, wikiDir) {
  const changes = [];
  const warnings = [];
  const journalDir = path.join(wikiDir, "journal");
  const topicsDir = path.join(wikiDir, "topics");
  const indexPath = path.join(wikiDir, "INDEX.md");
  const plansIndex = path.join(wikiDir, "plans", "INDEX.md");
  const { substantive, substantivePaths, topics } = classify(ctx.changedPaths || []);
  const issueUrl = deriveIssue(ctx.body);

  // 1. Fill pass — journal entries THIS PR added/modified whose pr is pending
  //    get this PR's URL. An already-evidenced journal edited as an explicit
  //    follow-up also counts as authored coverage, so the sync does not create
  //    a duplicate stub when the single follow_up_pr field is already occupied.
  //    Scoping to the PR's own changed files prevents misattributing a stale
  //    pending entry left by an earlier failed sync.
  const prJournal = new Set((ctx.changedPaths || []).filter((p) => /^wiki\/journal\/.+\.md$/.test(p)));
  let entryReferencesPr = false;
  const journalPlanRefs = new Set();
  if (fs.existsSync(journalDir)) {
    for (const name of fs.readdirSync(journalDir)) {
      if (!name.endsWith(".md")) continue;
      if (prJournal.size > 0 && !prJournal.has(`wiki/journal/${name}`)) continue;
      const p = path.join(journalDir, name);
      let text = fs.readFileSync(p, "utf8");
      const pr = fm.readField(text, "pr");
      const followUpPr = fm.readField(text, "follow_up_pr");
      if (pr === ctx.url || followUpPr === ctx.url) entryReferencesPr = true;
      if (pr === "pending") {
        text = fm.setField(text, "pr", ctx.url);
        if (issueUrl && !fm.readField(text, "issue")) text = fm.setField(text, "issue", issueUrl);
        fs.writeFileSync(p, text);
        changes.push(`filled pr in journal/${name}`);
        entryReferencesPr = true;
      }
      if (followUpPr === "pending") {
        text = fm.setField(text, "follow_up_pr", ctx.url);
        if (issueUrl && !fm.readField(text, "issue")) text = fm.setField(text, "issue", issueUrl);
        fs.writeFileSync(p, text);
        changes.push(`filled follow-up pr in journal/${name}`);
        entryReferencesPr = true;
      }
      if (prJournal.has(`wiki/journal/${name}`) && pr !== "pending" && followUpPr !== "pending") {
        entryReferencesPr = true;
      }
      // An entry tied to this PR names the executed plan in its `plan:` field —
      // the reliable trigger for the plans pass when the PR body omits the path.
      if (pr === ctx.url || pr === "pending" || followUpPr === ctx.url || followUpPr === "pending") {
        const planField = fm.readField(text, "plan");
        const m = planField && planField.match(/([a-z0-9-]+)\.md/i);
        if (m) journalPlanRefs.add(m[1]);
      }
    }
  }

  // 2. Draft pass — substantive PR with no entry gets a deterministic stub
  //    (AI enriches Why/What when available and grounded).
  if (substantive && !entryReferencesPr) {
    const date = (ctx.mergedAt || today()).slice(0, 10);
    const slug = slugify(ctx.title);
    // Disambiguate a same-day, same-slug collision so a second PR's stub never
    // overwrites the first's.
    fs.mkdirSync(journalDir, { recursive: true });
    let fname = `${date}-${slug}.md`;
    if (fs.existsSync(path.join(journalDir, fname))) fname = `${date}-${slug}-${ctx.number}.md`;
    const file = path.join(journalDir, fname);
    let whatBullets = (ctx.commits || [])
      .map((c) => `- ${c.subject || c.message || ""}`.trim())
      .filter((b) => b !== "-");
    let whyBullets = ["- TODO: why — auto-drafted from the PR; revise per wiki/MECHANICS.md."];
    const drafted = await ai.draftEntry({
      title: ctx.title, body: ctx.body, commits: ctx.commits, changedPaths: substantivePaths, env: process.env,
    });
    if (drafted) {
      if (drafted.why.length) whyBullets = drafted.why.map((b) => `- ${b}`);
      if (drafted.what.length) whatBullets = drafted.what.map((b) => `- ${b}`);
    }
    const front = [
      "---",
      `date: ${date}`,
      `topics: [${topics.join(", ")}]`,
      "plan: none",
      `pr: ${ctx.url}`,
      ...(issueUrl ? [`issue: ${issueUrl}`] : []),
      "draft: ai",
      "---",
    ].join("\n");
    const body = [
      front,
      `# ${ctx.title}`,
      "",
      "## Why",
      "",
      ...whyBullets,
      "",
      "## What changed",
      "",
      ...(whatBullets.length ? whatBullets : ["- See commits."]),
      "",
      "## Files",
      "",
      ...substantivePaths.slice(0, 20).map((f) => `- ${f}`),
      "",
    ].join("\n");
    fs.writeFileSync(file, body);
    const hook = drafted ? "AI-drafted, revise" : "stub, needs Why";
    addJournalLine(indexPath, `- ${date} — [${ctx.title}](journal/${fname}) — ${hook}`);
    changes.push(`drafted journal/${fname} (${hook})`);
  }

  // 3. Topics pass — append a Decisions bullet to each guessed topic page.
  if (substantive) {
    const date = (ctx.mergedAt || today()).slice(0, 10);
    for (const slug of topics) {
      const p = path.join(topicsDir, `${slug}.md`);
      const bullet = `- ${date} — ${ctx.title} ([PR #${ctx.number}](${ctx.url}))`;
      const { added, overBudget } = addTopicDecision(p, bullet, ctx.url);
      if (added) changes.push(`decision → topics/${slug}.md`);
      if (overBudget) warnings.push(`topics/${slug}.md is over its ~150-line budget — prune older decisions`);
    }
  }

  // 4. Plans pass — for every archived plan this PR implements (named in the PR
  //    body, or in a journal entry's `plan:` field), complete its plans/INDEX.md
  //    row AND back-fill the plan file's own `evidence:` frontmatter with this PR.
  const planRefs = new Set(journalPlanRefs);
  const bodyRef = (String(ctx.body || "").match(/plans\/([a-z0-9-]+)\.md/i) || [])[1];
  if (bodyRef) planRefs.add(bodyRef);

  // Already cites this PR? Match the number as a whole token (`#N`/`pull/N` not
  // followed by another digit), so PR #1 is not seen as already-present inside a
  // recorded `#12`/`pull/12` (integer-suffix substring).
  const prRecorded = (s) => new RegExp(`(?:#|pull/)${ctx.number}(?!\\d)`).test(s);

  for (const planRef of planRefs) {
    // 4a. INDEX row — append the PR to the Evidence cell (5-col table:
    //     date|plan|status|evidence|topics).
    if (fs.existsSync(plansIndex)) {
      const lines = fs.readFileSync(plansIndex, "utf8").split("\n");
      let touched = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`${planRef}.md`) && lines[i].startsWith("|") && !prRecorded(lines[i])) {
          const cells = lines[i].split("|");
          if (cells.length >= 5) {
            const ev = cells[4].trim();
            cells[4] = ` ${ev === "—" || ev === "" ? "" : ev + ", "}[PR #${ctx.number}](${ctx.url}) `;
            lines[i] = cells.join("|");
            touched = true;
          }
        }
      }
      if (touched) {
        fs.writeFileSync(plansIndex, lines.join("\n"));
        changes.push(`updated plans/INDEX.md row for ${planRef}`);
      }
    }

    // 4b. Plan file evidence — the PR is the one grounded fact available at merge
    //     (richer commit/confirmation lines stay a manual enhancement). Guard on
    //     the URL so a hand-authored entry for the same PR is never duplicated.
    const planFile = path.join(wikiDir, "plans", `${planRef}.md`);
    if (fs.existsSync(planFile)) {
      const ptext = fs.readFileSync(planFile, "utf8");
      if (!prRecorded(fm.split(ptext).fmLines.join("\n"))) {
        const date = (ctx.mergedAt || today()).slice(0, 10);
        const patched = fm.appendListItem(ptext, "evidence", `PR #${ctx.number} ${ctx.url} (merged ${date})`);
        if (patched !== ptext) {
          fs.writeFileSync(planFile, patched);
          changes.push(`filled evidence in plans/${planRef}.md`);
        }
      }
    }
  }

  return { changes, warnings };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.context) {
    console.error("FAIL usage: on-merge-sync.cjs --context <ctx.json> [--wiki <dir>]");
    process.exit(2);
  }
  const ctx = JSON.parse(fs.readFileSync(args.context, "utf8"));
  const { changes, warnings } = await run(ctx, args.wiki);
  for (const w of warnings) console.log(`::warning::${w}`);
  if (changes.length === 0) {
    console.log("PASS wiki sync: no changes needed");
  } else {
    for (const c of changes) console.log(`PASS ${c}`);
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("FAIL on-merge-sync:", err && err.message);
    process.exit(1);
  });
}

module.exports = { run, deriveIssue };
