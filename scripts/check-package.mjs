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
        'import { contentDigest, createPortableRunArchive, evaluateRunDocumentV0Alpha2, parseJson, reasonTemporalQueryV0Alpha3, verifyGithubEnvelope, verifyTemporalConclusionV0Alpha3 } from "@covenant-org/timeline";',
        "const parsed = parseJson('{\"ready\":true}');",
        "const run={schema:'covenant.timeline.run.v0alpha2',runId:'package.smoke',contract:{schema:'covenant.timeline.contract.v0alpha2',id:'package.smoke',subject:{kind:'repository',id:'example/service'},checkpoints:[{id:'complete',requirements:['ready'],policy:{profile:'example.profile.v1',policyRef:'example.policy.v1',policyDigest:'sha256:'+'a'.repeat(64)}}]},events:[]};",
        "const report=evaluateRunDocumentV0Alpha2(run);",
        "const archive=createPortableRunArchive(run);",
        "const temporalRun={schema:'covenant.timeline.run.v0alpha3',contract:{schema:'covenant.timeline.contract.v0alpha3',id:'package.temporal',subject:{kind:'workflow',id:'example'},axes:[{id:'elapsed',kind:'metric',unit:'tick',origin:'example.origin'}],contexts:[{id:'actual',mode:'actual'}]},events:[{schema:'covenant.timeline.event.v0alpha3',id:'event-0',sequence:0,type:'point.declared',point:{id:'start',contextId:'actual',axisId:'elapsed'}},{schema:'covenant.timeline.event.v0alpha3',id:'event-1',sequence:1,type:'point.declared',point:{id:'end',contextId:'actual',axisId:'elapsed'}},{schema:'covenant.timeline.event.v0alpha3',id:'event-2',sequence:2,type:'coordinate.asserted',assertion:{id:'start-coordinate',contextId:'actual',pointId:'start',coordinate:{minimum:0,maximum:0},evidenceRefs:['sha256:'+'a'.repeat(64)]}},{schema:'covenant.timeline.event.v0alpha3',id:'event-3',sequence:3,type:'constraint.asserted',assertion:{id:'duration',contextId:'actual',constraint:{fromPointId:'start',toPointId:'end',minimum:5,maximum:10},evidenceRefs:['sha256:'+'a'.repeat(64)]}}]};",
        "const query={schema:'covenant.timeline.query.v0alpha3',id:'query.duration',contextId:'actual',recordedThrough:3,type:'difference.bounds',fromPointId:'start',toPointId:'end'};",
        "const conclusion=reasonTemporalQueryV0Alpha3(temporalRun,query);",
        "process.stdout.write(JSON.stringify({digest:contentDigest(parsed),report:report.schema,archive:archive.schema,profile:typeof verifyGithubEnvelope,temporal:conclusion.result,proof:verifyTemporalConclusionV0Alpha3(temporalRun,query,conclusion)}));",
      ].join(""),
    ],
    { cwd: temporaryDirectory },
  ).trim();
  const smokeResult = JSON.parse(smoke);
  if (
    smokeResult.digest !==
      "sha256:b342fc286d0216cc212e0d7ba234894e2e7283ddf14f959adf0fe7fd5924308a" ||
    smokeResult.report !== "covenant.timeline.report.v0alpha2" ||
    smokeResult.archive !== "covenant.timeline.archive.v1" ||
    smokeResult.profile !== "function" ||
    smokeResult.temporal?.minimum !== 5 ||
    smokeResult.temporal?.maximum !== 10 ||
    smokeResult.proof !== true
  ) {
    throw new Error(`installed package API smoke changed: ${smoke}`);
  }
  console.log(
    `package check passed (${archives[0]}, installed CLI, checkpoint, temporal, and archive APIs)`,
  );
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
