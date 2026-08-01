#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createIsolatedEnvironment } from "./isolated-environment.mjs";

const [archiveArgument, ...unexpected] = process.argv.slice(2);
if (!archiveArgument || unexpected.length > 0) {
  throw new Error("usage: check-mcp-registry-install.mjs <mcp-package.tgz>");
}

const archive = resolve(archiveArgument);
const archiveStat = await lstat(archive);
if (
  !archiveStat.isFile() ||
  archiveStat.isSymbolicLink() ||
  !archive.endsWith(".tgz")
) {
  throw new Error("MCP archive must be a regular .tgz file");
}

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(join(root, "packages/mcp-server/package.json"), "utf8"),
);
const timelineVersion = String(
  manifest.dependencies?.["@covenant-org/timeline"] ?? "",
).replace(/^workspace:/, "");
const mcpProtocolVersion =
  manifest.dependencies?.["@modelcontextprotocol/server"];
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(timelineVersion)) {
  throw new Error("MCP package must pin an exact Timeline version");
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(mcpProtocolVersion ?? "")) {
  throw new Error("MCP package must pin an exact protocol version");
}

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "timeline-mcp-registry-install-"),
);
const installDirectory = join(temporaryDirectory, "install");
const dataDirectory = join(temporaryDirectory, "data");
const homeDirectory = join(temporaryDirectory, "home");
const processTempDirectory = join(temporaryDirectory, "tmp");

try {
  await Promise.all([
    mkdir(installDirectory),
    mkdir(dataDirectory),
    mkdir(homeDirectory),
    mkdir(processTempDirectory),
  ]);
  const isolatedEnvironment = createIsolatedEnvironment(process.env, {
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
    TMPDIR: processTempDirectory,
    TMP: processTempDirectory,
    TEMP: processTempDirectory,
  });
  const runIsolated = (executable, args, cwd = installDirectory) =>
    run(executable, args, { cwd, env: isolatedEnvironment });
  await writeFile(
    join(installDirectory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const npmrc = join(temporaryDirectory, "npmrc");
  const globalNpmrc = join(temporaryDirectory, "global-npmrc");
  await writeFile(
    npmrc,
    [
      "registry=https://registry.npmjs.org/",
      "@covenant-org:registry=https://registry.npmjs.org/",
      "@modelcontextprotocol:registry=https://registry.npmjs.org/",
      "",
    ].join("\n"),
  );
  await writeFile(globalNpmrc, "");

  run(
    command("npm"),
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--registry=https://registry.npmjs.org/",
      `@modelcontextprotocol/client@${mcpProtocolVersion}`,
      archive,
    ],
    {
      cwd: installDirectory,
      env: {
        ...isolatedEnvironment,
        NPM_CONFIG_USERCONFIG: npmrc,
        NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
        NPM_CONFIG_CACHE: join(temporaryDirectory, "npm-cache"),
        NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
      },
    },
  );

  const installedMcp = join(
    installDirectory,
    "node_modules",
    "@covenant-org",
    "timeline-mcp",
  );
  const installedMcpManifest = JSON.parse(
    await readFile(join(installedMcp, "package.json"), "utf8"),
  );
  if (
    installedMcpManifest.name !== manifest.name ||
    installedMcpManifest.version !== manifest.version
  ) {
    throw new Error("installed MCP archive identity does not match the source");
  }
  if (
    installedMcpManifest.dependencies?.["@covenant-org/timeline"] !==
    timelineVersion
  ) {
    throw new Error("installed MCP archive does not pin the reviewed Timeline");
  }
  if (
    installedMcpManifest.dependencies?.["@modelcontextprotocol/server"] !==
    mcpProtocolVersion
  ) {
    throw new Error("installed MCP archive changed the protocol dependency");
  }
  if (
    Object.values(installedMcpManifest.dependencies ?? {}).some((version) =>
      String(version).startsWith("workspace:"),
    )
  ) {
    throw new Error("installed MCP archive retained a workspace dependency");
  }

  const installedTimeline = join(
    installDirectory,
    "node_modules",
    "@covenant-org",
    "timeline",
  );
  const installedManifest = JSON.parse(
    await readFile(join(installedTimeline, "package.json"), "utf8"),
  );
  if (installedManifest.version !== timelineVersion) {
    throw new Error(
      `registry installed Timeline ${installedManifest.version}, expected ${timelineVersion}`,
    );
  }
  const exportProbe = join(temporaryDirectory, "check-exports.mjs");
  await writeFile(
    exportProbe,
    [
      `const timeline = await import(${JSON.stringify(
        pathToFileURL(join(installedTimeline, "dist/index.js")).href,
      )});`,
      "for (const name of [",
      '  "compileTemporalModelProposalV1",',
      '  "verifyTemporalModelProposalCandidateV1",',
      "]) {",
      '  if (typeof timeline[name] !== "function") {',
      `    throw new Error(\`registry Timeline ${timelineVersion} does not export \${name}\`);`,
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  runIsolated(process.execPath, [exportProbe]);

  const executable = join(
    installDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "timeline-mcp.cmd" : "timeline-mcp",
  );
  const version = runIsolated(executable, ["--version"]).trim();
  if (version !== manifest.version) {
    throw new Error(
      `installed MCP CLI version ${version} does not match ${manifest.version}`,
    );
  }

  const fixture = await loadCorrectionFixture();
  await writeFile(
    join(installDirectory, "fixture.json"),
    JSON.stringify(fixture),
  );
  await copyFile(
    join(root, "scripts/mcp-installed-smoke.mjs"),
    join(installDirectory, "smoke.mjs"),
  );
  const smoke = JSON.parse(
    runIsolated(process.execPath, [
      join(installDirectory, "smoke.mjs"),
      dataDirectory,
    ]).trim(),
  );
  if (
    smoke.before !== -100 ||
    smoke.after !== 100 ||
    smoke.events !== fixture.events.length ||
    smoke.proofs !== true ||
    smoke.proposal?.atomic !== true ||
    smoke.proposal?.events !== 2 ||
    smoke.proposal?.minimum !== 100 ||
    smoke.proposal?.maximum !== 100 ||
    smoke.proposal?.previewReadOnly !== true ||
    smoke.proposal?.auditBound !== true ||
    smoke.proposal?.sourceTextAbsent !== true ||
    smoke.proposal?.proof !== true ||
    smoke.stderr !== ""
  ) {
    throw new Error(
      `registry-installed MCP smoke changed: ${JSON.stringify(smoke)}`,
    );
  }

  console.log(
    `MCP registry install passed (${basename(archive)}, Timeline ${timelineVersion}, restart, proposal preview/admission audit, and proof smoke)`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

async function loadCorrectionFixture() {
  const run = JSON.parse(
    await readFile(join(root, "examples/correction-replay/run.json"), "utf8"),
  );
  const before = JSON.parse(
    await readFile(
      join(root, "examples/correction-replay/queries/before.json"),
      "utf8",
    ),
  );
  const after = JSON.parse(
    await readFile(
      join(root, "examples/correction-replay/queries/after.json"),
      "utf8",
    ),
  );

  return {
    contract: run.contract,
    events: run.events.map(
      ({ schema: _schema, sequence: _sequence, ...event }) => event,
    ),
    before: omitSchema(before),
    after: omitSchema(after),
  };
}

function omitSchema({ schema: _schema, ...value }) {
  return value;
}

function run(executable, args, { cwd, env }) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env,
    shell: process.platform === "win32" && executable.endsWith(".cmd"),
  });
  if (result.status !== 0) {
    throw new Error(
      [result.error?.message, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim(),
    );
  }
  return result.stdout;
}
