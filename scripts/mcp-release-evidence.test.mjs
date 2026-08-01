import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateLocalMcpReleaseSource,
  validateMcpReleaseEvidenceDocument,
} from "./check-release-evidence.mjs";
import {
  mcpReleaseEvidenceProfile,
  releaseEvidenceProfile,
} from "./release-evidence-profiles.mjs";
import {
  assertMcpArchiveEntries,
  assertMcpArchiveFiles,
  expectedMcpArchiveFiles,
  maxMcpArchiveUnpackedBytes,
  parseMcpTarListings,
} from "./mcp-package-contents.mjs";
import {
  npmMetadataUrl,
  runCommand,
  verifyCertificate,
  verifyChecksumSidecar,
  verifyMcpSbom,
  verifyNpmAttestations,
  verifyWorkflowArtifact,
  verifyWorkflowJob,
  verifyWorkflowRun,
} from "./verify-published-release.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceCommit = runCommand("git", ["rev-parse", "HEAD"], {
  cwd: root,
}).trim();
const sourceEpoch = runCommand(
  "git",
  ["show", "-s", "--format=%ct", sourceCommit],
  { cwd: root },
).trim();
const manifest = mcpRecord();
const fileName = "timeline-mcp-v0.0.0-alpha.1.json";
const mcpManifestText = await readFile(
  join(root, "packages/mcp-server/package.json"),
  "utf8",
);
const coreManifestText = await readFile(
  join(root, "packages/prototype/package.json"),
  "utf8",
);

test("accepts the closed MCP release record shape", () => {
  assert.deepEqual(validateMcpReleaseEvidenceDocument(manifest, fileName), []);
  assert.equal(manifest.release.latestAtPublish, null);
  assert.equal(releaseEvidenceProfile(manifest), mcpReleaseEvidenceProfile);
});

test("encodes complete npm package paths", () => {
  assert.equal(
    npmMetadataUrl("@scope/package/nested"),
    "https://registry.npmjs.org/%40scope%2Fpackage%2Fnested",
  );
});

test("separates the successful workflow attempt from the npm publication attempt", () => {
  const retry = structuredClone(manifest);
  retry.workflow.attempt = 2;
  retry.workflow.invocationUrl = `${retry.workflow.url}/attempts/2`;

  assert.deepEqual(validateMcpReleaseEvidenceDocument(retry, fileName), []);

  const fixture = npmFixture(retry);
  assert.doesNotThrow(() =>
    verifyNpmAttestations(
      fixture.record,
      fixture.attestations,
      fixture.tarball,
      fixture.metadata,
    ),
  );
  fixture.provenance.predicate.runDetails.metadata.invocationId =
    retry.workflow.invocationUrl;
  fixture.attestations.attestations[1].bundle = bundleFor(fixture.provenance, {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    certificate: { rawBytes: "fixture" },
  });
  assert.throws(
    () =>
      verifyNpmAttestations(
        fixture.record,
        fixture.attestations,
        fixture.tarball,
        fixture.metadata,
      ),
    /npm provenance invocation/,
  );

  const certificate = certificateFor(retry);
  const publicationInvocation = `${retry.workflow.url}/attempts/1`;
  certificate.runInvocationURI = publicationInvocation;
  const result = {
    verificationResult: { signature: { certificate } },
  };
  assert.doesNotThrow(() =>
    verifyCertificate(retry, result, publicationInvocation),
  );
  certificate.runInvocationURI = retry.workflow.invocationUrl;
  assert.throws(
    () => verifyCertificate(retry, result, publicationInvocation),
    /certificate runInvocationURI/,
  );

  retry.workflow.publicationAttempt = 3;
  assert(
    validateMcpReleaseEvidenceDocument(retry, fileName).includes(
      "publication attempt must not exceed successful workflow attempt",
    ),
  );
});

