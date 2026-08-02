import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { mcpReleaseEvidenceProfile } from "./release-evidence-profiles.mjs";
import { isMain } from "./mcp-agent-pilot-lib.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const schema = parseStrictJson(
  await readFile(join(root, "schemas/release-evidence.v1.schema.json"), "utf8"),
  "release evidence schema",
);
const mcpSchema = parseStrictJson(
  await readFile(join(root, mcpReleaseEvidenceProfile.schemaPath), "utf8"),
  "MCP release evidence schema",
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);
const validateMcpSchema = ajv.compile(mcpSchema);
const mcpEvidenceSchema = mcpReleaseEvidenceProfile.schema;

export function validateReleaseEvidenceDocument(document, fileName) {
  const errors = [];

  if (!validateSchema(document)) {
    return validateSchema.errors
      .map(({ instancePath, message }) => `${instancePath || "/"} ${message}`)
      .sort();
  }

  const { release, workflow, registry, artifact, credentials } = document;
  const expectedTag = `timeline-v${release.version}`;
  const expectedFileName = `${expectedTag}.json`;
  const expectedWorkflowUrl = `https://github.com/${workflow.repository}/actions/runs/${workflow.runId}`;
  const expectedInvocationUrl = `${expectedWorkflowUrl}/attempts/${workflow.attempt}`;
  const expectedReleaseUrl = `https://github.com/${workflow.repository}/releases/tag/${release.tag}`;
  const expectedPackageUrl = `https://www.npmjs.com/package/${release.package}/v/${release.version}`;
  const expectedTarballUrl = `https://registry.npmjs.org/@covenant-org/timeline/-/timeline-${release.version}.tgz`;
  const expectedProvenanceUrl = `https://registry.npmjs.org/-/npm/v1/attestations/@covenant-org%2ftimeline@${release.version}`;

  expectEqual(errors, fileName, expectedFileName, "file name");
  expectEqual(errors, release.tag, expectedTag, "release tag");
  expectEqual(
    errors,
    workflow.path,
    ".github/workflows/release.yml",
    "workflow path",
  );
  expectEqual(errors, workflow.url, expectedWorkflowUrl, "workflow URL");
  expectEqual(
    errors,
    workflow.invocationUrl,
    expectedInvocationUrl,
    "workflow invocation URL",
  );
  expectEqual(errors, artifact.releaseUrl, expectedReleaseUrl, "release URL");
  expectEqual(errors, registry.packageUrl, expectedPackageUrl, "package URL");
  expectEqual(errors, registry.tarballUrl, expectedTarballUrl, "tarball URL");
  expectEqual(
    errors,
    registry.provenanceUrl,
    expectedProvenanceUrl,
    "npm provenance URL",
  );

  const prerelease = release.version.includes("-");
  expectEqual(
    errors,
    release.distTag,
    prerelease ? "next" : "latest",
    "distribution tag",
  );
  if (prerelease && release.latestAtPublish === release.version) {
    errors.push("preview release must not claim that latest moved implicitly");
  }
  if (!prerelease && release.latestAtPublish !== release.version) {
    errors.push("stable release must record itself as latest");
  }

  const components = uniqueBy(
    errors,
    document.components,
    ({ name }) => name,
    "component",
  );
  const published = [...components.values()].filter(
    ({ distribution }) => distribution === "npm",
  );
  if (published.length !== 1) {
    errors.push("release must identify exactly one npm component");
  } else {
    expectEqual(
      errors,
      published[0].name,
      release.package,
      "published component name",
    );
    expectEqual(
      errors,
      published[0].version,
      release.version,
      "published component version",
    );
  }

  const assets = uniqueBy(
    errors,
    artifact.assets,
    ({ kind }) => kind,
    "release asset kind",
  );
  const assetNames = new Set();
  for (const asset of artifact.assets) {
    if (assetNames.has(asset.name)) {
      errors.push(`duplicate release asset name ${asset.name}`);
    }
    assetNames.add(asset.name);
  }

  const tarballName = `covenant-org-timeline-${release.version}.tgz`;
  checkAsset(errors, assets.get("tarball"), {
    kind: "tarball",
    name: tarballName,
    releaseUrl: artifact.releaseUrl,
  });
  checkAsset(errors, assets.get("checksum"), {
    kind: "checksum",
    name: `${tarballName}.sha256`,
    releaseUrl: artifact.releaseUrl,
  });
  checkAsset(errors, assets.get("sbom"), {
    kind: "sbom",
    name: "timeline.spdx.json",
    releaseUrl: artifact.releaseUrl,
  });

  const tarball = assets.get("tarball");
  if (tarball) {
    expectEqual(errors, tarball.sha256, artifact.sha256, "tarball SHA-256");
    expectEqual(errors, tarball.size, artifact.packedSize, "tarball size");
  }

  const expectedAttestations = new Map([
    ["build", "https://slsa.dev/provenance/v1"],
    ["sbom", "https://spdx.dev/Document/v2.3"],
  ]);
  const attestationUrls = new Set();
  const logIndexes = new Set();
  for (const [kind, expectedPredicate] of expectedAttestations) {
    const attestation = document.attestations[kind];
    expectEqual(
      errors,
      attestation.predicateType,
      expectedPredicate,
      `${kind} attestation predicate`,
    );
    expectEqual(
      errors,
      attestation.subjectSha256,
      artifact.sha256,
      `${kind} attestation subject`,
    );
    const attestationPrefix = `https://github.com/${workflow.repository}/attestations/`;
    if (
      !attestation.url.startsWith(attestationPrefix) ||
      !/^[1-9][0-9]*$/.test(attestation.url.slice(attestationPrefix.length))
    ) {
      errors.push(`${kind} attestation URL must use the release repository`);
    }
    if (attestationUrls.has(attestation.url)) {
      errors.push(`duplicate attestation URL ${attestation.url}`);
    }
    if (logIndexes.has(attestation.transparencyLogIndex)) {
      errors.push(
        `duplicate transparency log index ${attestation.transparencyLogIndex}`,
      );
    }
    attestationUrls.add(attestation.url);
    logIndexes.add(attestation.transparencyLogIndex);
  }

  if (workflow.authentication === "oidc") {
    expectEqual(
      errors,
      credentials.trustedPublisherAtPublish,
      "configured",
      "trusted publisher state at publish",
    );
    expectEqual(
      errors,
      credentials.environmentSecretPostRelease,
      "not-created",
      "environment secret state after release",
    );
    expectEqual(
      errors,
      credentials.tokenPostRelease,
      "not-used",
      "token state after release",
    );
  } else {
    expectEqual(
      errors,
      credentials.environmentSecretPostRelease,
      "removed",
      "environment secret cleanup",
    );
    expectEqual(
      errors,
      credentials.tokenPostRelease,
      "revoked",
      "token cleanup",
    );
  }

  if (Date.parse(credentials.observedAt) < Date.parse(release.publishedAt)) {
    errors.push("credential observation must not predate publication");
  }
  const observationBasis = new Set(credentials.observationBasis);
  const requiredObservations =
    workflow.authentication === "oidc"
      ? ["npm-trusted-publisher-check"]
      : [
          "npm-trusted-publisher-check",
          "github-environment-secret-list",
          "npm-token-revocation",
          "failed-token-reauthentication",
        ];
  for (const observation of requiredObservations) {
    if (!observationBasis.has(observation)) {
      errors.push(`credential observation is missing ${observation}`);
    }
  }

  const surfaces = uniqueBy(
    errors,
    document.surfaces,
    ({ id }) => id,
    "release surface",
  );
  for (const [id, status] of [
    ["v0alpha1", "compatibility"],
    ["v0alpha2", "compatibility"],
    ["v0alpha3", "draft"],
  ]) {
    const surface = surfaces.get(id);
    if (!surface) {
      errors.push(`missing release surface ${id}`);
      continue;
    }
    expectEqual(errors, surface.status, status, `${id} status`);
  }

  const migrationKeys = new Set();
  for (const migration of document.migrations) {
    const key = `${migration.from}->${migration.to}`;
    if (migrationKeys.has(key)) errors.push(`duplicate migration ${key}`);
    migrationKeys.add(key);
    if (!surfaces.has(migration.from) || !surfaces.has(migration.to)) {
      errors.push(`migration ${key} must reference declared surfaces`);
    }
    if (migration.from === migration.to) {
      errors.push(`migration ${key} must cross surface versions`);
    }
  }

  const limitations = uniqueBy(
    errors,
    document.knownLimitations,
    ({ id }) => id,
    "known limitation",
  );
  const trustedPublisherLimitation = limitations.has(
    "trusted-publisher-not-configured",
  );
  if (
    (credentials.trustedPublisherAtPublish === "not-configured") !==
    trustedPublisherLimitation
  ) {
    errors.push(
      "trusted publisher state and known limitations must describe the same boundary",
    );
  }

  return errors.sort();
}

