---
date: 2026-07-21
topics: [skill-evals]
plan: plans/2026-07-21-add-skill-eval-scenarios-validator-ci-issue-1.md
pr: pending
---
# Skill eval scenarios and CI

## Why

- The `node:test` layer guards the CLI, planner, and executor, but nothing guarded the skill's documented agent behavior — the push gate, the manifest-repair loop, the hard-stop boundaries. A weakened guardrail in `SKILL.md` failed no build.
- That eval layer was scoped in the original standalone plan but dropped when only the `node:test` analog shipped (issue #1).
- ai-orchestration already runs a proven scenario-eval harness; porting it keeps the eval contract identical across the Verndale toolchain rather than inventing a divergent one.

## What changed

- Ported ai-orchestration's `scripts/evals/check.cjs` near-verbatim, repointing its two base paths (`frontend-ai/evals` → `evals`, `frontend-ai/skills` → `skills`) and error labels; kept the four exports and the `EVALS_REPO_ROOT` test hook.
- Added a repo-root `evals/` tree: `_shared/coverage-policy.json` (single skill, min 6 scenarios, required tags happy-path/push-gate/boundary/retry-gate), `_shared/scenario.schema.json` (tag enum kept equal to `allowedTags`), a README, and 8 scenarios covering the happy path (datasource, page-driven), the push gate (including no-invent-source), the boundaries (Confluence hard-stop, wrong adapter, missing env), and the capped manifest-repair loop.
- Ported the 7 invalid self-check fixtures so the validator proves it rejects bad input before validating the real suite.
- Wired CI just like ai-orchestration: an `evals:check` script and a dedicated `evals.yml` workflow, plus `test/evals-check.test.cjs` so `pnpm test` gates it too.
- Registered `scripts/evals/*.cjs` in the graph classifier as an automation node and captured the `skill-evals` topic.
- Ruled out a lighter repo-native check (Joe's call): the full port stays byte-compatible with the other repos and self-checks against its own invalid fixtures.

## Files

- scripts/evals/check.cjs, scripts/evals/fixtures/invalid/*.json
- evals/_shared/{coverage-policy,scenario.schema}.json, evals/README.md, evals/provision-sitecore-component/scenarios/*.json
- test/evals-check.test.cjs, package.json, .github/workflows/evals.yml
- scripts/graph/build-graph.cjs (classifier), wiki/topics/skill-evals.md

## Follow-ups

- The check is manifest-only — it validates the scenario corpus, not live model behavior. Executing scenarios against a model runner is out of scope for v1.
