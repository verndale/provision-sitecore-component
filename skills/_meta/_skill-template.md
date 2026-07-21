<!-- Vendored from verndale/ai-orchestration (frontend-ai/skills/_meta/_skill-template.md). Do not edit here — re-sync from the source repo when it changes. Cross-repo links in the body refer to paths in ai-orchestration. -->
---
name: <skill-slug>
description: <third person — WHAT this skill does and WHEN to use it, with concrete trigger terms (frameworks, file types, phrases). Under 1024 chars.>
---

# Skill: <skill-slug>

<!--
  Copy this file to start a new skill: create frontend-ai/skills/<skill-slug>/SKILL.md from it.
  Keep the sections below in order; omit `## Validation loops` only for deterministic skills.
  Full guidance: _skill-sections.md (same dir). Pair the new skill with an eval suite under
  frontend-ai/evals/<skill-slug>/ and run `pnpm evals:check`.
-->

<1–2 sentence lead: what this skill does and its scope.>

Operator docs: [README.md](README.md).

## Use when

- <trigger condition>
- <trigger condition>
- Use `<other-skill>` instead when <boundary>.

## First-hop references

1. `../_shared/<shared-doc>.md`
2. `references/<reference>.md`

## Workflow

1. <imperative step>
2. <imperative step>
3. Use the Study -> Plan -> Ask -> Execute preamble from `../_shared/study-and-plan-phase.md`.

## Inputs and outputs

- Required inputs: `<Name>`
- Optional inputs: `<Name>`
- Output and side effects:
  - <what it writes, reports, or triggers>

## Validation loops

<!-- OPTIONAL. Keep when the skill has a validator/fix/re-check loop; delete this whole section
     for deterministic / action-routed skills (e.g. project-memory, ui-design-brain). -->

- <rubric/reference that defines the pass/fail shape>
- After any applied fix, re-check the affected item before finalizing.

## Guardrails

- Normative rule source: [`<reference>.md`](references/<reference>.md).
- MUST NOT <boundary>.
- Use `<other-skill>` instead when <condition>.