export function validateMcpReleaseEvidenceDocument(document, fileName) {
  const errors = [];

  if (!validateMcpSchema(document)) {
    return validateMcpSchema.errors
      .map(({ instancePath, message }) => `${instancePath || "/"} ${message}`)
      .sort();
  }

  const { release, workflow, registry, artifact, credentials, integration } =
    document;
  const expectedTag = `${mcpReleaseEvidenceProfile.tagPrefix}${release.version}`;
  const expectedFileName = `${expectedTag}.json`;
  const expectedWorkflowUrl = `https://github.com/${workflow.repository}/actions/runs/${workflow.runId}`;
  const expectedInvocationUrl = `${expectedWorkflowUrl}/attempts/${workflow.attempt}`;
  const expectedReleaseUrl = `https://github.com/${workflow.repository}/releases/tag/${release.tag}`;
  const expectedPackageUrl = `https://www.npmjs.com/package/${release.package}/v/${release.version}`;
  const expectedTarballUrl = `https://registry.npmjs.org/@covenant-org/timeline-mcp/-/timeline-mcp-${release.version}.tgz`;
  const expectedProvenanceUrl = `https://registry.npmjs.org/-/npm/v1/attestations/@covenant-org%2ftimeline-mcp@${release.version}`;

  expectEqual(errors, fileName, expectedFileName, "file name");
  expectEqual(errors, release.tag, expectedTag, "release tag");
  expectEqual(
    errors,
    workflow.path,
    mcpReleaseEvidenceProfile.workflowPath,
    "workflow path",
  );
  expectEqual(errors, workflow.url, expectedWorkflowUrl, "workflow URL");
  expectEqual(
    errors,
    workflow.invocationUrl,
    expectedInvocationUrl,
    "workflow invocation URL",
  );
  if (workflow.publicationAttempt > workflow.attempt) {
    errors.push(
      "publication attempt must not exceed successful workflow attempt",
    );
  }
  expectEqual(errors, artifact.releaseUrl, expectedReleaseUrl, "release URL");
  expectEqual(errors, registry.packageUrl, expectedPackageUrl, "package URL");
  expectEqual(errors, registry.tarballUrl, expectedTarballUrl, "tarball URL");
  expectEqual(
    errors,
    registry.provenanceUrl,
    expectedProvenanceUrl,
    "npm provenance URL",
  );

  const prerelease = release.version.includes("-");
  expectEqual(
    errors,
    release.distTag,
    prerelease ? "next" : "latest",
    "distribution tag",
  );
  if (prerelease && release.latestAtPublish === release.version) {
    errors.push("preview release must not claim that latest moved implicitly");
  }
  if (!prerelease && release.latestAtPublish !== release.version) {
    errors.push("stable release must record itself as latest");
  }

  const components = uniqueBy(
    errors,
    document.components,
    ({ name }) => name,
    "component",
  );
  const published = components.get("@covenant-org/timeline-mcp");
  const core = components.get("@covenant-org/timeline");
  if (!published) {
    errors.push("missing MCP npm component");
  } else {
    expectEqual(
      errors,
      published.version,
      release.version,
      "published component version",
    );
    expectEqual(
      errors,
      published.manifest,
      integration.manifest,
      "published component manifest",
    );
    expectEqual(
      errors,
      published.distribution,
      "npm",
      "published component distribution",
    );
  }
  if (!core) {
    errors.push("missing Timeline runtime dependency component");
  } else {
    expectEqual(
      errors,
      core.version,
      integration.runtimePins["@covenant-org/timeline"],
      "Timeline runtime dependency version",
    );
    expectEqual(
      errors,
      core.manifest,
      "packages/prototype/package.json",
      "Timeline runtime dependency manifest",
    );
    expectEqual(
      errors,
      core.distribution,
      "runtime-dependency",
      "Timeline runtime dependency distribution",
    );
  }

  const assets = uniqueBy(
    errors,
    artifact.assets,
    ({ kind }) => kind,
    "release asset kind",
  );
  const assetNames = new Set();
  for (const asset of artifact.assets) {
    if (assetNames.has(asset.name)) {
      errors.push(`duplicate release asset name ${asset.name}`);
    }
    assetNames.add(asset.name);
  }

  const tarballName = `${mcpReleaseEvidenceProfile.tarballStem}-${release.version}.tgz`;
  checkAsset(errors, assets.get("tarball"), {
    kind: "tarball",
    name: tarballName,
    releaseUrl: artifact.releaseUrl,
  });
  checkAsset(errors, assets.get("checksum"), {
    kind: "checksum",
    name: `${tarballName}.sha256`,
    releaseUrl: artifact.releaseUrl,
  });
  checkAsset(errors, assets.get("sbom"), {
    kind: "sbom",
    name: mcpReleaseEvidenceProfile.sbomName,
    releaseUrl: artifact.releaseUrl,
  });

  const tarball = assets.get("tarball");
  if (tarball) {
    expectEqual(errors, tarball.sha256, artifact.sha256, "tarball SHA-256");
    expectEqual(errors, tarball.size, artifact.packedSize, "tarball size");
  }

  const expectedAttestations = new Map([
    ["build", "https://slsa.dev/provenance/v1"],
    ["sbom", "https://spdx.dev/Document/v2.3"],
  ]);
  const attestationUrls = new Set();
  const logIndexes = new Set();
  for (const [kind, expectedPredicate] of expectedAttestations) {
    const attestation = document.attestations[kind];
    expectEqual(
      errors,
      attestation.predicateType,
      expectedPredicate,
      `${kind} attestation predicate`,
    );
    expectEqual(
      errors,
      attestation.subjectSha256,
      artifact.sha256,
      `${kind} attestation subject`,
    );
    const prefix = `https://github.com/${workflow.repository}/attestations/`;
    if (
      !attestation.url.startsWith(prefix) ||
      !/^[1-9][0-9]*$/.test(attestation.url.slice(prefix.length))
    ) {
      errors.push(`${kind} attestation URL must use the release repository`);
    }
    if (attestationUrls.has(attestation.url)) {
      errors.push(`duplicate attestation URL ${attestation.url}`);
    }
    if (logIndexes.has(attestation.transparencyLogIndex)) {
      errors.push(
        `duplicate transparency log index ${attestation.transparencyLogIndex}`,
      );
    }
    attestationUrls.add(attestation.url);
    logIndexes.add(attestation.transparencyLogIndex);
  }

  validateCredentialState(errors, release, workflow, credentials);

  const limitations = uniqueBy(
    errors,
    document.knownLimitations,
    ({ id }) => id,
    "known limitation",
  );
  const trustedPublisherLimitation = limitations.has(
    "trusted-publisher-not-configured",
  );
  if (
    (credentials.trustedPublisherAtPublish === "not-configured") !==
    trustedPublisherLimitation
  ) {
    errors.push(
      "trusted publisher state and known limitations must describe the same boundary",
    );
  }

  return errors.sort();
}

