"use strict";

// CLI push gate + credential resolution. push is the only mutating mode, so its
// gate must hold with no harness present: a non-interactive push without --yes
// refuses (exit 2) BEFORE any credential is read or network touched; --yes
// proceeds to the ordinary missing-env config failure offline. Also pins the
// loadDotEnv resolution order (process env → ./.env → the per-machine
// ~/.config/provision-sitecore-component/.env written by setup.sh).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const { CLI, withTempFixture } = require("./helpers.cjs");

// Shares helpers.withTempFixture (auto-cleaned work dir) but keeps a local,
// env-ISOLATED spawn: these tests assert credential resolution, so they must
// not inherit the ambient HOME or any real SITECORE_AUTHORING_* vars the way
// helpers.runCli (which spreads process.env) intentionally does.
function scratchFixture(t) {
  const work = withTempFixture(t, "datasource-card");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-home-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, work };
}

function runCli(args, { home, work, env = {} }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: work,
    env: { PATH: process.env.PATH, HOME: home, ...env },
    encoding: "utf8",
  });
}

test("non-interactive push without --yes refuses before touching credentials", (t) => {
  const { home, work } = scratchFixture(t);
  const run = runCli(["push", "manifest.json"], { home, work });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /push requires confirmation/);
  assert.match(run.stderr, /--yes/);
  assert.doesNotMatch(run.stderr, /Missing environment variable/, "gate must fire before env resolution");
});

test("push --yes passes the gate and fails offline on the ordinary missing-env error", (t) => {
  const { home, work } = scratchFixture(t);
  const run = runCli(["push", "manifest.json", "--yes"], { home, work });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Missing environment variable\(s\): SITECORE_AUTHORING_CLIENT_ID, SITECORE_AUTHORING_CLIENT_SECRET, SITECORE_AUTHORING_ENDPOINT/);
  assert.doesNotMatch(run.stderr, /push requires confirmation/);
});

test("the central credential file fills unset keys (resolution order)", (t) => {
  const { home, work } = scratchFixture(t);
  const centralDir = path.join(home, ".config", "provision-sitecore-component");
  fs.mkdirSync(centralDir, { recursive: true });
  fs.writeFileSync(path.join(centralDir, ".env"), "SITECORE_AUTHORING_CLIENT_ID=from-central\n");
  const run = runCli(["push", "manifest.json", "--yes"], { home, work });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Missing environment variable\(s\): SITECORE_AUTHORING_CLIENT_SECRET, SITECORE_AUTHORING_ENDPOINT/);
  assert.doesNotMatch(run.stderr, /SITECORE_AUTHORING_CLIENT_ID/, "central file must satisfy CLIENT_ID");
});

test("a repo-root .env overrides the central file", (t) => {
  const { home, work } = scratchFixture(t);
  const centralDir = path.join(home, ".config", "provision-sitecore-component");
  fs.mkdirSync(centralDir, { recursive: true });
  fs.writeFileSync(path.join(centralDir, ".env"), "SITECORE_AUTHORING_CLIENT_ID=from-central\n");
  fs.writeFileSync(path.join(work, ".env"), "SITECORE_AUTHORING_CLIENT_ID=\n");
  // The repo .env sets CLIENT_ID to empty → readEnv reports it missing again,
  // proving ./.env took precedence over the central value.
  const run = runCli(["push", "manifest.json", "--yes"], { home, work });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /SITECORE_AUTHORING_CLIENT_ID/);
});

test("plan ignores --yes and still succeeds offline", (t) => {
  const { home, work } = scratchFixture(t);
  const run = runCli(["plan", "manifest.json", "--yes"], { home, work });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /plan complete/);
});

test("check does not require the gate", (t) => {
  const { home, work } = scratchFixture(t);
  const run = runCli(["check", "manifest.json"], { home, work });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Missing environment variable/);
  assert.doesNotMatch(run.stderr, /push requires confirmation/);
});

test("unknown flags still fail parseArgs", (t) => {
  const { home, work } = scratchFixture(t);
  const run = runCli(["push", "manifest.json", "--nope"], { home, work });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Unknown flag "--nope"/);
});
