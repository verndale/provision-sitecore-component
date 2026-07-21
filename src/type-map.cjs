"use strict";

/**
 * Single source of truth for the Sitecore field type → TypeScript type → SDK renderer
 * mapping used by the plan builder and the TSX emitter.
 *
 * Documented mirror: skills/provision-sitecore-component/references/type-mapping.md
 * (this module is authoritative; the reference doc explains usage and the BA-spec
 * vocabulary mapping applied when drafting a manifest from Confluence).
 *
 * Renderer values:
 * - "text" | "richtext" | "image" | "link": emitted as the matching Content SDK renderer.
 * - "todo": no SDK renderer emitted; the field appears in the scaffold as a TODO comment
 *   because its markup is design-driven (Checkbox, Number, Date) or its SDK type must be
 *   verified against the consuming app's package surface (reference fields).
 */

const TYPE_MAP = {
  "single-line text": { tsType: "Field<string>", typeImports: ["Field"], renderer: "text" },
  "multi-line text": { tsType: "Field<string>", typeImports: ["Field"], renderer: "text" },
  "rich text": { tsType: "RichTextField", typeImports: ["RichTextField"], renderer: "richtext" },
  image: { tsType: "ImageField", typeImports: ["ImageField"], renderer: "image" },
  "general link": { tsType: "LinkField", typeImports: ["LinkField"], renderer: "link" },
  date: {
    tsType: "Field<string>",
    typeImports: ["Field"],
    renderer: "todo",
    todoNote: "Date field — render/format is design-driven; no default SDK renderer is assumed.",
  },
  datetime: {
    tsType: "Field<string>",
    typeImports: ["Field"],
    renderer: "todo",
    todoNote: "Datetime field — render/format is design-driven; no default SDK renderer is assumed.",
  },
  checkbox: {
    tsType: "Field<boolean>",
    typeImports: ["Field"],
    renderer: "todo",
    todoNote: "Checkbox field — markup is design-driven; read the raw value.",
  },
  number: {
    tsType: "Field<number>",
    typeImports: ["Field"],
    renderer: "todo",
    todoNote: "Number field — markup is design-driven; read the raw value.",
  },
  integer: {
    tsType: "Field<number>",
    typeImports: ["Field"],
    renderer: "todo",
    todoNote: "Integer field — markup is design-driven; read the raw value.",
  },
  droptree: {
    tsType: "unknown",
    typeImports: [],
    renderer: "todo",
    todoNote:
      "Droptree reference — type as the referenced item shape used by this app's Content SDK version (verify the SDK surface), then render from the referenced item's fields.",
  },
  droplink: {
    tsType: "unknown",
    typeImports: [],
    renderer: "todo",
    todoNote:
      "Droplink reference — type as the referenced item shape used by this app's Content SDK version (verify the SDK surface), then render from the referenced item's fields.",
  },
  multilist: {
    tsType: "unknown[]",
    typeImports: [],
    renderer: "todo",
    todoNote:
      "Multilist reference — type as an array of the referenced item shape used by this app's Content SDK version (verify the SDK surface).",
  },
  treelist: {
    tsType: "unknown[]",
    typeImports: [],
    renderer: "todo",
    todoNote:
      "Treelist reference — type as an array of the referenced item shape used by this app's Content SDK version (verify the SDK surface).",
  },
};

/**
 * Resolve a Sitecore field type to its mapping row. Never throws: unknown types fall
 * back to a generic Field<unknown> entry whose TODO note names the unmapped type, so
 * new/custom field types flow through the planner verbatim and surface in the scaffold.
 */
function resolveType(sitecoreType) {
  const key = String(sitecoreType || "").trim().toLowerCase();
  const row = TYPE_MAP[key];
  if (row) {
    return { sitecoreType: String(sitecoreType).trim(), ...row };
  }
  return {
    sitecoreType: String(sitecoreType || "").trim(),
    tsType: "Field<unknown>",
    typeImports: ["Field"],
    renderer: "todo",
    todoNote: `Unmapped Sitecore field type "${String(sitecoreType || "").trim()}" — type and render per the app's conventions.`,
  };
}

module.exports = { TYPE_MAP, resolveType };
