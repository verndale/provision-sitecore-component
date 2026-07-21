# Plan Audit

Every agent plan written for this repo, gathered from Claude plan stores, Codex sessions, and local plan files, with whether it actually shipped. Implemented and partial plans are archived here (linked); not-implemented, superseded, and out-of-scope plans are listed for the record and stay at their source on disk.

## Status legend

- **implemented** — substantially shipped (deltas noted in the archived file's `audit_note`).
- **partial** — a subset shipped; the rest never landed.
- **superseded** — replaced by a later plan before shipping as written.
- **not-implemented** — nothing shipped; may still be actionable.
- **not-verified** — auto-archived by the recovery backstop; needs a human status pass.

## Plans

| Date | Plan | Status | Evidence | Topics |
| --- | --- | --- | --- | --- |
| 2026-07-21 | [Plan: `provision-sitecore-component` — standalone repo (CLI + skill)](2026-07-21-plan-provision-sitecore-component-standalone-repo-cli-skill.md) | implemented | — | sitecore-provisioning |
| 2026-07-21 | [Add skill-eval scenarios + validator + CI (issue #1)](2026-07-21-add-skill-eval-scenarios-validator-ci-issue-1.md) | implemented | [PR #3](https://github.com/verndale/provision-sitecore-component/pull/3) | skill-evals |
| 2026-07-21 | [Add AGENTS.md and CLAUDE.md — Issue #2](2026-07-21-add-agents-md-and-claude-md-issue-2.md) | implemented | [PR #5](https://github.com/verndale/provision-sitecore-component/pull/5) | repo-tooling |

Totals: 3 implemented (3 plans).
