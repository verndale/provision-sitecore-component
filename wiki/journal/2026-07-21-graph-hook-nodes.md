---
date: 2026-07-21
topics: []
plan: plans/2026-07-21-plan-model-lifecycle-hooks-as-first-class-knowledge-graph-no.md
pr: pending
---
# Lifecycle hooks as first-class knowledge-graph nodes

## Why

- The knowledge graph documented source modules, tests, the skill, validators, and the eval harness — but not the repo's lifecycle hooks. Git hooks (`.husky/*`), the release chain (`.releaserc.cjs`), and the agent PreToolUse guards (`.claude/settings.json`, `.codex/hooks.json`) lived only as prose in `wiki/MECHANICS.md`, with no node and no edge recording that a hook runs a given script (issue #12).
- The skill-shipped-guardrails work (PR #10) had just added the guard *scripts* under `scripts/hooks/` as `automation` nodes but left the hook *config surfaces* and their wiring invisible — so "what actually runs `pretooluse-guard.cjs`" wasn't answerable from the graph.

## What changed

- New `hook` node type + `invokes` edge in `scripts/graph/build-graph.cjs`. Seven config surfaces become nodes (`.husky/{pre-commit,pre-push,commit-msg,prepare-commit-msg}`, `.releaserc.cjs`, `.claude/settings.json`, `.codex/hooks.json`), included by explicit path since `walk()` skips dot-dirs, extensionless, and JSON files.
- `invokes` edges are parsed from each file's own text (`HOOK_INVOKE_RE` captures the `scripts/….cjs` path a hook names) — grounded like every other edge. External tooling (`ai-commit`) yields no match, so `commit-msg`/`prepare-commit-msg` are degree-0 hook nodes. Delta: +7 hook nodes, +7 `invokes` edges (plus 2 previously-dangling `CONTRIBUTING.md` links that resolve now that the two config files are nodes).
- New generated section `wiki/connections/hooks.md` wires each hook to the script(s) it runs — e.g. `.claude/settings.json` + `.codex/hooks.json` → `pretooluse-guard.cjs`; `.husky/pre-commit` → `agent-commit-guard.cjs`, `pre-commit-journal.cjs`, `build-graph.cjs`; `.releaserc.cjs` → `semantic-release-structured-notes.cjs`.
- Supporting ripple: an `invokes` cost in `scripts/graph/routing-policy.json` (the routing-policy test fails without a cost for every live edge type); `hook`/`invokes` entries in the viewer legend; and the connections-section lists in `wiki/INDEX.md`, `wiki/MECHANICS.md`, and the `README.md` graph blurb.
- Ruled out: pulling eval scenario/fixture JSON into the graph (kept intentionally invisible — see the skill-evals topic) and splitting `hook` into git/release/agent subtypes (one type carries all seven surfaces).

## Files

- scripts/graph/build-graph.cjs, scripts/graph/routing-policy.json, scripts/graph/viewer/viewer.js
- wiki/INDEX.md, wiki/MECHANICS.md, README.md
- generated (via `pnpm graph:build`): scripts/graph/data/graph.json, wiki/connections.md, wiki/connections/hooks.md

## Follow-ups

- No topic covers the graph/wiki tooling itself; a `knowledge-graph` topic would give `build-graph.cjs` explicit design-history coverage. Deferred.
