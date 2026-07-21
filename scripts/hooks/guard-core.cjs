"use strict";

// Shared guardrail policy for agent sessions (Claude Code + Codex). Pure
// decision functions over a tool call's shell command or file path; the
// harness adapter (pretooluse-guard.cjs) feeds it hook payloads, and the
// conformance suite (test/hooks.test.cjs) pins every decision class.
//
// Scope model: rules about the provisioning CLI itself (push gate, secrets)
// apply in every repo, because setup.sh registers the guard user-level; rules
// that encode THIS repo's contributor boundaries (deliver-and-handoff,
// generated/vendored/golden files) activate only when the session cwd is
// inside this repo. Consumer repos keep their own commit policy.
//
// Honest-agent drift prevention, not adversarial sandboxing: segment parsing
// is quote-naive and evasion (sh -c, temp scripts) is out of scope by design.

const fs = require("fs");
const path = require("path");
const os = require("os");

const PKG_NAME = "@verndale/provision-sitecore-component";
const CLI_BASENAMES = new Set(["cli.cjs", "provision-sitecore-component"]);
const LAUNCHERS = new Set(["node", "npx", "pnpm", "npm", "yarn"]);
const READERS = new Set([
  "cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg",
  "sed", "awk", "cut", "tr", "sort", "uniq", "nl", "wc", "od", "xxd",
  "hexdump", "strings", "base64", "cp", "mv", "dd", "tee", "rsync", "scp",
  "open", "code", "vi", "vim", "nvim", "nano", "emacs", "source", ".",
]);
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
const GIT_TAG_READONLY = /^(-l|--list|-n\d*|--sort(=.*)?|--format(=.*)?|--contains|--points-at|--merged|--no-merged)$/;

const REASONS = {
  handoff:
    "Version control here is deliver-and-handoff: leave an uncommitted working tree plus a suggested Conventional Commits message; the repo owner commits, pushes, merges, tags, and releases (AGENTS.md, Hard boundaries).",
  pushGate:
    "provision-sitecore-component push mutates a shared Sitecore CMS environment. Approve only if the SKILL.md step-6 gate (one AskUserQuestion) was answered with approval in THIS session; the CLI additionally requires --yes or an interactive confirm (SKILL.md, Guardrails).",
  envRead:
    "Agents never need .env values: node src/cli.cjs check names any missing variables without exposing them (authoring-api.md, Authentication). Secret values must not enter the transcript.",
  secrets:
    "SITECORE_AUTHORING_* / OPENAI_API_KEY values must never be echoed into chat, logs, or files (SKILL.md, Guardrails). Use node src/cli.cjs check to verify configuration without exposing values.",
  generated:
    "This file is generated — edit the graph inputs instead and run pnpm graph:build to regenerate (wiki/MECHANICS.md, Generated pages).",
  vendored:
    "This file is vendored from verndale/ai-orchestration — re-sync from the source repo instead of editing here (CONTRIBUTING.md).",
  golden:
    "Golden fixtures are regenerated with the tool itself and committed — never hand-edited to quiet a diff (CONTRIBUTING.md).",
  envEdit:
    "Never write secrets or .env files through an agent session; use setup.sh's credential bootstrap or edit the file yourself outside the session.",
};

function deny(reason) {
  return { decision: "deny", reason };
}

function ask(reason) {
  return { decision: "ask", reason };
}

