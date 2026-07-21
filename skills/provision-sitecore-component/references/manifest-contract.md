# Component manifest contract

Schema and semantics for the component manifest — the single reviewed artifact that drives both the CMS provisioning plan and the TSX scaffold. Authoritative validation lives in `src/validate-manifest.cjs`; this document mirrors it for authoring.

## Contents

- Config resolution
- Full example
- Top-level fields
- templates[]
- Fields
- rendering
- placeholders[]
- sitecorePaths
- Validation failures

## Config resolution

The CLI resolves the provisioning config in this order; the first hit wins:

1. `--config <path>` — explicit JSON file.
2. `./provision.config.json` — standalone config at the working-directory root.
3. `./build.config.json` — pipeline repos: requires `stackAdapter: "sitecore-ai"` (any other adapter is a hard error) and reads the `sitecoreProvisioning` key.
4. No file — every path must then come from `manifest.sitecorePaths`.

Config shape (all keys optional at the file level; completeness is checked against what the manifest uses):

```json
{
  "templateRoots": {
    "datasource": "/sitecore/templates/Project/<tenant>/<site>/Components",
    "base": "/sitecore/templates/Project/<tenant>/<site>/Pages/Base",
    "page": "/sitecore/templates/Project/<tenant>/<site>/Pages"
  },
  "renderingRoot": "/sitecore/layout/Renderings/Project/<tenant>/<site>",
  "placeholderSettingsRoot": "/sitecore/layout/Placeholder Settings/Project/<tenant>/<site>",
  "datasourceLocation": "query:$site/*[@@name='Data']",
  "componentPropsImport": "lib/component-props"
}
```

## Full example

```json
{
  "version": 1,
  "component": "RelatedContentCard",
  "slug": "related-content-card",
  "output": "src/components/related-content/related-content-card",
  "confluence": { "url": "https://…/CN+-+Related+Content+Card", "pageId": "6766788927" },
  "templates": [
    {
      "role": "datasource",
      "name": "Related Content Card",
      "sections": [
        {
          "name": "Content",
          "fields": [
            {
              "name": "pageReference",
              "title": "Page Reference",
              "sitecoreType": "Droptree",
              "required": true,
              "source": "query:$site/*[@@name='Home']//*[@@templatename='Article Page']",
              "helpText": "Selects the page used as the source for the card content."
            },
            { "name": "cardTitleOverride", "title": "Card Title Override", "sitecoreType": "Single-Line Text" }
          ]
        }
      ],
      "insertOptions": []
    },
    {
      "role": "base",
      "name": "_RelatedContentPageData",
      "sections": [
        {
          "name": "Related Content",
          "fields": [
            { "name": "PageTitle", "title": "Page Title", "sitecoreType": "Single-Line Text", "required": true },
            { "name": "PageSummary", "title": "Page Summary", "sitecoreType": "Multi-Line Text" },
            { "name": "ThumbnailImage", "title": "Thumbnail Image", "sitecoreType": "Image" }
          ]
        }
      ]
    }
  ],
  "rendering": {
    "name": "Related Content Card",
    "componentName": "RelatedContentCard",
    "datasourceTemplate": "Related Content Card",
    "datasourceLocation": "query:$site/*[@@name='Data']"
  },
  "placeholders": [{ "name": "related-content-row" }]
}
```

## Top-level fields

- `version` — literal `1`.
- `component` — PascalCase React component name (`^[A-Z][A-Za-z0-9]*$`). Default rendering `componentName`.
- `slug` — kebab-case of `component`, exactly (names the plan file and the `data-component` hook).
- `output` — repo-relative directory for the TSX pair. Absolute paths and `..` segments are rejected.
- `confluence` — optional provenance (`url`, `pageId`); ignored by the planner.

## templates[]

At least one entry. Each entry:

- `role` — `datasource` | `base` | `page`; picks the parent from the config `templateRoots`. `parentPath` (absolute `/sitecore/` path) overrides the role root when a template lives elsewhere.
- `name` — the Sitecore template item name. Unique within the manifest.
- `existing` — `true` when the template already exists (the Masthead case: adding a field section to a page template). The push preflight must find it or the run aborts; sections/fields are then reconciled add-only.
- `sections[]` — `{ name, fields[] }`, at least one section, each with at least one field.
- `insertOptions` — optional list of manifest template names or absolute template paths; appended (add-only) to the template's standard-values `__Masters`.

## Fields

- `name` — the CMS field item name and the SDK `fields` key. `^[A-Za-z][A-Za-z0-9]*$` — no spaces; unique per template (case-insensitive). Follow the project's convention (existing handoffs use camelCase; shared page-base templates may use PascalCase) — confirm at review, never mix within a template.
- `title` — the author-facing label, written to the field item's `Title`.
- `sitecoreType` — written to the CMS verbatim (`Single-Line Text`, `Rich Text`, `Image`, `General Link`, `Droptree`, …). Unknown values are allowed — they provision verbatim and surface as TODOs in the scaffold.
- `required` — optional boolean; attaches the standard Required field rule to the field's validation bars (add-only).
- `source` — optional; the field's `Source` (selection restriction for list/tree/link/image fields), written verbatim. The concrete string is a review decision — see `confluence-import.md`.
- `helpText` — optional; written to the field item's short help description.

## rendering

`null` (or omitted) for components with no rendering item. Otherwise:

- `name` — the rendering item name (created under the config `renderingRoot` from the Json Rendering template).
- `componentName` — optional; defaults to `component`. Must match the React component the app's component map registers.
- `datasourceTemplate` — optional; a manifest template name or absolute template path. Omit for renderings that read the page item instead of a datasource.
- `datasourceLocation` — optional; falls back to the config `datasourceLocation` when a datasource template is set. Opaque authored string (path or `query:…`).

## placeholders[]

Optional. Each `{ name, allowedControlsAdd? }` ensures a placeholder-settings item named `name` under the config `placeholderSettingsRoot` and (default `true`, when a rendering exists) appends the rendering to its `Allowed Controls` — add-only, never removing existing controls.

## sitecorePaths

Optional per-manifest override object merged over the config: `templateRoots`, `renderingRoot`, `placeholderSettingsRoot`, `datasourceLocation`. Use for one-off components that live outside the project roots.

## Validation failures

Every violation prints one line to stderr and the CLI exits 2:

```text
ERROR: <what is wrong> Cause: <why it is a rule> Next: <the fix>
```

The repair loop in `SKILL.md` edits the manifest only — never the validator, the config, or generated files.
