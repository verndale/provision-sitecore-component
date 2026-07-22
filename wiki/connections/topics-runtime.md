# Connections — Wiki topics and runtime surfaces

Each design-history topic and the runtime skill, source, or supporting surfaces it explicitly covers.

Part of the [wiring map](../connections.md), generated from the knowledge graph — **do not edit by hand**. Rebuilt on every `pnpm graph:build` and verified fresh by `pnpm test`.

- [Knowledge graph — Design History](../../wiki/topics/knowledge-graph.md) — 3 runtime surfaces
  - [build-graph.cjs](../../scripts/graph/build-graph.cjs)
  - [routing.cjs](../../scripts/graph/routing.cjs)
  - [serve.cjs](../../scripts/graph/serve.cjs)
- [Sitecore component provisioning — Design History](../../wiki/topics/sitecore-provisioning.md) — 5 runtime surfaces
  - [provision-sitecore-component](../../skills/provision-sitecore-component/SKILL.md)
  - [build-plan.cjs](../../src/build-plan.cjs)
  - [cli.cjs](../../src/cli.cjs)
  - [emit-tsx.cjs](../../src/emit-tsx.cjs)
  - [executor.cjs](../../src/executor.cjs)
- [Skill evals — Design History](../../wiki/topics/skill-evals.md) — 2 runtime surfaces
  - [check.cjs](../../scripts/evals/check.cjs)
  - [evals-check.test.cjs](../../test/evals-check.test.cjs)
