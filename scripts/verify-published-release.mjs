import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { validateReleaseEvidenceFile } from "./check-release-evidence.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const githubHeaders = {
  accept: "application/vnd.github+json",
  "user-agent": "covenant-timeline-release-verifier",
  "x-github-api-version": "2022-11-28",
};
const maxMetadataBytes = 8 * 1024 * 1024;
const maxArtifactBytes = 64 * 1024 * 1024;
const networkTimeoutMs = 20_000;
const subprocessTimeoutMs = 120_000;
const npmPublishPredicate =
  "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";
const slsaPredicate = "https://slsa.dev/provenance/v1";
const spdxPredicate = "https://spdx.dev/Document/v2.3";

export async function verifyPublishedRelease(manifestPath) {
  const recordErrors = await validateReleaseEvidenceFile(manifestPath);
  if (recordErrors.length > 0) {
    throw new Error(recordErrors.join("\n"));
  }

  const record = parseStrictJson(
    await readFile(manifestPath, "utf8"),
    manifestPath,
  );
  const { release, workflow, registry, artifact } = record;
  const apiRoot = `https://api.github.com/repos/${workflow.repository}`;

  const [
    packageMetadata,
    run,
    job,
    workflowArtifact,
    githubRelease,
    remoteTagRef,
    registryTarball,
  ] = await Promise.all([
    fetchJson("https://registry.npmjs.org/@covenant-org%2ftimeline"),
    fetchJson(
      `${apiRoot}/actions/runs/${workflow.runId}/attempts/${workflow.attempt}`,
      githubHeaders,
    ),
    fetchJson(`${apiRoot}/actions/jobs/${workflow.jobId}`, githubHeaders),
    fetchOptionalJson(
      `${apiRoot}/actions/artifacts/${workflow.artifactId}`,
      githubHeaders,
    ),
    fetchJson(`${apiRoot}/releases/tags/${release.tag}`, githubHeaders),
    fetchJson(
      `${apiRoot}/git/ref/tags/${encodeURIComponent(release.tag)}`,
      githubHeaders,
    ),
    fetchBytes(registry.tarballUrl, {}, maxArtifactBytes),
  ]);

  verifyRegistryMetadata(record, packageMetadata);
  verifyWorkflowRun(record, run);
  verifyWorkflowJob(record, job);
  if (workflowArtifact) verifyWorkflowArtifact(record, workflowArtifact);
  verifyGithubRelease(record, githubRelease);
  verifyRemoteTagRef(record, remoteTagRef);
  verifyRegistryTarball(record, registryTarball);

  const remoteTag = await fetchJson(remoteTagRef.object.url, githubHeaders);
  verifyRemoteTag(record, remoteTag);

  const assetBytes = new Map(
    await Promise.all(
      artifact.assets.map(async (asset) => {
        const bytes = await fetchBytes(asset.url, {}, maxArtifactBytes);
        verifyAsset(asset, bytes);
        return [asset.kind, bytes];
      }),
    ),
  );

  const releaseTarball = required(assetBytes, "tarball");
  if (!registryTarball.equals(releaseTarball)) {
    throw new Error("npm and GitHub release tarballs differ");
  }

  verifyChecksumSidecar(
    record,
    required(assetBytes, "checksum").toString("utf8"),
  );
  const sbomBytes = required(assetBytes, "sbom");
  const sbom = parseJson(sbomBytes, "GitHub release SBOM");
  assertEqual(
    sbomBytes.toString("utf8"),
    `${JSON.stringify(sbom, null, 2)}\n`,
    "SBOM canonical JSON",
  );
  verifySbom(record, sbom);

  const npmAttestations = await fetchJson(registry.provenanceUrl);
  verifyNpmAttestations(
    record,
    npmAttestations,
    registryTarball,
    packageMetadata,
  );
  await verifyCryptographicAttestations(
    record,
    releaseTarball,
    sbom,
    npmAttestations,
  );

  const smoke = await verifyCleanInstall(record);
  return {
    package: `${release.package}@${release.version}`,
    sourceCommit: release.sourceCommit,
    tagObjectSha: release.tagObjectSha,
    workflowRun: workflow.runId,
    workflowAttempt: workflow.attempt,
    workflowArtifactState: workflowArtifact
      ? workflowArtifact.expired
        ? "expired"
        : "available"
      : "unavailable",
    artifactSha256: artifact.sha256,
    registryAndReleaseBytesMatch: true,
    currentDistTags: packageMetadata["dist-tags"],
    npmProvenance: true,
    githubAttestations: true,
    credentialState: {
      assurance: record.credentials.assurance,
      observedAt: record.credentials.observedAt,
      publiclyCorroborated: false,
    },
    cleanInstall: smoke,
  };
}