test("rejects MCP workflow, artifact, component, and pin substitution", () => {
  const wrongWorkflow = structuredClone(manifest);
  wrongWorkflow.workflow.path = ".github/workflows/release.yml";
  assert(
    validateMcpReleaseEvidenceDocument(wrongWorkflow, fileName).some((error) =>
      error.includes("workflow/path must be equal to constant"),
    ),
  );

  const wrongAsset = structuredClone(manifest);
  wrongAsset.artifact.assets[2].name = "timeline.spdx.json";
  assert(
    validateMcpReleaseEvidenceDocument(wrongAsset, fileName).includes(
      'sbom asset name must be "timeline-mcp.spdx.json"',
    ),
  );

  const wrongPin = structuredClone(manifest);
  wrongPin.components[1].version = "0.0.0-alpha.1";
  wrongPin.integration.runtimePins["@covenant-org/timeline"] = "0.0.0-alpha.9";
  assert(
    validateMcpReleaseEvidenceDocument(wrongPin, fileName).includes(
      'Timeline runtime dependency version must be "0.0.0-alpha.9"',
    ),
  );
});

test("binds the MCP record to an annotated tag and tagged manifests", () => {
  const runGit = gitFixture();
  assert.deepEqual(validateLocalMcpReleaseSource(manifest, runGit), []);

  const wrongCommit = structuredClone(manifest);
  wrongCommit.release.sourceCommit = "f".repeat(40);
  assert(
    validateLocalMcpReleaseSource(wrongCommit, runGit).some((error) =>
      error.startsWith("tagged source commit must"),
    ),
  );

  const wrongTagObject = structuredClone(manifest);
  wrongTagObject.release.tagObjectSha = "e".repeat(40);
  assert(
    validateLocalMcpReleaseSource(wrongTagObject, runGit).some((error) =>
      error.startsWith("annotated tag object must"),
    ),
  );

  const wrongPin = structuredClone(manifest);
  wrongPin.integration.runtimePins.zod = "4.4.2";
  assert(
    validateLocalMcpReleaseSource(wrongPin, runGit).includes(
      "MCP production dependencies must match the recorded runtime pins",
    ),
  );
});

test("binds MCP workflow, job, and Actions artifact identities", () => {
  assert.doesNotThrow(() =>
    verifyWorkflowRun(manifest, {
      id: manifest.workflow.runId,
      run_attempt: manifest.workflow.attempt,
      status: "completed",
      conclusion: "success",
      head_sha: manifest.release.sourceCommit,
      head_branch: manifest.release.tag,
      event: "push",
      name: "release MCP server",
      path: manifest.workflow.path,
      repository: {
        id: manifest.workflow.repositoryId,
        owner: { id: manifest.workflow.repositoryOwnerId },
      },
    }),
  );
  assert.doesNotThrow(() =>
    verifyWorkflowJob(manifest, {
      id: manifest.workflow.jobId,
      run_id: manifest.workflow.runId,
      run_attempt: manifest.workflow.attempt,
      head_sha: manifest.release.sourceCommit,
      name: "publish",
      workflow_name: "release MCP server",
      conclusion: "success",
    }),
  );
  assert.doesNotThrow(() =>
    verifyWorkflowArtifact(manifest, {
      id: manifest.workflow.artifactId,
      name: "timeline-mcp-release",
      expired: false,
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
        id: manifest.workflow.artifactId,
        name: "timeline-release",
        expired: false,
        workflow_run: {
          id: manifest.workflow.runId,
          head_sha: manifest.release.sourceCommit,
          head_branch: manifest.release.tag,
        },
      }),
    /workflow artifact name/,
  );
});

