---
status: implemented
executed: 2026-07-21
date: 2026-07-21
evidence:
  - "PR #3 https://github.com/verndale/provision-sitecore-component/pull/3 (merged 2026-07-21)"
source_tool: claude
source: "/Users/joe.fusco/.claude/plans/create-a-branch-for-wobbly-sunset.md"
topics: [skill-evals]
---
# Add skill-eval scenarios + validator + CI (issue #1)

Tracking: https://github.com/verndale/provision-sitecore-component/issues/1 — `[Task] Add skill eval scenarios and wire them into CI` (label `area: eval`, assignee JFusco).

## Context

The repo has a deterministic `node:test` layer (goldens, executor, skills-lint, wiki, graph) that guards the **CLI/planner/executor**. It has **no skill-eval scenario layer** — nothing pins the *agent's* documented behavior (the push gate, the manifest-repair loop, the hard-stop boundaries). That layer was scoped in the original standalone-repo plan but dropped; only the `node:test` analog shipped. So today a regression that weakens a guardrail in `SKILL.md` (drops the push gate, removes the cap-3 escalation, softens the Confluence hard-stop) fails no build.

This change ports ai-orchestration's proven eval harness into this repo: committed scenario JSON per skill, a schema + coverage validator that is itself tested against invalid fixtures, and CI wiring so a skill-behavior regression fails the PR. The precedent exists locally and is copied near-verbatim — the eval contract stays byte-compatible across ai-orchestration / ba-cockpit / this repo.

**Decisions locked (from Joe):** full port of AO `check.cjs`; CI wired *just like ai-orchestration* (standalone `evals:check` script + node:test wrapper under `pnpm test` + a dedicated evals workflow); full knowledge-graph + wiki registration.

## What the eval layer is (and is not)

The scenarios are **static, schema-validated behavioral specs** (goal/prompt, ≥3 `expected_behavior`, `must_not`, tags, gap). The validator checks they are well-formed and that per-skill coverage is complete — it does **not** execute the agent. The code-side guards (check-issues-zero-mutations, never-delete, transport retry cap, missing-env-before-fetch) already live in `test/executor.test.cjs`; this layer guards the *documented agent behavior* that has no runtime in CI.

## Source of truth to copy from (ai-orchestration, canonical checkout)

- Validator: `/Users/joe.fusco/Projects/@verndale/ai-orchestration/scripts/evals/check.cjs`
- Schema: `.../frontend-ai/evals/_shared/scenario.schema.json`
- Policy (shape reference): `.../frontend-ai/evals/_shared/coverage-policy.json`
- Sample scenario: `.../frontend-ai/evals/design-review/scenarios/01-happy-path.json`
- Self-check fixtures: `.../scripts/evals/fixtures/invalid/*.json` (7 files)
- node:test wrapper: `.../scripts/tests/unit/coverage-completeness.test.cjs`
- Authoring doc: `.../frontend-ai/evals/README.md`

## Assumptions (load-bearing flagged)

- **[load-bearing]** Evals tree lives at repo root `evals/` (this repo has no `frontend-ai/` prefix). Drives the two path repoints in `check.cjs`.
- **[load-bearing]** `skills/_meta/` carries no `SKILL.md`, so `listSkillNames` returns exactly `["provision-sitecore-component"]` and completeness passes with a single required skill. (Verified.)
- Scenario schema `tags.items.enum` must equal `coverage-policy.allowedTags` exactly — the validator checks both subset directions. Keep them in sync.
- Branch name `feat/eval-scenarios` (rename freely). Commit type `feat(evals)` suggested — flag: `feat`→minor via semantic-release; if you'd rather not bump for internal tooling, use `test(evals)`/`ci`. Your call at commit time.

## Execution steps

### 1. Branch
`git checkout -b feat/eval-scenarios` off `main`. (Branch creation only — no commit/push/PR; handed back uncommitted per working agreement.)

### 2. Port the validator → `scripts/evals/check.cjs`
Copy AO's `check.cjs` verbatim, then repoint for this repo's layout:
- `loadRealSuite` — `path.join(repoRoot, "frontend-ai", "evals")` → `path.join(repoRoot, "evals")`.
- `listSkillNames` — `path.join(repoRoot, "frontend-ai", "skills")` → `path.join(repoRoot, "skills")`.
- `validateSuite` label strings — `"frontend-ai/evals/_shared/…"` → `"evals/_shared/…"`.
- `coverageCompletenessErrors` messages — `frontend-ai/skills/${name}/SKILL.md` → `skills/${name}/SKILL.md`.
- `runInvalidFixtures` default virtual path — `frontend-ai/evals/…` → `evals/…` (cosmetic, in fixture error labels).
- Keep unchanged: fixture dir `scripts/evals/fixtures/invalid`, `EVALS_REPO_ROOT` support, `require.main` guard, shebang, and the four exports (`coverageCompletenessErrors`, `listSkillNames`, `validateCoveragePolicy`, `validateSuite`).

