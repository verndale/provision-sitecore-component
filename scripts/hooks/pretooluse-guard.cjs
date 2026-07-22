#!/usr/bin/env node
"use strict";

// PreToolUse guard entry — reads one hook payload (JSON) from stdin, decides
// via guard-core.cjs, and answers with the permissionDecision JSON both
// Claude Code and Codex understand. Codex does not support an "ask" decision,
// so its adapter denies unconfirmed push and treats --yes as the skill gate's
// recorded approval. Registered by scripts/hooks/install.cjs
// (user level, via setup.sh) and by the checked-in .claude/settings.json /
// .codex/hooks.json (this repo).
//
// Fail-open by design: a guard crash must never brick a session — on any
// unreadable payload it warns on stderr and exits 0 (allow). The hard layers
// behind it are the checked-in permissions.deny (.env), the CLI push gate,
// husky, and CI.

const core = require("./guard-core.cjs");

const BASH_TOOLS = new Set(["bash", "shell", "local_shell", "exec", "exec_command", "run_shell_command"]);
const EDIT_TOOLS = new Set([
  "edit", "write", "multiedit", "notebookedit", "str_replace_editor",
  "apply_patch", "applypatch", "create_file", "edit_file", "write_file",
]);
// Codex has no read tool (reads go through shell, covered by BASH_TOOLS);
// these are the Claude Read tool plus common harness aliases.
const READ_TOOLS = new Set(["read", "notebookread", "read_file", "open_file", "view_file"]);
const PLATFORMS = new Set(["claude", "codex"]);

/** Codex shell tools pass argv arrays (typically ["bash","-lc","<script>"]); Claude passes a string. */
function normalizeCommand(input) {
  const cmd = input && (input.command !== undefined ? input.command : input.cmd);
  if (Array.isArray(cmd)) {
    const shell = String(cmd[0] || "").split("/").pop();
    if (cmd.length >= 3 && /^(ba|z|da)?sh$/.test(shell) && String(cmd[1]).startsWith("-")) {
      return String(cmd[cmd.length - 1]);
    }
    return cmd.map(String).join(" ");
  }
  return cmd === undefined || cmd === null ? null : String(cmd);
}

function patchPaths(text) {
  const paths = [];
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  let match;
  while ((match = re.exec(String(text))) !== null) paths.push(match[1].trim());
  return paths;
}

/** Every file path a tool call touches (apply_patch may carry several). */
function filePaths(toolName, input) {
  if (!input) return [];
  if (toolName === "apply_patch" || toolName === "applypatch") {
    // Current Codex reports apply_patch content in tool_input.command. Keep
    // the older aliases for Claude and already-installed Codex versions.
    const text = input.command || input.input || input.patch || input.content || "";
    const fromText = patchPaths(text);
    if (fromText.length > 0) return fromText;
    if (input.changes && typeof input.changes === "object") return Object.keys(input.changes);
    return [];
  }
  const single = input.file_path || input.notebook_path || input.path || input.filePath;
  return single ? [String(single)] : [];
}

/** Installed hooks pass the platform explicitly; inference keeps older entries working. */
function resolvePlatform(payload, explicitPlatform) {
  if (explicitPlatform) {
    if (!PLATFORMS.has(explicitPlatform)) throw new Error(`unknown platform "${explicitPlatform}"`);
    return explicitPlatform;
  }
  const name = String(payload && (payload.tool_name || payload.tool) || "").toLowerCase();
  if (payload && payload.model) return "codex"; // `model` is a Codex-specific hook field.
  if (["local_shell", "shell", "exec", "exec_command", "run_shell_command", "apply_patch", "applypatch"].includes(name)) {
    return "codex";
  }
  return "claude";
}

/** Codex cannot ask from PreToolUse; --yes is the skill's recorded approval. */
function platformDecision(decision, platform) {
  if (!decision || decision.decision !== "ask" || platform !== "codex") return decision;
  if (decision.confirmed) return null;
  return { decision: "deny", reason: core.REASONS.pushGateCodex };
}

/** Returns {decision, reason} or null (allow). */
function evaluate(payload, { platform = null } = {}) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.hook_event_name && payload.hook_event_name !== "PreToolUse") return null;
  const name = String(payload.tool_name || payload.tool || "").toLowerCase();
  const input = payload.tool_input || payload.arguments || {};
  const ctx = core.buildContext(payload.cwd || process.cwd());
  const resolvedPlatform = resolvePlatform(payload, platform);
  if (BASH_TOOLS.has(name)) {
    const command = normalizeCommand(input);
    if (!command) return null;
    return platformDecision(core.decideBash(command, ctx), resolvedPlatform);
  }
  if (EDIT_TOOLS.has(name)) {
    for (const filePath of filePaths(name, input)) {
      const decision = core.decideFile(filePath, ctx);
      if (decision) return decision;
    }
  }
  if (READ_TOOLS.has(name)) {
    for (const filePath of filePaths(name, input)) {
      const decision = core.decideRead(filePath, ctx);
      if (decision) return decision;
    }
  }
  return null;
}

function platformFromArgv(argv) {
  const idx = argv.indexOf("--platform");
  if (idx === -1) return null;
  const platform = argv[idx + 1];
  if (!PLATFORMS.has(platform)) throw new Error(`--platform must be claude or codex`);
  return platform;
}

function main() {
  let platform = null;
  try {
    platform = platformFromArgv(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`pretooluse-guard: invalid invocation, allowing (${error.message})\n`);
    process.exit(0);
    return;
  }
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    raw += chunk;
  });
  process.stdin.on("end", () => {
    let decision = null;
    try {
      decision = evaluate(JSON.parse(raw), { platform });
    } catch (error) {
      process.stderr.write(`pretooluse-guard: unreadable payload, allowing (${error.message})\n`);
      process.exit(0);
      return;
    }
    if (decision) {
      const response = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: decision.decision,
          permissionDecisionReason: decision.reason,
        },
      };
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = {
  BASH_TOOLS,
  EDIT_TOOLS,
  PLATFORMS,
  READ_TOOLS,
  evaluate,
  filePaths,
  normalizeCommand,
  patchPaths,
  platformDecision,
  platformFromArgv,
  resolvePlatform,
};