export function validateLocalReleaseSource(document) {
  const errors = [];
  const { release } = document;

  const tagType = git(["cat-file", "-t", release.tag]);
  if (tagType.status !== 0) {
    errors.push(`release tag ${release.tag} is unavailable`);
  } else if (tagType.stdout.trim() !== "tag") {
    errors.push(`release tag ${release.tag} must be annotated`);
  }

  const taggedCommit = git(["rev-parse", `${release.tag}^{commit}`]);
  if (taggedCommit.status !== 0) {
    errors.push(`release tag ${release.tag} cannot be resolved`);
  } else {
    expectEqual(
      errors,
      taggedCommit.stdout.trim(),
      release.sourceCommit,
      "tagged source commit",
    );
  }

  const tagObject = git(["rev-parse", `${release.tag}^{tag}`]);
  if (tagObject.status !== 0) {
    errors.push(`release tag ${release.tag} has no tag object`);
  } else {
    expectEqual(
      errors,
      tagObject.stdout.trim(),
      release.tagObjectSha,
      "annotated tag object",
    );
  }

  const ancestry = git([
    "merge-base",
    "--is-ancestor",
    release.sourceCommit,
    "HEAD",
  ]);
  if (ancestry.status !== 0) {
    errors.push("release source commit must be reachable from HEAD");
  }

  for (const component of document.components) {
    const result = git([
      "show",
      `${release.sourceCommit}:${component.manifest}`,
    ]);
    if (result.status !== 0) {
      errors.push(`missing component manifest ${component.manifest}`);
      continue;
    }

    let manifest;
    try {
      manifest = parseStrictJson(
        result.stdout,
        `component manifest ${component.manifest}`,
      );
    } catch {
      errors.push(`invalid component manifest ${component.manifest}`);
      continue;
    }
    expectEqual(
      errors,
      manifest.name,
      component.name,
      `${component.name} package name`,
    );
    expectEqual(
      errors,
      manifest.version,
      component.version,
      `${component.name} package version`,
    );
    if (component.distribution === "npm") {
      if (manifest.private === true) {
        errors.push(`${component.name} npm component must be public`);
      }
      expectEqual(
        errors,
        manifest.publishConfig?.access,
        "public",
        `${component.name} publish access`,
      );
    } else if (manifest.private !== true) {
      errors.push(`${component.name} source-only component must be private`);
    }
  }

  const paths = new Set([document.compatibilityPolicy, document.workflow.path]);
  for (const component of document.components) paths.add(component.manifest);
  for (const surface of document.surfaces) {
    paths.add(surface.specification);
    paths.add(surface.requirements);
    paths.add(surface.schemas);
    paths.add(surface.conformance);
  }
  for (const migration of document.migrations) {
    paths.add(migration.specification);
    paths.add(migration.implementation);
  }

  for (const path of [...paths].sort()) {
    const result = git(["cat-file", "-e", `${release.sourceCommit}:${path}`]);
    if (result.status !== 0) {
      errors.push(`release source is missing ${path}`);
    }
  }

  return errors.sort();
}

