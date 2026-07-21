#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_SCENARIO_FIELDS = [
  "id",
  "title",
  "skills",
  "query",
  "files",
  "expected_behavior",
  "must_not",
  "tags",
  "gap",
];

// Minimum character counts that force each scenario field to be substantive rather
// than a stub. The 20-char fields (query, expected_behavior items, gap) require a full
// descriptive sentence; the shorter ones (must_not = 10, title = 5) require a
// meaningful phrase rather than a single word.
const MIN_LENGTH = {
  title: 5,
  query: 20,
  behavior: 20,
  mustNot: 10,
  gap: 20,
};

const PLACEHOLDER_PATTERN = /\b(TBD|TODO|placeholder)\b/i;

function readJsonFile(filePath) {
  try {
    return {
      value: JSON.parse(fs.readFileSync(filePath, "utf8")),
      error: null,
    };
  } catch (error) {
    return {
      value: null,
      error: `${filePath}: invalid JSON (${error.message})`,
    };
  }
}

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRepoRelativeFile(fileRef) {
  return typeof fileRef === "string" && fileRef.length > 0 && !path.isAbsolute(fileRef) && !fileRef.includes("\\");
}

function resolveInsideRepo(repoRoot, relativePath) {
  const resolvedPath = path.resolve(repoRoot, relativePath);
  const relativeToRoot = path.relative(repoRoot, resolvedPath);
  const isInside = resolvedPath === repoRoot || (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot));
  return {
    resolvedPath,
    isInside,
  };
}

function hasPlaceholder(text) {
  return typeof text === "string" && PLACEHOLDER_PATTERN.test(text);
}

function validateCoveragePolicy(policy, label) {
  const errors = [];

  if (!isPlainObject(policy)) {
    return [`${label}: coverage policy must be a JSON object.`];
  }

  if (!Number.isInteger(policy.version) || policy.version < 1) {
    errors.push(`${label}: "version" must be a positive integer.`);
  }

  if (!Number.isInteger(policy.globalMinScenarios) || policy.globalMinScenarios < 1) {
    errors.push(`${label}: "globalMinScenarios" must be an integer greater than 0.`);
  }

  if (!Array.isArray(policy.allowedTags) || policy.allowedTags.length === 0) {
    errors.push(`${label}: "allowedTags" must be a non-empty array.`);
  } else {
    const seenTags = new Set();
    for (const tag of policy.allowedTags) {
      if (typeof tag !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) {
        errors.push(`${label}: allowed tag "${tag}" must use lowercase kebab-case.`);
        continue;
      }
      if (seenTags.has(tag)) {
        errors.push(`${label}: duplicate allowed tag "${tag}".`);
      }
      seenTags.add(tag);
    }
  }

  if (!isPlainObject(policy.requiredSkills) || Object.keys(policy.requiredSkills).length === 0) {
    errors.push(`${label}: "requiredSkills" must be a non-empty object keyed by skill name.`);
    return errors;
  }

  const allowedTags = new Set(policy.allowedTags || []);
  for (const [skillName, skillPolicy] of Object.entries(policy.requiredSkills)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
      errors.push(`${label}: required skill "${skillName}" must use lowercase kebab-case.`);
    }

    if (!isPlainObject(skillPolicy)) {
      errors.push(`${label}: required skill "${skillName}" must map to an object.`);
      continue;
    }

    if (!Number.isInteger(skillPolicy.minScenarios) || skillPolicy.minScenarios < 1) {
      errors.push(`${label}: skill "${skillName}" must declare "minScenarios" >= 1.`);
    }

    if (!Array.isArray(skillPolicy.requiredTags) || skillPolicy.requiredTags.length === 0) {
      errors.push(`${label}: skill "${skillName}" must declare a non-empty "requiredTags" array.`);
    } else {
      for (const tag of skillPolicy.requiredTags) {
        if (!allowedTags.has(tag)) {
          errors.push(`${label}: skill "${skillName}" requires unknown tag "${tag}".`);
        }
      }
    }

    if (skillPolicy.requireAnyTags !== undefined) {
      if (!Array.isArray(skillPolicy.requireAnyTags) || skillPolicy.requireAnyTags.length === 0) {
        errors.push(`${label}: skill "${skillName}" must use a non-empty "requireAnyTags" array when present.`);
      } else {
        for (const tag of skillPolicy.requireAnyTags) {
          if (!allowedTags.has(tag)) {
            errors.push(`${label}: skill "${skillName}" requires unknown planning tag "${tag}".`);
          }
        }
      }
    }
  }

  // excludedSkills is the opt-out half of the coverage contract: a skill deliberately kept
  // out of requiredSkills, with a stated reason. Structural only (no disk) — this also runs
  // on fixture policies. Absent is valid (backward-compatible with policies that predate it).
  if (policy.excludedSkills !== undefined) {
    if (!isPlainObject(policy.excludedSkills)) {
      errors.push(`${label}: "excludedSkills" must be an object keyed by skill name when present.`);
    } else {
      const requiredNames = new Set(Object.keys(policy.requiredSkills));
      for (const [skillName, entry] of Object.entries(policy.excludedSkills)) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
          errors.push(`${label}: excluded skill "${skillName}" must use lowercase kebab-case.`);
        }
        if (!isPlainObject(entry)) {
          errors.push(`${label}: excluded skill "${skillName}" must map to an object.`);
          continue;
        }
        if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
          errors.push(`${label}: excluded skill "${skillName}" must declare a non-empty "reason" string.`);
        }
        if (requiredNames.has(skillName)) {
          errors.push(`${label}: skill "${skillName}" cannot be in both requiredSkills and excludedSkills.`);
        }
      }
    }
  }

  return errors;
}

