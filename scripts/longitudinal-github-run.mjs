#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  canonicalJson,
  contentDigest,
  evaluateRunDocumentV0Alpha2,
  exportEd25519PublicKey,
  policyBindingForGithub,
  signGithubEnvelope,
  verifyGithubEnvelope,
} from "../packages/prototype/dist/index.js";

const [command, ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);

if (!["init", "resume", "finalize", "verify"].includes(command)) {
  fail(
    "usage: longitudinal-github-run.mjs <init|resume|finalize|verify> --out <file> [options]",
  );
}

const output = required(args, "out");

if (command === "init") {
  initialize(output, args);
} else if (command === "resume") {
  resume(output);
} else if (command === "finalize") {
  finalize(output);
} else {
  verifyArchive(output);
}

function initialize(path, options) {
  const repository = required(options, "repo");
  const pullRequest = Number.parseInt(required(options, "pr"), 10);
  if (!Number.isSafeInteger(pullRequest) || pullRequest < 1) {
    fail("--pr must be a positive integer");
  }
  const privateKey = readFileSync(required(options, "key"));
  const apiVersion = options["api-version"] ?? "2026-03-10";
  const requiredChecks = arrayArg(options, "check");
  if (requiredChecks.length === 0) fail("at least one --check is required");

  const collected = collectGithub(repository, pullRequest, apiVersion);
  const observedAt = new Date().toISOString();
  const revocations = {
    schema: "covenant.timeline.profile.github-revocations.v1",
    policyRef: `github.${repository.replace("/", ".")}.pr-${pullRequest}.v1`,
    generatedAt: observedAt,
    revokedKeys: [],
  };
  const policy = {
    schema: "covenant.timeline.profile.github-policy.v1",
    id: revocations.policyRef,
    profile: "github.software-delivery.v1",
    repository,
    apiVersion,
    collectorKeys: [
      {
        id: "public-run-collector",
        algorithm: "ed25519",
        publicKey: exportEd25519PublicKey(privateKey),
      },
    ],
    maxAgeSeconds: 3_600,
    clockSkewSeconds: 30,
    requiredChecks,
    minimumApprovals: 1,
    requiredDeployments: [],
    revocationListDigest: contentDigest(revocations),
  };
  const expiresAt = new Date(
    Date.parse(observedAt) + policy.maxAgeSeconds * 1_000,
  ).toISOString();
  const envelope = signGithubEnvelope({
    policy,
    keyId: "public-run-collector",
    privateKey,
    payload: collected.payload,
    observedAt,
    expiresAt,
  });
  const evidence = verifyGithubEnvelope(
    envelope,
    policy,
    revocations,
    `github-pr-${pullRequest}`,
    { now: observedAt },
  );
  const binding = policyBindingForGithub(policy);
  const run = {
    schema: "covenant.timeline.run.v0alpha2",
    runId: `public.github.${repository.replace("/", ".")}.pr-${pullRequest}`,
    contract: {
      schema: "covenant.timeline.contract.v0alpha2",
      id: `github.${repository.replace("/", ".")}.release`,
      subject: { kind: "repository", id: repository },
      checkpoints: [
        {
          id: "release-verified",
          requirements: [
            "github.commit.bound",
            "ci.tests.pass",
            "review.approved",
            "release.merged",
          ],
          policy: binding,
          onAccept: {
            kind: "timeline.archive.publish",
            payloadRef: `github.pr-${pullRequest}`,
          },
        },
      ],
    },
    events: [
      {
        schema: "covenant.timeline.event.v0alpha2",
        id: "event-0",
        sequence: 0,
        type: "evidence.recorded",
        evidence,
      },
    ],
  };
  const initial = evaluateRunDocumentV0Alpha2(run);
  if (initial.state.checkpoints["release-verified"]?.status !== "pending") {
    fail("initial run must stop before evaluation");
  }

  writeArchive(path, {
    schema: "covenant.timeline.archive.github-run.v1",
    phase: "collected",
    processRestarts: 0,
    sourceWindow: collected.sourceWindow,
    policy,
    revocations,
    envelope,
    run,
  });
  console.log(`initialized ${path}`);
}

