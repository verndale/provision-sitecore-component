"use strict";

// Deterministic navigation over the repository graph. The agent selects an
// intent before calling this module; this module only resolves exact graph data
// and never infers architecture beyond the graph's existing edges.

const fs = require("fs");
const path = require("path");

const POLICY_PATH = path.join(__dirname, "routing-policy.json");
const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "does", "for", "from", "how", "i", "in", "is", "it", "of", "on", "or", "the", "this", "to", "what", "when", "where", "why", "with"]);
const REQUIRED_INTENTS = ["why", "wiring", "impact"];

function loadPolicy(policyPath = POLICY_PATH) {
  return JSON.parse(fs.readFileSync(policyPath, "utf8"));
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function nodeHaystack(node) {
  return [node.label, node.id, ...(node.topics || []), ...(node.aliases || [])].join(" ").toLowerCase();
}

function scoreNode(node, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return 0;
  const haystack = nodeHaystack(node);
  if (node.id.toLowerCase() === normalized) return 1000;
  if (node.label.toLowerCase() === normalized) return 900;
  const tokens = tokenize(normalized);
  if (tokens.length === 0 || !tokens.every((token) => haystack.includes(token))) return 0;
  let score = tokens.length * 20;
  if (haystack.includes(normalized)) score += 100;
  if (node.label.toLowerCase().includes(normalized)) score += 30;
  if (node.id.toLowerCase().includes(normalized)) score += 20;
  return score;
}

function policyProblems(policy, graph = null, { checkNodeTypes = true } = {}) {
  const problems = [];
  if (!policy || typeof policy !== "object") return ["policy must be an object"];
  if (!policy.edgeCosts || typeof policy.edgeCosts !== "object" || Array.isArray(policy.edgeCosts)) {
    problems.push("edgeCosts must be an object");
  } else {
    for (const [type, cost] of Object.entries(policy.edgeCosts)) {
      if (!Number.isFinite(cost) || cost <= 0) problems.push(`edge cost for ${type} must be a finite positive number`);
    }
  }
  if (!Number.isFinite(policy.hubPenalty) || policy.hubPenalty < 0) {
    problems.push("hubPenalty must be a finite non-negative number");
  }
  if (!Array.isArray(policy.excludedIntermediateTypes)) {
    problems.push("excludedIntermediateTypes must be an array");
  }
  if (!policy.intents || typeof policy.intents !== "object" || Array.isArray(policy.intents)) {
    problems.push("intents must be an object");
  } else {
    for (const intent of REQUIRED_INTENTS) {
      const definition = policy.intents[intent];
      if (!definition || typeof definition !== "object") {
        problems.push(`missing ${intent} intent`);
        continue;
      }
      for (const field of ["preferredSourceTypes", "preferredTargetTypes"]) {
        if (!Array.isArray(definition[field]) || definition[field].length === 0 || definition[field].some((type) => typeof type !== "string" || !type)) {
          problems.push(`${intent} ${field} must be a non-empty string array`);
        }
      }
      if (definition.allowSourceAsTarget != null && typeof definition.allowSourceAsTarget !== "boolean") {
        problems.push(`${intent} allowSourceAsTarget must be a boolean when provided`);
      }
    }
  }
  if (!graph) return problems;

  const edgeTypes = new Set(graph.edges.map((edge) => edge.type));
  const nodeTypes = new Set(graph.nodes.map((node) => node.type));
  for (const edgeType of edgeTypes) {
    if (typeof policy.edgeCosts?.[edgeType] !== "number") problems.push(`missing edge cost for ${edgeType}`);
  }
  if (checkNodeTypes) {
    for (const type of policy.excludedIntermediateTypes || []) {
      if (!nodeTypes.has(type)) problems.push(`unknown excluded node type ${type}`);
    }
    for (const [intent, definition] of Object.entries(policy.intents || {})) {
      for (const type of [...(definition.preferredTargetTypes || []), ...(definition.preferredSourceTypes || [])]) {
        if (!nodeTypes.has(type)) problems.push(`${intent} references unknown node type ${type}`);
      }
    }
  }
  return problems;
}

function resolveNode(graph, query, preferredTypes = []) {
  const exact = graph.nodes.find((node) => node.id === query);
  if (exact) return { node: exact, candidates: [exact] };
  const preference = new Map(preferredTypes.map((type, index) => [type, preferredTypes.length - index]));
  const scored = graph.nodes
    .map((node) => ({ node, textScore: scoreNode(node, query) }))
    .filter((entry) => entry.textScore > 0)
    .sort((a, b) => b.textScore - a.textScore || a.node.id.localeCompare(b.node.id));
  if (scored.length === 0) return { node: null, candidates: [] };
  const bestTextScore = scored[0].textScore;
  const textMatches = scored.filter((entry) => entry.textScore === bestTextScore);
  const bestPreference = Math.max(...textMatches.map((entry) => preference.get(entry.node.type) || 0));
  const top = textMatches
    .filter((entry) => (preference.get(entry.node.type) || 0) === bestPreference)
    .map((entry) => entry.node)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { node: top.length === 1 ? top[0] : null, candidates: top };
}

function edgeKey(edge) {
  return `${edge.source}\u0000${edge.target}\u0000${edge.type}`;
}

function buildAdjacency(graph) {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.push({ node: edge.target, edge, direction: "forward" });
    adjacency.get(edge.target)?.push({ node: edge.source, edge, direction: "reverse" });
  }
  return adjacency;
}

function edgeCost(edge, destination, byId, policy) {
  const base = policy.edgeCosts[edge.type];
  if (typeof base !== "number") throw new Error(`Routing policy has no cost for edge type ${edge.type}`);
  const node = byId.get(destination);
  return base + (policy.hubPenalty || 0) * Math.log2((node?.degree || 0) + 1);
}

