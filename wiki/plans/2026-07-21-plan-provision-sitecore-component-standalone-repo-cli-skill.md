---
status: implemented
executed: 2026-07-21
date: 2026-07-21
evidence: []
source_tool: claude
source: "/Users/joe.fusco/.claude/plans/giid-start-the-mossy-hollerith.md"
topics: [sitecore-provisioning]
audit_note: "Executed as approved, plus post-review fixes (standard-values op ordering, cross-section field conflict handling) and same-day follow-ups delivered after execution: wiki system, global setup.sh installer, examples/ removed in favor of test fixtures."
---
# Plan: `provision-sitecore-component` — standalone repo (CLI + skill)

**Location:** the project lives at `/Users/joe.fusco/Projects/@verndale/provision-sitecore-component`
(local clone of the existing empty GitHub repo `verndale/provision-sitecore-component`).
All files in this plan are created there; ai-orchestration is read from but not modified.

## Context

Creating a Sitecore XM Cloud component is manual on both sides: backend engineers
hand-configure the CMS — templates and fields, required-field validation, list/tree
Source restrictions ("only allow authors to select certain things"), placeholder
settings — then hand-write the bare-bones TSX contract the frontend pipeline consumes.
The field definitions already exist in the BA functional spec (Confluence).

This delivers a **new standalone project** into the existing empty GitHub repo
**verndale/provision-sitecore-component** (cloned to
`/Users/joe.fusco/Projects/@verndale/provision-sitecore-component`), with the same
ai-commit / ai-pr / semantic-release tooling as ai-orchestration. One **component
manifest** (JSON, drafted from the Confluence spec, human-reviewed) drives BOTH:

1. **CMS items** via the XM Cloud Authoring GraphQL API
   (`https://<instance>/sitecore/api/authoring/graphql/v1/`, OAuth2 client credentials):
   templates + sections + fields with per-field config (Required validation, Source,
   Title, help text), JSON rendering + datasource bindings, optional insert options and
   placeholder settings. Idempotent create-or-update; never deletes.
2. **The front-end TSX scaffold** — `Component.tsx` + `Component.types.ts` in the house
   pattern, replacing the hand-written eng handoff file. Boundary mirroring is guaranteed
   by construction (the same manifest creates the template). This is the pipeline entry
   artifact for `/implement-build-pack`.

Ground truth from the two real CN specs (People Detail Masthead 6997180543, Related
Content Card 6766788927): multiple templates per component (datasource + shared page-base
like `_RelatedContentPageData`); fields added to an **existing** page template section
(Masthead has no datasource); Droptree/Multilist Source restrictions expressed as intent
and concretized at review; explicit Required column; renderings without datasource
bindings. "Content Structure" sections are ignored on import. Specs name fields with
display labels ("Person Name") while the eng handoffs use camelCase CMS names — the
manifest carries both (`name` + `title`), convention confirmed at the review gate.

Decisions made by Joe: own repo; Authoring API push (not SCS YAML); manifest drafted
from the Confluence spec; scope includes field-level config + placeholder settings.
Available Renderings registration stays a reported manual follow-up in v1.

## Repo layout

```
provision-sitecore-component/
├── package.json            @verndale/provision-sitecore-component, private, bin,
│                           packageManager pnpm@10.33.0, engines node >=24.14.0
├── .nvmrc  .gitignore
├── .releaserc.cjs          adapted from ai-orchestration (+ scripts/release/
│                           semantic-release-structured-notes.cjs copied over)
├── .github/workflows/      pr.yml (ai-pr draft PR on push to non-main), commitlint.yml,
│                           release.yml (semantic-release on main), test.yml (pnpm test on PR)
├── .husky/                 via `pnpm dlx @verndale/ai-commit init` (commit-msg,
│                           pre-commit, prepare-commit-msg; scripts commit/prepare)
├── src/
│   ├── cli.cjs             bin entry — subcommands: plan (default) | check | push;
│   │                       flags: --no-tsx, --force-tsx, --config <path>
│   ├── validate-manifest.cjs
│   ├── type-map.cjs
│   ├── build-plan.cjs
│   ├── emit-tsx.cjs        ← the TSX scaffold emitter (types + component pair)
│   └── executor.cjs        Authoring API client (injectable fetch)
├── skills/
│   ├── _meta/              vendored from ai-orchestration: _skill-template.md,
│   │                       _skill-sections.md (authoring spec — future edits here
│   │                       follow the same standard; header notes the sync source)
│   ├── _shared/retry-contract.md   vendored (the skill's validation loop references it)
│   └── provision-sitecore-component/
│       ├── SKILL.md  README.md
│       └── references/{manifest-contract,type-mapping,authoring-api,confluence-import,tsx-template}.md
├── test/                   node:test suites + golden fixtures
│   ├── skills-lint         ported from ai-orchestration scripts/evals/skills-lint.cjs,
│   │                       pointed at skills/ — enforces the authoring standard in CI
│   └── fixtures/{datasource-card, page-fields, invalid, wrong-adapter}
├── examples/               two manifests modeled on the CN specs
└── README.md  CONTRIBUTING.md
```