### 3. Evals tree → `evals/`
- `evals/_shared/coverage-policy.json` — `version:1`, `globalMinScenarios:3`, `requiredSkills.provision-sitecore-component = { minScenarios: 6, requiredTags: ["happy-path","push-gate","boundary","retry-gate"] }`. `allowedTags` = the repo vocabulary below. No `excludedSkills` needed.
- `evals/_shared/scenario.schema.json` — port AO's; set repo-appropriate `$id`; replace the `tags.items.enum` with the exact `allowedTags` list.
- `evals/README.md` — port/trim AO's authoring doc to this repo (one skill, root `evals/`).

**Tag vocabulary (`allowedTags`):** `happy-path`, `datasource`, `page-driven`, `push-gate`, `session-scoped`, `no-invent-source`, `boundary`, `confluence-hard-stop`, `wrong-adapter`, `missing-env`, `retry-gate`, `manifest-repair`, `check-only`.

### 4. Scenarios → `evals/provision-sitecore-component/scenarios/*.json` (8, exceeds min 6)
Each: `id` prefixed `provision-sitecore-component-…`, single-item `skills`, `query` ≥20 chars, `files` referencing **existing** paths (`skills/provision-sitecore-component/SKILL.md`, its `references/*.md`, `test/fixtures/*`), ≥3 `expected_behavior` (≥20 chars each), `must_not`, `tags` from vocab, `gap`.

| # | file | tags | guards |
|---|------|------|--------|
| 1 | `01-happy-path-datasource.json` | happy-path, datasource | spec→manifest→plan, datasource-mode emit (models `datasource-card`) |
| 2 | `02-happy-path-page-driven.json` | happy-path, page-driven | page-driven variant, no datasource (models `page-fields`) |
| 3 | `03-push-gate.json` | push-gate, session-scoped | one AskUserQuestion before any mutation; no-answer = stop; `Push:true` still gated |
| 4 | `04-push-gate-no-invent-source.json` | push-gate, no-invent-source | the ❌ guardrail — surface Source as a question, never invent + push |
| 5 | `05-boundary-confluence-hard-stop.json` | boundary, confluence-hard-stop | retrieval failure = hard stop; never draft from memory |
| 6 | `06-boundary-wrong-adapter.json` | boundary, wrong-adapter | `stackAdapter != sitecore-ai` → exit 2 (`test/fixtures/wrong-adapter/`) |
| 7 | `07-boundary-missing-env.json` | boundary, missing-env, check-only | missing `SITECORE_AUTHORING_*` → exit 2 pre-network; values never echoed |
| 8 | `08-retry-gate-manifest-repair.json` | retry-gate, manifest-repair | exit-2 repair loop, cap 3, manifest-file-only edits, Halt-only on exhaustion |

### 5. Self-check fixtures → `scripts/evals/fixtures/invalid/*.json`
Port AO's 7 fixtures, adapting the inline `skills`/folder to `provision-sitecore-component` and `files` to existing target paths (except `missing-file-reference.json`, which intentionally points at a non-existent file). Preserve each `expectedErrors` substring: `bad-skill-folder-match`, `duplicate-id`, `missing-expected-behavior`, `missing-file-reference`, `required-branch-tag-missing`, `required-skill-below-minimum`, `unknown-tag`. These make `check.cjs` prove it rejects bad input before validating the real suite.

### 6. node:test wrapper → `test/evals-check.test.cjs`
Port AO's `coverage-completeness.test.cjs`, adapting:
- import → `require("../scripts/evals/check.cjs")`; `REPO_ROOT = path.resolve(__dirname, "..")`.
- real-tree green-guard → `require(REPO_ROOT/evals/_shared/coverage-policy.json)`, assert `skillNames.length >= 1`.
- temp-tree CLI test → build `skills/orphan-skill/SKILL.md` + `evals/_shared/{coverage-policy.json, scenario.schema.json}` under the temp root and spawn `scripts/evals/check.cjs` with `EVALS_REPO_ROOT`.
Auto-discovered by the `test/*.test.cjs` glob → runs under `pnpm test` and is what makes the existing `test.yml` gate the eval layer end-to-end.

### 7. package.json
Add `"evals:check": "node scripts/evals/check.cjs"` (AO's exact script name).

### 8. CI (mirror AO) → `.github/workflows/evals.yml`
New workflow mirroring `test.yml`'s setup (checkout, `setup-node@v4` 24.14.0, corepack + pnpm 10.33.0, cache, `pnpm install --frozen-lockfile`) then `pnpm evals:check`. Triggers `pull_request → main` + `workflow_dispatch`. (The step-6 wrapper also gates evals inside `pnpm test`; the dedicated workflow matches AO's separate evals gate — intentional double coverage.)

