import {
  byteDigest,
  compileTemporalModelProposalV1,
  reasonTemporalQueryV0Alpha3,
  verifyTemporalConclusionV0Alpha3,
  verifyTemporalModelProposalCandidateV1,
} from "@covenant-org/timeline";

const encode = (value) => new TextEncoder().encode(value);
const evidenceText =
  "Deployment began at tick 200. Review finished 100 ticks later.";
const deployQuote = "Deployment began at tick 200.";
const durationQuote = "Review finished 100 ticks later.";

const run = {
  schema: "covenant.timeline.run.v0alpha3",
  contract: {
    schema: "covenant.timeline.contract.v0alpha3",
    id: "installed-proposal-smoke",
    subject: { kind: "workflow", id: "release-candidate" },
    axes: [{ id: "elapsed", kind: "metric", unit: "tick", origin: "start" }],
    contexts: [{ id: "actual", mode: "actual" }],
  },
  events: [
    {
      schema: "covenant.timeline.event.v0alpha3",
      id: "event-deploy",
      sequence: 0,
      type: "point.declared",
      point: { id: "deployed", contextId: "actual", axisId: "elapsed" },
    },
    {
      schema: "covenant.timeline.event.v0alpha3",
      id: "event-review",
      sequence: 1,
      type: "point.declared",
      point: {
        id: "review-finished",
        contextId: "actual",
        axisId: "elapsed",
      },
    },
  ],
};

const host = {
  run,
  expectedRequestId: "request-installed-proposal-smoke",
  evidenceCatalog: [
    { id: "release-log", status: "current", text: evidenceText },
  ],
  referenceCatalog: [
    { type: "point", handle: "deploy", pointId: "deployed" },
    { type: "point", handle: "review", pointId: "review-finished" },
    {
      type: "difference",
      handle: "review-minus-deploy",
      fromPointId: "deployed",
      toPointId: "review-finished",
    },
  ],
  assertionCatalog: [],
  knowledgeCutCatalog: [],
};

const proposal = {
  schema: "covenant.timeline.model-proposal.v1",
  requestId: host.expectedRequestId,
  changes: [
    {
      type: "coordinate",
      pointHandle: "deploy",
      bounds: { type: "exact", value: 200 },
      supports: [{ evidenceId: "release-log", quote: deployQuote }],
      revision: { type: "keep" },
    },
    {
      type: "constraint",
      differenceHandle: "review-minus-deploy",
      bounds: { type: "exact", value: 100 },
      supports: [{ evidenceId: "release-log", quote: durationQuote }],
      revision: { type: "keep" },
    },
  ],
  query: {
    type: "difference",
    targetHandle: "review-minus-deploy",
    knowledgeCut: { type: "current" },
  },
};

const candidate = compileTemporalModelProposalV1(proposal, host);
const candidateVerified = verifyTemporalModelProposalCandidateV1(
  candidate,
  proposal,
  host,
);
const candidateRun = {
  ...run,
  events: [...run.events, ...candidate.candidateEvents],
};
const conclusion = reasonTemporalQueryV0Alpha3(
  candidateRun,
  candidate.candidateQuery,
);
const expectedEvidenceRef = byteDigest(encode(evidenceText));
const provenanceBound = candidate.provenance.every(
  ({ supports }) =>
    supports.length === 1 && supports[0]?.evidenceRef === expectedEvidenceRef,
);
const serializedCandidate = JSON.stringify(candidate);

process.stdout.write(
  JSON.stringify({
    candidateVerified,
    events: candidate.candidateEvents.length,
    minimum:
      conclusion.result.type === "difference.bounds"
        ? conclusion.result.minimum
        : null,
    maximum:
      conclusion.result.type === "difference.bounds"
        ? conclusion.result.maximum
        : null,
    proof: verifyTemporalConclusionV0Alpha3(
      candidateRun,
      candidate.candidateQuery,
      conclusion,
    ),
    provenanceBound,
    sourceTextAbsent:
      !serializedCandidate.includes(evidenceText) &&
      !serializedCandidate.includes(deployQuote) &&
      !serializedCandidate.includes(durationQuote),
  }),
);
