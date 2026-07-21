# Connections — Hooks and the scripts they run

Each git hook (`.husky/`), the release hook chain (`.releaserc.cjs`), and the agent PreToolUse guards (`.claude/settings.json`, `.codex/hooks.json`) — and the in-repo scripts it invokes.

Part of the [wiring map](../connections.md), generated from the knowledge graph — **do not edit by hand**. Rebuilt on every `pnpm graph:build` and verified fresh by `pnpm test`.

- [settings.json](../../.claude/settings.json) → [pretooluse-guard.cjs](../../scripts/hooks/pretooluse-guard.cjs)
- [hooks.json](../../.codex/hooks.json) → [pretooluse-guard.cjs](../../scripts/hooks/pretooluse-guard.cjs)
- [commit-msg](../../.husky/commit-msg) — delegates to external tooling (no in-repo script)
- [pre-commit](../../.husky/pre-commit) → [build-graph.cjs](../../scripts/graph/build-graph.cjs), [agent-commit-guard.cjs](../../scripts/hooks/agent-commit-guard.cjs), [pre-commit-journal.cjs](../../scripts/wiki/pre-commit-journal.cjs)
- [pre-push](../../.husky/pre-push) → [agent-commit-guard.cjs](../../scripts/hooks/agent-commit-guard.cjs)
- [prepare-commit-msg](../../.husky/prepare-commit-msg) — delegates to external tooling (no in-repo script)
- [.releaserc.cjs](../../.releaserc.cjs) → [semantic-release-structured-notes.cjs](../../scripts/release/semantic-release-structured-notes.cjs)
