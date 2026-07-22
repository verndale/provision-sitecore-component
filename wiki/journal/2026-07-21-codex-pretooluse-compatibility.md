---
date: 2026-07-21
topics: [sitecore-provisioning]
plan: plans/2026-07-21-fix-codex-pretooluse-enforcement-and-track-the-bug--9937d534aad2.md
pr: pending
---
# Codex PreToolUse live compatibility

## Why

- An authorized live self-test proved that the pure guard returned the expected decisions while Codex Desktop shell and edit calls were not reliably intercepted; the failure is tracked in [issue #17](https://github.com/verndale/provision-sitecore-component/issues/17).
- Current Codex hooks reject `permissionDecision: "ask"`, require explicit exact-hash trust for non-managed definitions, and report canonical `apply_patch` content through `tool_input.command` — assumptions the original adapter did not fully model.
- The checked-in Codex hook used a cwd-relative script path, so starting a task below the repo root could fail to launch the guard.

## What changed

- Hook registrations now pass `--platform claude|codex`; legacy entries infer the platform from Codex-specific payload fields and tool names.
- Claude Code retains the interactive push ask. Codex denies `push` without `--yes`, allows the CLI form only when `--yes` records the skill's step-6 approval, and denies direct executor bypasses.
- Canonical Codex `Bash` and `apply_patch` payloads are covered, including patch extraction from `tool_input.command`; legacy payload aliases remain compatible.
- Codex matchers now use the documented `^Bash$` / `^apply_patch$` names, and the project hook resolves the guard from `git rev-parse --show-toplevel`.
- Setup and contributor guidance now require a new task/restart plus `/hooks` review after definition changes, and describe hooks as defense-in-depth alongside the CLI, Husky, sandbox, and CI.
- Ruled out `PermissionRequest`: it can decide an approval Codex is already about to show, but it cannot create the missing provisioning gate prompt.

## Files

- scripts/hooks/{guard-core,pretooluse-guard,install}.cjs, setup.sh
- .codex/hooks.json, .claude/settings.json
- test/{hooks,hooks-install}.test.cjs
- README.md, CONTRIBUTING.md, AGENTS.md

## Follow-ups

- After rerunning `bash setup.sh codex`, start a fresh Codex task, trust the current definitions through `/hooks`, and repeat the live deny/allow probes.
- The machine's standalone `codex` executable currently fails with a missing packaged binary; reinstalling that CLI is an environment task outside this repository change.
