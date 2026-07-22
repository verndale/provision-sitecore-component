---
status: implemented
executed: 2026-07-21
date: 2026-07-21
evidence:
  - "Issue #17"
  - "PR #18 https://github.com/verndale/provision-sitecore-component/pull/18 (merged 2026-07-22)"
source_tool: codex
source: "codex-session:019f8741-cb50-7f52-9542-a54b0ec7b4bb#372:1:1:9937d534aad2"
topics: [sitecore-provisioning]
---

# Fix Codex PreToolUse Enforcement and Track the Bug

## Summary

File the approved GitHub bug, create an issue-numbered branch before editing, then update the guard to the current Codex hook contract. Codex will deny unconfirmed provisioning pushes, recognize canonical Bash/apply-patch payloads, resolve project hooks from the Git root, and clearly require hook review. Claude Code behavior and the CLI interface remain unchanged.

## Delivery Setup

- Using the `github-issue-creator` skill, file the approved issue unchanged in `verndale/provision-sitecore-component` with title `[Bug] Codex PreToolUse guard is not enforced in live sessions`; add no labels.
- Capture the returned issue number and URL.
- Confirm the working tree is clean and still on `main`, then create and switch to `codex/issue-<number>-codex-pretooluse-hooks`.
- Perform no repository edits before the branch exists. Leave the completed work uncommitted for owner handoff.

## Implementation Changes

- Make the adapter platform-aware via `--platform codex|claude`; installed and checked-in hooks pass it explicitly, while payload-based inference supports older installations.
- Preserve Claude’s push prompt. For Codex, deny `push` without `--yes`, allow `push --yes`, and explain that `--yes` represents the approved skill step-6 gate. Do not use `PermissionRequest`, because it cannot create an approval prompt.
- Read canonical Codex inputs: `tool_name: "Bash"` and `tool_name: "apply_patch"`, with both commands and patches supplied through `tool_input.command`; retain legacy fallbacks.
- Use exact Codex matchers `^Bash$` and `^apply_patch$`. Resolve the checked-in project guard through `git rev-parse --show-toplevel`; retain absolute paths for user-level installation.
- Update setup output to require a restart/new task and `/hooks` review whenever the installed hook definition changes.
- Correct README, contributor, and agent guidance: Codex denies pushes lacking `--yes`, Claude can prompt, untrusted hooks are skipped, and hooks are defense-in-depth rather than a complete enforcement boundary. Follow the current [official Codex hooks contract](https://developers.openai.com/codex/hooks).

## Tests and Live Verification

- Add canonical Codex Bash and `apply_patch` payload tests, including protected-file denial through `tool_input.command`.
- Test that Claude returns `ask`, Codex denies an unconfirmed push, Codex allows the same CLI invocation with `--yes`, and direct executor bypasses remain denied.
- Extend installer/config tests for exact matchers, platform arguments, Git-root resolution, idempotent installation, and trust/restart guidance.
- Run `pnpm test`, `pnpm evals:check`, and `pnpm graph:build`; confirm only intended files changed.
- After `bash setup.sh codex`, hook review, and a fresh Codex task, repeat the live checks:
  - commit denied;
  - push without `--yes` denied;
  - protected `apply_patch` denied;
  - status and README read allowed;
  - `push test/fixtures/invalid/bad-version.json --yes` passes the hook but stops safely at validation before credentials or network.

## Documentation and Assumptions

- Archive this implemented plan, add a wiki journal entry referencing the GitHub issue, update the Sitecore-provisioning topic, and regenerate connection pages.
- Do not modify `~/.codex` automatically during implementation; the owner activates the user-level layer through setup and hook review.
- The broken standalone `codex` executable is outside this repository; live verification can use Codex Desktop, with CLI reinstall handled separately if needed.
- Keep the established honest-agent model: the CLI gate, Husky, sandbox, and CI remain independent backstops.
