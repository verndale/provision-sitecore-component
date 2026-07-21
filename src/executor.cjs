"use strict";

/**
 * Authoring API executor. Runs a mutation plan against the XM Cloud Authoring GraphQL
 * API in one of two modes:
 * - "check": read-only. Preflight queries only; reports the decision each op would
 *   take (create / update / no-op / conflict). Never issues a mutation (enforced).
 * - "push": mutating. Create-or-update reconcile, add-only everywhere: never deletes,
 *   renames, retypes, or removes list entries. Anything declined is reported in
 *   followUps instead.
 *
 * Auth: OAuth2 client credentials. Env (values are never logged):
 *   SITECORE_AUTHORING_CLIENT_ID, SITECORE_AUTHORING_CLIENT_SECRET,
 *   SITECORE_AUTHORING_ENDPOINT (the .../sitecore/api/authoring/graphql/v1 URL),
 *   SITECORE_AUTHORING_TOKEN_URL (default https://auth.sitecorecloud.io/oauth/token),
 *   SITECORE_AUTHORING_AUDIENCE (default https://api.sitecorecloud.io).
 *
 * Transport retry: at most 3 attempts per request, only on network errors, 429, or
 * 5xx. Other 4xx and GraphQL-level errors never retry.
 *
 * `fetchImpl` is injectable for tests; defaults to global fetch.
 */

const DEFAULT_TOKEN_URL = "https://auth.sitecorecloud.io/oauth/token";
const DEFAULT_AUDIENCE = "https://api.sitecorecloud.io";
const MAX_ATTEMPTS = 3;

class ExecutorError extends Error {
  constructor(kind, message, next) {
    super(message);
    this.name = "ExecutorError";
    this.kind = kind; // "config" | "auth" | "api" | "conflict"
    this.next = next || null;
  }
}

function readEnv(env) {
  const required = {
    clientId: "SITECORE_AUTHORING_CLIENT_ID",
    clientSecret: "SITECORE_AUTHORING_CLIENT_SECRET",
    endpoint: "SITECORE_AUTHORING_ENDPOINT",
  };
  const out = {};
  const missing = [];
  for (const [key, name] of Object.entries(required)) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) out[key] = value.trim();
    else missing.push(name);
  }
  if (missing.length > 0) {
    throw new ExecutorError(
      "config",
      `Missing environment variable(s): ${missing.join(", ")}.`,
      "Set the XM Cloud automation-client credentials and Authoring API endpoint (see the README's Authentication section), then re-run."
    );
  }
  out.tokenUrl = (env.SITECORE_AUTHORING_TOKEN_URL || DEFAULT_TOKEN_URL).trim();
  out.audience = (env.SITECORE_AUTHORING_AUDIENCE || DEFAULT_AUDIENCE).trim();
  return out;
}

function normalizeId(id) {
  return String(id || "").toLowerCase().replace(/[{}]/g, "");
}

/** Append an id to a pipe-delimited GUID list only when missing. Returns null for no-op. */
function listMerge(currentValue, id) {
  const current = String(currentValue || "").split("|").map((s) => s.trim()).filter(Boolean);
  if (current.some((entry) => normalizeId(entry) === normalizeId(id))) return null;
  return [...current, id].join("|");
}

/** Deep-substitute `__NAME__` placeholder strings from the bindings map. */
function substitute(value, bindings) {
  if (typeof value === "string") {
    return Object.prototype.hasOwnProperty.call(bindings, value) ? bindings[value] : value;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, bindings));
  if (typeof value === "object" && value !== null) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, bindings);
    return out;
  }
  return value;
}