export function verifyRegistryMetadata(record, metadata) {
  const { release, registry } = record;
  const version = metadata.versions?.[release.version];
  assert(version, `npm metadata has no ${release.version}`);
  assertEqual(version.version, release.version, "npm version");
  assertEqual(
    metadata.time?.[release.version],
    release.publishedAt,
    "npm publish time",
  );
  assertEqual(version.dist?.tarball, registry.tarballUrl, "npm tarball URL");
  assertEqual(version.dist?.shasum, registry.shasum, "npm SHA-1");
  assertEqual(version.dist?.integrity, registry.integrity, "npm integrity");
  assertEqual(version.dist?.fileCount, registry.fileCount, "npm file count");
  assertEqual(
    version.dist?.unpackedSize,
    registry.unpackedSize,
    "npm unpacked size",
  );
  assertEqual(
    version.dist?.attestations?.url,
    registry.provenanceUrl,
    "npm provenance URL",
  );
  assertEqual(
    version.dist?.attestations?.provenance?.predicateType,
    slsaPredicate,
    "npm provenance predicate",
  );
}

export function verifyWorkflowRun(record, run) {
  const { release, workflow } = record;
  assertEqual(run.id, workflow.runId, "workflow run ID");
  assertEqual(run.run_attempt, workflow.attempt, "workflow attempt");
  assertEqual(run.status, "completed", "workflow status");
  assertEqual(run.conclusion, "success", "workflow conclusion");
  assertEqual(run.head_sha, release.sourceCommit, "workflow source commit");
  assertEqual(run.head_branch, release.tag, "workflow source tag");
  assertEqual(run.event, "push", "workflow event");
  assertEqual(run.name, "release", "workflow name");
  assertEqual(run.path, workflow.path, "workflow path");
  assertEqual(run.repository?.id, workflow.repositoryId, "repository ID");
  assertEqual(
    run.repository?.owner?.id,
    workflow.repositoryOwnerId,
    "repository owner ID",
  );
}

export function verifyWorkflowJob(record, job) {
  const { release, workflow } = record;
  assertEqual(job.id, workflow.jobId, "workflow job ID");
  assertEqual(job.run_id, workflow.runId, "job run ID");
  assertEqual(job.run_attempt, workflow.attempt, "job run attempt");
  assertEqual(job.head_sha, release.sourceCommit, "job source commit");
  assertEqual(job.name, "publish", "workflow job name");
  assertEqual(job.workflow_name, "release", "job workflow name");
  assertEqual(job.conclusion, "success", "workflow job conclusion");
}

export function verifyWorkflowArtifact(record, value) {
  const { release, workflow } = record;
  assertEqual(value.id, workflow.artifactId, "workflow artifact ID");
  assertEqual(value.name, "timeline-release", "workflow artifact name");
  assert(
    typeof value.expired === "boolean",
    "workflow artifact expiry state is missing",
  );
  assertEqual(
    value.workflow_run?.id,
    workflow.runId,
    "artifact workflow run ID",
  );
  assertEqual(
    value.workflow_run?.head_sha,
    release.sourceCommit,
    "artifact source commit",
  );
  assertEqual(
    value.workflow_run?.head_branch,
    release.tag,
    "artifact source tag",
  );
}

export function verifyGithubRelease(record, value) {
  const expectedAssets = new Map(
    record.artifact.assets.map((asset) => [asset.name, asset]),
  );
  assertEqual(value.tag_name, record.release.tag, "GitHub release tag");
  assertEqual(value.draft, false, "GitHub release draft state");
  assertEqual(
    value.prerelease,
    record.release.version.includes("-"),
    "GitHub prerelease state",
  );
  assertEqual(value.html_url, record.artifact.releaseUrl, "GitHub release URL");

  for (const asset of value.assets ?? []) {
    const expected = expectedAssets.get(asset.name);
    assert(expected, `unexpected GitHub release asset ${asset.name}`);
    assertEqual(asset.browser_download_url, expected.url, `${asset.name} URL`);
    assertEqual(asset.size, expected.size, `${asset.name} size`);
    assertEqual(
      asset.digest,
      `sha256:${expected.sha256}`,
      `${asset.name} digest`,
    );
    expectedAssets.delete(asset.name);
  }
  assert(
    expectedAssets.size === 0,
    `GitHub release is missing ${[...expectedAssets.keys()].join(", ")}`,
  );
}

export function verifyRemoteTagRef(record, value) {
  const { release } = record;
  assertEqual(value.ref, `refs/tags/${release.tag}`, "remote tag ref");
  assertEqual(value.object?.type, "tag", "remote tag object type");
  assertEqual(value.object?.sha, release.tagObjectSha, "remote tag object SHA");
}

export function verifyRemoteTag(record, value) {
  const { release } = record;
  assertEqual(value.sha, release.tagObjectSha, "annotated tag object SHA");
  assertEqual(value.tag, release.tag, "annotated tag name");
  assertEqual(value.object?.type, "commit", "annotated tag target type");
  assertEqual(
    value.object?.sha,
    release.sourceCommit,
    "annotated tag target commit",
  );
}

