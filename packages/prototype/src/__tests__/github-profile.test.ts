import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GithubAuthorityError,
  exportEd25519PublicKey,
  signGithubEnvelope,
  verifyGithubEnvelope,
  verifyGithubWebhookSignature,
  type GithubDeliveryPayload,
  type GithubDeliveryPolicy,
  type GithubRevocationList,
} from "../index.js";
import { contentDigest, type JsonValue } from "../identity.js";

const keyPair = generateKeyPairSync("ed25519");
const revocations: GithubRevocationList = {
  schema: "covenant.timeline.profile.github-revocations.v1",
  policyRef: "software.release.v1",
  generatedAt: "2026-07-26T12:00:00.000Z",
  revokedKeys: [],
};
const policy: GithubDeliveryPolicy = {
  schema: "covenant.timeline.profile.github-policy.v1",
  id: "software.release.v1",
  profile: "github.software-delivery.v1",
  repository: "open-covenant/covenant-timeline",
  apiVersion: "2026-03-10",
  collectorKeys: [
    {
      id: "collector-1",
      algorithm: "ed25519",
      publicKey: exportEd25519PublicKey(keyPair.publicKey),
    },
  ],
  maxAgeSeconds: 3_600,
  clockSkewSeconds: 30,
  requiredChecks: ["verify"],
  minimumApprovals: 1,
  requiredDeployments: ["production"],
  revocationListDigest: contentDigest(revocations as unknown as JsonValue),
};
const payload: GithubDeliveryPayload = {
  schema: "covenant.timeline.profile.github-payload.v1",
  repository: policy.repository,
  pullRequest: 10,
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  openedAt: "2026-07-20T12:00:00.000Z",
  mergedAt: "2026-07-26T12:20:00.000Z",
  merged: true,
  mergeCommitSha: "c".repeat(40),
  checks: [
    {
      name: "verify",
      status: "completed",
      conclusion: "success",
      completedAt: "2026-07-26T12:10:00.000Z",
    },
  ],
  approvedReviews: 1,
  approvedAt: "2026-07-20T13:00:00.000Z",
  reviewDecision: "APPROVED",
  deployments: [
    {
      environment: "production",
      status: "success",
      updatedAt: "2026-07-26T12:20:00.000Z",
    },
  ],
  source: { kind: "github-api", apiVersion: policy.apiVersion },
};

const envelope = () =>
  signGithubEnvelope({
    policy,
    keyId: "collector-1",
    privateKey: keyPair.privateKey,
    payload,
    observedAt: "2026-07-26T12:30:00.000Z",
    expiresAt: "2026-07-26T13:30:00.000Z",
  });

describe("GitHub software-delivery authority profile", () => {
  it("authenticates payload bytes and derives claims", () => {
    const evidence = verifyGithubEnvelope(
      envelope(),
      policy,
      revocations,
      "github-pr-10",
      { now: "2026-07-26T13:00:00.000Z" },
    );

    expect(evidence.claims).toEqual([
      "github.commit.bound",
      "ci.tests.pass",
      "review.approved",
      "release.merged",
      "deployment.succeeded",
    ]);
    expect(evidence.authority).toMatchObject({
      profile: policy.profile,
      policyRef: policy.id,
    });
  });

  it("rejects payload tampering", () => {
    const tampered = envelope();
    tampered.payload = { ...tampered.payload, approvedReviews: 0 };

    expect(() =>
      verifyGithubEnvelope(tampered, policy, revocations, "github-pr-10", {
        now: "2026-07-26T13:00:00.000Z",
      }),
    ).toThrow(GithubAuthorityError);
  });

  it("rejects expired and revoked proofs", () => {
    expect(() =>
      verifyGithubEnvelope(envelope(), policy, revocations, "github-pr-10", {
        now: "2026-07-26T14:00:00.000Z",
      }),
    ).toThrow(/expired/);

    const revoked: GithubRevocationList = {
      ...revocations,
      revokedKeys: ["collector-1"],
    };
    const revokedPolicy = {
      ...policy,
      revocationListDigest: contentDigest(revoked as unknown as JsonValue),
    };
    const revokedEnvelope = signGithubEnvelope({
      policy: revokedPolicy,
      keyId: "collector-1",
      privateKey: keyPair.privateKey,
      payload,
      observedAt: "2026-07-26T12:30:00.000Z",
      expiresAt: "2026-07-26T13:30:00.000Z",
    });
    expect(() =>
      verifyGithubEnvelope(
        revokedEnvelope,
        revokedPolicy,
        revoked,
        "github-pr-10",
        { now: "2026-07-26T13:00:00.000Z" },
      ),
    ).toThrow(/revoked/);
  });

  it("rejects observations with impossible source timestamps", () => {
    const futurePayload = {
      ...payload,
      checks: [
        {
          ...payload.checks[0]!,
          completedAt: "2026-07-26T13:30:00.000Z",
        },
      ],
    };
    const futureEnvelope = signGithubEnvelope({
      policy,
      keyId: "collector-1",
      privateKey: keyPair.privateKey,
      payload: futurePayload,
      observedAt: "2026-07-26T12:30:00.000Z",
      expiresAt: "2026-07-26T13:30:00.000Z",
    });

    expect(() =>
      verifyGithubEnvelope(
        futureEnvelope,
        policy,
        revocations,
        "github-pr-10",
        { now: "2026-07-26T13:00:00.000Z" },
      ),
    ).toThrow(/between opening and observation/);
  });

  it("rejects ambiguous duplicate check observations", () => {
    const ambiguous = {
      ...payload,
      checks: [
        ...payload.checks,
        { ...payload.checks[0]!, conclusion: "failure" },
      ],
    };

    expect(() =>
      signGithubEnvelope({
        policy,
        keyId: "collector-1",
        privateKey: keyPair.privateKey,
        payload: ambiguous,
        observedAt: "2026-07-26T12:30:00.000Z",
        expiresAt: "2026-07-26T13:30:00.000Z",
      }),
    ).toThrow(/unique/);
  });

  it("fails closed with stable profile errors for malformed JavaScript values", () => {
    expect(() =>
      verifyGithubEnvelope(
        null as unknown as ReturnType<typeof envelope>,
        policy,
        revocations,
        "github-pr-10",
      ),
    ).toThrow(GithubAuthorityError);

    expect(() =>
      signGithubEnvelope({
        policy: {
          ...policy,
          requiredChecks: null as unknown as string[],
        },
        keyId: "collector-1",
        privateKey: keyPair.privateKey,
        payload,
        observedAt: "2026-07-26T12:30:00.000Z",
        expiresAt: "2026-07-26T13:30:00.000Z",
      }),
    ).toThrow(GithubAuthorityError);

    expect(() =>
      signGithubEnvelope({
        policy,
        keyId: "collector-1",
        privateKey: keyPair.privateKey,
        payload: {
          ...payload,
          merged: "true" as unknown as boolean,
        },
        observedAt: "2026-07-26T12:30:00.000Z",
        expiresAt: "2026-07-26T13:30:00.000Z",
      }),
    ).toThrow(GithubAuthorityError);
  });

  it("validates GitHub's published webhook HMAC vector", () => {
    const signature = `sha256:${createHash("sha256").update("unused").digest("hex")}`;
    expect(
      verifyGithubWebhookSignature(
        "Hello, World!",
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
        "It's a Secret to Everybody",
      ),
    ).toBe(true);
    expect(
      verifyGithubWebhookSignature("Hello, World!", signature, "wrong"),
    ).toBe(false);
  });
});
