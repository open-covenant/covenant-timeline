import {
  assertArchiveEntries,
  assertArchiveFiles,
  parseTarListings,
} from "./package-archive-contents.mjs";

const alpha2Modules = [
  "archive",
  "cli",
  "contract",
  "document",
  "identity",
  "index",
  "json",
  "limits",
  "profiles/github",
  "profiles/index",
  "report",
  "run",
  "v0alpha2/contract",
  "v0alpha2/document",
  "v0alpha2/index",
  "v0alpha2/migrate",
  "v0alpha2/report",
  "v0alpha2/run",
  "v0alpha2/validation",
  "v0alpha3/document",
  "v0alpha3/index",
  "v0alpha3/kernel",
  "v0alpha3/types",
];
const modules = [...alpha2Modules, "v0alpha3/model-proposal"];
const outputs = ["d.ts", "d.ts.map", "js", "js.map"];

export const expectedCoreArchiveFiles = archiveFiles(modules);
export const expectedCoreAlpha2ArchiveFiles = archiveFiles(alpha2Modules);

export const maxCoreArchiveUnpackedBytes = 8 * 1024 * 1024;

const options = {
  expectedFiles: expectedCoreArchiveFiles,
  label: "core",
  maxUnpackedBytes: maxCoreArchiveUnpackedBytes,
};

export function assertCoreArchiveFiles(files) {
  return assertArchiveFiles(files, options);
}

export function parseCoreTarListings(namesText, verboseText) {
  return parseTarListings(namesText, verboseText, "core");
}

export function assertCoreArchiveEntries(entries, overrides = {}) {
  return assertArchiveEntries(entries, { ...options, ...overrides });
}

export function coreArchiveFilesForVersion(version) {
  if (version === "0.0.0-alpha.2") return expectedCoreAlpha2ArchiveFiles;
  if (version === "0.0.0-alpha.3") return expectedCoreArchiveFiles;
  throw new Error(`unsupported core archive profile ${version}`);
}

function archiveFiles(moduleNames) {
  return [
    "LICENSE",
    "README.md",
    "package.json",
    ...moduleNames.flatMap((module) =>
      outputs.map((extension) => `dist/${module}.${extension}`),
    ),
  ].map((file) => `package/${file}`);
}
