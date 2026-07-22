---
date: 2026-07-21
topics: [repo-tooling, knowledge-graph]
plan: plans/2026-07-21-add-agents-md-and-claude-md-issue-2.md
pr: https://github.com/verndale/provision-sitecore-component/pull/5
---
# Agent operating docs (AGENTS.md, CLAUDE.md)

## Why

- The repo had no agent-facing operating brief; Claude Code / Codex / Cursor reverse-engineered its layout, commands, and boundaries from README + CONTRIBUTING + the skill on every run.
- Sibling repos (ai-orchestration, cumulative-conductor) already carry AGENTS.md as the canonical agent guide with CLAUDE.md re-exporting it; adopting the same shape keeps the toolchain consistent (issue #2).

## What changed

- Added AGENTS.md at the repo root as a pointer-brief — what it is (manifest → CMS + TSX), layout, commands, config/manifest/auth, hard boundaries, where to look next — linking into README, the skill references, and the wiki rather than duplicating them.
- Added CLAUDE.md that re-exports it (an `@AGENTS.md` import plus a link), matching the sibling-repo convention.
- Registered both in `ROOT_DOCS` in scripts/graph/build-graph.cjs (one line) so they index as `root-doc` nodes; rebuilt the graph — root-doc went 2 → 4, plus links-to/seam edges from AGENTS.md into the skill references and wiki.
- Boundary framing: the issue assumed all four named boundaries "already live in the skill and docs," but "no git mutations without owner sign-off" lived only in the global user config, not the repo. Wrote it as a deliver-and-handoff agent boundary (leave an uncommitted tree + a suggested Conventional Commits message; the owner does commit/push/merge/tag/release) matching the repo's real norm, rather than importing the personal absolute verbatim.
- Ruled out restating commands and contracts inline: kept AGENTS.md a brief that points into the existing docs, per the issue's don't-duplicate guidance.

## Files

- AGENTS.md, CLAUDE.md
- scripts/graph/build-graph.cjs (ROOT_DOCS), scripts/graph/data/graph.json + wiki/connections/seams.md (regenerated)

## Follow-ups

- repo-tooling is a classifier slug with no topic page yet; promote it to wiki/topics/repo-tooling.md once a second related entry exists (this is the first).
