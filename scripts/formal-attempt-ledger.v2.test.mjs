import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  claimProviderInvocation,
  completeAttemptPhase,
  completedAttemptLedger,
  createAttemptLedger,
  failAttemptPhase,
  failAttemptPhaseV2,
  failedAttemptLedgerSnapshotV2,
  loadAttemptLedger,
  validateAttemptLedgerDocument,
  validateFailedAttemptLedgerDocumentV2,
} from "./formal-attempt-ledger.mjs";
import { loadTimeline, sha256 } from "./mcp-agent-pilot-lib.mjs";
import { validatePhaseFailureRecordV2 } from "./mcp-real-model-pilot-failure.mjs";

const LEDGER_V1 = "covenant.timeline.formal-attempt-ledger.v1";
const LEDGER_V2 = "covenant.timeline.formal-attempt-ledger.v2";
const ENTRY_V1 = "covenant.timeline.formal-attempt-ledger.entry.v1";
const ENTRY_V2 = "covenant.timeline.formal-attempt-ledger.entry.v2";
const digest = `sha256:${"0".repeat(64)}`;
const alternateDigest = `sha256:${"1".repeat(64)}`;

test("the published attempt-1 ledger remains an exact valid v1 fixture", async () => {
  const bytes = await readFile(
    new URL(
      "./fixtures/published-real-model-pilot-attempt-1-ledger.json",
      import.meta.url,
    ),
  );
  assert.equal(
    sha256(bytes),
    "sha256:4c80f51290dd02883ff9ae0a5b44206cf34025ec0cb359c7e4eddacd418ee226",
  );
  const timeline = await loadTimeline();
  const text = bytes.toString("utf8");
  const document = timeline.parseJson(text);
  assert.equal(text, `${timeline.canonicalJson(document)}\n`);
  assert.equal(validateAttemptLedgerDocument(document, timeline), document);
});

test("completed attempts retain the published v1 ledger surface", async () => {
  await withLedger(async ({ ledger, timeline }) => {
    const initial = await reserve(ledger, "initial", 0);
    await completeAttemptPhase(ledger, completion("initial", initial));
    const correction = await reserve(ledger, "correction", 1);
    await completeAttemptPhase(ledger, completion("correction", correction));

    const snapshot = completedAttemptLedger(ledger);
    assert.equal(snapshot.document.schema, LEDGER_V1);
    assert.deepEqual(
      snapshot.document.entries.map(({ schema }) => schema),
      Array(5).fill(ENTRY_V1),
    );
    assert.equal(
      validateAttemptLedgerDocument(snapshot.document, timeline),
      snapshot.document,
    );
    assert.throws(
      () => validateFailedAttemptLedgerDocumentV2(snapshot.document, timeline),
      /failed attempt ledger document is invalid/u,
    );
  });
});

test("evidence-bound failures use a v2 terminal entry and mixed v2 snapshot", async () => {
  await withLedger(async ({ directory, ledger, timeline }) => {
    const invocation = await reserve(ledger, "initial", 0);
    const terminal = await failAttemptPhaseV2(ledger, {
      phase: "initial",
      invocation,
      requestDigest: digest,
      adapterExecutionDigest: digest,
      failureBundleDigest: digest,
      failureStage: "adapter-output",
      failureCode: "adapter.invalid-framing",
    });

    assert.equal(terminal.schema, ENTRY_V2);
    assert.equal(ledger.document.schema, LEDGER_V2);
    assert.deepEqual(Object.keys(terminal).sort(), [
      "adapterExecutionDigest",
      "attemptId",
      "failure",
      "failureBundleDigest",
      "failureCode",
      "failureStage",
      "invocationId",
      "kind",
      "phase",
      "previousEntryDigest",
      "recordDigest",
      "requestDigest",
      "schema",
      "sequence",
    ]);

    const snapshot = failedAttemptLedgerSnapshotV2(ledger);
    assert.equal(snapshot.document.schema, LEDGER_V2);
    assert.deepEqual(
      snapshot.document.entries.map(({ schema }) => schema),
      [ENTRY_V1, ENTRY_V1, ENTRY_V2],
    );
    assert.equal(
      validateFailedAttemptLedgerDocumentV2(snapshot.document, timeline),
      snapshot.document,
    );
    assert.throws(
      () => validateAttemptLedgerDocument(snapshot.document, timeline),
      /attempt ledger document is invalid/u,
    );

    const recovered = await loadAttemptLedger(directory, timeline);
    assert.equal(recovered.document.schema, LEDGER_V2);
    assert.deepEqual(recovered.document, snapshot.document);
  });
});

test("the v2 ledger uses the failure record taxonomy without a second code map", async () => {
  assert.deepEqual(
    validatePhaseFailureRecordV2({
      stage: "adapter-output",
      code: "adapter.output-limit",
    }),
    { stage: "adapter-output", code: "adapter.output-limit" },
  );
  assert.throws(
    () =>
      validatePhaseFailureRecordV2({
        stage: "adapter-execution",
        code: "adapter.output-limit",
      }),
    /phase failure classification is invalid/u,
  );

  await withLedger(async ({ ledger }) => {
    const invocation = await reserve(ledger, "initial", 0);
    await assert.rejects(
      failAttemptPhaseV2(ledger, {
        phase: "initial",
        invocation,
        requestDigest: digest,
        adapterExecutionDigest: digest,
        failureBundleDigest: digest,
        failureStage: "adapter-execution",
        failureCode: "adapter.output-limit",
      }),
      /phase failure classification is invalid/u,
    );
    assert.equal(ledger.document.entries.length, 2);
  });
});

