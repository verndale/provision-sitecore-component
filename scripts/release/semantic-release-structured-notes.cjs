/* scripts/release/semantic-release-structured-notes.cjs */

function shortHash(h) {
  return (h || "").slice(0, 7);
}

function titleCaseType(type) {
  const map = {
    feat: "Features",
    fix: "Fixes",
    docs: "Docs",
    refactor: "Refactor",
    test: "Test",
    ci: "CI",
    build: "Build",
    chore: "Chore",
    revert: "Reverts",
  };
  return map[type] || `Other (${type || "unknown"})`;
}

function parseHeader(message) {
  // Conventional header: type(scope): subject
  const firstLine = (message || "").split("\n")[0].trim();
  const m = firstLine.match(/^(\w+)(\(([^)]+)\))?:\s(.+)$/);
  if (!m) return { type: null, scope: null, subject: firstLine || "" };
  return { type: m[1], scope: m[3] || null, subject: m[4] || "" };
}

function extractBreakingNotes(message) {
  const lines = (message || "").split("\n");
  const breaking = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^BREAKING CHANGE(S)?:/i.test(line)) {
      breaking.push(line.replace(/^BREAKING CHANGE(S)?:\s*/i, "").trim());
    }
  }
  return breaking;
}

function groupCommits(commits) {
  const groups = new Map(); // typeTitle -> commits[]
  for (const c of commits) {
    const header = parseHeader(c.message);
    const typeTitle = titleCaseType(header.type);
    if (!groups.has(typeTitle)) groups.set(typeTitle, []);
    groups.get(typeTitle).push({
      hash: shortHash(c.hash),
      type: header.type,
      scope: header.scope,
      subject: header.subject,
    });
  }

  // Sort groups deterministically
  const order = ["Features", "Fixes", "Docs", "Refactor", "Build", "CI", "Chore", "Test", "Reverts"];
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // Sort commits deterministically
  for (const k of keys) {
    groups.get(k).sort((a, b) => {
      const as = `${a.scope || ""} ${a.subject}`.trim();
      const bs = `${b.scope || ""} ${b.subject}`.trim();
      return as.localeCompare(bs);
    });
  }

  return { keys, groups };
}

function buildDeterministicNotes({ version, dateISO, commits }) {
  const breaking = [];
  for (const c of commits) breaking.push(...extractBreakingNotes(c.message));

  const { keys, groups } = groupCommits(commits);

  const lines = [];
  lines.push(`# v${version} — ${dateISO}`);
  lines.push("");
  lines.push("## Highlights");
  lines.push(...commits.slice(0, 8).map(c => {
    const h = parseHeader(c.message);
    const header = `${h.type || "commit"}${h.scope ? `(${h.scope})` : ""}: ${h.subject}`;
    return `- ${header} (${shortHash(c.hash)})`;
  }));
  lines.push("");

  lines.push("## Breaking changes");
  if (breaking.length === 0) {
    lines.push("- None");
  } else {
    for (const b of breaking) lines.push(`- ${b}`);
  }
  lines.push("");

  lines.push("## Changes by type");
  for (const k of keys) {
    lines.push(`### ${k}`);
    for (const item of groups.get(k)) {
      const header = `${item.type || "commit"}${item.scope ? `(${item.scope})` : ""}: ${item.subject}`;
      lines.push(`- ${header} (${item.hash})`);
    }
    lines.push("");
  }

  lines.push("## Full commit list");
  for (const c of commits) {
    const h = parseHeader(c.message);
    const header = `${h.type || "commit"}${h.scope ? `(${h.scope})` : ""}: ${h.subject}`;
    lines.push(`- ${shortHash(c.hash)} ${header}`);
  }

  lines.push("");
  return { notes: lines.join("\n"), commitRefs: commits.map(c => shortHash(c.hash)) };
}

async function maybeGenerateAiSummary({ baseNotes, commitRefs, env }) {
  // AI is OPTIONAL and endpoint-driven (supports internal gateways)
  const enabled = (env.RELEASE_NOTES_AI || "").toLowerCase() === "true";
  const endpoint = env.RELEASE_NOTES_AI_ENDPOINT;
  const apiKey = env.RELEASE_NOTES_AI_API_KEY;
  const model = env.RELEASE_NOTES_AI_MODEL || "default";

  if (!enabled || !endpoint || !apiKey) return null;

  // Provide a constrained prompt: at least one bullet must cite a commit hash.
  const system = [
    "You write release note summaries for enterprise change logs.",
    "You MUST NOT invent changes.",
    "You may ONLY summarize what appears in the provided release notes.",
    "Output MUST be 2-6 bullet points, each starting with '-'.",
    "At least one bullet MUST include a commit hash from the allowed list (e.g. 5da7620).",
    "No headings, no prose paragraphs, bullets only.",
  ].join(" ");

  const user = [
    "Allowed commit hashes:",
    commitRefs.join(", "),
    "",
    "Release notes source:",
    baseNotes,
  ].join("\n");

  // OpenAI Chat Completions and compatible APIs expect "messages"
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  const debug = (env.RELEASE_NOTES_AI_DEBUG || "").toLowerCase() === "true";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (debug) {
      const errBody = await res.text();
      console.warn("[release-notes-ai] API non-OK: %s %s", res.status, errBody.slice(0, 300));
    }
    return null;
  }
  const data = await res.json();

  // Expect `output_text`-like shape (gateway can normalize); OpenAI uses choices[].message.content
  const raw =
    data.output_text ||
    data.text ||
    (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
    (data.output && data.output[0] && data.output[0].content && data.output[0].content[0] && data.output[0].content[0].text) ||
    "";
  const text = typeof raw === "string" ? raw : "";

  if (debug) console.warn("[release-notes-ai] response text length: %d", text.length);

  const bullets = text
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s.startsWith("-"));

  if (debug) console.warn("[release-notes-ai] bullet count: %d (need >= 2)", bullets.length);

  if (bullets.length < 2) return null;

  // At least one bullet must cite an allowed commit hash (keeps summary grounded)
  const allowed = new Set(commitRefs);
  const atLeastOneHasHash = bullets.some(b => [...allowed].some(h => b.includes(h)));
  if (!atLeastOneHasHash) {
    if (debug) console.warn("[release-notes-ai] validation failed: no bullet cites a commit hash");
    return null;
  }

  return bullets.join("\n");
}

// semantic-release lifecycle hook
async function generateNotes(pluginConfig, context) {
  const version = context.nextRelease?.version;
  const dateISO = new Date().toISOString().slice(0, 10);
  const commits = context.commits || [];

  const { notes: deterministicNotes, commitRefs } = buildDeterministicNotes({
    version,
    dateISO,
    commits,
  });

  const aiSummary = await maybeGenerateAiSummary({
    baseNotes: deterministicNotes,
    commitRefs,
    env: process.env,
  });

  if (!aiSummary) return deterministicNotes;

  // Inject AI into a bounded slot (deterministic placement)
  return deterministicNotes.replace(
    "## Highlights",
    `## Summary (AI, bounded)\n${aiSummary}\n\n## Highlights`
  );
}

module.exports = {
  generateNotes,
  buildDeterministicNotes,
  groupCommits,
  parseHeader,
  extractBreakingNotes,
  shortHash,
  titleCaseType,
  maybeGenerateAiSummary,
};