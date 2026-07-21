---
aliases: [skill eval scenarios, evals check, coverage policy, scenario schema, eval harness]
covers: [scripts/evals/check.cjs, test/evals-check.test.cjs]
---
# Skill evals — Design History

The behavioral eval layer that guards the `provision-sitecore-component` skill's documented promises — the push gate, the manifest-repair loop, the hard-stop boundaries — against regression, separate from the deterministic CLI/executor tests under `test/`.

## Current state

- Scenarios are JSON specs — goal/prompt, at least three `expected_behavior`, a `must_not` list, controlled tags, and the regression `gap` they protect — e.g. [03-push-gate.json](../../evals/provision-sitecore-component/scenarios/03-push-gate.json). They are static behavioral specs, not executed model runs.
- [scripts/evals/check.cjs](../../scripts/evals/check.cjs) validates the scenario schema, per-skill coverage (minimum count plus required tags), controlled tags, and repo-relative file existence against [coverage-policy.json](../../evals/_shared/coverage-policy.json) and [scenario.schema.json](../../evals/_shared/scenario.schema.json). The schema's tag enum must equal the policy's `allowedTags`.
- The validator self-checks first: each fixture under `scripts/evals/fixtures/invalid/` is a policy-plus-scenarios-plus-expectedErrors triple it must reject before the real suite runs — e.g. [unknown-tag.json](../../scripts/evals/fixtures/invalid/unknown-tag.json).
- Coverage is bidirectionally complete: every `skills/<name>/SKILL.md` must be required-or-excluded in the policy, and every policy name must map to a real SKILL.md, so a new unclassified skill fails the check.
- Two CI paths gate it: [test/evals-check.test.cjs](../../test/evals-check.test.cjs) runs under `pnpm test`, and a dedicated `evals` workflow runs `pnpm evals:check`. The scenario/fixture JSON is invisible to the knowledge graph (only `.md`/`.cjs`/`.sh` are walked); `scripts/evals/*.cjs` classifies as an automation node.
- Authoring workflow and the tag vocabulary live in [evals/README.md](../../evals/README.md).

## Decisions

- 2026-07-21 — Full port of ai-orchestration's `scripts/evals/check.cjs` plus its `_shared` policy/schema over a lighter repo-native check, so the eval contract stays byte-compatible across the Verndale toolchain (issue [#1](https://github.com/verndale/provision-sitecore-component/issues/1)). ([journal](../journal/2026-07-21-skill-eval-scenarios-and-ci.md))
- 2026-07-21 — Wired both as a standalone `evals:check` script with its own `evals.yml` workflow and as a `test/evals-check.test.cjs` wrapper under `pnpm test`, mirroring ai-orchestration's dual coverage. ([journal](../journal/2026-07-21-skill-eval-scenarios-and-ci.md))
- 2026-07-21 — Scenario JSON stays maintainer-facing at repo-root `evals/` (no `frontend-ai/` prefix) and outside `skills/`, so a mirrored IDE skill tree remains runtime-only. ([journal](../journal/2026-07-21-skill-eval-scenarios-and-ci.md))

## Open threads

- The check is manifest-only: it validates the scenario corpus, not live model behavior. Executing scenarios against a model runner is out of scope for v1.