// Every skill directory (a skills/<name>/ that carries a SKILL.md) must be
// classified as either required or explicitly excluded — so a new skill cannot silently
// escape eval coverage. `_meta`/`_shared` carry no SKILL.md and fall out naturally.
function listSkillNames(repoRoot) {
  const skillsRoot = path.join(repoRoot, "skills");
  if (!fs.existsSync(skillsRoot)) return [];
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(skillsRoot, name, "SKILL.md")))
    .sort((left, right) => left.localeCompare(right));
}

// Pure, bidirectional completeness: (1) every skill on disk is required-or-excluded, and
// (2) every policy name maps to a real SKILL.md (catches a stale or renamed entry).
function coverageCompletenessErrors(skillNames, requiredSkills, excludedSkills) {
  const errors = [];
  const required = new Set(Object.keys(requiredSkills || {}));
  const excluded = new Set(Object.keys(excludedSkills || {}));
  const present = new Set(skillNames || []);

  for (const name of [...present].sort((a, b) => a.localeCompare(b))) {
    if (!required.has(name) && !excluded.has(name)) {
      errors.push(
        `coverage-policy.json: skill "${name}" has a SKILL.md but is in neither requiredSkills nor excludedSkills (add it to one).`
      );
    }
  }
  for (const name of [...required].sort((a, b) => a.localeCompare(b))) {
    if (!present.has(name)) {
      errors.push(
        `coverage-policy.json: requiredSkills names "${name}" but no skills/${name}/SKILL.md exists (stale or renamed entry).`
      );
    }
  }
  for (const name of [...excluded].sort((a, b) => a.localeCompare(b))) {
    if (!present.has(name)) {
      errors.push(
        `coverage-policy.json: excludedSkills names "${name}" but no skills/${name}/SKILL.md exists (stale or renamed entry).`
      );
    }
  }
  return errors;
}

