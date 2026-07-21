/* Browser counterpart to scripts/graph/routing.cjs. It consumes the same
 * declarative routing-policy.json as the internal agent utility. */
"use strict";

window.KGRouting = (() => {
  const key = (edge) => `${edge.source}\u0000${edge.target}\u0000${edge.type}`;

  function hasSafeNumericPolicy(policy) {
    return Boolean(
      policy &&
      policy.edgeCosts &&
      Object.values(policy.edgeCosts).every((cost) => Number.isFinite(cost) && cost > 0) &&
      Number.isFinite(policy.hubPenalty) &&
      policy.hubPenalty >= 0
    );
  }

  function shortestPath(graph, source, target, policy) {
    if (!hasSafeNumericPolicy(policy)) return null;
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
    for (const edge of graph.edges) {
      adjacency.get(edge.source)?.push({ to: edge.target, edge, direction: "forward" });
      adjacency.get(edge.target)?.push({ to: edge.source, edge, direction: "reverse" });
    }
    const excluded = new Set(policy.excludedIntermediateTypes || []);
    const distances = new Map([[source, 0]]);
    const previous = new Map();
    const pending = new Set([source]);
    while (pending.size) {
      let current = null;
      for (const id of pending) {
        if (!current || distances.get(id) < distances.get(current) || (distances.get(id) === distances.get(current) && id < current)) current = id;
      }
      pending.delete(current);
      for (const step of adjacency.get(current) || []) {
        if (step.to !== target && step.to !== source && excluded.has(byId.get(step.to)?.type)) continue;
        const base = policy.edgeCosts[step.edge.type];
        if (typeof base !== "number") continue;
        const cost = base + (policy.hubPenalty || 0) * Math.log2((byId.get(step.to)?.degree || 0) + 1);
        const next = distances.get(current) + cost;
        const known = distances.get(step.to);
        const previousKey = previous.get(step.to) ? key(previous.get(step.to).edge) : "";
        if (known == null || next < known || (next === known && key(step.edge) < previousKey)) {
          distances.set(step.to, next);
          previous.set(step.to, { from: current, edge: step.edge, direction: step.direction });
          pending.add(step.to);
        }
      }
    }
    if (!distances.has(target)) return null;
    const nodes = [target];
    const steps = [];
    let current = target;
    while (current !== source) {
      const step = previous.get(current);
      if (!step) return null;
      steps.unshift({ ...step, to: current });
      current = step.from;
      nodes.unshift(current);
    }
    return { nodes, steps, cost: Number(distances.get(target).toFixed(3)) };
  }

  return { shortestPath, edgeKey: key, hasSafeNumericPolicy };
})();
