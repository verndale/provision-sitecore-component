---
aliases: [component provisioning, manifest, Authoring API push, TSX scaffold, CMS template creation]
covers: [skills/provision-sitecore-component/SKILL.md, src/cli.cjs, src/build-plan.cjs, src/emit-tsx.cjs, src/executor.cjs]
---
# Sitecore component provisioning — Design History

How one reviewed manifest drives both the CMS side (templates, fields, rendering, placeholder settings via the Authoring GraphQL API) and the front-end TSX handoff scaffold.

## Current state

- The manifest ([contract](../../skills/provision-sitecore-component/references/manifest-contract.md)) is drafted from the Confluence functional spec by the skill, reviewed by a human, and is the single source for both sides.
- `plan` is offline and byte-deterministic; the plan JSON embeds the GraphQL documents verbatim with `__PLACEHOLDER__` ids bound from preflights at run time — no hardcoded GUIDs ([src/build-plan.cjs](../../src/build-plan.cjs)).
- `check` is read-only (a hard guard refuses mutations outside push mode); `push` reconciles add-only — extra CMS fields, type mismatches, and mislocated fields become follow-ups, never deletions or retypes ([src/executor.cjs](../../src/executor.cjs)).
- Required fields attach the standard Required rule (resolved by path) to the Validate Button and Workflow bars; list fields (`__Masters`, Allowed Controls, validation bars) merge append-only with brace/case-insensitive de-duplication.
- The emitted pair (`Component.types.ts` + `Component.tsx`) matches the eng team's handoff contract and the ai-orchestration sitecore-ai adapter's boundary rules; page-driven components (no datasource) emit a typed contract with a marked TODO for the page-item access ([src/emit-tsx.cjs](../../src/emit-tsx.cjs)).
- Golden fixtures pin plans and TSX byte-for-byte, modeled on the CN Related Content Card (datasource, two templates, restricted Droptree) and People Detail Masthead (existing page template, rendering without datasource) specs.

## Decisions

- 2026-07-21 — feat(evals): Add skill evaluation scenarios and CI workflow ([PR #3](https://github.com/verndale/provision-sitecore-component/pull/3))
- 2026-07-21 — Cross-section field collisions report a conflict and continue instead of aborting mid-push; standard-values ops run after all template ops so insert options can name later-declared templates (post-review fixes). ([journal](../journal/2026-07-21-initial-cli-skill-and-repo-tooling.md))
- 2026-07-21 — Authoring API push over SCS YAML emission (Joe's call at planning): live create-or-update with preflights, no serialization-tree dependency. ([plan](../plans/2026-07-21-plan-provision-sitecore-component-standalone-repo-cli-skill.md))
- 2026-07-21 — Standalone repo + global skill install, not an ai-orchestration subtree: the tool ships its own CLI, tests, and release tooling; app repos and developers consume it directly. ([plan](../plans/2026-07-21-plan-provision-sitecore-component-standalone-repo-cli-skill.md), [journal](../journal/2026-07-21-initial-cli-skill-and-repo-tooling.md))
- 2026-07-21 — Manifest field entries carry both `name` (CMS item name = SDK key) and `title` (author label) because specs write display labels while eng handoffs use camelCase; the convention is confirmed at review. ([plan](../plans/2026-07-21-plan-provision-sitecore-component-standalone-repo-cli-skill.md))

## Open threads

- Live `check`/`push` not yet validated against a dev XM Cloud environment (template-field item shapes, Required-rule wiring, `createItemTemplate` input variants).
- Available Renderings registration and rendering-parameters templates remain manual follow-ups (candidate v2 scope).
- Content SDK 2 reference-field types (Droptree/Multilist) are conservatively `unknown` pending SDK-surface verification.
