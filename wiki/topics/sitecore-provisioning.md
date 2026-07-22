---
aliases: [component provisioning, manifest, Authoring API push, TSX scaffold, CMS template creation]
covers: [skills/provision-sitecore-component/SKILL.md, src/cli.cjs, src/build-plan.cjs, src/emit-tsx.cjs, src/executor.cjs]
---
# Sitecore component provisioning — Design History

How one reviewed manifest drives both the CMS side (templates, fields, rendering, placeholder settings via the Authoring GraphQL API) and the front-end TSX handoff scaffold.

## Current state

- The manifest ([contract](../../skills/provision-sitecore-component/references/manifest-contract.md)) is drafted from the Confluence functional spec by the skill, reviewed by a human, and is the single source for both sides.
- `plan` is offline and byte-deterministic; the plan JSON embeds the GraphQL documents verbatim with `__PLACEHOLDER__` ids bound from preflights at run time — no hardcoded GUIDs ([src/build-plan.cjs](../../src/build-plan.cjs)).
- `check` is read-only (a hard guard refuses mutations outside push mode); `push` reconciles add-only — extra CMS fields, type mismatches, and mislocated fields become follow-ups, never deletions or retypes ([src/executor.cjs](../../src/executor.cjs)) — and is confirmation-gated at the CLI (TTY y/N, or `--yes` recording the skill's step-6 approval).
- The shared PreToolUse policy is platform-adapted: Claude Code can ask on push, while Codex denies the command until `--yes` records the skill gate; Codex hooks use canonical `Bash`/`apply_patch` payloads and require exact-hash trust after updates ([scripts/hooks/pretooluse-guard.cjs](../../scripts/hooks/pretooluse-guard.cjs)).
- Required fields attach the standard Required rule (resolved by path) to the Validate Button and Workflow bars; list fields (`__Masters`, Allowed Controls, validation bars) merge append-only with brace/case-insensitive de-duplication.
- The emitted pair (`Component.types.ts` + `Component.tsx`) matches the eng team's handoff contract and the ai-orchestration sitecore-ai adapter's boundary rules; page-driven components (no datasource) emit a typed contract with a marked TODO for the page-item access ([src/emit-tsx.cjs](../../src/emit-tsx.cjs)).
- Golden fixtures pin plans and TSX byte-for-byte, modeled on the CN Related Content Card (datasource, two templates, restricted Droptree) and People Detail Masthead (existing page template, rendering without datasource) specs.

## Decisions

- 2026-07-22 — The harness Read tool is now guarded like Bash readers and edit tools: `decideRead` denies `.env` in tool/provisioning repos and the central credential file everywhere, via a new Claude `Read` matcher (Codex reads go through shell, already covered) ([issue #20](https://github.com/verndale/provision-sitecore-component/issues/20), [plan](../plans/2026-07-22-close-the-read-tool-env-gap-in-the-pretooluse-guard.md), [journal](../journal/2026-07-22-read-tool-env-guard.md)).
- 2026-07-22 — feat(provision-sitecore-component): Enhance PreToolUse guard for Claude  ([PR #18](https://github.com/verndale/provision-sitecore-component/pull/18))
- 2026-07-21 — Corrected the Codex adapter to the live hook contract: canonical payloads, git-root launch, exact-hash trust guidance, and deny-until-`--yes` because PreToolUse ask is unsupported ([issue #17](https://github.com/verndale/provision-sitecore-component/issues/17), [plan](../plans/2026-07-21-fix-codex-pretooluse-enforcement-and-track-the-bug--9937d534aad2.md), [journal](../journal/2026-07-21-codex-pretooluse-compatibility.md)).
- 2026-07-21 — feat(provision-sitecore-component): Implement PreToolUse guard for enhan ([PR #10](https://github.com/verndale/provision-sitecore-component/pull/10))
- 2026-07-21 — Guardrails ship with the skill: a shared PreToolUse guard registered user-level for Claude Code and Codex by setup.sh (plus checked-in project configs), a CLI-level push confirmation (`--yes` records the step-6 gate), husky agent-commit blocks, and a per-machine credential file — enforcement travels to consumer repos instead of living only here. ([journal](../journal/2026-07-21-skill-shipped-guardrails.md))
- 2026-07-21 — fix(provision-sitecore-component): Update byte count and sort file lists ([PR #7](https://github.com/verndale/provision-sitecore-component/pull/7))
- 2026-07-21 — feat(evals): Add skill evaluation scenarios and CI workflow ([PR #3](https://github.com/verndale/provision-sitecore-component/pull/3))
- 2026-07-21 — Cross-section field collisions report a conflict and continue instead of aborting mid-push; standard-values ops run after all template ops so insert options can name later-declared templates (post-review fixes). ([journal](../journal/2026-07-21-initial-cli-skill-and-repo-tooling.md))
- 2026-07-21 — Authoring API push over SCS YAML emission (Joe's call at planning): live create-or-update with preflights, no serialization-tree dependency. ([plan](../plans/2026-07-21-plan-provision-sitecore-component-standalone-repo-cli-skill.md))
- 2026-07-21 — Standalone repo + global skill install, not an ai-orchestration subtree: the tool ships its own CLI, tests, and release tooling; app repos and developers consume it directly. ([plan](../plans/2026-07-21-plan-provision-sitecore-component-standalone-repo-cli-skill.md), [journal](../journal/2026-07-21-initial-cli-skill-and-repo-tooling.md))
- 2026-07-21 — Manifest field entries carry both `name` (CMS item name = SDK key) and `title` (author label) because specs write display labels while eng handoffs use camelCase; the convention is confirmed at review. ([plan](../plans/2026-07-21-plan-provision-sitecore-component-standalone-repo-cli-skill.md))

## Open threads

- Live `check`/`push` not yet validated against a dev XM Cloud environment (template-field item shapes, Required-rule wiring, `createItemTemplate` input variants).
- Available Renderings registration and rendering-parameters templates remain manual follow-ups (candidate v2 scope).
- Content SDK 2 reference-field types (Droptree/Multilist) are conservatively `unknown` pending SDK-surface verification.
