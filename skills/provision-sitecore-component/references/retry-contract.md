<!-- Vendored from verndale/ai-orchestration (frontend-ai/skills/_shared/retry-contract.md). Do not edit here — re-sync from the source repo when it changes. Cross-repo links in the body refer to paths in ai-orchestration. -->
# Bounded retry & self-correction contract (shared)

The single source for the repair-attempt budget and escalation shape used by every fix-first gate and validation loop in the pipeline. The budget and the escalation options live here; each consuming gate declares only its repair mode, its editable surface, and which escalation shape it uses — it never restates the cap or the option wording inline.

## Contents

- Use when
- The budget
- Repair-mode slot
- Fix scope
- Escalation on exhaustion
- Canonical escalation block
- Out of scope
- Guardrails

## Use when

Read this from any step that repairs-then-rechecks: a fix-first gate (e.g. the post-Implement buildability and Tailwind canonical gates), a generation validation loop (e.g. `ValidateTests`, `ValidateSpec`, the design-fidelity repair loop), or the conformance-repair run loop in `generate-unit-tests` (executing AC-derived tests against the implementation).

## The budget

- The standard cap is **3 attempts total** per gate per run.
- One attempt = run the check; if it fails, apply the self-correction (per [Repair-mode slot](#repair-mode-slot)), then re-run the same check.
- The counter is per-gate and per-run; a fresh invocation starts the budget over.
- "Self-correction" is the within-loop adjustment between attempts — re-read the failure, change the generated artifact, retry. It is **not** a separate proactive review pass before the gate runs.

## Repair-mode slot

Between attempts a gate applies exactly one repair mode, which it names in its own reference:

- **(a) Model-driven repair** — no deterministic rewrite source; the model diagnoses and fixes (e.g. buildability TypeScript / import errors).
- **(b) Deterministic-rewrite application** — a validator prints the exact rewrite per finding and the gate applies it verbatim (e.g. `tailwind-canonical/check.cjs` suggested rewrites).

This contract owns the cap and the loop shape only; the repair mode and the check itself belong to the consumer.

## Fix scope

The self-correction MUST stay inside the consumer's **declared editable surface** and never widen scope to force convergence. Fix-first gates declare their editable surface at their own call site (e.g. the AC-ledger gate edits the ledger file only); validation loops fall into one of two archetypes, with opposite editable surfaces — each loop declares which one it runs:

- **(i) Generation validation loops** — only the files that loop generates (test files + manifest; spec + manifest; the generated design-fidelity spec). Implementation source, tokens, and Build Packs are off-limits and are flagged in the run summary, not edited.
- **(ii) Conformance-repair loops** — trigger: **runtime failure of a fidelity-checked AC-derived test** inside a test-execution gate (today: the `generate-unit-tests` run loop; the same shape governs any future e2e execution context). Precondition: the consumer's fidelity ladder has confirmed the failing test faithfully encodes its `AC-N` / `AX-N` row — a failure caused by a test that misencodes the row, or by test infrastructure (module resolution, missing mocks), belongs to archetype (i) instead. Editable surface: **implementation source under the resolved module root(s) only**. Off-limits: test assertions and titles, Build Packs, tokens, and config — the fix direction is implementation-toward-spec.

## Escalation on exhaustion

After the cap is reached with the check still failing, the gate ends in one of two shapes. Each consumer declares which it uses.

### Developer-escalation (interactive)

For gates that run inside an interactive developer turn (the two post-Implement gates). After the 3rd failing attempt, escalate via `AskUserQuestion` using the [Canonical escalation block](#canonical-escalation-block). On `Halt` (or no answer), emit the consumer's canonical `ERROR:` line and stop.

### Report-and-stop (headless)

For loops that run without an interactive developer turn — the generation validation loops and the conformance-repair run loop (the developer re-runs the skill to see the verdict). After the cap, **stop and report** the unresolved items in the run summary (`Failed` / open / known-issue). MUST NOT issue an `AskUserQuestion`; MUST NOT silently pass.

## Canonical escalation block

Developer-escalation gates reference this block instead of restating it. The option-3 outcome phrase and the `ERROR:` predicate are consumer-supplied (the phrase owns the whole outcome — "recorded" is not fixed boilerplate); everything else is fixed.

`AskUserQuestion` options:

1. **Halt** — stop with the canonical error below; developer fixes and re-runs.
2. **Fix manually and re-run** — same as Halt; the developer applies their own repair.
3. **Continue with the &lt;outcome phrase&gt;** — proceed to subsequent phases; log the failure as a known issue. (Reserved for diagnostic runs; not the default.)

Canonical error on `Halt` / no answer:

```text
ERROR: <gate-specific predicate> after 3 repair attempts.
```

Concrete instantiations:

- Buildability gate — option 3 "Continue with the failure recorded"; `ERROR: Post-Implement buildability check failed — unresolved import/export or TypeScript error in implementation target after 3 repair attempts.`
- Tailwind canonical gate — option 3 "Continue with the non-canonical classes"; `ERROR: Tailwind canonical class check failed — non-canonical arbitrary value classes remain in implementation target after 3 repair attempts.`

## Out of scope

This contract governs repair-then-recheck loops only. The following are deliberately **not** under it and keep their own behavior:

- **Template-compliance gate** ([`../agent-orchestrator/references/generate-phase.md`](../agent-orchestrator/references/generate-phase.md) §3) — an intentional cap of **1** (regenerate-once); a full regeneration is expensive, so the cheaper budget is a considered choice, not a missing loop.
- **Build Pack contract-patch validator gate** ([`contract-patch-core.md`](contract-patch-core.md)) — single apply, then **revert every touched file** to its captured original bytes on a non-zero validator exit. This whole-run atomic revert ("never leave a failing pack") is a safety guarantee; a retry would introduce partial state between attempts.
- **Pre-flight hard halts** — missing Build Pack directory, missing manifest, security-boundary, MCP-retrieval failure (`stop with ERROR:` tripwires), and the Build Pack Shape Validation Gate exit 1.
- **Invocation errors** — "resolve the path and retry" (exit 2) for bad args / unreadable targets.
- **Single-decision gates** — the `[Concern]` / `[Question]` / `[Boundary]` Hygiene Check items and their one bundled `AskUserQuestion`.

## Guardrails

- MUST cap repair attempts at the budget; MUST NOT loop "until it passes" / "until coherent" without a numeric cap.
- MUST self-correct only within the consumer's declared editable surface; MUST NOT widen scope to chase convergence.
- Conformance-repair loops MUST NOT weaken, delete, or retitle assertions to converge; the fix direction is implementation-toward-spec, never spec-toward-implementation.
- Developer-escalation gates MUST use the canonical options and `ERROR:` template above; MUST NOT restate the budget or options inline.
- Report-and-stop loops MUST report unresolved items in the run summary; MUST NOT issue `AskUserQuestion`; MUST NOT silently pass.
- Example code uses Tailwind utilities as configured; relative links use forward slashes only.