function validateSchemaDocument(schemaDoc, coveragePolicy, label) {
  const errors = [];

  if (!isPlainObject(schemaDoc)) {
    return [`${label}: scenario schema must be a JSON object.`];
  }

  if (schemaDoc.type !== "object") {
    errors.push(`${label}: scenario schema must declare top-level "type": "object".`);
  }

  if (schemaDoc.additionalProperties !== false) {
    errors.push(`${label}: scenario schema must set "additionalProperties" to false.`);
  }

  const schemaRequired = new Set(Array.isArray(schemaDoc.required) ? schemaDoc.required : []);
  for (const field of REQUIRED_SCENARIO_FIELDS) {
    if (!schemaRequired.has(field)) {
      errors.push(`${label}: scenario schema is missing required field "${field}".`);
    }
  }

  const schemaTags =
    schemaDoc.properties &&
    schemaDoc.properties.tags &&
    schemaDoc.properties.tags.items &&
    Array.isArray(schemaDoc.properties.tags.items.enum)
      ? new Set(schemaDoc.properties.tags.items.enum)
      : null;

  if (!schemaTags) {
    errors.push(`${label}: scenario schema must enumerate tag values under properties.tags.items.enum.`);
  } else {
    const allowedTags = new Set(coveragePolicy.allowedTags || []);
    for (const tag of allowedTags) {
      if (!schemaTags.has(tag)) {
        errors.push(`${label}: scenario schema is missing allowed tag "${tag}".`);
      }
    }
    for (const tag of schemaTags) {
      if (!allowedTags.has(tag)) {
        errors.push(`${label}: scenario schema contains tag "${tag}" that is not allowed by coverage policy.`);
      }
    }
  }

  return errors;
}

function validateScenarioRecord(record, repoRoot, coveragePolicy, seenIds) {
  const errors = [];
  const { data, sourceLabel, skillFolder } = record;

  if (!isPlainObject(data)) {
    return {
      errors: [`${sourceLabel}: scenario payload must be a JSON object.`],
      skillName: null,
      tags: [],
    };
  }

  const unknownKeys = Object.keys(data).filter((key) => !REQUIRED_SCENARIO_FIELDS.includes(key));
  if (unknownKeys.length > 0) {
    errors.push(`${sourceLabel}: unknown scenario field(s): ${unknownKeys.join(", ")}.`);
  }

  for (const field of REQUIRED_SCENARIO_FIELDS) {
    if (!(field in data)) {
      errors.push(`${sourceLabel}: missing required field "${field}".`);
    }
  }

  const skillNames = Array.isArray(data.skills) ? data.skills : [];
  if (!Array.isArray(data.skills) || data.skills.length !== 1) {
    errors.push(`${sourceLabel}: "skills" must be a single-item array.`);
  }

  const skillName = skillNames.length === 1 && typeof skillNames[0] === "string" ? skillNames[0] : null;
  const knownSkills = new Set(Object.keys(coveragePolicy.requiredSkills || {}));
  if (skillName && !knownSkills.has(skillName)) {
    errors.push(`${sourceLabel}: unknown skill name "${skillName}" (add it to coverage-policy.json first).`);
  }

  if (skillName && skillFolder !== skillName) {
    errors.push(`${sourceLabel}: scenario skill "${skillName}" does not match parent folder "${skillFolder}".`);
  }

  if (typeof data.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(data.id)) {
    errors.push(`${sourceLabel}: "id" must use lowercase kebab-case and include the skill prefix.`);
  } else {
    if (skillName && !data.id.startsWith(`${skillName}-`)) {
      errors.push(`${sourceLabel}: scenario id "${data.id}" must start with "${skillName}-".`);
    }
    if (seenIds.has(data.id)) {
      errors.push(`${sourceLabel}: duplicate scenario id "${data.id}".`);
    }
    seenIds.add(data.id);
  }

  if (typeof data.title !== "string" || data.title.trim().length < MIN_LENGTH.title) {
    errors.push(`${sourceLabel}: "title" must be a non-empty string of at least ${MIN_LENGTH.title} characters.`);
  }

  if (typeof data.query !== "string" || data.query.trim().length < MIN_LENGTH.query) {
    errors.push(`${sourceLabel}: "query" must be at least ${MIN_LENGTH.query} characters.`);
  } else if (hasPlaceholder(data.query)) {
    errors.push(`${sourceLabel}: "query" must not contain TODO/TBD placeholders.`);
  }

  if (!Array.isArray(data.files) || data.files.length === 0) {
    errors.push(`${sourceLabel}: "files" must be a non-empty array of repo-relative file paths.`);
  } else {
    const seenFiles = new Set();
    for (const fileRef of data.files) {
      if (!isRepoRelativeFile(fileRef)) {
        errors.push(`${sourceLabel}: file reference "${fileRef}" must be repo-relative and use forward slashes.`);
        continue;
      }
      if (seenFiles.has(fileRef)) {
        errors.push(`${sourceLabel}: duplicate file reference "${fileRef}".`);
        continue;
      }
      seenFiles.add(fileRef);

      const { resolvedPath, isInside } = resolveInsideRepo(repoRoot, fileRef);
      if (!isInside) {
        errors.push(`${sourceLabel}: file reference "${fileRef}" escapes the repo root.`);
        continue;
      }
      if (!fs.existsSync(resolvedPath)) {
        errors.push(`${sourceLabel}: references missing file "${fileRef}".`);
      }
    }
  }

  if (!Array.isArray(data.expected_behavior) || data.expected_behavior.length < 3) {
    errors.push(`${sourceLabel}: "expected_behavior" must contain at least 3 concrete expectations.`);
  } else {
    data.expected_behavior.forEach((entry, index) => {
      if (typeof entry !== "string" || entry.trim().length < MIN_LENGTH.behavior) {
        errors.push(`${sourceLabel}: expected_behavior[${index}] must be at least ${MIN_LENGTH.behavior} characters.`);
      } else if (hasPlaceholder(entry)) {
        errors.push(`${sourceLabel}: expected_behavior[${index}] must not contain TODO/TBD placeholders.`);
      }
    });
  }

  if (!Array.isArray(data.must_not)) {
    errors.push(`${sourceLabel}: "must_not" must be an array (it may be empty, but it must exist).`);
  } else {
    data.must_not.forEach((entry, index) => {
      if (typeof entry !== "string" || entry.trim().length < MIN_LENGTH.mustNot) {
        errors.push(`${sourceLabel}: must_not[${index}] must be at least ${MIN_LENGTH.mustNot} characters.`);
      } else if (hasPlaceholder(entry)) {
        errors.push(`${sourceLabel}: must_not[${index}] must not contain TODO/TBD placeholders.`);
      }
    });
  }

  const allowedTags = new Set(coveragePolicy.allowedTags || []);
  if (!Array.isArray(data.tags) || data.tags.length === 0) {
    errors.push(`${sourceLabel}: "tags" must be a non-empty array.`);
  } else {
    const seenTags = new Set();
    data.tags.forEach((tag, index) => {
      if (typeof tag !== "string") {
        errors.push(`${sourceLabel}: tags[${index}] must be a string.`);
        return;
      }
      if (!allowedTags.has(tag)) {
        errors.push(`${sourceLabel}: invalid tag "${tag}".`);
      }
      if (seenTags.has(tag)) {
        errors.push(`${sourceLabel}: duplicate tag "${tag}".`);
      }
      seenTags.add(tag);
    });
  }

  if (typeof data.gap !== "string" || data.gap.trim().length < MIN_LENGTH.gap) {
    errors.push(`${sourceLabel}: "gap" must be at least ${MIN_LENGTH.gap} characters.`);
  } else if (hasPlaceholder(data.gap)) {
    errors.push(`${sourceLabel}: "gap" must not contain TODO/TBD placeholders.`);
  }

  return {
    errors,
    skillName,
    tags: Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === "string") : [],
  };
}

