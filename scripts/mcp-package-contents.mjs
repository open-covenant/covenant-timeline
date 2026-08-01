import {
  assertArchiveEntries,
  assertArchiveFiles,
  parseTarListings,
} from "./package-archive-contents.mjs";

export const expectedMcpAlpha1ArchiveFiles = [
  "LICENSE",
  "README.md",
  "dist/cli.d.ts",
  "dist/cli.d.ts.map",
  "dist/cli.js",
  "dist/cli.js.map",
  "dist/constants.d.ts",
  "dist/constants.d.ts.map",
  "dist/constants.js",
  "dist/constants.js.map",
  "dist/errors.d.ts",
  "dist/errors.d.ts.map",
  "dist/errors.js",
  "dist/errors.js.map",
  "dist/index.d.ts",
  "dist/index.d.ts.map",
  "dist/index.js",
  "dist/index.js.map",
  "dist/model-admission.d.ts",
  "dist/model-admission.d.ts.map",
  "dist/model-admission.js",
  "dist/model-admission.js.map",
  "dist/schemas.d.ts",
  "dist/schemas.d.ts.map",
  "dist/schemas.js",
  "dist/schemas.js.map",
  "dist/server.d.ts",
  "dist/server.d.ts.map",
  "dist/server.js",
  "dist/server.js.map",
  "dist/store.d.ts",
  "dist/store.d.ts.map",
  "dist/store.js",
  "dist/store.js.map",
  "dist/types.d.ts",
  "dist/types.d.ts.map",
  "dist/types.js",
  "dist/types.js.map",
  "package.json",
].map((file) => `package/${file}`);

export const expectedMcpArchiveFiles = expectedMcpAlpha1ArchiveFiles;

export const maxMcpArchiveUnpackedBytes = 8 * 1024 * 1024;

const options = {
  expectedFiles: expectedMcpArchiveFiles,
  label: "MCP",
  maxUnpackedBytes: maxMcpArchiveUnpackedBytes,
};

export function assertMcpArchiveFiles(files) {
  return assertArchiveFiles(files, options);
}

export function parseMcpTarListings(namesText, verboseText) {
  return parseTarListings(namesText, verboseText, "MCP");
}

export function assertMcpArchiveEntries(entries, overrides = {}) {
  return assertArchiveEntries(entries, { ...options, ...overrides });
}

export function mcpArchiveFilesForVersion(version) {
  if (version === "0.0.0-alpha.1") return expectedMcpAlpha1ArchiveFiles;
  throw new Error(`unsupported MCP archive profile ${version}`);
}