### 9. Graph registration (full)
Edit `scripts/graph/build-graph.cjs` `typeOf` — `/^scripts\/(wiki|release|graph)\/.+\.cjs$/` → add `|evals` so `scripts/evals/check.cjs` becomes an `automation` node. (Fixture JSON and scenario JSON aren't walked → stay invisible; `test/evals-check.test.cjs` auto-classifies as a `test` node.)

### 10. Wiki capture (same delivery, per MECHANICS.md)
- New topic `wiki/topics/skill-evals.md` — `aliases: [skill eval scenarios, evals check, coverage policy]`, `covers: [scripts/evals/check.cjs, test/evals-check.test.cjs]` (node paths only — never the JSON, which would dangle and fail the graph gate). Current-state + a Decisions bullet dated 2026-07-21 citing issue #1.
- Journal `wiki/journal/2026-07-21-skill-eval-scenarios-and-ci.md` — Why / What changed (incl. ruled-out lighter native check) / Files. `pr: pending`, `issue:` #1.
- `wiki/INDEX.md` — one line for the new journal entry + one for the new topic.
- Archive this plan: `node scripts/wiki/archive-plan.cjs <this-plan>.md --status implemented` (writes `wiki/plans/2026-07-21-…md` + `plans/INDEX.md` row).
- Rebuild generated pages: `pnpm graph:build` (regenerates `scripts/graph/data/graph.json` + `wiki/connections/*.md`; never hand-edited).

## Critical files

- **Create:** `scripts/evals/check.cjs`, `scripts/evals/fixtures/invalid/*.json`, `evals/_shared/{coverage-policy.json,scenario.schema.json}`, `evals/README.md`, `evals/provision-sitecore-component/scenarios/*.json` (8), `test/evals-check.test.cjs`, `.github/workflows/evals.yml`, `wiki/topics/skill-evals.md`, `wiki/journal/2026-07-21-skill-eval-scenarios-and-ci.md`, `wiki/plans/2026-07-21-…md` (via script).
- **Edit:** `package.json` (script), `scripts/graph/build-graph.cjs` (classifier one-liner), `wiki/INDEX.md`, `plans/INDEX.md` (via script), regenerated `scripts/graph/data/graph.json` + `wiki/connections/*.md` (via `graph:build`).

## Reuse (don't reinvent)

- Validator, schema, fixtures, README, and the node:test wrapper are **ported**, not authored — the only net-new authoring is the 8 scenario JSON files + the single-skill coverage policy + tag vocab.
- Scenario `files` reference existing fixtures/skill docs (`test/fixtures/{datasource-card,page-fields,wrong-adapter}`, `skills/provision-sitecore-component/SKILL.md` + `references/*.md`).
- CI job mirrors the existing `test.yml` setup block verbatim.

## Verification (end-to-end)

1. `pnpm evals:check` → self-check section all `PASS`, then `PASS eval validation succeeded for 8 scenario(s) across 1 required skill suite(s)`.
2. `pnpm test` → all suites green, including new `test/evals-check.test.cjs`, `skills-lint`, `wiki`, and `graph` freshness (after `pnpm graph:build`).
3. **Negative proof (gate bites):** temporarily drop one `expected_behavior` from a scenario → confirm both `pnpm evals:check` and `pnpm test` FAIL with the coverage/schema error; restore.
4. **Graph fresh:** re-run `pnpm graph:build` → no diff (byte-fresh, so `graph.test.cjs` passes in CI).
5. Read-only review agent(s) over the diff per working agreement; report findings.

## Blast radius

- Graph classifier change alters `graph.json` + `wiki/connections/*.md` — contained by running `pnpm graph:build` (else `graph.test.cjs` fails; pre-commit also rebuilds).
- New `test/evals-check.test.cjs` runs under `pnpm test` — malformed scenarios fail the build (desired).
- `evals/README.md` sits outside `skills/`, so `skills-lint` is untouched; no skill docs edited.
- `evals.yml` is additive; existing gates unaffected.

## Handoff

Deliver as an uncommitted working tree. Suggested commit (Joe runs `pnpm commit` + push):

```
feat(evals): add skill-eval scenarios, validator, and CI gate

Port ai-orchestration's eval harness — schema + coverage validator with
self-check fixtures, 8 behavioral scenarios for the provision-sitecore-component
skill (happy-path, push-gate, boundary, retry-gate), a node:test wrapper, an
evals:check script, and a dedicated evals workflow. Registers scripts/evals in
the knowledge graph and captures the wiki entry.

Closes #1
```
