import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  canonicalJson,
  GithubAuthorityError,
  verifyGithubEnvelope,
} from "../packages/prototype/dist/index.js";

const archivePath = "examples/public-runs/temporal-sdk-typescript-pr-2219.json";
const schemaPaths = [
  "profiles/github/v1/policy.schema.json",
  "profiles/github/v1/revocations.schema.json",
  "profiles/github/v1/payload.schema.json",
  "profiles/github/v1/envelope.schema.json",
];
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

for (const path of schemaPaths) {
  ajv.addSchema(JSON.parse(readFileSync(path, "utf8")));
}

const archive = JSON.parse(readFileSync(archivePath, "utf8"));
validate(
  "https://covenant-timeline.org/profiles/github/v1/policy.schema.json",
  archive.policy,
);
validate(
  "https://covenant-timeline.org/profiles/github/v1/revocations.schema.json",
  archive.revocations,
);
validate(
  "https://covenant-timeline.org/profiles/github/v1/payload.schema.json",
  archive.envelope.payload,
);
validate(
  "https://covenant-timeline.org/profiles/github/v1/envelope.schema.json",
  archive.envelope,
);

const recorded = archive.run.events.find(
  ({ type }) => type === "evidence.recorded",
);
if (!recorded) throw new Error("public archive has no recorded evidence event");

const evidence = verifyGithubEnvelope(
  archive.envelope,
  archive.policy,
  archive.revocations,
  recorded.evidence.id,
  { now: archive.envelope.observedAt },
);
if (canonicalJson(evidence) !== canonicalJson(recorded.evidence)) {
  throw new Error("profile verification does not reproduce archived evidence");
}

const invalidEnvelope = { ...archive.envelope, signature: "not-base64url" };
const envelopeValidator = validator(
  "https://covenant-timeline.org/profiles/github/v1/envelope.schema.json",
);
if (envelopeValidator(invalidEnvelope)) {
  throw new Error("profile schema accepted an invalid collector signature");
}
try {
  verifyGithubEnvelope(
    invalidEnvelope,
    archive.policy,
    archive.revocations,
    recorded.evidence.id,
    { now: archive.envelope.observedAt },
  );
  throw new Error("profile runtime accepted an invalid collector signature");
} catch (error) {
  if (!(error instanceof GithubAuthorityError)) throw error;
}

console.log(
  `GitHub profile passed (${schemaPaths.length} schemas and 1 signed public archive)`,
);

function validate(id, value) {
  const check = validator(id);
  if (!check(value)) {
    throw new Error(
      `${id} rejected public archive: ${ajv.errorsText(check.errors)}`,
    );
  }
}

function validator(id) {
  const check = ajv.getSchema(id);
  if (!check) throw new Error(`profile schema is not registered: ${id}`);
  return check;
}
