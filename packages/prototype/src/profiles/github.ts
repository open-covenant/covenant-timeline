import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
  KeyObject,
} from "node:crypto";
import { canonicalBytes, contentDigest, type JsonValue } from "../identity.js";
import type {
  EvidenceV0Alpha2,
  PolicyBindingV0Alpha2,
} from "../v0alpha2/index.js";

export const GITHUB_DELIVERY_PROFILE = "github.software-delivery.v1";

export interface GithubCollectorKey {
  id: string;
  algorithm: "ed25519";
  publicKey: string;
}

export interface GithubDeliveryPolicy {
  schema: "covenant.timeline.profile.github-policy.v1";
  id: string;
  profile: typeof GITHUB_DELIVERY_PROFILE;
  repository: string;
  apiVersion: string;
  collectorKeys: readonly GithubCollectorKey[];
  maxAgeSeconds: number;
  clockSkewSeconds: number;
  requiredChecks: readonly string[];
  minimumApprovals: number;
  requiredDeployments: readonly string[];
  revocationListDigest: `sha256:${string}`;
}

export interface GithubRevocationList {
  schema: "covenant.timeline.profile.github-revocations.v1";
  policyRef: string;
  generatedAt: string;
  revokedKeys: readonly string[];
}

export interface GithubCheckObservation {
  name: string;
  status: string;
  conclusion: string | null;
  completedAt: string | null;
}

export interface GithubDeploymentObservation {
  environment: string;
  status: string;
  updatedAt: string;
}

export interface GithubDeliveryPayload {
  schema: "covenant.timeline.profile.github-payload.v1";
  repository: string;
  pullRequest: number;
  headSha: string;
  baseSha: string;
  openedAt: string;
  mergedAt: string | null;
  merged: boolean;
  mergeCommitSha: string | null;
  checks: readonly GithubCheckObservation[];
  approvedReviews: number;
  approvedAt: string | null;
  reviewDecision: string;
  deployments: readonly GithubDeploymentObservation[];
  source: {
    kind: "github-api";
    apiVersion: string;
  };
}

export interface GithubAuthorityEnvelope {
  schema: "covenant.timeline.profile.github-envelope.v1";
  profile: typeof GITHUB_DELIVERY_PROFILE;
  policyRef: string;
  policyDigest: `sha256:${string}`;
  keyId: string;
  observedAt: string;
  expiresAt: string;
  payloadDigest: `sha256:${string}`;
  payload: GithubDeliveryPayload;
  signature: string;
}

export interface SignGithubEnvelopeOptions {
  policy: GithubDeliveryPolicy;
  keyId: string;
  privateKey: KeyObject | string | Buffer;
  payload: GithubDeliveryPayload;
  observedAt: string;
  expiresAt: string;
}

export interface VerifyGithubEnvelopeOptions {
  now?: string | Date;
}

export class GithubAuthorityError extends Error {
  readonly code = "timeline.profile.github.invalid";

  constructor(message: string) {
    super(message);
    this.name = "GithubAuthorityError";
  }
}

export function policyBindingForGithub(
  policy: GithubDeliveryPolicy,
): PolicyBindingV0Alpha2 {
  validatePolicy(policy);
  return {
    profile: policy.profile,
    policyRef: policy.id,
    policyDigest: digest(policy),
  };
}

export function signGithubEnvelope(
  options: SignGithubEnvelopeOptions,
): GithubAuthorityEnvelope {
  validatePolicy(options.policy);
  validatePayload(options.payload, options.policy);
  const binding = policyBindingForGithub(options.policy);
  const unsigned: Omit<GithubAuthorityEnvelope, "signature"> = {
    schema: "covenant.timeline.profile.github-envelope.v1" as const,
    profile: GITHUB_DELIVERY_PROFILE,
    policyRef: binding.policyRef,
    policyDigest: binding.policyDigest,
    keyId: options.keyId,
    observedAt: normalizeTimestamp(options.observedAt, "observedAt"),
    expiresAt: normalizeTimestamp(options.expiresAt, "expiresAt"),
    payloadDigest: digest(options.payload),
    payload: options.payload,
  };
  const privateKey =
    options.privateKey instanceof KeyObject
      ? options.privateKey
      : createPrivateKey(options.privateKey);
  const signature = sign(
    null,
    canonicalBytes(unsigned as unknown as JsonValue),
    privateKey,
  );
  return {
    ...unsigned,
    signature: signature.toString("base64url"),
  };
}

