"use strict";

// Wiki conformance + automation tests: the seeded content obeys MECHANICS.md's
// templates, the indexes cover every page, and the ported automation actually
// works against this repo's wiki (merge sync fills `pr: pending`, the journal
// warn classifies this repo's paths).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const WIKI = path.join(REPO, "wiki");
const fm = require("../scripts/wiki/lib/frontmatter.cjs");
const { classify } = require("../scripts/wiki/lib/substantive.cjs");
const { buildWarnings } = require("../scripts/wiki/pre-commit-journal.cjs");
const { run: mergeSync } = require("../scripts/wiki/on-merge-sync.cjs");

const journalFiles = fs.readdirSync(path.join(WIKI, "journal")).filter((f) => f.endsWith(".md"));
const topicFiles = fs.readdirSync(path.join(WIKI, "topics")).filter((f) => f.endsWith(".md"));
const planFiles = fs.readdirSync(path.join(WIKI, "plans")).filter((f) => f.endsWith(".md") && f !== "INDEX.md");

test("journal entries carry the MECHANICS frontmatter", () => {
  assert.ok(journalFiles.length >= 1);
  for (const name of journalFiles) {
    const text = fs.readFileSync(path.join(WIKI, "journal", name), "utf8");
    assert.match(name, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/, `${name}: journal filename shape`);
    assert.match(fm.readField(text, "date") || "", /^\d{4}-\d{2}-\d{2}$/, `${name}: date`);
    assert.ok(fm.readField(text, "topics") !== null, `${name}: topics`);
    assert.ok(fm.readField(text, "plan"), `${name}: plan (path or none)`);
    assert.ok(fm.readField(text, "pr"), `${name}: pr (url or pending)`);
    const planRef = fm.readField(text, "plan");
    if (planRef && planRef !== "none") {
      assert.ok(fs.existsSync(path.join(WIKI, planRef)), `${name}: plan file ${planRef} exists`);
    }
  }
});

test("archived plans carry the archive frontmatter and an INDEX row", () => {
  assert.ok(planFiles.length >= 1);
  const index = fs.readFileSync(path.join(WIKI, "plans", "INDEX.md"), "utf8");
  for (const name of planFiles) {
    const text = fs.readFileSync(path.join(WIKI, "plans", name), "utf8");
    assert.match(fm.readField(text, "status") || "", /^(implemented|partial|not-implemented|superseded|out-of-scope|not-verified)$/, `${name}: status`);
    assert.ok(fm.readField(text, "executed"), `${name}: executed`);
    assert.match(fm.readField(text, "source_tool") || "", /^(claude|codex|file)$/, `${name}: source_tool`);
    assert.ok(fm.readField(text, "source"), `${name}: source`);
    assert.ok(index.includes(name), `${name}: plans/INDEX.md row`);
  }
  assert.match(index, /^Totals: .*\(\d+ plans\)\.$/m, "totals line present");
});

test("INDEX.md routes every journal entry and topic page", () => {
  const index = fs.readFileSync(path.join(WIKI, "INDEX.md"), "utf8");
  for (const name of journalFiles) assert.ok(index.includes(`journal/${name}`), `INDEX missing journal/${name}`);
  for (const name of topicFiles) assert.ok(index.includes(`topics/${name}`), `INDEX missing topics/${name}`);
});

test("topic pages carry aliases + covers, and covered paths exist (skill covered)", () => {
  let skillCovered = false;
  for (const name of topicFiles) {
    const text = fs.readFileSync(path.join(WIKI, "topics", name), "utf8");
    assert.ok(fm.readList(text, "aliases").length >= 1, `${name}: aliases`);
    const covers = fm.readList(text, "covers");
    for (const target of covers) {
      assert.ok(fs.existsSync(path.join(REPO, target)), `${name}: covers path ${target} exists`);
      if (target === "skills/provision-sitecore-component/SKILL.md") skillCovered = true;
    }
  }
  assert.ok(skillCovered, "the skill's SKILL.md is covered by at least one topic");
});

test("wiki files over 100 lines open a ## Contents heading", () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".md") ? [path.join(dir, e.name)] : []
  );
  for (const p of walk(WIKI)) {
    if (path.dirname(p).endsWith("plans") && path.basename(p) !== "INDEX.md") continue; // archived plans are verbatim copies
    const text = fs.readFileSync(p, "utf8");
    if (text.split(/\r?\n/).length > 100) {
      assert.match(text, /^## Contents$/m, `${path.relative(WIKI, p)}: needs ## Contents`);
    }
  }
});

test("substantive classification matches this repo's layout", () => {
  const { substantive, topics } = classify(["src/cli.cjs", "wiki/INDEX.md"]);
  assert.equal(substantive, true);
  assert.deepEqual(topics, ["sitecore-provisioning"]);
  assert.equal(classify(["wiki/journal/x.md", "CHANGELOG.md"]).substantive, false);
  assert.deepEqual(classify(["setup.sh"]).topics, ["repo-tooling"]);
});

test("pre-commit warn fires for substantive commits without a journal entry, stays quiet with one", () => {
  const warned = buildWarnings({ stagedPaths: ["src/executor.cjs"], planHint: null });
  assert.ok(warned.some((l) => l.includes("no wiki/journal entry")));
  const quiet = buildWarnings({ stagedPaths: ["src/executor.cjs", "wiki/journal/2026-07-21-x.md"], planHint: null });
  assert.equal(quiet.length, 0);
});

test("merge sync fills pr: pending in this repo's seeded journal (temp copy)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psc-wiki-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(WIKI, path.join(dir, "wiki"), { recursive: true });

  const journalName = journalFiles.find(
    (n) => fm.readField(fs.readFileSync(path.join(WIKI, "journal", n), "utf8"), "pr") === "pending",
  );
  const ctx = {
    number: 1,
    title: "feat: scaffold provision-sitecore-component",
    body: "Initial delivery.",
    url: "https://github.com/verndale/provision-sitecore-component/pull/1",
    mergedAt: "2026-07-22T00:00:00Z",
    changedPaths: ["src/cli.cjs", `wiki/journal/${journalName}`],
    commits: [{ hash: "abc", subject: "feat: scaffold" }],
  };
  const { changes } = await mergeSync(ctx, path.join(dir, "wiki"));
  assert.ok(changes.some((c) => c.includes(`filled pr in journal/${journalName}`)), JSON.stringify(changes));
  const text = fs.readFileSync(path.join(dir, "wiki", "journal", journalName), "utf8");
  assert.equal(fm.readField(text, "pr"), ctx.url);
  // The filled entry names the archived plan → its INDEX row gains the PR evidence.
  const plansIndex = fs.readFileSync(path.join(dir, "wiki", "plans", "INDEX.md"), "utf8");
  assert.ok(plansIndex.includes("[PR #1]"), "plans/INDEX.md evidence cell filled");
});
