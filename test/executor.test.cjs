"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { makeFakeCms, FAKE_ENV } = require("./helpers.cjs");
const { validateManifest } = require("../src/validate-manifest.cjs");
const { buildMutationPlan, SYSTEM_PATHS } = require("../src/build-plan.cjs");
const { runPlan, listMerge, normalizeId, ExecutorError } = require("../src/executor.cjs");

const CONFIG = {
  templateRoots: { datasource: "/sitecore/templates/Project/T/Components", page: "/sitecore/templates/Project/T/Pages" },
  renderingRoot: "/sitecore/layout/Renderings/Project/T",
  placeholderSettingsRoot: "/sitecore/layout/Placeholder Settings/Project/T",
  datasourceLocation: "query:$site/*[@@name='Data']",
};

const MANIFEST = {
  version: 1,
  component: "AwardCard",
  slug: "award-card",
  output: "src/components/award-card",
  templates: [
    {
      role: "datasource",
      name: "Award Card",
      sections: [
        {
          name: "Content",
          fields: [
            { name: "heading", title: "Heading", sitecoreType: "Single-Line Text", required: true },
            { name: "summary", title: "Summary", sitecoreType: "Multi-Line Text" },
          ],
        },
      ],
    },
  ],
  rendering: { name: "Award Card", datasourceTemplate: "Award Card" },
  placeholders: [{ name: "cards" }],
};

const TEMPLATE_PATH = "/sitecore/templates/Project/T/Components/Award Card";
const RENDERING_PATH = "/sitecore/layout/Renderings/Project/T/Award Card";
const PLACEHOLDER_PATH = "/sitecore/layout/Placeholder Settings/Project/T/cards";

function buildPlan(manifest = MANIFEST, config = CONFIG) {
  const { ok, errors, resolved } = validateManifest(manifest, config);
  assert.equal(ok, true, JSON.stringify(errors));
  return buildMutationPlan(manifest, resolved, "manifest.json");
}

/** System + root items every scenario needs. */
function baseItems() {
  return [
    { itemId: "sys-section", name: "Template section", path: SYSTEM_PATHS.templateSectionTemplate },
    { itemId: "sys-field", name: "Template field", path: SYSTEM_PATHS.templateFieldTemplate },
    { itemId: "rule-req", name: "Required", path: SYSTEM_PATHS.requiredFieldRule },
    {
      itemId: "json-rendering",
      name: "Json Rendering",
      path: SYSTEM_PATHS.jsonRenderingTemplate,
      ownFields: [{ name: "componentName", type: "Single-Line Text" }, { name: "Datasource Template", type: "Single-Line Text" }, { name: "Datasource Location", type: "Single-Line Text" }],
    },
    { itemId: "sys-placeholder", name: "Placeholder", path: SYSTEM_PATHS.placeholderSettingsTemplate },
    { itemId: "root-tmpl", name: "Components", path: CONFIG.templateRoots.datasource },
    { itemId: "root-rend", name: "Project", path: CONFIG.renderingRoot },
    { itemId: "root-ph", name: "Project", path: CONFIG.placeholderSettingsRoot },
  ];
}

/** Items describing an already fully provisioned component. */
function provisionedItems() {
  return [
    ...baseItems(),
    {
      itemId: "tmpl-award",
      name: "Award Card",
      path: TEMPLATE_PATH,
      ownFields: [{ name: "heading", type: "Single-Line Text" }, { name: "summary", type: "Multi-Line Text" }],
    },
    { itemId: "sec-content", name: "Content", path: `${TEMPLATE_PATH}/Content` },
    { itemId: "fld-heading", name: "heading", path: `${TEMPLATE_PATH}/Content/heading` },
    { itemId: "fld-summary", name: "summary", path: `${TEMPLATE_PATH}/Content/summary` },
    { itemId: "rend-award", name: "Award Card", path: RENDERING_PATH },
    { itemId: "ph-cards", name: "cards", path: PLACEHOLDER_PATH },
  ];
}

