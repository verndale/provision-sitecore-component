"use strict";

/**
 * Mutation-plan builder. Pure — no I/O, no network.
 *
 * buildMutationPlan(manifest, resolved, manifestBasename) → plan object
 * serializePlan(plan) → byte-deterministic JSON string (2-space indent, trailing
 * newline, fixed construction order, no timestamps)
 *
 * The plan is the human-reviewable artifact: it embeds the GraphQL documents verbatim
 * (plan.graphql) and per-op variables. `__NAME__` placeholders are bound by the
 * executor from preflight results — the plan itself never contains hardcoded GUIDs;
 * every well-known Sitecore item is resolved by path at run time.
 *
 * Op order is fixed: templates → template fields → field configuration → standard
 * values/insert options → rendering → rendering bindings → placeholder settings.
 * Reconcile semantics are add-only: the executor never deletes, renames, or retypes;
 * anything it declines to touch is reported in manualFollowUps.
 */

const { joinItemPath, isPlainObject } = require("./util.cjs");

/** Well-known system items, always resolved by path at run time (never by GUID). */
const SYSTEM_PATHS = {
  jsonRenderingTemplate: "/sitecore/templates/Foundation/JavaScript Services/Json Rendering",
  templateSectionTemplate: "/sitecore/templates/System/Templates/Template section",
  templateFieldTemplate: "/sitecore/templates/System/Templates/Template field",
  requiredFieldRule: "/sitecore/system/Settings/Validation Rules/Field Rules/System/Required",
  placeholderSettingsTemplate: "/sitecore/templates/System/Layout/Placeholder",
};

/** Template-field item fields that carry required-field validation (add-only merge). */
const VALIDATION_BAR_FIELDS = ["Validate Button", "Workflow"];

const GRAPHQL = {
  ITEM_BY_PATH:
    'query GetItem($path: String!) { item(where: { database: "master", path: $path }) { itemId name path templateId } }',
  TEMPLATE_BY_PATH:
    'query GetTemplate($path: String!) { item(where: { database: "master", path: $path }) { itemId name ownFields { nodes { name type } } } }',
  FIELD_VALUE:
    'query GetFieldValue($path: String!, $field: String!) { item(where: { database: "master", path: $path }) { itemId field(name: $field) { value } } }',
  CREATE_ITEM_TEMPLATE:
    "mutation CreateTemplate($input: CreateItemTemplateInput!) { createItemTemplate(input: $input) { itemTemplate { templateId name } } }",
  CREATE_ITEM:
    "mutation CreateItem($input: CreateItemInput!) { createItem(input: $input) { item { itemId name path } } }",
  UPDATE_ITEM:
    "mutation UpdateItem($input: UpdateItemInput!) { updateItem(input: $input) { item { itemId path } } }",
};

function templateParentPath(template, resolved) {
  if (typeof template.parentPath === "string" && template.parentPath.startsWith("/sitecore/")) {
    return template.parentPath;
  }
  return resolved.templateRoots[template.role];
}

function templatePath(template, resolved) {
  return joinItemPath(templateParentPath(template, resolved), template.name);
}

function datasourceTemplatePath(manifest, resolved) {
  const rendering = manifest.rendering;
  if (!isPlainObject(rendering) || rendering.datasourceTemplate === undefined) return null;
  const ref = rendering.datasourceTemplate;
  if (ref.startsWith("/sitecore/")) return ref;
  const target = manifest.templates.find((t) => t.name === ref);
  return target ? templatePath(target, resolved) : null;
}

function insertOptionPath(option, manifest, resolved) {
  if (option.startsWith("/sitecore/")) return option;
  const target = manifest.templates.find((t) => t.name === option);
  return target ? templatePath(target, resolved) : option;
}

/** Flatten a template's sections into [{ section, field }] pairs in manifest order. */
function flattenFields(template) {
  const out = [];
  for (const section of template.sections) {
    for (const field of section.fields) {
      out.push({ section: section.name, field });
    }
  }
  return out;
}

