#!/usr/bin/env node

import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { byteDigest, canonicalJson } from "../packages/prototype/dist/index.js";
import { parseStrictJson } from "./strict-json.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultCases = resolve(root, "benchmarks/model-interface/v1/cases.jsonl");
const defaultParaphrases = resolve(
  root,
  "benchmarks/model-interface/v1/paraphrases.json",
);
const PARAPHRASE_SCHEMA = "covenant.timeline.model-eval.paraphrases.v1";

export async function materializeHeldoutCases({
  cases = defaultCases,
  paraphrases = defaultParaphrases,
}) {
  const [baseBytes, paraphraseText] = await Promise.all([
    readFile(cases),
    readFile(paraphrases, "utf8"),
  ]);
  const specification = parseStrictJson(paraphraseText, paraphrases);
  if (specification.schema !== PARAPHRASE_SCHEMA) {
    throw new Error("paraphrase specification uses an unsupported schema");
  }
  if (specification.baseCorpusDigest !== byteDigest(baseBytes)) {
    throw new Error("paraphrase specification targets a different corpus");
  }
  if (
    specification.cases === null ||
    typeof specification.cases !== "object" ||
    Array.isArray(specification.cases)
  ) {
    throw new Error("paraphrase specification cases must be an object");
  }

  const source = baseBytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line, index) => parseStrictJson(line, `${cases}:${index + 1}`));
  const sourceIds = source.map(({ id }) => id).sort();
  const specificationIds = Object.keys(specification.cases).sort();
  if (canonicalJson(sourceIds) !== canonicalJson(specificationIds)) {
    throw new Error("paraphrase specification does not cover the corpus");
  }

  const materialized = source.map((testCase) => {
    const rewrite = specification.cases[testCase.id];
    requireStringArray(rewrite?.evidence, 3, `${testCase.id}.evidence`);
    requireStringArray(rewrite?.questions, 3, `${testCase.id}.questions`);
    const digestMap = new Map();
    const evidence = testCase.evidence.map((record, index) => {
      const text = rewrite.evidence[index];
      if (text === record.text) {
        throw new Error(`${testCase.id}.evidence[${index}] is not paraphrased`);
      }
      const digest = textDigest(text);
      digestMap.set(record.digest, digest);
      return { ...record, text, digest };
    });
    const cuts = testCase.cuts.map((cut, index) => {
      const question = rewrite.questions[index];
      if (question === cut.question) {
        throw new Error(
          `${testCase.id}.questions[${index}] is not paraphrased`,
        );
      }
      return {
        ...cut,
        question,
        goldEvents: cut.goldEvents.map((event) =>
          rewriteEvidenceRefs(event, digestMap),
        ),
      };
    });
    return {
      ...testCase,
      id: `${testCase.id}.paraphrase`,
      evidence,
      cuts,
    };
  });
  return Buffer.from(
    `${materialized.map((record) => canonicalJson(record)).join("\n")}\n`,
    "utf8",
  );
}

function requireStringArray(value, length, label) {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`${label} must contain exactly ${length} strings`);
  }
}

function textDigest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function rewriteEvidenceRefs(event, digestMap) {
  const copy = structuredClone(event);
  const refs =
    copy.type === "assertion.retracted"
      ? copy.evidenceRefs
      : copy.assertion?.evidenceRefs;
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new Error(`${event.id} has no evidence references`);
  }
  for (let index = 0; index < refs.length; index += 1) {
    const replacement = digestMap.get(refs[index]);
    if (replacement === undefined) {
      throw new Error(`${event.id} cites evidence outside its case`);
    }
    refs[index] = replacement;
  }
  return copy;
}

async function main(args) {
  if (args.length !== 2 || args[0] !== "--output") {
    throw new Error("usage: materialize-model-interface-heldout --output PATH");
  }
  const output = resolve(args[1]);
  const bytes = await materializeHeldoutCases({});
  const file = await open(output, "wx", 0o644);
  try {
    await file.writeFile(bytes);
  } finally {
    await file.close();
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
