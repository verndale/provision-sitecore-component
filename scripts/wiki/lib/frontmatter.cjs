#!/usr/bin/env node
"use strict";

// Line-based read/patch of a markdown file's leading `---`-fenced YAML frontmatter.
// The repo ships no YAML parser and the wiki frontmatter is intentionally flat
// (scalar values plus one inline `topics: [a, b]` list), so this operates on the
// fenced block textually rather than pulling in a dependency. Used by the wiki
// automation scripts to fill `pr:`/`issue:`, read `topics`, and stamp `draft:`.

const FENCE = "---";

// Split a file into { fmLines, bodyLines, hasFm }. fmLines excludes the fences.
function split(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== FENCE) return { fmLines: [], bodyLines: lines, hasFm: false };
  const end = lines.indexOf(FENCE, 1);
  if (end === -1) return { fmLines: [], bodyLines: lines, hasFm: false };
  return {
    fmLines: lines.slice(1, end),
    bodyLines: lines.slice(end + 1),
    hasFm: true,
  };
}

function join(fmLines, bodyLines) {
  return [FENCE, ...fmLines, FENCE, ...bodyLines].join("\n");
}

// Raw string value for `key`, or null. `topics: [a, b]` returns "[a, b]".
function readField(text, key) {
  const { fmLines } = split(text);
  const re = new RegExp(`^${key}:\\s*(.*)$`);
  for (const line of fmLines) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

// Parse an inline list value (`[a, b]` or `a, b`) into a string[].
function readList(text, key) {
  const raw = readField(text, key);
  if (raw == null || raw === "") return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Set `key` to `value` (a raw scalar string). Replaces the existing line, or
// appends inside the frontmatter block. Creates a frontmatter block if none.
function setField(text, key, value) {
  let { fmLines, bodyLines, hasFm } = split(text);
  if (!hasFm) {
    return join([`${key}: ${value}`], text.split(/\r?\n/));
  }
  const re = new RegExp(`^${key}:\\s*(.*)$`);
  const idx = fmLines.findIndex((l) => re.test(l));
  if (idx === -1) fmLines = [...fmLines, `${key}: ${value}`];
  else fmLines[idx] = `${key}: ${value}`;
  return join(fmLines, bodyLines);
}

// Append `item` to a block-sequence list field `key`, rendering the new element
// as a quoted scalar to match archive-plan.cjs's `evidence:` shape. Handles an
// empty inline `key: []`, an existing multi-line block list, a non-empty inline
// list (migrated to block form), and a missing field (creates the block). No-ops
// when the exact rendered line is already present; a differently-worded duplicate
// (e.g. a hand-authored entry for the same PR) is the caller's guard.
function appendListItem(text, key, item) {
  const { fmLines, bodyLines, hasFm } = split(text);
  if (!hasFm) return text;
  const re = new RegExp(`^${key}:\\s*(.*)$`);
  const idx = fmLines.findIndex((l) => re.test(l));
  const rendered = `  - ${JSON.stringify(String(item))}`;
  if (idx === -1) return join([...fmLines, `${key}:`, rendered], bodyLines);

  const val = (fmLines[idx].match(re)[1] || "").trim();
  // Existing block items are the indented `- …` lines right after the key line.
  let end = idx + 1;
  const items = [];
  while (end < fmLines.length && /^\s+-\s+/.test(fmLines[end])) {
    items.push(fmLines[end]);
    end++;
  }
  // Migrate a non-empty inline list (`[a, b]`) to block form, preserving order.
  if (val && val !== "[]") {
    for (const el of val.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean)) {
      items.push(`  - ${el}`);
    }
  }
  if (items.includes(rendered)) return text;
  const next = [...fmLines.slice(0, idx), `${key}:`, ...items, rendered, ...fmLines.slice(end)];
  return join(next, bodyLines);
}

module.exports = { split, join, readField, readList, setField, appendListItem };