test("verifies the complete MCP SPDX production graph", async () => {
  const directory = await mkdtemp(join(tmpdir(), "timeline-mcp-sbom-"));
  const output = join(directory, "timeline-mcp.spdx.json");
  try {
    runCommand(
      process.execPath,
      ["scripts/generate-sbom.mjs", output, "packages/mcp-server"],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_SHA: sourceCommit,
          SOURCE_DATE_EPOCH: sourceEpoch,
        },
      },
    );
    const sbom = JSON.parse(await readFile(output, "utf8"));
    assert.equal(sbom.packages.length, 7);
    assert.equal(sbom.relationships.length, 9);
    assert.doesNotThrow(() => verifyMcpSbom(manifest, sbom));

    const substituted = structuredClone(sbom);
    substituted.relationships[1].relatedSpdxElement =
      "SPDXRef-Package-substituted";
    assert.throws(
      () => verifyMcpSbom(manifest, substituted),
      /unknown SBOM relationship target/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("binds npm provenance to the MCP package and workflow", () => {
  const { record, attestations, tarball, metadata, provenance } =
    npmFixture(manifest);

  assert.doesNotThrow(() =>
    verifyNpmAttestations(record, attestations, tarball, metadata),
  );
  provenance.predicate.buildDefinition.externalParameters.workflow.path =
    ".github/workflows/release.yml";
  attestations.attestations[1].bundle = bundleFor(provenance, {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    certificate: { rawBytes: "fixture" },
  });
  assert.throws(
    () => verifyNpmAttestations(record, attestations, tarball, metadata),
    /npm provenance workflow path/,
  );
});

test("binds the attestation certificate to the MCP workflow name", () => {
  const result = {
    verificationResult: {
      signature: {
        certificate: certificateFor(manifest),
      },
    },
  };
  assert.doesNotThrow(() => verifyCertificate(manifest, result));
  result.verificationResult.signature.certificate.githubWorkflowName =
    "release";
  assert.throws(
    () => verifyCertificate(manifest, result),
    /certificate githubWorkflowName/,
  );
});

test("binds the MCP checksum sidecar filename", () => {
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
        `${manifest.artifact.sha256}  /build/timeline.tgz\n`,
      ),
    /checksum sidecar subject/,
  );
});

test("rejects stale or missing MCP archive members", () => {
  assert.doesNotThrow(() => assertMcpArchiveFiles(expectedMcpArchiveFiles));
  assert.throws(
    () =>
      assertMcpArchiveFiles([
        ...expectedMcpArchiveFiles,
        "package/dist/transport.js",
      ]),
    /unexpected MCP archive files: package\/dist\/transport\.js/,
  );
  assert.throws(
    () => assertMcpArchiveFiles(expectedMcpArchiveFiles.slice(1)),
    /missing MCP archive files: package\/LICENSE/,
  );
  assert.throws(
    () =>
      assertMcpArchiveFiles([
        ...expectedMcpArchiveFiles,
        expectedMcpArchiveFiles[0],
      ]),
    /duplicate MCP archive members/,
  );
  const names = expectedMcpArchiveFiles.join("\n");
  const regular = expectedMcpArchiveFiles
    .map((name) => `-rw-r--r-- 0 0 0 1 Jan 1 1985 ${name}`)
    .join("\n");
  const entries = parseMcpTarListings(names, regular);
  assert.deepEqual(assertMcpArchiveEntries(entries), {
    fileCount: expectedMcpArchiveFiles.length,
    unpackedSize: expectedMcpArchiveFiles.length,
  });
  assert.throws(
    () =>
      assertMcpArchiveEntries(entries, {
        expectedUnpackedSize: expectedMcpArchiveFiles.length + 1,
      }),
    /MCP archive unpacked size must be/,
  );
  entries[0].type = "l";
  assert.throws(
    () => assertMcpArchiveEntries(entries),
    /non-regular MCP archive members: package\/LICENSE \(l\)/,
  );
  assert.throws(
    () => parseMcpTarListings(names, regular.split("\n").slice(1).join("\n")),
    /MCP archive listings disagree/,
  );
});

test("bounds aggregate MCP archive bytes across tar implementations", () => {
  const names = expectedMcpArchiveFiles.join("\n");
  const gnu = expectedMcpArchiveFiles
    .map((name) => `-rw-r--r-- 0/0 1 1985-01-01 00:00 ${name}`)
    .join("\n");
  const entries = parseMcpTarListings(names, gnu);
  entries[0].size =
    maxMcpArchiveUnpackedBytes - expectedMcpArchiveFiles.length + 1;
  assert.equal(
    assertMcpArchiveEntries(entries).unpackedSize,
    maxMcpArchiveUnpackedBytes,
  );
  entries[0].size += 1;
  assert.throws(
    () => assertMcpArchiveEntries(entries),
    /MCP archive exceeds 8388608 unpacked bytes/,
  );

  const oversizedRecord = structuredClone(manifest);
  oversizedRecord.registry.unpackedSize = maxMcpArchiveUnpackedBytes + 1;
  assert(
    validateMcpReleaseEvidenceDocument(oversizedRecord, fileName).some(
      (error) => error.includes("registry/unpackedSize must be <= 8388608"),
    ),
  );
});