export function verifyGithubEnvelope(
  envelope: GithubAuthorityEnvelope,
  policy: GithubDeliveryPolicy,
  revocations: GithubRevocationList,
  evidenceId: string,
  options: VerifyGithubEnvelopeOptions = {},
): EvidenceV0Alpha2 {
  assertKeys(
    envelope,
    [
      "schema",
      "profile",
      "policyRef",
      "policyDigest",
      "keyId",
      "observedAt",
      "expiresAt",
      "payloadDigest",
      "payload",
      "signature",
    ],
    "envelope",
  );
  validatePolicy(policy);
  validateRevocations(revocations, policy);
  validatePayload(envelope.payload, policy);
  const binding = policyBindingForGithub(policy);
  if (
    envelope.schema !== "covenant.timeline.profile.github-envelope.v1" ||
    envelope.profile !== binding.profile ||
    envelope.policyRef !== binding.policyRef ||
    envelope.policyDigest !== binding.policyDigest
  ) {
    throw new GithubAuthorityError("envelope policy binding does not match");
  }
  if (envelope.payloadDigest !== digest(envelope.payload)) {
    throw new GithubAuthorityError(
      "payload digest does not match payload bytes",
    );
  }
  const key = policy.collectorKeys.find(({ id }) => id === envelope.keyId);
  if (!key) throw new GithubAuthorityError("collector key is not authorized");
  if (revocations.revokedKeys.includes(key.id)) {
    throw new GithubAuthorityError("collector key is revoked");
  }
  validateFreshness(envelope, policy, options.now);
  validatePayloadWindow(envelope.payload, envelope.observedAt);
  verifyEnvelopeSignature(envelope, key);

  return {
    id: validateIdentifier(evidenceId, "evidenceId"),
    kind: "github.software-delivery",
    claims: deriveClaims(envelope.payload, policy),
    payloadDigest: envelope.payloadDigest,
    producer: "github-collector",
    authority: {
      ...binding,
      proofDigest: digest(envelope),
    },
  };
}

export function exportEd25519PublicKey(
  key: KeyObject | string | Buffer,
): string {
  const publicKey =
    key instanceof KeyObject && key.type === "public"
      ? key
      : createPublicKey(key);
  return publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64url");
}

