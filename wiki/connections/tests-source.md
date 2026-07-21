# Connections — Tests and source modules

Which test suites exercise each source module (require() edges).

Part of the [wiring map](../connections.md), generated from the knowledge graph — **do not edit by hand**. Rebuilt on every `pnpm graph:build` and verified fresh by `pnpm test`.

- [build-plan.cjs](../../src/build-plan.cjs) ← [executor.test.cjs](../../test/executor.test.cjs), [plan-emit.test.cjs](../../test/plan-emit.test.cjs)
- [cli.cjs](../../src/cli.cjs) — no test suite requires it directly
- [emit-tsx.cjs](../../src/emit-tsx.cjs) ← [plan-emit.test.cjs](../../test/plan-emit.test.cjs)
- [executor.cjs](../../src/executor.cjs) ← [executor.test.cjs](../../test/executor.test.cjs)
- [type-map.cjs](../../src/type-map.cjs) ← [validate.test.cjs](../../test/validate.test.cjs)
- [util.cjs](../../src/util.cjs) ← [validate.test.cjs](../../test/validate.test.cjs)
- [validate-manifest.cjs](../../src/validate-manifest.cjs) ← [executor.test.cjs](../../test/executor.test.cjs), [plan-emit.test.cjs](../../test/plan-emit.test.cjs)
