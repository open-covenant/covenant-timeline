import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile("packages/prototype/package.json", "utf8"),
);
const changelog = await readFile("CHANGELOG.md", "utf8");
const workflow = await readFile(".github/workflows/release.yml", "utf8");
const publisher = await readFile("scripts/publish-npm-package.mjs", "utf8");
const readme = await readFile("README.md", "utf8");
const gettingStarted = await readFile("docs/getting-started.md", "utf8");
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
if (
  tag &&
  (!readme.includes(
    `npm install --save-exact @covenant-org/timeline@${manifest.version}`,
  ) ||
    readme.includes("The published `0.0.0-alpha.2` package contains") ||
    readme.includes("The `0.0.0-alpha.2` package contains the") ||
    readme.includes(
      "[`@covenant-org/timeline@0.0.0-alpha.2`](https://www.npmjs.com/package/@covenant-org/timeline/v/0.0.0-alpha.2)\nis the recommended entry point",
    ) ||
    readme.includes("alpha.3 core and alpha.1 MCP release candidates") ||
    !gettingStarted.includes(
      `npm install --save-exact @covenant-org/timeline@${manifest.version}`,
    ) ||
    gettingStarted.includes("The published alpha.2 package contains") ||
    gettingStarted.includes("source alpha.3 release candidate"))
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
if (!workflow.includes("id-token: write")) {
  errors.push("release workflow must support npm OIDC");
}
if (!workflow.includes("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}")) {
  errors.push("release workflow must support token fallback with provenance");
}
if (
  !workflow.includes("scripts/publish-npm-package.mjs") ||
  !publisher.includes('"publish"') ||
  !publisher.includes('"--provenance"') ||
  !publisher.includes("verifyExisting(recovered, expected, download)") ||
  !publisher.includes("published npm package differs from the release archive")
) {
  errors.push("release workflow must reconcile immutable npm publication");
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