test("a correction reservation must continue the completed initial run", async () => {
  await withLedger(async ({ ledger }) => {
    const initial = await reserve(ledger, "initial", 0);
    await completeAttemptPhase(ledger, completion("initial", initial));

    await assert.rejects(
      reserve(ledger, "correction", 2),
      /correction provider invocation does not continue the completed initial run/u,
    );
    await assert.rejects(
      reserve(ledger, "correction", 1, alternateDigest),
      /correction provider invocation does not continue the completed initial run/u,
    );
    assert.equal(ledger.document.entries.length, 3);

    await reserve(ledger, "correction", 1);
    assert.equal(ledger.document.entries.length, 4);
  });
});

test("v2 document validation rejects a correction base detached from initial completion", async () => {
  await withLedger(async ({ ledger, timeline }) => {
    const initial = await reserve(ledger, "initial", 0);
    await completeAttemptPhase(ledger, completion("initial", initial));
    const correction = await reserve(ledger, "correction", 1);
    await failAttemptPhaseV2(ledger, {
      phase: "correction",
      invocation: correction,
      requestDigest: digest,
      adapterExecutionDigest: digest,
      failureBundleDigest: digest,
      failureStage: "proposal-semantics",
      failureCode: "proposal.semantics",
    });
    const valid = failedAttemptLedgerSnapshotV2(ledger).document;

    for (const mutate of [
      (entry) => {
        entry.baseRevision += 1;
      },
      (entry) => {
        entry.baseRunDigest = alternateDigest;
      },
    ]) {
      const detached = structuredClone(valid);
      mutate(detached.entries[3]);
      detached.entries[3] = rehashEntry(detached.entries[3], timeline);
      detached.entries[4].previousEntryDigest =
        detached.entries[3].recordDigest;
      detached.entries[4] = rehashEntry(detached.entries[4], timeline);
      assert.throws(
        () => validateFailedAttemptLedgerDocumentV2(detached, timeline),
        /correction provider invocation does not continue the completed initial run/u,
      );
    }
  });
});

test("the exact legacy v1 failed-entry shape remains loadable", async () => {
  await withLedger(async ({ directory, ledger, timeline }) => {
    const invocation = await reserve(ledger, "initial", 0);
    await failAttemptPhase(ledger, {
      phase: "initial",
      invocation,
      requestDigest: digest,
    });

    const recovered = await loadAttemptLedger(directory, timeline);
    assert.equal(recovered.document.schema, LEDGER_V1);
    assert.deepEqual(Object.keys(recovered.document.entries.at(-1)).sort(), [
      "attemptId",
      "failure",
      "invocationId",
      "kind",
      "phase",
      "previousEntryDigest",
      "recordDigest",
      "requestDigest",
      "schema",
      "sequence",
    ]);
    assert.throws(
      () => failedAttemptLedgerSnapshotV2(recovered),
      /failed attempt ledger document is invalid/u,
    );
  });
});

test("v2 failure fields cannot be smuggled into the v1 entry schema", async () => {
  await withLedger(async ({ directory, ledger, timeline }) => {
    const invocation = await reserve(ledger, "initial", 0);
    const terminal = await failAttemptPhaseV2(ledger, {
      phase: "initial",
      invocation,
      requestDigest: digest,
      adapterExecutionDigest: digest,
      failureBundleDigest: digest,
      failureStage: "adapter-output",
      failureCode: "adapter.error-envelope",
    });
    const invalid = { ...terminal, schema: ENTRY_V1 };
    const { recordDigest: _recordDigest, ...unsigned } = invalid;
    invalid.recordDigest = timeline.contentDigest(unsigned);
    await writeFile(
      join(directory, "attempt-ledger", "002.json"),
      `${timeline.canonicalJson(invalid)}\n`,
      { mode: 0o600 },
    );

    await assert.rejects(
      loadAttemptLedger(directory, timeline),
      /failed phase ledger entry is invalid/u,
    );
  });
});

async function withLedger(run) {
  const directory = await mkdtemp(join(tmpdir(), "timeline-ledger-v2-"));
  try {
    const timeline = await loadTimeline();
    const ledger = await createAttemptLedger(
      directory,
      {
        admissionPolicyDigest: digest,
        inputDigest: digest,
        modelConfigDigest: digest,
        runtimeDigest: digest,
        source: { revision: "0".repeat(40), dirty: true },
      },
      timeline,
    );
    await run({ directory, ledger, timeline });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function reserve(ledger, phase, baseRevision, baseRunDigest = digest) {
  const invocation = {
    phase,
    invocationId: randomUUID(),
    processId: process.pid,
  };
  await claimProviderInvocation(ledger, {
    phase,
    invocation,
    mcpInvocation: {
      phase,
      invocationId: randomUUID(),
      processId: process.pid,
      provenance: "driver-observed-maintainer-attested",
      executableDigest: digest,
      script: "packages/mcp-server/dist/cli.js",
      scriptDigest: digest,
    },
    requestDigest: digest,
    baseRevision,
    baseRunDigest,
  });
  return invocation;
}

function completion(phase, invocation) {
  return {
    phase,
    invocation,
    requestDigest: digest,
    responseDigest: digest,
    proposalDigest: digest,
    candidateDigest: digest,
    resultBundleDigest: digest,
    resultRevision: phase === "initial" ? 1 : 2,
    resultRunDigest: digest,
  };
}

function rehashEntry(entry, timeline) {
  const { recordDigest: _recordDigest, ...unsigned } = entry;
  return { ...unsigned, recordDigest: timeline.contentDigest(unsigned) };
}
