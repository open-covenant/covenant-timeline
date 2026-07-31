import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createIsolatedEnvironment } from "./isolated-environment.mjs";

test("isolates installed package processes from host credentials and options", () => {
  const environment = createIsolatedEnvironment(
    {
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc",
      ACTIONS_RUNTIME_TOKEN: "runtime",
      GITHUB_TOKEN: "github",
      HOME: "/host/home",
      HTTP_PROXY: "http://proxy.invalid",
      LANG: "C.UTF-8",
      NODE_AUTH_TOKEN: "npm",
      NODE_OPTIONS: "--require=host-code",
      NPM_CONFIG_USERCONFIG: "/host/npmrc",
      PATH: process.env.PATH,
      SSH_AUTH_SOCK: "/host/agent.sock",
    },
    {
      HOME: "/isolated/home",
      TEMP: "/isolated/tmp",
      TMP: "/isolated/tmp",
      TMPDIR: "/isolated/tmp",
      USERPROFILE: "/isolated/home",
    },
  );

  const result = spawnSync(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(process.env).sort())))",
    ],
    { encoding: "utf8", env: environment },
  );
  assert.equal(result.status, 0, result.stderr);
  const expected = {
    HOME: "/isolated/home",
    LANG: "C.UTF-8",
    NO_UPDATE_NOTIFIER: "1",
    PATH: process.env.PATH,
    TEMP: "/isolated/tmp",
    TMP: "/isolated/tmp",
    TMPDIR: "/isolated/tmp",
    USERPROFILE: "/isolated/home",
  };
  assert.deepEqual(environment, expected);

  const observed = JSON.parse(result.stdout);
  for (const key of [
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_RUNTIME_TOKEN",
    "GITHUB_TOKEN",
    "HTTP_PROXY",
    "NODE_AUTH_TOKEN",
    "NODE_OPTIONS",
    "NPM_CONFIG_USERCONFIG",
    "SSH_AUTH_SOCK",
  ]) {
    assert.equal(observed[key], undefined);
  }
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(observed[key], value);
  }
});

test("rejects unsupported environment overrides", () => {
  assert.throws(
    () =>
      createIsolatedEnvironment({}, { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc" }),
    /unsupported isolated environment key/,
  );
});

test("routes every installed-code check through the isolated runner", async () => {
  const source = await readFile(
    resolve(import.meta.dirname, "check-mcp-registry-install.mjs"),
    "utf8",
  );

  assert.doesNotMatch(source, /^\s*const timeline = await import\s*\(/m);
  assert.match(source, /runIsolated\(process\.execPath, \[exportProbe\]\)/);
  assert.match(source, /runIsolated\(executable, \["--version"\]\)/);
  assert.match(
    source,
    /runIsolated\(process\.execPath, \[\s*join\(installDirectory, "smoke\.mjs"\)/,
  );
});
