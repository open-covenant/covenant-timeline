import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile("packages/prototype/package.json", "utf8"),
);
const changelog = await readFile("CHANGELOG.md", "utf8");
const refName = process.env.GITHUB_REF_NAME;
const tag =
  process.argv.find((argument) => argument.startsWith("timeline-v")) ??
  (refName?.startsWith("timeline-v") ? refName : undefined);
const expectedTag = `timeline-v${manifest.version}`;
const errors = [];

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

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `release check passed (${manifest.name}@${manifest.version}, ${tag ?? "no tag"})`,
);
