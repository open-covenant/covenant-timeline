import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  compileTemporalModelProposalV1,
  createTemporalModelProposalOutputSchemaV1,
  parseQueryV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "../packages/prototype/dist/index.js";
import {
  bindCompiledAssertionIds,
  createGoldModelProposalFixture,
  createKnowledgeCutHandle,
  createModelProposalReferenceCatalog,
  createRunDocument,
  projectSemanticState,
} from "./model-proposal-fixtures.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const casesPath = join(root, "benchmarks/model-interface/v1/cases.jsonl");
const candidateSchemaId =
  "https://covenant-timeline.org/schemas/model-proposal/v1/candidate.schema.json";
const [commonSchema, querySchema, candidateSchema] = await Promise.all([
  readJson("schemas/v0alpha3/common.schema.json"),
  readJson("schemas/v0alpha3/query.schema.json"),
  readJson("schemas/model-proposal/v1/candidate.schema.json"),
]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const schema of [commonSchema, querySchema, candidateSchema]) {
  ajv.addSchema(schema);
}
const validateCandidate = ajv.getSchema(candidateSchemaId);
if (!validateCandidate) {
  throw new Error(`schema is not registered: ${candidateSchemaId}`);
}

test("model proposals reproduce every gold temporal trajectory", async () => {
  const cases = (await readFile(casesPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);

  let compiledCuts = 0;
  for (const testCase of cases) {
    let candidateEvents = [...testCase.setupEvents];
    let goldEvents = [...testCase.setupEvents];
    const assertionIds = new Map();
    const reverseAssertionIds = new Map();
    const knowledgeCuts = [];
    const references = createModelProposalReferenceCatalog(testCase);

    for (const cut of testCase.cuts) {
      const { proposal, host: proposalHost } = createGoldModelProposalFixture({
        testCase,
        cut,
        candidateEvents,
        assertionIds,
        knowledgeCuts,
        referenceCatalog: references,
      });
      const validateProposal = ajv.compile(
        createTemporalModelProposalOutputSchemaV1(proposalHost),
      );
      assert.equal(
        validateProposal(proposal),
        true,
        `${testCase.id} cut ${cut.index}: output schema: ${JSON.stringify(validateProposal.errors)}`,
      );
      const candidate = compileTemporalModelProposalV1(proposal, proposalHost);

      assert.equal(
        validateCandidate(candidate),
        true,
        `${testCase.id} cut ${cut.index}: candidate schema: ${JSON.stringify(validateCandidate.errors)}`,
      );
      assert.equal(
        candidate.candidateEvents.length,
        cut.goldEvents.length,
        `${testCase.id} cut ${cut.index}: candidate event count`,
      );
      bindCompiledAssertionIds(
        testCase.id,
        cut.index,
        cut.goldEvents,
        candidate.candidateEvents,
        assertionIds,
        reverseAssertionIds,
      );

      candidateEvents = [...candidateEvents, ...candidate.candidateEvents];
      goldEvents = [...goldEvents, ...cut.goldEvents];
      const candidateRun = createRunDocument(
        testCase.contract,
        candidateEvents,
      );
      const goldRun = createRunDocument(testCase.contract, goldEvents);

      assert.deepEqual(
        projectSemanticState(candidateRun),
        projectSemanticState(goldRun),
        `${testCase.id} cut ${cut.index}: projected state`,
      );
      assert.deepEqual(
        candidate.candidateQuery,
        parseQueryV0Alpha3(candidate.candidateQuery, candidateRun),
        `${testCase.id} cut ${cut.index}: compiled query`,
      );
      const conclusion = reasonTemporalQueryV0Alpha3(
        candidateRun,
        candidate.candidateQuery,
      );
      assert.deepEqual(
        conclusion.result,
        cut.expectedResult,
        `${testCase.id} cut ${cut.index}: semantic result`,
      );
      assert.equal(
        verifyTemporalConclusionV0Alpha3(
          candidateRun,
          candidate.candidateQuery,
          conclusion,
        ),
        true,
        `${testCase.id} cut ${cut.index}: proof verification`,
      );

      knowledgeCuts.push({
        handle: createKnowledgeCutHandle(cut.index),
        recordedThrough:
          candidateEvents.length === 0 ? null : candidateEvents.length - 1,
      });
      compiledCuts += 1;
    }
  }

  assert.equal(compiledCuts, 36);
});

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}