export function verifyRegistryTarball(record, bytes) {
  assertEqual(
    bytes.length,
    record.artifact.packedSize,
    "registry tarball size",
  );
  assertEqual(
    hash(bytes, "sha1", "hex"),
    record.registry.shasum,
    "registry SHA-1",
  );
  assertEqual(
    `sha512-${hash(bytes, "sha512", "base64")}`,
    record.registry.integrity,
    "registry integrity",
  );
  assertEqual(
    hash(bytes, "sha256", "hex"),
    record.artifact.sha256,
    "registry SHA-256",
  );
}

export function verifyAsset(asset, bytes) {
  assertEqual(bytes.length, asset.size, `${asset.name} downloaded size`);
  assertEqual(
    hash(bytes, "sha256", "hex"),
    asset.sha256,
    `${asset.name} downloaded digest`,
  );
}

export function verifyChecksumSidecar(record, text) {
  const [digest, path, extra] = text.trim().split(/\s+/);
  assertEqual(digest, record.artifact.sha256, "checksum sidecar digest");
  assert(!extra, "checksum sidecar must contain one entry");
  assertEqual(
    basename(path),
    requiredAsset(record, "tarball").name,
    "checksum sidecar subject",
  );
}

export function verifySbom(record, sbom) {
  const published = record.components.find(
    ({ distribution }) => distribution === "npm",
  );
  assert(published, "release record has no npm component");
  const componentManifest = gitJson(
    record.release.sourceCommit,
    published.manifest,
  );
  const expectedPackages = new Map([
    [componentManifest.name, componentManifest.version],
    ...Object.entries(componentManifest.dependencies ?? {}),
  ]);
  const expectedCreated = new Date(
    Number(
      runCommand(
        "git",
        ["show", "-s", "--format=%ct", record.release.sourceCommit],
        { cwd: root },
      ).trim(),
    ) * 1_000,
  )
    .toISOString()
    .replace(".000Z", "Z");

  assertEqual(sbom.spdxVersion, "SPDX-2.3", "SBOM version");
  assertEqual(sbom.dataLicense, "CC0-1.0", "SBOM data license");
  assertEqual(sbom.SPDXID, "SPDXRef-DOCUMENT", "SBOM document ID");
  assertEqual(
    sbom.name,
    `${published.name}-${published.version}`,
    "SBOM document name",
  );
  assertEqual(
    sbom.documentNamespace,
    `https://github.com/open-covenant/covenant-timeline/sbom/${record.release.sourceCommit}/${published.version}`,
    "SBOM namespace",
  );
  assertEqual(
    sbom.creationInfo?.created,
    expectedCreated,
    "SBOM creation time",
  );
  assert(
    isDeepStrictEqual(sbom.creationInfo?.creators, [
      "Organization: Open Covenant",
    ]),
    "SBOM creators do not match the release policy",
  );

  assert(Array.isArray(sbom.packages), "SBOM packages must be an array");
  assertEqual(
    sbom.packages.length,
    expectedPackages.size,
    "SBOM package count",
  );
  const packagesByName = uniqueMap(sbom.packages, "name", "SBOM package name");
  const packagesById = uniqueMap(sbom.packages, "SPDXID", "SBOM package ID");
  const purls = new Set();

  for (const [name, version] of expectedPackages) {
    const value = packagesByName.get(name);
    assert(value, `SBOM package ${name} is missing`);
    assertEqual(value.versionInfo, version, `SBOM package ${name}`);
    assert(
      /^SPDXRef-Package-[A-Za-z0-9.-]+$/.test(value.SPDXID),
      `SBOM package ${name} has an invalid SPDX ID`,
    );
    assertEqual(
      value.filesAnalyzed,
      false,
      `SBOM package ${name} filesAnalyzed`,
    );
    assertEqual(
      value.downloadLocation,
      "NOASSERTION",
      `SBOM package ${name} download location`,
    );
    assert(
      typeof value.licenseDeclared === "string" &&
        value.licenseDeclared.length > 0,
      `SBOM package ${name} has no declared license`,
    );
    assert(
      typeof value.licenseConcluded === "string" &&
        value.licenseConcluded.length > 0,
      `SBOM package ${name} has no concluded license`,
    );
    if (name === componentManifest.name) {
      assertEqual(
        value.licenseDeclared,
        componentManifest.license,
        "SBOM root package license",
      );
      assertEqual(
        value.licenseConcluded,
        componentManifest.license,
        "SBOM root concluded license",
      );
    }

    const purlRefs = (value.externalRefs ?? []).filter(
      ({ referenceCategory, referenceType }) =>
        referenceCategory === "PACKAGE-MANAGER" && referenceType === "purl",
    );
    assertEqual(purlRefs.length, 1, `SBOM package ${name} purl count`);
    const purl = purlRefs[0].referenceLocator;
    assertEqual(purl, npmPurl(name, version), `SBOM package ${name} purl`);
    assert(!purls.has(purl), `duplicate SBOM purl ${purl}`);
    purls.add(purl);
  }

  const rootPackage = packagesByName.get(componentManifest.name);
  const expectedRelationships = new Set([
    relationshipKey({
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: rootPackage.SPDXID,
    }),
    ...[...expectedPackages.keys()]
      .filter((name) => name !== componentManifest.name)
      .map((name) =>
        relationshipKey({
          spdxElementId: rootPackage.SPDXID,
          relationshipType: "DEPENDS_ON",
          relatedSpdxElement: packagesByName.get(name).SPDXID,
        }),
      ),
  ]);
  assert(
    Array.isArray(sbom.relationships),
    "SBOM relationships must be an array",
  );
  assertEqual(
    sbom.relationships.length,
    expectedRelationships.size,
    "SBOM relationship count",
  );
  const actualRelationships = new Set();
  for (const relationship of sbom.relationships) {
    assert(
      relationship.spdxElementId === "SPDXRef-DOCUMENT" ||
        packagesById.has(relationship.spdxElementId),
      `unknown SBOM relationship source ${relationship.spdxElementId}`,
    );
    assert(
      packagesById.has(relationship.relatedSpdxElement),
      `unknown SBOM relationship target ${relationship.relatedSpdxElement}`,
    );
    const key = relationshipKey(relationship);
    assert(!actualRelationships.has(key), `duplicate SBOM relationship ${key}`);
    actualRelationships.add(key);
  }
  assert(
    isDeepStrictEqual(actualRelationships, expectedRelationships),
    "SBOM dependency relationships do not match the published package",
  );
}

