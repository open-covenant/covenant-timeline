import { access, readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

const manifest = JSON.parse(
  await readFile("packages/prototype/package.json", "utf8"),
);
const changelog = await readFile("CHANGELOG.md", "utf8");
const workflow = await readFile(".github/workflows/release.yml", "utf8");
const publisher = await readFile("scripts/publish-npm-package.mjs", "utf8");
const readme = await readFile("README.md", "utf8");
const gettingStarted = await readFile("docs/getting-started.md", "utf8");
const packageReadme = await readFile("packages/prototype/README.md", "utf8");
const refName = process.env.GITHUB_REF_NAME;
const tagArgument = process.argv[2];
const tag =
  tagArgument ?? (refName?.startsWith("timeline-v") ? refName : undefined);
const expectedTag = `timeline-v${manifest.version}`;
const errors = [];
const workflowConfig = parseWorkflow(workflow, errors);
const jobs = record(workflowConfig.jobs);
const publishJob = record(jobs?.publish);
const publishSteps = steps(publishJob);

if (process.argv.length > 3) errors.push("unexpected release check arguments");
if (manifest.name !== "@covenant-org/timeline") {
  errors.push("unexpected package name");
}
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(manifest.version)) {
  errors.push(`unsupported package version ${manifest.version}`);
}
if (manifest.private === true) errors.push("package must be public");
if (manifest.publishConfig?.access !== "public") {
  errors.push("publishConfig.access must be public");
}
if (
  manifest.repository?.url !==
  "git+https://github.com/open-covenant/covenant-timeline.git"
) {
  errors.push("repository URL does not match the publishing repository");
}

const escapedVersion = escapePattern(manifest.version);
const candidateHeading = new RegExp(
  `^### \`@covenant-org/timeline\` ${escapedVersion} candidate$`,
  "m",
);
const releaseHeading = new RegExp(
  `^## ${escapedVersion} - \\d{4}-\\d{2}-\\d{2}$`,
  "m",
);
const hasCandidateHeading = candidateHeading.test(changelog);
const hasReleaseHeading = releaseHeading.test(changelog);
if (tag && (!hasReleaseHeading || hasCandidateHeading)) {
  errors.push(
    `CHANGELOG.md has no finalized ${manifest.version} release entry`,
  );
}
if (!tag && hasCandidateHeading === hasReleaseHeading) {
  errors.push(
    `CHANGELOG.md must contain either the ${manifest.version} candidate entry or its finalized release entry, not both`,
  );
}
if (tag && tag !== expectedTag) {
  errors.push(`tag ${tag} does not match ${expectedTag}`);
}

if (
  tag &&
  (!hasOnlyExactInstalls(readme, "@covenant-org/timeline", manifest.version) ||
    !hasOnlyExactInstalls(
      gettingStarted,
      "@covenant-org/timeline",
      manifest.version,
    ) ||
    !hasOnlyExactInstalls(
      packageReadme,
      "@covenant-org/timeline",
      manifest.version,
    ) ||
    !hasOnlyExactExecs(readme, "@covenant-org/timeline", manifest.version) ||
    !hasOnlyExactExecs(
      gettingStarted,
      "@covenant-org/timeline",
      manifest.version,
    ) ||
    !hasOnlyExactExecs(
      packageReadme,
      "@covenant-org/timeline",
      manifest.version,
    ) ||
    describesCoreAsCandidate(readme, manifest.version) ||
    describesVersionAsSourceCandidate(gettingStarted, manifest.version) ||
    describesVersionAsSourceCandidate(packageReadme, manifest.version) ||
    hasStaleRecommendedCoreVersion(readme, manifest.version) ||
    hasStaleRecommendedCoreVersion(gettingStarted, manifest.version) ||
    hasStaleRecommendedCoreVersion(packageReadme, manifest.version))
) {
  errors.push(
    "tagged core release must update immutable onboarding copy from candidate to published",
  );
}

for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    errors.push(`production dependency ${name} must use an exact version`);
  }
}
await access("packages/prototype/LICENSE").catch(() => {
  errors.push("package LICENSE is missing");
});

