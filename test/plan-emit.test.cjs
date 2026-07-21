"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { withTempFixture, runCli, readFixtureFile } = require("./helpers.cjs");
const { validateManifest } = require("../src/validate-manifest.cjs");
const { buildMutationPlan, serializePlan } = require("../src/build-plan.cjs");
const { emitTypes, emitComponent } = require("../src/emit-tsx.cjs");

const GOLDENS = [
  {
    fixture: "datasource-card",
    slug: "related-content-card",
    component: "RelatedContentCard",
    output: "src/components/related-content/related-content-card",
    configFile: "build.config.json",
    configKey: "sitecoreProvisioning",
  },
  {
    fixture: "page-fields",
    slug: "people-detail-masthead",
    component: "PeopleDetailMasthead",
    output: "src/components/people/people-detail-masthead",
    configFile: "provision.config.json",
    configKey: null,
  },
];

for (const golden of GOLDENS) {
  test(`golden: ${golden.fixture} plan + TSX pair are byte-identical to the frozen expected output`, (t) => {
    const dir = withTempFixture(t, golden.fixture);
    const run = runCli(["plan", "manifest.json"], dir);
    assert.equal(run.status, 0, run.stderr);

    const plan = fs.readFileSync(path.join(dir, `${golden.slug}.plan.json`), "utf8");
    assert.equal(plan, readFixtureFile(golden.fixture, "expected-plan.json"));

    const types = fs.readFileSync(path.join(dir, golden.output, `${golden.component}.types.ts`), "utf8");
    assert.equal(types, readFixtureFile(golden.fixture, `expected/${golden.component}.types.ts`));

    const tsx = fs.readFileSync(path.join(dir, golden.output, `${golden.component}.tsx`), "utf8");
    assert.equal(tsx, readFixtureFile(golden.fixture, `expected/${golden.component}.tsx`));
  });

  test(`golden: ${golden.fixture} pure functions are deterministic across two runs`, () => {
    const manifest = JSON.parse(readFixtureFile(golden.fixture, "manifest.json"));
    const rawConfig = JSON.parse(readFixtureFile(golden.fixture, golden.configFile));
    const config = golden.configKey ? rawConfig[golden.configKey] : rawConfig;
    const { ok, resolved } = validateManifest(manifest, config);
    assert.equal(ok, true);

    const first = serializePlan(buildMutationPlan(manifest, resolved, "manifest.json"));
    const second = serializePlan(buildMutationPlan(manifest, resolved, "manifest.json"));
    assert.equal(first, second);
    assert.ok(first.endsWith("\n"));
    assert.ok(!first.includes(new Date().getFullYear() + "-"), "plan must not embed timestamps");

    assert.equal(emitTypes(manifest, resolved), emitTypes(manifest, resolved));
    assert.equal(emitComponent(manifest), emitComponent(manifest));
  });
}

test("re-running plan skips existing TSX files (create-only) and stays exit 0", (t) => {
  const dir = withTempFixture(t, "datasource-card");
  const first = runCli(["plan", "manifest.json"], dir);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /wrote src[/\\]components/);

  const second = runCli(["plan", "manifest.json"], dir);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /skipped \(exists\)/);
  assert.doesNotMatch(second.stdout, /wrote src[/\\]components/);
});

test("--force-tsx overwrites an existing scaffold", (t) => {
  const dir = withTempFixture(t, "datasource-card");
  assert.equal(runCli(["plan", "manifest.json"], dir).status, 0);
  const target = path.join(dir, "src/components/related-content/related-content-card/RelatedContentCard.tsx");
  fs.writeFileSync(target, "// hand-edited\n");

  const run = runCli(["plan", "manifest.json", "--force-tsx"], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /wrote src[/\\]components/);
  assert.notEqual(fs.readFileSync(target, "utf8"), "// hand-edited\n");
});

test("--no-tsx writes the plan but no scaffold files", (t) => {
  const dir = withTempFixture(t, "datasource-card");
  const run = runCli(["plan", "manifest.json", "--no-tsx"], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(path.join(dir, "related-content-card.plan.json")));
  assert.ok(!fs.existsSync(path.join(dir, "src")));
});

test("manifest path is accepted without an explicit subcommand (plan is the default)", (t) => {
  const dir = withTempFixture(t, "page-fields");
  const run = runCli(["manifest.json"], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /plan complete for PeopleDetailMasthead/);
});
