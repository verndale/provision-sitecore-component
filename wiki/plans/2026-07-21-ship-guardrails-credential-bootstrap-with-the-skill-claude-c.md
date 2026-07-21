---
status: implemented
executed: 2026-07-21
date: 2026-07-21
evidence:
  - "PR #10 https://github.com/verndale/provision-sitecore-component/pull/10 (merged 2026-07-21)"
source_tool: claude
source: "/Users/joe.fusco/.claude/plans/glowing-toasting-umbrella.md"
topics: [sitecore-provisioning]
---
# Ship guardrails + credential bootstrap with the skill (Claude Code + Codex)

## Context

Four documented hard boundaries (AGENTS.md:61-77, SKILL.md:55-64) are prose-only at runtime: the push gate, never-commit/push in this repo, secrets-never-echoed, vendored do-not-edit paths. Evals pin them in corpus form only. Owner direction: the enforcement (validators + hooks) must **ship with the skill** via `setup.sh` and work in **Claude Code and Codex** (same agent family, CLI/IDE/cloud), wherever the dev runs the skill; Cursor stays prose-only. Also: solve the `.env` story — today the CLI just reads `./.env` from the invocation cwd (`src/cli.cjs:119-130`, authoring-api.md "The CLI loads ./.env for unset keys") and nothing helps the dev set it up.

Verified July 2026 (research cited in journal): Codex ships a hooks engine mirroring Claude Code's (PreToolUse, `hookSpecificOutput.permissionDecision` deny/reason, exit-2 blocks, shell + `apply_patch`/`Edit`/`Write` matchers), configurable at user level (`~/.codex/hooks.json` or `[hooks]` in config.toml) and project level (`<repo>/.codex/`, trust-gated via `/hooks`). Codex default workspace-write sandbox blocks network (push already trips a human approval there). Agent-shell env fingerprints: `CLAUDECODE=1`/`CLAUDE_CODE_CHILD_SESSION=1`; `CODEX_SANDBOX*`, cloud `CODEX_PROXY_CERT` (hole: `danger-full-access` sets none).