test("push against a fresh CMS creates the template, rendering, and placeholder, and never deletes", async () => {
  const cms = makeFakeCms({ items: baseItems() });
  const logLines = [];
  const outcome = await runPlan(buildPlan(), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0, log: (l) => logLines.push(l) });

  assert.equal(outcome.ok, true);
  const createTemplateCalls = cms.mutations.filter((m) => m.query.includes("CreateTemplate"));
  assert.equal(createTemplateCalls.length, 1);
  assert.equal(createTemplateCalls[0].variables.input.parent, "root-tmpl", "parent placeholder must be substituted with the resolved id");

  const tokenCalls = cms.calls.filter((c) => String(c.url).includes("/oauth/token"));
  assert.equal(tokenCalls.length, 1, "token is fetched once and reused");
  const gqlCalls = cms.calls.filter((c) => !String(c.url).includes("/oauth/token"));
  assert.ok(gqlCalls.every((c) => c.init.headers.authorization === "Bearer fake-token"));

  for (const mutation of cms.mutations) {
    assert.doesNotMatch(mutation.query, /delete/i, "no mutation may delete");
  }

  assert.ok(cms.mutations.some((m) => m.query.includes("CreateItem") && m.variables.input.name === "Award Card" && m.variables.input.templateId === "json-rendering"));
  const bindingUpdate = cms.mutations.find((m) => m.query.includes("UpdateItem") && (m.variables.input.fields || []).some((f) => f.name === "componentName"));
  assert.ok(bindingUpdate, "rendering bindings are written");
  assert.ok(cms.state.fieldValues[`${PLACEHOLDER_PATH}::Allowed Controls`], "rendering appended to Allowed Controls");

  const requiredBars = cms.state.fieldValues[`${TEMPLATE_PATH}/Content/heading::Validate Button`];
  assert.ok(requiredBars && requiredBars.includes("rule-req"), "Required rule appended to the validation bar");

  const everything = logLines.join("\n") + JSON.stringify(outcome.results);
  assert.ok(!everything.includes(FAKE_ENV.SITECORE_AUTHORING_CLIENT_SECRET), "secrets never appear in output");
});

