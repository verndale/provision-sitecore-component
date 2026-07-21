# Skill evals

Behavioral eval scenarios for this repo's skill live here. These files are maintainer-facing only; they stay outside `skills/` so a mirrored IDE skill tree remains runtime-only.

This layer is the skill-behavior counterpart to the deterministic `node:test` suite under `test/` (which covers the CLI, planner, and executor). It guards the promises `skills/provision-sitecore-component/SKILL.md` makes to the agent — the push gate, the manifest-repair loop, the hard-stop boundaries — none of which have a runtime in CI. Ported from ai-orchestration's `frontend-ai/evals/`.

## Layout

```text
evals/
  _shared/
    coverage-policy.json
    scenario.schema.json
  provision-sitecore-component/
    scenarios/*.json
```

- `_shared/coverage-policy.json` — required skills, minimum scenario count, and required tags.
- `_shared/scenario.schema.json` — the scenario shape; its `tags.items.enum` must equal the policy's `allowedTags`.
- Each skill owns its scenarios under `evals/<skill>/scenarios/`.

## Scenario contract

Each scenario is a JSON object with these required fields (and no others):

- `id` — `<skill>-<slug>`, lowercase kebab-case
- `title`
- `skills` — single-item array; the item must match the parent skill folder name
- `query` — the developer's request, ≥ 20 chars
- `files` — repo-relative paths that must exist on disk
- `expected_behavior` — at least 3 concrete expectations, ≥ 20 chars each
- `must_not` — may be empty, but the field must exist
- `tags` — from the controlled vocabulary below
- `gap` — the specific behavior gap this eval protects, ≥ 20 chars

Keep scenarios concrete. They test skill-specific promises from `SKILL.md` and its first-hop references, not generic "be useful" behavior. The check is manifest-only: it validates the scenario corpus and per-skill coverage — it does not execute live model runs.

## Controlled tags

- `happy-path` — spec → manifest → offline plan
- `datasource` — datasource-mode component (its own template + source)
- `page-driven` — page-driven component, no datasource
- `push-gate` — the single AskUserQuestion gate before any CMS mutation
- `session-scoped` — approval must be given in the current session
- `no-invent-source` — surface an unknown Source as a question; never invent + push
- `boundary` — a failure / edge path that must hard-stop or exit non-zero
- `confluence-hard-stop` — Confluence retrieval failure ends the run
- `wrong-adapter` — a non-`sitecore-ai` `stackAdapter` is a hard error
- `missing-env` — missing `SITECORE_AUTHORING_*` fails before any network call
- `retry-gate` — the manifest-repair loop, capped at 3 attempts
- `manifest-repair` — repair edits are confined to the manifest file
- `check-only` — read-only preflight (`check`) issues zero mutations

## Authoring workflow

When the skill or a guardrail changes:

1. Update the scenarios under `evals/provision-sitecore-component/`.
2. Add or revise `must_not` expectations when a regression boundary becomes clearer.
3. Update `coverage-policy.json` (and the schema's tag enum, in lockstep) if a tag is added.
4. Run `pnpm evals:check`.

Every skill under `skills/` must appear in either `requiredSkills` or `excludedSkills` — a skill in neither fails validation, and every policy name must map to a real `SKILL.md`. A skill that intentionally has no scenarios goes in `excludedSkills` with a `reason`.

## Validation

`pnpm evals:check` validates:

- scenario schema and required fields
- duplicate IDs and folder-to-skill ownership
- controlled tags and repo-relative file references (files must exist)
- required per-skill coverage and required-tag coverage
- coverage completeness: every skill is required-or-excluded, and every policy name maps to a real `SKILL.md`
- internal invalid-fixture self-checks for the validator itself (`scripts/evals/fixtures/invalid/`)

It also runs under `pnpm test` via `test/evals-check.test.cjs`, so a broken scenario fails the same CI gate as the unit tests.
