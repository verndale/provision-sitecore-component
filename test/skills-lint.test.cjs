"use strict";

// Skills conformance lint — the generic core of ai-orchestration's scripts/evals/skills-lint.cjs,
// ported to this repo and pointed at skills/. Enforces the agent-skill best practices as a checked
// invariant: SKILL.md frontmatter shape, body length, `## Contents` on long LLM-facing files, and
// no Windows-style backslash paths in markdown links. The repo-specific invariants of the source
// lint (resolver wiring, WCAG pins, .mdc sweep) do not apply here and are intentionally not ported.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");

const NAME_RE = /^[a-z0-9-]{1,64}$/;
const RESERVED = ["anthropic", "claude"];
const XML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*[\s/>]/;
const FIRST_PERSON_RE = /^(I |We |You )|\b(I can|I will|you can|you should|we will)\b/i;
const WINDOWS_LINK_RE = /\]\([^)]*\\[^)]*\)/;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;
const TOC_THRESHOLD = 100;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const fm = {};
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") return fm;
    const m = lines[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2];
  }
  return null;
}

const allMd = walk(SKILLS).filter((p) => p.endsWith(".md"));
const skillMds = allMd.filter((p) => path.basename(p) === "SKILL.md");
// LLM-facing surface: SKILL.md, references/**, _shared/** (READMEs and _meta authoring
// artifacts are exempt, matching the source lint).
const llmFacing = allMd.filter(
  (p) =>
    path.basename(p) === "SKILL.md" ||
    p.includes(`${path.sep}references${path.sep}`) ||
    p.includes(`${path.sep}_shared${path.sep}`)
);

test("every SKILL.md has conformant frontmatter and body length", () => {
  assert.ok(skillMds.length >= 1, "at least one SKILL.md exists under skills/");
  for (const p of skillMds) {
    const rel = path.relative(SKILLS, p);
    const content = fs.readFileSync(p, "utf8");
    const fm = parseFrontmatter(content);
    assert.ok(fm, `${rel}: missing or unterminated YAML frontmatter`);

    const name = fm.name || "";
    assert.match(name, NAME_RE, `${rel}: name "${name}" must be 1-64 lowercase letters/digits/hyphens`);
    assert.ok(!RESERVED.some((w) => name.includes(w)), `${rel}: name "${name}" contains a reserved word`);
    assert.equal(name, path.basename(path.dirname(p)), `${rel}: name must match the skill directory`);

    const desc = fm.description || "";
    assert.ok(desc.length > 0, `${rel}: empty description`);
    assert.ok(desc.length <= MAX_DESCRIPTION, `${rel}: description is ${desc.length} chars (max ${MAX_DESCRIPTION})`);
    assert.ok(!XML_TAG_RE.test(desc), `${rel}: description contains an XML-like tag`);
    assert.ok(!FIRST_PERSON_RE.test(desc), `${rel}: description reads first/second person`);

    const bodyLines = content.split(/\r?\n/).length;
    assert.ok(bodyLines <= MAX_BODY_LINES, `${rel}: ${bodyLines} lines (max ${MAX_BODY_LINES})`);
  }
});

test("long LLM-facing skill files open a ## Contents heading", () => {
  for (const p of llmFacing) {
    const rel = path.relative(SKILLS, p);
    const content = fs.readFileSync(p, "utf8");
    const lines = content.split(/\r?\n/).length;
    if (lines > TOC_THRESHOLD) {
      assert.match(content, /^## Contents$/m, `${rel}: ${lines} lines with no "## Contents" heading`);
    }
  }
});

test("no Windows-style backslash paths in markdown links", () => {
  for (const p of llmFacing) {
    const rel = path.relative(SKILLS, p);
    fs.readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
      assert.ok(!WINDOWS_LINK_RE.test(line), `${rel}:${i + 1}: backslash in a markdown link`);
    });
  }
});

test("relative markdown links inside skills/ resolve to real files", () => {
  for (const p of llmFacing) {
    const rel = path.relative(SKILLS, p);
    const content = fs.readFileSync(p, "utf8");
    // Vendored copies keep their source-repo links by design; the vendor header documents it.
    if (content.startsWith("<!-- Vendored from verndale/ai-orchestration")) continue;
    for (const m of content.matchAll(/\]\(([^)#\s]+)(#[^)\s]*)?\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/i.test(target)) continue; // absolute URL
      const resolved = path.resolve(path.dirname(p), target);
      // Links that point outside skills/ (repo README, src/) are checked against the repo root.
      assert.ok(fs.existsSync(resolved), `${rel}: broken relative link "${target}"`);
    }
  }
});
