---
date: 2026-07-22
topics: [sitecore-provisioning]
plan: plans/2026-07-22-deny-hand-edits-to-generated-slug-plan-json-plan-artifacts.md
pr: https://github.com/verndale/provision-sitecore-component/pull/24
---
# Plan-artifact edit guard

## Why

- `<slug>.plan.json` is part of the review artifact the developer approves at the SKILL.md step-6 gate, but `decideFile` had no rule for it — agents could "fix" the plan file instead of the manifest and present a doctored artifact at the gate.
- Scoping correction made during planning: this is **not** a push bypass. Every CLI mode rebuilds the plan in-memory from the manifest and rewrites the file (`src/cli.cjs` plan/check/push path); `push` never reads the plan file back. The protected property is gate-review artifact integrity, and hand-edits are futile anyway (overwritten on the next run) — so the deny costs nothing legitimate ([issue #23](https://github.com/verndale/provision-sitecore-component/issues/23)).

## What changed

- New `REASONS.planEdit` + `decideFile` rule in `guard-core.cjs`: deny edit-tool writes when the resolved basename ends with `.plan.json`, in the tool repo and provisioning repos; plain repos untouched (scope-model parity with the `.env` rules).
- `endsWith(".plan.json")` keeps goldens (`expected-plan.json`, hyphen — still denied as goldens in fixtures) and a bare `plan.json` out of scope; nested paths covered. `decideRead` deliberately unchanged — plans must stay readable for gate review.
- No adapter/matcher/installer changes: the rule flows through the already-registered `Edit|MultiEdit|Write|NotebookEdit` matchers, so existing user-level installs pick it up without re-registration.
- Prose aligned for unhooked tools (Cursor): AGENTS.md generated-files bullet + a SKILL.md guardrail line.

## Files

- scripts/hooks/guard-core.cjs
- test/hooks.test.cjs
- AGENTS.md, skills/provision-sitecore-component/SKILL.md

## Follow-ups

- Candidate CLI-side complement (not filed): warn at `check`/`push` when an on-disk plan.json differs from the freshly built plan, making drift visible to the human.