function mcpRecord() {
  const tag = "timeline-mcp-v0.0.0-alpha.1";
  const repository = "open-covenant/covenant-timeline";
  const releaseUrl = `https://github.com/${repository}/releases/tag/${tag}`;
  const tarball = "covenant-org-timeline-mcp-0.0.0-alpha.1.tgz";
  return {
    schema: "covenant.timeline.mcp-release-evidence.v1",
    release: {
      package: "@covenant-org/timeline-mcp",
      version: "0.0.0-alpha.1",
      tag,
      tagObjectSha: "b".repeat(40),
      sourceCommit,
      publishedAt: "2026-07-27T12:00:00Z",
      distTag: "next",
      latestAtPublish: null,
    },
    workflow: {
      repository,
      repositoryId: 1312007933,
      repositoryOwnerId: 278660579,
      path: ".github/workflows/release-mcp.yml",
      url: `https://github.com/${repository}/actions/runs/123`,
      invocationUrl: `https://github.com/${repository}/actions/runs/123/attempts/1`,
      runId: 123,
      attempt: 1,
      publicationAttempt: 1,
      jobId: 456,
      artifactId: 789,
      environment: "npm",
      authentication: "token-fallback",
      provenance: true,
    },
    components: [
      {
        name: "@covenant-org/timeline-mcp",
        version: "0.0.0-alpha.1",
        manifest: "packages/mcp-server/package.json",
        distribution: "npm",
      },
      {
        name: "@covenant-org/timeline",
        version: "0.0.0-alpha.3",
        manifest: "packages/prototype/package.json",
        distribution: "runtime-dependency",
      },
    ],
    registry: {
      packageUrl:
        "https://www.npmjs.com/package/@covenant-org/timeline-mcp/v/0.0.0-alpha.1",
      tarballUrl:
        "https://registry.npmjs.org/@covenant-org/timeline-mcp/-/timeline-mcp-0.0.0-alpha.1.tgz",
      shasum: "a".repeat(40),
      integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
      fileCount: 35,
      unpackedSize: 1000,
      provenanceUrl:
        "https://registry.npmjs.org/-/npm/v1/attestations/@covenant-org%2ftimeline-mcp@0.0.0-alpha.1",
    },
    artifact: {
      sha256: "c".repeat(64),
      packedSize: 500,
      releaseUrl,
      assets: [
        {
          kind: "tarball",
          name: tarball,
          url: `${releaseUrl.replace("/releases/tag/", "/releases/download/")}/${tarball}`,
          sha256: "c".repeat(64),
          size: 500,
        },
        {
          kind: "checksum",
          name: `${tarball}.sha256`,
          url: `${releaseUrl.replace("/releases/tag/", "/releases/download/")}/${tarball}.sha256`,
          sha256: "d".repeat(64),
          size: 148,
        },
        {
          kind: "sbom",
          name: "timeline-mcp.spdx.json",
          url: `${releaseUrl.replace("/releases/tag/", "/releases/download/")}/timeline-mcp.spdx.json`,
          sha256: "e".repeat(64),
          size: 5000,
        },
      ],
    },
    attestations: {
      build: {
        url: `https://github.com/${repository}/attestations/100`,
        bundleSha256: "f".repeat(64),
        predicateType: "https://slsa.dev/provenance/v1",
        subjectSha256: "c".repeat(64),
        transparencyLogIndex: 1000,
      },
      sbom: {
        url: `https://github.com/${repository}/attestations/101`,
        bundleSha256: "1".repeat(64),
        predicateType: "https://spdx.dev/Document/v2.3",
        subjectSha256: "c".repeat(64),
        transparencyLogIndex: 1001,
      },
    },
    credentials: {
      assurance: "operator-observed",
      observedAt: "2026-07-27T13:00:00Z",
      observationBasis: [
        "npm-trusted-publisher-check",
        "github-environment-secret-list",
        "npm-token-revocation",
        "failed-token-reauthentication",
      ],
      trustedPublisherAtPublish: "not-configured",
      environmentSecretPostRelease: "removed",
      tokenPostRelease: "revoked",
    },
    integration: {
      manifest: "packages/mcp-server/package.json",
      binary: "timeline-mcp",
      transport: "stdio",
      temporalSurface: "v0alpha3",
      storeEnvelope: "covenant.timeline.mcp-run.v0alpha1",
      runtimePins: {
        "@covenant-org/timeline": "0.0.0-alpha.3",
        "@modelcontextprotocol/server": "2.0.0-beta.5",
        zod: "4.4.3",
      },
    },
    knownLimitations: [
      {
        id: "trusted-publisher-not-configured",
        reference: "https://docs.npmjs.com/trusted-publishers/",
      },
      {
        id: "local-single-host-store",
        reference:
          "https://github.com/open-covenant/covenant-timeline/blob/main/packages/mcp-server/README.md",
      },
    ],
  };
}

