---
date: 2026-07-21
topics: [sitecore-provisioning]
plan: plans/2026-07-21-ship-guardrails-credential-bootstrap-with-the-skill-claude-c.md
pr: pending
---
# Skill-shipped guardrails (Claude Code + Codex) and credential bootstrap

## Why

- Four hard boundaries were prose-only at runtime — the step-6 push gate, deliver-and-handoff, secrets-never-echoed, and the vendored do-not-edit paths; the evals pin them in corpus form only (issue #9).
- Devs run the skill from Claude Code or Codex in arbitrary consumer repos, so enforcement has to travel with the skill rather than live only in this repo.
- Verified 2026-07 against current docs: Codex now ships a hooks engine mirroring Claude Code's (PreToolUse, permissionDecision deny/ask, user `~/.codex/hooks.json` plus a trust-gated project `.codex/` layer) — one policy core with two thin adapters became feasible. Sources: learn.chatgpt.com/docs/hooks, learn.chatgpt.com/docs/config-file/config-reference.
- The `.env` story had no setup path: the CLI read only `./.env` at the invocation cwd and nothing helped a dev create it.

## What changed

- `scripts/hooks/guard-core.cjs` — context-scoped policy: provisioning `push` → ask everywhere; `SITECORE_AUTHORING_*`/`.env` secret reads → deny; git mutations (the documented deliver-and-handoff set) and generated/vendored/golden edits → deny in this repo only, so consumer repos keep their own commit policy.
- `scripts/hooks/pretooluse-guard.cjs` — one adapter for both payload shapes (Claude string commands; Codex argv arrays and apply_patch patch text); fail-open on malformed input, always exit 0.
- `scripts/hooks/install.cjs` + `setup.sh` — user-level registration (idempotent by command-path suffix, atomic writes, aborts on an unparseable config, `--uninstall` removes exactly ours) plus a one-time credential bootstrap writing `~/.config/provision-sitecore-component/.env` (600, values never echoed).
- `src/cli.cjs` — `push` is confirmation-gated before any credential load: TTY y/N, or `--yes` non-interactively as the recorded step-6 approval; `loadDotEnv` falls back to the central credential file after `./.env`.
- Husky `pre-commit`/`pre-push` refuse agent-shell commits via env fingerprints (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CODEX_SANDBOX*`, `CODEX_PROXY_CERT`; `ALLOW_AGENT_COMMIT=1` is the human escape hatch). Known hole: Codex danger-full-access shells set none of these.
- Checked-in `.claude/settings.json` and `.codex/hooks.json` cover contributors to this repo without setup.sh (`.gitignore` negations re-include exactly those two files); `test/hooks.test.cjs`, `test/hooks-install.test.cjs`, and `test/push-gate.test.cjs` pin the policy, the installer safety properties, and the CLI gate.
- Ruled out: a Cursor adapter (no hook surface — prose remains its only layer), `.codex/rules` (documented experimental), user-level `permissions.deny` for `.env` (would police unrelated repos), and keeping `.env` per-repo-only (no bootstrap story).

## Files

- scripts/hooks/{guard-core,pretooluse-guard,install,agent-commit-guard}.cjs
- .claude/settings.json, .codex/hooks.json, .husky/{pre-commit,pre-push}, .gitignore, setup.sh
- src/cli.cjs, skills/provision-sitecore-component/{SKILL.md,references/authoring-api.md}, README.md, .env.example
- test/{hooks,hooks-install,push-gate}.test.cjs

## Follow-ups

- Codex matcher names, "ask" support, and the project-hook launch cwd are pinned to our config shape but unverified against a live Codex session. The checked-in `.codex/hooks.json` launches the guard by a relative path (Claude uses `$CLAUDE_PROJECT_DIR`); if Codex runs project hooks from a cwd other than the repo root it fails to resolve, and the guard silently stops firing there. A mismatch fails open — the CLI `--yes` gate and Codex's own sandbox network approval still hold. Verify at first live use.
- Codex cloud platform-side commits likely bypass husky (undocumented upstream) — empirical check pending.
- The central credential file is protected against shell reads (cat/grep/cp) but not against the harness Read tool, which the PreToolUse matcher does not fire for; only the repo `./.env` is in `permissions.deny`. Honest-agent exposure is low (no task reason to read it) but it is a real gap — candidate fix: add the central path to `permissions.deny` or route read-like tools through the guard.
- `push` on a pty-backed agent shell without `--yes` waits on the confirm prompt rather than failing fast; the documented flow always passes `--yes` after the step-6 gate, so this only bites out-of-flow automation.
- Candidate follow-up: a CI hash-pin test for the vendored files (`skills/_meta/*`, `references/retry-contract.md`) to close the last tool-agnostic gap.