Owner decisions locked: hooks ship with the skill via setup.sh; checked-in project configs too; push = harness "ask" + CLI-level `--yes`/TTY gate; git-mutation denial scoped to the documented deliver-and-handoff list **in this repo only** (consumer repos' commit policy is their own); honest-agent drift prevention, not adversarial sandboxing.

## End result — `bash setup.sh` walkthrough (the deliverable UX)

Dev clones the repo, runs `bash setup.sh` (auto-detects claude/codex; or names them). Per tool, three steps, all idempotent, all printed:

1. **Skill symlink** (unchanged): `~/.claude/skills/provision-sitecore-component` and `~/.codex/skills/provision-sitecore-component` → `<clone>/skills/provision-sitecore-component`.
2. **Guard registration** (new): `node scripts/hooks/install.cjs <tool>` JSON-merges two PreToolUse entries (Bash/shell + file-edit matchers) into `~/.claude/settings.json` / `~/.codex/hooks.json`, command = `node "<clone-abs>/scripts/hooks/pretooluse-guard.cjs"`. Entries are recognized by that path → re-runs update in place; `--uninstall` removes exactly these. Atomic write; unparseable existing file → abort with message, never clobber. Cursor: symlink only, prose note.
3. **Credential bootstrap** (new, interactive, skippable): prompts for `SITECORE_AUTHORING_ENDPOINT`, `CLIENT_ID`, `CLIENT_SECRET` (silent read; never echoed), optional `TOKEN_URL`/`AUDIENCE` → writes `~/.config/provision-sitecore-component/.env`, chmod 600. Non-interactive stdin or "n" → prints the manual path. One-time per machine.

**Where files land** (nothing else, nowhere else):

| Path | What |
|---|---|
| `~/.claude/skills/provision-sitecore-component` | symlink → clone (as today) |
| `~/.codex/skills/provision-sitecore-component` | symlink → clone (as today) |
| `~/.claude/settings.json` | two guard hook entries merged in |
| `~/.codex/hooks.json` | same two entries |
| `~/.config/provision-sitecore-component/.env` | credentials, 600, only if opted in |

Consumer repos get **zero files**. The clone carries everything live (CLI, validators, guard); `git pull` updates all of it because every installed pointer targets the clone. Restart note printed (hooks snapshot at session start).

**Dev flow afterward** in any consumer repo: skill triggers → manifest → `plan` (offline validation loop) → step-6 gate → `check`/`push --yes`. Push is triple-gated: skill AskUserQuestion → harness hook "ask" (both tools) → CLI `--yes`/TTY confirm; Codex default sandbox adds its own network approval. Credentials resolve process.env → `./.env` (per-repo override) → central file; `check` names missing vars.

**Uninstall**: `bash setup.sh --uninstall` removes symlinks + the merged hook entries (only those pointing into this clone); prints that the credential file remains (path shown, delete manually).

## Step 0 — Pre-work (owner-requested)

1. **Branch from main** before touching anything: `git switch -c feat/skill-shipped-guardrails` (local branch only — no push; the repo owner pushes/PRs. Note `pr.yml` auto-opens a PR when the owner pushes the branch).
2. **File a GitHub [Task]** via the `github-issue-creator` skill against this repo's remote: scope = this plan (skill-shipped guardrails for Claude Code + Codex, credential bootstrap, CLI push gate, husky guard, tests/docs/wiki). The skill drafts the issue and gets explicit go-ahead before creating. Reference the issue number afterward in the wiki journal entry and the suggested commit message (`Refs #N`).

## Architecture — four layers, one policy core

1. **CLI runtime** (any repo, any tool): push gate + central-env fallback in `src/cli.cjs`.
2. **Harness hooks** (Claude + Codex): `scripts/hooks/guard-core.cjs` policy + `pretooluse-guard.cjs` adapter; registered user-level by setup.sh AND checked into this repo (`.claude/settings.json`, `.codex/hooks.json`) so contributors are covered without setup.sh. Double-registration double-runs the guard — decisions identical, harmless.
3. **Git hooks** (this repo): husky blocks agent-shell commits/pushes.
4. **CI/tests**: conformance suites pin policy, configs, installer merge logic, CLI gate.

## Files

New: `scripts/hooks/guard-core.cjs`, `scripts/hooks/pretooluse-guard.cjs`, `scripts/hooks/install.cjs`, `scripts/hooks/agent-commit-guard.cjs`, `.claude/settings.json`, `.codex/hooks.json`, `.husky/pre-push`, `test/hooks.test.cjs`, `test/hooks-install.test.cjs`, `test/push-gate.test.cjs`, `wiki/journal/2026-07-21-skill-shipped-guardrails.md`.
Modified: `setup.sh`, `src/cli.cjs`, `skills/provision-sitecore-component/SKILL.md`, `skills/provision-sitecore-component/references/authoring-api.md` (auth section: resolution order), `.env.example` (note the central file), evals scenario wording if it quotes push commands, `.husky/pre-commit`, `.gitignore`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md` (setup + auth sections), `wiki/INDEX.md`, regenerated graph artifacts via `pnpm graph:build`.

## 1. `scripts/hooks/guard-core.cjs` — policy, context-scoped

Dependency-free `.cjs`, exports pure `decideBash(command, ctx)` / `decideFile(filePath, ctx)` → `{decision: "deny"|"ask", reason}` | null. `ctx` computed once per invocation from the hook payload's `cwd`: `inToolRepo` (cwd package.json name matches this package — exact name verified at impl), `inProvisioningRepo` (cwd has `provision.config.json`, or `build.config.json` with `stackAdapter: "sitecore-ai"`). Because setup.sh installs the guard **user-level (fires in every session)**, every rule declares its scope:

| Rule | Decision | Active |
|---|---|---|
| PUSH — provisioning push invocations | ask | everywhere (self-scoping: only matches this CLI/bin) |
| SECRETS — `$SITECORE_AUTHORING_*`/`OPENAI_API_KEY` expansion, `process.env.` access, printenv/env-pipe | deny | everywhere (self-scoping by var names) |
| ENV — pager/editor/cp reads of `.env` | deny | tool repo + provisioning repos; central credential file path protected everywhere |
| G/GH/P — git commit/push/merge/tag(create), gh pr create\|merge, gh release, ai-commit/ai-pr/pnpm commit/pr:create, semantic-release (non-dry) | deny | **tool repo only** (deliver-and-handoff is this repo's boundary, not consumer repos') |
| FILES — generated (`wiki/connections*`, `scripts/graph/data/graph.json`), vendored (`skills/_meta/*`, `references/retry-contract.md`), goldens (`test/fixtures/*/expected*`), `.env` | deny | tool repo only (paths relativized against cwd) |

Rule mechanics carried from prior design (token-based, per-segment on `&&`/`||`/`;`/`|`, git global-opt skipping, first-token launcher gate for PUSH incl. flag-before-mode + `node -e` executor bypass, `.env` lookahead excluding `.env.example`/`.envrc`, list-form `git tag` allowed, `--dry-run` carve-outs, name-only secret greps allowed). Anchored allow-list unchanged (`git status/diff/log/add/stash/merge-base`, `pnpm release:dry`, fixture manifests, `scripts/graph/viewer/*`, other references).

## 2. `scripts/hooks/pretooluse-guard.cjs` — adapter entry

Reads stdin JSON; normalizes Claude shape (`tool_name` + `tool_input.command|file_path`) and Codex shape (shell/`apply_patch` naming — exact fields verified at impl against the pinned Codex version; our normalization pinned by tests for both shapes). Emits shared `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":…,"permissionDecisionReason":…}}`; allow = silent. Always exit 0; malformed stdin → stderr warn, exit 0 (fail-open — never brick a session; hard layers: project `permissions.deny` for `.env`, CI, CLI gate). Codex `"ask"` support verified at impl; fallback there: deny-with-reason pointing at `--yes` + step-6 (Codex's sandbox network prompt remains the human ask).

## 3. `scripts/hooks/install.cjs` — user-level registration (setup.sh delegate)

`node scripts/hooks/install.cjs <claude|codex> [--uninstall]`. Claude: merge into `~/.claude/settings.json` `hooks.PreToolUse` — `{matcher: "Bash"}` + `{matcher: "Edit|MultiEdit|Write|NotebookEdit"}`, command `node "<clone>/scripts/hooks/pretooluse-guard.cjs"` (absolute). Codex: same into `~/.codex/hooks.json` with Codex matcher names. Idempotent: entries identified by command path containing `<clone>/scripts/hooks/`; update-in-place on re-run; `--uninstall` removes only those. Preserve all unknown keys; atomic tmp+rename write; parse failure → non-zero exit + message (setup.sh surfaces it), never overwrite. No user-level `permissions.deny` (global `.env` read-denial across unrelated projects is overreach; ENV rule is context-scoped instead).

## 4. `setup.sh` additions

Per selected tool (claude/codex): after the symlink, run installer; then (install mode, interactive TTY only, once not per-tool) the credential prompt → write `~/.config/provision-sitecore-component/.env` (mkdir -p, chmod 600, values via `read -rs`, nothing echoed); skip silently when the file already exists (offer to keep). `--uninstall` → installer `--uninstall` per tool + credential-file notice. Cursor: symlink only + one-line prose note. Final summary prints the exact table from the walkthrough above.

## 5. `src/cli.cjs` — push gate + central env fallback

- `parseArgs`: accept `--yes` (push-only semantics).
- Push path before `loadDotEnv`: no `--yes` → TTY: readline y/N confirm (component + endpoint host); non-TTY: fail(exit 2) naming the step-6 gate and `--yes`. Runs before env/network — offline-testable.
- `loadDotEnv(cwd, env)`: after `./.env`, fill still-unset keys from `~/.config/provision-sitecore-component/.env` (`os.homedir()`; same minimal parser). Order: process.env → `./.env` → central. `plan` untouched → goldens unaffected.
- Docs: authoring-api.md Authentication (normative — add resolution order + central path), SKILL.md step 6/7 (`push --yes` after gate; guardrails line), README auth + setup sections, `.env.example` header note. Grep evals for quoted push commands; align; `pnpm evals:check`.

## 6. Husky agent-commit guard (this repo)

`scripts/hooks/agent-commit-guard.cjs`: exit 1 with deliver-and-handoff message when agent env detected (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_PROXY_CERT`) unless `ALLOW_AGENT_COMMIT=1` (human escape hatch, e.g. Codex cloud env). Prepend to `.husky/pre-commit`; new `.husky/pre-push` with the same call. Accepted holes: Codex `danger-full-access` (no fingerprint; layer-2 still denies), cloud platform-side commits (likely bypass hooks — undocumented, noted).

## 7. Checked-in project configs + `.gitignore`

`.claude/settings.json` (project): `permissions.deny` `Read(./.env)`/`Edit(./.env)`/`Write(./.env)` + the two PreToolUse entries via `$CLAUDE_PROJECT_DIR`. `.codex/hooks.json` (project, trust-gated via `/hooks`). `.gitignore`: replace `.claude/` with `.claude/*` + `!.claude/settings.json`; add `.codex/*` + `!.codex/hooks.json`.

## 8. Tests

- `test/hooks.test.cjs`: guard-core decision matrix (full deny/ask/allow tables from prior design) **× ctx scoping** — git/file rules fire with tool-repo cwd, stay silent with consumer-repo cwd; PUSH/SECRETS fire in both; ENV per scope. Adapter spawns with Claude-shape + Codex-shape payloads; malformed stdin → exit 0 silent. agent-commit-guard env matrix. Settings-drift: parse both checked-in configs, commands reference the guard, guard files exist, husky files reference the guard.
- `test/hooks-install.test.cjs`: merge logic against fixture settings JSONs — fresh file, existing unrelated hooks preserved, re-run idempotent, uninstall removes only ours, unparseable input → error without write (use temp HOME in scratch, spawn pattern per `test/evals-check.test.cjs`).
- `test/push-gate.test.cjs`: spawn `cli.cjs push <fixture manifest>` non-TTY clean-env → gate refusal (exit 2, message, no network); `--yes` → proceeds to missing-env config failure (offline); `--yes` + temp central env file honored (assert resolution order via a fake HOME and a bogus endpoint that fails before network? — simplest: assert readEnv picks up central values by pointing HOME at scratch and expecting the *next* failure class); `plan` ignores `--yes`.

## 9. Docs + wiki

- AGENTS.md: Layout `scripts/` bullet + `hooks/`; "Run it" setup.sh line gains "installs guard hooks + optional credential bootstrap"; Hard boundaries new bullet (mechanically enforced in Claude Code + Codex via skill-shipped user-level hooks and checked-in project configs; husky blocks agent commits; CLI gates push with `--yes`; Cursor prose-only).
- CONTRIBUTING.md: "Agent guardrails" paragraph (guard + tests change together; one-time trust approvals; installer paths).
- Journal `wiki/journal/2026-07-21-skill-shipped-guardrails.md` (MECHANICS frontmatter): why, the four layers, distribution model, research findings + URLs, ruled-out (Cursor adapter, `.codex/rules/` experimental, global user-level permissions.deny, per-repo-only .env). INDEX Journal line. `pnpm graph:build`.

## Verification (ordered)

1. Guard smoke both payload shapes (echo-piped: deny `git commit` in tool repo, silent in consumer-cwd payload, ask on push, deny `cat .env`, deny Edit `wiki/connections.md`).
2. `node --test test/hooks.test.cjs test/hooks-install.test.cjs test/push-gate.test.cjs`.
3. Installer dry-run against scratch HOME: install → assert merged JSON; re-run → unchanged; uninstall → entries gone, unrelated keys intact.
4. `bash setup.sh claude codex` for real (owner machine) → verify the five landing paths; `--uninstall` → clean.
5. `pnpm graph:build`; `pnpm test`; `pnpm evals:check`.
6. `git check-ignore` proofs: `.claude/settings.json`, `.codex/hooks.json` tracked; `.claude/settings.local.json` ignored.
7. Read-only review agent over the diff; report findings.
8. Owner live checks — Claude: `git commit --allow-empty` denied, `cat .env` denied, push → ask (cancel), Edit `wiki/connections.md` denied; consumer repo: `git commit` NOT blocked, push still asks. Codex: `/hooks` trust, repeat; confirm ask-vs-deny fallback on pinned version.

## Handoff

Uncommitted tree + suggested message:
`feat(provision-sitecore-component): ship cross-tool guardrails and credential bootstrap with the skill`

## Residual risks (accepted)

- Codex payload/`"ask"`/user-hooks.json specifics verified at implementation; tests pin our side either way.
- Not adversarial sandboxing (`sh -c`, temp scripts, python reads evade; `--yes` forgeable in bare terminals — harness ask + husky cover the tools in scope).
- Fail-open guard; editing user settings files is the riskiest step → installer aborts on parse failure, atomic writes, uninstall path tested.
- `danger-full-access` invisible to husky; Codex cloud platform-commits likely bypass husky (undocumented).
- Central credential file is per-machine plaintext (600) — same trust level as today's per-repo `.env`, minus the inside-a-repo exposure.

## Follow-up (out of scope)

CI hash-pin test for vendored files; `.codex/rules/` defense-in-depth once stable; Cursor adapter if its hook surface lands in scope.