export function verifyNpmAttestations(
  record,
  value,
  tarballBytes,
  packageMetadata,
) {
  const expectedSubject = npmPurl(
    record.release.package,
    record.release.version,
  );
  const expectedSha512 = hash(tarballBytes, "sha512", "hex");
  const integritySha512 = Buffer.from(
    record.registry.integrity.slice("sha512-".length),
    "base64",
  ).toString("hex");
  assertEqual(expectedSha512, integritySha512, "npm integrity SHA-512");

  const publish = oneAttestation(value, npmPublishPredicate);
  assertEqual(
    publish.bundle?.mediaType,
    "application/vnd.dev.sigstore.bundle+json;version=0.2",
    "npm publish bundle media type",
  );
  const publishStatement = decodeStatement(publish.bundle, "npm publish");
  assertEqual(
    publishStatement._type,
    "https://in-toto.io/Statement/v0.1",
    "npm publish statement type",
  );
  assertEqual(
    publishStatement.predicateType,
    npmPublishPredicate,
    "npm publish predicate",
  );
  verifyStatementSubject(
    publishStatement,
    expectedSubject,
    "sha512",
    expectedSha512,
    "npm publish",
  );
  assertEqual(
    publishStatement.predicate?.name,
    record.release.package,
    "npm publish package",
  );
  assertEqual(
    publishStatement.predicate?.version,
    record.release.version,
    "npm publish version",
  );
  assertEqual(
    publishStatement.predicate?.registry,
    "https://registry.npmjs.org",
    "npm publish registry",
  );
  const registryKeyIds = new Set(
    (
      packageMetadata.versions?.[record.release.version]?.dist?.signatures ?? []
    ).map(({ keyid }) => keyid),
  );
  assert(
    registryKeyIds.has(publish.bundle?.verificationMaterial?.publicKey?.hint),
    "npm publish key does not match registry metadata",
  );

  const provenance = oneAttestation(value, slsaPredicate);
  assertEqual(
    provenance.bundle?.mediaType,
    "application/vnd.dev.sigstore.bundle.v0.3+json",
    "npm provenance bundle media type",
  );
  const provenanceStatement = decodeStatement(
    provenance.bundle,
    "npm provenance",
  );
  verifyNpmProvenanceStatement(
    record,
    provenanceStatement,
    expectedSubject,
    expectedSha512,
  );
}

