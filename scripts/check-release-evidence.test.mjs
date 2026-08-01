import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateLocalReleaseSource,
  validateReleaseEvidenceDocument,
  validateReleaseEvidenceFile,
} from "./check-release-evidence.mjs";
import {
  assertSupportedGhVersion,
  runCommand,
  verifyChecksumSidecar,
  verifyGithubAttestationResult,
  verifyNpmAttestations,
  verifyRemoteTag,
  verifyRemoteTagRef,
  verifySbom,
  verifyWorkflowArtifact,
  verifyWorkflowJob,
  verifyWorkflowRun,
} from "./verify-published-release.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = join(root, "releases/timeline-v0.0.0-alpha.2.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const fileName = "timeline-v0.0.0-alpha.2.json";

test("accepts the recorded alpha.2 release", () => {
  assert.deepEqual(validateReleaseEvidenceDocument(manifest, fileName), []);
  assert.deepEqual(validateLocalReleaseSource(manifest), []);
});

test("bounds the recorded core archive size", () => {
  const candidate = structuredClone(manifest);
  candidate.registry.unpackedSize = 8 * 1024 * 1024 + 1;

  assert(
    validateReleaseEvidenceDocument(candidate, fileName).some((error) =>
      error.includes("registry/unpackedSize must be <= 8388608"),
    ),
  );
});

test("rejects workflow, artifact, and attestation substitution", () => {
  const candidate = structuredClone(manifest);
  candidate.workflow.url =
    "https://github.com/open-covenant/covenant-timeline/actions/runs/1";
  candidate.workflow.attempt = 999;
  candidate.artifact.assets[0].sha256 = "a".repeat(64);
  candidate.attestations.build.subjectSha256 = "b".repeat(64);
  candidate.attestations.sbom.url = "https://example.com/attestations/1";

  const errors = validateReleaseEvidenceDocument(candidate, fileName);
  assert(errors.some((error) => error.startsWith("workflow URL must be")));
  assert(
    errors.some((error) => error.startsWith("workflow invocation URL must be")),
  );
  assert(errors.some((error) => error.startsWith("tarball SHA-256 must be")));
  assert(
    errors.some((error) =>
      error.startsWith("build attestation subject must be"),
    ),
  );
  assert(
    errors.includes("sbom attestation URL must use the release repository"),
  );
});

test("rejects incomplete fallback credential cleanup", () => {
  const candidate = structuredClone(manifest);
  candidate.credentials.environmentSecretPostRelease = "not-created";
  candidate.credentials.tokenPostRelease = "not-used";

  const errors = validateReleaseEvidenceDocument(candidate, fileName);
  assert(errors.includes('environment secret cleanup must be "removed"'));
  assert(errors.includes('token cleanup must be "revoked"'));
});

test("rejects duplicate release asset kinds", () => {
  const candidate = structuredClone(manifest);
  candidate.artifact.assets[2].kind = "tarball";

  const errors = validateReleaseEvidenceDocument(candidate, fileName);
  assert(errors.includes("duplicate release asset kind tarball"));
  assert(errors.includes("missing sbom release asset"));
});

test("binds the source tag, components, and protocol paths", () => {
  const wrongTagObject = structuredClone(manifest);
  wrongTagObject.release.tagObjectSha = "a".repeat(40);
  assert(
    validateLocalReleaseSource(wrongTagObject).some((error) =>
      error.startsWith("annotated tag object must"),
    ),
  );

  const wrongCommit = structuredClone(manifest);
  wrongCommit.release.sourceCommit = "a".repeat(40);
  const commitErrors = validateLocalReleaseSource(wrongCommit);
  assert(
    commitErrors.some((error) => error.startsWith("tagged source commit must")),
  );
  assert(
    commitErrors.includes("release source commit must be reachable from HEAD"),
  );

  const wrongComponent = structuredClone(manifest);
  wrongComponent.components[0].version = "0.0.0-alpha.9";
  assert(
    validateLocalReleaseSource(wrongComponent).includes(
      '@covenant-org/timeline package version must be "0.0.0-alpha.9"',
    ),
  );

  const wrongPath = structuredClone(manifest);
  wrongPath.surfaces[0].schemas = "schemas/v0alpha99";
  assert(
    validateLocalReleaseSource(wrongPath).includes(
      "release source is missing schemas/v0alpha99",
    ),
  );

  const traversal = structuredClone(manifest);
  traversal.surfaces[0].schemas = "schemas/../v0alpha3";
  assert(
    validateReleaseEvidenceDocument(traversal, fileName).some((error) =>
      error.includes("must match pattern"),
    ),
  );

  const wrongMigration = structuredClone(manifest);
  wrongMigration.migrations[0].implementation =
    "packages/prototype/src/v0alpha2/missing.ts";
  assert(
    validateLocalReleaseSource(wrongMigration).includes(
      "release source is missing packages/prototype/src/v0alpha2/missing.ts",
    ),
  );
});