function createClient(plan, options) {
  const { fetchImpl, env, mode, log, retryDelayMs } = options;
  const doFetch = fetchImpl || globalThis.fetch;
  const config = readEnv(env);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let token = null;

  async function requestWithRetry(url, init, label) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response = null;
      try {
        response = await doFetch(url, init);
      } catch (cause) {
        lastError = new ExecutorError("api", `${label}: network error (${cause.message}).`, "Check connectivity to the endpoint and re-run.");
        if (attempt < MAX_ATTEMPTS) await sleep(retryDelayMs * attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = new ExecutorError("api", `${label}: HTTP ${response.status}.`, "The service is throttling or erroring; re-run later if this persists.");
        if (attempt < MAX_ATTEMPTS) await sleep(retryDelayMs * attempt);
        continue;
      }
      return response;
    }
    throw lastError;
  }

  async function getToken() {
    if (token) return token;
    const response = await requestWithRetry(
      config.tokenUrl,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          audience: config.audience,
          grant_type: "client_credentials",
        }),
      },
      "Token request"
    );
    if (!response.ok) {
      throw new ExecutorError("auth", `Token request failed (HTTP ${response.status}).`, "Verify the automation client id/secret, token URL, and audience.");
    }
    const body = await response.json();
    if (!body || typeof body.access_token !== "string") {
      throw new ExecutorError("auth", "Token response had no access_token.", "Verify the automation client is authorized for the Authoring API.");
    }
    token = body.access_token;
    return token;
  }

  async function graphql(documentKey, variables, { mutation = false } = {}) {
    if (mutation && mode !== "push") {
      throw new ExecutorError("api", `Refused to run mutation ${documentKey} outside push mode.`, "This is an internal guard; report it if you hit it.");
    }
    const query = plan.graphql[documentKey];
    if (!query) {
      throw new ExecutorError("api", `Plan has no GraphQL document named ${documentKey}.`, "Regenerate the plan with the current tool version.");
    }
    const bearer = await getToken();
    const response = await requestWithRetry(
      config.endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ query, variables }),
      },
      `GraphQL ${documentKey}`
    );
    if (!response.ok) {
      const kind = response.status === 401 || response.status === 403 ? "auth" : "api";
      throw new ExecutorError(kind, `GraphQL ${documentKey} failed (HTTP ${response.status}).`, kind === "auth" ? "Verify the automation client has Authoring API access to this environment." : "Inspect the endpoint and re-run.");
    }
    const body = await response.json();
    if (body.errors && body.errors.length > 0) {
      const message = body.errors.map((e) => e.message).join("; ");
      throw new ExecutorError("api", `GraphQL ${documentKey} returned errors: ${message}`, "The Authoring API rejected the operation; see the message for the field/shape to fix.");
    }
    return body.data;
  }

  return {
    log: log || (() => {}),
    mode,
    graphql,
    async itemByPath(path) {
      const data = await graphql("ITEM_BY_PATH", { path });
      return data.item || null;
    },
    async templateByPath(path) {
      const data = await graphql("TEMPLATE_BY_PATH", { path });
      return data.item || null;
    },
    async fieldValue(path, field) {
      const data = await graphql("FIELD_VALUE", { path, field });
      if (!data.item) return { item: null, value: null };
      return { item: data.item, value: data.item.field ? data.item.field.value : null };
    },
    async updateItem(itemId, fields) {
      const data = await graphql("UPDATE_ITEM", { input: { itemId, language: "en", fields } }, { mutation: true });
      return data.updateItem.item;
    },
    async createItem(input) {
      const data = await graphql("CREATE_ITEM", { input }, { mutation: true });
      return data.createItem.item;
    },
    async createItemTemplate(input) {
      const data = await graphql("CREATE_ITEM_TEMPLATE", { input }, { mutation: true });
      return data.createItemTemplate.itemTemplate;
    },
  };
}

function planRequiresRule(plan) {
  return plan.ops.some((op) => op.kind === "configureField" && op.required);
}

async function resolveBinding(client, bindings, path, placeholder, { optional = false, remediation } = {}) {
  const item = await client.itemByPath(path);
  if (!item) {
    if (optional) return null;
    throw new ExecutorError("conflict", `Required item not found at ${path}.`, remediation || "Verify the configured Sitecore paths against this environment, then re-run.");
  }
  bindings[placeholder] = item.itemId;
  return item;
}

