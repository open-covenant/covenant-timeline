import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaDirectory = "schemas/v0alpha1";
const casesPath = "conformance/v0alpha1/cases.json";
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

if (cases.length < 15) failures.push("expected at least 15 conformance cases");

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
  `conformance passed (${cases.length} cases, ${schemas.length} schemas)`,
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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