function resume(path) {
  const archive = readArchive(path);
  if (archive.phase !== "collected") {
    fail("resume requires a collected archive");
  }
  verifyProfile(archive);
  const before = evaluateRunDocumentV0Alpha2(archive.run);
  if (before.state.nextSequence !== 1) {
    fail("resume expected one recorded evidence event");
  }
  archive.run.events.push({
    schema: "covenant.timeline.event.v0alpha2",
    id: "event-1",
    sequence: 1,
    type: "checkpoint.evaluated",
    checkpointId: "release-verified",
    evidenceRefs: [archive.run.events[0].evidence.id],
  });
  const after = evaluateRunDocumentV0Alpha2(archive.run);
  if (
    after.state.checkpoints["release-verified"]?.status !== "accepted" ||
    Object.keys(after.state.commands).length !== 1
  ) {
    fail("resumed evaluation did not emit one command");
  }
  archive.phase = "evaluated";
  archive.processRestarts += 1;
  archive.evaluatedStateDigest = after.stateDigest;
  writeArchive(path, archive);
  console.log(`resumed ${path}`);
}

function finalize(path) {
  const archive = readArchive(path);
  if (archive.phase !== "evaluated") {
    fail("finalize requires an evaluated archive");
  }
  verifyProfile(archive);
  const before = evaluateRunDocumentV0Alpha2(archive.run);
  const commandId = Object.keys(before.state.commands)[0];
  if (!commandId) fail("evaluated archive has no command");
  const effectDigest = contentDigest({
    schema: "covenant.timeline.effect.archive-published.v1",
    runId: archive.run.runId,
    eventsDigest: before.eventsDigest,
    sourceWindow: archive.sourceWindow,
  });
  archive.run.events.push({
    schema: "covenant.timeline.event.v0alpha2",
    id: "event-2",
    sequence: 2,
    type: "receipt.recorded",
    receipt: {
      id: "receipt-archive-published",
      commandId,
      status: "succeeded",
      effectDigest,
    },
  });
  const final = evaluateRunDocumentV0Alpha2(archive.run);
  if (!final.verification.ok) fail("finalized run did not verify");
  archive.phase = "complete";
  archive.finalStateDigest = final.stateDigest;
  archive.verification = {
    ok: true,
    sourceElapsedSeconds: archive.sourceWindow.elapsedSeconds,
    crossedProcessRestart: archive.processRestarts > 0,
    profileProofDigest: archive.run.events[0].evidence.authority.proofDigest,
  };
  writeArchive(path, archive);
  console.log(`finalized ${path}`);
}

function verifyArchive(path) {
  const archive = readArchive(path);
  verifyProfile(archive);
  const report = evaluateRunDocumentV0Alpha2(archive.run);
  if (archive.phase === "complete") {
    if (!report.verification.ok) fail("completed archive does not verify");
    if (report.stateDigest !== archive.finalStateDigest) {
      fail("completed archive state digest changed");
    }
    if (
      archive.processRestarts < 1 ||
      archive.sourceWindow.elapsedSeconds < 86_400
    ) {
      fail("archive does not prove a restart and real elapsed day");
    }
  }
  console.log(
    canonicalJson({
      ok: report.verification.ok,
      phase: archive.phase,
      runId: archive.run.runId,
      stateDigest: report.stateDigest,
      sourceElapsedSeconds: archive.sourceWindow.elapsedSeconds,
      crossedProcessRestart: archive.processRestarts > 0,
    }),
  );
}

function verifyProfile(archive) {
  const event = archive.run.events[0];
  if (event?.type !== "evidence.recorded") {
    fail("archive has no profile-bound evidence");
  }
  const evidence = verifyGithubEnvelope(
    archive.envelope,
    archive.policy,
    archive.revocations,
    event.evidence.id,
    { now: archive.envelope.observedAt },
  );
  if (canonicalJson(evidence) !== canonicalJson(event.evidence)) {
    fail("recorded evidence differs from verified profile output");
  }
}

