# Context Wiki

Why this repo is the way it is: executed plans, decisions, and change history. Read this index first; open only the pages it routes to.

## How to navigate

1. "Why is X like this / what's the design of X" → match X in Topics below; open that one page.
2. "What changed when / history of X" → scan the Journal lines below; open only matching entries.
3. "Was plan X implemented / what plans exist" → [plans/INDEX.md](plans/INDEX.md) is the audit table; archived plan files sit next to it.
4. Full plan detail behind a change → follow the plan link inside the journal entry or topic page.
5. "How does X wire to the rest / what exercises or historically explains X" → [connections.md](connections.md), a small index over the generated wiring map; open the one section it routes to — [tests↔source](connections/tests-source.md), [skill→references](connections/skills-references.md), [topics↔runtime](connections/topics-runtime.md), [cross-subsystem seams](connections/seams.md), or [hooks↔scripts](connections/hooks.md). `pnpm graph:view` serves the interactive graph viewer.
6. Cross-system "why", wiring, or impact question → agents silently use `scripts/wiki/navigate.cjs` (`--intent why|wiring|impact --query <term>`) before reading files; it returns a deterministic, minimal itinerary or reports an ambiguity. Developers do not need to run or remember this utility.
7. No index hit or no route → grep `wiki/` for the term; then fall back to `git log` / `gh`. Never load the whole wiki.

Writing protocol (when to capture, templates, automation): [MECHANICS.md](MECHANICS.md).

## Topics

<!-- One line per topic page: [Title](topics/<slug>.md) — hook. Keep alphabetical by slug. -->

- [Knowledge graph](topics/knowledge-graph.md) — the repo's typed node/edge self-model, rendered into the connections wiring map and interactive viewer and gated fresh in CI.
- [Sitecore component provisioning](topics/sitecore-provisioning.md) — one reviewed manifest driving both the CMS items (Authoring API, add-only reconcile) and the front-end TSX handoff scaffold.
- [Skill evals](topics/skill-evals.md) — behavioral eval scenarios that guard the skill's push gate, repair loop, and boundaries, validated for schema + coverage and gated in CI.

## Journal

<!-- One line per entry, newest first: - YYYY-MM-DD — [Title](journal/<file>.md) — hook. -->

- 2026-07-22 — [Read-tool .env guard](journal/2026-07-22-read-tool-env-guard.md) — the harness Read tool joins Bash readers and edit tools under the .env secret-read policy: consumer-repo .env and the central credential file deny via a new Claude Read matcher.
- 2026-07-21 — [Codex PreToolUse live compatibility](journal/2026-07-21-codex-pretooluse-compatibility.md) — current Codex hook payloads, unsupported ask semantics, exact-hash trust, and git-root launch behavior are reflected in the guard and installer.
- 2026-07-21 — [Lifecycle hooks as first-class knowledge-graph nodes](journal/2026-07-21-graph-hook-nodes.md) — git, release, and agent PreToolUse hook configs become hook nodes with invokes edges to the scripts they run, surfaced in a generated connections/hooks.md page.
- 2026-07-21 — [Skill-shipped guardrails (Claude Code + Codex)](journal/2026-07-21-skill-shipped-guardrails.md) — the skill's hard boundaries became mechanical: a shared PreToolUse guard installed by setup.sh for both tools, a CLI push confirmation, husky agent-commit blocks, and a per-machine credential bootstrap.
- 2026-07-21 — [Agent operating docs (AGENTS.md, CLAUDE.md)](journal/2026-07-21-agents-and-claude-md.md) — a root-level AGENTS.md brief plus a CLAUDE.md that re-exports it, indexed into the knowledge graph as root-doc nodes.
- 2026-07-21 — [Skill eval scenarios and CI](journal/2026-07-21-skill-eval-scenarios-and-ci.md) — ported ai-orchestration's scenario-eval harness (validator + policy + 8 scenarios) and wired it into CI so a skill-behavior regression fails the build.
- 2026-07-21 — [Initial CLI, skill, and repo tooling](journal/2026-07-21-initial-cli-skill-and-repo-tooling.md) — the manifest-driven provisioning tool, its skill, tests, and the ai-commit/ai-pr/semantic-release/wiki tooling, in one delivery.

## Plans

- [plans/INDEX.md](plans/INDEX.md) — the audit table of every agent plan and whether it shipped.

## Connections

- [connections.md](connections.md) — the generated wiring map (index + per-section pages under `connections/`). Machine-rendered from the knowledge graph; never hand-edited.