export function validateLocalMcpReleaseSource(document, runGit = git) {
  const errors = [];
  const { release, integration } = document;

  const tagType = runGit(["cat-file", "-t", release.tag]);
  if (tagType.status !== 0) {
    errors.push(`release tag ${release.tag} is unavailable`);
  } else if (tagType.stdout.trim() !== "tag") {
    errors.push(`release tag ${release.tag} must be annotated`);
  }

  const taggedCommit = runGit(["rev-parse", `${release.tag}^{commit}`]);
  if (taggedCommit.status !== 0) {
    errors.push(`release tag ${release.tag} cannot be resolved`);
  } else {
    expectEqual(
      errors,
      taggedCommit.stdout.trim(),
      release.sourceCommit,
      "tagged source commit",
    );
  }

  const tagObject = runGit(["rev-parse", `${release.tag}^{tag}`]);
  if (tagObject.status !== 0) {
    errors.push(`release tag ${release.tag} has no tag object`);
  } else {
    expectEqual(
      errors,
      tagObject.stdout.trim(),
      release.tagObjectSha,
      "annotated tag object",
    );
  }

  const ancestry = runGit([
    "merge-base",
    "--is-ancestor",
    release.sourceCommit,
    "HEAD",
  ]);
  if (ancestry.status !== 0) {
    errors.push("release source commit must be reachable from HEAD");
  }

  const manifests = new Map();
  for (const component of document.components) {
    const result = runGit([
      "show",
      `${release.sourceCommit}:${component.manifest}`,
    ]);
    if (result.status !== 0) {
      errors.push(`missing component manifest ${component.manifest}`);
      continue;
    }

    let manifest;
    try {
      manifest = parseStrictJson(
        result.stdout,
        `component manifest ${component.manifest}`,
      );
    } catch {
      errors.push(`invalid component manifest ${component.manifest}`);
      continue;
    }
    manifests.set(component.name, manifest);
    expectEqual(
      errors,
      manifest.name,
      component.name,
      `${component.name} package name`,
    );
    expectEqual(
      errors,
      manifest.version,
      component.version,
      `${component.name} package version`,
    );
    if (component.distribution === "npm") {
      if (manifest.private === true) {
        errors.push(`${component.name} npm component must be public`);
      }
      expectEqual(
        errors,
        manifest.publishConfig?.access,
        "public",
        `${component.name} publish access`,
      );
    }
  }

  const mcpManifest = manifests.get("@covenant-org/timeline-mcp");
  if (mcpManifest) {
    expectEqual(
      errors,
      mcpManifest.repository?.url,
      "git+https://github.com/open-covenant/covenant-timeline.git",
      "MCP repository URL",
    );
    expectEqual(
      errors,
      mcpManifest.repository?.directory,
      "packages/mcp-server",
      "MCP repository directory",
    );
    expectEqual(
      errors,
      mcpManifest.bin?.[integration.binary],
      "./dist/cli.js",
      "MCP binary path",
    );
    const expectedDependencies = {
      ...integration.runtimePins,
      "@covenant-org/timeline": `workspace:${integration.runtimePins["@covenant-org/timeline"]}`,
    };
    if (
      JSON.stringify(sortedObject(mcpManifest.dependencies ?? {})) !==
      JSON.stringify(sortedObject(expectedDependencies))
    ) {
      errors.push(
        "MCP production dependencies must match the recorded runtime pins",
      );
    }
    const files = new Set(mcpManifest.files ?? []);
    for (const path of ["dist", "README.md", "LICENSE"]) {
      if (!files.has(path))
        errors.push(`MCP package files must include ${path}`);
    }
  }

  const coreManifest = manifests.get("@covenant-org/timeline");
  if (coreManifest) {
    expectEqual(
      errors,
      coreManifest.version,
      integration.runtimePins["@covenant-org/timeline"],
      "Timeline runtime dependency version",
    );
  }

  const paths = new Set([document.workflow.path, integration.manifest]);
  for (const component of document.components) paths.add(component.manifest);
  for (const path of [...paths].sort()) {
    const result = runGit([
      "cat-file",
      "-e",
      `${release.sourceCommit}:${path}`,
    ]);
    if (result.status !== 0) {
      errors.push(`release source is missing ${path}`);
    }
  }

  return errors.sort();
}