test("binds workflow attempt, artifact ID, checksum, and SBOM identity", () => {
  const run = {
    id: manifest.workflow.runId,
    run_attempt: manifest.workflow.attempt,
    status: "completed",
    conclusion: "success",
    head_sha: manifest.release.sourceCommit,
    head_branch: manifest.release.tag,
    event: "push",
    name: "release",
    path: manifest.workflow.path,
    repository: {
      id: manifest.workflow.repositoryId,
      owner: { id: manifest.workflow.repositoryOwnerId },
    },
  };
  assert.doesNotThrow(() => verifyWorkflowRun(manifest, run));
  assert.throws(
    () => verifyWorkflowRun(manifest, { ...run, run_attempt: 999 }),
    /workflow attempt/,
  );
  assert.doesNotThrow(() =>
    verifyWorkflowArtifact(manifest, {
      id: manifest.workflow.artifactId,
      name: "timeline-release",
      expired: false,
      workflow_run: {
        id: manifest.workflow.runId,
        head_sha: manifest.release.sourceCommit,
        head_branch: manifest.release.tag,
      },
    }),
  );
  assert.doesNotThrow(() =>
    verifyWorkflowArtifact(manifest, {
      id: manifest.workflow.artifactId,
      name: "timeline-release",
      expired: true,
      workflow_run: {
        id: manifest.workflow.runId,
        head_sha: manifest.release.sourceCommit,
        head_branch: manifest.release.tag,
      },
    }),
  );
  assert.throws(
    () =>
      verifyWorkflowArtifact(manifest, {
        id: 1,
        name: "timeline-release",
        expired: false,
        workflow_run: {
          id: manifest.workflow.runId,
          head_sha: manifest.release.sourceCommit,
          head_branch: manifest.release.tag,
        },
      }),
    /workflow artifact ID/,
  );

  const tarball = manifest.artifact.assets.find(
    ({ kind }) => kind === "tarball",
  );
  assert.doesNotThrow(() =>
    verifyChecksumSidecar(
      manifest,
      `${manifest.artifact.sha256}  /build/${tarball.name}\n`,
    ),
  );
  assert.throws(
    () =>
      verifyChecksumSidecar(
        manifest,
        `${"a".repeat(64)}  /build/${tarball.name}\n`,
      ),
    /checksum sidecar digest/,
  );
  const portableManifest = structuredClone(manifest);
  portableManifest.release.version = "0.0.0-alpha.3";
  assert.doesNotThrow(() =>
    verifyChecksumSidecar(
      portableManifest,
      `${manifest.artifact.sha256}  ${tarball.name}\n`,
    ),
  );
  assert.throws(
    () =>
      verifyChecksumSidecar(
        portableManifest,
        `${manifest.artifact.sha256}  /build/${tarball.name}\n`,
      ),
    /checksum sidecar subject/,
  );

  const sbom = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "@covenant-org/timeline-0.0.0-alpha.2",
    documentNamespace:
      "https://github.com/open-covenant/covenant-timeline/sbom/23116b220a24debe83f7aad3bd8b85a945c655cf/0.0.0-alpha.2",
    creationInfo: {
      created: "2026-07-26T22:21:48Z",
      creators: ["Organization: Open Covenant"],
    },
    packages: [
      spdxPackage(
        "@covenant-org/timeline",
        "0.0.0-alpha.2",
        "SPDXRef-Package--covenant-org-timeline",
        "Apache-2.0",
      ),
      spdxPackage(
        "canonicalize",
        "3.0.0",
        "SPDXRef-Package-canonicalize",
        "Apache-2.0",
      ),
      spdxPackage(
        "jsonc-parser",
        "3.3.1",
        "SPDXRef-Package-jsonc-parser",
        "MIT",
      ),
    ],
    relationships: [
      {
        spdxElementId: "SPDXRef-DOCUMENT",
        relationshipType: "DESCRIBES",
        relatedSpdxElement: "SPDXRef-Package--covenant-org-timeline",
      },
      {
        spdxElementId: "SPDXRef-Package--covenant-org-timeline",
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: "SPDXRef-Package-canonicalize",
      },
      {
        spdxElementId: "SPDXRef-Package--covenant-org-timeline",
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: "SPDXRef-Package-jsonc-parser",
      },
    ],
  };
  assert.doesNotThrow(() => verifySbom(manifest, sbom));
  assert.throws(
    () => verifySbom(manifest, { ...sbom, documentNamespace: "wrong" }),
    /SBOM namespace/,
  );
});