async function verifyCryptographicAttestations(
  record,
  tarball,
  sbom,
  npmAttestations,
) {
  assertSupportedGhVersion(runCommand("gh", ["--version"]));
  const base = await mkdtemp(join(tmpdir(), "timeline-attestations-"));
  const artifactPath = join(base, requiredAsset(record, "tarball").name);
  const ghConfig = join(base, "gh-config");

  try {
    await writeFile(artifactPath, tarball);
    await mkdir(ghConfig);
    const environment = {
      GH_CONFIG_DIR: ghConfig,
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
    };

    for (const [kind, attestation] of Object.entries(record.attestations)) {
      const bundleBytes = await fetchBytes(
        `${attestation.url}/download`,
        { "user-agent": githubHeaders["user-agent"] },
        maxMetadataBytes,
      );
      assertEqual(
        hash(bundleBytes, "sha256", "hex"),
        attestation.bundleSha256,
        `GitHub ${kind} attestation bundle SHA-256`,
      );
      const bundle = parseJson(bundleBytes, `GitHub ${kind} attestation`);
      const bundlePath = join(base, `github-${kind}.json`);
      await writeFile(bundlePath, bundleBytes);
      const result = verifySigstoreBundle(
        record,
        artifactPath,
        bundlePath,
        attestation.predicateType,
        "sha256",
        environment,
      );
      verifyGithubAttestationResult(
        record,
        kind,
        attestation,
        bundle,
        result,
        sbom,
      );
    }

    const npmProvenance = oneAttestation(npmAttestations, slsaPredicate);
    const npmBundlePath = join(base, "npm-provenance.json");
    await writeFile(
      npmBundlePath,
      `${JSON.stringify(npmProvenance.bundle)}\n`,
      "utf8",
    );
    const npmResult = verifySigstoreBundle(
      record,
      artifactPath,
      npmBundlePath,
      slsaPredicate,
      "sha512",
      environment,
    );
    verifyReturnedBundle(
      npmProvenance.bundle,
      npmResult.attestation?.bundle,
      "npm provenance",
    );
    verifyCertificate(record, npmResult);
    verifyTransparencyLog(npmResult, undefined, "npm provenance");
    verifyNpmProvenanceStatement(
      record,
      npmResult.verificationResult.statement,
      npmPurl(record.release.package, record.release.version),
      hash(tarball, "sha512", "hex"),
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

export function verifyGithubAttestationResult(
  record,
  kind,
  attestation,
  bundle,
  result,
  sbom,
) {
  verifyReturnedBundle(bundle, result.attestation?.bundle, `GitHub ${kind}`);
  verifyCertificate(record, result);
  verifyTransparencyLog(
    result,
    attestation.transparencyLogIndex,
    `GitHub ${kind}`,
  );
  verifyStatementSubject(
    result.verificationResult?.statement,
    requiredAsset(record, "tarball").name,
    "sha256",
    attestation.subjectSha256,
    `GitHub ${kind}`,
  );

  if (kind === "build") {
    verifyGithubBuildStatement(record, result.verificationResult.statement);
    return;
  }
  if (kind === "sbom") {
    assertEqual(
      result.verificationResult.statement?.predicateType,
      spdxPredicate,
      "GitHub SBOM predicate",
    );
    assert(
      isDeepStrictEqual(result.verificationResult.statement?.predicate, sbom),
      "verified SBOM attestation does not match the release SBOM",
    );
    return;
  }
  throw new Error(`unsupported GitHub attestation kind ${kind}`);
}

function verifySigstoreBundle(
  record,
  artifactPath,
  bundlePath,
  predicateType,
  digestAlgorithm,
  environment,
) {
  const identity = workflowIdentity(record);
  const output = runCommand(
    "gh",
    [
      "attestation",
      "verify",
      artifactPath,
      "--bundle",
      bundlePath,
      "--repo",
      record.workflow.repository,
      "--digest-alg",
      digestAlgorithm,
      "--predicate-type",
      predicateType,
      "--cert-identity",
      identity,
      "--cert-oidc-issuer",
      "https://token.actions.githubusercontent.com",
      "--signer-digest",
      record.release.sourceCommit,
      "--source-digest",
      record.release.sourceCommit,
      "--source-ref",
      `refs/tags/${record.release.tag}`,
      "--deny-self-hosted-runners",
      "--format",
      "json",
    ],
    { env: environment },
  );
  const results = parseJson(
    Buffer.from(output),
    `gh verification for ${predicateType}`,
  );
  assert(
    Array.isArray(results) && results.length === 1,
    `expected one verified ${predicateType} attestation`,
  );
  return results[0];
}

function verifyCertificate(record, result) {
  const certificate = result.verificationResult?.signature?.certificate;
  const identity = workflowIdentity(record);
  const tagRef = `refs/tags/${record.release.tag}`;
  const repositoryUrl = `https://github.com/${record.workflow.repository}`;

  for (const [field, expected] of [
    ["issuer", "https://token.actions.githubusercontent.com"],
    ["subjectAlternativeName", identity],
    ["githubWorkflowTrigger", "push"],
    ["githubWorkflowSHA", record.release.sourceCommit],
    ["githubWorkflowName", "release"],
    ["githubWorkflowRepository", record.workflow.repository],
    ["githubWorkflowRef", tagRef],
    ["buildSignerURI", identity],
    ["buildSignerDigest", record.release.sourceCommit],
    ["runnerEnvironment", "github-hosted"],
    ["sourceRepositoryURI", repositoryUrl],
    ["sourceRepositoryDigest", record.release.sourceCommit],
    ["sourceRepositoryRef", tagRef],
    ["sourceRepositoryIdentifier", String(record.workflow.repositoryId)],
    [
      "sourceRepositoryOwnerIdentifier",
      String(record.workflow.repositoryOwnerId),
    ],
    ["buildConfigURI", identity],
    ["buildConfigDigest", record.release.sourceCommit],
    ["buildTrigger", "push"],
    ["runInvocationURI", record.workflow.invocationUrl],
    ["sourceRepositoryVisibilityAtSigning", "public"],
  ]) {
    assertEqual(
      certificate?.[field],
      expected,
      `attestation certificate ${field}`,
    );
  }
}

function verifyTransparencyLog(result, expectedIndex, label) {
  const entries =
    result.attestation?.bundle?.verificationMaterial?.tlogEntries ?? [];
  assert(entries.length > 0, `${label} has no transparency log entry`);
  if (expectedIndex !== undefined) {
    assert(
      entries.some(
        ({ logIndex }) => String(logIndex) === String(expectedIndex),
      ),
      `${label} transparency log index does not match the release record`,
    );
  }
  const timestamps = result.verificationResult?.verifiedTimestamps ?? [];
  assert(
    timestamps.some(
      ({ type, uri }) =>
        type === "Tlog" && uri === "https://rekor.sigstore.dev",
    ),
    `${label} has no verified Rekor timestamp`,
  );
}

function verifyReturnedBundle(expected, actual, label) {
  assertEqual(
    actual?.mediaType,
    expected.mediaType,
    `${label} bundle media type`,
  );
  assertEqual(
    actual?.dsseEnvelope?.payloadType,
    expected.dsseEnvelope?.payloadType,
    `${label} verified payload type`,
  );
  assertEqual(
    actual?.dsseEnvelope?.payload,
    expected.dsseEnvelope?.payload,
    `${label} verified payload`,
  );
  assert(
    isDeepStrictEqual(
      (actual?.dsseEnvelope?.signatures ?? []).map(({ sig }) => sig),
      (expected.dsseEnvelope?.signatures ?? []).map(({ sig }) => sig),
    ),
    `${label} verified signature differs from the supplied bundle`,
  );
  assert(
    isDeepStrictEqual(
      actual?.verificationMaterial?.tlogEntries,
      expected.verificationMaterial?.tlogEntries,
    ),
    `${label} verified transparency entries differ from the supplied bundle`,
  );
  assertEqual(
    actual?.verificationMaterial?.certificate?.rawBytes,
    expected.verificationMaterial?.certificate?.rawBytes,
    `${label} verified certificate`,
  );
}

function verifyGithubBuildStatement(record, statement) {
  assertEqual(
    statement?._type,
    "https://in-toto.io/Statement/v1",
    "GitHub build statement type",
  );
  assertEqual(
    statement?.predicateType,
    slsaPredicate,
    "GitHub build predicate",
  );
  verifyWorkflowProvenance(
    record,
    statement.predicate,
    "https://actions.github.io/buildtypes/workflow/v1",
    workflowIdentity(record),
    true,
    "GitHub build",
  );
}

function verifyNpmProvenanceStatement(
  record,
  statement,
  expectedSubject,
  expectedSha512,
) {
  assertEqual(
    statement?._type,
    "https://in-toto.io/Statement/v1",
    "npm provenance statement type",
  );
  assertEqual(
    statement?.predicateType,
    slsaPredicate,
    "npm provenance predicate",
  );
  verifyStatementSubject(
    statement,
    expectedSubject,
    "sha512",
    expectedSha512,
    "npm provenance",
  );
  verifyWorkflowProvenance(
    record,
    statement.predicate,
    "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
    "https://github.com/actions/runner/github-hosted",
    false,
    "npm provenance",
  );
}

function verifyWorkflowProvenance(
  record,
  predicate,
  buildType,
  builderId,
  requireRunnerEnvironment,
  label,
) {
  const definition = predicate?.buildDefinition;
  const tagRef = `refs/tags/${record.release.tag}`;
  const repositoryUrl = `https://github.com/${record.workflow.repository}`;
  const sourceUri = `git+${repositoryUrl}@${tagRef}`;

  assertEqual(definition?.buildType, buildType, `${label} build type`);
  assertEqual(
    definition?.externalParameters?.workflow?.path,
    record.workflow.path,
    `${label} workflow path`,
  );
  assertEqual(
    definition?.externalParameters?.workflow?.ref,
    tagRef,
    `${label} workflow ref`,
  );
  assertEqual(
    definition?.externalParameters?.workflow?.repository,
    repositoryUrl,
    `${label} repository`,
  );
  assertEqual(
    definition?.internalParameters?.github?.event_name,
    "push",
    `${label} event`,
  );
  assertEqual(
    definition?.internalParameters?.github?.repository_id,
    String(record.workflow.repositoryId),
    `${label} repository ID`,
  );
  assertEqual(
    definition?.internalParameters?.github?.repository_owner_id,
    String(record.workflow.repositoryOwnerId),
    `${label} repository owner ID`,
  );
  if (requireRunnerEnvironment) {
    assertEqual(
      definition?.internalParameters?.github?.runner_environment,
      "github-hosted",
      `${label} runner environment`,
    );
  }

  const dependencies = definition?.resolvedDependencies ?? [];
  assertEqual(dependencies.length, 1, `${label} resolved dependency count`);
  assertEqual(dependencies[0]?.uri, sourceUri, `${label} source URI`);
  assertEqual(
    dependencies[0]?.digest?.gitCommit,
    record.release.sourceCommit,
    `${label} source commit`,
  );
  assertEqual(
    predicate?.runDetails?.builder?.id,
    builderId,
    `${label} builder`,
  );
  assertEqual(
    predicate?.runDetails?.metadata?.invocationId,
    record.workflow.invocationUrl,
    `${label} invocation`,
  );
}

async function verifyCleanInstall(record) {
  const base = await mkdtemp(join(tmpdir(), "timeline-release-verify-"));
  const directory = join(base, "workspace with spaces");
  try {
    await mkdir(directory);
    const npmrc = join(base, "npmrc");
    const globalNpmrc = join(base, "global-npmrc");
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      npmrc,
      [
        "registry=https://registry.npmjs.org/",
        "@covenant-org:registry=https://registry.npmjs.org/",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(globalNpmrc, "", "utf8");
    const npmEnvironment = sanitizedNpmEnvironment({
      NPM_CONFIG_USERCONFIG: npmrc,
      NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
      NPM_CONFIG_CACHE: join(base, "npm-cache"),
      NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    });
    runCommand(
      npmExecutable(),
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        "--registry=https://registry.npmjs.org/",
        `${record.release.package}@${record.release.version}`,
      ],
      { cwd: directory, env: npmEnvironment, inheritEnv: false },
    );

    const cli = join(
      directory,
      "node_modules",
      "@covenant-org",
      "timeline",
      "dist",
      "cli.js",
    );
    const version = runCommand(process.execPath, [cli, "--version"], {
      cwd: directory,
    }).trim();
    assertEqual(version, record.release.version, "installed CLI version");

    const smoke = runCommand(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          'import { reasonTemporalQueryV0Alpha3, verifyTemporalConclusionV0Alpha3 } from "@covenant-org/timeline";',
          "const run={schema:'covenant.timeline.run.v0alpha3',contract:{schema:'covenant.timeline.contract.v0alpha3',id:'release.verify',subject:{kind:'workflow',id:'example'},axes:[{id:'elapsed',kind:'metric',unit:'tick',origin:'example.origin'}],contexts:[{id:'actual',mode:'actual'}]},events:[{schema:'covenant.timeline.event.v0alpha3',id:'event-0',sequence:0,type:'point.declared',point:{id:'start',contextId:'actual',axisId:'elapsed'}},{schema:'covenant.timeline.event.v0alpha3',id:'event-1',sequence:1,type:'point.declared',point:{id:'end',contextId:'actual',axisId:'elapsed'}},{schema:'covenant.timeline.event.v0alpha3',id:'event-2',sequence:2,type:'constraint.asserted',assertion:{id:'duration',contextId:'actual',constraint:{fromPointId:'start',toPointId:'end',minimum:5,maximum:10},evidenceRefs:['sha256:'+'a'.repeat(64)]}}]};",
          "const query={schema:'covenant.timeline.query.v0alpha3',id:'query.duration',contextId:'actual',recordedThrough:2,type:'difference.bounds',fromPointId:'start',toPointId:'end'};",
          "const conclusion=reasonTemporalQueryV0Alpha3(run,query);",
          "if(conclusion.result.minimum!==5||conclusion.result.maximum!==10||!verifyTemporalConclusionV0Alpha3(run,query,conclusion))process.exit(1);",
          "process.stdout.write(JSON.stringify({bounds:conclusion.result,proof:true}));",
        ].join(""),
      ],
      { cwd: directory },
    ).trim();
    runCommand(
      npmExecutable(),
      ["audit", "signatures", "--registry=https://registry.npmjs.org/"],
      { cwd: directory, env: npmEnvironment, inheritEnv: false },
    );
    return {
      version,
      ...parseStrictJson(smoke, "installed-package smoke result"),
      signatures: true,
    };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

async function fetchJson(url, headers = {}) {
  return parseJson(await fetchBytes(url, headers, maxMetadataBytes), url);
}

async function fetchOptionalJson(url, headers = {}) {
  try {
    return await fetchJson(url, headers);
  } catch (error) {
    if (/\breturned (?:404|410)$/.test(error.message)) return undefined;
    throw error;
  }
}

async function fetchBytes(url, headers = {}, limit) {
  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(networkTimeoutMs),
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error(`${url} timed out after ${networkTimeoutMs} ms`);
    }
    throw new Error(`${url} failed: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  if (!response.body) throw new Error(`${url} returned no body`);

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isSafeInteger(declaredLength) && declaredLength > limit) {
    throw new Error(`${url} exceeds ${limit} bytes`);
  }

  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      if (total > limit) {
        throw new Error(`${url} exceeds ${limit} bytes`);
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error(`${url} timed out after ${networkTimeoutMs} ms`);
    }
    throw error;
  }
  return Buffer.concat(chunks, total);
}

function parseJson(bytes, label) {
  return parseStrictJson(bytes.toString("utf8"), label);
}

function decodeStatement(bundle, label) {
  assertEqual(
    bundle?.dsseEnvelope?.payloadType,
    "application/vnd.in-toto+json",
    `${label} payload type`,
  );
  assert(
    (bundle?.dsseEnvelope?.signatures ?? []).length > 0,
    `${label} has no DSSE signature`,
  );
  assert(
    (bundle?.verificationMaterial?.tlogEntries ?? []).length > 0,
    `${label} has no transparency log entry`,
  );
  return parseJson(
    Buffer.from(bundle.dsseEnvelope.payload, "base64"),
    `${label} payload`,
  );
}

function oneAttestation(value, predicateType) {
  const matches = (value.attestations ?? []).filter(
    (attestation) => attestation.predicateType === predicateType,
  );
  assertEqual(matches.length, 1, `${predicateType} attestation count`);
  return matches[0];
}

function verifyStatementSubject(
  statement,
  expectedName,
  algorithm,
  expectedDigest,
  label,
) {
  assertEqual(statement?.subject?.length, 1, `${label} subject count`);
  assertEqual(
    statement.subject[0]?.name,
    expectedName,
    `${label} subject name`,
  );
  assertEqual(
    statement.subject[0]?.digest?.[algorithm],
    expectedDigest,
    `${label} subject ${algorithm}`,
  );
}

function gitJson(commit, path) {
  const output = runCommand("git", ["show", `${commit}:${path}`], {
    cwd: root,
  });
  return parseStrictJson(output, `component manifest ${path}`);
}

function requiredAsset(record, kind) {
  const asset = record.artifact.assets.find(
    (candidate) => candidate.kind === kind,
  );
  if (!asset) throw new Error(`missing ${kind}`);
  return asset;
}

function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`missing ${key}`);
  return value;
}

function uniqueMap(values, key, label) {
  const result = new Map();
  for (const value of values) {
    const id = value?.[key];
    assert(typeof id === "string" && id.length > 0, `${label} is missing`);
    assert(!result.has(id), `duplicate ${label} ${id}`);
    result.set(id, value);
  }
  return result;
}

function relationshipKey(value) {
  return [
    value.spdxElementId,
    value.relationshipType,
    value.relatedSpdxElement,
  ].join("\0");
}

function npmPurl(name, version) {
  if (!name.startsWith("@")) {
    return `pkg:npm/${encodeURIComponent(name)}@${version}`;
  }
  const [scope, packageName] = name.split("/");
  return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${version}`;
}

function workflowIdentity(record) {
  return `https://github.com/${record.workflow.repository}/${record.workflow.path}@refs/tags/${record.release.tag}`;
}

function hash(bytes, algorithm, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function sanitizedNpmEnvironment(overrides) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /^npm_config_/i.test(key) ||
      /^(?:node_auth_token|npm_token)$/i.test(key) ||
      /(?:^|_)AUTH_?TOKEN$/i.test(key) ||
      /_AUTHTOKEN$/i.test(key)
    ) {
      delete environment[key];
    }
  }
  Object.assign(environment, overrides);
  environment.NO_UPDATE_NOTIFIER = "1";
  return environment;
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function assertSupportedGhVersion(output) {
  const match = /^gh version (\d+)\.(\d+)\./m.exec(output);
  assert(match, "unable to determine GitHub CLI version");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  assert(
    major > 2 || (major === 2 && minor >= 88),
    "GitHub CLI 2.88.0 or newer is required for attestation verification",
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

export function runCommand(executable, args, options = {}) {
  const {
    env,
    inheritEnv = true,
    timeout = subprocessTimeoutMs,
    ...spawnOptions
  } = options;
  const result = spawnSync(executable, args, {
    ...spawnOptions,
    encoding: "utf8",
    env: inheritEnv ? { ...process.env, ...env, NO_UPDATE_NOTIFIER: "1" } : env,
    maxBuffer: maxMetadataBytes,
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable),
    timeout,
  });
  if (result.status !== 0) {
    throw new Error(
      [result.error?.message, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim(),
    );
  }
  return result.stdout;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifestArgument = process.argv
    .slice(2)
    .find((value) => value !== "--");
  const manifestPath = resolve(
    manifestArgument ?? join(root, "releases/timeline-v0.0.0-alpha.2.json"),
  );
  try {
    const result = await verifyPublishedRelease(manifestPath);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`published release verification failed: ${error.message}`);
    process.exit(1);
  }
}
