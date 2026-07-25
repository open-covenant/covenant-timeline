import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(process.argv[2] ?? "timeline.spdx.json");
const manifest = JSON.parse(
  await readFile("packages/prototype/package.json", "utf8"),
);
const sourceRevision =
  process.env.GITHUB_SHA ??
  run("git", ["rev-parse", "HEAD"], { cwd: root }).trim();
const epoch = Number.parseInt(
  process.env.SOURCE_DATE_EPOCH ??
    run("git", ["show", "-s", "--format=%ct", "HEAD"], { cwd: root }).trim(),
  10,
);
if (!Number.isSafeInteger(epoch) || epoch < 0) {
  throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer");
}

const dependencies = await Promise.all(
  Object.keys(manifest.dependencies ?? {})
    .sort()
    .map(async (name) => {
      const dependency = JSON.parse(
        await readFile(
          join(root, "packages/prototype/node_modules", name, "package.json"),
          "utf8",
        ),
      );
      return spdxPackage(
        dependency.name,
        dependency.version,
        dependency.license,
      );
    }),
);
const rootPackage = spdxPackage(
  manifest.name,
  manifest.version,
  manifest.license,
);
const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `${manifest.name}-${manifest.version}`,
  documentNamespace: `https://github.com/open-covenant/covenant-timeline/sbom/${sourceRevision}/${manifest.version}`,
  creationInfo: {
    created: new Date(epoch * 1_000).toISOString().replace(".000Z", "Z"),
    creators: ["Organization: Open Covenant"],
  },
  packages: [rootPackage, ...dependencies],
  relationships: [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: rootPackage.SPDXID,
    },
    ...dependencies.map((dependency) => ({
      spdxElementId: rootPackage.SPDXID,
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: dependency.SPDXID,
    })),
  ],
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`wrote SPDX SBOM for ${document.packages.length} packages`);

function spdxPackage(name, version, license) {
  return {
    name,
    SPDXID: `SPDXRef-Package-${name.replace(/[^A-Za-z0-9.-]/g, "-")}`,
    versionInfo: version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: license ?? "NOASSERTION",
    licenseDeclared: license ?? "NOASSERTION",
    copyrightText: "NOASSERTION",
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:npm/${purlName(name)}@${version}`,
      },
    ],
  };
}

function purlName(name) {
  if (!name.startsWith("@")) return encodeURIComponent(name);
  const [scope, packageName] = name.split("/");
  return `${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}`;
}

function run(executable, args, options) {
  const result = spawnSync(executable, args, {
    ...options,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${executable} failed`);
  }
  return result.stdout;
}