test("push against a fully provisioned CMS is a no-op apart from idempotent config/binding sets", async () => {
  const cms = makeFakeCms({
    items: provisionedItems(),
    fieldValues: {
      [`${TEMPLATE_PATH}/Content/heading::Validate Button`]: "{RULE-REQ}",
      [`${TEMPLATE_PATH}/Content/heading::Workflow`]: "{RULE-REQ}",
      [`${PLACEHOLDER_PATH}::Allowed Controls`]: "{REND-AWARD}",
    },
  });
  const outcome = await runPlan(buildPlan(), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.equal(cms.mutations.filter((m) => m.query.includes("CreateTemplate")).length, 0);
  assert.equal(cms.mutations.filter((m) => m.query.includes("CreateItem")).length, 0);
  const barUpdates = cms.mutations.filter((m) => m.query.includes("UpdateItem") && (m.variables.input.fields || []).some((f) => ["Validate Button", "Workflow", "Allowed Controls"].includes(f.name)));
  assert.equal(barUpdates.length, 0, "already-merged lists are not rewritten (brace/case-insensitive match)");
  assert.ok(outcome.results.some((r) => r.id === "ensure-template-0" && r.action === "no-op"));
  assert.ok(outcome.results.some((r) => r.id === "ensure-placeholder-settings-0" && r.action === "no-op"));
});

test("push reconciles an existing template add-only: missing fields created, extras and type conflicts reported, never retyped", async () => {
  const items = provisionedItems().filter((i) => !i.path.endsWith("/Content/summary"));
  const template = items.find((i) => i.path === TEMPLATE_PATH);
  template.ownFields = [
    { name: "heading", type: "Rich Text" },
    { name: "legacyField", type: "Single-Line Text" },
  ];
  const cms = makeFakeCms({ items });
  const outcome = await runPlan(buildPlan(), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  const fieldCreates = cms.mutations.filter((m) => m.query.includes("CreateItem") && m.variables.input.templateId === "sys-field");
  assert.equal(fieldCreates.length, 1);
  assert.equal(fieldCreates[0].variables.input.name, "summary");

  assert.ok(outcome.followUps.some((f) => f.includes('"legacyField"') && f.includes("never deleted")));
  assert.ok(outcome.followUps.some((f) => f.includes('"heading"') && f.includes("Rich Text")));

  const headingUpdates = cms.mutations.filter((m) => m.query.includes("UpdateItem")).flatMap((m) => m.variables.input.fields || []);
  const typeWritesToHeading = cms.mutations.filter(
    (m) => m.query.includes("UpdateItem") && m.variables.input.itemId === "fld-heading" && (m.variables.input.fields || []).some((f) => f.name === "Type")
  );
  assert.equal(typeWritesToHeading.length, 0, "a type-conflicted field is never retyped");
  assert.ok(headingUpdates.some((f) => f.name === "Title"), "safe field config still applies");
});

test("check mode issues zero mutations and reports per-op decisions", async () => {
  const cms = makeFakeCms({ items: baseItems() });
  const outcome = await runPlan(buildPlan(), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.equal(cms.mutations.length, 0);
  assert.ok(outcome.results.some((r) => r.id === "ensure-template-0" && r.action === "create"));
  assert.ok(outcome.results.some((r) => r.id === "set-rendering-bindings" && r.action === "update"));
});

test("existing:true template that is absent aborts with a conflict", async () => {
  const manifest = { ...MANIFEST, templates: [{ ...MANIFEST.templates[0], existing: true }] };
  const cms = makeFakeCms({ items: baseItems() });
  await assert.rejects(
    runPlan(buildPlan(manifest), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "conflict" && /marked existing was not found/.test(error.message)
  );
});

test("a Json Rendering template missing the binding fields aborts with remediation", async () => {
  const items = baseItems();
  items.find((i) => i.itemId === "json-rendering").ownFields = [{ name: "componentName", type: "Single-Line Text" }];
  const cms = makeFakeCms({ items });
  await assert.rejects(
    runPlan(buildPlan(), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "conflict" && /missing expected field\(s\): Datasource Template, Datasource Location/.test(error.message)
  );
});

test("transient 5xx failures retry up to 3 attempts and then succeed", async () => {
  const cms = makeFakeCms({ items: baseItems(), failures: [500, 500] });
  const outcome = await runPlan(buildPlan(), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });
  assert.equal(outcome.ok, true);
  assert.equal(cms.calls.filter((c) => String(c.url).includes("/oauth/token")).length, 3, "two 500s then success = 3 attempts");
});

test("persistent 5xx fails after the 3-attempt cap", async () => {
  const cms = makeFakeCms({ items: baseItems(), failures: [500, 500, 500] });
  await assert.rejects(
    runPlan(buildPlan(), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "api" && /HTTP 500/.test(error.message)
  );
  assert.equal(cms.calls.length, 3);
});

test("401 responses never retry", async () => {
  const cms = makeFakeCms({ items: baseItems(), failures: [null, 401] });
  await assert.rejects(
    runPlan(buildPlan(), { mode: "check", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "auth"
  );
  assert.equal(cms.calls.length, 2, "one token call + one unretried 401");
});

test("missing env vars fail before any network call", async () => {
  const cms = makeFakeCms({ items: baseItems() });
  await assert.rejects(
    runPlan(buildPlan(), { mode: "check", env: {}, fetchImpl: cms.fetchImpl, retryDelayMs: 0 }),
    (error) => error instanceof ExecutorError && error.kind === "config" && /SITECORE_AUTHORING_CLIENT_ID/.test(error.message)
  );
  assert.equal(cms.calls.length, 0);
});

test("insert options naming a later-declared manifest template resolve on the first push", async () => {
  const manifest = {
    ...MANIFEST,
    rendering: null,
    placeholders: [],
    templates: [
      { ...MANIFEST.templates[0], insertOptions: ["Second Template"] },
      {
        role: "datasource",
        name: "Second Template",
        sections: [{ name: "Content", fields: [{ name: "label", title: "Label", sitecoreType: "Single-Line Text" }] }],
      },
    ],
  };
  const cms = makeFakeCms({ items: baseItems() });
  const outcome = await runPlan(buildPlan(manifest), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.ok(!outcome.followUps.some((f) => /Insert option .* was not found/.test(f)), "the later template must exist before insert options resolve");
  const second = cms.state.items.find((i) => i.path === `${CONFIG.templateRoots.datasource}/Second Template`);
  const masters = cms.state.fieldValues[`${TEMPLATE_PATH}/__Standard Values::__Masters`];
  assert.ok(second && masters && masters.includes(second.itemId), "__Masters carries the created template id on the first push");
});

test("a field living under a different section becomes a conflict follow-up, not a mid-run abort", async () => {
  const items = provisionedItems().filter((i) => !i.path.endsWith("/Content/heading"));
  items.push({ itemId: "fld-heading", name: "heading", path: `${TEMPLATE_PATH}/Details/heading` });
  const cms = makeFakeCms({ items });
  const outcome = await runPlan(buildPlan(), { mode: "push", env: FAKE_ENV, fetchImpl: cms.fetchImpl, retryDelayMs: 0 });

  assert.equal(outcome.ok, true, "the run completes instead of aborting");
  assert.ok(outcome.followUps.some((f) => f.includes(`Field item not found at ${TEMPLATE_PATH}/Content/heading`)));
  assert.ok(outcome.results.some((r) => r.id.endsWith("configure-field-0-Content-heading") && r.action === "conflict"));
  const headingWrites = cms.mutations.filter((m) => m.query.includes("UpdateItem") && m.variables.input.itemId === "fld-heading");
  assert.equal(headingWrites.length, 0, "nothing is written to the mislocated field");
});

test("listMerge appends only when missing, normalizing braces and case", () => {
  assert.equal(listMerge("", "id-1"), "id-1");
  assert.equal(listMerge(null, "id-1"), "id-1");
  assert.equal(listMerge("id-1", "id-2"), "id-1|id-2");
  assert.equal(listMerge("{ID-1}|id-2", "id-1"), null, "brace/case-insensitive duplicate → no-op");
  assert.equal(normalizeId("{ABC-Def}"), "abc-def");
});