async function runPlan(plan, options) {
  const mode = options.mode === "push" ? "push" : "check";
  const client = createClient(plan, { ...options, mode, retryDelayMs: options.retryDelayMs === undefined ? 250 : options.retryDelayMs });
  const bindings = {};
  const results = [];
  const followUps = [...plan.manualFollowUps];
  const record = (id, action, detail) => {
    results.push({ id, action, detail });
    client.log(`${action.padEnd(9)} ${id}${detail ? ` — ${detail}` : ""}`);
  };

  for (const op of plan.ops) {
    switch (op.kind) {
      case "resolveSystemItems": {
        for (const [placeholder, path] of Object.entries(op.resolves)) {
          if (placeholder === "__REQUIRED_RULE_ID__" && !planRequiresRule(plan)) continue;
          await resolveBinding(client, bindings, path, placeholder, {
            remediation: `The well-known system item ${path} was not found; this environment differs from the assumed XM Cloud layout. Adjust the plan/manifest paths.`,
          });
        }
        record(op.id, "resolved", `${Object.keys(op.resolves).length} system item path(s)`);
        break;
      }

      case "ensureTemplate": {
        const found = await client.templateByPath(op.targetPath);
        if (found) {
          bindings[Object.keys(op.resolves)[0]] = found.itemId;
          bindings[`${op.id}:ownFields`] = found.ownFields ? found.ownFields.nodes : [];
          record(op.id, "no-op", `template exists at ${op.targetPath}`);
          break;
        }
        if (op.existing) {
          throw new ExecutorError("conflict", op.whenAbsent.error, "Fix the manifest (existing flag or template root) so it points at the real template, then re-run.");
        }
        if (mode === "check") {
          bindings[`${op.id}:absent`] = true;
          record(op.id, "create", `template ${op.templateName} with ${op.whenAbsent.variables.input.sections.reduce((n, s) => n + s.fields.length, 0)} field(s) at ${op.targetPath}`);
          break;
        }
        await resolveBinding(client, bindings, op.whenAbsent.resolveParent.path, op.whenAbsent.resolveParent.into, {
          remediation: `The template root ${op.whenAbsent.resolveParent.path} does not exist. Create it (or fix templateRoots in the config), then re-run.`,
        });
        const created = await client.createItemTemplate(substitute(op.whenAbsent.variables.input, bindings));
        bindings[Object.keys(op.resolves)[0]] = created.templateId;
        bindings[`${op.id}:created`] = true;
        record(op.id, "created", `template ${op.templateName} at ${op.targetPath}`);
        break;
      }

      case "ensureTemplateFields": {
        const ensureOpId = op.id.replace("ensure-template-fields-", "ensure-template-");
        if (bindings[`${ensureOpId}:created`] || bindings[`${ensureOpId}:absent`]) {
          record(op.id, "no-op", "fields covered by template creation");
          break;
        }
        const ownFields = bindings[`${ensureOpId}:ownFields`] || [];
        const cmsFieldNames = new Map(ownFields.map((f) => [f.name.toLowerCase(), f]));
        const desired = op.sections.flatMap((s) => s.fields.map((f) => ({ ...f, section: s.name, sectionPath: s.path })));
        const missing = desired.filter((f) => !cmsFieldNames.has(f.name.toLowerCase()));
        const conflicts = desired.filter((f) => {
          const cms = cmsFieldNames.get(f.name.toLowerCase());
          return cms && String(cms.type).toLowerCase() !== String(f.type).toLowerCase();
        });
        const manifestNames = new Set(desired.map((f) => f.name.toLowerCase()));
        const extras = ownFields.filter((f) => !manifestNames.has(f.name.toLowerCase()));
        for (const conflict of conflicts) {
          bindings[`typeConflict:${conflict.sectionPath}/${conflict.name}`] = true;
          followUps.push(`Field "${conflict.name}" on ${op.templatePath} is "${cmsFieldNames.get(conflict.name.toLowerCase()).type}" in the CMS but "${conflict.type}" in the manifest — left untouched; reconcile manually.`);
        }
        for (const extra of extras) {
          followUps.push(`Field "${extra.name}" exists on ${op.templatePath} but not in the manifest — left untouched (never deleted).`);
        }
        if (missing.length === 0) {
          record(op.id, conflicts.length > 0 ? "conflict" : "no-op", conflicts.length > 0 ? `${conflicts.length} type mismatch(es), see follow-ups` : "all manifest fields present");
          break;
        }
        if (mode === "check") {
          record(op.id, "update", `+${missing.length} field(s): ${missing.map((f) => f.name).join(", ")}`);
          break;
        }
        for (const field of missing) {
          let section = await client.itemByPath(field.sectionPath);
          if (!section) {
            section = await client.createItem(substitute({ ...op.reconcile.addMissingSection.variables.input, name: field.section }, bindings));
          }
          await client.createItem(
            substitute(
              {
                ...op.reconcile.addMissingField.variables.input,
                name: field.name,
                parent: section.itemId,
                fields: [{ name: "Type", value: field.type }],
              },
              bindings
            )
          );
        }
        record(op.id, "updated", `added ${missing.length} field(s): ${missing.map((f) => f.name).join(", ")}`);
        break;
      }

      case "configureField": {
        const found = await client.itemByPath(op.fieldPath);
        if (!found) {
          if (mode === "check") {
            record(op.id, "update", "would set Type/Title/Source/help after field creation");
            break;
          }
          // Add-only: never abort the run for one unlocatable field — the likeliest cause
          // is the field existing under a different section than the manifest declares.
          followUps.push(`Field item not found at ${op.fieldPath} — it may exist under a different section on this template. Move or configure it manually; its Type/Title/Source/help were not written.`);
          record(op.id, "conflict", "field not at the manifest section path — see follow-ups");
          break;
        }
        if (mode === "check") {
          record(op.id, "update", `would set ${op.set.variables.input.fields.map((f) => f.name).join(", ")}${op.required ? " + Required rule" : ""}`);
          break;
        }
        const typeConflicted = bindings[`typeConflict:${op.fieldPath}`] === true;
        const setFields = typeConflicted
          ? op.set.variables.input.fields.filter((f) => f.name !== "Type")
          : op.set.variables.input.fields;
        await client.updateItem(found.itemId, substitute(setFields, bindings));
        if (op.required) {
          for (const barField of op.required.appendRuleTo) {
            const { value } = await client.fieldValue(op.fieldPath, barField);
            const merged = listMerge(value, bindings[op.required.ruleIdPlaceholder]);
            if (merged !== null) {
              await client.updateItem(found.itemId, [{ name: barField, value: merged }]);
            }
          }
        }
        record(op.id, "updated", `configured${typeConflicted ? " (Type left untouched — CMS type differs)" : ""}${op.required ? " (+Required rule)" : ""}`);
        break;
      }

      case "ensureStandardValues": {
        const template = await client.itemByPath(op.templatePath);
        if (!template) {
          record(op.id, mode === "check" ? "create" : "conflict", "template not present yet; standard values follow its creation");
          if (mode === "push") {
            followUps.push(`Standard values for ${op.templatePath} could not be ensured because the template was missing at this point in the run.`);
          }
          break;
        }
        let sv = await client.itemByPath(op.standardValuesPath);
        if (mode === "check") {
          record(op.id, sv ? "update" : "create", `insert options: ${op.insertOptions.paths.join(", ")}`);
          break;
        }
        if (!sv) {
          sv = await client.createItem(substitute(op.whenAbsent.variables.input, bindings));
        }
        const optionIds = [];
        for (const optionPath of op.insertOptions.paths) {
          const target = await client.itemByPath(optionPath);
          if (!target) {
            followUps.push(`Insert option ${optionPath} was not found — skipped (add it to __Masters manually once it exists).`);
            continue;
          }
          optionIds.push(target.itemId);
        }
        let value = (await client.fieldValue(op.standardValuesPath, op.insertOptions.field)).value;
        let appended = 0;
        for (const id of optionIds) {
          const merged = listMerge(value, id);
          if (merged !== null) {
            value = merged;
            appended += 1;
          }
        }
        if (appended > 0) {
          await client.updateItem(sv.itemId, [{ name: op.insertOptions.field, value }]);
        }
        record(op.id, appended > 0 ? "updated" : "no-op", `insert options appended: ${appended}`);
        break;
      }

      case "ensureRendering": {
        const jsonRenderingTemplate = await client.templateByPath(op.resolveTemplate.path);
        if (!jsonRenderingTemplate) {
          throw new ExecutorError("conflict", `Json Rendering template not found at ${op.resolveTemplate.path}.`, "This environment's headless rendering template lives elsewhere; adjust the plan's systemPaths and re-run.");
        }
        const templateFieldNames = new Set((jsonRenderingTemplate.ownFields ? jsonRenderingTemplate.ownFields.nodes : []).map((f) => f.name.toLowerCase()));
        const missingBindingFields = op.resolveTemplate.verifyFields.filter((f) => !templateFieldNames.has(f.toLowerCase()));
        if (missingBindingFields.length > 0) {
          throw new ExecutorError(
            "conflict",
            `Json Rendering template at ${op.resolveTemplate.path} is missing expected field(s): ${missingBindingFields.join(", ")}.`,
            "The rendering-binding field names differ in this environment. Verify them in the CMS and update the manifest/plan before pushing."
          );
        }
        bindings[op.resolveTemplate.into] = jsonRenderingTemplate.itemId;
        const found = await client.itemByPath(op.targetPath);
        if (found) {
          bindings[Object.keys(op.resolves)[0]] = found.itemId;
          record(op.id, "no-op", `rendering exists at ${op.targetPath}`);
          break;
        }
        if (mode === "check") {
          record(op.id, "create", `rendering at ${op.targetPath}`);
          break;
        }
        await resolveBinding(client, bindings, op.whenAbsent.resolveParent.path, op.whenAbsent.resolveParent.into, {
          remediation: `The rendering root ${op.whenAbsent.resolveParent.path} does not exist. Create it (or fix renderingRoot in the config), then re-run.`,
        });
        const created = await client.createItem(substitute(op.whenAbsent.variables.input, bindings));
        bindings[Object.keys(op.resolves)[0]] = created.itemId;
        record(op.id, "created", `rendering at ${op.targetPath}`);
        break;
      }

      case "setRenderingBindings": {
        if (mode === "check") {
          record(op.id, "update", `would set ${op.always.variables.input.fields.map((f) => f.name).join(", ")}`);
          break;
        }
        const input = substitute(op.always.variables.input, bindings);
        if (typeof input.itemId !== "string" || input.itemId.startsWith("__")) {
          throw new ExecutorError("conflict", "Rendering id was not resolved before setting bindings.", "Re-run; if it persists, the ensure-rendering op failed silently — check its output.");
        }
        await client.updateItem(input.itemId, input.fields);
        record(op.id, "updated", input.fields.map((f) => f.name).join(", "));
        break;
      }

      case "ensurePlaceholderSettings": {
        let found = await client.itemByPath(op.targetPath);
        if (mode === "check") {
          record(op.id, found ? (op.allowedControls ? "update" : "no-op") : "create", op.allowedControls ? "would append rendering to Allowed Controls" : "placeholder settings only");
          break;
        }
        if (!found) {
          await resolveBinding(client, bindings, op.resolveTemplate.path, op.resolveTemplate.into, {
            remediation: `The placeholder-settings template ${op.resolveTemplate.path} was not found; adjust systemPaths for this environment.`,
          });
          await resolveBinding(client, bindings, op.whenAbsent.resolveParent.path, op.whenAbsent.resolveParent.into, {
            remediation: `The placeholder-settings root ${op.whenAbsent.resolveParent.path} does not exist. Create it (or fix placeholderSettingsRoot in the config), then re-run.`,
          });
          found = await client.createItem(substitute(op.whenAbsent.variables.input, bindings));
        }
        if (op.allowedControls) {
          const renderingId = bindings[op.allowedControls.append];
          if (!renderingId) {
            followUps.push(`Placeholder ${op.targetPath}: rendering id unavailable, Allowed Controls not updated.`);
            record(op.id, "conflict", "rendering id unavailable");
            break;
          }
          const { value } = await client.fieldValue(op.targetPath, op.allowedControls.field);
          const merged = listMerge(value, renderingId);
          if (merged !== null) {
            await client.updateItem(found.itemId, [{ name: op.allowedControls.field, value: merged }]);
            record(op.id, "updated", "rendering appended to Allowed Controls");
          } else {
            record(op.id, "no-op", "rendering already allowed");
          }
        } else {
          record(op.id, "no-op", "placeholder settings ensured");
        }
        break;
      }

      default:
        throw new ExecutorError("api", `Unknown op kind "${op.kind}" in plan.`, "Regenerate the plan with the current tool version.");
    }
  }

  return { ok: true, mode, results, followUps };
}

module.exports = { runPlan, readEnv, listMerge, normalizeId, substitute, ExecutorError };
