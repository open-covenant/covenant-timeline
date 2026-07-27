import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(process.argv[2] ?? "timeline.spdx.json");
const packageDirectory = resolve(root, process.argv[3] ?? "packages/prototype");
const manifest = JSON.parse(
  await readFile(join(packageDirectory, "package.json"), "utf8"),
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

const listing = JSON.parse(
  run(
    command("pnpm"),
    [
      "--filter",
      manifest.name,
      "list",
      "--prod",
      "--json",
      "--depth",
      "Infinity",
    ],
    { cwd: root },
  ),
);
const listedRoot = listing.find(
  (entry) => resolve(entry.path) === packageDirectory,
);
if (!listedRoot) {
  throw new Error(
    `pnpm did not resolve the production graph for ${manifest.name}`,
  );
}
const graph = await buildProductionGraph(listedRoot);
const rootPackage = graph.packages.get(packageKey(manifest));
if (!rootPackage) throw new Error("SBOM root package is missing");
const dependencies = [...graph.packages.entries()]
  .filter(([key]) => key !== packageKey(manifest))
  .map(([, value]) => value)
  .sort(comparePackages);
const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `${manifest.name}-${manifest.version}`,
  documentNamespace: sbomNamespace(
    sourceRevision,
    manifest.version,
    packageDirectory,
  ),
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
    ...[...graph.relationships].sort().map((relationship) => {
      const [source, target] = relationship.split("\u0000");
      return {
        spdxElementId: graph.packages.get(source).SPDXID,
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: graph.packages.get(target).SPDXID,
      };
    }),
  ],
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`wrote SPDX SBOM for ${document.packages.length} packages`);

function spdxPackage(name, version, license) {
  return {
    name,
    SPDXID: `SPDXRef-Package-${`${name}-${version}`.replace(/[^A-Za-z0-9.-]/g, "-")}`,
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

async function buildProductionGraph(rootNode) {
  const packages = new Map();
  const relationships = new Set();
  const traversed = new Set();

  async function visit(node, parentKey) {
    if (typeof node.path !== "string") {
      throw new Error("production dependency has no installed path");
    }
    const dependency = JSON.parse(
      await readFile(join(node.path, "package.json"), "utf8"),
    );
    const key = packageKey(dependency);
    if (parentKey) relationships.add(`${parentKey}\u0000${key}`);
    if (!packages.has(key)) {
      packages.set(
        key,
        spdxPackage(dependency.name, dependency.version, dependency.license),
      );
    }
    if (traversed.has(key)) return;
    traversed.add(key);

    for (const child of Object.values(node.dependencies ?? {}).sort(
      compareListedDependencies,
    )) {
      await visit(child, key);
    }
  }

  await visit(rootNode);
  return { packages, relationships };
}

function packageKey(manifest) {
  return `${manifest.name}@${manifest.version}`;
}

function comparePackages(left, right) {
  return (
    left.name.localeCompare(right.name) ||
    left.versionInfo.localeCompare(right.versionInfo)
  );
}

function compareListedDependencies(left, right) {
  return (
    String(left.from).localeCompare(String(right.from)) ||
    String(left.version).localeCompare(String(right.version))
  );
}

function purlName(name) {
  if (!name.startsWith("@")) return encodeURIComponent(name);
  const [scope, packageName] = name.split("/");
  return `${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}`;
}

function sbomNamespace(sourceRevision, version, directory) {
  const base = `https://github.com/open-covenant/covenant-timeline/sbom/${sourceRevision}/${version}`;
  return directory === join(root, "packages/prototype")
    ? base
    : `${base}/${basename(directory)}`;
}

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(executable, args, options) {
  const result = spawnSync(executable, args, {
    ...options,
    encoding: "utf8",
    shell: process.platform === "win32" && executable.endsWith(".cmd"),
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${executable} failed`);
  }
  return result.stdout;
}
