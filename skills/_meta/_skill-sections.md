<!-- Vendored from verndale/ai-orchestration (frontend-ai/skills/_meta/_skill-sections.md). Do not edit here — re-sync from the source repo when it changes. Cross-repo links in the body refer to paths in ai-orchestration. -->
# Skill file structure — section reference

> **Authoring artifact. NOT loaded at runtime.** Documents the canonical `SKILL.md` structure
> all skills already follow, so new skills stay consistent. `_meta/` is a non-skill directory
> (like `_shared/`) — skill discovery keys on `SKILL.md`, so nothing here loads. To start a new
> skill, copy [`_skill-template.md`](_skill-template.md).

## Canonical section order

Every `SKILL.md` uses these H2 sections in this order. `## Validation loops` is the only optional one:

1. `## Use when` — always
2. `## First-hop references` — always
3. `## Workflow` — always
4. `## Inputs and outputs` — always
5. `## Validation loops` — *(omit for deterministic / action-routed skills)*
6. `## Guardrails` — always

A skill MAY insert domain-specific sections between `## Inputs and outputs` and `## Validation loops`
when it constructs an artifact with its own contract — e.g. `generate-build-pack` adds a
template-shape section and a Confluence count-parity section. Keep these minimal and name them by intent.

## Frontmatter and lead

- `name` — lowercase-hyphen slug matching the directory name. No `claude` / `anthropic`.
- `description` — third person; says WHAT the skill does and WHEN to use it, with concrete trigger
  terms (frameworks, file types, phrases). This is the one field used for skill selection — make it
  specific. Under 1024 chars.
- After the `# Skill: <name>` H1: a 1–2 sentence lead, then `Operator docs: [README.md](README.md).`

## Sections

### Use when (always)
Bullets naming the trigger conditions — when this skill applies, and when a sibling skill is the
better fit. Mirrors and expands the `description`'s "when".

### First-hop references (always)
The `references/*.md` and `../_shared/*.md` files loaded for the happy path, as a short list. Keep
paths one hop from `SKILL.md` — no second-hop discovery on the happy path.

### Workflow (always)
Numbered, imperative steps — the procedure the skill executes. Reference the Study → Plan → Ask →
Execute preamble (`../_shared/study-and-plan-phase.md`) where the skill uses it.

### Inputs and outputs (always)
- Required inputs / Optional inputs (by name).
- Output and side effects (what it writes, reports, or triggers).

### Validation loops *(optional)*
The validator → fix → re-check loop and its pass/fail shape, pointing at the rubric/reference that
defines it. Omit when the skill is deterministic or action-routed and has no retry logic (e.g.
`project-memory`, `ui-design-brain`). Any such loop MUST cap its repair attempts and reference the
bounded retry + escalation shape in [`../_shared/retry-contract.md`](../_shared/retry-contract.md)
(cap 3; report-and-stop for headless loops, developer-escalation for interactive gates) — never loop
"until coherent" without a numeric cap, and never restate the budget or options inline.

### Guardrails (always)
Boundaries and cautions: the normative rule-source link, MUST NOT items, and a "use `<other-skill>`
instead when …" pointer. The same `## Guardrails` name every skill and rule uses.

### Examples and templates — NOT an inline section
Skills do **not** carry an inline `## Examples` section (rules do). A skill's concrete examples —
output templates, report shells, spec skeletons — live in `references/*.md` (e.g.
`report-template.md`, `test-file-template.md`, `spec-file-template.md`), listed under
`## First-hop references` and applied in `## Workflow`. This keeps `SKILL.md` thin and loads the
example only when the skill runs (progressive disclosure). Rules embed `## Examples` instead because a
rule loads as a whole, so a good/bad pair anchors the constraint in place.

## Reference files (`references/*.md`)

Most reference files optimize for **retrieval**, not governance — their bodies stay flexible and do NOT
take the skill spine. The one exception is **governed rule references** (see below). For the retrieval kind,
the only standardized part is a retrieval header:

- Knowledge/fact docs, lookup/mapping tables, and short reference-rule specs SHOULD open with `## Use when`
  (a "Read this reference when:" bullet list, plus an optional one-line "Skip when:") so a skill can point
  at the file and the model self-selects whether to load it. `## Use when` is the same trigger-section name
  skills use.
- Templates (`*-template.md`), personas (`personas/*.md`), schemas/manifests/contracts, and rubrics loaded
  at a fixed workflow step do NOT need `## Use when` — they are fetched positionally by name from a known
  step, so a retrieval header is noise.
- Keep example/template artifacts in `references/` (not an inline `## Examples` section in `SKILL.md`).

### Governed rule references

The numbered `implement-build-pack/references/core/*.md`, the `adapters/*.md`, and the Generate / Implement /
Log shells are **normative rules**, not retrieval docs. They open with `## Purpose` (not `## Use when`) and
follow a fixed spine — Purpose → Critical Rules → domain body → Guardrails → Examples — with RFC-2119
keywords, frozen cross-referenced headings, and resolver registration for new core rules. The full structural
spec and the starter template live beside this file: [`_rule-sections.md`](_rule-sections.md)
and [`_rule-template.md`](_rule-template.md).

## Conventions (hard constraints)

- **Keep `SKILL.md` thin** — under ~500 lines; push detail into `references/*.md`. Only `name` +
  `description` load at startup; the body loads on trigger.
- **References one hop deep** — link `references/*.md` directly from `SKILL.md`; avoid second-hop
  chains on the happy path. A registry file MAY conditionally load deeper sub-files (e.g.
  `code-review`'s `references/personas/*.md` via `persona-registry.md`) — that is the sanctioned way to
  exceed one hop, because only the selected sub-files load. Name reference files descriptively by role
  (`*-template.md`, `*-rubric.md`, `*-matrix.md`, `*-phase.md`). Do not leave redirect-only
  "compatibility router" reference files once `SKILL.md` points at the dedicated references.
- **Prefer scripts for deterministic ops** — a committed script beats regenerated code (saves context,
  more reliable, consistent).
- **Don't rename frozen output sections** — Build Pack section names (`` `## Normalized DOM Contract` ``,
  etc.) and `MEMORY.md` schema headings are referenced by exact name. A skill's own H2 spine is not
  frozen, but the artifact sections it emits are.
- **Pair with eval coverage** — a new or changed skill needs a matching suite under
  `frontend-ai/evals/<skill>/`; run `pnpm evals:check`.
- **TOC over 100 lines.** Any file over 100 lines (a long `references/*.md`, a README) opens with a
  `## Contents` heading (never "Table of contents") right after the H1 + 1-line purpose. LLM-facing files
  (`SKILL.md`, `references/*.md`) use plain bullets in heading order; human-facing READMEs use anchor links.
- **Tailwind in examples.** Example / illustrative code in skills and `references/*.md` uses Tailwind
  utilities as configured — never ad-hoc CSS or `.module.scss` / `.module.css`. The runtime constraint
  lives in [`../../skills/implement-build-pack/references/core/01-tech-constraints.md`](../implement-build-pack/references/core/01-tech-constraints.md).
- **Follow Anthropic agent-skill best practices** (canonical link in [`AGENTS.md`](../../../AGENTS.md)). When adding or editing a skill, the practices that
  bite: `name` lowercase-hyphen ≤64 chars (no `claude` / `anthropic`); `description` third person ≤1024
  chars stating what + when; `SKILL.md` body under ~500 lines; progressive disclosure one hop deep; a TOC
  for files over 100 lines; consistent terminology and no time-sensitive info; concrete examples with one
  sensible default; forward slashes in all paths.
