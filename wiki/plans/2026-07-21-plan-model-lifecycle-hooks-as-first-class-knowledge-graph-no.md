---
status: implemented
executed: 2026-07-21
date: 2026-07-21
evidence: []
source_tool: claude
source: "/Users/joe.fusco/.claude/plans/for-the-graph-and-prancy-pnueli.md"
topics: []
---
# Plan — Model lifecycle hooks as first-class knowledge-graph nodes

## Context

**The question:** does the knowledge graph (+ generated `wiki/connections/*`) document the evals, validators, and hooks? Verdict from tracing `scripts/graph/build-graph.cjs`, the committed `graph.json`, and the connections pages:

- **Validators — already covered.** `src/validate-manifest.cjs` is a `source` node with 4 `requires` edges and renders in `wiki/connections/tests-source.md`; `scripts/evals/check.cjs` is an `automation` node. No work.
- **Evals — harness covered, data intentionally excluded.** The runner (`scripts/evals/check.cjs`), the gate (`test/evals-check.test.cjs`), and the design-history topic (`wiki/topics/skill-evals.md`) are graph nodes with edges. The scenario/fixture JSON is deliberately invisible (builder only walks `.md`/`.cjs`/`.sh`) and self-documented as such in `skill-evals.md:15`. **Decision (confirmed): leave as-is.**
- **Hooks — the real gap.** `.husky/*` and the `.releaserc.cjs` release chain appear only as prose in `wiki/MECHANICS.md`. No hook nodes, no edge type recording "a hook runs this script."

**This change** (confirmed scope: first-class nodes + edges) makes lifecycle hooks first-class graph citizens: a new `hook` node type and an `invokes` edge to each in-repo script a hook runs, plus a new connections section. Grounded, deterministic, consistent with the builder's existing philosophy ("derived from the files — no guessing").

## Pre-work (after plan approval, before any code)