export async function validateReleaseEvidenceFile(path) {
  const fileName = basename(path);
  const text = await readFile(path, "utf8");
  let document;

  try {
    document = parseStrictJson(text, fileName);
  } catch (error) {
    return [`${fileName}: invalid JSON: ${error.message}`];
  }

  const errors = [];
  const canonical = `${JSON.stringify(document, null, 2)}\n`;
  if (text !== canonical) {
    errors.push("expected canonical two-space JSON with a final newline");
  }

  const isMcp = document.schema === mcpEvidenceSchema;
  const documentErrors = isMcp
    ? validateMcpReleaseEvidenceDocument(document, fileName)
    : validateReleaseEvidenceDocument(document, fileName);
  errors.push(...documentErrors);
  if (isMcp ? validateMcpSchema(document) : validateSchema(document)) {
    errors.push(
      ...(isMcp
        ? validateLocalMcpReleaseSource(document)
        : validateLocalReleaseSource(document)),
    );
  }
  return errors.sort().map((error) => `${fileName}: ${error}`);
}

export async function checkReleaseEvidence(directory = join(root, "releases")) {
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    return { count: 0, errors: ["no release evidence manifests found"] };
  }

  const results = await Promise.all(
    files.map((file) => validateReleaseEvidenceFile(join(directory, file))),
  );
  return {
    count: files.length,
    errors: results.flat(),
  };
}

