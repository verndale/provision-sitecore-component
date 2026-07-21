"use strict";

/**
 * Manifest validation + path resolution. Pure — no I/O.
 *
 * validateManifest(manifest, config) → { ok, errors, resolved }
 * - errors: [{ message, cause, next }] — the CLI prints each as one
 *   "ERROR: … Cause: … Next: …" line and exits 2.
 * - resolved (on success): merged Sitecore paths (manifest.sitecorePaths over config)
 *   plus componentPropsImport, consumed by the plan builder and TSX emitter.
 *
 * Contract doc: skills/provision-sitecore-component/references/manifest-contract.md
 */

const { pascalToKebab, isPlainObject } = require("./util.cjs");

const ROLES = ["datasource", "base", "page"];
const PASCAL_RE = /^[A-Z][A-Za-z0-9]*$/;
const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;

function err(message, cause, next) {
  return { message, cause, next };
}

function isSitecorePath(value) {
  return typeof value === "string" && value.startsWith("/sitecore/");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** Merge manifest.sitecorePaths over the project config into one resolved paths object. */
function resolvePaths(manifest, config) {
  const cfg = isPlainObject(config) ? config : {};
  const overrides = isPlainObject(manifest.sitecorePaths) ? manifest.sitecorePaths : {};
  return {
    templateRoots: {
      ...(isPlainObject(cfg.templateRoots) ? cfg.templateRoots : {}),
      ...(isPlainObject(overrides.templateRoots) ? overrides.templateRoots : {}),
    },
    renderingRoot: overrides.renderingRoot || cfg.renderingRoot || null,
    placeholderSettingsRoot: overrides.placeholderSettingsRoot || cfg.placeholderSettingsRoot || null,
    datasourceLocation: overrides.datasourceLocation || cfg.datasourceLocation || null,
    componentPropsImport: cfg.componentPropsImport || "lib/component-props",
  };
}

function validateTemplate(t, index, errors) {
  const label = `templates[${index}]`;
  if (!isPlainObject(t)) {
    errors.push(err(`${label} is not an object.`, "Each entry in templates must be an object.", "Replace it with a template object per the manifest contract."));
    return;
  }
  if (!isNonEmptyString(t.name) || t.name !== t.name.trim() || t.name.includes("/")) {
    errors.push(err(`${label}.name is missing or invalid.`, "Template names must be non-empty, without leading/trailing whitespace or slashes.", "Set name to the Sitecore template item name (e.g. \"Related Content Card\")."));
  }
  const hasRole = ROLES.includes(t.role);
  const hasParentPath = isSitecorePath(t.parentPath);
  if (!hasRole && !hasParentPath) {
    errors.push(err(`${label} has neither a valid role nor a parentPath.`, `role must be one of ${ROLES.join(" | ")}, or parentPath must be an absolute /sitecore/ path.`, "Set role (picks the configured template root) or parentPath (explicit parent)."));
  }
  if (t.existing !== undefined && typeof t.existing !== "boolean") {
    errors.push(err(`${label}.existing must be a boolean.`, "existing marks a template that already exists in the CMS (fields get added to it).", "Set existing to true or false, or omit it."));
  }
  if (!Array.isArray(t.sections) || t.sections.length === 0) {
    errors.push(err(`${label}.sections is missing or empty.`, "A template entry must declare at least one section with fields.", "Add a sections array with { name, fields } entries."));
    return;
  }
  const seenFieldNames = new Set();
  t.sections.forEach((s, si) => {
    const sLabel = `${label}.sections[${si}]`;
    if (!isPlainObject(s) || !isNonEmptyString(s.name)) {
      errors.push(err(`${sLabel}.name is missing.`, "Every section needs a name (the field section shown to authors).", "Set the section name (e.g. \"Content\")."));
      return;
    }
    if (s.name !== s.name.trim() || s.name.includes("/")) {
      errors.push(err(`${sLabel}.name ("${s.name}") is invalid.`, "Section names become CMS item path segments; leading/trailing whitespace and slashes are rejected.", "Trim the section name and remove any slashes."));
      return;
    }
    if (!Array.isArray(s.fields) || s.fields.length === 0) {
      errors.push(err(`${sLabel}.fields is missing or empty.`, "Every section must declare at least one field.", "Add field objects: { name, title, sitecoreType, required?, source?, helpText? }."));
      return;
    }
    s.fields.forEach((f, fi) => {
      const fLabel = `${sLabel}.fields[${fi}]`;
      if (!isPlainObject(f)) {
        errors.push(err(`${fLabel} is not an object.`, "Each field must be an object.", "Replace it with a field object per the manifest contract."));
        return;
      }
      if (!isNonEmptyString(f.name) || !FIELD_NAME_RE.test(f.name)) {
        errors.push(err(`${fLabel}.name ("${f.name ?? ""}") is invalid.`, "Field names become CMS item names and SDK fields keys; they must match ^[A-Za-z][A-Za-z0-9]*$ (no spaces).", "Use the code-facing field name (e.g. \"pageReference\"); put the author-facing label in title."));
      } else {
        const key = f.name.toLowerCase();
        if (seenFieldNames.has(key)) {
          errors.push(err(`${fLabel}.name ("${f.name}") duplicates another field on this template.`, "Sitecore field names must be unique per template (case-insensitive).", "Rename one of the duplicated fields."));
        }
        seenFieldNames.add(key);
      }
      if (!isNonEmptyString(f.title)) {
        errors.push(err(`${fLabel}.title is missing.`, "title is the author-facing label written to the field item's Title.", "Set title to the display name from the spec (e.g. \"Page Reference\")."));
      }
      if (!isNonEmptyString(f.sitecoreType)) {
        errors.push(err(`${fLabel}.sitecoreType is missing.`, "sitecoreType is written to the CMS verbatim (e.g. \"Single-Line Text\", \"Droptree\").", "Set sitecoreType from the spec's field table."));
      }
      if (f.required !== undefined && typeof f.required !== "boolean") {
        errors.push(err(`${fLabel}.required must be a boolean.`, "required controls the standard Required field rule in the CMS.", "Set required to true or false, or omit it."));
      }
      if (f.source !== undefined && !isNonEmptyString(f.source)) {
        errors.push(err(`${fLabel}.source must be a non-empty string when present.`, "source is the field's Source (selection restriction), written verbatim.", "Set the concrete Source string, or omit it."));
      }
      if (f.helpText !== undefined && !isNonEmptyString(f.helpText)) {
        errors.push(err(`${fLabel}.helpText must be a non-empty string when present.`, "helpText is written to the field item's short help description.", "Set the help text, or omit it."));
      }
    });
  });
  if (t.insertOptions !== undefined) {
    if (!Array.isArray(t.insertOptions)) {
      errors.push(err(`${label}.insertOptions must be an array.`, "insertOptions lists templates authors can insert under this template's items (standard values __Masters).", "Use an array of manifest template names or absolute /sitecore/ paths."));
    } else {
      t.insertOptions.forEach((o, oi) => {
        if (!isNonEmptyString(o)) {
          errors.push(err(`${label}.insertOptions[${oi}] must be a non-empty string.`, "Each insert option is a manifest template name or an absolute /sitecore/ path.", "Fix or remove the entry."));
        }
      });
    }
  }
}

function validateManifest(manifest, config) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    return {
      ok: false,
      errors: [err("Manifest is not a JSON object.", "The manifest file must parse to a single object.", "Check the manifest file for syntax errors.")],
      resolved: null,
    };
  }
  if (manifest.version !== 1) {
    errors.push(err(`Unsupported manifest version (${JSON.stringify(manifest.version)}).`, "This tool implements manifest schema version 1.", "Set \"version\": 1."));
  }
  if (!isNonEmptyString(manifest.component) || !PASCAL_RE.test(manifest.component)) {
    errors.push(err(`component ("${manifest.component ?? ""}") is invalid.`, "component is the PascalCase React component name (also the rendering componentName default).", "Set component to a PascalCase name (e.g. \"RelatedContentCard\")."));
  } else {
    const expected = pascalToKebab(manifest.component);
    if (manifest.slug !== expected) {
      errors.push(err(`slug ("${manifest.slug ?? ""}") does not match component.`, `slug must be the kebab-case of component ("${expected}") — it names the plan file and the data-component hook.`, `Set "slug": "${expected}".`));
    }
  }
  if (!isNonEmptyString(manifest.output) || manifest.output.startsWith("/") || manifest.output.includes("\\") || manifest.output.split("/").includes("..")) {
    errors.push(err(`output ("${manifest.output ?? ""}") is invalid.`, "output is the repo-relative directory for the TSX pair; absolute paths and .. segments are rejected.", "Use a repo-relative path like \"src/components/related-content/related-content-card\"."));
  }
  if (!Array.isArray(manifest.templates) || manifest.templates.length === 0) {
    errors.push(err("templates is missing or empty.", "At least one template entry is required (the fields the component owns).", "Add a templates array per the manifest contract."));
  } else {
    manifest.templates.forEach((t, i) => validateTemplate(t, i, errors));
    const names = manifest.templates.filter((t) => isPlainObject(t) && isNonEmptyString(t.name)).map((t) => t.name.toLowerCase());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) {
      errors.push(err(`Duplicate template name(s): ${[...new Set(dupes)].join(", ")}.`, "Template names must be unique within a manifest.", "Rename the duplicated template entries."));
    }
  }

  const rendering = manifest.rendering;
  if (rendering !== undefined && rendering !== null) {
    if (!isPlainObject(rendering)) {
      errors.push(err("rendering must be an object or null.", "rendering describes the JSON rendering item; null means a page-driven component with no rendering item.", "Fix the rendering entry or set it to null."));
    } else {
      if (!isNonEmptyString(rendering.name)) {
        errors.push(err("rendering.name is missing.", "The rendering item needs a Sitecore item name.", "Set rendering.name (e.g. \"Related Content Card\")."));
      }
      if (rendering.componentName !== undefined && !isNonEmptyString(rendering.componentName)) {
        errors.push(err("rendering.componentName must be a non-empty string when present.", "componentName must match the React component registered in the app's component map.", "Set componentName, or omit it to default to the manifest component."));
      }
      if (rendering.datasourceTemplate !== undefined) {
        const names = Array.isArray(manifest.templates)
          ? manifest.templates.filter((t) => isPlainObject(t) && isNonEmptyString(t.name)).map((t) => t.name)
          : [];
        const known = names.includes(rendering.datasourceTemplate) || isSitecorePath(rendering.datasourceTemplate);
        if (!known) {
          errors.push(err(`rendering.datasourceTemplate ("${rendering.datasourceTemplate}") is unknown.`, "It must name a template in this manifest or be an absolute /sitecore/ template path.", `Use one of: ${names.join(", ") || "(no manifest templates)"} — or an absolute path.`));
        }
      }
      if (rendering.datasourceLocation !== undefined && !isNonEmptyString(rendering.datasourceLocation)) {
        errors.push(err("rendering.datasourceLocation must be a non-empty string when present.", "It is written verbatim to the rendering's Datasource Location.", "Set the location (path or query:…), or omit it to use the configured default."));
      }
    }
  }

  if (manifest.placeholders !== undefined) {
    if (!Array.isArray(manifest.placeholders)) {
      errors.push(err("placeholders must be an array.", "placeholders lists placeholder settings items to create/update (Allowed Controls, add-only).", "Use an array of { name, allowedControlsAdd? } entries."));
    } else {
      manifest.placeholders.forEach((p, pi) => {
        if (!isPlainObject(p) || !isNonEmptyString(p.name)) {
          errors.push(err(`placeholders[${pi}].name is missing.`, "Each placeholder entry needs the placeholder settings item name (the placeholder key).", "Set the name, or remove the entry."));
        } else if (p.allowedControlsAdd !== undefined && typeof p.allowedControlsAdd !== "boolean") {
          errors.push(err(`placeholders[${pi}].allowedControlsAdd must be a boolean.`, "allowedControlsAdd controls whether this rendering is appended to the placeholder's Allowed Controls.", "Set true/false or omit it (defaults to true)."));
        }
      });
    }
  }

  const resolved = resolvePaths(manifest, config);

  if (Array.isArray(manifest.templates)) {
    const usedRoles = new Set(
      manifest.templates.filter((t) => isPlainObject(t) && !isSitecorePath(t.parentPath) && ROLES.includes(t.role)).map((t) => t.role)
    );
    for (const role of usedRoles) {
      if (!isSitecorePath(resolved.templateRoots[role])) {
        errors.push(err(`No template root configured for role "${role}".`, `templates use role "${role}" but neither the config nor manifest.sitecorePaths provides templateRoots.${role}.`, `Add templateRoots.${role} (an absolute /sitecore/templates/… path) to the provisioning config or manifest.sitecorePaths.`));
      }
    }
  }
  if (isPlainObject(rendering) && !isSitecorePath(resolved.renderingRoot)) {
    errors.push(err("No renderingRoot configured.", "The manifest declares a rendering but no renderingRoot is available from config or manifest.sitecorePaths.", "Add renderingRoot (an absolute /sitecore/layout/Renderings/… path)."));
  }
  if (Array.isArray(manifest.placeholders) && manifest.placeholders.length > 0 && !isSitecorePath(resolved.placeholderSettingsRoot)) {
    errors.push(err("No placeholderSettingsRoot configured.", "The manifest declares placeholders but no placeholderSettingsRoot is available from config or manifest.sitecorePaths.", "Add placeholderSettingsRoot (an absolute /sitecore/layout/Placeholder Settings/… path)."));
  }

  return { ok: errors.length === 0, errors, resolved: errors.length === 0 ? resolved : null };
}

module.exports = { validateManifest, resolvePaths, ROLES, FIELD_NAME_RE };
