import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertMcpArchiveEntries,
  parseMcpTarListings,
} from "./mcp-package-contents.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mcpDirectory = join(root, "packages/mcp-server");
const mcpManifest = JSON.parse(
  await readFile(join(mcpDirectory, "package.json"), "utf8"),
);
const coreVersion = mcpManifest.dependencies["@covenant-org/timeline"].replace(
  /^workspace:/,
  "",
);
const mcpProtocolVersion =
  mcpManifest.dependencies["@modelcontextprotocol/server"];
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "timeline-mcp-package-"),
);
const archiveDirectory = join(temporaryDirectory, "archives");
const installDirectory = join(temporaryDirectory, "install");
const dataDirectory = join(temporaryDirectory, "data");

try {
  await Promise.all([
    mkdir(archiveDirectory),
    mkdir(installDirectory),
    mkdir(dataDirectory),
  ]);

  run(command("pnpm"), ["pack", "--pack-destination", archiveDirectory], {
    cwd: mcpDirectory,
  });

  const archives = (await readdir(archiveDirectory))
    .filter((file) => file.endsWith(".tgz"))
    .sort();
  const mcpArchive = onlyMatch(
    archives,
    /^covenant-org-timeline-mcp-\d.*\.tgz$/,
    "MCP package",
  );
  checkArchiveContents(join(archiveDirectory, mcpArchive));

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
  const npmEnvironment = sanitizedNpmEnvironment({
    NPM_CONFIG_USERCONFIG: npmrc,
    NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
    NPM_CONFIG_CACHE: join(temporaryDirectory, "npm-cache"),
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
  });
  run(
    command("npm"),
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmjs.org/",
      `@modelcontextprotocol/client@${mcpProtocolVersion}`,
      `@covenant-org/timeline@${coreVersion}`,
      join(archiveDirectory, mcpArchive),
    ],
    {
      cwd: installDirectory,
      env: npmEnvironment,
      inheritEnv: false,
    },
  );

  const installed = join(
    installDirectory,
    "node_modules",
    "@covenant-org",
    "timeline-mcp",
  );
  await Promise.all(
    [
      "LICENSE",
      "README.md",
      "dist/cli.js",
      "dist/index.js",
      "dist/index.js.map",
      "dist/index.d.ts",
      "dist/index.d.ts.map",
    ].map((file) => access(join(installed, file))),
  );

  const installedManifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  if (
    installedManifest.dependencies?.["@covenant-org/timeline"] !== coreVersion
  ) {
    throw new Error("packed MCP package did not pin the Timeline dependency");
  }
  if (
    Object.values(installedManifest.dependencies ?? {}).some((version) =>
      String(version).startsWith("workspace:"),
    )
  ) {
    throw new Error("packed MCP package retained a workspace dependency");
  }

  const executable = join(
    installDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "timeline-mcp.cmd" : "timeline-mcp",
  );
  const version = run(executable, ["--version"], {
    cwd: installDirectory,
  }).trim();
  if (version !== mcpManifest.version) {
    throw new Error(
      `installed MCP CLI version ${version} does not match ${mcpManifest.version}`,
    );
  }

  const demo = JSON.parse(
    run(executable, ["--demo"], { cwd: installDirectory }).trim(),
  );
  if (
    demo.schema !== "covenant.timeline.mcp-demo.v1" ||
    demo.eventCount !== 6 ||
    demo.reloadedFromDisk !== true ||
    demo.before?.conclusion?.result?.minimum !== -100 ||
    demo.before?.verified !== true ||
    demo.after?.conclusion?.result?.minimum !== 100 ||
    demo.after?.verified !== true
  ) {
    throw new Error("installed MCP correction demo changed");
  }
  const timeline = await import(
    pathToFileURL(
      join(
        installDirectory,
        "node_modules/@covenant-org/timeline/dist/index.js",
      ),
    ).href
  );
  const demoRun = timeline.parseRunDocumentV0Alpha3(demo.run);
  for (const cut of [demo.before, demo.after]) {
    const query = timeline.parseQueryV0Alpha3(cut.query, demoRun);
    if (
      !timeline.verifyTemporalConclusionV0Alpha3(demoRun, query, cut.conclusion)
    ) {
      throw new Error("installed MCP demo receipt did not verify");
    }
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
    run(
      process.execPath,
      [join(installDirectory, "smoke.mjs"), dataDirectory],
      { cwd: installDirectory },
    ).trim(),
  );
  if (
    smoke.before !== -100 ||
    smoke.after !== 100 ||
    smoke.events !== fixture.events.length ||
    smoke.proofs !== true ||
    smoke.stderr !== ""
  ) {
    throw new Error(`installed MCP package smoke changed: ${smoke}`);
  }

  console.log(
    `MCP package check passed (${mcpArchive}, registry Timeline ${coreVersion}, installed demo, stdio restart, correction replay, and proof verification)`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
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
    events: run.events.map(({ schema, sequence, ...event }) => event),
    before: omitSchema(before),
    after: omitSchema(after),
  };
}

function omitSchema({ schema, ...value }) {
  return value;
}

function onlyMatch(files, pattern, label) {
  const matches = files.filter((file) => pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(
      `expected one ${label} archive, received ${matches.length}`,
    );
  }
  return matches[0];
}

function checkArchiveContents(path) {
  assertMcpArchiveEntries(
    parseMcpTarListings(
      run("tar", ["-tzf", path], { env: tarEnvironment() }),
      run("tar", ["-tvzf", path], { env: tarEnvironment() }),
    ),
  );
}

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function sanitizedNpmEnvironment(overrides) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /^npm_config_/i.test(key) ||
      /^(?:node_auth_token|npm_token)$/i.test(key) ||
      /(?:^|_)AUTH_?TOKEN$/i.test(key) ||
      /_AUTHTOKEN$/i.test(key)
    ) {
      delete environment[key];
    }
  }
  Object.assign(environment, overrides);
  environment.NO_UPDATE_NOTIFIER = "1";
  return environment;
}

function tarEnvironment() {
  return { ...process.env, LANG: "C", LC_ALL: "C" };
}

function run(executable, args, options = {}) {
  const { env, inheritEnv = true, ...spawnOptions } = options;
  const result = spawnSync(executable, args, {
    ...spawnOptions,
    encoding: "utf8",
    env: inheritEnv ? { ...process.env, ...env, NO_UPDATE_NOTIFIER: "1" } : env,
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