export function verifyGithubWebhookSignature(
  body: Uint8Array | string,
  signature: string,
  secret: Uint8Array | string,
): boolean {
  if (!/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function verifyEnvelopeSignature(
  envelope: GithubAuthorityEnvelope,
  key: GithubCollectorKey,
): void {
  if (key.algorithm !== "ed25519") {
    throw new GithubAuthorityError("collector key algorithm is unsupported");
  }
  let signature: Buffer;
  let publicKey: KeyObject;
  try {
    if (!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) {
      throw new Error("invalid signature");
    }
    signature = Buffer.from(envelope.signature, "base64url");
    publicKey = createPublicKey({
      key: Buffer.from(key.publicKey, "base64url"),
      format: "der",
      type: "spki",
    });
  } catch {
    throw new GithubAuthorityError("collector proof encoding is invalid");
  }
  if (signature.length !== 64 || publicKey.asymmetricKeyType !== "ed25519") {
    throw new GithubAuthorityError("collector proof key is not Ed25519");
  }
  const { signature: _, ...unsigned } = envelope;
  if (
    !verify(
      null,
      canonicalBytes(unsigned as unknown as JsonValue),
      publicKey,
      signature,
    )
  ) {
    throw new GithubAuthorityError("collector signature is invalid");
  }
}

function deriveClaims(
  payload: GithubDeliveryPayload,
  policy: GithubDeliveryPolicy,
): string[] {
  const claims = ["github.commit.bound"];
  if (
    policy.requiredChecks.every((required) => {
      const matching = payload.checks.filter(({ name }) => name === required);
      return (
        matching.length === 1 &&
        matching[0]!.status === "completed" &&
        matching[0]!.conclusion === "success"
      );
    })
  ) {
    claims.push("ci.tests.pass");
  }
  if (
    policy.minimumApprovals > 0 &&
    payload.reviewDecision === "APPROVED" &&
    payload.approvedReviews >= policy.minimumApprovals
  ) {
    claims.push("review.approved");
  }
  if (payload.merged && isSha(payload.mergeCommitSha)) {
    claims.push("release.merged");
  }
  if (
    policy.requiredDeployments.length > 0 &&
    policy.requiredDeployments.every((required) =>
      payload.deployments.some(
        ({ environment, status }) =>
          environment === required && status === "success",
      ),
    )
  ) {
    claims.push("deployment.succeeded");
  }
  return claims;
}

function validatePolicy(policy: GithubDeliveryPolicy): void {
  assertKeys(
    policy,
    [
      "schema",
      "id",
      "profile",
      "repository",
      "apiVersion",
      "collectorKeys",
      "maxAgeSeconds",
      "clockSkewSeconds",
      "requiredChecks",
      "minimumApprovals",
      "requiredDeployments",
      "revocationListDigest",
    ],
    "policy",
  );
  if (
    policy.schema !== "covenant.timeline.profile.github-policy.v1" ||
    policy.profile !== GITHUB_DELIVERY_PROFILE
  ) {
    throw new GithubAuthorityError("unsupported GitHub policy schema");
  }
  validateIdentifier(policy.id, "policy.id");
  validateRepository(policy.repository);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.apiVersion)) {
    throw new GithubAuthorityError("policy apiVersion must be YYYY-MM-DD");
  }
  if (!Array.isArray(policy.collectorKeys)) {
    throw new GithubAuthorityError("collectorKeys must be an array");
  }
  if (policy.collectorKeys.length === 0) {
    throw new GithubAuthorityError("policy needs at least one collector key");
  }
  const keyIds = new Set<string>();
  for (const key of policy.collectorKeys) {
    assertKeys(key, ["id", "algorithm", "publicKey"], "collector key");
    const keyId = validateIdentifier(key.id, "collector key id");
    if (key.algorithm !== "ed25519") {
      throw new GithubAuthorityError("collector key is invalid");
    }
    validatePublicKey(key.publicKey);
    if (keyIds.has(keyId)) {
      throw new GithubAuthorityError("collector key ids must be unique");
    }
    keyIds.add(keyId);
  }
  assertPositiveInteger(policy.maxAgeSeconds, "maxAgeSeconds");
  assertNonNegativeInteger(policy.clockSkewSeconds, "clockSkewSeconds");
  assertNonNegativeInteger(policy.minimumApprovals, "minimumApprovals");
  if (
    !Array.isArray(policy.requiredChecks) ||
    !policy.requiredChecks.every(
      (name) => typeof name === "string" && name.length > 0,
    )
  ) {
    throw new GithubAuthorityError(
      "requiredChecks must contain non-empty strings",
    );
  }
  if (policy.requiredChecks.length === 0) {
    throw new GithubAuthorityError("policy needs at least one required check");
  }
  if (new Set(policy.requiredChecks).size !== policy.requiredChecks.length) {
    throw new GithubAuthorityError("required check names must be unique");
  }
  if (
    !Array.isArray(policy.requiredDeployments) ||
    !policy.requiredDeployments.every(
      (name) => typeof name === "string" && name.length > 0,
    )
  ) {
    throw new GithubAuthorityError(
      "requiredDeployments must contain non-empty strings",
    );
  }
  if (
    new Set(policy.requiredDeployments).size !==
    policy.requiredDeployments.length
  ) {
    throw new GithubAuthorityError("required deployments must be unique");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(policy.revocationListDigest)) {
    throw new GithubAuthorityError("revocation list digest is invalid");
  }
}

function validateRevocations(
  revocations: GithubRevocationList,
  policy: GithubDeliveryPolicy,
): void {
  assertKeys(
    revocations,
    ["schema", "policyRef", "generatedAt", "revokedKeys"],
    "revocation list",
  );
  if (
    revocations.schema !== "covenant.timeline.profile.github-revocations.v1" ||
    revocations.policyRef !== policy.id
  ) {
    throw new GithubAuthorityError("revocation list does not match policy");
  }
  normalizeTimestamp(revocations.generatedAt, "revocations.generatedAt");
  if (digest(revocations) !== policy.revocationListDigest) {
    throw new GithubAuthorityError("revocation list digest does not match");
  }
  if (!Array.isArray(revocations.revokedKeys)) {
    throw new GithubAuthorityError("revokedKeys must be an array");
  }
  if (
    new Set(revocations.revokedKeys).size !== revocations.revokedKeys.length
  ) {
    throw new GithubAuthorityError("revoked key ids must be unique");
  }
  revocations.revokedKeys.forEach((id) =>
    validateIdentifier(id, "revoked key id"),
  );
}

