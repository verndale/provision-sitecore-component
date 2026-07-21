#!/usr/bin/env node
"use strict";

/**
 * provision-sitecore-component — CLI entry.
 *
 * Usage:
 *   provision-sitecore-component [plan] <manifest.json> [--no-tsx] [--force-tsx] [--config <path>]
 *   provision-sitecore-component check  <manifest.json> [--config <path>]
 *   provision-sitecore-component push   <manifest.json> [--no-tsx] [--force-tsx] [--config <path>]
 *
 * Modes:
 *   plan  (default) offline: validate the manifest, write <slug>.plan.json next to it,
 *         emit the TSX scaffold pair (create-only) at the manifest's output path.
 *   check online, read-only: preflight the plan against the CMS and print per-op
 *         decisions (create / update / no-op / conflict). Never mutates.
 *   push  online, mutating: execute the plan (create-or-update, add-only, never
 *         deletes), then emit the TSX pair like plan mode.
 *
 * Config resolution: --config <path> → ./provision.config.json → ./build.config.json
 * (key sitecoreProvisioning; requires stackAdapter "sitecore-ai") → {} (paths must
 * then come from manifest.sitecorePaths).
 *
 * Exit codes: 0 success or clean skip · 1 API/auth/conflict failure · 2 invocation,
 * config, or manifest-validation error.
 */

const fs = require("node:fs");
const path = require("node:path");

const { validateManifest } = require("./validate-manifest.cjs");
const { buildMutationPlan, serializePlan } = require("./build-plan.cjs");
const { emitTypes, emitComponent } = require("./emit-tsx.cjs");
const { runPlan, ExecutorError } = require("./executor.cjs");

const MODES = ["plan", "check", "push"];

