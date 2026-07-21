# provision-sitecore-component

Provision Sitecore XM Cloud components from one reviewed manifest. The manifest — drafted from the BA functional spec in Confluence — drives both sides of component setup: the CMS items (templates, fields with required validation and Source restrictions, the JSON rendering with datasource bindings, insert options, placeholder settings) via the Authoring GraphQL API, and the front-end TSX handoff scaffold (`Component.tsx` + `Component.types.ts`) the [ai-orchestration](https://github.com/verndale/ai-orchestration) pipeline consumes. Because one manifest creates the CMS template *and* the TypeScript boundary contract, the two can't drift.

## Contents

- [Requirements](#requirements)
- [Install the skill globally](#install-the-skill-globally)
- [Quick start](#quick-start)
- [Subcommands and exit codes](#subcommands-and-exit-codes)
- [Configuration](#configuration)
- [The manifest](#the-manifest)
- [Authentication (check/push)](#authentication-checkpush)
- [Safety model](#safety-model)
- [The skill](#the-skill)
- [Manual follow-ups (v1 scope)](#manual-follow-ups-v1-scope)
- [Context wiki](#context-wiki)
- [Development](#development)

## Requirements

- Node 24+ (see `.nvmrc`) and pnpm 10+ via Corepack.
- The CLI runtime is dependency-free — in a consuming app repo it runs with plain `node`, no install needed beyond this repo being present.

## Install the skill globally

Clone once, run the installer, done — the skill is available in Claude Code, Codex, and Cursor across every project:

```bash
git clone https://github.com/verndale/provision-sitecore-component
bash provision-sitecore-component/setup.sh   # or name tools: bash setup.sh claude codex cursor
```

`setup.sh` does three things per detected tool, all idempotent: symlinks the skill into the tool's user-level skills dir (`~/.claude/skills/`, `~/.codex/skills/`, `~/.cursor/skills/`); for Claude Code and Codex, registers the PreToolUse guard (`scripts/hooks/pretooluse-guard.cjs`) in the tool's user hook config (`~/.claude/settings.json`, `~/.codex/hooks.json`) so the skill's hard boundaries are mechanically enforced wherever it runs (Cursor has no hook surface — prose only); and offers a one-time credential bootstrap that writes `~/.config/provision-sitecore-component/.env` (chmod 600, values never echoed). Re-running is safe (symlinks recreated in place, hook entries updated in place; non-symlinks and foreign hook entries are never clobbered); `--uninstall` removes exactly the links and hook entries it made, keeping the credential file. The skill drives this clone's CLI and guard, so keep the clone in place — `git pull` updates it for every tool at once. Contributors additionally run `corepack enable && pnpm install` for the dev tooling (tests, commit/release); the CLI itself needs no install.

## Quick start

```bash
# Offline: validate the manifest, write <slug>.plan.json beside it, emit the TSX pair.
node src/cli.cjs plan <manifest.json>

# Online, read-only: preflight the plan against the CMS (per-op create/update/no-op/conflict).
node src/cli.cjs check <manifest.json>

# Online, mutating: execute the plan (add-only reconcile), then emit the TSX pair.
# Gated: prompts for confirmation on a terminal; non-interactive shells need --yes.
node src/cli.cjs push <manifest.json> --yes
```

Two complete manifests modeled on real CN specs live in the golden fixtures and double as reference examples: [test/fixtures/datasource-card/manifest.json](test/fixtures/datasource-card/manifest.json) (datasource component: two templates, a restricted Droptree, insert options, a placeholder) and [test/fixtures/page-fields/manifest.json](test/fixtures/page-fields/manifest.json) (page-driven component: fields added to an existing page template, rendering without a datasource) — with the exact plan and TSX output each produces frozen next to them under `expected*`.

## Subcommands and exit codes

| Subcommand | Network | What it does |
| --- | --- | --- |
| `plan` (default) | none | Validate manifest → write `<slug>.plan.json` next to it → emit TSX pair (create-only). |
| `check` | read-only | Run every preflight query; print the decision each op would take. Never mutates the CMS (all modes regenerate the local `<slug>.plan.json`). |
| `push` | mutating | Execute ops in order with create-or-update reconcile; then emit TSX like `plan`. Confirmation-gated: interactive y/N on a terminal, `--yes` required non-interactively (the skill passes it only after its step-6 gate approval). |

Flags: `--yes` (confirm `push`; recorded gate approval), `--no-tsx` (skip scaffold emission), `--force-tsx` (overwrite an existing pair), `--config <path>` (explicit config file).

Exit codes: `0` success or clean skip · `1` API/auth/conflict failure (nothing was forced) · `2` invocation, config, or manifest-validation error (each printed as one `ERROR: … Cause: … Next: …` line).

## Configuration

Resolution order: `--config <path>` → `./provision.config.json` → `./build.config.json` (pipeline repos: requires `stackAdapter: "sitecore-ai"`, reads the `sitecoreProvisioning` key) → none (paths must come from `manifest.sitecorePaths`).

```json
{
  "templateRoots": {
    "datasource": "/sitecore/templates/Project/<tenant>/<site>/Components",
    "base": "/sitecore/templates/Project/<tenant>/<site>/Pages/Base",
    "page": "/sitecore/templates/Project/<tenant>/<site>/Pages"
  },
  "renderingRoot": "/sitecore/layout/Renderings/Project/<tenant>/<site>",
  "placeholderSettingsRoot": "/sitecore/layout/Placeholder Settings/Project/<tenant>/<site>",
  "datasourceLocation": "query:$site/*[@@name='Data']",
  "componentPropsImport": "lib/component-props"
}
```

## The manifest

The reviewed contract for one component: which templates (new datasource/base templates, or a field section added to an `existing` page template), each field's `name` / `title` / `sitecoreType` / `required` / `source` / `helpText`, the rendering and its bindings, insert options, and placeholder settings. Full schema with semantics: [skills/provision-sitecore-component/references/manifest-contract.md](skills/provision-sitecore-component/references/manifest-contract.md). The Sitecore-type → TypeScript → renderer table: [references/type-mapping.md](skills/provision-sitecore-component/references/type-mapping.md).

The generated `<slug>.plan.json` is the human-reviewable push artifact: it embeds every GraphQL document verbatim, the resolved paths, and `__PLACEHOLDER__` ids that the executor binds from preflight results at run time — no hardcoded GUIDs anywhere.

## Authentication (check/push)

`check` and `push` use an XM Cloud **automation client** (OAuth2 client credentials) created in the Sitecore Cloud Portal for the target environment — use a dev/non-production environment.

| Variable | Meaning |
| --- | --- |
| `SITECORE_AUTHORING_CLIENT_ID` | Automation client id |
| `SITECORE_AUTHORING_CLIENT_SECRET` | Automation client secret |
| `SITECORE_AUTHORING_ENDPOINT` | `https://<instance>/sitecore/api/authoring/graphql/v1` |
| `SITECORE_AUTHORING_TOKEN_URL` | Optional; default `https://auth.sitecorecloud.io/oauth/token` |
| `SITECORE_AUTHORING_AUDIENCE` | Optional; default `https://api.sitecorecloud.io` |

Resolution order for unset keys: exported env vars → a repo-root `.env` (per-project override) → the per-machine `~/.config/provision-sitecore-component/.env` written by `setup.sh`'s one-time credential bootstrap (chmod 600). Values are never echoed into output, plans, or logs. Missing variables fail before any network call. Details and the first-run verification procedure: [references/authoring-api.md](skills/provision-sitecore-component/references/authoring-api.md).

## Safety model

- **Offline by default** — `plan` touches nothing but local files; `check` is read-only.
- **Add-only reconcile** — the tool creates and updates; it never deletes, renames, retypes, or removes list entries (Allowed Controls, `__Masters`, validation bars). Extra CMS fields and type mismatches are reported as follow-ups, never "fixed".
- **Resolve by path, verify by introspection** — well-known items (the Json Rendering template, the Required field rule, section/field templates) are resolved by path at run time, and the Json Rendering template's field surface is introspected before any rendering mutation; a mismatch aborts with remediation instead of guessing.
- **Create-only scaffold** — an existing TSX pair is never overwritten without `--force-tsx`.
- **Bounded retries** — at most 3 transport attempts, only on network errors/429/5xx; auth and schema errors never retry.

## The skill

[skills/provision-sitecore-component/](skills/provision-sitecore-component/) is an agent skill (ai-orchestration `SKILL.md` format) that wraps the CLI in the full workflow: fetch the Confluence spec → draft the manifest (ambiguities become review questions, never guesses) → run `plan` → one explicit gate before any push → report reconcile results and follow-ups → hand off to `/generate-build-pack`.

Install it globally with `setup.sh` ([Install the skill globally](#install-the-skill-globally)) — that is the intended distribution: every developer clones once and the skill works in all their projects. A project that prefers repo-local wiring can symlink the same directory into its project-level skills dir (`.claude/skills/`, `.codex/skills/`, `.cursor/skills/`) instead.

`skills/_meta/` and the skill's `references/retry-contract.md` are vendored copies of the ai-orchestration authoring specs so skill edits here follow the same standard; re-sync them from the source repo when it changes.

## Manual follow-ups (v1 scope)

Every plan and push report lists what the tool deliberately does not automate:

- Registering the rendering in the site's **Available Renderings** / Pages toolbox.
- Creating/assigning a **rendering parameters** template.
- Anything the add-only reconcile declined (extra fields, type conflicts) — reported verbatim for a human decision.

## Context wiki

[wiki/](wiki/INDEX.md) is the committed history of this repo — executed plans, decisions, and notable changes (the ai-orchestration wiki system, minus its Slack sync). Read [wiki/INDEX.md](wiki/INDEX.md) and open only the pages it routes to; write per [wiki/MECHANICS.md](wiki/MECHANICS.md) when delivering a substantive change. Automation under `scripts/wiki/` backstops capture: a merge-sync workflow fills pending PR references and drafts stubs, a nightly job refreshes cited issue state, and a non-blocking pre-commit reminder flags substantive commits with no journal entry.

The wiki includes the knowledge graph: `pnpm graph:build` derives a typed node/edge graph from the repo (skill, references, source, tests, automation, hooks, wiki pages; links, requires, covers, invokes, topic/plan relations) and renders the generated [wiki/connections.md](wiki/connections.md) wiring map; `pnpm graph:view` serves the interactive viewer at `localhost:4173`. The pre-commit hook rebuilds and stages the graph, the wiki bot workflows keep it in sync, and the graph tests in `pnpm test` fail on stale bytes, dangling edges, or a skill left uncovered by any topic. Agents route cross-system questions through `scripts/wiki/navigate.cjs` (`--intent why|wiring|impact`).

## Development

```bash
pnpm test          # node:test — goldens (byte-compared plans + TSX), executor units (injected fetch), skills lint, wiki conformance, graph freshness
pnpm graph:build   # rebuild the knowledge graph + generated wiki/connections* pages
pnpm graph:view    # serve the interactive graph viewer (localhost:4173)
pnpm commit        # Conventional Commits via @verndale/ai-commit (husky-enforced)
pnpm run pr:create # draft PR via @verndale/ai-pr (also runs on push via .github/workflows/pr.yml)
```

Releases run via semantic-release on `main` (version + tag + GitHub Release; no npm publish). Golden fixtures under `test/fixtures/` pin the planner and emitter byte-for-byte — regenerate them intentionally when output changes, never to quiet a diff. See [CONTRIBUTING.md](CONTRIBUTING.md).
