---
name: provision-sitecore-component
description: Provisions a Sitecore XM Cloud component end to end from a reviewed component manifest. Drafts the manifest from a Confluence functional spec, then creates or updates the CMS side via the Authoring GraphQL API — datasource or page templates with fields, required-field validation, Source restrictions, Title labels and help text, the JSON rendering with datasource bindings, optional insert options and placeholder settings — and emits the house-pattern TSX contract pair (Component.tsx + Component.types.ts) the frontend pipeline consumes. Relevant when a component's Sitecore backend does not exist yet and a functional spec is available — before generate-build-pack. Triggers include "provision the component", "create the Sitecore template for", "set up the CMS side", "scaffold the component from the spec".
---

# Skill: provision-sitecore-component

Turns a Confluence functional spec into a reviewed component manifest, provisions the Sitecore items from it (offline plan → human gate → optional API push), and emits the TSX handoff scaffold. One manifest drives both sides, so the frontend boundary contract mirrors the CMS by construction.

Operator docs: [README.md](README.md).

## Use when

- A component from a functional spec needs its Sitecore backend created: datasource template, page-template field section, JSON rendering, bindings, placeholder settings.
- The frontend needs the bare-bones TSX contract pair for a component whose CMS side is being provisioned.
- The spec lives in Confluence and the manifest should be drafted from it rather than hand-typed.
- Use `/generate-build-pack` instead when the CMS side already exists and the task is generating the Build Pack for implementation; this skill hands off to it.
- Use `/implement-build-pack` instead when a scaffold already exists and needs implementing.

## First-hop references

1. `references/confluence-import.md`
2. `references/manifest-contract.md`
3. `references/type-mapping.md`
4. `references/authoring-api.md`
5. `references/tsx-template.md`
6. `references/retry-contract.md`

## Workflow

1. Resolve context: read the provisioning config per `references/manifest-contract.md` (config resolution order); confirm the target component name and the Confluence spec URL. When the ai-orchestration pipeline skills are mirrored alongside this one, run their shared Study → Plan → Ask → Execute preamble; standalone, follow steps 2–7 as the compact equivalent (study → plan artifact → single gate → execute).
2. Fetch the spec via the Atlassian MCP (`getConfluencePage` with `contentFormat: "html"`) per `references/confluence-import.md`. Retrieval failure, an empty body, or a partial page is a hard stop — report it and end; MUST NOT draft a manifest from memory or chat paraphrase.
3. Extract the field inventory from the spec's field tables per `references/confluence-import.md`, and map each field type per `references/type-mapping.md`. Collect every ambiguity — unmappable types, list/tree Source restrictions stated as intent, field-naming convention, datasource location — as review questions; MUST NOT silently guess any of them.
4. Write the manifest per `references/manifest-contract.md`, then run the CLI in offline mode: `node <tool>/src/cli.cjs plan <manifest>`. Surface the drafted manifest, the written `<slug>.plan.json`, the emitted TSX pair paths, and the collected review questions as one plan artifact for the developer.
5. Repair manifest-validation failures (CLI exit 2) per the loop in `## Validation loops`.
6. Gate before any CMS mutation with one `AskUserQuestion`: run `check` first and review, push now, or stop here with manifest + scaffold only. No answer means stop here. The push is a mutation of a shared CMS environment — MUST NOT run `push` without this gate's approval in the current session.
7. On approval, run `check` and/or `push --yes` per the developer's choice, with the environment variables from `references/authoring-api.md`. `--yes` is the recorded step-6 approval — the CLI refuses a non-interactive `push` without it, and it MUST NOT be passed before the gate answer. Report the per-op reconcile results and every `manualFollowUps` entry verbatim (Available Renderings registration and rendering-parameters templates remain manual in v1).
8. Hand off: the component's CMS side and TSX scaffold now exist — direct the developer to `/generate-build-pack` for the Build Pack, then `/implement-build-pack` to fill the scaffold.

## Inputs and outputs

- Required inputs: `Confluence` (spec page URL), `Component` (PascalCase name).
- Optional inputs: `Output` (repo-relative scaffold directory), `ManifestPath` (reuse an existing manifest instead of drafting), `Push` (`false` by default — even `true` still passes through the step-6 gate).
- Output and side effects:
  - The component manifest (JSON) and `<slug>.plan.json` beside it.
  - `<output>/<Component>.types.ts` + `<output>/<Component>.tsx` (create-only; `--force-tsx` to overwrite).
  - On approved `push` only: CMS items created/updated per the plan (add-only reconcile).
  - A report of per-op decisions and manual follow-ups.

## Validation loops

- Manifest repair loop: when the CLI exits 2 with `ERROR: … Cause: … Next: …` lines, apply the bounded retry shape from [`references/retry-contract.md`](references/retry-contract.md) — repair mode (a) model-driven; editable surface: the manifest file only; escalation: developer-escalation via the canonical block, with option 3 "Continue with the manifest as-is" removed (an invalid manifest cannot proceed — on exhaustion, Halt is the only outcome).
- After any repair, re-run the same `plan` invocation before continuing.

## Guardrails

- Normative contracts: [`references/manifest-contract.md`](references/manifest-contract.md) (manifest), [`references/authoring-api.md`](references/authoring-api.md) (mutations and reconcile).
- MUST NOT run `push` without the step-6 gate approval in the current session; `check` is the only online mode allowed before it. The CLI enforces this mechanically: non-interactive `push` refuses without `--yes`, and `--yes` may only ever be passed after the gate approval.
- MUST NOT delete, rename, or retype CMS items or fields, and MUST NOT remove entries from Allowed Controls, `__Masters`, or validation-bar lists — the tool is add-only by contract; treat anything it reports as a conflict or follow-up as manual work, not something to force.
- MUST NOT overwrite an existing TSX pair without an explicit developer request (`--force-tsx`).
- MUST NOT hand-edit a generated `<slug>.plan.json` — every CLI run rewrites it from the manifest, and it is part of the step-6 gate review artifact; fix the manifest and re-run `plan`.
- MUST NOT invent Source strings, datasource locations, or field types the spec does not state — they are review questions (step 3), and once answered they are written verbatim.
- MUST NOT echo the values of `SITECORE_AUTHORING_*` environment variables into chat, logs, or files.
- Scope is the datasource/page templates, rendering + bindings, insert options, and placeholder settings. Site registration (Available Renderings) and rendering-parameters templates are reported as manual follow-ups — MUST NOT improvise them via ad-hoc mutations.
- Use `/generate-build-pack` / `/implement-build-pack` for everything downstream of the scaffold.

✅ Spec says "Restrict to eligible page templates inheriting the shared base template" → the manifest review lists `source` as an open question; after the developer supplies `query:$site/*[@@templatename='Article Page']`, that exact string lands in the manifest.

❌ Spec says "Restrict to eligible page templates" → the agent invents `Datasource=/sitecore/content` as the Source and pushes it without surfacing the question.