if (!exactRecord(record(workflowConfig.permissions), { contents: "read" })) {
  errors.push("release workflow default permissions must be read-only");
}
if (
  !exactRecord(record(publishJob?.permissions), {
    attestations: "write",
    contents: "write",
    "id-token": "write",
  })
) {
  errors.push("release workflow publication permissions must be exact");
  errors.push("release workflow must support npm OIDC");
  errors.push("release workflow must retain durable release assets");
}
const publishStep = namedStep(publishSteps, "Publish to npm");
const publishEnvironment = record(publishStep?.env);
if (
  publishEnvironment?.NODE_AUTH_TOKEN !== "${{ secrets.NPM_TOKEN }}" ||
  !commandText(publishStep).includes("scripts/publish-npm-package.mjs")
) {
  errors.push("release workflow must support token fallback with provenance");
}
if (
  !publisher.includes('"publish"') ||
  !publisher.includes('"--provenance"') ||
  !publisher.includes("verifyExisting(recovered, expected, download)") ||
  !publisher.includes("published npm package differs from the release archive")
) {
  errors.push("release workflow must reconcile immutable npm publication");
}
const triggers = record(workflowConfig.on);
const pushTrigger = record(triggers?.push);
if (
  !exactKeys(triggers, ["push"]) ||
  !exactKeys(pushTrigger, ["tags"]) ||
  !Array.isArray(pushTrigger?.tags) ||
  pushTrigger.tags.length !== 1 ||
  pushTrigger.tags[0] !== "timeline-v*"
) {
  errors.push("release workflow tag scope is missing");
}
if (
  !publishSteps.some((step) =>
    commandText(step).includes('git cat-file -t "$GITHUB_REF_NAME"'),
  )
) {
  errors.push("release workflow must require an annotated tag");
}
const retainStep = namedStep(publishSteps, "Retain release assets");
const retainEnvironment = record(retainStep?.env);
const retainCommand = commandText(retainStep);
if (
  retainEnvironment?.GH_TOKEN !== "${{ github.token }}" ||
  !retainCommand.includes('gh release create "$GITHUB_REF_NAME"') ||
  !retainCommand.includes('gh release upload "$GITHUB_REF_NAME"') ||
  !retainCommand.includes("release_flags+=(--prerelease)") ||
  occurrences(retainCommand, "scripts/check-github-release-state.mjs") !== 2 ||
  !retainCommand.includes("--json isDraft,isPrerelease,tagName,assets") ||
  !retainCommand.includes("allow-missing") ||
  !retainCommand.includes("complete")
) {
  errors.push("release workflow must create retry-safe GitHub assets");
}
const artifactStep = namedStep(publishSteps, "Build reproducible package");
const artifactCommand = commandText(artifactStep);
if (
  !artifactCommand.includes('sha256sum "$(basename "$archive")"') ||
  artifactCommand.includes('sha256sum "$archive"')
) {
  errors.push("release checksum sidecar must use a portable archive filename");
}
if (
  publishSteps.indexOf(retainStep) < 0 ||
  publishSteps.indexOf(publishStep) < 0 ||
  publishSteps.indexOf(retainStep) > publishSteps.indexOf(publishStep)
) {
  errors.push("release assets must be durable before npm publication");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `release check passed (${manifest.name}@${manifest.version}, ${tag ?? "no tag"})`,
);

function parseWorkflow(source, parseErrors) {
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    parseErrors.push("release workflow must be valid YAML");
    return {};
  }
  try {
    return record(document.toJS({ maxAliasCount: 0 })) ?? {};
  } catch {
    parseErrors.push("release workflow must be closed and finite");
    return {};
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function steps(job) {
  return Array.isArray(job?.steps) ? job.steps.map(record).filter(Boolean) : [];
}

function namedStep(jobSteps, name) {
  return jobSteps.find((step) => step.name === name);
}

function commandText(step) {
  return typeof step?.run === "string" ? step.run : "";
}

function exactKeys(value, expected) {
  if (!value) return false;
  return (
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
  );
}

function exactRecord(value, expected) {
  if (!exactKeys(value, Object.keys(expected))) return false;
  return Object.entries(expected).every(([key, item]) => value[key] === item);
}

function hasOnlyExactInstalls(source, packageName, version) {
  const pattern = new RegExp(
    `npm install --save-exact ${escapePattern(packageName)}@([^\\s]+)`,
    "g",
  );
  const versions = [...source.matchAll(pattern)].map((match) => match[1]);
  return (
    versions.length > 0 &&
    versions.every((value) => value.replace(/[`.,;:]+$/u, "") === version)
  );
}

function hasOnlyExactExecs(source, packageName, version) {
  const pattern = new RegExp(
    `npm exec --package=${escapePattern(packageName)}@([^\\s]+)`,
    "g",
  );
  const versions = [...source.matchAll(pattern)].map((match) => match[1]);
  return (
    versions.length > 0 &&
    versions.every((value) => value.replace(/[`.,;:]+$/u, "") === version)
  );
}

function describesVersionAsSourceCandidate(source, version) {
  const label = version.replace(/^0\.0\.0-/u, "");
  const spec = `@covenant-org/timeline@${version}`;
  return [
    `${escapePattern(label)}[\\s\\S]{0,160}(?:source (?:release )?candidate|available from (?:a )?source checkout)`,
    `source (?:release )?candidate[\\s\\S]{0,80}${escapePattern(spec)}`,
  ].some((pattern) => new RegExp(pattern, "iu").test(source));
}

function describesCoreAsCandidate(source, version) {
  const spec = escapePattern(`@covenant-org/timeline@${version}`);
  return new RegExp(
    `${spec}[\\s\\S]{0,100}\\bcore[\\s\\S]{0,40}\\bcandidates?\\b`,
    "iu",
  ).test(source);
}

function hasStaleRecommendedCoreVersion(source, version) {
  const references = source.matchAll(
    /@covenant-org\/timeline@(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?)/gu,
  );
  for (const match of references) {
    if (match[1] === version) continue;
    const start = Math.max(0, match.index - 80);
    const end = Math.min(source.length, match.index + match[0].length + 240);
    if (/\brecommended entry point\b/iu.test(source.slice(start, end))) {
      return true;
    }
  }
  return false;
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