function centralEnvFile() {
  return path.join(os.homedir(), ".config", "provision-sitecore-component", ".env");
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Walk up from cwd classifying the session: this repo, a provisioning repo, or neither. */
function buildContext(cwd) {
  const start = path.resolve(cwd || process.cwd());
  const ctx = { cwd: start, inToolRepo: false, toolRepoRoot: null, inProvisioningRepo: false };
  let dir = start;
  for (let depth = 0; depth < 24; depth += 1) {
    if (!ctx.inToolRepo) {
      const pkg = readJsonSafe(path.join(dir, "package.json"));
      if (pkg && pkg.name === PKG_NAME) {
        ctx.inToolRepo = true;
        ctx.toolRepoRoot = dir;
      }
    }
    if (!ctx.inProvisioningRepo) {
      if (fs.existsSync(path.join(dir, "provision.config.json"))) {
        ctx.inProvisioningRepo = true;
      } else {
        const build = readJsonSafe(path.join(dir, "build.config.json"));
        if (build && build.stackAdapter === "sitecore-ai") ctx.inProvisioningRepo = true;
      }
    }
    // Stop early: both classifications known, or we've reached a repo root
    // (config files live at the root, never above it — no reason to keep walking).
    if (ctx.inToolRepo && ctx.inProvisioningRepo) break;
    if (fs.existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return ctx;
}

/** Quote-naive split of a compound command into pipeline/sequence segments. */
function splitSegments(command) {
  return String(command || "")
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Whitespace tokens, surrounding quotes stripped, leading KEY=val assignments dropped. */
function commandTokens(segment) {
  const tokens = String(segment || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/^["']+|["']+$/g, ""));
  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  return tokens;
}

/** First git subcommand token, skipping global options (git -C x commit → commit). */
function gitSubcommand(tokens) {
  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.startsWith("-")) return { sub: token, rest: tokens.slice(i + 1) };
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    if (GIT_VALUE_OPTS.has(name) && eq === -1) i += 2;
    else i += 1;
  }
  return { sub: null, rest: [] };
}

function decideGit(tokens, prog) {
  if (prog !== "git") return null;
  const { sub, rest } = gitSubcommand(tokens);
  if (sub === "commit" || sub === "push" || sub === "merge") return deny(REASONS.handoff);
  if (sub === "tag") {
    if (rest.length === 0 || GIT_TAG_READONLY.test(rest[0])) return null;
    return deny(REASONS.handoff);
  }
  return null;
}

function decideGh(tokens, prog) {
  if (prog !== "gh") return null;
  if (tokens[1] === "pr" && (tokens[2] === "create" || tokens[2] === "merge")) return deny(REASONS.handoff);
  if (tokens[1] === "release" && tokens[2] && !["list", "view", "download"].includes(tokens[2])) {
    return deny(REASONS.handoff);
  }
  return null;
}

function decideReleaseTooling(segment, tokens, prog) {
  // Resolve the effective binary (unwrapping pnpm/npm/yarn/npx launchers) and,
  // separately, a package script name, then apply the deny rules once.
  let bin = prog;
  let script = null;
  if (prog === "pnpm" || prog === "npm" || prog === "yarn") {
    const t1 = tokens[1];
    if (t1 === "exec" || t1 === "dlx") bin = tokens[2] ? path.basename(tokens[2]) : null;
    else if (t1 === "run") {
      bin = null;
      script = tokens[2];
    } else {
      bin = null;
      script = t1;
    }
  } else if (prog === "npx") {
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith("-")) i += 1;
    bin = tokens[i] ? path.basename(tokens[i]) : null;
  }
  if (bin === "ai-commit" || bin === "ai-pr") return deny(REASONS.handoff);
  if (bin === "semantic-release" && !/--dry-run\b/.test(segment)) return deny(REASONS.handoff);
  if (script === "commit" || script === "pr:create") return deny(REASONS.handoff);
  return null;
}

function decidePush(segment, tokens, prog) {
  const firstIsCli = CLI_BASENAMES.has(prog);
  if (!LAUNCHERS.has(prog) && !firstIsCli) return null;
  if (
    prog === "node" &&
    tokens.some((t) => ["-e", "--eval", "-p", "--print"].includes(t)) &&
    /executor\.cjs|runPlan/.test(segment) &&
    /\bpush\b/.test(segment)
  ) {
    return ask(REASONS.pushGate);
  }
  const cliIdx = tokens.findIndex((t) => CLI_BASENAMES.has(path.basename(t)));
  if (cliIdx === -1) return null;
  let i = cliIdx + 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === "--config") {
      i += 2;
      continue;
    }
    if (token.startsWith("-")) {
      i += 1;
      continue;
    }
    return token === "push" ? ask(REASONS.pushGate) : null;
  }
  return null;
}

function decideEnvRead(segment, tokens, prog, ctx) {
  if (!READERS.has(prog)) return null;
  // The central credential file is protected in every repo.
  if (/provision-sitecore-component\/\.env(?!\.)/.test(segment)) return deny(REASONS.envRead);
  if (!ctx.inToolRepo && !ctx.inProvisioningRepo) return null;
  // cp reads its SOURCE operand: deny only when that is the real `.env`, so the
  // documented bootstrap `cp .env.example .env` stays allowed while
  // `cp .env <anywhere>` (copying secrets out) is denied. Checked on the source
  // alone, not a substring of the whole command.
  if (prog === "cp") {
    const source = tokens.slice(1).find((t) => !t.startsWith("-"));
    return source && /(^|\/)\.env$/.test(source) ? deny(REASONS.envRead) : null;
  }
  if (/(^|[\s"'=:\/])\.env(?=$|[\s"');|&,])/.test(segment)) return deny(REASONS.envRead);
  return null;
}

/** True when env/printenv is being used to PRINT the environment (not to run a command). */
function isEnvDump(prog, tokens) {
  if (prog === "printenv") return tokens.slice(1).every((t) => t.startsWith("-"));
  if (prog === "env") {
    for (let i = 1; i < tokens.length; i += 1) {
      const t = tokens[i];
      if (t === "-u" || t === "--unset") {
        i += 1;
        continue;
      }
      if (t.startsWith("-")) continue;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;
      return false; // a command to run follows — not a dump
    }
    return true;
  }
  return false;
}

function decideSegment(segment, ctx) {
  const tokens = commandTokens(segment);
  if (tokens.length === 0) return null;
  const prog = path.basename(tokens[0]);
  // A bare env/printenv prints every variable, secrets included, into the transcript.
  if ((prog === "printenv" || prog === "env") && isEnvDump(prog, tokens)) return deny(REASONS.secrets);
  if (prog === "printenv" && tokens.slice(1).some((t) => /^(SITECORE_AUTHORING_|OPENAI_API_KEY)/.test(t))) {
    return deny(REASONS.secrets);
  }
  if (ctx.inToolRepo) {
    const git = decideGit(tokens, prog);
    if (git) return git;
    const gh = decideGh(tokens, prog);
    if (gh) return gh;
    const release = decideReleaseTooling(segment, tokens, prog);
    if (release) return release;
  }
  const push = decidePush(segment, tokens, prog);
  if (push) return push;
  return decideEnvRead(segment, tokens, prog, ctx);
}

/** Decide a shell command. Returns {decision, reason} or null (allow). */
function decideBash(command, ctx) {
  const full = String(command || "");
  // Full-command secret checks — pipes are split away at segment level.
  if (/\$\{?(SITECORE_AUTHORING_[A-Z0-9_]*|OPENAI_API_KEY)/.test(full)) return deny(REASONS.secrets);
  if (/process\.env\.(SITECORE_AUTHORING_|OPENAI_API_KEY)/.test(full)) return deny(REASONS.secrets);
  if (/\b(printenv|env)\b[^|&;]*\|[^|]*\bgrep\b.*(SITECORE_AUTHORING|OPENAI_API_KEY)/.test(full)) {
    return deny(REASONS.secrets);
  }
  for (const segment of splitSegments(full)) {
    const decision = decideSegment(segment, ctx);
    if (decision) return decision;
  }
  return null;
}

/** Decide a file edit/write target. Returns {decision, reason} or null (allow). */
function decideFile(filePath, ctx) {
  if (!filePath) return null;
  const resolved = path.resolve(ctx.cwd || process.cwd(), String(filePath));
  if (resolved === centralEnvFile()) return deny(REASONS.envEdit);
  if (ctx.inToolRepo && ctx.toolRepoRoot) {
    const rel = path.relative(ctx.toolRepoRoot, resolved).split(path.sep).join("/");
    if (!rel.startsWith("..")) {
      if (rel === ".env") return deny(REASONS.envEdit);
      if (rel === "wiki/connections.md" || rel.startsWith("wiki/connections/") || rel === "scripts/graph/data/graph.json") {
        return deny(REASONS.generated);
      }
      if (rel.startsWith("skills/_meta/") || rel === "skills/provision-sitecore-component/references/retry-contract.md") {
        return deny(REASONS.vendored);
      }
      // Matches the CONTRIBUTING glob test/fixtures/*/expected* — any golden,
      // not only expected-plan.json / expected/, so a new golden name is covered.
      if (/^test\/fixtures\/[^/]+\/expected/.test(rel)) return deny(REASONS.golden);
      return null;
    }
  }
  if (ctx.inProvisioningRepo && path.basename(resolved) === ".env") return deny(REASONS.envEdit);
  return null;
}

module.exports = {
  PKG_NAME,
  REASONS,
  buildContext,
  centralEnvFile,
  commandTokens,
  decideBash,
  decideFile,
  gitSubcommand,
  splitSegments,
};
