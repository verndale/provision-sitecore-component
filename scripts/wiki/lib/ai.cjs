#!/usr/bin/env node
"use strict";

// Optional AI drafting of a wiki journal entry's Why/What-changed, reusing the
// grounded, fail-soft discipline of scripts/commit-pr/semantic-release-structured-notes.cjs:
// gated + endpoint-driven, output is validated and DISCARDED unless it stays
// grounded in the provided change context. Any failure returns null so the caller
// falls back to the deterministic stub — the AI never fabricates the "why".

// Gate + config. Enabled by WIKI_AI=true; endpoint/model/key fall back to the
// existing RELEASE_NOTES_AI_* so no new secret is required.
function config(env) {
  const enabled = String(env.WIKI_AI || "").toLowerCase() === "true";
  const endpoint = env.WIKI_AI_ENDPOINT || env.RELEASE_NOTES_AI_ENDPOINT;
  const apiKey = env.WIKI_AI_API_KEY || env.RELEASE_NOTES_AI_API_KEY;
  const model = env.WIKI_AI_MODEL || env.RELEASE_NOTES_AI_MODEL || "default";
  const debug = String(env.WIKI_AI_DEBUG || "").toLowerCase() === "true";
  return { enabled, endpoint, apiKey, model, debug };
}

function extractText(data) {
  const raw =
    data.output_text ||
    data.text ||
    (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
    (data.output && data.output[0] && data.output[0].content && data.output[0].content[0] && data.output[0].content[0].text) ||
    "";
  return typeof raw === "string" ? raw : "";
}

// Shared transport for every wiki AI caller: one POST shape, staged failures
// ({stage: "fetch"|"http"|"json"}) so each caller keeps its own error
// semantics (debug+null here, warning strings in slack-curation).
async function request({ cfg, system, user, fetchImpl = globalThis.fetch }) {
  let response;
  try {
    response = await fetchImpl(cfg.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ] }),
    });
  } catch (err) {
    return { ok: false, stage: "fetch", error: err && err.message };
  }
  if (!response.ok) return { ok: false, stage: "http", status: response.status };
  try {
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false, stage: "json" };
  }
}

// Parse the model text into { why:[], what:[] } by WHY/WHAT section markers.
// Bullets are lines starting with '-'. Unlabeled bullets fall under `what`.
function parseSections(text) {
  const why = [];
  const what = [];
  let bucket = what;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^WHY\b/i.test(t)) { bucket = why; continue; }
    if (/^WHAT\b/i.test(t)) { bucket = what; continue; }
    if (t.startsWith("-")) bucket.push(t.replace(/^-+\s*/, "").trim());
  }
  return { why, what };
}

// Draft Why/What bullets for a journal entry. Returns { why:[], what:[] } or null.
async function draftEntry({ title, body, commits, changedPaths, env }) {
  const cfg = config(env || process.env);
  if (!cfg.enabled || !cfg.endpoint || !cfg.apiKey) return null;

  const path = require("node:path");
  const files = (changedPaths || []).slice(0, 40);
  const basenames = files.map((f) => path.basename(f));
  const hashes = (commits || []).map((c) => String(c.hash || c).slice(0, 7)).filter(Boolean);
  const groundTokens = [...new Set([...basenames, ...hashes])];

  const system = [
    "You summarize a merged pull request for an engineering change-history wiki.",
    "You MUST NOT invent motivation or changes. Summarize ONLY what the provided PR title, body, commits, and changed files support.",
    "Output exactly two labeled sections. A line 'WHY' followed by 1-4 '-' bullets on why the change was made, then a line 'WHAT' followed by 1-4 '-' bullets on what changed.",
    "Bullets only under each label. No headings, no prose paragraphs.",
    "At least one bullet MUST reference a provided changed-file name or commit hash.",
  ].join(" ");

  const user = [
    `PR title: ${title || ""}`,
    "",
    "PR body:",
    (body || "").slice(0, 4000),
    "",
    "Commit subjects:",
    ...(commits || []).slice(0, 30).map((c) => `- ${String(c.hash || "").slice(0, 7)} ${c.subject || c.message || ""}`.trim()),
    "",
    "Changed files:",
    ...files.map((f) => `- ${f}`),
  ].join("\n");

  const result = await request({ cfg, system, user });
  if (!result.ok) {
    if (cfg.debug) {
      if (result.stage === "http") console.warn("[wiki-ai] non-OK %s", result.status);
      else if (result.stage === "json") console.warn("[wiki-ai] non-JSON response");
      else console.warn("[wiki-ai] fetch failed: %s", result.error);
    }
    return null;
  }

  const text = extractText(result.data);
  const { why, what } = parseSections(text);
  const all = [...why, ...what];
  if (all.length < 2) return null;

  const grounded = all.some((b) => groundTokens.some((tok) => tok && b.includes(tok)));
  if (!grounded) {
    if (cfg.debug) console.warn("[wiki-ai] discarded: no bullet cites a changed file or commit");
    return null;
  }
  return { why, what };
}

module.exports = { config, request, parseSections, extractText, draftEntry };