function summarizeCoverage(requiredSkills, coverageState) {
  return Object.keys(requiredSkills)
    .sort((left, right) => left.localeCompare(right))
    .map((skillName) => {
      const entry = coverageState.get(skillName) || { count: 0, tags: new Set() };
      const tags = [...entry.tags].sort((left, right) => left.localeCompare(right));
      return `${skillName}: ${entry.count} scenario(s) | tags: ${tags.length > 0 ? tags.join(", ") : "(none)"}`;
    });
}

function validateSuite({ repoRoot, coveragePolicy, schemaDoc, scenarioRecords, validateSchemaDocFlag, skillNames }) {
  const errors = [];
  const coverageErrors = validateCoveragePolicy(coveragePolicy, "evals/_shared/coverage-policy.json");
  errors.push(...coverageErrors);

  if (validateSchemaDocFlag) {
    errors.push(
      ...validateSchemaDocument(
        schemaDoc,
        coveragePolicy,
        "evals/_shared/scenario.schema.json"
      )
    );
  }

  const requiredSkills = coveragePolicy.requiredSkills || {};
  const coverageState = new Map(
    Object.keys(requiredSkills).map((skillName) => [skillName, { count: 0, tags: new Set() }])
  );
  const seenIds = new Set();

  for (const record of scenarioRecords) {
    const result = validateScenarioRecord(record, repoRoot, coveragePolicy, seenIds);
    errors.push(...result.errors);

    if (result.skillName && coverageState.has(result.skillName)) {
      const entry = coverageState.get(result.skillName);
      entry.count += 1;
      for (const tag of result.tags) entry.tags.add(tag);
    }
  }

  const globalMinScenarios = coveragePolicy.globalMinScenarios || 1;
  for (const [skillName, skillPolicy] of Object.entries(requiredSkills)) {
    const entry = coverageState.get(skillName) || { count: 0, tags: new Set() };
    const minScenarios = skillPolicy.minScenarios || globalMinScenarios;

    if (entry.count < minScenarios) {
      errors.push(`coverage-policy.json: skill "${skillName}" requires at least ${minScenarios} scenarios, found ${entry.count}.`);
    }

    for (const requiredTag of skillPolicy.requiredTags || []) {
      if (!entry.tags.has(requiredTag)) {
        errors.push(`coverage-policy.json: skill "${skillName}" is missing required tag "${requiredTag}".`);
      }
    }

    if (Array.isArray(skillPolicy.requireAnyTags) && skillPolicy.requireAnyTags.length > 0) {
      const hasAny = skillPolicy.requireAnyTags.some((tag) => entry.tags.has(tag));
      if (!hasAny) {
        errors.push(
          `coverage-policy.json: skill "${skillName}" must include at least one of these tags: ${skillPolicy.requireAnyTags.join(", ")}.`
        );
      }
    }
  }

  // Completeness runs against the real skills tree only (fixtures pass no skillNames, so it
  // is a no-op there). Gating on Array.isArray keeps the fixture path untouched.
  if (Array.isArray(skillNames)) {
    errors.push(
      ...coverageCompletenessErrors(skillNames, requiredSkills, coveragePolicy.excludedSkills || {})
    );
  }

  return {
    errors,
    coverageSummary: summarizeCoverage(requiredSkills, coverageState),
  };
}