1. **File the tracking issue** via the `github-issue-creator` skill on `verndale/provision-sitecore-component` — draft it, then get explicit go-ahead before `gh issue create` (never filed silently).
   - Classify as **Enhancement** (title prefix `[Enhancement]`) — a coverage gap, not a defect.
   - Labels: **`enhancement`** + **`area: wiki`** (the repo's exact-fit area label: "Context wiki and knowledge graph"). Both labels already exist.
   - Substance: the graph omits lifecycle hooks — `.husky/*` and `.releaserc.cjs` appear only as prose in `wiki/MECHANICS.md`, with no nodes and no edge type recording "a hook runs this script." Evidence: no `hook`/`invokes` in `scripts/graph/data/graph.json`; no hooks in any `wiki/connections/*` page. Fix = this plan.
2. **Branch from `main`** — `git switch -c feat/<issue#>-graph-hooks-in-graph main` (name carries the issue number once known; reorder with step 1 if you prefer branch-first). **Local branch only** — no push/PR (per working agreement; the repo owner owns remote VC actions).

Then proceed with the implementation below.

## Model

> **Scope update (mid-execution):** while planning, `main` advanced (PR #10 *skill-shipped-guardrails*) and this branch was cut from the updated main. That feature added an agent-guard hooks subsystem — `.husky/pre-push`, `.claude/settings.json`, `.codex/hooks.json`, and `scripts/hooks/*.cjs` (already `automation` nodes via the `evals|hooks` regex + a regenerated `graph.json`). It documented the guard *scripts* but not the hook *config surfaces* or any `invokes` relationship. Per user decision, scope is **all hook surfaces** (git + release + agent guards).

- **Node type `hook`** — seven config surfaces:
  `.husky/pre-commit`, `.husky/pre-push`, `.husky/commit-msg`, `.husky/prepare-commit-msg`, `.releaserc.cjs`, `.claude/settings.json`, `.codex/hooks.json`.
- **Edge type `invokes`** — `hook → in-repo script it runs`, parsed from the file itself (the captured `scripts/…​.cjs` path is resolved against known nodes; external tools yield no edge):
  - `.husky/pre-commit` → `scripts/hooks/agent-commit-guard.cjs`, `scripts/wiki/pre-commit-journal.cjs`, `scripts/graph/build-graph.cjs`
  - `.husky/pre-push` → `scripts/hooks/agent-commit-guard.cjs`
  - `.releaserc.cjs` → `scripts/release/semantic-release-structured-notes.cjs`
  - `.claude/settings.json` → `scripts/hooks/pretooluse-guard.cjs`
  - `.codex/hooks.json` → `scripts/hooks/pretooluse-guard.cjs`
  - `.husky/commit-msg`, `.husky/prepare-commit-msg` → `ai-commit` (external, no repo node) → **0 edges each**; degree-0 hook nodes documenting their existence (allowed — the integrity gate only checks edges *resolve*; coverage gate applies only to `skill` nodes).

Expected delta: **+7 nodes, +7 `invokes` edges** (verify against the rebuild; also confirm no unexpected `links-to`/seam edges appear from md that references these paths).

## Changes

### 1. `scripts/graph/build-graph.cjs` (core)

- **Constants** (near `ROOT_DOCS`/`AUTOMATION_FILES`, ~L37-40): add
  `const HOOK_FILES = new Set([".husky/pre-commit", ".husky/pre-push", ".husky/commit-msg", ".husky/prepare-commit-msg", ".releaserc.cjs", ".claude/settings.json", ".codex/hooks.json"]);`
- **Invoke regex** (near `REQUIRE_RE`, ~L42): `const HOOK_INVOKE_RE = /(scripts\/[A-Za-z0-9._/-]+\.cjs)/g;` — matches both `node scripts/…​.cjs` (husky) and the `'./scripts/…​.cjs'` plugin path (releaserc).
- **`typeOf(r)`** (top, after the `ROOT_DOCS`/`AUTOMATION_FILES` checks, ~L87): `if (HOOK_FILES.has(r)) return "hook";` — required so `.releaserc.cjs` (which matches no existing pattern) and the extensionless husky files classify.
- **`build()` file discovery** (~L167): the generic `walk()` can't reach these (dot-dir + extensionless), so append them by explicit path with an existence guard:
  ```js
  const hookFiles = [...HOOK_FILES].map((h) => path.join(repoRoot, h)).filter((abs) => fs.existsSync(abs));
  const absFiles = [...new Set([...roots.flatMap((rt) => walk(rt, [".md", ".cjs", ".sh"])), ...hookFiles])];
  ```
- **`build()` edge pass** (new step 7, after `requires`, ~L264): iterate `fileText`, for `type === "hook"` nodes emit an `invokes` edge per `HOOK_INVOKE_RE` match that resolves to a known node (`nodes.has(target)`), guarding `target !== id`.
- **`renderConnections()`** (~L403): add a `hooksScripts()` section renderer (mirrors `testsSource()` — list each `hook` node and its `invokes` targets; "delegates to external tooling (no in-repo script)" when none); register it as `[`${CONNECTIONS_DIR_ID}/hooks.md`]` in the returned object (~L439); add its bullet to `index()` (~L431).
- **Doc-comment sync**: update the node/edge enumeration in the top-of-file header (L8-19) to include `hook`/`invokes`, and the "four per-section files" comment (L335) → "five".

### 2. `scripts/graph/routing-policy.json` (mandatory)

Add `"invokes": 1` to `edgeCosts`. **Required** — `policyProblems()` asserts every graph edge type has a cost, so the routing-policy test in `pnpm test` fails without it. (A new *node* type needs no policy entry; adding `hook` to an intent's preferred types is optional — deferred, since documenting via nodes + connections page meets the goal.)

### 3. `scripts/graph/viewer/viewer.js` (polish; not test-gated)

Add `hook` to `TYPE_COLORS` (a distinct unused hue, e.g. `"#b58b5a"`) and `TYPE_LABELS` (`"Hook"`), and `invokes` to `EDGE_COLORS`. Without these, hook nodes still render (fallback gray `#888`) and `invokes` edges render dim — non-breaking, but the legend won't name them.

### 4. Hand-authored wiki prose (doc-freshness)

`wiki/INDEX.md` (L11, L38) and `wiki/MECHANICS.md` (L47) enumerate the four connections sections; add the hooks section so they aren't stale. Safe: links to `connections/hooks.md` create no edges (the connections view is excluded from nodes); only these pages' `bytes` change, absorbed by the rebuild.

### 5. Regenerate + wiki capture

- `pnpm graph:build` — regenerates `scripts/graph/data/graph.json` and **all** connections pages (now incl. `wiki/connections/hooks.md`). Never hand-edit these.
- Journal entry `wiki/journal/2026-07-21-graph-hook-nodes.md` (per `wiki/MECHANICS.md` capture protocol) recording why hooks became first-class and what changed. No topic covers the graph today, so the journal carries the thread; optionally seed a `knowledge-graph` topic later (defer).

## What could break (blast radius)

- **routing-policy** — omitting `edgeCosts.invokes` fails `pnpm test` (the one hard dependency; called out above).
- **`.releaserc.cjs` now a `.cjs` node** — the existing `requires` pass will scan it; it has no relative `require()` calls, so no spurious edges (verified).
- **Golden freshness** — `graph.json` + connections bytes change; the freshness test enforces that a rebuild was run and committed alongside. The `.husky/pre-commit` hook auto-rebuilds+stages locally; CI just verifies.
- No change to validators or eval handling; no deletion/rename of anything (add-only).

## Verification (end-to-end)

1. `pnpm graph:build` — confirm the printed counts show `hook=4` and an `invokes` edge line (expect 3). 
2. Open `wiki/connections/hooks.md` — the four hooks listed; `pre-commit` → journal + graph builder, `.releaserc.cjs` → structured-notes plugin, the two commit-msg hooks marked as external.
3. `pnpm test` — full suite green, especially: graph.json byte-fresh, all **five** connections pages byte-fresh, every edge endpoint resolves, routing policy valid, plus skills-lint / evals gate unaffected.
4. `pnpm graph:view` (optional) — hook nodes appear with a legend swatch + `invokes` edges (if step 3/viewer polish applied).

## Critical files

- `scripts/graph/build-graph.cjs` — node type, edge pass, connections section (primary)
- `scripts/graph/routing-policy.json` — `invokes` edge cost (mandatory)
- `scripts/graph/viewer/viewer.js` — legend polish
- `wiki/INDEX.md`, `wiki/MECHANICS.md` — section-list freshness
- Generated (rebuild, don't edit): `scripts/graph/data/graph.json`, `wiki/connections.md`, `wiki/connections/hooks.md`
- New: `wiki/journal/2026-07-21-graph-hook-nodes.md`

## Handoff

Work happens on the `feat/…` branch created in pre-work; deliver as an uncommitted working tree. Suggested Conventional Commit:

`feat(graph): model git and release hooks as first-class nodes with invokes edges`

with a `Closes #<issue>` footer referencing the tracking issue. (Per working agreement: I create the local branch and file the issue on request, but no commit/push/merge/tag/PR/release or memory writes — those stay with the repo owner.)
