import { readFile } from "node:fs/promises";
import {
  canonicalJson,
  parseJson,
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "../packages/prototype/dist/index.js";

const run = parseRunDocumentV0Alpha3(
  parseJson(
    await readFile("conformance/v0alpha3/runs/software-release.json", "utf8"),
  ),
);
const queryFiles = [
  "difference-bounds.json",
  "point-relations-at-cut.json",
  "interval-relations.json",
  "consistency-after-correction.json",
];

const conclusions = [];
for (const file of queryFiles) {
  const query = parseQueryV0Alpha3(
    parseJson(await readFile(`conformance/v0alpha3/queries/${file}`, "utf8")),
    run,
  );
  const conclusion = reasonTemporalQueryV0Alpha3(run, query);
  if (!verifyTemporalConclusionV0Alpha3(run, query, conclusion)) {
    throw new Error(`proof verification failed for ${query.id}`);
  }
  conclusions.push(conclusion);
}

process.stdout.write(
  `${canonicalJson({
    schema: "covenant.timeline.temporal-demo.v0alpha3",
    conclusions,
  })}\n`,
);