function collectGithub(repository, pullRequest, apiVersion) {
  const headers = [
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    `X-GitHub-Api-Version: ${apiVersion}`,
  ];
  const pr = ghApi([...headers, `repos/${repository}/pulls/${pullRequest}`]);
  const view = gh([
    "pr",
    "view",
    String(pullRequest),
    "--repo",
    repository,
    "--json",
    "mergeCommit,mergedAt,headRefOid,baseRefOid,reviewDecision",
  ]);
  const reviews = ghApi([
    "--paginate",
    ...headers,
    `repos/${repository}/pulls/${pullRequest}/reviews?per_page=100`,
  ]);
  const checks = ghApi([
    ...headers,
    `repos/${repository}/commits/${view.headRefOid}/check-runs?per_page=100`,
  ]);
  const approved = distinctApprovals(reviews);
  const openedAt = new Date(pr.created_at).toISOString();
  const mergedAt = new Date(view.mergedAt).toISOString();
  return {
    payload: {
      schema: "covenant.timeline.profile.github-payload.v1",
      repository,
      pullRequest,
      headSha: view.headRefOid,
      baseSha: view.baseRefOid,
      openedAt,
      mergedAt,
      merged: Boolean(view.mergedAt),
      mergeCommitSha: view.mergeCommit?.oid ?? null,
      checks: latestChecks(checks.check_runs)
        .map(({ name, status, conclusion, completed_at }) => ({
          name,
          status,
          conclusion,
          completedAt: completed_at
            ? new Date(completed_at).toISOString()
            : null,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      approvedReviews: approved.length,
      approvedAt:
        approved.length > 0
          ? new Date(
              approved
                .map(({ submitted_at }) => submitted_at)
                .sort()
                .at(-1),
            ).toISOString()
          : null,
      reviewDecision: view.reviewDecision,
      deployments: [],
      source: { kind: "github-api", apiVersion },
    },
    sourceWindow: {
      openedAt,
      mergedAt,
      elapsedSeconds: Math.floor(
        (Date.parse(mergedAt) - Date.parse(openedAt)) / 1_000,
      ),
    },
  };
}

function distinctApprovals(reviews) {
  const approvals = new Map();
  for (const review of reviews) {
    if (review.state !== "APPROVED") continue;
    const reviewer = review.user?.id;
    if (!Number.isSafeInteger(reviewer)) {
      fail("approved review has no stable reviewer identity");
    }
    const prior = approvals.get(reviewer);
    if (
      !prior ||
      Date.parse(review.submitted_at) >= Date.parse(prior.submitted_at)
    ) {
      approvals.set(reviewer, review);
    }
  }
  return [...approvals.values()];
}

function latestChecks(checkRuns) {
  const latest = new Map();
  for (const check of checkRuns) {
    if (typeof check.name !== "string" || check.name.length === 0) continue;
    const prior = latest.get(check.name);
    const checkTime = Date.parse(check.completed_at ?? check.started_at ?? 0);
    const priorTime = Date.parse(prior?.completed_at ?? prior?.started_at ?? 0);
    if (!prior || checkTime >= priorTime) latest.set(check.name, check);
  }
  return [...latest.values()];
}

function ghApi(args) {
  return gh(["api", ...args]);
}

function gh(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`gh ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`gh ${args[0]} returned invalid JSON`);
  }
}

function readArchive(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeArchive(path, archive) {
  writeFileSync(path, `${canonicalJson(archive)}\n`);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith("--")) fail(`unexpected argument ${key}`);
    const name = key.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) fail(`${key} requires a value`);
    if (parsed[name] === undefined) {
      parsed[name] = value;
    } else if (Array.isArray(parsed[name])) {
      parsed[name].push(value);
    } else {
      parsed[name] = [parsed[name], value];
    }
    index += 1;
  }
  return parsed;
}

function required(values, key) {
  const value = values[key];
  if (typeof value !== "string") fail(`--${key} is required`);
  return value;
}

function arrayArg(values, key) {
  const value = values[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