function loadRealSuite(repoRoot) {
  const evalsRoot = path.join(repoRoot, "evals");
  const coveragePolicyPath = path.join(evalsRoot, "_shared", "coverage-policy.json");
  const schemaPath = path.join(evalsRoot, "_shared", "scenario.schema.json");

  const errors = [];
  const coveragePolicyJson = readJsonFile(coveragePolicyPath);
  if (coveragePolicyJson.error) errors.push(coveragePolicyJson.error);
  const schemaJson = readJsonFile(schemaPath);
  if (schemaJson.error) errors.push(schemaJson.error);

  const scenarioRecords = [];
  if (fs.existsSync(evalsRoot)) {
    const skillFolders = fs
      .readdirSync(evalsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const skillFolder of skillFolders) {
      const scenariosDir = path.join(evalsRoot, skillFolder, "scenarios");
      for (const scenarioPath of listJsonFiles(scenariosDir)) {
        const scenarioJson = readJsonFile(scenarioPath);
        if (scenarioJson.error) {
          errors.push(scenarioJson.error);
          continue;
        }
        scenarioRecords.push({
          data: scenarioJson.value,
          sourceLabel: path.relative(repoRoot, scenarioPath),
          skillFolder,
        });
      }
    }
  }

  return {
    errors,
    coveragePolicy: coveragePolicyJson.value || {},
    schemaDoc: schemaJson.value || {},
    scenarioRecords,
    skillNames: listSkillNames(repoRoot),
  };
}

function validateInvalidFixtureShape(fixture, label) {
  const errors = [];

  if (!isPlainObject(fixture)) {
    return [`${label}: fixture must be a JSON object.`];
  }

  if (!isPlainObject(fixture.coveragePolicy)) {
    errors.push(`${label}: fixture must provide a "coveragePolicy" object.`);
  }

  if (!Array.isArray(fixture.scenarios) || fixture.scenarios.length === 0) {
    errors.push(`${label}: fixture must provide a non-empty "scenarios" array.`);
  }

  if (!Array.isArray(fixture.expectedErrors) || fixture.expectedErrors.length === 0) {
    errors.push(`${label}: fixture must provide a non-empty "expectedErrors" array.`);
  }

  return errors;
}

