import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalJson,
  contentDigest,
  parseJson,
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
} from "../packages/prototype/dist/index.js";

const directory = join(
  dirname(fileURLToPath(import.meta.url)),
  "correction-replay",
);

async function readJson(path) {
  return parseJson(await readFile(join(directory, path), "utf8"));
}

export async function evaluateCorrectionReplay() {
  const run = parseRunDocumentV0Alpha3(await readJson("run.json"));
  const evidenceDigests = new Set(
    await Promise.all(
      ["review-initial", "deploy", "review-correction"].map(async (name) =>
        contentDigest(await readJson(`evidence/${name}.json`)),
      ),
    ),
  );
  const referencedEvidence = new Set();

  for (const event of run.events) {
    const refs =
      "assertion" in event
        ? event.assertion.evidenceRefs
        : "evidenceRefs" in event
          ? event.evidenceRefs
          : [];

    for (const ref of refs) {
      if (!evidenceDigests.has(ref)) {
        throw new Error(`event ${event.id} references uncommitted evidence`);
      }
      referencedEvidence.add(ref);
    }
  }

  if (
    referencedEvidence.size !== evidenceDigests.size ||
    [...evidenceDigests].some((digest) => !referencedEvidence.has(digest))
  ) {
    throw new Error("correction replay includes unreferenced evidence");
  }

  const cuts = [];

  for (const name of ["before", "transition", "after"]) {
    const query = parseQueryV0Alpha3(
      await readJson(`queries/${name}.json`),
      run,
    );
    const conclusion = reasonTemporalQueryV0Alpha3(run, query);
    const expected = await readJson(`conclusions/${name}.json`);

    if (canonicalJson(conclusion) !== canonicalJson(expected)) {
      throw new Error(`${name} conclusion does not match the checked fixture`);
    }
    if (!verifyTemporalConclusionV0Alpha3(run, query, conclusion)) {
      throw new Error(`${name} conclusion proof did not verify`);
    }

    cuts.push({
      name,
      recordedThrough: query.recordedThrough,
      conclusion,
      verified: true,
    });
  }

  return {
    schema: "covenant.timeline.correction-replay.v1",
    cuts,
  };
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  process.stdout.write(`${canonicalJson(await evaluateCorrectionReplay())}\n`);
}