test("binds job, remote tag ref, and annotated target", () => {
  assert.doesNotThrow(() =>
    verifyWorkflowJob(manifest, {
      id: manifest.workflow.jobId,
      run_id: manifest.workflow.runId,
      run_attempt: manifest.workflow.attempt,
      head_sha: manifest.release.sourceCommit,
      name: "publish",
      workflow_name: "release",
      conclusion: "success",
    }),
  );
  assert.doesNotThrow(() =>
    verifyRemoteTagRef(manifest, {
      ref: `refs/tags/${manifest.release.tag}`,
      object: { type: "tag", sha: manifest.release.tagObjectSha },
    }),
  );
  assert.doesNotThrow(() =>
    verifyRemoteTag(manifest, {
      sha: manifest.release.tagObjectSha,
      tag: manifest.release.tag,
      object: { type: "commit", sha: manifest.release.sourceCommit },
    }),
  );
  assert.throws(
    () =>
      verifyRemoteTagRef(manifest, {
        ref: `refs/tags/${manifest.release.tag}`,
        object: { type: "commit", sha: manifest.release.sourceCommit },
      }),
    /remote tag object type/,
  );
  assert.throws(
    () =>
      verifyRemoteTag(manifest, {
        sha: manifest.release.tagObjectSha,
        tag: manifest.release.tag,
        object: { type: "commit", sha: "a".repeat(40) },
      }),
    /annotated tag target commit/,
  );
});

test("binds npm publish and provenance attestations to package bytes", () => {
  const tarball = Buffer.from("release fixture");
  const sha512 = createHash("sha512").update(tarball).digest("hex");
  const integrity = `sha512-${createHash("sha512")
    .update(tarball)
    .digest("base64")}`;
  const candidate = structuredClone(manifest);
  candidate.registry.integrity = integrity;
  const subject = "pkg:npm/%40covenant-org/timeline@0.0.0-alpha.2";
  const publishKey = "SHA256:test-key";
  const publish = {
    _type: "https://in-toto.io/Statement/v0.1",
    subject: [{ name: subject, digest: { sha512 } }],
    predicateType:
      "https://github.com/npm/attestation/tree/main/specs/publish/v0.1",
    predicate: {
      name: candidate.release.package,
      version: candidate.release.version,
      registry: "https://registry.npmjs.org",
    },
  };
  const provenance = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: subject, digest: { sha512 } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: workflowPredicate(candidate),
  };
  const attestations = {
    attestations: [
      {
        predicateType: publish.predicateType,
        bundle: bundleFor(publish, {
          mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.2",
          publicKey: { hint: publishKey },
        }),
      },
      {
        predicateType: provenance.predicateType,
        bundle: bundleFor(provenance, {
          mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
          certificate: { rawBytes: "fixture" },
        }),
      },
    ],
  };
  const metadata = {
    versions: {
      [candidate.release.version]: {
        dist: { signatures: [{ keyid: publishKey }] },
      },
    },
  };

  assert.doesNotThrow(() =>
    verifyNpmAttestations(candidate, attestations, tarball, metadata),
  );
  publish.predicateType = "https://example.com/substituted";
  attestations.attestations[0].bundle = bundleFor(publish, {
    mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.2",
    publicKey: { hint: publishKey },
  });
  assert.throws(
    () => verifyNpmAttestations(candidate, attestations, tarball, metadata),
    /npm publish predicate/,
  );
  publish.predicateType =
    "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";
  attestations.attestations[0].bundle = bundleFor(publish, {
    mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.2",
    publicKey: { hint: publishKey },
  });
  provenance.predicate.runDetails.metadata.invocationId =
    "https://github.com/open-covenant/covenant-timeline/actions/runs/1/attempts/1";
  attestations.attestations[1].bundle = bundleFor(provenance, {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    certificate: { rawBytes: "fixture" },
  });
  assert.throws(
    () => verifyNpmAttestations(candidate, attestations, tarball, metadata),
    /npm provenance invocation/,
  );
});

