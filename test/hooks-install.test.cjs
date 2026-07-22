"use strict";

// Installer conformance for scripts/hooks/install.cjs — the setup.sh delegate
// that merges the PreToolUse guard into a developer's user-level hook configs
// (~/.claude/settings.json, ~/.codex/hooks.json). Pins the properties that make
// editing a USER's settings file safe: unrelated keys/entries preserved,
// re-runs idempotent, uninstall removes exactly ours, unparseable input aborts
// without writing, and writes land atomically with a trailing newline.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const {
  GUARD_PATH,
  buildEntries,
  install,
  isOurs,
  mergeHooks,
  removeHooks,
} = require("../scripts/hooks/install.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const INSTALLER = path.join(REPO_ROOT, "scripts", "hooks", "install.cjs");

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hooks-install-home-"));
}

test("the guard the installer registers actually exists", () => {
  assert.ok(fs.existsSync(GUARD_PATH));
});

test("buildEntries points every hook at the guard with a quoted absolute path and platform", () => {
  for (const tool of ["claude", "codex"]) {
    const entries = buildEntries(tool);
    assert.equal(entries.length, 2);
    for (const entry of entries) {
      assert.ok(isOurs(entry));
      for (const hook of entry.hooks) {
        assert.equal(hook.type, "command");
        assert.equal(hook.command, `node "${GUARD_PATH}" --platform ${tool}`);
      }
    }
  }
});

test("mergeHooks preserves unrelated keys and entries, and is idempotent", () => {
  const existing = {
    model: "opus",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo unrelated" }] }],
      SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: "echo hi" }] }],
    },
  };
  const once = mergeHooks(existing, buildEntries("claude"));
  const twice = mergeHooks(once, buildEntries("claude"));
  assert.equal(once.model, "opus");
  assert.equal(once.hooks.SessionStart.length, 1);
  assert.equal(once.hooks.PreToolUse.length, 3);
  assert.equal(once.hooks.PreToolUse[0].hooks[0].command, "echo unrelated");
  assert.deepEqual(twice, once, "second merge must be a no-op");
  assert.equal(existing.hooks.PreToolUse.length, 1, "input must not be mutated");
});

test("removeHooks strips only our entries and drops empty containers", () => {
  const merged = mergeHooks(
    { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo unrelated" }] }] } },
    buildEntries("claude")
  );
  const removed = removeHooks(merged);
  assert.equal(removed.hooks.PreToolUse.length, 1);
  assert.equal(removed.hooks.PreToolUse[0].hooks[0].command, "echo unrelated");
  const emptied = removeHooks(mergeHooks({}, buildEntries("codex")));
  assert.deepEqual(emptied, {}, "empty hook containers must be dropped entirely");
});

test("install writes a fresh config, re-run is a no-op, uninstall restores", () => {
  const home = freshHome();
  const first = install("claude", { home });
  assert.equal(first.changed, true);
  const file = path.join(home, ".claude", "settings.json");
  assert.ok(fs.existsSync(file));
  const written = fs.readFileSync(file, "utf8");
  assert.ok(written.endsWith("\n"));
  const second = install("claude", { home });
  assert.equal(second.changed, false);
  assert.equal(fs.readFileSync(file, "utf8"), written, "re-run must not rewrite");
  const removed = install("claude", { home, uninstall: true });
  assert.equal(removed.changed, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {});
});

test("install preserves an existing config's unrelated content on disk", () => {
  const home = freshHome();
  const file = path.join(home, ".codex", "hooks.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ other: true, hooks: { Stop: [] } }, null, 2));
  install("codex", { home });
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(config.other, true);
  assert.ok(Array.isArray(config.hooks.Stop));
  assert.equal(config.hooks.PreToolUse.length, 2);
  install("codex", { home, uninstall: true });
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(after, { other: true, hooks: { Stop: [] } });
});

test("an unparseable existing config aborts without writing", () => {
  const home = freshHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "not json");
  const result = install("claude", { home });
  assert.ok(result.error);
  assert.match(result.error, /not valid JSON/);
  assert.equal(fs.readFileSync(file, "utf8"), "not json", "broken file must be left untouched");
});

test("uninstall against a missing config is a clean no-op", () => {
  const result = install("codex", { home: freshHome(), uninstall: true });
  assert.equal(result.changed, false);
  assert.match(result.message, /not installed/);
});

test("unknown tool is rejected", () => {
  assert.ok(install("cursor", { home: freshHome() }).error);
});

test("main() wiring: spawned installer honors HOME and exits 1 on broken JSON", () => {
  const home = freshHome();
  const ok = spawnSync(process.execPath, [INSTALLER, "claude"], {
    env: { PATH: process.env.PATH, HOME: home },
    encoding: "utf8",
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /registered guard hooks/);
  assert.ok(fs.existsSync(path.join(home, ".claude", "settings.json")));

  fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{broken");
  const bad = spawnSync(process.execPath, [INSTALLER, "claude"], {
    env: { PATH: process.env.PATH, HOME: home },
    encoding: "utf8",
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /refusing to overwrite/);
});