function gitFixture() {
  return (args) => {
    const operation = args[0];
    if (operation === "cat-file" && args[1] === "-t") {
      return { status: 0, stdout: "tag\n" };
    }
    if (operation === "rev-parse" && args[1].endsWith("^{commit}")) {
      return { status: 0, stdout: `${sourceCommit}\n` };
    }
    if (operation === "rev-parse" && args[1].endsWith("^{tag}")) {
      return { status: 0, stdout: `${"b".repeat(40)}\n` };
    }
    if (operation === "merge-base") {
      return { status: 0, stdout: "" };
    }
    if (operation === "show") {
      return {
        status: 0,
        stdout: args[1].endsWith("packages/mcp-server/package.json")
          ? mcpManifestText
          : coreManifestText,
      };
    }
    if (operation === "cat-file" && args[1] === "-e") {
      return { status: 0, stdout: "" };
    }
    throw new Error(`unexpected git fixture call: ${args.join(" ")}`);
  };
}

function npmFixture(record) {
  const tarball = Buffer.from("MCP release fixture");
  const sha512 = createHash("sha512").update(tarball).digest("hex");
  const candidate = structuredClone(record);
  candidate.registry.integrity = `sha512-${createHash("sha512")
    .update(tarball)
    .digest("base64")}`;
  const subject = `pkg:npm/%40covenant-org/timeline-mcp@${candidate.release.version}`;
  const publishKey = "SHA256:mcp-release-key";
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
  provenance.predicate.runDetails.metadata.invocationId = `${candidate.workflow.url}/attempts/${candidate.workflow.publicationAttempt}`;
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
  return {
    record: candidate,
    attestations,
    tarball,
    metadata,
    provenance,
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

function certificateFor(record) {
  const identity = `https://github.com/${record.workflow.repository}/${record.workflow.path}@refs/tags/${record.release.tag}`;
  const tagRef = `refs/tags/${record.release.tag}`;
  const repository = `https://github.com/${record.workflow.repository}`;
  return {
    issuer: "https://token.actions.githubusercontent.com",
    subjectAlternativeName: identity,
    githubWorkflowTrigger: "push",
    githubWorkflowSHA: record.release.sourceCommit,
    githubWorkflowName: "release MCP server",
    githubWorkflowRepository: record.workflow.repository,
    githubWorkflowRef: tagRef,
    buildSignerURI: identity,
    buildSignerDigest: record.release.sourceCommit,
    runnerEnvironment: "github-hosted",
    sourceRepositoryURI: repository,
    sourceRepositoryDigest: record.release.sourceCommit,
    sourceRepositoryRef: tagRef,
    sourceRepositoryIdentifier: String(record.workflow.repositoryId),
    sourceRepositoryOwnerIdentifier: String(record.workflow.repositoryOwnerId),
    buildConfigURI: identity,
    buildConfigDigest: record.release.sourceCommit,
    buildTrigger: "push",
    runInvocationURI: record.workflow.invocationUrl,
    sourceRepositoryVisibilityAtSigning: "public",
  };
}
