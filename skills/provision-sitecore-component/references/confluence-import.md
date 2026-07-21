# Confluence spec import

How to turn a functional spec page into a draft manifest: retrieval, the two field-table shapes specs use, what to extract from each, and what always becomes a review question.

## Use when

- Drafting a component manifest from a Confluence functional spec URL.
- Skip when: the developer supplies `ManifestPath` — validate and use it as-is.

## Retrieval

1. Derive the `cloudId` from the URL hostname (e.g. `verndale.atlassian.net`) and the `pageId` from the URL path.
2. Call the Atlassian MCP `getConfluencePage` with `contentFormat: "html"` (or `"markdown"` when tables render cleanly) and read the page body.
3. Hard stop on failure: an unreachable MCP, a permission error, an empty body, or a page that lacks any field table. Report exactly what failed and end the run — a manifest MUST NOT be drafted from memory, chat paraphrase, or a cached copy.

## Spec shapes

Specs carry the field inventory in one of two shapes (both occur in real CN specs):

**Shape A — a single "Editable Fields" table** (e.g. People Detail Masthead). Columns typically `Field Name | Field Type | Required | Recommended Characters | Notes`. The surrounding prose states where the fields live — a component datasource, or a named field section on an existing page template ("All fields live on the People Detail page item under the Masthead field section. There is no component datasource."). That sentence decides the manifest shape: no datasource → one `templates[]` entry with `role: "page"`, `existing: true`, the section named by the spec, and a `rendering` without `datasourceTemplate`.

**Shape B — a "Template Fields" section with one table per template** (e.g. Related Content Card: the `Related Content Card` datasource template plus a shared `_RelatedContentPageData` page-base template). Each table becomes its own `templates[]` entry — datasource templates as `role: "datasource"`, shared page-data bases as `role: "base"`. An "Item" table nearby names the rendering, its datasource pattern, and the parent component — use it for `rendering` and for insert-option/placeholder decisions.

Ignore "Content Structure" sections (content-tree diagrams) — they describe authored content, not provisioning input. "Recommended Characters" columns are authoring guidance, not CMS configuration — do not map them.

## Extraction rules

- One manifest field per table row: the spec's display label becomes `title`; `name` is derived per the project's field-naming convention (existing handoffs use camelCase; shared bases may use PascalCase like `PageTitle`) — the chosen convention is a review question the first time, then applied consistently.
- `Required` column `Yes` → `required: true`; `No` or blank → omit.
- Field types map per `type-mapping.md`; unmappable rows become review questions.
- Notes columns often carry help text (→ `helpText`) and restriction intent (→ the `source` review question).
- Prose stating "mandatory on every instance", "cannot publish without it" → confirms `required: true`.
- The spec's component name in PascalCase becomes `component`; the rendering name usually matches the spec title.

## Always review questions, never guesses

- Concrete `source` strings for any restricted list/tree/link field.
- The field-naming convention for `name` (camelCase vs PascalCase) when the project has no established one.
- `datasourceLocation` when it differs from the config default (e.g. child-item card patterns).
- Which picker (Droptree vs Droplink; Multilist vs Treelist) when the spec names only "reference".
- Insert options implied by parent/child authoring patterns ("one child item per card") — they belong to the parent component's template and may be out of this manifest's scope.
- Placeholder settings: whether this component is added to a placeholder (and which key) or is fixed in a page layout.