function shortestPaths(graph, sourceId, policy, targetId = null) {
  const problems = policyProblems(policy, graph, { checkNodeTypes: false });
  if (problems.length) throw new Error(`Invalid routing policy: ${problems.join("; ")}`);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildAdjacency(graph);
  const excluded = new Set(policy.excludedIntermediateTypes || []);
  const distances = new Map([[sourceId, 0]]);
  const previous = new Map();
  const pending = new Set([sourceId]);

  while (pending.size) {
    let current = null;
    for (const id of pending) {
      if (!current || distances.get(id) < distances.get(current) || (distances.get(id) === distances.get(current) && id < current)) current = id;
    }
    pending.delete(current);
    for (const step of adjacency.get(current) || []) {
      if (step.node !== sourceId && step.node !== targetId && excluded.has(byId.get(step.node)?.type)) continue;
      const next = distances.get(current) + edgeCost(step.edge, step.node, byId, policy);
      const known = distances.get(step.node);
      const previousKey = previous.get(step.node) ? edgeKey(previous.get(step.node).edge) : "";
      const candidateKey = edgeKey(step.edge);
      if (known == null || next < known || (next === known && candidateKey < previousKey)) {
        distances.set(step.node, next);
        previous.set(step.node, { from: current, edge: step.edge, direction: step.direction });
        pending.add(step.node);
      }
    }
  }
  return { distances, previous };
}

function reconstructRoute(sourceId, targetId, previous) {
  if (sourceId === targetId) return { nodes: [sourceId], steps: [] };
  const steps = [];
  const nodes = [targetId];
  let current = targetId;
  while (current !== sourceId) {
    const item = previous.get(current);
    if (!item) return null;
    steps.unshift({ ...item, to: current });
    current = item.from;
    nodes.unshift(current);
  }
  return { nodes, steps };
}

function targetForIntent(graph, source, intent, policy, distances) {
  const intentPolicy = policy.intents[intent];
  const targetTypes = intentPolicy?.preferredTargetTypes;
  if (!targetTypes) throw new Error(`Unknown route intent: ${intent}`);
  if (intentPolicy.allowSourceAsTarget && targetTypes.includes(source.type)) return source;
  const order = new Map(targetTypes.map((type, index) => [type, index]));
  const candidates = graph.nodes
    .filter((node) => node.id !== source.id && order.has(node.type) && distances.has(node.id))
    .sort((a, b) => {
      const cost = distances.get(a.id) - distances.get(b.id);
      if (cost) return cost;
      const type = order.get(a.type) - order.get(b.type);
      return type || a.id.localeCompare(b.id);
    });
  return candidates[0] || null;
}

function edgeDescription(step) {
  const arrow = step.direction === "forward" ? "→" : "←";
  return `${arrow} ${step.edge.type}`;
}

function authorityReason(step) {
  return `included because ${step.edge.source} declares the ${step.edge.type} relationship`;
}

function route(graph, { intent, query, from, to, policy = loadPolicy() }) {
  const problems = policyProblems(policy, graph, { checkNodeTypes: false });
  if (problems.length) return { status: "invalid-policy", intent, candidates: [], problems };
  if (!policy.intents[intent]) return { status: "invalid-intent", intent, candidates: [] };
  const sourceResolution = resolveNode(graph, from || query, policy.intents[intent].preferredSourceTypes || []);
  if (!sourceResolution.node) {
    return { status: sourceResolution.candidates.length ? "ambiguous-source" : "missing-source", intent, candidates: sourceResolution.candidates };
  }
  const source = sourceResolution.node;
  let target;
  if (to) {
    const targetResolution = resolveNode(graph, to);
    if (!targetResolution.node) {
      return { status: targetResolution.candidates.length ? "ambiguous-target" : "missing-target", intent, source, candidates: targetResolution.candidates };
    }
    target = targetResolution.node;
  }
  const paths = shortestPaths(graph, source.id, policy, target?.id || null);
  if (!target) {
    target = targetForIntent(graph, source, intent, policy, paths.distances);
  }
  if (!target) return { status: "no-route", intent, source, candidates: [] };
  const result = reconstructRoute(source.id, target.id, paths.previous);
  if (!result) return { status: "no-route", intent, source, target, candidates: [] };
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return {
    status: "ok",
    intent,
    source,
    target,
    cost: Number((paths.distances.get(target.id) || 0).toFixed(3)),
    candidates: [],
    itinerary: result.nodes.map((id, index) => ({
      id,
      label: byId.get(id).label,
      type: byId.get(id).type,
      relation: index === 0 ? "query match" : edgeDescription(result.steps[index - 1]),
      authority: index === 0
        ? "included because it is the strongest textual match for the selected intent"
        : authorityReason(result.steps[index - 1]),
    })),
    steps: result.steps,
  };
}

function formatRoute(result) {
  if (result.status !== "ok") {
    const candidates = result.candidates?.map((node) => `- ${node.id}`).join("\n");
    const problems = result.problems?.map((problem) => `- ${problem}`).join("\n");
    return [`Route unavailable: ${result.status}.`, problems || "", candidates || ""].filter(Boolean).join("\n") + "\n";
  }
  const lines = [`Route (${result.intent}, cost ${result.cost}):`];
  for (const [index, item] of result.itinerary.entries()) {
    lines.push(`${index + 1}. ${item.id} — ${item.relation}; ${item.authority}`);
  }
  return lines.join("\n") + "\n";
}

module.exports = { POLICY_PATH, REQUIRED_INTENTS, loadPolicy, policyProblems, tokenize, scoreNode, resolveNode, shortestPaths, reconstructRoute, route, formatRoute, edgeKey };
