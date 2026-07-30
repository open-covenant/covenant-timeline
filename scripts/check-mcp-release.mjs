import { access, readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

const manifest = JSON.parse(
  await readFile("packages/mcp-server/package.json", "utf8"),
);
const changelog = await readFile("CHANGELOG.md", "utf8");
const workflow = await readFile(".github/workflows/release-mcp.yml", "utf8");
const errors = [];
const workflowConfig = parseWorkflow(workflow, errors);
const jobs = record(workflowConfig.jobs);
const registryJob = record(jobs?.["registry-compatibility"]);
const publishJob = record(jobs?.publish);
const registrySteps = steps(registryJob);
const publishSteps = steps(publishJob);
const refName = process.env.GITHUB_REF_NAME;
const tagArgument = process.argv[2];
const tag =
  tagArgument ?? (refName?.startsWith("timeline-mcp-v") ? refName : undefined);
const expectedTag = `timeline-mcp-v${manifest.version}`;

if (process.argv.length > 3) errors.push("unexpected release check arguments");
if (manifest.name !== "@covenant-org/timeline-mcp") {
  errors.push("unexpected MCP package name");
}
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(manifest.version)) {
  errors.push(`unsupported MCP package version ${manifest.version}`);
}
if (manifest.private === true) errors.push("MCP package must be public");
if (manifest.publishConfig?.access !== "public") {
  errors.push("MCP publishConfig.access must be public");
}
if (
  manifest.repository?.url !==
    "git+https://github.com/open-covenant/covenant-timeline.git" ||
  manifest.repository?.directory !== "packages/mcp-server"
) {
  errors.push("MCP repository metadata does not match the publishing source");
}
const escapedVersion = manifest.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const releaseHeading = new RegExp(
  `^## @covenant-org/timeline-mcp ${escapedVersion} - \\d{4}-\\d{2}-\\d{2}$`,
  "m",
);
if (tag && !releaseHeading.test(changelog)) {
  errors.push(`CHANGELOG.md has no MCP ${manifest.version} release entry`);
}
if (tag && tag !== expectedTag) {
  errors.push(`tag ${tag} does not match ${expectedTag}`);
}
for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
  const exact =
    /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(version) ||
    /^workspace:\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(version);
  if (!exact) {
    errors.push(`MCP production dependency ${name} must use an exact version`);
  }
}
if (
  manifest.dependencies?.["@covenant-org/timeline"] !==
  "workspace:0.0.0-alpha.2"
) {
  errors.push("MCP package must pin the reviewed Timeline alpha");
}
await access("packages/mcp-server/LICENSE").catch(() => {
  errors.push("MCP package LICENSE is missing");
});
await access("packages/mcp-server/README.md").catch(() => {
  errors.push("MCP package README is missing");
});
if (!exactRecord(record(workflowConfig.permissions), { contents: "read" })) {
  errors.push("MCP release workflow default permissions must be read-only");
}
if (
  !exactRecord(record(publishJob?.permissions), {
    attestations: "write",
    contents: "write",
    "id-token": "write",
  })
) {
  errors.push("MCP release workflow must support npm OIDC");
  errors.push("MCP release workflow must retain durable release assets");
}
const publishStep = namedStep(publishSteps, "Publish to npm");
const publishEnvironment = record(publishStep?.env);
if (
  publishEnvironment?.NODE_AUTH_TOKEN !== "${{ secrets.NPM_TOKEN }}" ||
  !commandText(publishStep).includes("--provenance")
) {
  errors.push(
    "MCP release workflow must support token fallback with provenance",
  );
}
const triggers = record(workflowConfig.on);
const pushTrigger = record(triggers?.push);
if (
  !exactKeys(triggers, ["push"]) ||
  !exactKeys(pushTrigger, ["tags"]) ||
  !Array.isArray(pushTrigger?.tags) ||
  pushTrigger.tags.length !== 1 ||
  pushTrigger.tags[0] !== "timeline-mcp-v*"
) {
  errors.push("MCP release workflow tag scope is missing");
}
if (
  ![...registrySteps, ...publishSteps].some((step) =>
    commandText(step).includes('git cat-file -t "$GITHUB_REF_NAME"'),
  )
) {
  errors.push("MCP release workflow must require an annotated tag");
}
const retainStep = namedStep(publishSteps, "Retain release assets");
if (
  !commandText(retainStep).includes('gh release create "$GITHUB_REF_NAME"') ||
  !commandText(retainStep).includes('gh release upload "$GITHUB_REF_NAME"') ||
  !commandText(retainStep).includes("release_flags+=(--prerelease)")
) {
  errors.push("MCP release workflow must create retry-safe GitHub assets");
}
if (
  publishSteps.indexOf(retainStep) < 0 ||
  publishSteps.indexOf(publishStep) < 0 ||
  publishSteps.indexOf(retainStep) > publishSteps.indexOf(publishStep)
) {
  errors.push("MCP release assets must be durable before npm publication");
}
if (!registryJob) {
  errors.push(
    "MCP registry dependency verification must use a separate unprivileged job",
  );
}
const registryGuard = namedStep(
  registrySteps,
  "Verify registry dependency graph",
);
if (
  !registryGuard ||
  !commandText(registryGuard).includes("scripts/check-mcp-registry-install.mjs")
) {
  errors.push("MCP release must verify its registry dependency graph");
}
if (
  registryJob &&
  (!exactRecord(record(registryJob.permissions), { contents: "read" }) ||
    registryJob.environment !== undefined ||
    JSON.stringify(registryJob).includes("${{ secrets."))
) {
  errors.push(
    "MCP registry dependency verification job must not receive publication credentials",
  );
}
if (publishJob?.needs !== "registry-compatibility") {
  errors.push("MCP publication must depend on registry verification");
}
if (
  publishSteps.some(
    (step) =>
      step.name === "Verify registry dependency graph" ||
      commandText(step).includes("scripts/check-mcp-registry-install.mjs"),
  )
) {
  errors.push(
    "MCP registry dependency verification must not run in the publication job",
  );
}
const registryCheckout = registrySteps.find((step) =>
  String(step.uses ?? "").startsWith("actions/checkout@"),
);
if (record(registryCheckout?.with)?.["persist-credentials"] !== false) {
  errors.push(
    "MCP registry dependency verification must not persist checkout credentials",
  );
}
const transferActions = [
  "actions/upload-artifact@",
  "actions/download-artifact@",
  "actions/cache@",
];
if (
  registryJob?.outputs !== undefined ||
  registrySteps.some((step) =>
    transferActions.some((action) =>
      String(step.uses ?? "").startsWith(action),
    ),
  ) ||
  publishSteps.some((step) =>
    ["actions/download-artifact@", "actions/cache@"].some((action) =>
      String(step.uses ?? "").startsWith(action),
    ),
  ) ||
  JSON.stringify(publishJob ?? {}).includes(
    "needs.registry-compatibility.outputs",
  )
) {
  errors.push(
    "MCP registry compatibility artifacts must remain disposable and isolated",
  );
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `MCP release check passed (${manifest.name}@${manifest.version}, ${tag ?? "no tag"})`,
);

function parseWorkflow(source, parseErrors) {
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    parseErrors.push("MCP release workflow must be valid YAML");
    return {};
  }
  try {
    return record(document.toJS({ maxAliasCount: 0 })) ?? {};
  } catch {
    parseErrors.push("MCP release workflow must be closed and finite");
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
