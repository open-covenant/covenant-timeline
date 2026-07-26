import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  canonicalJson,
  evaluateRunDocument,
  validateCommand,
  validateContract,
  validateDecision,
  validateEvidence,
  validateEvent,
  validateReceipt,
  validateRunDocument,
  evaluateRunDocumentV0Alpha2,
  validateCommandV0Alpha2,
  validateContractV0Alpha2,
  validateDecisionV0Alpha2,
  validateEvidenceV0Alpha2,
  validateEventV0Alpha2,
  validateReceiptV0Alpha2,
  validateRunDocumentV0Alpha2,
} from "../packages/prototype/dist/index.js";

const schemaDirectory = "schemas/v0alpha1";
const schemaDirectoryV0Alpha2 = "schemas/v0alpha2";
const casesPath = "conformance/v0alpha1/cases.json";
const runCasesPath = "conformance/v0alpha1/run-cases.json";
const canonicalCasesPath = "conformance/rfc8785/cases.json";
const cliPath = "packages/prototype/dist/cli.js";
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

const schemas = [schemaDirectory, schemaDirectoryV0Alpha2].flatMap(
  (directory) =>
    readdirSync(directory)
      .filter((file) => file.endsWith(".schema.json"))
      .sort()
      .map((file) => JSON.parse(readFileSync(join(directory, file), "utf8"))),
);

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
const runtimeValidators = new Map([
  ["contract.schema.json", validateContract],
  ["event.schema.json", validateEvent],
  ["evidence.schema.json", validateEvidence],
  ["receipt.schema.json", validateReceipt],
  ["command.schema.json", validateCommand],
  ["decision.schema.json", validateDecision],
  ["run.schema.json", validateRunDocument],
]);

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
  const schemaName = testCase.targetSchema.split("/").at(-1);
  const runtimeValidator = runtimeValidators.get(schemaName);
  if (runtimeValidator) {
    const runtimeValid = runtimeValidator(testCase.document).length === 0;
    if (runtimeValid !== testCase.expect.valid) {
      failures.push(
        `${testCase.id}: runtime validator received valid=${runtimeValid}`,
      );
    }
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

const caseValidatorV0Alpha2 = ajv.getSchema(
  "https://covenant-timeline.org/schemas/v0alpha2/conformance-case.schema.json",
);
if (!caseValidatorV0Alpha2) {
  throw new Error("v0alpha2 conformance case schema is not registered");
}
const casesV0Alpha2 = JSON.parse(
  readFileSync("conformance/v0alpha2/cases.json", "utf8"),
);
const idsV0Alpha2 = new Set();
const coveredRequirementsV0Alpha2 = new Set();
const runtimeValidatorsV0Alpha2 = new Map([
  ["contract.schema.json", validateContractV0Alpha2],
  ["event.schema.json", validateEventV0Alpha2],
  ["evidence.schema.json", validateEvidenceV0Alpha2],
  ["receipt.schema.json", validateReceiptV0Alpha2],
  ["command.schema.json", validateCommandV0Alpha2],
  ["decision.schema.json", validateDecisionV0Alpha2],
  ["run.schema.json", validateRunDocumentV0Alpha2],
]);

for (const testCase of casesV0Alpha2) {
  if (!caseValidatorV0Alpha2(testCase)) {
    failures.push(
      `${testCase.id ?? "<unknown>"}: invalid v0alpha2 case definition`,
    );
    continue;
  }
  if (idsV0Alpha2.has(testCase.id)) {
    failures.push(`${testCase.id}: duplicate v0alpha2 case id`);
    continue;
  }
  idsV0Alpha2.add(testCase.id);
  testCase.requirements.forEach((requirement) =>
    coveredRequirementsV0Alpha2.add(requirement),
  );

  const validator = ajv.getSchema(testCase.targetSchema);
  if (!validator) {
    failures.push(
      `${testCase.id}: unknown v0alpha2 target schema ${testCase.targetSchema}`,
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
      `${testCase.id}: expected v0alpha2 valid=${testCase.expect.valid}, received valid=${valid}` +
        (errorCode ? ` (${errorCode})` : ""),
    );
    continue;
  }
  if (!valid && errorCode !== testCase.expect.errorCode) {
    failures.push(
      `${testCase.id}: expected ${testCase.expect.errorCode}, received ${errorCode}`,
    );
  }
  const schemaName = testCase.targetSchema.split("/").at(-1);
  const runtimeValidator = runtimeValidatorsV0Alpha2.get(schemaName);
  if (runtimeValidator) {
    const runtimeValid = runtimeValidator(testCase.document).length === 0;
    if (runtimeValid !== testCase.expect.valid) {
      failures.push(
        `${testCase.id}: v0alpha2 runtime validator received valid=${runtimeValid}`,
      );
    }
  }
}

const runCasesV0Alpha2 = JSON.parse(
  readFileSync("conformance/v0alpha2/run-cases.json", "utf8"),
);
for (const testCase of runCasesV0Alpha2) {
  const run = JSON.parse(
    readFileSync(join("conformance/v0alpha2", testCase.file), "utf8"),
  );
  const issues = validateRunDocumentV0Alpha2(run);
  const valid = issues.length === 0;
  if (valid !== testCase.expect.valid) {
    failures.push(
      `${testCase.id}: expected valid=${testCase.expect.valid}, received valid=${valid}`,
    );
    continue;
  }
  if (!valid) continue;

  const first = evaluateRunDocumentV0Alpha2(run);
  const second = evaluateRunDocumentV0Alpha2(run);
  if (canonicalJson(first) !== canonicalJson(second)) {
    failures.push(
      `${testCase.id}: v0alpha2 replay output is not deterministic`,
    );
  }
  if (first.verification.ok !== testCase.expect.ok) {
    failures.push(`${testCase.id}: v0alpha2 verification result changed`);
  }
  const checkpoint = first.state.checkpoints["release-ready"];
  if (checkpoint?.status !== testCase.expect.checkpoint) {
    failures.push(`${testCase.id}: v0alpha2 checkpoint outcome changed`);
  }
  if (first.stateDigest !== testCase.expect.stateDigest) {
    failures.push(`${testCase.id}: v0alpha2 state digest changed`);
  }
  if (
    testCase.expect.finding &&
    !first.state.findings.some(({ code }) => code === testCase.expect.finding)
  ) {
    failures.push(`${testCase.id}: expected ${testCase.expect.finding}`);
  }
}

const environmentOutputsV0Alpha2 = [
  { LANG: "C", LC_ALL: "C", TZ: "UTC" },
  { LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8", TZ: "Pacific/Auckland" },
].map((environment) => {
  const result = spawnSync(
    process.execPath,
    [cliPath, "replay", "conformance/v0alpha2/runs/successful.json", "--json"],
    {
      encoding: "utf8",
      env: { ...process.env, ...environment },
    },
  );
  if (result.status !== 0) {
    failures.push(
      `v0alpha2 cross-environment replay failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout;
});
if (
  environmentOutputsV0Alpha2.length === 2 &&
  environmentOutputsV0Alpha2[0] !== environmentOutputsV0Alpha2[1]
) {
  failures.push("locale or time zone changed v0alpha2 canonical replay output");
}

if (casesV0Alpha2.length < 15) {
  failures.push("expected at least 15 v0alpha2 conformance cases");
}
if (runCasesV0Alpha2.length < 2) {
  failures.push("expected at least 2 v0alpha2 run fixtures");
}
const requirementsTextV0Alpha2 = readFileSync(
  "spec/v0alpha2/requirements.md",
  "utf8",
);
const mechanicalRequirementsV0Alpha2 = [
  ...requirementsTextV0Alpha2.matchAll(
    /\|\s+(CTL2-[A-Z]+-\d{3})\s+\|.*\|\s+yes\s+\|/g,
  ),
].map((match) => match[1]);
for (const requirement of mechanicalRequirementsV0Alpha2) {
  if (!coveredRequirementsV0Alpha2.has(requirement)) {
    failures.push(`${requirement}: no v0alpha2 conformance coverage`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `conformance passed (${cases.length + casesV0Alpha2.length} documents, ${runCases.length + runCasesV0Alpha2.length} runs, ${canonicalCases.length} canonical fixtures, ${schemas.length} schemas, 4 environment replays)`,
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
