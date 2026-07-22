---
aliases: [knowledge graph, graph build, connections wiring map, node/edge graph, graph viewer, build-graph]
covers: [scripts/graph/build-graph.cjs, scripts/graph/routing.cjs, scripts/graph/serve.cjs]
---
# Knowledge graph — Design History

The repo's self-model: a typed node/edge graph derived deterministically from the files, rendered into the `wiki/connections/*` wiring map and an interactive viewer, and gated for freshness in CI. Ported from ai-orchestration and adapted to this repo's layout.

## Current state

- `pnpm graph:build` runs `scripts/graph/build-graph.cjs`, which walks a fixed root set (`skills/`, `src/`, `test/`, `scripts/`, `wiki/`, the four root docs, `setup.sh`) plus explicit-path hook config surfaces, and maps each file to a node type via `typeOf` — anything unmatched is dropped.
- Node types: `skill`, `skill-readme`, `reference`, `source`, `test`, `automation`, `hook`, `root-doc`, and the `wiki-{index,journal,topic,plan}` family. Edges are all latent in file content, never guessed: `links-to` (relative md links), `references` (a `SKILL.md` → its `references/` tree), `topic`/`plan`/`covers` (wiki frontmatter), `requires` (`.cjs` `require()` wiring), and `invokes` (a hook → the in-repo script it runs).
- Output is `scripts/graph/data/graph.json` — timestamp-free, sorted, byte-stable — so a rebuild only diffs when the content graph changes.
- The same builder renders the governance view: `wiki/connections.md` (index) + five section pages (`tests-source`, `skills-references`, `topics-runtime`, `seams`, `hooks`). The connections pages are excluded from the graph's own nodes so they never become self-referential mega-nodes.
- `scripts/graph/routing.cjs` + `routing-policy.json` give deterministic navigation (`why`/`wiring`/`impact` intents) — shortest-path over per-edge costs with a hub penalty, never inferring beyond existing edges; `scripts/wiki/navigate.cjs` is the agent entry point.
- `scripts/graph/serve.cjs` + `viewer/` serve an interactive Sigma.js viewer (`pnpm graph:view`, localhost:4173): node color = type, size = degree.
- Two write-time gates run in `build-graph.cjs` before it overwrites anything (dangling-edge check, wiki-topic coverage — every first-class `skill` must be covered by a topic), and `test/graph.test.cjs` re-asserts them plus byte-freshness of `graph.json` and every connections page under `pnpm test`. The `.husky/pre-commit` hook rebuilds + stages the graph so local commits never drift.

## Decisions

- 2026-07-21 — Modeled lifecycle hooks as first-class `hook` nodes with `invokes` edges (git, release, and agent PreToolUse guards → the scripts they run) and added a `connections/hooks.md` section ([PR #13](https://github.com/verndale/provision-sitecore-component/pull/13), [plan](../plans/2026-07-21-plan-model-lifecycle-hooks-as-first-class-knowledge-graph-no.md), [journal](../journal/2026-07-21-graph-hook-nodes.md)).
- 2026-07-21 — Promoted the root operating docs to `root-doc` nodes so `AGENTS.md`/`CLAUDE.md` enter the graph and surface as cross-subsystem seams ([PR #5](https://github.com/verndale/provision-sitecore-component/pull/5), [journal](../journal/2026-07-21-agents-and-claude-md.md)).
- 2026-07-21 — Ported the ai-orchestration knowledge graph into the initial tooling, adapting discovery to this repo's layout and wiring freshness into `pnpm test` ([PR #7](https://github.com/verndale/provision-sitecore-component/pull/7), [journal](../journal/2026-07-21-initial-cli-skill-and-repo-tooling.md)).

## Open threads

- The viewer assets (`viewer/*.js`, `.css`) and `routing-policy.json` are not walked, so they are not graph nodes; the viewer is not test-gated (visual only).
