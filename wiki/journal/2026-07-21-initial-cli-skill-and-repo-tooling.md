---
date: 2026-07-21
topics: [sitecore-provisioning, repo-tooling, knowledge-graph]
plan: plans/2026-07-21-plan-provision-sitecore-component-standalone-repo-cli-skill.md
pr: https://github.com/verndale/provision-sitecore-component/pull/7
---
# Initial CLI, skill, and repo tooling

## Why

- Creating a Sitecore XM Cloud component was manual on both sides: backend engineers hand-configured templates, required-field validation, Source restrictions, renderings, and placeholder settings in the CMS, then hand-wrote the bare-bones TSX contract the frontend pipeline consumes.
- The field definitions already exist in the BA functional spec (Confluence) — the handoff is mechanically derivable from one reviewed field manifest.
- Making the same manifest create both the CMS template and the TypeScript boundary contract removes the drift risk between them by construction.

## What changed

- Standalone repo (decided over adding to ai-orchestration): CLI with `plan` (offline, byte-deterministic plan JSON + TSX pair) / `check` (read-only preflight) / `push` (Authoring GraphQL API, add-only reconcile — never deletes, renames, or retypes; well-known items resolved by path with introspection preflights, no hardcoded GUIDs).
- Authoring API push was chosen over SCS YAML emission; scope covers datasource/page templates + field config + rendering bindings + insert options + placeholder settings, with Available Renderings and params templates as reported manual follow-ups.
- Agent skill (ai-orchestration SKILL.md standard) drafts the manifest from the Confluence spec — ambiguities (Source strings, naming convention, picker types) become review questions, never guesses — and gates any push behind one AskUserQuestion.
- Tests: golden fixtures modeled on the two real CN specs (Related Content Card, People Detail Masthead), executor units against an injected-fetch fake CMS, ported skills-lint.
- Tooling mirrored from ai-orchestration: ai-commit + ai-pr + semantic-release + commitlint workflows; wiki system ported same-day minus the Slack sync. The knowledge graph came with it — viewer, routing, and generated connections pages verbatim, with discovery rewritten for this repo's layout (source/test/automation nodes, require() edges replacing the resolver/eval edges).
- Post-review fixes before handoff: standard-values ops moved after all template ops (insert options may name later-declared templates) and cross-section field collisions downgraded from mid-push abort to reported conflict.

## Files

- src/cli.cjs, src/{validate-manifest,type-map,build-plan,emit-tsx,executor}.cjs
- skills/provision-sitecore-component/ (SKILL.md, references ×5)
- test/ (goldens, executor units, skills-lint), scripts/wiki/, scripts/release/
- setup.sh, .github/workflows/, wiki/

## Follow-ups

- Validate the live `check`/`push` path against a dev XM Cloud environment (template-field item shapes, Required-rule wiring).
- Automate Available Renderings registration and rendering-parameters templates (v2 scope).
- Confirm Content SDK 2 reference-field types (Droptree/Multilist) against the SDK surface and tighten the type map.