function fail(message, cause, next) {
  process.stderr.write(`ERROR: ${message} Cause: ${cause} Next: ${next}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { mode: "plan", manifestPath: null, noTsx: false, forceTsx: false, configPath: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-tsx") args.noTsx = true;
    else if (arg === "--force-tsx") args.forceTsx = true;
    else if (arg === "--config") {
      i += 1;
      if (!argv[i]) return { error: "--config requires a path argument." };
      args.configPath = argv[i];
    } else if (arg.startsWith("-")) {
      return { error: `Unknown flag "${arg}".` };
    } else {
      positional.push(arg);
    }
  }
  if (positional.length === 0) return { error: "No manifest path given." };
  if (MODES.includes(positional[0])) {
    args.mode = positional.shift();
  }
  if (positional.length !== 1) {
    return { error: positional.length === 0 ? "No manifest path given." : `Unexpected argument(s): ${positional.slice(1).join(", ")}.` };
  }
  args.manifestPath = positional[0];
  return { args };
}

function readJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { error: `${label} not found at ${filePath}.` };
  }
  try {
    return { value: JSON.parse(raw) };
  } catch (cause) {
    return { error: `${label} at ${filePath} is not valid JSON (${cause.message}).` };
  }
}

/**
 * Resolve the provisioning config. Returns { config } or { error, cause, next }.
 * The sitecore-ai adapter gate applies only when build.config.json is the source —
 * standalone use via --config / provision.config.json has no adapter concept.
 */
function loadConfig(cwd, configPath) {
  if (configPath) {
    const result = readJson(path.resolve(cwd, configPath), "Config file");
    if (result.error) return { error: result.error, cause: "--config must point at a readable JSON file.", next: "Fix the path or remove --config." };
    return { config: result.value };
  }
  const standalone = path.join(cwd, "provision.config.json");
  if (fs.existsSync(standalone)) {
    const result = readJson(standalone, "provision.config.json");
    if (result.error) return { error: result.error, cause: "provision.config.json exists but did not parse.", next: "Fix the JSON syntax." };
    return { config: result.value };
  }
  const buildConfig = path.join(cwd, "build.config.json");
  if (fs.existsSync(buildConfig)) {
    const result = readJson(buildConfig, "build.config.json");
    if (result.error) return { error: result.error, cause: "build.config.json exists but did not parse.", next: "Fix the JSON syntax." };
    const value = result.value;
    if (value.stackAdapter !== "sitecore-ai") {
      return {
        error: `build.config.json has stackAdapter "${value.stackAdapter}".`,
        cause: "This tool provisions Sitecore XM Cloud components and only runs in repos using the sitecore-ai adapter.",
        next: "Run it from a sitecore-ai app repo, or supply a standalone config via --config / provision.config.json.",
      };
    }
    return { config: value.sitecoreProvisioning || {} };
  }
  return { config: {} };
}

/** Minimal .env loader (KEY=VALUE lines; existing process env wins). No dependency. */
function loadDotEnv(cwd, env) {
  const file = path.join(cwd, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (env[key] !== undefined) continue;
    env[key] = match[2].replace(/^["']|["']$/g, "");
  }
}

function emitTsxPair(manifest, resolved, cwd, { forceTsx }) {
  const outDir = path.resolve(cwd, manifest.output);
  fs.mkdirSync(outDir, { recursive: true });
  const files = [
    { name: `${manifest.component}.types.ts`, content: emitTypes(manifest, resolved) },
    { name: `${manifest.component}.tsx`, content: emitComponent(manifest) },
  ];
  const lines = [];
  for (const file of files) {
    const target = path.join(outDir, file.name);
    if (fs.existsSync(target) && !forceTsx) {
      lines.push(`skipped (exists) ${path.relative(cwd, target)}`);
      continue;
    }
    fs.writeFileSync(target, file.content);
    lines.push(`wrote ${path.relative(cwd, target)}`);
  }
  return lines;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    fail(parsed.error, "Expected: provision-sitecore-component [plan|check|push] <manifest.json> [--no-tsx] [--force-tsx] [--config <path>].", "Fix the invocation and re-run.");
  }
  const { mode, manifestPath, noTsx, forceTsx, configPath } = parsed.args;
  const cwd = process.cwd();

  const configResult = loadConfig(cwd, configPath);
  if (configResult.error) {
    fail(configResult.error, configResult.cause, configResult.next);
  }

  const manifestFile = path.resolve(cwd, manifestPath);
  const manifestResult = readJson(manifestFile, "Manifest");
  if (manifestResult.error) {
    fail(manifestResult.error, "The manifest must be a readable JSON file.", "Check the path, or draft a manifest per the manifest contract.");
  }
  const manifest = manifestResult.value;

  const { ok, errors, resolved } = validateManifest(manifest, configResult.config);
  if (!ok) {
    for (const e of errors) {
      process.stderr.write(`ERROR: ${e.message} Cause: ${e.cause} Next: ${e.next}\n`);
    }
    process.exit(2);
  }

  const plan = buildMutationPlan(manifest, resolved, path.basename(manifestFile));
  const planFile = path.join(path.dirname(manifestFile), `${manifest.slug}.plan.json`);
  fs.writeFileSync(planFile, serializePlan(plan));
  process.stdout.write(`wrote ${path.relative(cwd, planFile)}\n`);

  if (mode === "check" || mode === "push") {
    loadDotEnv(cwd, process.env);
    try {
      const outcome = await runPlan(plan, {
        mode,
        env: process.env,
        log: (line) => process.stdout.write(`${line}\n`),
      });
      if (outcome.followUps.length > 0) {
        process.stdout.write("Manual follow-ups:\n");
        for (const followUp of outcome.followUps) {
          process.stdout.write(`  - ${followUp}\n`);
        }
      }
    } catch (error) {
      if (error instanceof ExecutorError) {
        if (error.kind === "config") {
          fail(error.message, "check/push need the Authoring API environment variables.", error.next || "Set them and re-run.");
        }
        process.stderr.write(`ERROR: ${error.message}${error.next ? ` Next: ${error.next}` : ""}\n`);
        process.exit(1);
      }
      throw error;
    }
  }

  if (!noTsx && mode !== "check") {
    for (const line of emitTsxPair(manifest, resolved, cwd, { forceTsx })) {
      process.stdout.write(`${line}\n`);
    }
  }

  process.stdout.write(`${mode} complete for ${manifest.component} (${plan.ops.length} op(s)).\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, loadConfig, loadDotEnv, emitTsxPair, main };