function runInvalidFixtures(repoRoot) {
  const fixtureDir = path.join(repoRoot, "scripts", "evals", "fixtures", "invalid");
  const fixtureFiles = listJsonFiles(fixtureDir);
  const output = [];

  for (const fixturePath of fixtureFiles) {
    const fixtureLabel = path.relative(repoRoot, fixturePath);
    const parsedFixture = readJsonFile(fixturePath);
    if (parsedFixture.error) {
      output.push({ label: fixtureLabel, ok: false, details: [parsedFixture.error] });
      continue;
    }

    const fixture = parsedFixture.value;
    const shapeErrors = validateInvalidFixtureShape(fixture, fixtureLabel);
    if (shapeErrors.length > 0) {
      output.push({ label: fixtureLabel, ok: false, details: shapeErrors });
      continue;
    }

    const scenarioRecords = fixture.scenarios.map((scenarioEntry, index) => {
      const skillFolder = scenarioEntry.skillFolder || "unknown-skill";
      const virtualPath = scenarioEntry.file || `evals/${skillFolder}/scenarios/fixture-${index + 1}.json`;
      return {
        data: scenarioEntry.data,
        sourceLabel: `${fixtureLabel} -> ${virtualPath}`,
        skillFolder,
      };
    });

    const validationResult = validateSuite({
      repoRoot,
      coveragePolicy: fixture.coveragePolicy,
      schemaDoc: null,
      scenarioRecords,
      validateSchemaDocFlag: false,
    });

    const missingExpectedError = fixture.expectedErrors.filter(
      (expectedSnippet) => !validationResult.errors.some((error) => error.includes(expectedSnippet))
    );

    if (validationResult.errors.length === 0) {
      output.push({
        label: fixtureLabel,
        ok: false,
        details: [`${fixtureLabel}: expected validation failure, but the fixture passed.`],
      });
      continue;
    }

    if (missingExpectedError.length > 0) {
      output.push({
        label: fixtureLabel,
        ok: false,
        details: missingExpectedError.map(
          (snippet) => `${fixtureLabel}: expected an error containing "${snippet}", but it was not produced.`
        ),
      });
      continue;
    }

    output.push({ label: fixtureLabel, ok: true, details: [] });
  }

  return output;
}

function printSection(title) {
  console.log(`\n${title}`);
}

function main() {
  // Default is the real repo; EVALS_REPO_ROOT lets a test point the whole run at a temp tree
  // so the completeness wiring (loadRealSuite → validateSuite) is provable end-to-end.
  const repoRoot = process.env.EVALS_REPO_ROOT
    ? path.resolve(process.env.EVALS_REPO_ROOT)
    : path.resolve(__dirname, "..", "..");

  const invalidFixtureResults = runInvalidFixtures(repoRoot);
  printSection("Validator self-check");
  for (const result of invalidFixtureResults) {
    if (result.ok) {
      console.log(`PASS ${result.label}`);
    } else {
      console.log(`FAIL ${result.label}`);
      for (const detail of result.details) console.log(`  - ${detail}`);
    }
  }

  if (invalidFixtureResults.some((result) => !result.ok)) {
    console.error("\nFAIL validator self-check failed.");
    process.exit(1);
  }

  const realSuite = loadRealSuite(repoRoot);
  const validation = validateSuite({
    repoRoot,
    coveragePolicy: realSuite.coveragePolicy,
    schemaDoc: realSuite.schemaDoc,
    scenarioRecords: realSuite.scenarioRecords,
    validateSchemaDocFlag: true,
    skillNames: realSuite.skillNames,
  });

  const allErrors = [...realSuite.errors, ...validation.errors];

  printSection("Eval suite summary");
  validation.coverageSummary.forEach((line) => console.log(line));

  if (allErrors.length > 0) {
    console.error(`\nFAIL eval validation found ${allErrors.length} issue(s):`);
    allErrors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  console.log(
    `\nPASS eval validation succeeded for ${realSuite.scenarioRecords.length} scenario(s) across ${validation.coverageSummary.length} required skill suite(s).`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  coverageCompletenessErrors,
  listSkillNames,
  validateCoveragePolicy,
  validateSuite,
};
