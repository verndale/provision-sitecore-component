"use strict";

// Issue #1: coverage-policy.json must classify every skill as required-or-excluded, and every
// policy name must map to a real SKILL.md. These exercise check.cjs's exported pure helpers plus a
// real-tree green-guard that fires the moment a new unclassified SKILL.md appears. The final test
// spawns the real check.cjs so the main() wiring — not just the pure fn — is proven to enforce it.
// This file also runs under `pnpm test`, so a broken scenario/policy fails the same CI gate as the
// unit suite (in addition to the dedicated `evals:check` script / evals workflow).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const {
  coverageCompletenessErrors,
  listSkillNames,
  validateCoveragePolicy,
  validateSuite,
} = require("../scripts/evals/check.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");

test("flags a skill on disk that is in neither requiredSkills nor excludedSkills", () => {
  const errors = coverageCompletenessErrors(
    ["provision-sitecore-component", "orphan-skill"],
    { "provision-sitecore-component": {} },
    {}
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /skill "orphan-skill" .* neither requiredSkills nor excludedSkills/);
  assert.ok(!errors.some((e) => /provision-sitecore-component/.test(e)));
});

test("accepts a skill covered by excludedSkills", () => {
  const errors = coverageCompletenessErrors(
    ["provision-sitecore-component", "vendored-thing"],
    { "provision-sitecore-component": {} },
    { "vendored-thing": { reason: "vendored catalog" } }
  );
  assert.deepEqual(errors, []);
});

test("accepts a skill covered by requiredSkills", () => {
  assert.deepEqual(
    coverageCompletenessErrors(["provision-sitecore-component"], { "provision-sitecore-component": {} }, {}),
    []
  );
});

test("flags a stale requiredSkills entry with no matching SKILL.md", () => {
  const errors = coverageCompletenessErrors(
    ["provision-sitecore-component"],
    { "provision-sitecore-component": {}, "renamed-old": {} },
    {}
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /requiredSkills names "renamed-old" .* no skills\/renamed-old\/SKILL\.md/);
});

test("flags a stale excludedSkills entry with no matching SKILL.md", () => {
  const errors = coverageCompletenessErrors(
    ["provision-sitecore-component"],
    { "provision-sitecore-component": {} },
    { "gone-skill": { reason: "x" } }
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /excludedSkills names "gone-skill"/);
});

test("treats undefined excludedSkills as no exclusions", () => {
  assert.deepEqual(
    coverageCompletenessErrors(["provision-sitecore-component"], { "provision-sitecore-component": {} }, undefined),
    []
  );
});

test("real tree green-guard: every SKILL.md is classified in the live policy", () => {
  const policy = require(path.join(REPO_ROOT, "evals", "_shared", "coverage-policy.json"));
  const skillNames = listSkillNames(REPO_ROOT);
  assert.ok(skillNames.length >= 1, `expected >= 1 skill, found ${skillNames.length}`);
  const errors = coverageCompletenessErrors(skillNames, policy.requiredSkills, policy.excludedSkills);
  assert.deepEqual(errors, [], `live coverage-policy is incomplete:\n${errors.join("\n")}`);
});

test("validateSuite surfaces the completeness error (wiring, not just the pure fn)", () => {
  const result = validateSuite({
    repoRoot: REPO_ROOT,
    coveragePolicy: {
      version: 1,
      globalMinScenarios: 1,
      allowedTags: ["happy-path"],
      requiredSkills: { "provision-sitecore-component": { minScenarios: 1, requiredTags: ["happy-path"] } },
    },
    schemaDoc: null,
    scenarioRecords: [],
    validateSchemaDocFlag: false,
    skillNames: ["provision-sitecore-component", "orphan"],
  });
  assert.ok(result.errors.some((e) => /neither requiredSkills nor excludedSkills/.test(e)));
});

test("structural: a skill in both requiredSkills and excludedSkills is rejected", () => {
  const errors = validateCoveragePolicy(
    {
      version: 1,
      globalMinScenarios: 1,
      allowedTags: ["happy-path"],
      requiredSkills: { "provision-sitecore-component": { minScenarios: 1, requiredTags: ["happy-path"] } },
      excludedSkills: { "provision-sitecore-component": { reason: "duplicate" } },
    },
    "policy"
  );
  assert.ok(errors.some((e) => /cannot be in both/.test(e)));
});

test("structural: an excludedSkills entry without a reason is rejected", () => {
  const errors = validateCoveragePolicy(
    {
      version: 1,
      globalMinScenarios: 1,
      allowedTags: ["happy-path"],
      requiredSkills: { "provision-sitecore-component": { minScenarios: 1, requiredTags: ["happy-path"] } },
      excludedSkills: { x: {} },
    },
    "policy"
  );
  assert.ok(errors.some((e) => /must declare a non-empty "reason"/.test(e)));
});

// The end-to-end guard: prove the real `node check.cjs` command actually enforces completeness,
// not just the pure function. A future edit dropping the skillNames threading in main()/loadRealSuite
// would make the check a silent no-op while every in-process test still passed — this catches that.
test("the real check.cjs command fails when a skill is unclassified (main wiring)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evals-check-cli-"));
  try {
    const orphanDir = path.join(tmp, "skills", "orphan-skill");
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "SKILL.md"), "# orphan\n");

    const sharedDir = path.join(tmp, "evals", "_shared");
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(sharedDir, "coverage-policy.json"),
      JSON.stringify({
        version: 1,
        globalMinScenarios: 1,
        allowedTags: ["happy-path"],
        requiredSkills: { placeholder: { minScenarios: 1, requiredTags: ["happy-path"] } },
      })
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, "evals", "_shared", "scenario.schema.json"),
      path.join(sharedDir, "scenario.schema.json")
    );

    const checker = path.join(REPO_ROOT, "scripts", "evals", "check.cjs");
    const run = spawnSync(process.execPath, [checker], {
      env: { ...process.env, EVALS_REPO_ROOT: tmp },
      encoding: "utf8",
    });
    const output = `${run.stdout}\n${run.stderr}`;
    assert.notEqual(run.status, 0, "check.cjs must exit non-zero when a skill is unclassified");
    assert.match(output, /skill "orphan-skill" .* neither requiredSkills nor excludedSkills/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Real-suite gate: run the committed check.cjs against this repo so `pnpm test` fails on any
// broken scenario, coverage shortfall, or self-check regression — not only the dedicated
// evals workflow. This is what makes a weakened guardrail fail the primary CI gate.
test("the committed eval suite passes the real check.cjs (real-suite gate)", () => {
  const checker = path.join(REPO_ROOT, "scripts", "evals", "check.cjs");
  const run = spawnSync(process.execPath, [checker], { encoding: "utf8" });
  const output = `${run.stdout}\n${run.stderr}`;
  assert.equal(run.status, 0, `check.cjs must pass for the committed suite:\n${output}`);
  assert.match(run.stdout, /PASS eval validation succeeded/);
});
