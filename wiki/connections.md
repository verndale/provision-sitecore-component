# Connections — wiring map

Generated from the knowledge graph ([`scripts/graph/build-graph.cjs`](../scripts/graph/build-graph.cjs)) — **do not edit by hand**.
Rebuilt on every `pnpm graph:build` and verified fresh by `pnpm test`. It maps how the repo's
skill, source modules, tests, and wiki wire together — the curated edges only; ordinary
same-area cross-links are omitted (open the graph viewer with `pnpm graph:view` for the full picture).

This is a small index — open the section your question needs:

- [Tests and source modules](connections/tests-source.md) — which test suites exercise each source module.
- [The skill and its references](connections/skills-references.md) — the skill and the references under its own `references/` tree.
- [Wiki topics and runtime surfaces](connections/topics-runtime.md) — the runtime surfaces each history topic explicitly covers.
- [Cross-subsystem links](connections/seams.md) — markdown links whose source and target live in different areas: the seams between subsystems.
- [Hooks and the scripts they run](connections/hooks.md) — each git, release, and agent-guard hook and the in-repo scripts it invokes.
