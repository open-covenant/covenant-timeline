import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile("packages/mcp-server/package.json", "utf8"),
);
const changelog = await readFile("CHANGELOG.md", "utf8");
const workflow = await readFile(".github/workflows/release-mcp.yml", "utf8");
const refName = process.env.GITHUB_REF_NAME;
const tagArgument = process.argv[2];
const tag =
  tagArgument ?? (refName?.startsWith("timeline-mcp-v") ? refName : undefined);
const expectedTag = `timeline-mcp-v${manifest.version}`;
const errors = [];

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
if (!releaseHeading.test(changelog)) {
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
if (!workflow.includes("id-token: write")) {
  errors.push("MCP release workflow must support npm OIDC");
}
if (!workflow.includes("contents: write")) {
  errors.push("MCP release workflow must retain durable release assets");
}
if (
  !workflow.includes("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}") ||
  !workflow.includes("--provenance")
) {
  errors.push(
    "MCP release workflow must support token fallback with provenance",
  );
}
if (!workflow.includes('"timeline-mcp-v*"')) {
  errors.push("MCP release workflow tag scope is missing");
}
if (workflow.includes("workflow_dispatch:")) {
  errors.push("MCP release workflow must be tag-triggered only");
}
if (!workflow.includes('git cat-file -t "$GITHUB_REF_NAME"')) {
  errors.push("MCP release workflow must require an annotated tag");
}
if (
  !workflow.includes('gh release create "$GITHUB_REF_NAME"') ||
  !workflow.includes('gh release upload "$GITHUB_REF_NAME"') ||
  !workflow.includes("release_flags+=(--prerelease)")
) {
  errors.push("MCP release workflow must create retry-safe GitHub assets");
}
if (
  workflow.indexOf("- name: Retain release assets") >
  workflow.indexOf("- name: Publish to npm")
) {
  errors.push("MCP release assets must be durable before npm publication");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `MCP release check passed (${manifest.name}@${manifest.version}, ${tag ?? "no tag"})`,
);
