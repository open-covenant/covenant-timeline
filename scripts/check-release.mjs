import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile("packages/prototype/package.json", "utf8"),
);
const changelog = await readFile("CHANGELOG.md", "utf8");
const workflow = await readFile(".github/workflows/release.yml", "utf8");
const refName = process.env.GITHUB_REF_NAME;
const tagArgument = process.argv[2];
const tag =
  tagArgument ?? (refName?.startsWith("timeline-v") ? refName : undefined);
const expectedTag = `timeline-v${manifest.version}`;
const errors = [];

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
if (!changelog.includes(`## ${manifest.version} - `)) {
  errors.push(`CHANGELOG.md has no ${manifest.version} release entry`);
}
if (tag && tag !== expectedTag) {
  errors.push(`tag ${tag} does not match ${expectedTag}`);
}
for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    errors.push(`production dependency ${name} must use an exact version`);
  }
}
await access("packages/prototype/LICENSE").catch(() => {
  errors.push("package LICENSE is missing");
});
if (!workflow.includes("id-token: write")) {
  errors.push("release workflow must support npm OIDC");
}
if (
  !workflow.includes("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}") ||
  !workflow.includes("--provenance")
) {
  errors.push("release workflow must support token fallback with provenance");
}
if (workflow.includes("workflow_dispatch:")) {
  errors.push("release workflow must be tag-triggered only");
}
if (!workflow.includes('git cat-file -t "$GITHUB_REF_NAME"')) {
  errors.push("release workflow must require an annotated tag");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `release check passed (${manifest.name}@${manifest.version}, ${tag ?? "no tag"})`,
);
