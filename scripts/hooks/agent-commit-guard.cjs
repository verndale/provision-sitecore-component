#!/usr/bin/env node
"use strict";

// Husky guard (pre-commit + pre-push): blocks git commits and pushes made from
// an agent shell in THIS repo. Version control here is deliver-and-handoff —
// agents leave an uncommitted working tree plus a suggested Conventional
// Commits message; the repo owner commits, pushes, merges, tags, and releases
// (AGENTS.md, Hard boundaries).
//
// Detection is by the env fingerprints the harnesses set on their tool shells:
// Claude Code sets CLAUDECODE / CLAUDE_CODE_CHILD_SESSION; Codex sets
// CODEX_SANDBOX / CODEX_SANDBOX_NETWORK_DISABLED (sandboxed runs) and cloud
// containers expose CODEX_PROXY_CERT. Known hole (accepted): Codex
// danger-full-access shells set none of these — the PreToolUse guard still
// denies git mutations there. ALLOW_AGENT_COMMIT=1 is the explicit human
// escape hatch (e.g. a Codex cloud environment the owner configures for PR
// delivery).

const FINGERPRINTS = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "CODEX_PROXY_CERT",
];

/** Returns the first agent fingerprint set in env, or null. */
function detectAgent(env) {
  return FINGERPRINTS.find((key) => env[key] !== undefined && env[key] !== "") || null;
}

function main() {
  const env = process.env;
  if (env.ALLOW_AGENT_COMMIT === "1" || env.ALLOW_AGENT_COMMIT === "true") process.exit(0);
  const hit = detectAgent(env);
  if (!hit) process.exit(0);
  process.stderr.write(
    [
      `agent-commit-guard: blocked — this shell looks like an agent session (${hit} is set).`,
      "Version control here is deliver-and-handoff: leave an uncommitted working tree plus a",
      "suggested Conventional Commits message; the repo owner commits and pushes (AGENTS.md).",
      "A human hitting this from an agent-spawned terminal can override with ALLOW_AGENT_COMMIT=1.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

if (require.main === module) main();

module.exports = { FINGERPRINTS, detectAgent };
