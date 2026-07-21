# Contributing

## Setup

```bash
corepack enable
pnpm install
```

Node 24+ (`.nvmrc`), pnpm 10 via Corepack. `pnpm install` wires husky; the hooks run `@verndale/ai-commit` for commit-message lint and preparation.

## Workflow

1. Branch from `main`.
2. Make the change; keep the CLI runtime dependency-free (plain Node, no runtime deps).
3. `pnpm test` — everything must pass. If a planner/emitter change legitimately alters output, regenerate the golden files under `test/fixtures/*/expected*` with the tool itself and commit them with the change; never hand-edit a golden to quiet a diff.
4. Substantive change? Capture it in the context wiki in the same delivery (journal entry, plan archive if one was executed, topic Decisions bullet) per [wiki/MECHANICS.md](wiki/MECHANICS.md) — the pre-commit reminder and merge-sync stub are backstops, not the authoring path.
5. Commit with `pnpm commit` (Conventional Commits, enforced by commitlint in CI). Never commit secrets or `.env` — `.env.example` documents the variables.
6. Push. `.github/workflows/pr.yml` opens/updates a draft PR via `@verndale/ai-pr`; tests and commit lint run on the PR.

## Skills

Skill files under `skills/` follow the ai-orchestration authoring standard — the vendored spec lives at [skills/_meta/_skill-sections.md](skills/_meta/_skill-sections.md) and `test/skills-lint.test.cjs` enforces the checkable parts (frontmatter shape, body length, `## Contents` on long files, link hygiene). Don't edit the vendored `_meta` / `retry-contract.md` copies here; re-sync them from ai-orchestration.

## Agent guardrails

The repo's hard boundaries are mechanically enforced for Claude Code and Codex sessions: the checked-in [.claude/settings.json](.claude/settings.json) and [.codex/hooks.json](.codex/hooks.json) run `scripts/hooks/pretooluse-guard.cjs` as a PreToolUse hook (first use prompts a one-time hook/trust approval in each tool), husky's pre-commit/pre-push refuse agent-shell commits (`ALLOW_AGENT_COMMIT=1` is the human escape hatch), and the CLI itself gates `push` behind `--yes`/a TTY confirm. `setup.sh` additionally registers the same guard user-level so the skill's boundaries follow developers into consumer repos. Policy lives in `scripts/hooks/guard-core.cjs` and is pinned by `test/hooks.test.cjs` + `test/hooks-install.test.cjs` + `test/push-gate.test.cjs` — change guard and tests together. The guard is drift prevention for honest agents, not a sandbox; CI remains the backstop.

## Releases

semantic-release on `main`: Conventional Commits drive the version (`feat` → minor, `fix` → patch, breaking → major), CHANGELOG.md and the GitHub Release are generated, no npm publish. Don't bump versions by hand.
