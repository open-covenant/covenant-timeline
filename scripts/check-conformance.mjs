import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  canonicalJson,
  evaluateRunDocument,
  validateRunDocument,
} from "../packages/prototype/dist/index.js";

const schemaDirectory = "schemas/v0alpha1";
const casesPath = "conformance/v0alpha1/cases.json";
const runCasesPath = "conformance/v0alpha1/run-cases.json";
const canonicalCasesPath = "conformance/rfc8785/cases.json";
const cliPath = "packages/prototype/dist/cli.js";
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

const schemas = readdirSync(schemaDirectory)
  .filter((file) => file.endsWith(".schema.json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(join(schemaDirectory, file), "utf8")));

for (const schema of schemas) ajv.addSchema(schema);

const caseValidator = ajv.getSchema(
  "https://covenant-timeline.org/schemas/v0alpha1/conformance-case.schema.json",
);
if (!caseValidator)
  throw new Error("conformance case schema is not registered");

const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const ids = new Set();
const coveredRequirements = new Set();
const failures = [];

for (const testCase of cases) {
  if (!caseValidator(testCase)) {
    failures.push(`${testCase.id ?? "<unknown>"}: invalid case definition`);
    continue;
  }
  if (ids.has(testCase.id)) {
    failures.push(`${testCase.id}: duplicate case id`);
    continue;
  }
  ids.add(testCase.id);
  testCase.requirements.forEach((requirement) =>
    coveredRequirements.add(requirement),
  );

  const validator = ajv.getSchema(testCase.targetSchema);
  if (!validator) {
    failures.push(
      `${testCase.id}: unknown target schema ${testCase.targetSchema}`,
    );
    continue;
  }

  let errorCode = validator(testCase.document) ? null : "schema.invalid";
  if (errorCode === null && testCase.semanticCheck) {
    errorCode = semanticError(testCase.semanticCheck, testCase.document);
  }

  const valid = errorCode === null;
  if (valid !== testCase.expect.valid) {
    failures.push(
      `${testCase.id}: expected valid=${testCase.expect.valid}, received valid=${valid}` +
        (errorCode ? ` (${errorCode})` : ""),
    );
    continue;
  }

  if (!valid && errorCode !== testCase.expect.errorCode) {
    failures.push(
      `${testCase.id}: expected ${testCase.expect.errorCode}, received ${errorCode}`,
    );
  }

  if (valid && testCase.canonicalExpected !== undefined) {
    const canonical = canonicalJson(testCase.document);
    if (canonical !== testCase.canonicalExpected) {
      failures.push(`${testCase.id}: canonical output mismatch`);
    }
  }
}

const canonicalCases = JSON.parse(readFileSync(canonicalCasesPath, "utf8"));
for (const testCase of canonicalCases) {
  if (canonicalJson(testCase.input) !== testCase.canonical) {
    failures.push(`${testCase.id}: RFC 8785 canonical output mismatch`);
  }
}

const runCases = JSON.parse(readFileSync(runCasesPath, "utf8"));
for (const testCase of runCases) {
  const run = JSON.parse(
    readFileSync(join("conformance/v0alpha1", testCase.file), "utf8"),
  );
  const issues = validateRunDocument(run);
  const valid = issues.length === 0;
  if (valid !== testCase.expect.valid) {
    failures.push(
      `${testCase.id}: expected valid=${testCase.expect.valid}, received valid=${valid}`,
    );
    continue;
  }

  if (!valid) {
    const issuePaths = issues.map(({ path }) => path);
    if (testCase.expect.errorCode !== "schema.invalid") {
      failures.push(`${testCase.id}: expected stable schema.invalid error`);
    }
    if (
      canonicalJson(issuePaths) !== canonicalJson(testCase.expect.issuePaths)
    ) {
      failures.push(`${testCase.id}: validation issue paths changed`);
    }
    continue;
  }

  const first = evaluateRunDocument(run);
  const second = evaluateRunDocument(run);
  if (canonicalJson(first) !== canonicalJson(second)) {
    failures.push(`${testCase.id}: replay output is not deterministic`);
  }
  if (first.verification.ok !== testCase.expect.ok) {
    failures.push(`${testCase.id}: verification result changed`);
  }
  const checkpoint = first.state.checkpoints["release-ready"];
  if (checkpoint?.status !== testCase.expect.checkpoint) {
    failures.push(`${testCase.id}: checkpoint outcome changed`);
  }
  if (first.stateDigest !== testCase.expect.stateDigest) {
    failures.push(`${testCase.id}: state digest changed`);
  }
}

const environmentOutputs = [
  { LANG: "C", LC_ALL: "C", TZ: "UTC" },
  { LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8", TZ: "Pacific/Auckland" },
].map((environment) => {
  const result = spawnSync(
    process.execPath,
    [cliPath, "replay", "conformance/v0alpha1/runs/successful.json", "--json"],
    {
      encoding: "utf8",
      env: { ...process.env, ...environment },
    },
  );
  if (result.status !== 0) {
    failures.push(
      `cross-environment replay failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout;
});
if (
  environmentOutputs.length === 2 &&
  environmentOutputs[0] !== environmentOutputs[1]
) {
  failures.push("locale or time zone changed canonical replay output");
}

if (cases.length < 15) failures.push("expected at least 15 conformance cases");
if (runCases.length < 5) failures.push("expected at least 5 run fixtures");
if (canonicalCases.length < 5) {
  failures.push("expected at least 5 RFC 8785 fixtures");
}

const requirementsText = readFileSync("spec/v0alpha1/requirements.md", "utf8");
const mechanicalRequirements = [
  ...requirementsText.matchAll(/\|\s+(CTL-[A-Z]+-\d{3})\s+\|.*\|\s+yes\s+\|/g),
].map((match) => match[1]);
for (const requirement of mechanicalRequirements) {
  if (!coveredRequirements.has(requirement)) {
    failures.push(`${requirement}: no conformance coverage`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `conformance passed (${cases.length} documents, ${runCases.length} runs, ${canonicalCases.length} canonical fixtures, ${schemas.length} schemas, 2 environments)`,
);

function semanticError(check, document) {
  if (check === "required-extensions") {
    return (document.extensions?.required?.length ?? 0) > 0
      ? "timeline.extension.required_unknown"
      : null;
  }

  if (check === "duplicate-checkpoints") {
    const ids = (document.checkpoints ?? []).map(({ id }) => id);
    return ids.length === new Set(ids).size
      ? null
      : "timeline.contract.duplicate_checkpoint";
  }

  throw new Error(`unknown semantic check: ${check}`);
}