test("binds verified GitHub attestations to certificate and statement", () => {
  const buildStatement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: "covenant-org-timeline-0.0.0-alpha.2.tgz",
        digest: { sha256: manifest.artifact.sha256 },
      },
    ],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: githubWorkflowPredicate(manifest),
  };
  const buildBundle = bundleFor(buildStatement, {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    certificate: { rawBytes: "fixture" },
  });
  buildBundle.verificationMaterial.tlogEntries[0].logIndex = String(
    manifest.attestations.build.transparencyLogIndex,
  );
  const buildResult = githubVerificationResult(
    manifest,
    buildBundle,
    buildStatement,
  );

  assert.doesNotThrow(() =>
    verifyGithubAttestationResult(
      manifest,
      "build",
      manifest.attestations.build,
      buildBundle,
      buildResult,
      {},
    ),
  );

  const wrongInvocation = structuredClone(buildResult);
  wrongInvocation.verificationResult.signature.certificate.runInvocationURI =
    "https://github.com/open-covenant/covenant-timeline/actions/runs/1/attempts/1";
  assert.throws(
    () =>
      verifyGithubAttestationResult(
        manifest,
        "build",
        manifest.attestations.build,
        buildBundle,
        wrongInvocation,
        {},
      ),
    /certificate runInvocationURI/,
  );

  const wrongLog = structuredClone(buildResult);
  wrongLog.attestation.bundle.verificationMaterial.tlogEntries[0].logIndex =
    "999";
  assert.throws(
    () =>
      verifyGithubAttestationResult(
        manifest,
        "build",
        manifest.attestations.build,
        buildBundle,
        wrongLog,
        {},
      ),
    /transparency entries differ/,
  );

  const sbom = { spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT" };
  const sbomStatement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: buildStatement.subject,
    predicateType: "https://spdx.dev/Document/v2.3",
    predicate: sbom,
  };
  const sbomBundle = bundleFor(sbomStatement, {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    certificate: { rawBytes: "fixture" },
  });
  sbomBundle.verificationMaterial.tlogEntries[0].logIndex = String(
    manifest.attestations.sbom.transparencyLogIndex,
  );
  const sbomResult = githubVerificationResult(
    manifest,
    sbomBundle,
    sbomStatement,
  );
  assert.doesNotThrow(() =>
    verifyGithubAttestationResult(
      manifest,
      "sbom",
      manifest.attestations.sbom,
      sbomBundle,
      sbomResult,
      sbom,
    ),
  );
  sbomResult.verificationResult.statement.predicate = {
    ...sbom,
    name: "substituted",
  };
  assert.throws(
    () =>
      verifyGithubAttestationResult(
        manifest,
        "sbom",
        manifest.attestations.sbom,
        sbomBundle,
        sbomResult,
        sbom,
      ),
    /does not match the release SBOM/,
  );
});