function buildMutationPlan(manifest, resolved, manifestBasename) {
  const ops = [];
  const manualFollowUps = [
    "Register the rendering in the site's Available Renderings / Pages toolbox (not automated in v1).",
    "Create and assign a rendering parameters template if this component needs one (not automated in v1).",
  ];

  ops.push({
    id: "resolve-system-items",
    kind: "resolveSystemItems",
    query: "ITEM_BY_PATH",
    resolves: {
      __TEMPLATE_SECTION_TEMPLATE_ID__: SYSTEM_PATHS.templateSectionTemplate,
      __TEMPLATE_FIELD_TEMPLATE_ID__: SYSTEM_PATHS.templateFieldTemplate,
      __REQUIRED_RULE_ID__: SYSTEM_PATHS.requiredFieldRule,
    },
    note: "Well-known system items resolved by path; the executor binds each placeholder to the resolved itemId. The Required rule is only fetched when some field is required.",
  });

  manifest.templates.forEach((template, index) => {
    const path = templatePath(template, resolved);
    const idPlaceholder = `__TEMPLATE_${index}_ID__`;
    const existing = template.existing === true;

    ops.push({
      id: `ensure-template-${index}`,
      kind: "ensureTemplate",
      templateName: template.name,
      targetPath: path,
      existing,
      preflight: { query: "TEMPLATE_BY_PATH", variables: { path } },
      whenAbsent: existing
        ? { error: `Template marked existing was not found at ${path}. Fix the manifest (existing/parent root) or create the template first.` }
        : {
            mutation: "CREATE_ITEM_TEMPLATE",
            variables: {
              input: {
                name: template.name,
                parent: `__TEMPLATE_${index}_PARENT_ID__`,
                sections: template.sections.map((s) => ({
                  name: s.name,
                  fields: s.fields.map((f) => ({ name: f.name, type: f.sitecoreType })),
                })),
              },
            },
            resolveParent: { query: "ITEM_BY_PATH", path: templateParentPath(template, resolved), into: `__TEMPLATE_${index}_PARENT_ID__` },
          },
      resolves: { [idPlaceholder]: "itemId" },
    });

    ops.push({
      id: `ensure-template-fields-${index}`,
      kind: "ensureTemplateFields",
      templatePath: path,
      sections: template.sections.map((s) => ({
        name: s.name,
        path: joinItemPath(path, s.name),
        fields: s.fields.map((f) => ({ name: f.name, type: f.sitecoreType })),
      })),
      reconcile: {
        addMissingSection: {
          mutation: "CREATE_ITEM",
          variables: {
            input: { name: "__SECTION_NAME__", templateId: "__TEMPLATE_SECTION_TEMPLATE_ID__", parent: idPlaceholder, language: "en" },
          },
        },
        addMissingField: {
          mutation: "CREATE_ITEM",
          variables: {
            input: {
              name: "__FIELD_NAME__",
              templateId: "__TEMPLATE_FIELD_TEMPLATE_ID__",
              parent: "__SECTION_ID__",
              language: "en",
              fields: [{ name: "Type", value: "__FIELD_TYPE__" }],
            },
          },
        },
        onExtraCmsField: "report — never deleted",
        onTypeMismatch: "conflict — reported, never retyped",
      },
    });

    flattenFields(template).forEach(({ section, field }) => {
      const fieldPath = joinItemPath(joinItemPath(path, section), field.name);
      const values = [{ name: "Type", value: field.sitecoreType }, { name: "Title", value: field.title }];
      if (field.source) values.push({ name: "Source", value: field.source });
      if (field.helpText) values.push({ name: "__Short description", value: field.helpText });
      ops.push({
        id: `configure-field-${index}-${section}-${field.name}`,
        kind: "configureField",
        fieldPath,
        set: { mutation: "UPDATE_ITEM", variables: { input: { itemId: "__FIELD_ITEM_ID__", language: "en", fields: values } } },
        required: field.required === true
          ? {
              appendRuleTo: VALIDATION_BAR_FIELDS,
              ruleIdPlaceholder: "__REQUIRED_RULE_ID__",
              note: "Read-modify-write: the Required rule id is appended to each validation-bar field only when missing (add-only; existing rules are preserved).",
            }
          : null,
      });
    });

  });

  // Standard values run as a second pass, after every template op: insert options may
  // reference templates declared later in the manifest, which must exist before the
  // executor resolves them by path.
  manifest.templates.forEach((template, index) => {
    if (!Array.isArray(template.insertOptions) || template.insertOptions.length === 0) return;
    const path = templatePath(template, resolved);
    ops.push({
      id: `ensure-standard-values-${index}`,
      kind: "ensureStandardValues",
      templatePath: path,
      standardValuesPath: joinItemPath(path, "__Standard Values"),
      whenAbsent: {
        mutation: "CREATE_ITEM",
        variables: { input: { name: "__Standard Values", templateId: `__TEMPLATE_${index}_ID__`, parent: `__TEMPLATE_${index}_ID__`, language: "en" } },
      },
      insertOptions: {
        field: "__Masters",
        paths: template.insertOptions.map((o) => insertOptionPath(o, manifest, resolved)),
        note: "Read-modify-write: each insert-option template id is appended to __Masters only when missing (add-only).",
      },
    });
  });

  if (isPlainObject(manifest.rendering)) {
    const rendering = manifest.rendering;
    const renderingPath = joinItemPath(resolved.renderingRoot, rendering.name);
    const componentName = rendering.componentName || manifest.component;
    const dsTemplatePath = datasourceTemplatePath(manifest, resolved);
    const dsLocation = rendering.datasourceLocation || (dsTemplatePath ? resolved.datasourceLocation : null);

    ops.push({
      id: "ensure-rendering",
      kind: "ensureRendering",
      targetPath: renderingPath,
      preflight: { query: "ITEM_BY_PATH", variables: { path: renderingPath } },
      resolveTemplate: {
        query: "TEMPLATE_BY_PATH",
        path: SYSTEM_PATHS.jsonRenderingTemplate,
        into: "__JSON_RENDERING_TEMPLATE_ID__",
        verifyFields: ["componentName", "Datasource Template", "Datasource Location"],
        note: "Introspection preflight: the Json Rendering template is resolved by path and its field surface verified before any mutation; a mismatch aborts with remediation instead of guessing.",
      },
      whenAbsent: {
        mutation: "CREATE_ITEM",
        variables: {
          input: { name: rendering.name, templateId: "__JSON_RENDERING_TEMPLATE_ID__", parent: "__RENDERING_ROOT_ID__", language: "en" },
        },
        resolveParent: { query: "ITEM_BY_PATH", path: resolved.renderingRoot, into: "__RENDERING_ROOT_ID__" },
      },
      resolves: { __RENDERING_ID__: "itemId" },
    });

    const bindingFields = [{ name: "componentName", value: componentName }];
    if (dsTemplatePath) bindingFields.push({ name: "Datasource Template", value: dsTemplatePath });
    if (dsLocation) bindingFields.push({ name: "Datasource Location", value: dsLocation });
    ops.push({
      id: "set-rendering-bindings",
      kind: "setRenderingBindings",
      always: {
        mutation: "UPDATE_ITEM",
        variables: { input: { itemId: "__RENDERING_ID__", language: "en", fields: bindingFields } },
      },
      note: "Idempotent set — bindings are written on every push.",
    });
  }

  if (Array.isArray(manifest.placeholders)) {
    manifest.placeholders.forEach((placeholder, index) => {
      const placeholderPath = joinItemPath(resolved.placeholderSettingsRoot, placeholder.name);
      ops.push({
        id: `ensure-placeholder-settings-${index}`,
        kind: "ensurePlaceholderSettings",
        targetPath: placeholderPath,
        preflight: { query: "ITEM_BY_PATH", variables: { path: placeholderPath } },
        resolveTemplate: { query: "ITEM_BY_PATH", path: SYSTEM_PATHS.placeholderSettingsTemplate, into: "__PLACEHOLDER_SETTINGS_TEMPLATE_ID__" },
        whenAbsent: {
          mutation: "CREATE_ITEM",
          variables: {
            input: {
              name: placeholder.name,
              templateId: "__PLACEHOLDER_SETTINGS_TEMPLATE_ID__",
              parent: "__PLACEHOLDER_ROOT_ID__",
              language: "en",
              fields: [{ name: "Placeholder Key", value: placeholder.name }],
            },
          },
          resolveParent: { query: "ITEM_BY_PATH", path: resolved.placeholderSettingsRoot, into: "__PLACEHOLDER_ROOT_ID__" },
        },
        allowedControls: placeholder.allowedControlsAdd === false || !isPlainObject(manifest.rendering)
          ? null
          : {
              field: "Allowed Controls",
              append: "__RENDERING_ID__",
              note: "Read-modify-write: the rendering id is appended to Allowed Controls only when missing (add-only; existing controls are preserved).",
            },
      });
    });
  }

  return {
    version: 1,
    component: manifest.component,
    slug: manifest.slug,
    generatedFrom: manifestBasename,
    resolvedPaths: {
      templateRoots: resolved.templateRoots,
      renderingRoot: resolved.renderingRoot,
      placeholderSettingsRoot: resolved.placeholderSettingsRoot,
      datasourceLocation: resolved.datasourceLocation,
    },
    systemPaths: SYSTEM_PATHS,
    graphql: GRAPHQL,
    ops,
    manualFollowUps,
  };
}

function serializePlan(plan) {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

module.exports = { buildMutationPlan, serializePlan, SYSTEM_PATHS, GRAPHQL, VALIDATION_BAR_FIELDS, templatePath, flattenFields };