Dependency-free runtime (plain Node, global fetch); devDeps only for tooling
(ai-commit, ai-pr, semantic-release stack, husky, commitlint — mirrored from
ai-orchestration's package.json). Release config mirrors ai-orchestration: version to
package.json + tags + GitHub Releases, no npm publish (flip `npmPublish` later if app
repos should `npx` it). The `skills/` tree uses the ai-orchestration SKILL.md format so
app repos can symlink it into their IDE skills dir alongside the pipeline skills;
ai-orchestration itself is untouched in this delivery (pointer there = follow-up).

## Config resolution (standalone but pipeline-friendly)

Order: `--config <path>` → `./provision.config.json` → `./build.config.json` key
`sitecoreProvisioning` (when run from an app repo root). Shape:

```json
{
  "templateRoots": {
    "datasource": "/sitecore/templates/Project/<t>/<s>/Components",
    "base": "/sitecore/templates/Project/<t>/<s>/Pages/Base",
    "page": "/sitecore/templates/Project/<t>/<s>/Pages"
  },
  "renderingRoot": "/sitecore/layout/Renderings/Project/<t>/<s>",
  "placeholderSettingsRoot": "/sitecore/layout/Placeholder Settings/Project/<t>/<s>",
  "datasourceLocation": "query:$site/*[@@name='Data']",
  "componentPropsImport": "lib/component-props"
}
```

Missing/incomplete config at runtime → exit 2 with `ERROR / Cause / Next` naming the key
(per-manifest `sitecorePaths` overrides allowed).

## Manifest schema (v1, JSON — `src/validate-manifest.cjs`)

```json
{
  "version": 1,
  "component": "RelatedContentCard",
  "slug": "related-content-card",
  "output": "src/components/related-content/related-content-card",
  "confluence": { "url": "…", "pageId": "6766788927" },
  "templates": [
    {
      "role": "datasource",
      "name": "Related Content Card",
      "existing": false,
      "sections": [{
        "name": "Content",
        "fields": [{
          "name": "pageReference",
          "title": "Page Reference",
          "sitecoreType": "Droptree",
          "required": true,
          "source": "query:…",
          "helpText": "Selects the page used as the source for the card content"
        }]
      }],
      "insertOptions": []
    },
    { "role": "base", "name": "_RelatedContentPageData", "existing": false, "sections": [] }
  ],
  "rendering": {
    "name": "Related Content Card",
    "componentName": "RelatedContentCard",
    "datasourceTemplate": "Related Content Card",
    "datasourceLocation": "…"
  },
  "placeholders": [{ "name": "…", "allowedControlsAdd": true }]
}
```

Semantics: `templates[].role` picks the parent root (path override allowed);
`existing: true` = add sections/fields to an existing template (Masthead case; preflight
verifies presence, exit 1 if absent); `rendering` nullable, its datasource keys optional;
`placeholders` optional, add-only; per field `name` = CMS item name = SDK `fields` key,
`title` = author-facing label, `required` → standard Required field rule attached to the
configured validation bars, `source`/`datasourceLocation` opaque authored strings.
Validation: `slug` = kebab of `component`; `output` repo-relative, no `..` escape; unique
field names per template; `rendering.datasourceTemplate` must name a manifest template or
existing path. Failures: one `ERROR/Cause/Next` line each, exit 2.

## Type map (`src/type-map.cjs`, single source; doc mirror in references)

Single-Line/Multi-Line Text → `Field<string>` → `<Text>` · Rich Text → `RichTextField` →
`<RichText className="rtf">` · Image → `ImageField` → `<NextImage>` · General Link →
`LinkField` → `<Link>` · Date/Datetime → `Field<string>` (TODO renderer) · Checkbox →
`Field<boolean>` (TODO) · Number/Integer → `Field<number>` (TODO) · Droptree/Droplink →
referenced-item type; Multilist/Treelist → item array — exact Content SDK 2 exports
verified during implementation, conservative `unknown` + TODO if unverifiable · unknown →
`Field<unknown>` + TODO naming the type. Reference doc also carries BA-vocabulary →
sitecoreType guidance for the import step (ambiguity → review questions, never guesses).

## CLI behavior

- **`plan <manifest>` (default, offline — the golden surface):** validate; write
  byte-deterministic `<slug>.plan.json` next to the manifest; emit the TSX pair
  create-only at `output` (existing file → `skipped (exists)`, exit 0; `--force-tsx`
  overwrites; `--no-tsx` skips).
- **`check <manifest>` (online, read-only):** preflights only; per-op `create` /
  `update: +N` / `no-op` / `conflict`. Feeds the push gate with real CMS state.
- **`push <manifest>` (online, mutating):** fixed op order — templates
  (`createItemTemplate`: sections/fields name+type, the documented input shape) →
  per-field config (`updateItem` on template-field items: `Source`, `Title`, help text,
  Required rule on validation bars — field/section/rule items resolved **by path**, never
  hardcoded GUIDs; fields on existing templates via template-field item creation) →
  standard values + insert options (add-only `__Masters`) → rendering (`createItem` from
  the Json Rendering template resolved by path, `ownFields` introspection verifying
  `componentName` / `Datasource Template` / `Datasource Location`) → bindings
  (`updateItem`, idempotent) → placeholder settings (create-or-update, Allowed Controls
  add-only). Reconcile: add-only everywhere; extra CMS fields / type mismatches →
  `manualFollowUps`, never deleted or retyped.
- Exit: 0 success/skip · 1 API/auth/conflict/missing-existing-template · 2 invocation/config/manifest.
- Auth env (documented, never echoed): `SITECORE_AUTHORING_CLIENT_ID` / `_CLIENT_SECRET`
  / `_ENDPOINT` + `_TOKEN_URL` / `_AUDIENCE` (sitecorecloud.io defaults). Client
  credentials → bearer. Retry cap 3 on 429/5xx/network; 4xx never retried.
- Plan JSON embeds GraphQL docs verbatim (human-reviewable) with `__PLACEHOLDER__` ids
  resolved from preflight results; `manualFollowUps` always lists Available Renderings
  + anything reconcile declined.

## Emitted TSX pair (`src/emit-tsx.cjs`, golden-pinned)

Datasource components: `<C>.types.ts` — SDK wrapper type imports, `ComponentProps` from
`componentPropsImport`, `export interface <C>Fields` (exact names, `?` for
non-required), `export type <C>Props` — and `<C>.tsx` — `import type` from the types
file, `useSitecore` / `page.mode.isEditing`, `if (!fields && !isEditing) return null;`,
root `data-component="<slug>"`, direct SDK renderers per type map with TODOs for
non-renderer types. Page-driven components (no datasource): same pair typed from the
page-template section, route-item access marked with a documented TODO block for
Implement to finalize. Compiles standalone; matches the pipeline's Implement fill-in-place
conventions (PascalCase files, types-file split per the sitecore-ai adapter).

## Skill (`skills/provision-sitecore-component/SKILL.md`)

Authored to the ai-orchestration skill standard (vendored `_meta/_skill-sections.md`
spec + Anthropic's agent-skill best practices): YAML frontmatter with `name` +
`description` only (third-person, WHAT + WHEN with concrete triggers); H1 `# Skill: …`,
1–2 sentence lead, literal `Operator docs: [README.md](README.md).`; H2 sections in
exact order Use when / First-hop references / Workflow / Inputs and outputs /
Validation loops / Guardrails; <500 lines with templates and schemas in `references/`
one hop deep; `## Contents` after the H1 on any file >100 lines; ✅/❌ example pairs on
normative rules; no emphasis anti-patterns; H2/H3 only. Enforced by the ported
skills-lint in CI. Workflow: fetch spec via
`<AtlassianServer>:getConfluencePage` (retrieval failure = hard stop; never draft from
memory) → parse both spec shapes (Editable Fields and multi-template "Template Fields"
tables + the "Item" table; ignore "Content Structure") → map types; ambiguous Source
restrictions / field naming become review questions → write manifest → `plan` (offline)
→ surface manifest + plan + scaffold → **one AskUserQuestion gate before any push**
(`check` then push / push now / stop at manifest+scaffold) → on approval `push`, report
reconcile results + `manualFollowUps` verbatim → hand off to `/generate-build-pack`.
Manifest repair loop against exit 2 capped at 3 attempts. Guardrails: no push without
in-session gate approval; never delete/rename CMS items or remove Allowed Controls; no
TSX overwrite without `--force-tsx`; source strings opaque. References ×5 as laid out
above; `confluence-import.md` uses the two CN specs as worked examples.

## Tests (plain `pnpm test` — node:test + goldens; no orchestration eval machinery)

- Golden fixtures: `datasource-card/` (Related-Content-Card-shaped: two templates,
  Droptree+source, required mix, insert options, placeholder), `page-fields/`
  (Masthead-shaped: existing page template, section add, rendering without datasource) —
  each with committed `expected-plan.json` + `expected/<C>.types.ts` + `expected/<C>.tsx`
  byte-compared, double-run determinism.
- `invalid/` (bad-version, slug-mismatch, empty-fields, dupe-names, path-escape, unknown
  datasourceTemplate ref, missing-config) → exit 2 with the right `ERROR` regex;
  `wrong-adapter/` build.config → exit 2.
- Executor units with injected fetch: token flow, create/update paths, field-config
  updates, never-delete assertion (no mutation body matches `/delete/i`), retry cap 3,
  401 no-retry, `check` issues zero mutations, missing env → error before any fetch.
- Ported skills-lint asserting the skill tree passes the ai-orchestration authoring rules.

## README (top-level, first-class deliverable)

`README.md` covers: what the tool does (one diagram-free paragraph: spec → manifest →
CMS items + TSX scaffold); requirements (Node 24+, pnpm via Corepack); install/run
(`pnpm install`, `node src/cli.cjs …` and the bin form); the three subcommands with exit
codes; config resolution order and the full config schema; manifest contract summary
(with a link to the skill reference for the full schema); auth env vars and how to
create the XM Cloud automation client; the safety model (offline default, read-only
`check`, add-only reconcile, never-delete); the skill — what it does and how app repos
symlink `skills/` into their IDE discovery dir; the manual follow-ups the tool reports
(Available Renderings, params templates); development (test, commit via
`pnpm commit`, PR via ai-pr, semantic-release on main). `## Contents` with anchor links
per the >100-line house rule. `CONTRIBUTING.md` mirrors ai-orchestration's commit
workflow (Conventional Commits, `pnpm commit`, never commit secrets).

## Execution steps

1. `git clone https://github.com/verndale/provision-sitecore-component` into
   `/Users/joe.fusco/Projects/@verndale/` (empty clone — wires the remote, no commits).
2. Scaffold tooling: package.json (devDeps mirrored from ai-orchestration), .nvmrc,
   .gitignore, .releaserc.cjs + structured-notes script, 4 workflows, README skeleton;
   `pnpm install`; `pnpm dlx @verndale/ai-commit init` (husky + commit/prepare scripts).
3. Build pure cores: type-map → validate-manifest → build-plan → emit-tsx.
4. cli.cjs (plan mode) → executor.cjs (check/push).
5. Fixtures (freeze goldens generated by the emitter) → tests green.
6. Vendor `skills/_meta/` + `skills/_shared/retry-contract.md` from ai-orchestration;
   author skill files to that spec; port skills-lint into `test/`; examples/;
   full README.md + CONTRIBUTING.md per the README section above.
7. `pnpm test` full green (units + goldens + skills-lint); demo run:
   `node src/cli.cjs plan examples/related-content-card.json`
   into a temp dir showing plan + TSX output.
8. Read-only review agent over the working tree; report findings.
9. Hand back **uncommitted**. Suggested first commit:
   `feat: scaffold provision-sitecore-component CLI, skill, and release tooling`.
   Joe owns commit/push. Flags for Joe: repo is currently **public** — confirm intended;
   npm publish stays off (version-only releases) unless he flips it.

## Verification

`pnpm test` (all suites + goldens); the examples demo run in step 7; `pnpm release:dry`
skipped (needs commit history). Honest boundary: no XM Cloud credentials here — live
`check`/`push`, template-field item shapes, and Required-rule wiring get validated by
backend against a dev environment; path-resolution + introspection preflights are the
in-tool safety net for that first run.

## Risks

1. Template-field item field names (`Source`, `Title`, validation bars) / Required rule
   location differ from assumption → resolved by path with introspection preflights +
   documented remediation; nothing hardcoded.
2. Content SDK 2 reference-field types (Droptree/Multilist) → verify against SDK surface;
   TODO-typed fallback keeps scaffolds compiling.
3. Field-naming convention (camelCase names + display Titles) → manifest carries both;
   confirmed per project at the review gate.
4. Shared-CMS safety → offline default, read-only `check`, single push gate, add-only
   reconcile, never-delete invariant (including Allowed Controls).
5. `@verndale/ai-commit` / `ai-pr` install or init friction in a fresh repo → resolve at
   step 2 before building features (they're plain npm devDeps in ai-orchestration).
