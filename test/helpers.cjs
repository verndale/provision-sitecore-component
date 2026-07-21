"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.join(__dirname, "..");
const CLI = path.join(REPO_ROOT, "src", "cli.cjs");
const FIXTURES = path.join(__dirname, "fixtures");

/** Copy a fixture directory into a fresh temp dir (auto-removed via t.after). */
function withTempFixture(t, fixtureName, { only } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `psc-${fixtureName}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(FIXTURES, fixtureName);
  for (const entry of fs.readdirSync(source)) {
    if (entry === "expected" || entry === "expected-plan.json") continue;
    if (only && !only.includes(entry)) continue;
    fs.cpSync(path.join(source, entry), path.join(dir, entry), { recursive: true });
  }
  return dir;
}

/** Run the CLI as a child process. Returns { status, stdout, stderr }. */
function runCli(args, cwd, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function readFixtureFile(fixtureName, relative) {
  return fs.readFileSync(path.join(FIXTURES, fixtureName, relative), "utf8");
}

/**
 * Fake Authoring API for executor tests. State:
 * - items: [{ itemId, name, path, templateId, ownFields? }]
 * - fieldValues: { "<path>::<field>": "value" }
 * Mutations mutate the fake state so later resolves observe them.
 * `calls` records every fetch; `mutations` only the mutation documents.
 */
function makeFakeCms({ items = [], fieldValues = {}, tokenStatus = 200, failures = null } = {}) {
  const state = {
    items: items.map((i) => ({ ...i })),
    fieldValues: { ...fieldValues },
    nextId: 1,
  };
  const calls = [];
  const mutations = [];

  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const byPath = (p) => state.items.find((i) => i.path === p) || null;
  const byId = (id) => state.items.find((i) => i.itemId === id) || null;
  const newId = () => `id-${state.nextId++}`;

  async function fetchImpl(url, init) {
    calls.push({ url, init });
    if (failures) {
      const failure = failures.shift();
      if (failure !== undefined && failure !== null) {
        if (failure === "network") throw new TypeError("fetch failed");
        return json(failure, { error: "injected failure" });
      }
    }
    if (String(url).includes("/oauth/token")) {
      if (tokenStatus !== 200) return json(tokenStatus, { error: "denied" });
      return json(200, { access_token: "fake-token" });
    }
    const body = JSON.parse(init.body);
    const { query, variables } = body;

    if (/mutation\s/.test(query)) mutations.push({ query, variables });

    if (query.includes("GetTemplate") || query.includes("GetItem")) {
      const item = byPath(variables.path);
      if (!item) return json(200, { data: { item: null } });
      const payload = { itemId: item.itemId, name: item.name, path: item.path, templateId: item.templateId || null };
      if (query.includes("ownFields")) payload.ownFields = { nodes: item.ownFields || [] };
      return json(200, { data: { item: payload } });
    }
    if (query.includes("GetFieldValue")) {
      const item = byPath(variables.path);
      if (!item) return json(200, { data: { item: null } });
      const value = state.fieldValues[`${variables.path}::${variables.field}`] ?? null;
      return json(200, { data: { item: { itemId: item.itemId, field: value === null ? null : { value } } } });
    }
    if (query.includes("CreateTemplate")) {
      const input = variables.input;
      const parent = byId(input.parent);
      const itemPath = parent ? `${parent.path}/${input.name}` : `/created/${input.name}`;
      const created = {
        itemId: newId(),
        name: input.name,
        path: itemPath,
        ownFields: input.sections.flatMap((s) => s.fields.map((f) => ({ name: f.name, type: f.type }))),
      };
      state.items.push(created);
      // The real API creates the section/field item tree with the template; mirror that.
      for (const section of input.sections) {
        const sectionPath = `${itemPath}/${section.name}`;
        state.items.push({ itemId: newId(), name: section.name, path: sectionPath });
        for (const field of section.fields) {
          state.items.push({ itemId: newId(), name: field.name, path: `${sectionPath}/${field.name}` });
          state.fieldValues[`${sectionPath}/${field.name}::Type`] = field.type;
        }
      }
      return json(200, { data: { createItemTemplate: { itemTemplate: { templateId: created.itemId, name: created.name } } } });
    }
    if (query.includes("CreateItem")) {
      const input = variables.input;
      const parent = byId(input.parent);
      const itemPath = parent ? `${parent.path}/${input.name}` : `/created/${input.name}`;
      const created = { itemId: newId(), name: input.name, path: itemPath, templateId: input.templateId };
      state.items.push(created);
      for (const f of input.fields || []) {
        state.fieldValues[`${itemPath}::${f.name}`] = f.value;
      }
      return json(200, { data: { createItem: { item: { itemId: created.itemId, name: created.name, path: created.path } } } });
    }
    if (query.includes("UpdateItem")) {
      const input = variables.input;
      const item = byId(input.itemId);
      for (const f of input.fields || []) {
        if (item) state.fieldValues[`${item.path}::${f.name}`] = f.value;
      }
      return json(200, { data: { updateItem: { item: { itemId: input.itemId, path: item ? item.path : null } } } });
    }
    return json(400, { errors: [{ message: `Unrecognized query in fake CMS: ${query.slice(0, 60)}` }] });
  }

  return { fetchImpl, calls, mutations, state };
}

const FAKE_ENV = {
  SITECORE_AUTHORING_CLIENT_ID: "client-id",
  SITECORE_AUTHORING_CLIENT_SECRET: "client-secret",
  SITECORE_AUTHORING_ENDPOINT: "https://xmc.example/sitecore/api/authoring/graphql/v1",
};

module.exports = { REPO_ROOT, CLI, FIXTURES, withTempFixture, runCli, readFixtureFile, makeFakeCms, FAKE_ENV };
