import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageDirectory = join(root, "packages/prototype");
const packageJson = JSON.parse(
  await readFile(join(packageDirectory, "package.json"), "utf8"),
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "timeline-package-"));

try {
  run(command("pnpm"), ["pack", "--pack-destination", temporaryDirectory], {
    cwd: packageDirectory,
  });
  const archives = (await readdir(temporaryDirectory)).filter((file) =>
    file.endsWith(".tgz"),
  );
  if (archives.length !== 1) {
    throw new Error(
      `expected one package archive, received ${archives.length}`,
    );
  }

  await writeFile(
    join(temporaryDirectory, "package.json"),
    JSON.stringify({ private: true }),
  );
  run(
    command("npm"),
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(temporaryDirectory, archives[0]),
    ],
    { cwd: temporaryDirectory },
  );

  const installed = join(
    temporaryDirectory,
    "node_modules",
    "@covenant-org",
    "timeline",
  );
  await Promise.all(
    [
      "LICENSE",
      "README.md",
      "dist/index.js",
      "dist/index.js.map",
      "dist/index.d.ts",
      "dist/index.d.ts.map",
    ].map((file) => access(join(installed, file))),
  );

  const version = run(
    process.execPath,
    [join(installed, "dist/cli.js"), "--version"],
    { cwd: temporaryDirectory },
  ).trim();
  if (version !== packageJson.version) {
    throw new Error(
      `installed CLI version ${version} does not match ${packageJson.version}`,
    );
  }

  const smoke = run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'import { contentDigest, parseJson } from "@covenant-org/timeline";',
        "const parsed = parseJson('{\"ready\":true}');",
        "process.stdout.write(contentDigest(parsed));",
      ].join(""),
    ],
    { cwd: temporaryDirectory },
  ).trim();
  if (
    smoke !==
    "sha256:b342fc286d0216cc212e0d7ba234894e2e7283ddf14f959adf0fe7fd5924308a"
  ) {
    throw new Error(`installed package digest smoke changed: ${smoke}`);
  }
  console.log(`package check passed (${archives[0]}, installed CLI and API)`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(executable, args, options) {
  const result = spawnSync(executable, args, {
    ...options,
    encoding: "utf8",
    env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
  });
  if (result.status !== 0) {
    throw new Error(
      [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    );
  }
  return result.stdout;
}
