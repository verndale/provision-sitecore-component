---
date: 2026-07-22
topics: [sitecore-provisioning]
plan: plans/2026-07-22-close-the-read-tool-env-gap-in-the-pretooluse-guard.md
pr: https://github.com/verndale/provision-sitecore-component/pull/21
---
# Read-tool .env guard

## Why

- The PreToolUse guard policed `.env` access for Bash reader programs (`decideEnvRead`) and edit tools (`decideFile`), but the harness `Read` tool was never matched — no `Read` matcher registered, no read branch in `evaluate()`.
- In a consumer provisioning repo, Claude's Read tool could open `.env` unguarded; the central credential file `~/.config/provision-sitecore-component/.env` was readable from any cwd. The checked-in `permissions.deny: Read(./.env)` covers only this repo.
- The gap was known-and-pinned: the adapter pass-through test asserted `Read` of `.env` returned null ([issue #20](https://github.com/verndale/provision-sitecore-component/issues/20)).

## What changed

- `decideRead(filePath, ctx)` in `guard-core.cjs`, mirroring the established scope model: central credential file denied everywhere; `.env` denied in the tool repo (repo-relative exact match) and provisioning repos (exact-basename match, keeping `.env.example` readable); plain repos untouched.
- `READ_TOOLS` set + branch in the adapter, reusing `filePaths()`. Codex intentionally unchanged: it has no read tool — reads go through shell, already covered by the Bash rules.
- Third Claude matcher `Read` in `install.cjs` MATCHERS and the checked-in `.claude/settings.json` (lockstep, pinned by the matcher-parity test).
- Ruled out a substring/regex match on the path: Read passes one real path, so exact path/basename checks avoid false positives on `.env.example` or docs mentioning `.env`.

## Files

- scripts/hooks/guard-core.cjs
- scripts/hooks/pretooluse-guard.cjs
- scripts/hooks/install.cjs
- .claude/settings.json
- test/hooks.test.cjs, test/hooks-install.test.cjs

## Follow-ups

- Existing user-level registrations pick up the new matcher only after re-running `node scripts/hooks/install.cjs claude` (or `bash setup.sh claude`) — worth a release-note line.
