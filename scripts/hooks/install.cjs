#!/usr/bin/env node
"use strict";

// User-level guard registration, driven by setup.sh:
//
//   node scripts/hooks/install.cjs <claude|codex> [--uninstall]
//
// Merges two PreToolUse entries invoking pretooluse-guard.cjs into the tool's
// user hook config (~/.claude/settings.json / ~/.codex/hooks.json). Entries
// are recognized by the stable command suffix scripts/hooks/pretooluse-guard.cjs,
// so re-runs update in place (including after the clone moves) and --uninstall
// removes exactly ours. All other keys are preserved byte-for-byte as parsed;
// an unparseable existing file aborts without writing. Writes are atomic
// (tmp + rename).

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUARD_SUFFIX = "scripts/hooks/pretooluse-guard.cjs";
const GUARD_PATH = path.join(REPO_ROOT, "scripts", "hooks", "pretooluse-guard.cjs");

const MATCHERS = {
  claude: ["Bash", "Edit|MultiEdit|Write|NotebookEdit", "Read"],
  codex: ["^Bash$", "^apply_patch$"],
};

function targetFor(tool, home = os.homedir()) {
  if (tool === "claude") return path.join(home, ".claude", "settings.json");
  if (tool === "codex") return path.join(home, ".codex", "hooks.json");
  return null;
}

function buildEntries(tool, guardPath = GUARD_PATH) {
  return MATCHERS[tool].map((matcher) => ({
    matcher,
    hooks: [{ type: "command", command: `node "${guardPath}" --platform ${tool}` }],
  }));
}

function isOurs(entry) {
  return (
    entry &&
    Array.isArray(entry.hooks) &&
    entry.hooks.some((h) => typeof h.command === "string" && h.command.includes(GUARD_SUFFIX))
  );
}

/** Pure merge: returns the updated config object (input is not mutated). */
function mergeHooks(config, entries) {
  const next = JSON.parse(JSON.stringify(config || {}));
  if (typeof next.hooks !== "object" || next.hooks === null) next.hooks = {};
  const existing = Array.isArray(next.hooks.PreToolUse) ? next.hooks.PreToolUse : [];
  next.hooks.PreToolUse = existing.filter((e) => !isOurs(e)).concat(entries);
  return next;
}

/** Pure removal: strips our entries; drops empty hooks containers. */
function removeHooks(config) {
  const next = JSON.parse(JSON.stringify(config || {}));
  if (typeof next.hooks !== "object" || next.hooks === null) return next;
  if (Array.isArray(next.hooks.PreToolUse)) {
    next.hooks.PreToolUse = next.hooks.PreToolUse.filter((e) => !isOurs(e));
    if (next.hooks.PreToolUse.length === 0) delete next.hooks.PreToolUse;
  }
  if (Object.keys(next.hooks).length === 0) delete next.hooks;
  return next;
}

function writeAtomic(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function install(tool, { uninstall = false, home = os.homedir(), guardPath = GUARD_PATH } = {}) {
  const target = targetFor(tool, home);
  if (!target) return { error: `unknown tool "${tool}" (expected: claude | codex)` };
  let config = {};
  if (fs.existsSync(target)) {
    try {
      config = JSON.parse(fs.readFileSync(target, "utf8"));
    } catch (error) {
      return { error: `${target} exists but is not valid JSON (${error.message}) — fix it by hand, then re-run; refusing to overwrite.` };
    }
  } else if (uninstall) {
    return { target, changed: false, message: `not installed: ${target}` };
  }
  const next = uninstall ? removeHooks(config) : mergeHooks(config, buildEntries(tool, guardPath));
  if (JSON.stringify(next) === JSON.stringify(config)) {
    return { target, changed: false, message: `${uninstall ? "nothing to remove from" : "already registered in"} ${target}` };
  }
  writeAtomic(target, next);
  return { target, changed: true, message: `${uninstall ? "removed guard hooks from" : "registered guard hooks in"} ${target}` };
}

function main(argv) {
  const args = argv.slice(2);
  const uninstall = args.includes("--uninstall");
  const tool = args.find((a) => !a.startsWith("-"));
  const result = install(tool, { uninstall });
  if (result.error) {
    process.stderr.write(`hooks-install: ${result.error}\n`);
    process.exit(1);
  }
  process.stdout.write(`  ${result.message}\n`);
}

if (require.main === module) main(process.argv);

module.exports = { GUARD_PATH, GUARD_SUFFIX, MATCHERS, buildEntries, install, isOurs, mergeHooks, removeHooks, targetFor };
