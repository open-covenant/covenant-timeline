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
  reasonTemporalQueryV0Alpha3,
  validateContractV0Alpha3,
  validateEventV0Alpha3,
  validateQueryV0Alpha3,
  validateRunDocumentV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "../packages/prototype/dist/index.js";

const schemaDirectory = "schemas/v0alpha1";
const schemaDirectoryV0Alpha2 = "schemas/v0alpha2";
const schemaDirectoryV0Alpha3 = "schemas/v0alpha3";
const casesPath = "conformance/v0alpha1/cases.json";
const runCasesPath = "conformance/v0alpha1/run-cases.json";
const canonicalCasesPath = "conformance/rfc8785/cases.json";
const cliPath = "packages/prototype/dist/cli.js";
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

const schemas = [
  schemaDirectory,
  schemaDirectoryV0Alpha2,
  schemaDirectoryV0Alpha3,
].flatMap((directory) =>
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

const caseValidatorV0Alpha3 = ajv.getSchema(
  "https://covenant-timeline.org/schemas/v0alpha3/conformance-case.schema.json",
);
if (!caseValidatorV0Alpha3) {
  throw new Error("v0alpha3 conformance case schema is not registered");
}
const casesV0Alpha3 = JSON.parse(
  readFileSync("conformance/v0alpha3/cases.json", "utf8"),
);
const idsV0Alpha3 = new Set();
const coveredRequirementsV0Alpha3 = new Set();
const runtimeValidatorsV0Alpha3 = new Map([
  ["contract.schema.json", validateContractV0Alpha3],
  ["event.schema.json", validateEventV0Alpha3],
  ["run.schema.json", validateRunDocumentV0Alpha3],
]);

for (const testCase of casesV0Alpha3) {
  if (!caseValidatorV0Alpha3(testCase)) {
    failures.push(
      `${testCase.id ?? "<unknown>"}: invalid v0alpha3 case definition`,
    );
    continue;
  }
  if (idsV0Alpha3.has(testCase.id)) {
    failures.push(`${testCase.id}: duplicate v0alpha3 case id`);
    continue;
  }
  idsV0Alpha3.add(testCase.id);
  testCase.requirements.forEach((requirement) =>
    coveredRequirementsV0Alpha3.add(requirement),
  );

  const validator = ajv.getSchema(testCase.targetSchema);
  if (!validator) {
    failures.push(
      `${testCase.id}: unknown v0alpha3 target schema ${testCase.targetSchema}`,
    );
    continue;
  }
  const errorCode = validator(testCase.document) ? null : "schema.invalid";
  const valid = errorCode === null;
  if (valid !== testCase.expect.valid) {
    failures.push(
      `${testCase.id}: expected v0alpha3 valid=${testCase.expect.valid}, received valid=${valid}` +
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
  const runtimeValidator = runtimeValidatorsV0Alpha3.get(schemaName);
  if (runtimeValidator) {
    const runtimeValid = runtimeValidator(testCase.document).length === 0;
    if (runtimeValid !== testCase.expect.valid) {
      failures.push(
        `${testCase.id}: v0alpha3 runtime validator received valid=${runtimeValid}`,
      );
    }
  }
}

const temporalRun = JSON.parse(
  readFileSync("conformance/v0alpha3/runs/software-release.json", "utf8"),
);
const temporalRunIssues = validateRunDocumentV0Alpha3(temporalRun);
if (temporalRunIssues.length > 0) {
  failures.push(
    `v0alpha3 software-release run is invalid: ${canonicalJson(temporalRunIssues)}`,
  );
}
const temporalResultCases = [
  {
    file: "consistency-before-correction.json",
    result: { type: "context.consistency", status: "consistent" },
  },
  {
    file: "consistency-after-correction.json",
    result: { type: "context.consistency", status: "consistent" },
  },
  {
    file: "difference-bounds.json",
    result: {
      type: "difference.bounds",
      status: "bounded",
      minimum: 90600,
      maximum: 178200,
    },
  },
  {
    file: "point-relations-at-cut.json",
    result: {
      type: "point.relations",
      status: "resolved",
      possible: ["before"],
    },
  },
  {
    file: "interval-relations.json",
    result: {
      type: "interval.relations",
      status: "resolved",
      possible: ["meets"],
    },
  },
];
const conclusionValidatorV0Alpha3 = ajv.getSchema(
  "https://covenant-timeline.org/schemas/v0alpha3/conclusion.schema.json",
);
if (!conclusionValidatorV0Alpha3) {
  throw new Error("v0alpha3 conclusion schema is not registered");
}
for (const testCase of temporalResultCases) {
  const query = JSON.parse(
    readFileSync(join("conformance/v0alpha3/queries", testCase.file), "utf8"),
  );
  const queryIssues = validateQueryV0Alpha3(query, temporalRun);
  if (queryIssues.length > 0) {
    failures.push(
      `${testCase.file}: invalid v0alpha3 query ${canonicalJson(queryIssues)}`,
    );
    continue;
  }
  const first = reasonTemporalQueryV0Alpha3(temporalRun, query);
  const second = reasonTemporalQueryV0Alpha3(temporalRun, query);
  if (canonicalJson(first) !== canonicalJson(second)) {
    failures.push(`${testCase.file}: v0alpha3 conclusion is not deterministic`);
  }
  if (canonicalJson(first.result) !== canonicalJson(testCase.result)) {
    failures.push(
      `${testCase.file}: expected ${canonicalJson(testCase.result)}, received ${canonicalJson(first.result)}`,
    );
  }
  if (!conclusionValidatorV0Alpha3(first)) {
    failures.push(`${testCase.file}: generated conclusion fails JSON Schema`);
  }
  if (!verifyTemporalConclusionV0Alpha3(temporalRun, query, first)) {
    failures.push(
      `${testCase.file}: generated proof receipt failed verification`,
    );
  }
}

const conclusionFixtureV0Alpha3 = JSON.parse(
  readFileSync(
    "conformance/v0alpha3/conclusions/difference-bounds.json",
    "utf8",
  ),
);
if (!conclusionValidatorV0Alpha3(conclusionFixtureV0Alpha3)) {
  failures.push("v0alpha3 bounds conclusion fixture fails JSON Schema");
}
const differenceBoundsQueryV0Alpha3 = JSON.parse(
  readFileSync("conformance/v0alpha3/queries/difference-bounds.json", "utf8"),
);
if (
  !verifyTemporalConclusionV0Alpha3(
    temporalRun,
    differenceBoundsQueryV0Alpha3,
    conclusionFixtureV0Alpha3,
  )
) {
  failures.push("v0alpha3 bounds conclusion fixture failed proof verification");
}

const validRelationConclusionV0Alpha3 = casesV0Alpha3.find(
  ({ id }) => id === "schema.valid-relation-conclusion",
)?.document;
const validConsistencyConclusionV0Alpha3 = structuredClone(
  casesV0Alpha3.find(({ id }) => id === "schema.conclusion-bad-digest")
    ?.document ?? {},
);
if (
  !validRelationConclusionV0Alpha3 ||
  validConsistencyConclusionV0Alpha3.receipt === undefined
) {
  failures.push("v0alpha3 conclusion schema invariant fixtures are missing");
} else {
  validConsistencyConclusionV0Alpha3.receipt.stateDigest =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const negativeCycle =
    validRelationConclusionV0Alpha3.receipt.proof.cases.find(
      ({ possible }) => !possible,
    )?.witness;
  if (!negativeCycle) {
    failures.push("v0alpha3 negative-cycle invariant fixture is missing");
  } else {
    const schemaInvariantCases = [];

    const consistentWithCycle = structuredClone(
      validConsistencyConclusionV0Alpha3,
    );
    consistentWithCycle.receipt.proof = negativeCycle;
    schemaInvariantCases.push([
      "consistent result with negative-cycle proof",
      consistentWithCycle,
    ]);

    const boundedWithNull = structuredClone(conclusionFixtureV0Alpha3);
    boundedWithNull.result.minimum = null;
    schemaInvariantCases.push([
      "bounded result with null limit",
      boundedWithNull,
    ]);

    const partialWithTwoLimits = structuredClone(conclusionFixtureV0Alpha3);
    partialWithTwoLimits.result.status = "partially-bounded";
    schemaInvariantCases.push([
      "partially-bounded result with two finite limits",
      partialWithTwoLimits,
    ]);

    const boundsWithSchedule = structuredClone(conclusionFixtureV0Alpha3);
    boundsWithSchedule.receipt.proof =
      validConsistencyConclusionV0Alpha3.receipt.proof;
    schemaInvariantCases.push([
      "bounded result with schedule proof",
      boundsWithSchedule,
    ]);

    const resolvedWithTwoRelations = structuredClone(
      validRelationConclusionV0Alpha3,
    );
    resolvedWithTwoRelations.result.possible = ["before", "equal"];
    schemaInvariantCases.push([
      "resolved result with two possible relations",
      resolvedWithTwoRelations,
    ]);

    const indeterminateWithOneRelation = structuredClone(
      validRelationConclusionV0Alpha3,
    );
    indeterminateWithOneRelation.result.status = "indeterminate";
    schemaInvariantCases.push([
      "indeterminate result with one possible relation",
      indeterminateWithOneRelation,
    ]);

    const inconsistentWithPossibleRelation = structuredClone(
      validRelationConclusionV0Alpha3,
    );
    inconsistentWithPossibleRelation.result.status = "inconsistent";
    inconsistentWithPossibleRelation.receipt.proof = negativeCycle;
    schemaInvariantCases.push([
      "inconsistent result with a possible relation",
      inconsistentWithPossibleRelation,
    ]);

    const falseCaseWithSchedule = structuredClone(
      validRelationConclusionV0Alpha3,
    );
    falseCaseWithSchedule.receipt.proof.cases[1].witness =
      validRelationConclusionV0Alpha3.receipt.proof.cases[0].witness;
    schemaInvariantCases.push([
      "impossible relation case with schedule witness",
      falseCaseWithSchedule,
    ]);

    const incompletePointCases = structuredClone(
      validRelationConclusionV0Alpha3,
    );
    incompletePointCases.receipt.proof.cases.pop();
    schemaInvariantCases.push([
      "incomplete point relation proof",
      incompletePointCases,
    ]);

    const inconsistentWithRelationCases = structuredClone(
      validRelationConclusionV0Alpha3,
    );
    inconsistentWithRelationCases.result.status = "inconsistent";
    inconsistentWithRelationCases.result.possible = [];
    schemaInvariantCases.push([
      "inconsistent relation result with relation-cases proof",
      inconsistentWithRelationCases,
    ]);

    for (const [name, document] of schemaInvariantCases) {
      if (conclusionValidatorV0Alpha3(document)) {
        failures.push(`v0alpha3 conclusion schema accepted ${name}`);
      }
    }
  }
}

const temporalEnvironmentOutputs = [
  { LANG: "C", LC_ALL: "C", TZ: "UTC" },
  { LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8", TZ: "Pacific/Auckland" },
].map((environment) => {
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "reason",
      "conformance/v0alpha3/runs/software-release.json",
      "conformance/v0alpha3/queries/difference-bounds.json",
      "--json",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ...environment },
    },
  );
  if (result.status !== 0) {
    failures.push(
      `v0alpha3 cross-environment reasoning failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout;
});
if (
  temporalEnvironmentOutputs.length === 2 &&
  temporalEnvironmentOutputs[0] !== temporalEnvironmentOutputs[1]
) {
  failures.push("locale or time zone changed v0alpha3 reasoning output");
}

if (casesV0Alpha3.length < 9) {
  failures.push("expected at least 9 v0alpha3 conformance cases");
}
const requirementsTextV0Alpha3 = readFileSync(
  "spec/v0alpha3/requirements.md",
  "utf8",
);
const mechanicalRequirementsV0Alpha3 = [
  ...requirementsTextV0Alpha3.matchAll(
    /\|\s+(CTL3-[A-Z]+-\d{3})\s+\|.*\|\s+yes\s+\|/g,
  ),
].map((match) => match[1]);
for (const requirement of mechanicalRequirementsV0Alpha3) {
  if (!coveredRequirementsV0Alpha3.has(requirement)) {
    failures.push(`${requirement}: no v0alpha3 conformance coverage`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `conformance passed (${cases.length + casesV0Alpha2.length + casesV0Alpha3.length} documents, ${runCases.length + runCasesV0Alpha2.length + 1} runs, ${canonicalCases.length} canonical fixtures, ${schemas.length} schemas, 6 environment replays, ${temporalResultCases.length} temporal queries)`,
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
