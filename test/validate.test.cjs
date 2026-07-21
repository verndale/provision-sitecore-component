"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { withTempFixture, runCli } = require("./helpers.cjs");
const { pascalToKebab } = require("../src/util.cjs");
const { resolveType } = require("../src/type-map.cjs");

const INVALID_CASES = [
  { manifest: "bad-version.json", pattern: /Unsupported manifest version/ },
  { manifest: "slug-mismatch.json", pattern: /slug \("awardcard"\) does not match component/ },
  { manifest: "empty-fields.json", pattern: /fields is missing or empty/ },
  { manifest: "dupe-names.json", pattern: /duplicates another field/ },
  { manifest: "path-escape.json", pattern: /output \("\.\.\/outside\/award-card"\) is invalid/ },
  { manifest: "unknown-ds-template.json", pattern: /datasourceTemplate \("Card That Does Not Exist"\) is unknown/ },
  { manifest: "bad-section.json", pattern: /sections\[0\]\.name \("Content "\) is invalid/ },
];

for (const { manifest, pattern } of INVALID_CASES) {
  test(`invalid manifest ${manifest} → exit 2 with an ERROR/Cause/Next line`, (t) => {
    const dir = withTempFixture(t, "invalid");
    const run = runCli(["plan", manifest], dir);
    assert.equal(run.status, 2);
    assert.match(run.stderr, pattern);
    assert.match(run.stderr, /ERROR: .* Cause: .* Next: /);
  });
}

test("missing template roots (no config at all) → exit 2 naming the missing key", (t) => {
  const dir = withTempFixture(t, "invalid", { only: ["missing-paths.json"] });
  const run = runCli(["plan", "missing-paths.json"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /No template root configured for role "datasource"/);
});

test("wrong stack adapter in build.config.json → exit 2", (t) => {
  const dir = withTempFixture(t, "wrong-adapter");
  const run = runCli(["plan", "manifest.json"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /stackAdapter "optimizely"/);
});

test("unknown flag → exit 2", (t) => {
  const dir = withTempFixture(t, "page-fields");
  const run = runCli(["plan", "manifest.json", "--bogus"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Unknown flag "--bogus"/);
});

test("missing manifest file → exit 2", (t) => {
  const dir = withTempFixture(t, "page-fields", { only: ["provision.config.json"] });
  const run = runCli(["plan", "nope.json"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Manifest not found/);
});

test("extra positional argument → exit 2", (t) => {
  const dir = withTempFixture(t, "page-fields");
  const run = runCli(["plan", "manifest.json", "extra.json"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Unexpected argument/);
});

test("pascalToKebab handles acronym runs", () => {
  assert.equal(pascalToKebab("AwardCard"), "award-card");
  assert.equal(pascalToKebab("CNPeopleCard"), "cn-people-card");
  assert.equal(pascalToKebab("PeopleDetailMasthead"), "people-detail-masthead");
});

test("resolveType falls back to a generic entry naming the unmapped type", () => {
  const row = resolveType("Custom Badge Picker");
  assert.equal(row.tsType, "Field<unknown>");
  assert.match(row.todoNote, /Custom Badge Picker/);
  assert.equal(resolveType("single-line text").tsType, "Field<string>");
  assert.equal(resolveType("Rich Text").renderer, "richtext");
});