function validatePayload(
  payload: GithubDeliveryPayload,
  policy: GithubDeliveryPolicy,
): void {
  assertKeys(
    payload,
    [
      "schema",
      "repository",
      "pullRequest",
      "headSha",
      "baseSha",
      "openedAt",
      "mergedAt",
      "merged",
      "mergeCommitSha",
      "checks",
      "approvedReviews",
      "approvedAt",
      "reviewDecision",
      "deployments",
      "source",
    ],
    "payload",
  );
  assertKeys(payload.source, ["kind", "apiVersion"], "payload source");
  if (
    payload.schema !== "covenant.timeline.profile.github-payload.v1" ||
    payload.repository !== policy.repository ||
    payload.source.kind !== "github-api" ||
    payload.source.apiVersion !== policy.apiVersion
  ) {
    throw new GithubAuthorityError("payload source does not match policy");
  }
  validateRepository(payload.repository);
  assertPositiveInteger(payload.pullRequest, "pullRequest");
  if (!isSha(payload.headSha) || !isSha(payload.baseSha)) {
    throw new GithubAuthorityError("payload commit SHA is invalid");
  }
  if (payload.mergeCommitSha !== null && !isSha(payload.mergeCommitSha)) {
    throw new GithubAuthorityError("merge commit SHA is invalid");
  }
  if (typeof payload.merged !== "boolean") {
    throw new GithubAuthorityError("merged must be a boolean");
  }
  if (payload.merged && payload.mergeCommitSha === null) {
    throw new GithubAuthorityError("merged payload needs a merge commit SHA");
  }
  if (!payload.merged && payload.mergeCommitSha !== null) {
    throw new GithubAuthorityError(
      "unmerged payload cannot have a merge commit SHA",
    );
  }
  normalizeTimestamp(payload.openedAt, "openedAt");
  if (payload.mergedAt !== null) {
    normalizeTimestamp(payload.mergedAt, "mergedAt");
  }
  if (payload.merged && payload.mergedAt === null) {
    throw new GithubAuthorityError("merged payload needs a merge timestamp");
  }
  if (!payload.merged && payload.mergedAt !== null) {
    throw new GithubAuthorityError(
      "unmerged payload cannot have a merge timestamp",
    );
  }
  assertNonNegativeInteger(payload.approvedReviews, "approvedReviews");
  if (payload.approvedAt !== null) {
    normalizeTimestamp(payload.approvedAt, "approvedAt");
  }
  if (payload.approvedReviews > 0 && payload.approvedAt === null) {
    throw new GithubAuthorityError(
      "approved reviews need an approval timestamp",
    );
  }
  if (
    typeof payload.reviewDecision !== "string" ||
    payload.reviewDecision.length === 0
  ) {
    throw new GithubAuthorityError("reviewDecision is required");
  }
  if (!Array.isArray(payload.checks)) {
    throw new GithubAuthorityError("checks must be an array");
  }
  const checkNames = new Set<string>();
  payload.checks.forEach((check) => {
    assertKeys(
      check,
      ["name", "status", "conclusion", "completedAt"],
      "check observation",
    );
    if (
      typeof check.name !== "string" ||
      check.name.length === 0 ||
      typeof check.status !== "string" ||
      check.status.length === 0
    ) {
      throw new GithubAuthorityError("check observation is incomplete");
    }
    if (check.conclusion !== null && typeof check.conclusion !== "string") {
      throw new GithubAuthorityError("check conclusion is invalid");
    }
    if (checkNames.has(check.name)) {
      throw new GithubAuthorityError("check observation names must be unique");
    }
    checkNames.add(check.name);
    if (check.completedAt !== null) {
      normalizeTimestamp(check.completedAt, "check.completedAt");
    }
  });
  if (!Array.isArray(payload.deployments)) {
    throw new GithubAuthorityError("deployments must be an array");
  }
  const deploymentEnvironments = new Set<string>();
  payload.deployments.forEach((deployment) => {
    assertKeys(
      deployment,
      ["environment", "status", "updatedAt"],
      "deployment observation",
    );
    if (
      typeof deployment.environment !== "string" ||
      deployment.environment.length === 0 ||
      typeof deployment.status !== "string" ||
      deployment.status.length === 0
    ) {
      throw new GithubAuthorityError("deployment observation is incomplete");
    }
    if (deploymentEnvironments.has(deployment.environment)) {
      throw new GithubAuthorityError(
        "deployment observation environments must be unique",
      );
    }
    deploymentEnvironments.add(deployment.environment);
    normalizeTimestamp(deployment.updatedAt, "deployment.updatedAt");
  });
}

