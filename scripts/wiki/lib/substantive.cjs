#!/usr/bin/env node
"use strict";

// Classifies a set of changed repo paths for the wiki automation: is the change
// "substantive" (worth a journal entry), and which wiki topic slug(s) does it
// touch? Both are deliberately best-effort heuristics — a missed topic is a
// small cost, and the journal warn is non-blocking. Topic slugs match the pages
// under wiki/topics/. Adapted from ai-orchestration's scripts/wiki/lib/substantive.cjs
// for this repo's layout.

// A path is substantive when it changes tool behavior: the CLI/planner/executor
// source, the skill and its references, the test contract (goldens included),
// the setup installer, or the wiki automation itself.
const SUBSTANTIVE_RE = [
  /^src\//,
  /^skills\//,
  /^test\//,
  /^setup\.sh$/,
  /^scripts\/wiki\//,
  /^scripts\/release\//,
  /^\.github\/workflows\//,
  /^\.husky\//,
];

// wiki/ edits are never substantive — this is what stops a wiki-sync bot PR from
// triggering another round of capture.
const NEVER_RE = [/^wiki\//];

// Ordered path → topic-slug guesses. First match wins per path; a path may be
// substantive without matching any topic (topics is best-effort).
const TOPIC_RE = [
  [/^src\//, "sitecore-provisioning"],
  [/^skills\//, "sitecore-provisioning"],
  [/^test\//, "sitecore-provisioning"],
  [/^setup\.sh$|^scripts\/wiki\/|^scripts\/release\/|^\.github\/workflows\/|^\.husky\//, "repo-tooling"],
];

function classify(paths) {
  const changed = (paths || []).map((p) => String(p).trim()).filter(Boolean);
  const relevant = changed.filter((p) => !NEVER_RE.some((re) => re.test(p)));
  const substantivePaths = relevant.filter((p) => SUBSTANTIVE_RE.some((re) => re.test(p)));
  const topics = [];
  for (const p of substantivePaths) {
    for (const [re, slug] of TOPIC_RE) {
      if (re.test(p)) {
        if (!topics.includes(slug)) topics.push(slug);
        break;
      }
    }
  }
  return { substantive: substantivePaths.length > 0, substantivePaths, topics };
}

module.exports = { classify, SUBSTANTIVE_RE, TOPIC_RE };