test("supports bounded subprocesses from paths with spaces", async () => {
  const base = await mkdtemp(join(tmpdir(), "timeline command test-"));
  const directory = join(base, "workspace with spaces");
  try {
    await mkdir(directory);
    assert.equal(
      runCommand(process.execPath, ["--eval", 'process.stdout.write("ok")'], {
        cwd: directory,
      }),
      "ok",
    );
    assert.match(
      runCommand(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["--version"],
        { cwd: directory },
      ),
      /^\d+\.\d+\.\d+/,
    );
    assert.doesNotThrow(() =>
      assertSupportedGhVersion("gh version 2.88.1 (fixture)\n"),
    );
    assert.throws(
      () => assertSupportedGhVersion("gh version 2.87.9 (fixture)\n"),
      /2.88.0 or newer/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("rejects duplicate keys in remote JSON", () => {
  assert.throws(
    () => parseStrictJson('{"subject":1,"subject":2}', "remote fixture"),
    /duplicate object key "subject"/,
  );
});

test("rejects noncanonical, duplicate-key, and extended manifests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "timeline-release-evidence-"));
  const path = join(directory, fileName);

  try {
    const candidate = { ...manifest, unexpected: true };
    await writeFile(path, JSON.stringify(candidate), "utf8");
    const errors = await validateReleaseEvidenceFile(path);
    assert(
      errors.some((error) =>
        error.includes("expected canonical two-space JSON"),
      ),
    );
    assert(
      errors.some((error) =>
        error.includes("must NOT have additional properties"),
      ),
    );

    const canonical = JSON.stringify(manifest, null, 2);
    await writeFile(
      path,
      `${canonical.replace(
        '"schema": "covenant.timeline.release-evidence.v1",',
        '"schema": "wrong",\n  "schema": "covenant.timeline.release-evidence.v1",',
      )}\n`,
      "utf8",
    );
    const duplicateErrors = await validateReleaseEvidenceFile(path);
    assert(
      duplicateErrors.some((error) =>
        error.includes('duplicate object key "schema"'),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function spdxPackage(name, version, id, license) {
  const purlName = name.startsWith("@")
    ? `${encodeURIComponent(name.split("/")[0])}/${encodeURIComponent(
        name.split("/")[1],
      )}`
    : encodeURIComponent(name);
  return {
    name,
    SPDXID: id,
    versionInfo: version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: license,
    licenseDeclared: license,
    copyrightText: "NOASSERTION",
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:npm/${purlName}@${version}`,
      },
    ],
  };
}

function bundleFor(statement, verificationMaterial) {
  const { mediaType, ...material } = verificationMaterial;
  return {
    mediaType,
    verificationMaterial: {
      ...material,
      tlogEntries: [{ logIndex: "1" }],
    },
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
      payloadType: "application/vnd.in-toto+json",
      signatures: [{ sig: "fixture" }],
    },
  };
}

function workflowPredicate(record) {
  const tagRef = `refs/tags/${record.release.tag}`;
  const repository = `https://github.com/${record.workflow.repository}`;
  return {
    buildDefinition: {
      buildType:
        "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
      externalParameters: {
        workflow: {
          ref: tagRef,
          repository,
          path: record.workflow.path,
        },
      },
      internalParameters: {
        github: {
          event_name: "push",
          repository_id: String(record.workflow.repositoryId),
          repository_owner_id: String(record.workflow.repositoryOwnerId),
        },
      },
      resolvedDependencies: [
        {
          uri: `git+${repository}@${tagRef}`,
          digest: { gitCommit: record.release.sourceCommit },
        },
      ],
    },
    runDetails: {
      builder: { id: "https://github.com/actions/runner/github-hosted" },
      metadata: { invocationId: record.workflow.invocationUrl },
    },
  };
}

function githubWorkflowPredicate(record) {
  const predicate = workflowPredicate(record);
  predicate.buildDefinition.buildType =
    "https://actions.github.io/buildtypes/workflow/v1";
  predicate.buildDefinition.internalParameters.github.runner_environment =
    "github-hosted";
  predicate.runDetails.builder.id = `https://github.com/${record.workflow.repository}/${record.workflow.path}@refs/tags/${record.release.tag}`;
  return predicate;
}

function githubVerificationResult(record, bundle, statement) {
  const identity =
    `https://github.com/${record.workflow.repository}/${record.workflow.path}` +
    `@refs/tags/${record.release.tag}`;
  const tagRef = `refs/tags/${record.release.tag}`;
  return {
    attestation: { bundle },
    verificationResult: {
      signature: {
        certificate: {
          issuer: "https://token.actions.githubusercontent.com",
          subjectAlternativeName: identity,
          githubWorkflowTrigger: "push",
          githubWorkflowSHA: record.release.sourceCommit,
          githubWorkflowName: "release",
          githubWorkflowRepository: record.workflow.repository,
          githubWorkflowRef: tagRef,
          buildSignerURI: identity,
          buildSignerDigest: record.release.sourceCommit,
          runnerEnvironment: "github-hosted",
          sourceRepositoryURI: `https://github.com/${record.workflow.repository}`,
          sourceRepositoryDigest: record.release.sourceCommit,
          sourceRepositoryRef: tagRef,
          sourceRepositoryIdentifier: String(record.workflow.repositoryId),
          sourceRepositoryOwnerIdentifier: String(
            record.workflow.repositoryOwnerId,
          ),
          buildConfigURI: identity,
          buildConfigDigest: record.release.sourceCommit,
          buildTrigger: "push",
          runInvocationURI: record.workflow.invocationUrl,
          sourceRepositoryVisibilityAtSigning: "public",
        },
      },
      verifiedTimestamps: [{ type: "Tlog", uri: "https://rekor.sigstore.dev" }],
      statement,
    },
  };
}
