"use strict";

// Extract approved-plan blocks from an explicitly named Codex session. Session
// transcripts are not an authority during normal work: this is used only by
// the archive helper and the opt-in reconciliation backstop.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PLAN_RE = /<proposed_plan>([\s\S]*?)<\/proposed_plan>/g;

function h1(text, fallback) {
  return (String(text).match(/^#\s+(.+)$/m) || [])[1] || fallback;
}

function digestFor(body) {
  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 12);
}

function textBlocks(payload) {
  if (!payload || payload.role !== "assistant") return [];
  if (typeof payload.text === "string") return [payload.text];
  if (typeof payload.content === "string") return [payload.content];
  if (!Array.isArray(payload.content)) return [];
  return payload.content
    .filter((block) => block && (block.type === "output_text" || block.type === "text"))
    .map((block) => typeof block.text === "string" ? block.text : typeof block.content === "string" ? block.content : "")
    .filter(Boolean);
}

function planBlocks(text) {
  const blocks = [];
  PLAN_RE.lastIndex = 0;
  let match;
  while ((match = PLAN_RE.exec(text)) !== null) blocks.push(match[1]);
  return blocks;
}

function parseRecords(text) {
  const records = [];
  for (const [index, raw] of String(text).split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    try {
      records.push({ record: JSON.parse(raw), lineNumber: index + 1 });
    } catch {
      // A damaged record must not make plan archival or recovery unsafe.
    }
  }
  return records;
}

function sessionMeta(entries, fallbackId) {
  for (const { record } of entries) {
    if (record?.type !== "session_meta") continue;
    const payload = record.payload || {};
    return { sessionId: payload.session_id || payload.id || fallbackId, cwd: payload.cwd || null };
  }
  return { sessionId: fallbackId, cwd: null };
}

function parseSessionText(text, { sessionPath = "session.jsonl", repoRoot } = {}) {
  const entries = parseRecords(text);
  const fallbackId = path.basename(sessionPath, ".jsonl");
  const meta = sessionMeta(entries, fallbackId);
  if (!meta.cwd || path.resolve(meta.cwd) !== path.resolve(repoRoot)) return [];

  const candidates = [];
  for (const { record, lineNumber } of entries) {
    if (record?.type !== "response_item") continue;
    for (const [blockIndex, textBlock] of textBlocks(record.payload).entries()) {
      for (const [planIndex, body] of planBlocks(textBlock).entries()) {
        const digest = digestFor(body);
        const position = `${lineNumber}:${blockIndex + 1}:${planIndex + 1}`;
        const legacySource = `codex-session:${meta.sessionId}#${position}`;
        candidates.push({
          id: `${meta.sessionId}:${position}:${digest}`,
          sessionId: meta.sessionId,
          title: h1(body, `Codex plan ${digest}`),
          body,
          digest,
          legacySource,
          source: `${legacySource}:${digest}`,
          sourceTool: "codex",
        });
      }
    }
  }
  return candidates;
}

function extractSession(sessionPath, repoRoot) {
  try {
    return parseSessionText(fs.readFileSync(sessionPath, "utf8"), { sessionPath, repoRoot });
  } catch {
    return [];
  }
}

function walkJsonl(dir, fsImpl = fs) {
  if (!fsImpl.existsSync(dir)) return [];
  const out = [];
  for (const entry of fsImpl.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonl(target, fsImpl));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(target);
  }
  return out.sort();
}

function findSessionPlans({ dirs, repoRoot, archivedSources = [], sinceDays = null, now = Date.now(), fsImpl = fs }) {
  const cutoff = sinceDays ? now - sinceDays * 86_400_000 : 0;
  const archived = new Set(archivedSources);
  const archivedDigests = new Set(
    [...archived]
      .map((source) => String(source).match(/:([a-f0-9]{12})$/)?.[1])
      .filter(Boolean)
  );
  const found = [];
  const seenDigests = new Set();
  for (const dir of dirs) {
    for (const sessionPath of walkJsonl(dir, fsImpl)) {
      let stat;
      try {
        stat = fsImpl.statSync(sessionPath);
      } catch {
        continue;
      }
      if (cutoff && stat.mtimeMs < cutoff) continue;
      let text;
      try {
        text = fsImpl.readFileSync(sessionPath, "utf8");
      } catch {
        continue;
      }
      for (const candidate of parseSessionText(text, { sessionPath, repoRoot })) {
        if (seenDigests.has(candidate.digest) || archivedDigests.has(candidate.digest) || archived.has(candidate.source) || archived.has(candidate.legacySource)) continue;
        seenDigests.add(candidate.digest);
        found.push({ ...candidate, path: sessionPath });
      }
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = { h1, digestFor, textBlocks, planBlocks, parseRecords, parseSessionText, extractSession, walkJsonl, findSessionPlans };
