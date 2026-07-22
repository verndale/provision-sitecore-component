---
status: implemented
executed: 2026-07-22
date: 2026-07-22
evidence:
  - "Issue #20"
source_tool: claude
source: "/Users/joe.fusco/.claude/plans/what-do-the-hooks-golden-torvalds.md"
topics: [sitecore-provisioning]
---
# Close the Read-tool `.env` gap in the PreToolUse guard

## Context

The PreToolUse guard polices `.env` access two ways today: Bash reader programs
(`cat`, `grep`, `cp`, …) via `decideEnvRead`, and edit tools via `decideFile`. But the
harness **Read tool is never matched**: `install.cjs` registers only `Bash` +
`Edit|MultiEdit|Write|NotebookEdit` matchers for Claude, and `evaluate()` has no read
branch. The checked-in `permissions.deny: Read(./.env)` covers only *this* repo's
`.claude/settings.json`. Result: in a **consumer provisioning repo**, Claude's Read tool
can open `.env` (and the central credential file `~/.config/provision-sitecore-component/.env`
from anywhere) with no guard — secrets enter the transcript, violating the
"secrets never echoed" hard boundary. The gap is known-and-pinned:
`test/hooks.test.cjs:440` asserts Read of `.env` passes through.

## Problem

The Read tool bypasses the `.env` secret-read policy that Bash and edit tools already
enforce. Root cause: no `Read` matcher registered, no read decision in `guard-core.cjs`,
no READ_TOOLS branch in the adapter.

## Files

- `scripts/hooks/guard-core.cjs` — add `decideRead()`
- `scripts/hooks/pretooluse-guard.cjs` — add `READ_TOOLS` + wire into `evaluate()`
- `scripts/hooks/install.cjs` — add `"Read"` to `MATCHERS.claude`
- `.claude/settings.json` — add third PreToolUse entry (matcher `Read`)
- `test/hooks.test.cjs` — new decision-class tests; update the line-440 pass-through test
- `test/hooks-install.test.cjs` — installer entry-count expectations (claude 2 → 3)
- `wiki/journal/2026-07-22-read-tool-env-guard.md` — journal entry per MECHANICS.md
- `.codex/hooks.json` — **unchanged** (Codex has no read tool; reads go through shell,
  already guarded)

## Assumptions

- Claude Code fires PreToolUse with `tool_name: "Read"` matched by a `"Read"` matcher —
  standard hook behavior; high confidence. **Load-bearing.**
- No legitimate agent workflow needs Read on `.env` in tool/provisioning repos —
  already asserted by `REASONS.envRead` ("`check` names missing variables without
  exposing them").
- `.env.example` must stay readable everywhere (exact-basename `.env` match preserves it).
- Scope model parity with `decideFile`/`decideEnvRead`: central file denied everywhere;
  `.env` denied only in tool/provisioning repos; plain repos untouched.

## What could break

- Over-broad matching could block reading `.env.example` or docs mentioning `.env` —
  avoided by exact path/basename checks (no substring regex; Read passes one real path).
- `test/hooks.test.cjs:592` deep-equals checked-in `.claude/settings.json` matchers
  against `installer.MATCHERS.claude` — both must change in lockstep or `pnpm test` fails.
- Existing user-level registrations won't pick up the new matcher until re-run of
  `node scripts/hooks/install.cjs claude` (or `setup.sh claude`) — note as journal follow-up.
- Fail-open contract unchanged; a `decideRead` crash still exits 0.

## Smallest fix

0. **Issue + branch first**
   - File an `[Enhancement]` GitHub issue via the `github-issue-creator` skill
     (draft confirmed in-chat before creation, per the skill's contract): Read-tool
     `.env` gap in the PreToolUse guard, consumer-repo + central-credential-file
     exposure, proposed fix summary.
   - Create a working branch off `main` named after the issue, matching repo
     convention (`codex/issue-17-…`): `git switch -c claude/issue-<N>-read-tool-env-guard main`.
     Branch creation only — commits/pushes stay owner-only per deliver-and-handoff.
1. **`guard-core.cjs`** — add + export `decideRead(filePath, ctx)`, mirroring
   `decideFile`'s resolution and the established scope model:
   - `path.resolve(ctx.cwd, filePath)`; deny `REASONS.envRead` when resolved ===
     `centralEnvFile()` (every repo)
   - `ctx.inToolRepo` && repo-relative path === `.env` → deny `REASONS.envRead`
   - `ctx.inProvisioningRepo` && basename === `.env` → deny `REASONS.envRead`
   - otherwise `null` (allow) — `.env.example` and plain repos unaffected
2. **`pretooluse-guard.cjs`** — add
   `READ_TOOLS = new Set(["read", "notebookread", "read_file", "open_file", "view_file"])`
   (liberal-alias style of EDIT_TOOLS); in `evaluate()`, for READ_TOOLS reuse
   `filePaths()` and return first `core.decideRead()` hit. Export `READ_TOOLS`;
   update header comment.
3. **`install.cjs`** — `MATCHERS.claude = ["Bash", "Edit|MultiEdit|Write|NotebookEdit", "Read"]`.
   Codex matchers unchanged.
4. **`.claude/settings.json`** — third PreToolUse entry, matcher `"Read"`, same
   `$CLAUDE_PROJECT_DIR` command.
5. **`test/hooks.test.cjs`** (policy + tests land together per AGENTS.md):
   - `decideRead` units: deny `.env` in `ctxTool`/`ctxProv`/`ctxBuild` (relative +
     absolute); allow `.env.example` in all; allow `.env` in `ctxPlain`; deny
     `centralEnvFile()` in `ctxPlain`; reason matches `/check names|setup\.sh|secrets/`
     per actual REASONS text
   - adapter: Claude `Read` payload on `.env` in provisioning cwd → deny;
     `.env.example` → null
   - line 440: replace the Read example with a genuinely unknown tool (e.g. `Glob`)
   - line ~531 loop: add `Read` to the matcher-coverage assertions
6. **`test/hooks-install.test.cjs`** — `buildEntries` length: claude 3, codex 2.
7. **Wiki** — journal entry (template per `wiki/MECHANICS.md`, `pr: pending`); add a
   Decisions bullet to the topic covering guardrails (check `wiki/topics/` during
   execution; journal-only if none fits). Run `pnpm graph:build` so the graph-freshness
   test stays green (never hand-edit `wiki/connections*`).

## Verification

- `pnpm test` — full suite (hooks conformance, installer, graph freshness).
- Manual end-to-end, both directions:
  ```
  echo '{"tool_name":"Read","tool_input":{"file_path":".env"},"cwd":"<prov-fixture-dir>"}' \
    | node scripts/hooks/pretooluse-guard.cjs --platform claude   # expect deny JSON
  ```
  and `.env.example` → no output (allow). Central file path from a plain dir → deny.
- Read-only review agent pass over the diff.
- Deliver uncommitted tree on `claude/issue-<N>-read-tool-env-guard` + suggested commit
  message (`fix(hooks): guard Read-tool .env access in tool and provisioning repos` with
  `Closes #<N>`); no commits — owner commits/pushes/PRs.
