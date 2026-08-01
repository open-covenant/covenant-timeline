#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  parseQueryV0Alpha3,
  parseRunDocumentV0Alpha3,
  reasonTemporalQueryV0Alpha3,
} from "../packages/prototype/dist/index.js";
import {
  createBoundaryReferenceScope,
  createBoundaryTrajectory,
} from "./model-proposal-boundary.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(
  root,
  "benchmarks/model-interface/v1/heldout-cases.jsonl",
);
const outputDirectory = join(root, "benchmarks/model-proposal-boundary/v2");
const corpusPath = join(outputDirectory, "cases.jsonl");
const supportsPath = join(outputDirectory, "acceptable-supports.json");

const claimOpeners = [
  "Release ledger",
  "Instrument archive",
  "Operations journal",
  "Review record",
  "Signed worksheet",
  "Incident archive",
];

export async function materializeModelProposalBoundaryV2() {
  const source = (await readFile(sourcePath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const supportCases = {};
  const cases = source.map((testCase, caseIndex) => {
    const shift = 37 + caseIndex * 11;
    const transformed = structuredClone(testCase);
    transformed.id = `${testCase.id.replace(/\.paraphrase$/u, "")}.proposal-v2`;
    transformed.evidence = [];
    supportCases[transformed.id] = {};
    const referenceScope = createBoundaryReferenceScope(transformed);
    const initialTrajectory = createBoundaryTrajectory(transformed);
    const assertionHandles = new Map(initialTrajectory.assertionHandles);
    let nextAssertionOrdinal = initialTrajectory.nextAssertionOrdinal;

    for (const cut of transformed.cuts) {
      cut.question = questionFor(transformed, cut);
      supportCases[transformed.id][cut.index] = [];
      const cutEvidence = [];
      cut.goldEvents = cut.goldEvents.map((event, eventIndex) => {
        const shifted = shiftEvent(event, shift);
        const evidenceId = recordId(caseIndex, cut.index, eventIndex);
        const quote = claimFor({
          testCase: transformed,
          event: shifted,
          cut,
          eventIndex,
        });
        const text = `${claimOpeners[(caseIndex + cut.index) % claimOpeners.length]} entry. ${quote} Filed under change request ${800 + caseIndex * 20 + cut.index * 3 + eventIndex}.`;
        const digest = digestText(text);
        cutEvidence.push({
          cut: cut.index,
          digest,
          id: evidenceId,
          text,
        });
        supportCases[transformed.id][cut.index].push({
          change: proposalChangeForGold({
            event: shifted,
            referenceScope,
            assertionHandles,
          }),
          evidenceId,
          quotes: [quote],
        });
        const updated = withEvidenceRef(shifted, digest);
        if (updated.assertion) {
          assertionHandles.set(
            updated.assertion.id,
            assertionHandle(nextAssertionOrdinal),
          );
          nextAssertionOrdinal += 1;
        }
        return updated;
      });

      cutEvidence.push(
        administrativeDistractor(caseIndex, cut.index, cut.goldEvents.length),
        rejectedChangeDistractor(
          transformed,
          caseIndex,
          cut.index,
          cut.goldEvents.length + 1,
        ),
      );
      cutEvidence.sort(({ id: left }, { id: right }) =>
        left.localeCompare(right, "en"),
      );
      transformed.evidence.push(...cutEvidence);
    }

    recomputeExpectedResults(transformed);
    return transformed;
  });
  const corpus = `${cases.map(canonicalJson).join("\n")}\n`;
  const supports = {
    schema: "covenant.timeline.model-proposal-supports.v2",
    cases: supportCases,
  };
  return {
    corpus,
    supports: `${canonicalJson(supports)}\n`,
  };
}

function shiftEvent(event, shift) {
  if (event.type !== "coordinate.asserted") return structuredClone(event);
  const shifted = structuredClone(event);
  if (shifted.assertion.coordinate.minimum !== undefined) {
    shifted.assertion.coordinate.minimum += shift;
  }
  if (shifted.assertion.coordinate.maximum !== undefined) {
    shifted.assertion.coordinate.maximum += shift;
  }
  return shifted;
}

function withEvidenceRef(event, digest) {
  const updated = structuredClone(event);
  if (updated.type === "assertion.retracted") {
    updated.evidenceRefs = [digest];
  } else {
    updated.assertion.evidenceRefs = [digest];
  }
  return updated;
}

function claimFor({ testCase, event, cut, eventIndex }) {
  if (event.type === "assertion.retracted") {
    const target = activeAssertionLabel(testCase, event.assertionId);
    return `The active ${target} assertion is withdrawn without a replacement.`;
  }
  if (event.type === "constraint.asserted") {
    const { constraint, supersedes = [] } = event.assertion;
    const from = labelFor(testCase, constraint.fromPointId);
    const to = labelFor(testCase, constraint.toPointId);
    const bounds = boundsPhrase(
      constraint,
      `the duration from ${from} to ${to}`,
    );
    return supersedes.length === 0
      ? `${upperFirst(bounds)}.`
      : `Correction: replace the active duration claim; ${lowerFirst(bounds)}.`;
  }

  const { coordinate, pointId, supersedes = [] } = event.assertion;
  const target = labelFor(testCase, pointId);
  const priorSameTarget = earlierCoordinateFor(testCase, cut.index, pointId);
  const bounds = boundsPhrase(coordinate, target);
  if (supersedes.length > 0) {
    return `Correction: replace the active ${target} value; ${lowerFirst(bounds)}.`;
  }
  if (priorSameTarget && exactSameCoordinate(priorSameTarget, coordinate)) {
    return `An independent source confirms that ${lowerFirst(bounds)}.`;
  }
  if (eventIndex % 2 === 0) return `${upperFirst(bounds)}.`;
  return `After source review, ${lowerFirst(bounds)}.`;
}

function proposalChangeForGold({ event, referenceScope, assertionHandles }) {
  if (event.type === "assertion.retracted") {
    const assertionHandle = assertionHandles.get(event.assertionId);
    if (!assertionHandle)
      throw new Error(`missing assertion ${event.assertionId}`);
    return { type: "retraction", assertionHandle };
  }

  const revision = revisionFor(event.assertion.supersedes, assertionHandles);
  if (event.type === "coordinate.asserted") {
    const pointHandle = referenceScope.pointHandleById.get(
      event.assertion.pointId,
    );
    if (!pointHandle)
      throw new Error(`missing point ${event.assertion.pointId}`);
    return {
      type: "coordinate",
      pointHandle,
      bounds: proposalBounds(event.assertion.coordinate),
      revision,
    };
  }

  const { fromPointId, toPointId, ...bounds } = event.assertion.constraint;
  const differenceHandle = referenceScope.hostCatalog.find(
    (entry) =>
      entry.type === "difference" &&
      entry.fromPointId === fromPointId &&
      entry.toPointId === toPointId,
  )?.handle;
  if (!differenceHandle) {
    throw new Error(`missing difference ${fromPointId} -> ${toPointId}`);
  }
  return {
    type: "constraint",
    differenceHandle,
    bounds: proposalBounds(bounds),
    revision,
  };
}

function proposalBounds(bounds) {
  if (
    bounds.minimum !== undefined &&
    bounds.maximum !== undefined &&
    bounds.minimum === bounds.maximum
  ) {
    return { type: "exact", value: bounds.minimum };
  }
  if (bounds.minimum !== undefined && bounds.maximum !== undefined) {
    return {
      type: "closed-range",
      minimum: bounds.minimum,
      maximum: bounds.maximum,
    };
  }
  if (bounds.minimum !== undefined) {
    return { type: "lower-bound", minimum: bounds.minimum };
  }
  return { type: "upper-bound", maximum: bounds.maximum };
}

function revisionFor(supersedes = [], assertionHandles) {
  if (supersedes.length === 0) return { type: "keep" };
  if (supersedes.length !== 1) {
    throw new Error("proposal changes support one superseded assertion");
  }
  const assertionHandle = assertionHandles.get(supersedes[0]);
  if (!assertionHandle) throw new Error(`missing assertion ${supersedes[0]}`);
  return { type: "supersede", assertionHandle };
}

function boundsPhrase(bounds, subject) {
  if (
    bounds.minimum !== undefined &&
    bounds.maximum !== undefined &&
    bounds.minimum === bounds.maximum
  ) {
    return `${subject} is recorded at offset ${bounds.minimum}`;
  }
  if (bounds.minimum !== undefined && bounds.maximum !== undefined) {
    return `${subject} is recorded between offsets ${bounds.minimum} and ${bounds.maximum}, inclusive`;
  }
  if (bounds.minimum !== undefined) {
    return `${subject} is recorded no earlier than offset ${bounds.minimum}`;
  }
  return `${subject} is recorded no later than offset ${bounds.maximum}`;
}

function earlierCoordinateFor(testCase, cutIndex, pointId) {
  for (const cut of testCase.cuts.slice(0, cutIndex)) {
    for (const event of cut.goldEvents) {
      if (
        event.type === "coordinate.asserted" &&
        event.assertion.pointId === pointId
      ) {
        return event.assertion.coordinate;
      }
    }
  }
  return null;
}

function exactSameCoordinate(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function activeAssertionLabel(testCase, assertionId) {
  for (const cut of testCase.cuts) {
    for (const event of cut.goldEvents) {
      if (event.assertion?.id !== assertionId) continue;
      if (event.type === "coordinate.asserted") {
        return labelFor(testCase, event.assertion.pointId);
      }
      if (event.type === "constraint.asserted") {
        const { fromPointId, toPointId } = event.assertion.constraint;
        return `duration from ${labelFor(testCase, fromPointId)} to ${labelFor(testCase, toPointId)}`;
      }
    }
  }
  throw new Error(`missing assertion ${assertionId}`);
}

function questionFor(testCase, cut) {
  const query = cut.goldQuery;
  const prefix =
    query.recordedThrough === recordedThroughAt(testCase, cut.index)
      ? "At this knowledge cut"
      : "Using only the first completed knowledge cut";
  if (query.type === "context.consistency") {
    const mode = testCase.contract.contexts.find(
      ({ id }) => id === query.contextId,
    )?.mode;
    return `${prefix}, can every active assertion in the ${mode} context hold at once?`;
  }
  if (query.type === "difference.bounds") {
    return `${prefix}, what bounds are justified for ${labelFor(testCase, query.toPointId)} minus ${labelFor(testCase, query.fromPointId)}?`;
  }
  if (query.type === "point.relations") {
    return `${prefix}, which orderings remain possible from ${labelFor(testCase, query.leftPointId)} to ${labelFor(testCase, query.rightPointId)}?`;
  }
  return `${prefix}, which Allen relations remain possible from ${labelFor(testCase, query.leftIntervalId)} to ${labelFor(testCase, query.rightIntervalId)}?`;
}

function recordedThroughAt(testCase, cutIndex) {
  return (
    testCase.setupEvents.length +
    testCase.cuts
      .slice(0, cutIndex + 1)
      .reduce((count, cut) => count + cut.goldEvents.length, 0) -
    1
  );
}

function administrativeDistractor(caseIndex, cutIndex, slot) {
  const text = `Delivery dashboard entry: request ${700 + caseIndex * 10 + cutIndex} carries priority ${3 + cutIndex} and has ${2 + ((caseIndex + cutIndex) % 4)} reviewers assigned.`;
  return {
    cut: cutIndex,
    digest: digestText(text),
    id: recordId(caseIndex, cutIndex, slot),
    text,
  };
}

function rejectedChangeDistractor(testCase, caseIndex, cutIndex, slot) {
  const entity = Object.values(testCase.entities)[0];
  const text = `Change request ${950 + caseIndex * 7 + cutIndex} proposed ${entity} at offset ${900 + caseIndex * 7 + cutIndex}, but the review board rejected the request and closed it without applying the change.`;
  return {
    cut: cutIndex,
    digest: digestText(text),
    id: recordId(caseIndex, cutIndex, slot),
    text,
  };
}

function recordId(caseIndex, cutIndex, slot) {
  return `record-${createHash("sha256")
    .update(`proposal-v2:${caseIndex}:${cutIndex}:${slot}`, "utf8")
    .digest("hex")
    .slice(0, 16)}`;
}

function assertionHandle(index) {
  return `assertion-${String(index).padStart(3, "0")}`;
}

function recomputeExpectedResults(testCase) {
  let events = [...testCase.setupEvents];
  for (const cut of testCase.cuts) {
    events = [...events, ...cut.goldEvents];
    const run = parseRunDocumentV0Alpha3({
      schema: "covenant.timeline.run.v0alpha3",
      contract: testCase.contract,
      events,
    });
    const query = parseQueryV0Alpha3(cut.goldQuery, run);
    cut.expectedResult = reasonTemporalQueryV0Alpha3(run, query).result;
  }
}

function labelFor(testCase, id) {
  const label = testCase.entities[id];
  if (!label) throw new Error(`missing entity label for ${id}`);
  return label;
}

function lowerFirst(value) {
  return `${value[0].toLowerCase()}${value.slice(1)}`;
}

function upperFirst(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function digestText(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

async function main() {
  const { corpus, supports } = await materializeModelProposalBoundaryV2();
  await Promise.all([
    writeFile(resolve(corpusPath), corpus, { encoding: "utf8", flag: "w" }),
    writeFile(resolve(supportsPath), supports, {
      encoding: "utf8",
      flag: "w",
    }),
  ]);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
