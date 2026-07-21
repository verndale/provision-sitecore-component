#!/usr/bin/env node
"use strict";

// Internal agent utility. AGENTS.md directs agents to use this before reading
// broad context for cross-system questions; it is intentionally not a user
// command or package script.

const { build } = require("../graph/build-graph.cjs");
const { route, formatRoute } = require("../graph/routing.cjs");

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--intent") args.intent = argv[++i];
    else if (key === "--query") args.query = argv[++i];
    else if (key === "--from") args.from = argv[++i];
    else if (key === "--to") args.to = argv[++i];
    else if (key === "--json") args.json = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.intent || (!args.query && !args.from)) {
    console.error("FAIL usage: navigate.cjs --intent why|wiring|impact --query <term> [--from <node-id> --to <node-id>] [--json]");
    return 2;
  }
  const result = route(build(), args);
  process.stdout.write(args.json ? JSON.stringify(result, null, 2) + "\n" : formatRoute(result));
  return result.status === "ok" ? 0 : 2;
}

if (require.main === module) process.exit(main());

module.exports = { parseArgs, main };