function validateFreshness(
  envelope: GithubAuthorityEnvelope,
  policy: GithubDeliveryPolicy,
  nowValue: string | Date | undefined,
): void {
  const observed = Date.parse(
    normalizeTimestamp(envelope.observedAt, "observedAt"),
  );
  const expires = Date.parse(
    normalizeTimestamp(envelope.expiresAt, "expiresAt"),
  );
  const now =
    nowValue instanceof Date
      ? nowValue.getTime()
      : nowValue
        ? Date.parse(normalizeTimestamp(nowValue, "now"))
        : Date.now();
  if (!Number.isFinite(now)) {
    throw new GithubAuthorityError("now must be a valid timestamp");
  }
  if (expires <= observed) {
    throw new GithubAuthorityError("envelope expiry must follow observation");
  }
  if (expires - observed > policy.maxAgeSeconds * 1000) {
    throw new GithubAuthorityError("envelope exceeds policy maximum age");
  }
  if (observed - now > policy.clockSkewSeconds * 1000) {
    throw new GithubAuthorityError("envelope observation is in the future");
  }
  if (now > expires + policy.clockSkewSeconds * 1000) {
    throw new GithubAuthorityError("envelope is expired");
  }
}

function validatePayloadWindow(
  payload: GithubDeliveryPayload,
  observedAt: string,
): void {
  const opened = Date.parse(payload.openedAt);
  const observed = Date.parse(observedAt);
  if (opened > observed) {
    throw new GithubAuthorityError(
      "openedAt must not follow envelope observation",
    );
  }
  const timestamps = [
    ["mergedAt", payload.mergedAt],
    ["approvedAt", payload.approvedAt],
    ...payload.checks.map(
      ({ completedAt }, index) =>
        [`checks[${index}].completedAt`, completedAt] as const,
    ),
    ...payload.deployments.map(
      ({ updatedAt }, index) =>
        [`deployments[${index}].updatedAt`, updatedAt] as const,
    ),
  ] as const;
  for (const [field, value] of timestamps) {
    if (value === null) continue;
    const timestamp = Date.parse(value);
    if (timestamp < opened || timestamp > observed) {
      throw new GithubAuthorityError(
        `${field} must fall between opening and observation`,
      );
    }
  }
}

function normalizeTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new GithubAuthorityError(
      `${field} must be an RFC 3339 UTC timestamp`,
    );
  }
  return new Date(value).toISOString();
}

function validateIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9._:/-]{0,127}$/.test(value)
  ) {
    throw new GithubAuthorityError(`${field} is not a portable identifier`);
  }
  return value;
}

function validateRepository(value: unknown): void {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value)
  ) {
    throw new GithubAuthorityError("repository must be owner/name");
  }
}

function isSha(value: string | null): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GithubAuthorityError(`${field} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GithubAuthorityError(`${field} must be a non-negative integer`);
  }
}

function digest(value: unknown): `sha256:${string}` {
  try {
    return contentDigest(value as JsonValue);
  } catch {
    throw new GithubAuthorityError("profile document is not canonical JSON");
  }
}

function validatePublicKey(value: unknown): void {
  try {
    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(value) ||
      Buffer.from(value, "base64url").toString("base64url") !== value
    ) {
      throw new Error("invalid encoding");
    }
    const key = createPublicKey({
      key: Buffer.from(value, "base64url"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("invalid key type");
    }
  } catch {
    throw new GithubAuthorityError(
      "collector public key must be base64url Ed25519 SPKI",
    );
  }
}

function assertKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GithubAuthorityError(`${label} must be an object`);
  }
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    throw new GithubAuthorityError(`${label} fields are invalid`);
  }
  if (
    keys.length !== expected.length ||
    keys.some((key) => !expected.includes(key))
  ) {
    throw new GithubAuthorityError(`${label} fields are invalid`);
  }
}