function checkAsset(errors, asset, expected) {
  if (!asset) {
    errors.push(`missing ${expected.kind} release asset`);
    return;
  }
  expectEqual(errors, asset.name, expected.name, `${expected.kind} asset name`);
  expectEqual(
    errors,
    asset.url,
    `${expected.releaseUrl.replace("/releases/tag/", "/releases/download/")}/${expected.name}`,
    `${expected.kind} asset URL`,
  );
}

function uniqueBy(errors, values, keyFor, label) {
  const result = new Map();
  for (const value of values) {
    const key = keyFor(value);
    if (result.has(key)) {
      errors.push(`duplicate ${label} ${key}`);
      continue;
    }
    result.set(key, value);
  }
  return result;
}

function expectEqual(errors, actual, expected, label) {
  if (actual !== expected) {
    errors.push(`${label} must be ${JSON.stringify(expected)}`);
  }
}

function validateCredentialState(errors, release, workflow, credentials) {
  if (workflow.authentication === "oidc") {
    expectEqual(
      errors,
      credentials.trustedPublisherAtPublish,
      "configured",
      "trusted publisher state at publish",
    );
    expectEqual(
      errors,
      credentials.environmentSecretPostRelease,
      "not-created",
      "environment secret state after release",
    );
    expectEqual(
      errors,
      credentials.tokenPostRelease,
      "not-used",
      "token state after release",
    );
  } else {
    expectEqual(
      errors,
      credentials.environmentSecretPostRelease,
      "removed",
      "environment secret cleanup",
    );
    expectEqual(
      errors,
      credentials.tokenPostRelease,
      "revoked",
      "token cleanup",
    );
  }

  if (Date.parse(credentials.observedAt) < Date.parse(release.publishedAt)) {
    errors.push("credential observation must not predate publication");
  }
  const observationBasis = new Set(credentials.observationBasis);
  const requiredObservations =
    workflow.authentication === "oidc"
      ? ["npm-trusted-publisher-check"]
      : [
          "npm-trusted-publisher-check",
          "github-environment-secret-list",
          "npm-token-revocation",
          "failed-token-reauthentication",
        ];
  for (const observation of requiredObservations) {
    if (!observationBasis.has(observation)) {
      errors.push(`credential observation is missing ${observation}`);
    }
  }
}

function sortedObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function git(args) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
}

if (isMain(import.meta.url)) {
  const result = await checkReleaseEvidence();
  if (result.errors.length > 0) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(
    `release evidence record check passed (${result.count} manifest; remote bytes not fetched)`,
  );
}
